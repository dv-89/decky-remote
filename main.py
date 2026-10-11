"""Decky controls opt-in remote input and launches the system Dolphin via Steam."""
from pathlib import Path
import decky
from remote_server import RemoteServer
from dolphin import launch_info


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

    async def get_dolphin_launch_info(self):
        try:
            return {"ok": True, **launch_info(decky.DECKY_USER_HOME)}
        except (OSError, ValueError) as error:
            return {"ok": False, "error": str(error)}

    async def _unload(self):
        if hasattr(self, "remote"):
            await self.remote.stop()

    async def _uninstall(self):
        pass
