"""Download and verify the selected PP-OCRv6 small model assets."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import tempfile
from urllib.request import Request, urlopen


def digest(path: Path) -> tuple[int, str]:
    sha = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(chunk)
            sha.update(chunk)
    return size, sha.hexdigest()


def ensure(entry: dict, root: Path) -> None:
    target = root / entry["file"]
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file():
        size, sha = digest(target)
        if size == entry["bytes"] and sha == entry["sha256"]:
            print(f"OCR model OK: {target.name}", flush=True)
            return
        target.unlink()
    print(f"Downloading OCR model: {target.name}", flush=True)
    with tempfile.NamedTemporaryFile(prefix=target.name + ".", dir=root, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            request = Request(entry["url"], headers={"User-Agent": "auto-poke-rng/ocr-setup"})
            with urlopen(request, timeout=120) as response:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    stream.write(chunk)
            stream.close()
            size, sha = digest(temporary)
            if size != entry["bytes"] or sha != entry["sha256"]:
                raise RuntimeError(f"校验失败: {target.name} ({size} bytes, {sha})")
            temporary.replace(target)
        finally:
            if temporary.exists():
                temporary.unlink()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    manifest = json.loads((project / "docs" / "ocr-model-selection.json").read_text(encoding="utf-8"))
    entries = [*manifest["models"], manifest["adapterInitializationDependency"]]
    args.root.resolve().mkdir(parents=True, exist_ok=True)
    for entry in entries:
        ensure(entry, args.root.resolve())


if __name__ == "__main__":
    main()
