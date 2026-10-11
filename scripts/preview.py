"""Laptop-only browser demo. Input is simulated and never reaches the OS."""
import asyncio
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "py_modules"))
from remote_server import RemoteServer


class PreviewInput:
    def apply(self, event):
        pass

    def text(self, value):
        pass

    def release(self):
        pass

    def close(self):
        pass


async def main():
    server = RemoteServer(root / "web", PreviewInput)
    await server.start("127.0.0.1", 8766)
    if not server.server:
        raise RuntimeError(server.error)
    server.pin = "12345678"
    print("Simulated input demo: http://127.0.0.1:8766  Pairing code: 12345678", flush=True)
    print("No real keyboard or mouse events are emitted. Ctrl+C stops the demo.", flush=True)
    try:
        await asyncio.Event().wait()
    finally:
        await server.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
