import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "py_modules"))
from file_share import CHUNK, MAX_FILE, FileShare, TransferError, filename
from remote_server import RemoteServer
from test_remote import FakeInput


@unittest.skipUnless(sys.platform == "linux", "Production filesystem operations require Linux")
class FileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = 10
        self.files = FileShare(self.temp.name, clock=lambda: self.now)
        self.folder = Path(self.temp.name) / "Downloads" / "Decky Remote"

    def tearDown(self):
        self.files.reset()
        self.temp.cleanup()

    def saved(self, name, payload=b"hello"):
        upload = self.files.begin({"name": name, "size": len(payload)})
        for offset in range(0, len(payload), CHUNK):
            self.files.append(upload["id"], offset, payload[offset:offset + CHUNK])
        return self.files.finish({"id": upload["id"]})

    def test_chunked_unicode_roundtrip_hash_and_duplicate_preservation(self):
        payload = bytes(range(256)) * 2000
        saved = self.saved("résumé 文件.txt", payload)
        self.assertEqual(saved["sha256"], hashlib.sha256(payload).hexdigest())
        self.assertEqual((self.folder / saved["name"]).read_bytes(), payload)
        duplicate = self.saved(saved["name"], b"second")
        self.assertEqual(duplicate["name"], "résumé 文件 (2).txt")
        self.assertEqual((self.folder / saved["name"]).read_bytes(), payload)
        grant = self.files.grant({"name": saved["name"]}, "secret", "127.0.0.1")
        fd, name, length = self.files.download(grant["url"].split("/")[-1], "secret", "127.0.0.1")
        try:
            self.assertEqual(os.read(fd, length), payload)
            self.assertEqual(name, saved["name"])
        finally:
            os.close(fd)
        self.assertFalse(list(self.folder.glob(".*.part")))
        self.assertEqual((self.folder / name).stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.folder.stat().st_mode & 0o777, 0o700)

    def test_empty_file_and_long_duplicate_filename(self):
        name = "文" * 60 + ".txt"
        self.saved(name, b"")
        result = self.saved(name, b"")
        self.assertLessEqual(len(result["name"].encode()), 200)
        self.assertEqual((self.folder / result["name"]).read_bytes(), b"")

    def test_reject_paths_hidden_controls_invalid_unicode_and_sizes(self):
        for name in ("", ".hidden", "..", "../outside", "/tmp/test", "C:\\test", "x:y", "a\n", "a\0", "a\x7f", "a" * 201, "\ud800", None):
            with self.subTest(name=repr(name)), self.assertRaises(TransferError):
                filename(name)
        for value in (True, -1, MAX_FILE + 1, 1.5, "1"):
            with self.assertRaises(TransferError):
                self.files.begin({"name": "a", "size": value})
        self.assertFalse(self.folder.exists())

    def test_offsets_incomplete_size_and_single_upload(self):
        upload = self.files.begin({"name": "a", "size": 4})
        for identifier, offset, data in (("wrong", 0, b"a"), (upload["id"], 1, b"a"), (upload["id"], 0, b""), (upload["id"], 0, b"aaaaa")):
            with self.assertRaises(TransferError):
                self.files.append(identifier, offset, data)
        with self.assertRaises(TransferError):
            self.files.begin({"name": "b", "size": 1})
        with self.assertRaises(TransferError):
            self.files.finish({"id": upload["id"]})
        self.files.append(upload["id"], 0, b"abcd")
        with self.assertRaises(TransferError):
            self.files.append(upload["id"], 0, b"abcd")
        self.files.finish({"id": upload["id"]})
        self.assertEqual((self.folder / "a").read_bytes(), b"abcd")

    def test_cancel_idle_expiry_and_reset_keep_completed_files(self):
        self.saved("complete")
        self.files.begin({"name": "cancelled", "size": 5})
        self.files.cancel({})
        self.files.begin({"name": "expired", "size": 5})
        self.now += 31
        self.files.expire()
        self.assertIsNone(self.files.upload)
        self.files.begin({"name": "reset", "size": 5})
        self.files.reset()
        self.assertEqual([item.name for item in self.folder.iterdir()], ["complete"])

    def test_symlink_directories_files_fifo_and_hidden_are_not_shared(self):
        self.files.listing()
        outside = Path(self.temp.name) / "outside"
        outside.write_bytes(b"private")
        (self.folder / "link").symlink_to(outside)
        (self.folder / ".hidden").write_text("hidden")
        (self.folder / "folder").mkdir()
        os.mkfifo(self.folder / "pipe")
        self.assertEqual(self.files.listing()["files"], [])
        for name in ("link", "pipe", "folder", ".hidden"):
            with self.assertRaises(TransferError):
                self.files.grant({"name": name}, "token", "peer")
        saved = self.saved("link")
        self.assertEqual(saved["name"], "link (2)")
        self.assertEqual(outside.read_bytes(), b"private")
        self.files.reset()
        other = Path(self.temp.name) / "other"
        other.mkdir()
        (other / "Downloads").symlink_to(self.folder)
        with self.assertRaises(TransferError):
            FileShare(other).listing()

    def test_unreadable_and_foreign_owned_files_are_not_shared(self):
        self.saved("private")
        (self.folder / "private").chmod(0o200)
        self.assertEqual(self.files.listing()["files"], [])
        with self.assertRaises(TransferError):
            self.files.grant({"name": "private"}, "token", "peer")
        if os.geteuid() == 0:
            self.saved("foreign")
            os.chown(self.folder / "foreign", 12345, 12345)
            self.assertEqual(self.files.listing()["files"], [])
            with self.assertRaises(TransferError):
                self.files.grant({"name": "foreign"}, "token", "peer")

    def test_tickets_bound_one_use_expiring_revoked_and_replaced_file(self):
        self.saved("file")
        def ticket():
            return self.files.grant({"name": "file"}, "token", "peer")["url"].split("/")[-1]
        value = ticket()
        for token, peer in (("wrong", "peer"), ("token", "other"), ("", "peer")):
            with self.assertRaises(TransferError):
                self.files.download(value, token, peer)
        fd, _, _ = self.files.download(value, "token", "peer")
        os.close(fd)
        with self.assertRaises(TransferError):
            self.files.download(value, "token", "peer")
        value = ticket()
        self.now += 31
        with self.assertRaises(TransferError):
            self.files.download(value, "token", "peer")
        value = ticket()
        (self.folder / "file").rename(self.folder / "old")
        (self.folder / "file").write_bytes(b"replacement")
        with self.assertRaises(TransferError) as caught:
            self.files.download(value, "token", "peer")
        self.assertEqual(caught.exception.status, 409)
        value = ticket()
        self.files.reset()
        with self.assertRaises(TransferError):
            self.files.download(value, "token", "peer")

    def test_pending_download_and_listing_limits(self):
        self.saved("file")
        for _ in range(16):
            self.files.grant({"name": "file"}, "token", "peer")
        with self.assertRaises(TransferError) as caught:
            self.files.grant({"name": "file"}, "token", "peer")
        self.assertEqual(caught.exception.status, 429)
        for index in range(501):
            (self.folder / str(index)).touch()
        listing = self.files.listing()
        self.assertEqual(len(listing["files"]), 500)
        self.assertTrue(listing["truncated"])

    def test_short_writes_and_low_space(self):
        with patch("file_share.os.statvfs", return_value=type("Space", (), {"f_bavail": 1, "f_frsize": 4096})()):
            with self.assertRaises(TransferError) as caught:
                self.files.begin({"name": "a", "size": 10})
            self.assertEqual(caught.exception.status, 507)
        original = os.write
        with patch("file_share.os.write", side_effect=lambda fd, data: original(fd, data[:2])):
            self.saved("short", b"1234567")
        self.assertEqual((self.folder / "short").read_bytes(), b"1234567")

    def test_replaced_temporary_does_not_publish_or_delete_replacement(self):
        upload = self.files.begin({"name": "a", "size": 0})
        temporary = self.folder / self.files.upload["temporary"]
        temporary.rename(self.folder / "moved")
        temporary.write_bytes(b"replacement")
        with self.assertRaises(TransferError):
            self.files.finish({"id": upload["id"]})
        self.assertFalse((self.folder / "a").exists())
        self.assertEqual(temporary.read_bytes(), b"replacement")


