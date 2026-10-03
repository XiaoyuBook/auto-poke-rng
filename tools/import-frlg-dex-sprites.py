"""Bundle missing national dex sprites from the already-audited reference commit."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
commit = json.loads((root / 'src/assets/frlg-targets/manifest.json').read_text())['commit']
destination = root / 'src/assets/frlg-dex'
destination.mkdir(parents=True, exist_ok=True)
files = {}
for species_id in range(1, 387):
    if (root / f'src/assets/frlg-targets/normal/{species_id}.png').exists():
        continue
    source_name = '201-A.png' if species_id == 201 else f'{species_id}.png'
    data = subprocess.check_output(['git', '-C', str(args.source), 'show', f'{commit}:assets/sprites/normal/{source_name}'])
    (destination / f'{species_id}.png').write_bytes(data)
    files[f'{species_id}.png'] = hashlib.sha256(data).hexdigest()
(destination / 'manifest.json').write_text(json.dumps({'source': 'frlg-auto-rng/assets/sprites/normal', 'commit': commit, 'files': files}, indent=2) + '\n')
print(f'Bundled {len(files)} additional sprites at {commit}.')
