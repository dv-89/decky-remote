import asyncio
import json
from pathlib import Path
import struct
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "py_modules"))
import remote_input
from remote_input import KEYS, UInput, validate_event
from remote_server import HTTPError, RemoteServer, local_address


class FakeInput:
    def __init__(self):
        self.events = []
        self.texts = []
        self.releases = 0
        self.closed = False

    def apply(self, event):
        self.events.append(event)

    def text(self, value):
        self.texts.append(value)

    def release(self):
        self.releases += 1

    def close(self):
        self.closed = True


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.now = 10
        self.server = RemoteServer(ROOT / "web", clock=lambda: self.now)
        self.server.input = FakeInput()
        self.server.pin = "00123456"
        self.peer = "192.168.1.7"

    def pair(self):
        return self.server.dispatch("/api/pair", {"pin": self.server.pin}, self.peer, "")["token"]

    def send(self, path, data, token, peer=None):
        return self.server.dispatch(path, data, peer or self.peer, "Bearer " + token)

    def test_pair_requires_pin_and_rate_limits_brute_force(self):
        for _ in range(5):
            with self.assertRaises(HTTPError) as caught:
                self.server.dispatch("/api/pair", {"pin":"wrong"}, self.peer, "")
            self.assertEqual(caught.exception.status, 401)
        with self.assertRaises(HTTPError) as caught:
            self.pair()
        self.assertEqual(caught.exception.status, 429)
        self.now += 61
        self.assertTrue(self.pair())

    def test_token_and_peer_required_and_pin_is_single_use(self):
        token = self.pair()
        self.assertEqual(self.server.pin, "")
        for credential, peer in (("incorrect", self.peer), (token, "192.168.1.8")):
            with self.assertRaises(HTTPError) as caught:
                self.send("/api/events", {"events":[{"type":"release"}]}, credential, peer)
            self.assertEqual(caught.exception.status, 401)
        self.assertFalse(self.server.input.events)
        with self.assertRaises(HTTPError):
            self.server.dispatch("/api/pair", {"pin":"00123456"}, self.peer, "")

    def test_batch_is_validated_before_injecting_any_event(self):
        token = self.pair()
        with self.assertRaises(ValueError):
            self.send("/api/events", {"events":[{"type":"key", "code":"KeyA", "value":1}, {"type":"shell", "command":"anything"}]}, token)
        self.assertFalse(self.server.input.events)
        with self.assertRaises(ValueError):
            self.send("/api/events", {"events":[{"type":"release"}] * 65}, token)

    def test_events_text_and_disconnect(self):
        token = self.pair()
        events = [{"type":"key","code":"KeyW","value":1}, {"type":"move","dx":14,"dy":-4}, {"type":"button","button":"left","value":1}, {"type":"wheel","delta":-1}]
        self.send("/api/events", {"events":events}, token)
        self.assertEqual(self.server.input.events, events)
        self.send("/api/text", {"text":"Hello!\n"}, token)
        self.assertEqual(self.server.input.texts, ["Hello!\n"])
        for value in ("", "a"*129, "é", "\0", True):
            with self.assertRaises(ValueError):
                self.send("/api/text", {"text":value}, token)
        self.send("/api/disconnect", {}, token)
        self.assertFalse(self.server.token)
        self.assertEqual(len(self.server.pin), 8)
        self.assertEqual(self.server.input.releases, 1)
        with self.assertRaises(HTTPError):
            self.send("/api/heartbeat", {}, token)

    def test_deadman_heartbeat_and_hour_session_limit(self):
        token = self.pair()
        self.now += 2
        self.send("/api/heartbeat", {}, token)
        self.now += 2
        self.server.expire()
        self.assertTrue(self.server.token)
        self.now += 2
        self.server.expire()
        self.assertFalse(self.server.token)
        self.assertEqual(self.server.input.releases, 1)
        token = self.pair()
        self.now += 3601
        self.server.last_seen = self.now
        self.server.expire()
        self.assertFalse(self.server.token)

    def test_event_schema_and_lan_boundaries(self):
        for event in (None, {"type":"key","code":[],"value":1}, {"type":"key","code":"KeyA","value":True}, {"type":"move","dx":1001,"dy":0}, {"type":"move","dx":1.5,"dy":0}, {"type":"button","button":"left","value":2}, {"type":"release","extra":1}):
            with self.assertRaises(ValueError):
                validate_event(event)
        for value in ("192.168.3.4", "10.0.0.2", "172.16.3.1", "127.0.0.1"):
            self.assertTrue(local_address(value))
        for value in ("8.8.8.8", "100.64.0.1", "172.32.0.1", "::1", "bad"):
            self.assertFalse(local_address(value))


