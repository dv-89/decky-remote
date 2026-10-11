"""Decky controls an opt-in local keyboard/mouse server."""
from pathlib import Path
import decky
from remote_server import RemoteServer


class Plugin:
    async def _main(self):
        self.remote = RemoteServer(Path(__file__).resolve().parent / "web")
        decky.logger.info("Decky Remote loaded; LAN input is off")

    async def get_status(self):
        return self.remote.status()

    async def start_remote(self):
        return await self.remote.start()

    async def stop_remote(self):
        return await self.remote.stop()

    async def disconnect_client(self):
        return await self.remote.disconnect()

    async def _unload(self):
        if hasattr(self, "remote"):
            await self.remote.stop()

    async def _uninstall(self):
        pass
