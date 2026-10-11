import asyncio
import http.client
import json
from pathlib import Path
import sys
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "laptop"))
sys.path.insert(0, str(ROOT / "py_modules"))
from remote_helper import HelperServer, parse_target
from remote_server import RemoteServer
from test_remote import FakeInput


class TargetTests(unittest.TestCase):
    def test_numeric_private_targets_and_defaults(self):
        self.assertEqual(parse_target("192.168.1.42"), ("192.168.1.42", 8765))
        self.assertEqual(parse_target(" http://10.0.0.2:9876/ "), ("10.0.0.2", 9876))
        self.assertEqual(parse_target("172.16.0.1:8765"), ("172.16.0.1", 8765))
        self.assertEqual(parse_target("127.0.0.1:8766"), ("127.0.0.1", 8766))

    def test_non_lan_targets_credentials_and_arbitrary_paths_are_rejected(self):
        for value in ("https://192.168.1.2", "example.com", "8.8.8.8", "169.254.1.2", "0.0.0.0", "[::1]", "http://user:pass@192.168.1.2", "http://@192.168.1.2", "192.168.1.2/file", "192.168.1.2?target=other", "192.168.1.2#other", "192.168.1.2:0", "192.168.1.2:99999"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_target(value)


class HelperTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.remote = RemoteServer(ROOT / "web", FakeInput)
        await self.remote.start("127.0.0.1", 0)
        self.remote.pin = "00123456"
        self.helper = HelperServer(("127.0.0.1", self.remote.port), 0)
        self.thread = threading.Thread(target=self.helper.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()

    async def asyncTearDown(self):
        await asyncio.to_thread(self.helper.shutdown)
        self.helper.server_close()
        self.thread.join(timeout=1)
        await self.remote.stop()

    async def request(self, path, data=None, headers=None):
        def send():
            connection = http.client.HTTPConnection("127.0.0.1", self.helper.server_port, timeout=3)
            merged = {"Origin": self.helper.origin, "Content-Type": "application/json"}
            merged.update(headers or {})
            connection.request("GET" if data is None else "POST", path, None if data is None else json.dumps(data), merged)
            response = connection.getresponse()
            result = response.status, dict(response.getheaders()), response.read()
            connection.close()
            return result
        return await asyncio.to_thread(send)

    async def pair(self):
        status, _, payload = await self.request("/api/pair", {"pin": self.remote.pin})
        self.assertEqual(status, 200, payload)
        return json.loads(payload)["token"]

    async def test_loopback_assets_match_current_client_without_arbitrary_file_access(self):
        self.assertEqual(self.helper.server_address[0], "127.0.0.1")
        for path, file in (("/", "index.html"), ("/client.js", "client.js"), ("/style.css", "style.css")):
            status, headers, payload = await self.request(path)
            self.assertEqual(status, 200)
            self.assertEqual(payload, (ROOT / "web" / file).read_bytes())
            self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
            self.assertEqual(headers["Cache-Control"], "no-store")
        for path in ("/../main.py", "/client.js?target=http://8.8.8.8", "/favicon.ico"):
            self.assertEqual((await self.request(path))[0], 404)

    async def test_real_pair_input_text_and_disconnect_relay_preserves_backend_validation(self):
        token = await self.pair()
        auth = {"Authorization": "Bearer " + token}
        events = [{"type": "key", "code": "Escape", "value": 1}, {"type": "key", "code": "Escape", "value": 0}]
        self.assertEqual((await self.request("/api/events", {"events": events}, auth))[0], 200)
        self.assertEqual(self.remote.input.events, events)
        self.assertEqual((await self.request("/api/text", {"text": "hello"}, auth))[0], 200)
        self.assertEqual(self.remote.input.texts, ["hello"])
        self.assertEqual((await self.request("/api/heartbeat", {}, auth))[0], 200)
        self.assertEqual((await self.request("/api/disconnect", {}, auth))[0], 200)
        self.assertEqual(self.remote.token, "")

    async def test_wrong_pin_token_and_invalid_input_are_still_rejected_by_legion(self):
        self.assertEqual((await self.request("/api/pair", {"pin": "incorrect"}))[0], 401)
        token = await self.pair()
        events = {"events": [{"type": "key", "code": "Unknown", "value": 1}]}
        self.assertEqual((await self.request("/api/events", events, {"Authorization": "Bearer bad"}))[0], 401)
        self.assertEqual((await self.request("/api/events", events, {"Authorization": "Bearer " + token}))[0], 400)
        self.assertEqual(self.remote.input.events, [])

    async def test_host_origin_cross_site_and_transfer_encoding_block_before_forwarding(self):
        for headers in ({"Host": "malicious.example"}, {"Origin": "https://malicious.example"}, {"Origin": "null"}, {"Sec-Fetch-Site": "cross-site"}, {"Content-Type": "text/plain"}, {"Transfer-Encoding": "chunked"}):
            status, _, _ = await self.request("/api/pair", {"pin": self.remote.pin}, headers)
            self.assertEqual(status, 403, headers)
        self.assertEqual(self.remote.token, "")
        self.assertEqual(len(self.remote.attempts), 0)

    async def test_only_known_api_paths_and_bounded_bodies_are_forwarded(self):
        self.assertEqual((await self.request("/api/run", {}))[0], 404)
        self.assertEqual((await self.request("/api/pair?target=other", {}))[0], 404)
        self.assertEqual((await self.request("/api/pair", {"pin": "x" * 8192}))[0], 413)
        self.assertEqual(len(self.remote.attempts), 0)

    async def test_duplicate_headers_are_rejected(self):
        def send():
            connection = http.client.HTTPConnection("127.0.0.1", self.helper.server_port, timeout=3)
            connection.putrequest("POST", "/api/pair")
            connection.putheader("Origin", self.helper.origin)
            connection.putheader("Origin", "http://other")
            connection.putheader("Content-Type", "application/json")
            connection.putheader("Content-Length", "2")
            connection.endheaders(b"{}")
            response = connection.getresponse()
            response.read()
            connection.close()
            return response.status
        self.assertEqual(await asyncio.to_thread(send), 400)
        self.assertEqual(len(self.remote.attempts), 0)

    async def test_unreachable_handheld_returns_actionable_error(self):
        await self.remote.stop()
        status, _, payload = await self.request("/api/heartbeat", {})
        self.assertEqual(status, 503)
        self.assertIn("Cannot reach the handheld", json.loads(payload)["error"])


if __name__ == "__main__":
    unittest.main()
