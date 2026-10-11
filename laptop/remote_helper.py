"""Serve the controller on loopback and relay only its bounded input API.

The browser treats loopback as a secure context for Keyboard Lock. This helper
never captures native input, runs commands, or stores pairing credentials.
"""
import argparse
import contextlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
from pathlib import Path
import socket
import sys
import threading
from urllib.parse import urlsplit
import webbrowser

NETWORKS = tuple(ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"))
API_PATHS = {"/api/pair", "/api/events", "/api/text", "/api/heartbeat", "/api/disconnect"}
ASSETS = {"/": ("index.html", "text/html; charset=utf-8"), "/client.js": ("client.js", "text/javascript; charset=utf-8"), "/style.css": ("style.css", "text/css; charset=utf-8")}
WEB_DIR = Path(sys._MEIPASS) / "web" if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1] / "web"


def parse_target(value):
    """Accept only the numeric private address displayed by Decky."""
    value = value.strip()
    parsed = urlsplit(value if "://" in value else "http://" + value)
    if parsed.scheme != "http" or parsed.username is not None or parsed.password is not None or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("Enter the http://IP:port address shown in Decky, without a path.")
    try:
        address = ipaddress.IPv4Address(parsed.hostname)
        port = parsed.port if parsed.port is not None else 8765
    except (ValueError, TypeError) as error:
        raise ValueError("Use the numeric IPv4 address shown in Decky.") from error
    if not any(address in network for network in NETWORKS) or not 1 <= port <= 65535:
        raise ValueError("Only private LAN IPv4 addresses are supported.")
    return str(address), port


class HelperServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, target, port=8767, web_dir=WEB_DIR):
        self.target = target
        self.web_dir = Path(web_dir)
        self.slots = threading.BoundedSemaphore(16)
        super().__init__(("127.0.0.1", port), HelperHandler)
        self.origin = f"http://127.0.0.1:{self.server_port}"

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class HelperHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_):
        pass  # Never log PINs, credentials or input.

    def reply(self, status, payload, content_type="application/json"):
        if not isinstance(payload, bytes):
            payload = json.dumps({"error": payload}).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "close")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        self.end_headers()
        self.wfile.write(payload)
        self.close_connection = True

    def valid_headers(self):
        # A localhost listener must reject DNS rebinding and cross-site calls
        # before replacing Origin for the handheld's existing input API.
        if sum(len(key) + len(value) + 4 for key, value in self.headers.items()) > 4096:
            self.reply(413, "Headers too large.")
            return False
        if any(len(self.headers.get_all(key)) != 1 for key in self.headers):
            self.reply(400, "Duplicate headers are not allowed.")
            return False
        if (self.headers.get("Host") != self.server.origin.removeprefix("http://")
                or "Transfer-Encoding" in self.headers
                or self.headers.get("Sec-Fetch-Site") == "cross-site"):
            self.reply(403, "Open the localhost address displayed by the helper.")
            return False
        return True

    def do_GET(self):
        if not self.valid_headers():
            return
        if self.path not in ASSETS:
            self.reply(404, "Not found.")
            return
        name, content_type = ASSETS[self.path]
        try:
            self.reply(200, (self.server.web_dir / name).read_bytes(), content_type)
        except OSError:
            self.reply(503, "Controller files are missing. Extract the helper again.")

    def do_POST(self):
        if not self.valid_headers():
            return
        if self.path not in API_PATHS:
            self.reply(404, "Not found.")
            return
        if self.headers.get("Origin") != self.server.origin or self.headers.get("Content-Type") != "application/json":
            self.reply(403, "Use the controller page opened by this helper.")
            return
        length = self.headers.get("Content-Length", "")
        if not length.isascii() or not length.isdigit() or not 1 <= int(length) <= 8192:
            self.reply(413, "Invalid request length.")
            return
        connection = None
        try:
            body = self.rfile.read(int(length))
            if len(body) != int(length):
                self.reply(400, "Incomplete request.")
                return
            host, port = self.server.target
            headers = {"Content-Type": "application/json", "Origin": f"http://{host}:{port}"}
            authorization = self.headers.get("Authorization")
            if authorization:
                headers["Authorization"] = authorization
            # Direct HTTPConnection: no DNS, redirects, environment proxies or
            # target selected by an incoming request. The Legion still validates
            # the PIN/token, event schemas, peer address and request limits.
            connection = http.client.HTTPConnection(host, port, timeout=1)
            connection.request("POST", self.path, body, headers)
            response = connection.getresponse()
            payload = response.read(65537)
            if len(payload) > 65536 or response.status not in (200, 400, 401, 403, 404, 409, 413, 429, 503) or response.getheader("Content-Type", "").split(";")[0] != "application/json":
                self.reply(502, "The address did not respond as Decky Remote.")
                return
            self.reply(response.status, payload)
        except (OSError, http.client.HTTPException):
            with contextlib.suppress(OSError):
                self.reply(503, "Cannot reach the handheld. Check its address, Wi-Fi and Enable remote input in Decky.")
        finally:
            if connection:
                connection.close()


def main():
    parser = argparse.ArgumentParser(description="Decky Remote laptop helper: fullscreen control with tap/hold Escape.")
    parser.add_argument("--url", help="Handheld address shown in Decky, such as http://192.168.1.42:8765")
    parser.add_argument("--port", type=int, default=8767, help="Localhost port; 0 chooses an available port")
    parser.add_argument("--no-browser", action="store_true", help="Print the localhost URL without opening it")
    args = parser.parse_args()
    print("Decky Remote laptop helper", flush=True)
    target = None
    while target is None:
        value = args.url if args.url is not None else input("Handheld address shown in Decky: ")
        try:
            target = parse_target(value)
        except ValueError as error:
            if args.url is not None:
                parser.error(str(error))
            print(error, flush=True)
    if not 0 <= args.port <= 65535:
        parser.error("The localhost port must be between 0 and 65535.")
    try:
        server = HelperServer(target, args.port)
    except OSError:
        if args.port == 8767:
            server = HelperServer(target, 0)
        else:
            raise
    with server:
        print("Open in Chrome or Edge: " + server.origin, flush=True)
        print("Pair using the code in Decky. Start control enters fullscreen.", flush=True)
        print("Tap Esc sends it to the handheld; hold Esc about 2 seconds to release.", flush=True)
        print("Keep this window open. Close it or press Ctrl+C to stop the helper.", flush=True)
        if not args.no_browser:
            webbrowser.open(server.origin)
        server.serve_forever(poll_interval=0.2)


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        pass
    except OSError as error:
        print("Cannot start the helper: " + str(error), flush=True)
        if sys.stdin.isatty():
            input("Press Enter to close.")
