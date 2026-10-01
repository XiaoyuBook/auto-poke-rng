"""Regression tests for the ECS -> Python Seed-table migration."""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "runtime/python"), str(ROOT / "runtime/python/frlg_planner")]

from automation.easycon118 import materialize_python_seed_tables  # noqa: E402
from easycon.native.engine import EasyConScriptEngine  # noqa: E402
from frlg_planner.automation.seed_table_runtime import (  # noqa: E402
    SeedTableRuntime,
    hex_to_decimal,
)


CORPUS = ROOT / "node_modules/.tmp/frlg-corpus-v2"


def _probe_text() -> str:
    # These are the public functions from lib/00_Seed表_入口.ecs.  The same
    # probe runs against the untouched corpus and the generated Python shims.
    lines = [
        "$max_fr = 取Seed最大索引(1)",
        "$max_lg = 取Seed最大索引(2)",
        "PRINT $max_fr",
        "PRINT $max_lg",
    ]
    cases = (
        (1, 0, 0), (1, 1, 3), (1, 2310, 10),
        (2, 0, 0), (2, 1, 3), (2, 2437, 10),
    )
    counter = 0
    for game, index, mode in cases:
        for function in ("取MS", "取RawTime", "取SeedHEX"):
            counter += 1
            name = f"$v{counter}"
            arguments = f"{game}, {index}" if function != "取SeedHEX" else f"{game}, {index}, {mode}"
            lines.extend((f"{name} = {function}({arguments})", f"PRINT {name}"))
    lines.extend(
        (
            "$invalid_ms = 取MS(1, -1)",
            "$invalid_hex = 取SeedHEX(1, 2311, 0)",
            "$hex = HEX转十进制(\"0x70fe\")",
            "PRINT $invalid_ms",
            "PRINT $invalid_hex",
            "PRINT $hex",
        )
    )
    return "\n".join(lines) + "\n"


class SeedTableMigration(unittest.TestCase):
    def test_hex_conversion_preserves_ecs_sentinels(self):
        self.assertEqual(hex_to_decimal("70FE"), 0x70FE)
        self.assertEqual(hex_to_decimal("0x70fe"), 0x70FE)
        self.assertEqual(hex_to_decimal(""), -1)
        self.assertEqual(hex_to_decimal("0x"), -1)
        self.assertEqual(hex_to_decimal("10000"), -1)
        self.assertEqual(hex_to_decimal("7G"), -1)

    def test_generated_python_lookup_matches_untouched_ecs(self):
        if not CORPUS.is_dir():
            self.skipTest(f"缺少审计脚本包: {CORPUS}")
        with tempfile.TemporaryDirectory() as temporary:
            generated = Path(temporary) / "generated"
            shutil.copytree(CORPUS, generated)
            migration = materialize_python_seed_tables(generated)
            self.assertEqual(migration["games"]["fr"]["max_index"], 2310)
            self.assertEqual(migration["games"]["lg"]["max_index"], 2437)

            engine = EasyConScriptEngine()
            probe = _probe_text()
            old = engine.compile(probe, source="<old>", script_dir=CORPUS)
            new = engine.compile(probe, source="<new>", script_dir=generated)
            old_output: list[str] = []
            new_output: list[str] = []
            old.run(output=old_output.append)
            new.run(
                output=new_output.append,
                extern_functions=SeedTableRuntime.from_project(generated).extern_functions(),
            )
            self.assertEqual("".join(old_output).splitlines(), "".join(new_output).splitlines())

            manifest = json.loads((generated / "seed_tables.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["migration_version"], 1)
            self.assertTrue((generated / "lib/seed_backup/00_Seed表_入口.ecs").is_file())
            self.assertIn("EXTERN FUNC 取SeedHEX", (generated / "lib/00_Seed表_入口.ecs").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
