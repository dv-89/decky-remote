"""Build and package the portable Windows loopback helper on Windows."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    if sys.platform != "win32":
        raise SystemExit("Build the Windows helper on Windows; use remote_helper.py directly on other systems.")
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    subprocess.run([
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--console",
        "--name", "DeckyRemoteHelper", "--distpath", str(ROOT / "helper-dist"),
        "--workpath", str(ROOT / "helper-build"), "--specpath", str(ROOT / "helper-build"),
        "--add-data", f"{ROOT / 'web'};web", str(ROOT / "laptop" / "remote_helper.py"),
    ], check=True, cwd=ROOT)
    exe = ROOT / "helper-dist" / "DeckyRemoteHelper.exe"
    if exe.read_bytes()[:2] != b"MZ":
        raise SystemExit("The helper output is not a Windows executable.")
    from PyInstaller.archive.readers import CArchiveReader
    embedded = CArchiveReader(str(exe))
    for name in ("client.js", "index.html", "style.css"):
        if embedded.extract("web\\" + name) != (ROOT / "web" / name).read_bytes():
            raise SystemExit("The executable's embedded controller is stale: " + name)
    subprocess.run([str(exe), "--help"], check=True, timeout=30)
    python_license = Path(sys.base_prefix) / "LICENSE.txt"
    if not python_license.is_file():
        raise SystemExit("Cannot locate the bundled Python license.")
    distribution = importlib.metadata.distribution("pyinstaller")
    licenses = [distribution.locate_file(file) for file in distribution.files or [] if file.name in ("COPYING.txt", "LICENSE", "LICENSE.txt")]
    if not licenses:
        raise SystemExit("Cannot locate the PyInstaller license.")
    archive = ROOT / "release" / f"decky-remote-laptop-{version}-windows.zip"
    archive.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path, name in ((exe, "DeckyRemoteHelper.exe"), (ROOT / "laptop" / "README.md", "README.md"), (ROOT / "LICENSE", "LICENSE"), (python_license, "licenses/Python.txt")):
            bundle.write(path, "decky-remote-laptop/" + name)
        for index, license_path in enumerate(licenses):
            bundle.write(license_path, f"decky-remote-laptop/licenses/PyInstaller-{index}.txt")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(".zip.sha256").write_text(f"{digest}  {archive.name}\n", encoding="utf-8", newline="\n")
    with zipfile.ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise SystemExit("Helper archive failed CRC validation.")
    print(f"Created {archive.name} ({archive.stat().st_size:,} bytes), SHA-256 {digest}")


if __name__ == "__main__":
    main()
