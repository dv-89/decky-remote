import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from release_tools import metadata


class ReleaseTests(unittest.TestCase):
    def check(self, version, ref="", lock_version=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "package.json").write_text(json.dumps({"version": version}), encoding="utf-8")
            lock_version = version if lock_version is None else lock_version
            (root / "package-lock.json").write_text(json.dumps({"version": lock_version, "packages": {"": {"version": lock_version}}}), encoding="utf-8")
            return metadata(root, ref)

    def test_preview_and_stable_releases(self):
        self.assertEqual(self.check("0.1.5", "refs/tags/v0.1.5"), {"version": "0.1.5", "tag": "v0.1.5", "prerelease": "true"})
        self.assertEqual(self.check("1.0.0")["prerelease"], "false")
        self.assertEqual(self.check("1.0.0-beta.1")["prerelease"], "true")

    def test_wrong_tag_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "tag must match"):
            self.check("0.1.5", "refs/tags/v0.1.4")

    def test_stale_lock_version_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "versions must match"):
            self.check("0.1.5", lock_version="0.1.4")

    def test_unsafe_or_invalid_version_is_rejected(self):
        for value in ("0.1.5\ntag=other", "../../other", "0.1", "01.2.3", "0.1.5;echo bad", None):
            with self.assertRaises(ValueError):
                self.check(value)
