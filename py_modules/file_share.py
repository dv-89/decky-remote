"""Paired file exchange confined to a Steam user's dedicated shared folder."""
import hashlib
import os
from pathlib import Path
import secrets
import stat
import time

# Browser byte offsets must remain exact when represented as JavaScript numbers.
MAX_SAFE_SIZE = (1 << 53) - 1
RESERVE = 64 * 1024**2
CHUNK = 256 * 1024
FOLDER = "Decky Remote"


class TransferError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def filename(value):
    try:
        length = len(value.encode("utf-8")) if isinstance(value, str) else 0
    except UnicodeError:
        raise TransferError(400, "Filename must be valid UTF-8") from None
    if (not isinstance(value, str) or not value or value.startswith(".")
            or length > 200
            or any(char in '/\\:' or ord(char) < 32 or ord(char) == 127 for char in value)):
        raise TransferError(400, "Use a visible filename of up to 200 UTF-8 bytes, without path separators or control characters")
    return value


class FileShare:
    def __init__(self, home, clock=time.monotonic):
        self.home = Path(home)
        self.clock = clock
        self.directory = None
        self.owner = self.group = None
        self.upload = None
        self.tickets = {}

    def _directory(self):
        if self.directory is not None:
            return self.directory
        if not self.home.is_absolute():
            raise TransferError(503, "File sharing needs an absolute Steam user home")
        descriptors = []
        try:
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
            current = os.open(self.home, flags)
            descriptors.append(current)
            info = os.fstat(current)
            self.owner, self.group = info.st_uid, info.st_gid
            for part in ("Downloads", FOLDER):
                created = False
                try:
                    os.mkdir(part, 0o700, dir_fd=current)
                    created = True
                except FileExistsError:
                    pass
                child = os.open(part, flags, dir_fd=current)
                descriptors.append(child)
                if created and os.geteuid() == 0:
                    os.fchown(child, self.owner, self.group)
                info = os.fstat(child)
                if info.st_uid != self.owner or info.st_mode & 0o700 != 0o700:
                    raise TransferError(403, "The shared folder must be readable and writable by the Steam user")
                current = child
            self.directory = descriptors.pop()
            return self.directory
        except OSError as error:
            raise TransferError(503, "Cannot open Downloads/Decky Remote; check free space, permissions and that its folders are not symlinks") from error
        finally:
            for descriptor in descriptors:
                os.close(descriptor)

    def listing(self):
        directory = self._directory()
        entries, truncated = [], False
        with os.scandir(directory) as scanner:
            for entry in scanner:
                try:
                    filename(entry.name)
                    info = entry.stat(follow_symlinks=False)
                    if not stat.S_ISREG(info.st_mode) or info.st_uid != self.owner or not info.st_mode & 0o400:
                        continue
                    if len(entries) == 500:
                        truncated = True
                        break
                    entries.append({"name": entry.name, "size": info.st_size, "modified": int(info.st_mtime)})
                except (OSError, TransferError):
                    continue
        entries.sort(key=lambda item: item["name"].casefold())
        return {"folder": str(self.home / "Downloads" / FOLDER), "files": entries,
                "truncated": truncated, "maxSafeSize": MAX_SAFE_SIZE, "chunkSize": CHUNK,
                **self.space()}

    def space(self):
        capacity = os.statvfs(self._directory())
        free = max(0, capacity.f_bavail) * capacity.f_frsize
        return {"freeBytes": free, "usableBytes": max(0, free - RESERVE), "reserveBytes": RESERVE}

    def preflight(self, data):
        if (set(data) != {"totalSize", "fileCount"}
                or type(data["totalSize"]) is not int or not 0 <= data["totalSize"] <= MAX_SAFE_SIZE
                or type(data["fileCount"]) is not int or not 1 <= data["fileCount"] <= MAX_SAFE_SIZE):
            raise TransferError(400, "Provide a valid total byte size and file count")
        space = self.space()
        return {**space, "fits": data["totalSize"] + RESERVE <= space["freeBytes"], "chunkSize": CHUNK}

    def begin(self, data):
        if set(data) != {"name", "size"}:
            raise TransferError(400, "Provide a filename and file size")
        name = filename(data["name"])
        size = data["size"]
        if type(size) is not int or not 0 <= size <= MAX_SAFE_SIZE:
            raise TransferError(400, "File size must be an exact nonnegative byte count supported by the browser")
        self.expire()
        if self.upload:
            raise TransferError(409, "Another file is uploading; finish or cancel it first")
        directory = self._directory()
        if self.space()["freeBytes"] < size + RESERVE:
            raise TransferError(507, "Not enough free space on the Legion; refresh Files to check available space")
        identifier = secrets.token_hex(16)
        temporary = ".decky-remote-" + identifier + ".part"
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
        try:
            if os.geteuid() == 0:
                os.fchown(descriptor, self.owner, self.group)
            self.upload = {"id": identifier, "temporary": temporary, "fd": descriptor,
                           "name": name, "size": size, "offset": 0, "seen": self.clock(),
                           "hash": hashlib.sha256()}
        except BaseException:
            os.close(descriptor)
            os.unlink(temporary, dir_fd=directory)
            raise
        return {"id": identifier, "chunkSize": CHUNK, "streaming": True}

    def start_stream(self, identifier, size):
        self.expire()
        upload = self.upload
        if not upload or upload["id"] != identifier:
            raise TransferError(404, "Upload expired or was cancelled; send the file again")
        if upload.get("receiving") or upload["offset"]:
            raise TransferError(409, "This upload is already receiving data")
        if size != upload["size"]:
            raise TransferError(413, "Upload length does not match the selected file")
        upload["receiving"] = True
        upload["seen"] = self.clock()

    def append(self, identifier, offset, payload, *, stream=False):
        self.expire()
        upload = self.upload
        if not upload or identifier != upload["id"]:
            raise TransferError(404, "Upload expired or was cancelled; send the file again")
        if bool(upload.get("receiving")) != stream:
            raise TransferError(409, "This upload is already receiving data")
        if type(offset) is not int or offset != upload["offset"]:
            raise TransferError(409, "Upload offset does not match; send the file again")
        if not 1 <= len(payload) <= CHUNK or offset + len(payload) > upload["size"]:
            raise TransferError(413, "Invalid upload chunk size")
        if self.space()["freeBytes"] < len(payload) + RESERVE:
            self.cancel()
            raise TransferError(507, "Free space changed during upload; the unfinished file was removed. Refresh Files and try again")
        view = memoryview(payload)
        while view:
            written = os.write(upload["fd"], view)
            if written <= 0:
                raise OSError("File write stopped")
            view = view[written:]
        upload["hash"].update(payload)
        upload["offset"] += len(payload)
        upload["seen"] = self.clock()
        return {"offset": upload["offset"]}

    def _same_temporary(self, upload):
        try:
            current = os.stat(upload["temporary"], dir_fd=self.directory, follow_symlinks=False)
            opened = os.fstat(upload["fd"])
            return stat.S_ISREG(current.st_mode) and (current.st_dev, current.st_ino) == (opened.st_dev, opened.st_ino)
        except OSError:
            return False

    def finish(self, data, *, stream=False):
        if set(data) != {"id"} or not self.upload or data["id"] != self.upload["id"]:
            raise TransferError(404, "Upload not found")
        upload = self.upload
        if bool(upload.get("receiving")) != stream:
            raise TransferError(409, "Wait for the upload to finish receiving data")
        if upload["offset"] != upload["size"]:
            raise TransferError(409, "File is incomplete; upload all chunks before finishing")
        if not self._same_temporary(upload):
            self.cancel()
            raise TransferError(409, "Temporary file changed; send the file again")
        # Publication makes the complete file visible atomically. Avoid a
        # potentially long disk flush on the input/heartbeat event loop.
        stem, extension = os.path.splitext(upload["name"])
        for index in range(1, 10001):
            suffix = "" if index == 1 else f" ({index})"
            tail = suffix + extension
            if len(tail.encode("utf-8")) > 160:
                tail = suffix
                stem = upload["name"]
            prefix = stem.encode("utf-8")[:200 - len(tail.encode("utf-8"))].decode("utf-8", errors="ignore")
            name = prefix + tail
            try:
                # Hard-link publication is atomic and never replaces an existing file.
                os.link(upload["temporary"], name, src_dir_fd=self.directory, dst_dir_fd=self.directory, follow_symlinks=False)
                result = {"name": name, "size": upload["size"], "sha256": upload["hash"].hexdigest()}
                self.cancel()
                return result
            except FileExistsError:
                continue
        raise TransferError(409, "Too many files with that name; rename the file and try again")

    def cancel(self, data=None):
        if data and (set(data) != {"id"} or not self.upload or data["id"] != self.upload["id"]):
            raise TransferError(404, "Upload not found")
        upload, self.upload = self.upload, None
        if upload:
            try:
                if self._same_temporary(upload):
                    os.unlink(upload["temporary"], dir_fd=self.directory)
            finally:
                os.close(upload["fd"])
        return {"ok": True}

    def _open(self, name):
        name = filename(name)
        directory = self._directory()
        try:
            descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=directory)
        except OSError as error:
            raise TransferError(404, "File is unavailable; refresh the file list") from error
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != self.owner or not info.st_mode & 0o400:
            os.close(descriptor)
            raise TransferError(403, "Only readable regular files owned by the Steam user can be shared")
        if info.st_size > MAX_SAFE_SIZE:
            os.close(descriptor)
            raise TransferError(413, "File size exceeds the browser's exact byte-offset range")
        return descriptor, info

    def grant(self, data, token, peer):
        if set(data) != {"name"}:
            raise TransferError(400, "Provide a filename")
        descriptor, info = self._open(data["name"])
        os.close(descriptor)
        self.expire()
        if len(self.tickets) >= 16:
            raise TransferError(429, "Too many pending downloads; wait a moment")
        ticket = secrets.token_hex(24)
        self.tickets[ticket] = {"name": data["name"], "token": token, "peer": peer,
                                "inode": (info.st_dev, info.st_ino), "expires": self.clock() + 30}
        return {"url": "/download/" + ticket}

    def download(self, ticket, token, peer):
        self.expire()
        grant = self.tickets.get(ticket)
        if not grant or not token or grant["token"] != token or grant["peer"] != peer:
            raise TransferError(401, "Download link expired; select Download again while paired")
        del self.tickets[ticket]
        descriptor, info = self._open(grant["name"])
        if (info.st_dev, info.st_ino) != grant["inode"]:
            os.close(descriptor)
            raise TransferError(409, "File changed; select Download again")
        return descriptor, grant["name"], info.st_size

    def expire(self):
        now = self.clock()
        self.tickets = {ticket: value for ticket, value in self.tickets.items() if value["expires"] > now}
        if self.upload and now - self.upload["seen"] > 30:
            self.cancel()

    def reset(self):
        try:
            self.cancel()
        finally:
            self.tickets.clear()
            if self.directory is not None:
                os.close(self.directory)
                self.directory = None
