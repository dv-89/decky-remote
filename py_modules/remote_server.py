"""Opt-in LAN HTTP service, ephemeral pairing and bounded input protocol."""
import asyncio
from collections import deque
import contextlib
import ipaddress
import json
from pathlib import Path
import secrets
import socket
import sys
import time

from remote_input import UInput, TEXT_KEYS, validate_event

PORT = 8765
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


class RemoteServer:
    def __init__(self, web_dir, input_factory=UInput, clock=time.monotonic):
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
        self.pin = f"{secrets.randbelow(100_000_000):08d}"
        self.requests.clear()
        if self.input:
            self.input.release()

    def _input_failed(self, error):
        self.error = f"Input device failed: {error}. Stop remote input and enable it again."
        self.token = self.peer = self.pin = ""
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
        try:
            async with asyncio.timeout(5):
                status, content_type, payload = await self._request(reader, writer)
                await self._respond(writer, status, content_type, payload)
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
        assets = {"/": ("index.html", "text/html; charset=utf-8"),
                  "/client.js": ("client.js", "text/javascript; charset=utf-8"),
                  "/style.css": ("style.css", "text/css; charset=utf-8")}
        if method == "GET" and path in assets:
            name, content_type = assets[path]
            return 200, content_type, (self.web_dir / name).read_bytes()
        if method != "POST" or path not in ("/api/pair", "/api/events", "/api/text", "/api/heartbeat", "/api/disconnect"):
            raise HTTPError(404, "Not found")
        if headers.get("origin") != "http://" + host or headers.get("content-type") != "application/json":
            raise HTTPError(403, "Use the controller page served by this handheld")
        length = headers.get("content-length", "")
        if not length.isascii() or not length.isdigit() or not 1 <= int(length) <= 8192:
            raise HTTPError(413, "Invalid request length")
        data = json.loads(await reader.readexactly(int(length)))
        async with self.lock:
            if not self.server:
                raise HTTPError(503, "Remote input is stopped")
            try:
                result = self.dispatch(path, data, peer, headers.get("authorization", ""))
            except ValueError as error:
                raise HTTPError(400, str(error)) from error
            except OSError as error:
                self._input_failed(error)
                raise HTTPError(503, "Input device failed; stop and enable again in Decky") from error
        return 200, "application/json", json.dumps(result).encode()

    async def _respond(self, writer, status, content_type, payload):
        phrases = {200: "OK", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 413: "Payload Too Large", 429: "Too Many Requests", 503: "Service Unavailable"}
        headers = (f"HTTP/1.1 {status} {phrases[status]}\r\nContent-Type: {content_type}\r\n"
                   f"Content-Length: {len(payload)}\r\nConnection: close\r\nCache-Control: no-store\r\n"
                   "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n"
                   "Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\r\n\r\n")
        writer.write(headers.encode() + payload)
        await writer.drain()