class InputTests(unittest.TestCase):
    def make_input(self):
        device = UInput.__new__(UInput)
        device.keyboard, device.mouse = 10, 11
        device.fds, device.held = [10,11], set()
        device.ioctl = lambda *args: None
        return device

    def test_event_binary_layout_and_release_of_all_held_inputs(self):
        device = self.make_input()
        writes = []
        with patch.object(remote_input.os, "write", side_effect=lambda fd,data: writes.append((fd,data)) or len(data)):
            device.apply({"type":"key","code":"KeyW","value":1})
            device.apply({"type":"button","button":"left","value":1})
            self.assertEqual(device.held, {(10,17),(11,272)})
            device.release()
        self.assertFalse(device.held)
        self.assertEqual(struct.unpack("=qqHHi", writes[0][1]), (0,0,1,17,1))
        self.assertTrue(all(len(data) == 24 for _,data in writes))
        self.assertIn((0,0,1,17,0), [struct.unpack("=qqHHi", data) for _,data in writes])
        self.assertIn((0,0,1,272,0), [struct.unpack("=qqHHi", data) for _,data in writes])

    def test_repeat_ignores_released_keys_and_text_releases_modifiers(self):
        device = self.make_input()
        writes = []
        with patch.object(remote_input.os,"write", side_effect=lambda fd,data: writes.append(struct.unpack("=qqHHi",data)) or len(data)):
            device.apply({"type":"key","code":"KeyA","value":2})
            self.assertFalse(writes)
            device.apply({"type":"key","code":"ControlLeft","value":1})
            device.text("A!a")
        self.assertFalse(device.held)
        self.assertIn((0,0,1,29,0), writes)
        self.assertEqual(sum(item == (0,0,1,42,1) for item in writes), 2)
        self.assertEqual(KEYS["F11"],87)
        self.assertEqual(KEYS["F12"],88)

    def test_virtual_keyboard_and_mouse_are_separate_devices(self):
        ioctl_calls = []
        fcntl = types.SimpleNamespace(ioctl=lambda *args: ioctl_calls.append(args))
        with patch.dict(sys.modules, {"fcntl":fcntl}), patch.object(remote_input.sys,"platform","linux"), patch.object(remote_input.os,"open",side_effect=[10,11]), patch.object(remote_input.os,"close"), patch.object(remote_input.os,"O_NONBLOCK",2048,create=True), patch.object(remote_input.os,"O_CLOEXEC",524288,create=True):
            device = UInput()
            self.assertEqual((device.keyboard,device.mouse),(10,11))
            setups = [args for args in ioctl_calls if args[1] == 0x405C5503]
            self.assertEqual(len(setups),2)
            self.assertEqual(len(setups[0][2]),92)
            self.assertIn((11,0x40045566,8),ioctl_calls)
            device.close()
            self.assertIn((10,0x5502),ioctl_calls)


class HTTPTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.server = RemoteServer(ROOT / "web", FakeInput)
        with patch("remote_server.lan_addresses", return_value=["192.168.1.2"]):
            await self.server.start("127.0.0.1",0)
        self.host = f"127.0.0.1:{self.server.port}"

    async def asyncTearDown(self):
        await self.server.stop()

    async def request(self, path="/", data=None, token="", origin=None, host=None, extra=""):
        reader, writer = await asyncio.open_connection("127.0.0.1",self.server.port)
        body = b"" if data is None else json.dumps(data).encode()
        method = "GET" if data is None else "POST"
        headers = f"{method} {path} HTTP/1.1\r\nHost: {host or self.host}\r\n"
        if data is not None:
            headers += f"Origin: {origin or 'http://' + self.host}\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n"
        if token:
            headers += f"Authorization: Bearer {token}\r\n"
        writer.write((headers + extra + "\r\n").encode()+body)
        await writer.drain()
        response = await reader.read()
        writer.close()
        await writer.wait_closed()
        head, result = response.split(b"\r\n\r\n",1)
        return int(head.split(b" ")[1]), head, result

    async def test_real_http_pair_input_assets_and_unauthenticated_rejection(self):
        for path, text in (("/",b"Decky Remote"),("/client.js",b"/api/pair"),("/style.css",b"#pad")):
            code, head, body = await self.request(path)
            self.assertEqual(code,200)
            self.assertIn(text,body)
            self.assertIn(b"frame-ancestors 'none'",head)
            self.assertNotIn(self.server.pin.encode(),body)
        code,_,_ = await self.request("/api/events", {"events":[{"type":"release"}]})
        self.assertEqual(code,401)
        code,_,body = await self.request("/api/pair", {"pin":self.server.pin})
        self.assertEqual(code,200)
        token = json.loads(body)["token"]
        code,_,_ = await self.request("/api/events", {"events":[{"type":"key","code":"KeyA","value":1}]},token)
        self.assertEqual(code,200)
        self.assertEqual(self.server.input.events[0]["code"],"KeyA")

    async def test_cross_origin_dns_rebinding_duplicate_headers_and_paths(self):
        code,_,_ = await self.request("/api/pair", {"pin":self.server.pin},origin="http://evil.example")
        self.assertEqual(code,403)
        code,_,_ = await self.request(host="evil.example")
        self.assertEqual(code,403)
        code,_,_ = await self.request(extra=f"Host: {self.host}\r\n")
        self.assertEqual(code,400)
        for path in ("/../main.py","/api/status","/favicon.ico"):
            code,_,_ = await self.request(path)
            self.assertEqual(code,404)
        self.assertFalse(self.server.token)

    async def test_stop_closes_idle_connections_and_device_and_restart_is_off(self):
        device = self.server.input
        reader,writer = await asyncio.open_connection("127.0.0.1", self.server.port)
        await asyncio.sleep(0.02)
        await asyncio.wait_for(self.server.stop(), 1)
        self.assertTrue(device.closed)
        self.assertFalse(self.server.status()["enabled"])
        self.assertEqual(await reader.read(),b"")
        writer.close()
        await writer.wait_closed()
        self.assertFalse(self.server.token)

    async def test_input_failure_revokes_session_and_closes_device(self):
        _,_,body = await self.request("/api/pair", {"pin":self.server.pin})
        token = json.loads(body)["token"]
        device = self.server.input
        device.apply = lambda event: (_ for _ in ()).throw(OSError("device gone"))
        code,_,_ = await self.request("/api/events", {"events":[{"type":"release"}]},token)
        self.assertEqual(code,503)
        self.assertFalse(self.server.token)
        self.assertTrue(device.closed)
        self.assertIsNone(self.server.input)

    async def test_busy_port_does_not_leave_input_devices_open(self):
        candidate = RemoteServer(ROOT / "web", FakeInput)
        device = FakeInput()
        candidate.input_factory = lambda: device
        result = await candidate.start("127.0.0.1", self.server.port)
        self.assertFalse(result["enabled"])
        self.assertTrue(device.closed)
        self.assertTrue(result["error"])


if __name__ == "__main__":
    unittest.main()