@unittest.skipUnless(sys.platform == "linux", "Production filesystem operations require Linux")
class FileHTTPTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.files = FileShare(self.temp.name)
        self.server = RemoteServer(ROOT / "web", FakeInput, files=self.files)
        with patch("remote_server.lan_addresses", return_value=[]):
            await self.server.start("127.0.0.1", 0)
        self.host = f"127.0.0.1:{self.server.port}"
        code, _, body = await self.request("/api/pair", {"pin": self.server.pin}, token="")
        self.assertEqual(code, 200)
        self.token = json.loads(body)["token"]

    async def asyncTearDown(self):
        await self.server.stop()
        self.temp.cleanup()

    async def request(self, path, data=None, token=None, extra="", origin=None, declared=None):
        reader, writer = await asyncio.open_connection("127.0.0.1", self.server.port)
        binary = isinstance(data, bytes)
        body = data if binary else json.dumps(data).encode() if data is not None else b""
        headers = f"{'GET' if data is None else 'POST'} {path} HTTP/1.1\r\nHost: {self.host}\r\n"
        if data is not None:
            headers += f"Origin: {origin or 'http://' + self.host}\r\nContent-Type: {'application/octet-stream' if binary else 'application/json'}\r\nContent-Length: {len(body) if declared is None else declared}\r\n"
        credential = getattr(self, "token", "") if token is None else token
        headers += f"Authorization: Bearer {credential}\r\n"
        writer.write((headers + extra + "\r\n").encode() + body)
        await writer.drain()
        response = await asyncio.wait_for(reader.read(), 3)
        writer.close()
        await writer.wait_closed()
        head, result = response.split(b"\r\n\r\n", 1)
        return int(head.split(b" ")[1]), head, result

    async def upload(self, payload=b"hello", name="file.txt"):
        code, _, body = await self.request("/api/files/begin", {"name": name, "size": len(payload)})
        self.assertEqual(code, 200)
        identifier = json.loads(body)["id"]
        for offset in range(0, len(payload), CHUNK):
            code, _, _ = await self.request("/api/files/chunk", payload[offset:offset + CHUNK], extra=f"X-Upload-ID: {identifier}\r\nX-Upload-Offset: {offset}\r\n")
            self.assertEqual(code, 200)
        return await self.request("/api/files/finish", {"id": identifier})

    async def test_real_upload_download_stream_headers_and_one_use(self):
        payload = bytes(range(256)) * 2048
        code, _, _ = await self.upload(payload, "文件.txt")
        self.assertEqual(code, 200)
        code, _, body = await self.request("/api/files/list", {})
        self.assertEqual(json.loads(body)["files"][0]["size"], len(payload))
        code, _, body = await self.request("/api/files/download", {"name": "文件.txt"})
        url = json.loads(body)["url"]
        self.assertNotIn(self.token, url)
        code, head, downloaded = await self.request(url)
        self.assertEqual(code, 200)
        self.assertEqual(downloaded, payload)
        self.assertIn(b"attachment; filename=", head)
        self.assertIn(b"filename*=UTF-8''%E6%96%87%E4%BB%B6.txt", head)
        self.assertIn(b"Cache-Control: no-store", head)
        code, _, _ = await self.request(url)
        self.assertEqual(code, 401)

    async def test_auth_before_body_and_folder_access_origin_and_chunk_limits(self):
        for path, data in (("/api/files/list", {}), ("/api/files/begin", {"name": "a", "size": 1}), ("/api/files/chunk", b"a")):
            code, _, _ = await self.request(path, data, token="wrong", declared=100)
            self.assertEqual(code, 401)
        self.assertFalse((Path(self.temp.name) / "Downloads").exists())
        code, _, _ = await self.request("/api/files/list", {}, origin="http://evil.example")
        self.assertEqual(code, 403)
        code, _, _ = await self.request("/api/files/list", {}, extra="Sec-Fetch-Site: cross-site\r\n")
        self.assertEqual(code, 403)
        code, _, _ = await self.request("/api/files/chunk", b"a", declared=CHUNK + 1)
        self.assertEqual(code, 413)
        code, _, _ = await self.request("/files.js")
        self.assertEqual(code, 200)

    async def test_disconnect_cleans_partial_upload_and_revokes_download(self):
        await self.upload()
        _, _, body = await self.request("/api/files/download", {"name": "file.txt"})
        url = json.loads(body)["url"]
        await self.request("/api/files/begin", {"name": "partial", "size": 10})
        await self.request("/api/disconnect", {})
        code, _, _ = await self.request(url)
        self.assertEqual(code, 401)
        folder = Path(self.temp.name) / "Downloads" / "Decky Remote"
        self.assertEqual([file.name for file in folder.iterdir()], ["file.txt"])

    async def test_file_write_failure_keeps_input_working_and_cleans_partial(self):
        _, _, body = await self.request("/api/files/begin", {"name": "partial", "size": 1})
        identifier = json.loads(body)["id"]
        with patch("file_share.os.write", side_effect=OSError("disk full")):
            code, _, _ = await self.request("/api/files/chunk", b"a", extra=f"X-Upload-ID: {identifier}\r\nX-Upload-Offset: 0\r\n")
        self.assertEqual(code, 507)
        self.assertIsNone(self.files.upload)
        code, _, _ = await self.request("/api/events", {"events": [{"type": "release"}]})
        self.assertEqual(code, 200)
        self.assertIsNotNone(self.server.input)
