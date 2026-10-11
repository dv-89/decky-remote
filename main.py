"""Decky controls opt-in remote input and a local Gaming Mode file browser."""
from pathlib import Path
import asyncio
import decky
from remote_server import RemoteServer
from file_browser import FileBrowser


class Plugin:
    async def _main(self):
        self.remote = RemoteServer(Path(__file__).resolve().parent / "web")
        self.files = FileBrowser(decky.DECKY_USER_HOME)
        self.file_lock = asyncio.Lock()
        decky.logger.info("Decky Remote loaded; LAN input is off")

    async def get_status(self):
        return self.remote.status()

    async def start_remote(self):
        return await self.remote.start()

    async def stop_remote(self):
        return await self.remote.stop()

    async def disconnect_client(self):
        return await self.remote.disconnect()

    async def list_files(self, path="", hidden=False):
        try:
            return {"ok": True, "folder": await asyncio.to_thread(self.files.list, path, hidden)}
        except (OSError, ValueError) as error:
            return {"ok": False, "error": str(error)}

    async def copy_file(self, source, destination):
        async with self.file_lock:
            try:
                result = await asyncio.to_thread(self.files.copy, source, destination)
                return {"ok": True, **result}
            except FileExistsError:
                return {"ok": False, "error": "A file with that name already exists. Nothing was replaced."}
            except (OSError, ValueError) as error:
                return {"ok": False, "error": str(error)}

    async def _unload(self):
        if hasattr(self, "file_lock"):
            async with self.file_lock:
                pass  # Finish an in-progress copy before unloading.
        if hasattr(self, "remote"):
            await self.remote.stop()

    async def _uninstall(self):
        pass
