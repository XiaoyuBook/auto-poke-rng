"""Run the SAME reference assertions against either implementation.

BDSP_CONTRACT_REFERENCE=1 selects the frozen source. The default selects our
runtime, so an unimplemented migration fails rather than quietly testing old code.
"""
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / 'third_party' / 'bdsp-automation-reference'
SOURCE = REFERENCE / 'src' if os.environ.get('BDSP_CONTRACT_REFERENCE') == '1' else ROOT / 'runtime' / 'python'
sys.path.insert(0, str(SOURCE))


def pytest_configure(config):
    # The independent timeline oracle always uses the already pinned Project_Xs.
    import auto_bdsp_rng.blink_detection.project_xs as oracle
    oracle.PROJECT_XS_SRC = ROOT / 'third_party' / 'Project_Xs' / 'src'


def pytest_report_header(config):
    return f'BDSP contract implementation: {SOURCE}'
