"""Extract the audited upstream script corpus from an immutable release archive.

Usage: python tools/import-frlg-release.py ARCHIVE OUTPUT
This is a developer importer, never a runtime dependency or an executable installer.
"""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

ARCHIVE_SHA256 = '8c881854eb22e364897f9a5aa37ce510fe57c746d84349962af6e8b36701aef2'
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime/python/frlg_planner'))
from automation.easycon118 import (
    inspect_script_corpus, inspect_label_corpus, materialize_easycon118_164a_fixes,
    EXPECTED_LABEL_SHA256, EXPECTED_TESSDATA_SHA256, copy_easycon118_extension_labels,
    is_supported_runtime_script_sha256,
    _apply_fishing_shortcut_and_cursor_text, EXPECTED_TEMPLATE_NAMES,
)


def extract(archive, output):
    archive, output = Path(archive), Path(output).resolve()
    with archive.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != ARCHIVE_SHA256:
            raise ValueError('Upstream release archive fingerprint mismatch')
    output.mkdir(parents=True, exist_ok=False)
    prefix = '_internal/local_assets/easycon118/'
    with zipfile.ZipFile(archive) as package:
        for entry in package.infolist():
            if not entry.filename.startswith(prefix) or entry.is_dir():
                continue
            relative = Path(entry.filename[len(prefix):])
            if relative.suffix.lower() not in {'.ecs', '.il', '.traineddata', '.txt'} and relative.as_posix() != 'lib/tenlines_nx_seed_state.json':
                continue
            target = (output / relative).resolve()
            if output not in target.parents:
                raise ValueError('Unsafe archive path')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(package.read(entry))
    copy_easycon118_extension_labels(output / 'ImgLabel')
    labels = inspect_label_corpus(output / 'ImgLabel')
    if labels['sha256'] != EXPECTED_LABEL_SHA256:
        raise ValueError(f'Unexpected label corpus: {labels}')
    # The September release predates shortcut registration. Upstream's importer
    # changes the shared bicycle text before matching the fishing block; apply
    # that exact upstream fishing transform first, while its anchor is intact.
    for name in EXPECTED_TEMPLATE_NAMES:
        entry = output / name
        entry.write_text(_apply_fishing_shortcut_and_cursor_text(entry.read_text(encoding='utf-8')), encoding='utf-8')
    scripts = materialize_easycon118_164a_fixes(output)
    if not is_supported_runtime_script_sha256(scripts['sha256']):
        raise ValueError(f'Unexpected upgraded script corpus: {scripts}')
    for model, expected in EXPECTED_TESSDATA_SHA256.items():
        if hashlib.sha256((output / 'Tessdata' / model).read_bytes()).hexdigest() != expected:
            raise ValueError('Unexpected OCR model: ' + model)
    print(json.dumps({'scripts': scripts, 'labels': labels}, ensure_ascii=False))


if __name__ == '__main__':
    extract(*sys.argv[1:])
