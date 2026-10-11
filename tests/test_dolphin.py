import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "py_modules"))
from dolphin import launch_info


class DolphinTests(unittest.TestCase):
    def test_installed_native_dolphin_uses_user_home_and_xwayland(self):
        with tempfile.TemporaryDirectory() as home:
            with patch("dolphin.DOLPHIN") as executable, patch("dolphin.os.access", return_value=True):
                executable.is_file.return_value = True
                executable.__str__.return_value = "/usr/bin/dolphin"
                info = launch_info(home)
                self.assertEqual(info, {"executable": "/usr/bin/dolphin", "start_dir": home,
                                        "launch_options": "QT_QPA_PLATFORM=xcb %command% --new-window"})

    def test_missing_or_non_executable_dolphin_fails(self):
        with tempfile.TemporaryDirectory() as home:
            for installed, runnable in ((False, True), (True, False)):
                with patch("dolphin.DOLPHIN") as executable, patch("dolphin.os.access", return_value=runnable):
                    executable.is_file.return_value = installed
                    with self.assertRaisesRegex(ValueError, "not found"):
                        launch_info(home)

    def test_missing_or_relative_home_is_rejected(self):
        with patch("dolphin.DOLPHIN") as executable, patch("dolphin.os.access", return_value=True):
            executable.is_file.return_value = True
            for home in ("", "relative", os.path.join(tempfile.gettempdir(), "missing-decky-user-home")):
                with self.assertRaisesRegex(ValueError, "home folder"):
                    launch_info(home)
