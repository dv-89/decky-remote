"""Build an installable Decky archive from an explicit source allowlist."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
files = ["main.py", "plugin.json", "package.json", "package-lock.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "rollup.config.js", "tsconfig.json", "dist/index.js", "dist/index.js.map", "scripts/package.py", "scripts/preview.py", "docs/TESTING.md", "docs/laptop-controller.png", "docs/mobile-controller.png", "docs/file-browser.png"]
files += [path.relative_to(root).as_posix() for folder in ("src", "web", "py_modules", "third_party") for path in sorted((root / folder).rglob("*")) if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc"]
for name in files:
    if not (root / name).is_file():
        raise SystemExit(f"Missing {name}; finish the build before packaging")
output = root / "release"
output.mkdir(exist_ok=True)
archive = output / f"decky-remote-{version}.zip"
with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as bundle:
    for name in files:
        bundle.write(root / name, f"decky-remote/{name}")
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(".zip.sha256").write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
print(f"Created {archive.name} ({archive.stat().st_size:,} bytes), SHA-256 {digest}")
