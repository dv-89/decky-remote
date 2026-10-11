"""Validate metadata and the freshly built ZIP before an automated release."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import zipfile


def metadata(root, ref=""):
    version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
    if not isinstance(version, str) or not re.fullmatch(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?", version):
        raise ValueError("Use a version such as 0.1.5 or 0.1.5-beta.1 in package.json.")
    lock = json.loads((root / "package-lock.json").read_text(encoding="utf-8"))
    if lock["version"] != version or lock["packages"][""]["version"] != version:
        raise ValueError("package.json and package-lock.json versions must match.")
    tag = "v" + version
    if ref.startswith("refs/tags/") and ref != "refs/tags/" + tag:
        raise ValueError("Release tag must match package.json: " + tag)
    return {"version": version, "tag": tag, "prerelease": str(version.startswith("0.") or "-" in version).lower()}


def verify(root):
    version = metadata(root)["version"]
    archive = root / "release" / f"decky-remote-{version}.zip"
    checksum = archive.with_suffix(".zip.sha256").read_text(encoding="utf-8").split()
    if checksum != [hashlib.sha256(archive.read_bytes()).hexdigest(), archive.name]:
        raise ValueError("Archive checksum or checksum filename does not match.")
    with zipfile.ZipFile(archive) as bundle:
        names = bundle.namelist()
        if bundle.testzip() is not None or len(names) != len(set(names)):
            raise ValueError("Archive contains corruption or duplicate paths.")
        if not all(name.startswith("decky-remote/") and ".." not in name.split("/") for name in names):
            raise ValueError("Archive must contain only the decky-remote folder.")
        if [name for name in names if name.endswith("/plugin.json")] != ["decky-remote/plugin.json"]:
            raise ValueError("Decky requires one plugin.json directly inside the plugin folder.")
        if json.loads(bundle.read("decky-remote/package.json"))["version"] != version:
            raise ValueError("Packaged version does not match the release.")
        for name in ("main.py", "plugin.json", "src/index.tsx", "src/dolphin.ts", "py_modules/dolphin.py", "web/client.js", "web/index.html", "dist/index.js"):
            if bundle.read("decky-remote/" + name) != (root / name).read_bytes():
                raise ValueError("Packaged source or built entry point is stale: " + name)
        if any("node_modules" in name.split("/") or "__pycache__" in name.split("/") for name in names):
            raise ValueError("Archive includes dependencies or Python caches.")
    print("Verified", archive.name)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    if sys.argv[1:] == ["metadata"]:
        values = metadata(root, os.environ.get("GITHUB_REF", ""))
        output = "".join(f"{key}={value}\n" for key, value in values.items())
        if os.environ.get("GITHUB_OUTPUT"):
            with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as handle:
                handle.write(output)
        print(output, end="")
    elif sys.argv[1:] == ["verify"]:
        verify(root)
    else:
        raise SystemExit("Usage: python scripts/release_tools.py metadata|verify")
