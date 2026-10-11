"""Describe a fixed native app; Steam, not the root plugin, launches it."""
import os
from pathlib import Path

DOLPHIN = Path("/usr/bin/dolphin")


def launch_info(user_home):
    if not DOLPHIN.is_file() or not os.access(DOLPHIN, os.X_OK):
        raise ValueError("The system Dolphin file manager was not found at /usr/bin/dolphin.")
    home = Path(user_home)
    if not home.is_absolute() or not home.is_dir():
        raise ValueError("Cannot find the handheld user's home folder. Restart Decky and try again.")
    return {
        "executable": str(DOLPHIN),
        "start_dir": str(home),
        # XWayland lets Gamescope associate the window with Steam's shortcut.
        # A fresh window keeps Dolphin in the process tracked by Steam.
        "launch_options": "QT_QPA_PLATFORM=xcb %command% --new-window",
    }
