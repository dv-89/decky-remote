"""Local Decky file browsing and file copies within the user's home and media."""
import os
from pathlib import Path
import stat


def open_path(path, flags):
    """On Linux, refuse symlinks in every component of a resolved copy path."""
    if os.name != 'posix':
        return os.open(path, flags)
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in path.parts[1:-1]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return os.open(path.name, flags | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
    finally:
        os.close(fd)


class FileBrowser:
    def __init__(self, home, media=None):
        self.home = Path(home).resolve(strict=True)
        self.media = Path(media) if media else Path('/run/media') / self.home.name

    def roots(self):
        roots = [{"name": "Home", "path": str(self.home)}]
        if self.media.is_dir():
            for path in sorted(self.media.iterdir()):
                if path.is_dir() and not path.is_symlink():
                    roots.append({"name": path.name, "path": str(path.resolve())})
        return roots

    def _expand(self, value):
        if not isinstance(value, str) or not value or len(value) > 4096 or '\0' in value:
            raise ValueError('Choose a valid path')
        path = self.home / value[2:] if value.startswith('~/') else self.home if value == '~' else Path(value)
        if not path.is_absolute():
            raise ValueError('Use a full path or ~/ for Home')
        return path

    def _path(self, value):
        path = self._expand(value).resolve(strict=True)
        if not any(path.is_relative_to(Path(root['path'])) for root in self.roots()):
            raise ValueError('Choose a path inside Home or mounted storage')
        return path

    def list(self, value='', hidden=False):
        if type(hidden) is not bool:
            raise ValueError('Invalid hidden-files setting')
        path = self._path(value or str(self.home))
        if not path.is_dir():
            raise ValueError('Choose a folder')
        roots = self.roots()
        entries = []
        truncated = False
        # Bound large directory listings without reading file contents.
        with os.scandir(path) as scan:
            for entry in scan:
                if not hidden and entry.name.startswith('.'):
                    continue
                if len(entries) == 500:
                    truncated = True
                    break
                info = entry.stat(follow_symlinks=False)
                kind = 'folder' if stat.S_ISDIR(info.st_mode) else 'file' if stat.S_ISREG(info.st_mode) else 'link' if stat.S_ISLNK(info.st_mode) else 'other'
                if kind == 'link':
                    try:
                        if self._path(entry.path).is_dir():
                            kind = 'folder'
                    except (OSError, ValueError):
                        pass
                entries.append({"name": entry.name, "path": str(path / entry.name), "kind": kind, "size": info.st_size if kind == 'file' else 0})
        entries.sort(key=lambda entry: (entry['kind'] != 'folder', entry['name'].casefold()))
        parent = str(path.parent) if any(path.parent.is_relative_to(Path(root['path'])) for root in roots) else ''
        return {"path": str(path), "parent": parent, "roots": roots, "entries": entries, "truncated": truncated}

    def copy(self, source, destination):
        # Copy files only: never follow a selected symlink, replace a destination,
        # recurse through a folder, or expose file operations through the LAN API.
        if self._expand(source).is_symlink():
            raise ValueError('Select a regular file to copy')
        src, folder = self._path(source), self._path(destination)
        if not src.is_file():
            raise ValueError('Select a regular file to copy')
        if not folder.is_dir():
            raise ValueError('Choose a destination folder')
        target = folder / src.name
        source_fd = open_path(src, os.O_RDONLY | getattr(os, 'O_NONBLOCK', 0))
        target_fd = None
        folder_fd = None
        created = False
        try:
            info = os.fstat(source_fd)
            if not stat.S_ISREG(info.st_mode):
                raise ValueError('Select a regular file to copy')
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
            if os.name == 'posix':
                folder_fd = open_path(folder, os.O_RDONLY | os.O_DIRECTORY)
                target_fd = os.open(src.name, flags, 0o600, dir_fd=folder_fd)
            else:
                target_fd = os.open(target, flags, 0o600)
            created = True
            with os.fdopen(source_fd, 'rb', closefd=False) as reader, os.fdopen(target_fd, 'wb', closefd=False) as writer:
                while chunk := reader.read(1024 * 1024):
                    writer.write(chunk)
                writer.flush()
                os.fsync(target_fd)
            # Decky runs this plugin as root for uinput. Copies belong to the
            # handheld user, and never inherit setuid/setgid permissions.
            if hasattr(os, 'fchown') and os.geteuid() == 0:
                owner = self.home.stat()
                os.fchown(target_fd, owner.st_uid, owner.st_gid)
            if hasattr(os, 'fchmod'):
                os.fchmod(target_fd, stat.S_IMODE(info.st_mode) & 0o777)
            return {"path": str(target), "bytes": os.fstat(target_fd).st_size}
        except BaseException:
            if created:
                os.close(target_fd)
                target_fd = None
                if folder_fd is not None:
                    os.unlink(src.name, dir_fd=folder_fd)
                else:
                    target.unlink(missing_ok=True)
            raise
        finally:
            os.close(source_fd)
            if target_fd is not None:
                os.close(target_fd)
            if folder_fd is not None:
                os.close(folder_fd)
