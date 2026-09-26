"""Compile installed scripts and verify adjacent labels without executing actions."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runtime" / "python"))
from easycon.native.engine import EasyConScriptEngine
from easycon.native.image_labels import load_image_labels
from script_host import normalize_preview_aliases

root = Path(sys.argv[1])
required = set()
for script in root.rglob("*.txt"):
    program = EasyConScriptEngine().compile(normalize_preview_aliases(script.read_text(encoding="utf-8-sig")), source=script.name, script_dir=script.parent)
    labels = load_image_labels([script.parent]) if program.external_labels else None
    for name in program.external_labels:
        if name not in labels.labels:
            raise RuntimeError(f"{script.name}: missing adjacent label {name}")
        required.add(script.parent / "ImgLabel" / (name + ".IL"))
actual = set(root.rglob("*.IL"))
if actual != required and '--allow-unused' not in sys.argv:
    raise RuntimeError(f"Unreferenced or misplaced labels: {actual.symmetric_difference(required)}")
print(f"Verified {len(required)} referenced labels with the runtime compiler and image decoder.")
