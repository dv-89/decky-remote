"""Opt-in LAN HTTP service, ephemeral pairing and bounded input protocol."""
import asyncio
from collections import deque
import contextlib
import ipaddress
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import time
from urllib.parse import quote

from file_share import CHUNK, MAX_SAFE_SIZE, TransferError

from remote_input import UInput, TEXT_KEYS, validate_event

PORT = 8765
UPLOAD_IDLE_TIMEOUT = 30
NETWORKS = tuple(ipaddress.ip_network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"))


def local_address(value):
    try:
        address = ipaddress.ip_address(value)
        return any(address in network for network in NETWORKS)
    except ValueError:
        return False


def lan_addresses():
    addresses = set()
    try:
        addresses.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    if sys.platform == "linux":
        import fcntl
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            for _, name in socket.if_nameindex():
                try:
                    result = fcntl.ioctl(probe.fileno(), 0x8915, name.encode()[:15].ljust(256, b"\0"))
                    addresses.add(socket.inet_ntoa(result[20:24]))
                except OSError:
                    pass
    return sorted(address for address in addresses if local_address(address) and not address.startswith("127."))


class HTTPError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Download:
    def __init__(self, descriptor, name, size, token, peer):
        self.descriptor, self.name, self.size = descriptor, name, size
        self.token, self.peer = token, peer


class Upload:
    def __init__(self, identifier, size, token, peer):
        self.identifier, self.size, self.token, self.peer = identifier, size, token, peer


class RemoteServer:
    def __init__(self, web_dir, input_factory=UInput, clock=time.monotonic, files=None):
        self.web_dir = Path(web_dir)
        self.input_factory, self.clock = input_factory, clock
        self.server = self.input = self.watchdog = None
        self.pin = self.token = self.peer = ""
        self.paired_at = self.last_seen = 0
        self.attempts = deque()
        self.requests = deque()
        self.clients = set()
        self.error = ""
        self.urls = []
        self.lock = asyncio.Lock()
        self.port = PORT
        self.files = files

    def status(self):
        return {"enabled": self.server is not None, "paired": bool(self.token),
                "pin": self.pin if self.server and not self.token else "",
                "client": self.peer, "urls": self.urls, "error": self.error}

    async def start(self, host="0.0.0.0", port=PORT):
        async with self.lock:
            if self.server:
                return self.status()
            try:
                self.input = self.input_factory()
                # Allow SteamOS time to discover the new virtual devices.
                await asyncio.sleep(0.5)
                self.server = await asyncio.start_server(self._serve, host, port, limit=4096)
                self.port = self.server.sockets[0].getsockname()[1]
                self.urls = [f"http://{ip}:{self.port}" for ip in lan_addresses()]
                self.pin = f"{secrets.randbelow(100_000_000):08d}"
                self.error = ""
                self.attempts.clear()
                self.watchdog = asyncio.create_task(self._watch())
            except (OSError, RuntimeError) as error:
                if self.server:
                    self.server.close()
                    await self.server.wait_closed()
                    self.server = None
                if self.input:
                    with contextlib.suppress(OSError):
                        self.input.close()
                    self.input = None
                self.pin = ""
                self.urls = []
                self.error = f"Cannot enable remote input: {error}. Check /dev/uinput and Decky's root permission."
            return self.status()

    def _revoke(self):
        self.token = self.peer = ""
        if self.files:
            with contextlib.suppress(OSError):
                self.files.reset()
        self.pin = f"{secrets.randbelow(100_000_000):08d}"
        self.requests.clear()
        if self.input:
            self.input.release()

    def _input_failed(self, error):
        self.error = f"Input device failed: {error}. Stop remote input and enable it again."
        self.token = self.peer = self.pin = ""
        if self.files:
            with contextlib.suppress(OSError):
                self.files.reset()
        if self.input:
            with contextlib.suppress(OSError):
                self.input.close()
            self.input = None

    async def disconnect(self):
        async with self.lock:
            try:
                self._revoke()
            except OSError as error:
                self._input_failed(error)
            return self.status()

    async def stop(self):
        async with self.lock:
            server = self.server
            if self.server:
                self.server.close()
                self.server = None
            if self.watchdog:
                self.watchdog.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await self.watchdog
                self.watchdog = None
            for task in list(self.clients):
                task.cancel()
            if self.clients:
                await asyncio.gather(*self.clients, return_exceptions=True)
            if server:
                await server.wait_closed()
            if self.input:
                try:
                    self.input.close()
                except OSError as error:
                    self.error = f"Input cleanup failed: {error}"
                self.input = None
            self.token = self.peer = self.pin = ""
            if self.files:
                with contextlib.suppress(OSError):
                    self.files.reset()
            self.urls = []
            return self.status()

    async def _watch(self):
        while True:
            await asyncio.sleep(0.5)
            try:
                async with self.lock:
                    self.expire()
            except OSError as error:
                self._input_failed(error)

    def expire(self):
        now = self.clock()
        if self.token and (now - self.last_seen > 3 or now - self.paired_at > 3600):
            self._revoke()
        if self.files:
            with contextlib.suppress(OSError):
                self.files.expire()

    def _authorize(self, peer, authorization):
        self.expire()
        if not self.token or peer != self.peer or not secrets.compare_digest(authorization, "Bearer " + self.token):
            raise HTTPError(401, "Session ended; pair again using the code in Decky")

    def file_request(self, action, data, peer, authorization):
        self._authorize(peer, authorization)
        if not self.files:
            raise HTTPError(503, "File sharing is unavailable in this preview")
        try:
            if action == "list" and not data:
                result = self.files.listing()
            elif action == "preflight":
                result = self.files.preflight(data)
            elif action == "begin":
                result = self.files.begin(data)
            elif action == "finish":
                result = self.files.finish(data)
            elif action == "cancel":
                result = self.files.cancel(data)
            elif action == "download":
                result = self.files.grant(data, self.token, peer)
            else:
                raise HTTPError(400, "Unsupported file request")
        except TransferError as error:
            raise HTTPError(error.status, error.message) from error
        except OSError as error:
            if action in ("begin", "finish"):
                with contextlib.suppress(OSError):
                    self.files.cancel()
            raise HTTPError(507, "File operation failed; check the shared folder's permissions and free space") from error
        self.last_seen = self.clock()
        return result

    def dispatch(self, path, data, peer, authorization):
        if self.input is None:
            raise HTTPError(503, "Input device unavailable; stop and enable again in Decky")
        self.expire()
        if not isinstance(data, dict):
            raise HTTPError(400, "Expected a JSON object")
        now = self.clock()
        if path == "/api/pair":
            while self.attempts and now - self.attempts[0] > 60:
                self.attempts.popleft()
            if len(self.attempts) >= 5:
                raise HTTPError(429, "Too many pairing attempts; wait one minute")
            self.attempts.append(now)
            if set(data) != {"pin"} or not isinstance(data["pin"], str) or not secrets.compare_digest(data["pin"], self.pin):
                raise HTTPError(401, "Pairing code is incorrect")
            if self.token:
                raise HTTPError(409, "A laptop is already paired; disconnect it in Decky")
            self.token = secrets.token_urlsafe(32)
            self.peer = peer
            self.paired_at = self.last_seen = now
            self.pin = ""  # Single-use pairing code.
            self.requests.clear()
            return {"token": self.token}
        if not self.token or peer != self.peer or not secrets.compare_digest(authorization, "Bearer " + self.token):
            raise HTTPError(401, "Session ended; pair again using the code in Decky")
        while self.requests and now - self.requests[0] > 1:
            self.requests.popleft()
        if len(self.requests) >= 120:
            raise HTTPError(429, "Input is arriving too quickly")
        self.requests.append(now)
        if path == "/api/events" and set(data) == {"events"}:
            events = data["events"]
            if not isinstance(events, list) or not 1 <= len(events) <= 64:
                raise ValueError("Send 1–64 input events")
            for event in events:
                validate_event(event)
            for event in events:
                self.input.apply(event)
        elif path == "/api/text" and set(data) == {"text"}:
            value = data["text"]
            if not isinstance(value, str) or not 1 <= len(value) <= 128 or any(char not in TEXT_KEYS for char in value):
                raise ValueError("Text supports up to 128 US-layout characters, tabs and newlines")
            self.input.text(value)
        elif path == "/api/heartbeat" and not data:
            pass
        elif path == "/api/disconnect" and not data:
            self._revoke()
        else:
            raise HTTPError(400, "Unsupported request")
        self.last_seen = now
        return {"ok": True}

    async def _serve(self, reader, writer):
        task = asyncio.current_task()
        if len(self.clients) >= 16:
            writer.close()
            return
        self.clients.add(task)
        download = upload = None
        try:
            async with asyncio.timeout(5):
                response = await self._request(reader, writer)
            if isinstance(response, Upload):
                upload = response
                async with asyncio.timeout(3600):
                    result = await self._upload(reader, upload)
                async with asyncio.timeout(5):
                    await self._respond(writer, 200, "application/json", json.dumps(result).encode())
            elif isinstance(response, Download):
                download = response
                async with asyncio.timeout(3600):
                    await self._download(writer, download)
            else:
                async with asyncio.timeout(5):
                    await self._respond(writer, *response)
        except HTTPError as error:
            with contextlib.suppress(OSError):
                await self._respond(writer, error.status, "application/json", json.dumps({"error": error.message}).encode())
        except (ValueError, TypeError, UnicodeError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            with contextlib.suppress(OSError):
                await self._respond(writer, 400, "application/json", b'{"error":"Invalid request"}')
        except OSError:
            # A browser may close an HTTP connection before its response arrives.
            # Input errors are handled separately inside the RPC dispatch boundary.
            pass
        except TimeoutError:
            pass
        finally:
            # No await here: stop() holds the dispatch lock while cancelling
            # clients. An old stream must never cancel a newer upload.
            if upload and self.files and self.files.upload and self.files.upload["id"] == upload.identifier:
                with contextlib.suppress(OSError):
                    self.files.cancel({"id": upload.identifier})
            if download:
                os.close(download.descriptor)
            writer.close()
            with contextlib.suppress(OSError):
                await writer.wait_closed()
            self.clients.discard(task)

    async def _request(self, reader, writer):
        peer = writer.get_extra_info("peername")[0]
        address = writer.get_extra_info("sockname")[0]
        if not local_address(peer):
            raise HTTPError(403, "Only private LAN clients are supported")
        raw = await reader.readuntil(b"\r\n\r\n")
        if len(raw) > 4096:
            raise HTTPError(413, "Headers too large")
        lines = raw.decode("ascii").split("\r\n")
        method, path, version = lines[0].split(" ")
        headers = {}
        for line in lines[1:-2]:
            key, value = line.split(":", 1)
            key = key.lower()
            if key in headers or key.strip() != key:
                raise HTTPError(400, "Duplicate or invalid header")
            headers[key] = value.strip()
        host = f"{address}:{self.port}"
        if version != "HTTP/1.1" or headers.get("host") != host or "transfer-encoding" in headers:
            raise HTTPError(403, "Open the numeric IP address shown in Decky")
        if headers.get("sec-fetch-site") == "cross-site":
            raise HTTPError(403, "Cross-site requests are blocked")
        if method == "GET" and path.startswith("/download/"):
            ticket = path.removeprefix("/download/")
            if len(ticket) != 48 or any(char not in "0123456789abcdef" for char in ticket):
                raise HTTPError(404, "Download not found")
            async with self.lock:
                self.expire()
                if not self.server or not self.files:
                    raise HTTPError(401, "Pair before downloading files")
                try:
                    descriptor, name, size = self.files.download(ticket, self.token, peer)
                except TransferError as error:
                    raise HTTPError(error.status, error.message) from error
                self.last_seen = self.clock()
                return Download(descriptor, name, size, self.token, peer)
        assets = {"/": ("index.html", "text/html; charset=utf-8"),
                  "/client.js": ("client.js", "text/javascript; charset=utf-8"),
                  "/files.js": ("files.js", "text/javascript; charset=utf-8"),
                  "/style.css": ("style.css", "text/css; charset=utf-8")}
        if method == "GET" and path in assets:
            name, content_type = assets[path]
            return 200, content_type, (self.web_dir / name).read_bytes()
        file_actions = {"/api/files/" + name: name for name in ("list", "preflight", "begin", "upload", "chunk", "finish", "cancel", "download")}
        if method != "POST" or path not in ("/api/pair", "/api/events", "/api/text", "/api/heartbeat", "/api/disconnect", *file_actions):
            raise HTTPError(404, "Not found")
        chunk = path == "/api/files/chunk"
        streaming = path == "/api/files/upload"
        if headers.get("origin") != "http://" + host or headers.get("content-type") != ("application/octet-stream" if chunk or streaming else "application/json"):
            raise HTTPError(403, "Use the controller page served by this handheld")
        length = headers.get("content-length", "")
        if (not length.isascii() or not length.isdigit() or len(length) > 16
                or not (0 if streaming else 1) <= int(length) <= (MAX_SAFE_SIZE if streaming else CHUNK if chunk else 8192)):
            raise HTTPError(413, "Invalid request length")
        if path in file_actions:
            # Authenticate before reading a file body or touching the filesystem.
            self._authorize(peer, headers.get("authorization", ""))
        if streaming:
            async with self.lock:
                self._authorize(peer, headers.get("authorization", ""))
                if not self.server or not self.files:
                    raise HTTPError(503, "File sharing is unavailable")
                identifier = headers.get("x-upload-id", "")
                try:
                    self.files.start_stream(identifier, int(length))
                except TransferError as error:
                    raise HTTPError(error.status, error.message) from error
                self.last_seen = self.clock()
                return Upload(identifier, int(length), self.token, peer)
        if chunk:
            offset = headers.get("x-upload-offset", "")
            if not offset.isascii() or not offset.isdigit() or len(offset) > 16:
                raise HTTPError(400, "Invalid upload offset")
            payload = await reader.readexactly(int(length))
            async with self.lock:
                self._authorize(peer, headers.get("authorization", ""))
                if not self.server or not self.files:
                    raise HTTPError(503, "File sharing is unavailable")
                try:
                    result = self.files.append(headers.get("x-upload-id", ""), int(offset), payload)
                except TransferError as error:
                    raise HTTPError(error.status, error.message) from error
                except OSError as error:
                    with contextlib.suppress(OSError):
                        self.files.cancel()
                    raise HTTPError(507, "Upload failed; check free space and send the file again") from error
                self.last_seen = self.clock()
            return 200, "application/json", json.dumps(result).encode()
        data = json.loads(await reader.readexactly(int(length)))
        async with self.lock:
            if not self.server:
                raise HTTPError(503, "Remote input is stopped")
            if path in file_actions:
                if not isinstance(data, dict):
                    raise HTTPError(400, "Expected a JSON object")
                result = self.file_request(file_actions[path], data, peer, headers.get("authorization", ""))
                return 200, "application/json", json.dumps(result).encode()
            try:
                result = self.dispatch(path, data, peer, headers.get("authorization", ""))
            except ValueError as error:
                raise HTTPError(400, str(error)) from error
            except OSError as error:
                self._input_failed(error)
                raise HTTPError(503, "Input device failed; stop and enable again in Decky") from error
        return 200, "application/json", json.dumps(result).encode()

    async def _respond(self, writer, status, content_type, payload):
        phrases = {200: "OK", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 408: "Request Timeout", 409: "Conflict", 413: "Payload Too Large", 429: "Too Many Requests", 503: "Service Unavailable", 507: "Insufficient Storage"}
        headers = (f"HTTP/1.1 {status} {phrases[status]}\r\nContent-Type: {content_type}\r\n"
                   f"Content-Length: {len(payload)}\r\nConnection: close\r\nCache-Control: no-store\r\n"
                   "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n"
                   "Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\r\n\r\n")
        writer.write(headers.encode() + payload)
        await writer.drain()

    async def _upload(self, reader, upload):
        offset = 0
        try:
            while offset < upload.size:
                try:
                    async with asyncio.timeout(UPLOAD_IDLE_TIMEOUT):
                        payload = await reader.read(min(CHUNK, upload.size - offset))
                except TimeoutError:
                    raise HTTPError(408, "Upload stalled; check Wi-Fi and send the file again") from None
                if not payload:
                    raise HTTPError(400, "Upload was interrupted; send the file again")
                async with self.lock:
                    self._authorize(upload.peer, "Bearer " + upload.token)
                    if not self.server:
                        raise HTTPError(503, "Remote input is stopped")
                    self.files.append(upload.identifier, offset, payload, stream=True)
                    self.last_seen = self.clock()
                offset += len(payload)
                # A hot socket must still let input, heartbeat and cancellation run.
                await asyncio.sleep(0)
            async with self.lock:
                self._authorize(upload.peer, "Bearer " + upload.token)
                result = self.files.finish({"id": upload.identifier}, stream=True)
                self.last_seen = self.clock()
                return result
        except TransferError as error:
            raise HTTPError(error.status, error.message) from error
        except OSError as error:
            raise HTTPError(507, "Upload failed; check free space and send the file again") from error

    async def _download(self, writer, download):
        headers = ("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n"
                   f"Content-Length: {download.size}\r\nContent-Disposition: attachment; filename=\"download\"; filename*=UTF-8''{quote(download.name, safe='')}\r\n"
                   "Connection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n"
                   "Referrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'\r\n\r\n")
        writer.write(headers.encode("ascii"))
        remaining = download.size
        while remaining:
            if download.token != self.token or download.peer != self.peer or not self.server:
                return
            chunk = os.read(download.descriptor, min(64 * 1024, remaining))
            if not chunk:
                return
            writer.write(chunk)
            remaining -= len(chunk)
            async with asyncio.timeout(10):
                await writer.drain()
            await asyncio.sleep(0)
        async with asyncio.timeout(10):
            await writer.drain()
