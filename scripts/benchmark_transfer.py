"""Compare upload protocols on Linux loopback with simulated request latency.

This measures request overhead, not Wi-Fi throughput or Legion storage speed.
Run: python3 scripts/benchmark_transfer.py [MiB] [request-delay-ms]
"""
import asyncio
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "py_modules"))
from file_share import CHUNK, FileShare
from remote_server import RemoteServer


class DiscardInput:
    def release(self): pass
    def close(self): pass


async def benchmark(size, delay):
    with tempfile.TemporaryDirectory() as home:
        server = RemoteServer(ROOT / "web", DiscardInput, files=FileShare(home))
        await server.start("127.0.0.1", 0)
        host = f"127.0.0.1:{server.port}"
        token = server.dispatch("/api/pair", {"pin": server.pin}, "127.0.0.1", "")["token"]
        piece = bytes(range(256)) * (CHUNK // 256)
        digest = hashlib.sha256()
        for offset in range(0, size, CHUNK): digest.update(piece[:min(CHUNK, size-offset)])

        async def request(path, data=None, identifier=None, offset=None, streaming=False):
            await asyncio.sleep(delay)
            reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
            body = data if isinstance(data, bytes) else json.dumps(data).encode()
            length = size if streaming else len(body)
            binary = streaming or isinstance(data, bytes)
            headers = (f"POST {path} HTTP/1.1\r\nHost: {host}\r\nOrigin: http://{host}\r\n"
                       f"Authorization: Bearer {token}\r\nContent-Length: {length}\r\n"
                       f"Content-Type: {'application/octet-stream' if binary else 'application/json'}\r\n")
            if identifier: headers += f"X-Upload-ID: {identifier}\r\n"
            if offset is not None: headers += f"X-Upload-Offset: {offset}\r\n"
            writer.write((headers+"\r\n").encode())
            if streaming:
                for position in range(0, size, CHUNK):
                    writer.write(piece[:min(CHUNK, size-position)])
                    await writer.drain()
            else: writer.write(body)
            await writer.drain()
            response = await asyncio.wait_for(reader.read(), 60)
            writer.close(); await writer.wait_closed()
            head, body = response.split(b"\r\n\r\n", 1)
            if not head.startswith(b"HTTP/1.1 200"): raise RuntimeError(body.decode())
            return json.loads(body)

        async def heartbeat():
            while True:
                server.dispatch("/api/heartbeat", {}, "127.0.0.1", "Bearer " + token)
                await asyncio.sleep(1)
        keepalive = asyncio.create_task(heartbeat())
        try:
            for streaming in (False, True):
                started = time.perf_counter()
                name = "stream.bin" if streaming else "chunks.bin"
                upload = await request("/api/files/begin", {"name":name, "size":size})
                if streaming:
                    result = await request("/api/files/upload", identifier=upload["id"], streaming=True)
                    count = 2
                else:
                    for offset in range(0, size, CHUNK):
                        await request("/api/files/chunk", piece[:min(CHUNK,size-offset)], upload["id"], offset)
                    result = await request("/api/files/finish", {"id":upload["id"]})
                    count = (size+CHUNK-1)//CHUNK+2
                seconds = time.perf_counter()-started
                assert result["sha256"] == digest.hexdigest()
                saved = hashlib.sha256()
                with (Path(home)/"Downloads"/"Decky Remote"/name).open("rb") as file:
                    while part := file.read(CHUNK): saved.update(part)
                assert saved.hexdigest() == digest.hexdigest()
                print(f"{'Continuous' if streaming else 'Legacy chunks'}: {size/1024**2:.0f} MiB, "
                      f"{seconds:.3f} s, {size/1024**2/seconds:.1f} MiB/s, {count} requests; SHA-256 verified")
        finally:
            keepalive.cancel()
            await asyncio.gather(keepalive, return_exceptions=True)
            await server.stop()


if __name__ == "__main__":
    size = (int(sys.argv[1]) if len(sys.argv)>1 else 32)*1024**2
    delay = (float(sys.argv[2]) if len(sys.argv)>2 else 20)/1000
    if not 1 <= size/1024**2 <= 256 or not 0 <= delay <= .2:
        raise SystemExit("Use 1–256 MiB and 0–200 ms simulated delay")
    print(f"Linux loopback; {delay*1000:.0f} ms simulated wait per request; temporary files removed afterwards")
    asyncio.run(benchmark(size,delay))
