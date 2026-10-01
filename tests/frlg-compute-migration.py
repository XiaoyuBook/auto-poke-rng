"""Parity tests for the pure FRLG ECS -> Python calculation boundary."""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "runtime/python"), str(ROOT / "runtime/python/frlg_planner")]

from automation.easycon118 import (  # noqa: E402
    materialize_python_catalog_libs,
    materialize_python_compute_libs,
    materialize_python_data_libs,
    materialize_python_text_libs,
    materialize_python_wild_data_libs,
)
from easycon.native.engine import EasyConScriptEngine  # noqa: E402
from frlg_planner.automation.frlg_compute_runtime import extern_functions  # noqa: E402
from frlg_planner.automation.frlg_data_runtime import DataRuntime  # noqa: E402
from frlg_planner.automation.frlg_catalog_runtime import CatalogRuntime  # noqa: E402
from frlg_planner.automation.frlg_text_runtime import TextRuntime  # noqa: E402
from frlg_planner.automation.frlg_wild_data_runtime import WildDataRuntime  # noqa: E402


CORPUS_CANDIDATES = (
    ROOT.parent / "auto-poke-rng-scripts/bundles/frlg-automation/files",
    ROOT / "node_modules/.tmp/frlg-corpus-v2",
)
CORPUS = next((path for path in CORPUS_CANDIDATES if path.is_dir()), CORPUS_CANDIDATES[0])


def _probe_text() -> str:
    cases = {
        "RNG下一LO": ("0, 0", "65535, 65535", "1234, 5678"),
        "RNG下一HI": ("0, 0", "65535, 65535", "1234, 5678"),
        "RNG前进N_HI": ("0, 0, -1", "0, 0, 1", "0x1234, 0x5678, 10"),
        "RNG前进N_LO": ("0, 0, -1", "0, 0, 1", "0x1234, 0x5678, 10"),
        "Static_PIDLO": ("0x1234, 0x5678",),
        "Static_PIDHI": ("0x1234, 0x5678",),
        "Static_IV1": ("0x1234, 0x5678",),
        "Static_IV2": ("0x1234, 0x5678",),
        "Static_性格": ("0x1234, 0x5678",),
        "Static_未知图腾形态": ("0x1234, 0x5678",),
        "Static_性别": ("0, 0", "100, 127", "100, 255", "100, 254"),
        "Static_HPIV": ("0xFFFF",),
        "Static_ATKIV": ("0xFFFF", "-1", "-2147483648"),
        "Static_DEFIV": ("0xFFFF", "-1", "-2147483648"),
        "Static_SPEIV": ("0xFFFF",),
        "Static_SPAIV": ("0xFFFF", "-1", "-2147483648"),
        "Static_SPDIV": ("0xFFFF", "-1", "-2147483648"),
        # Signed values exercise EasyCon's arithmetic right shift and INT32
        # wrap, which a Python ``//`` or logical shift would get wrong.
        "取性格倍率": ("0, 0", "1, 0", "1, 1", "24, 4", "24, 0"),
        "计算HP能力值": ("45, 0, 50, 31", "1, 255, 1, 0"),
        "计算非HP能力值": ("45, 0, 50, 31, 1, 0", "1, 255, 1, 0, 24, 4"),
        "计算HP_IV最小": ("45, 0, 50, 100", "45, 0, 50, 101"),
        "计算HP_IV最大": ("45, 0, 50, 100", "45, 0, 50, 101"),
        "计算非HP_IV最小": ("45, 0, 50, 60, 1, 0", "45, 0, 50, 61, 1, 0"),
        "计算非HP_IV最大": ("45, 0, 50, 60, 1, 0", "45, 0, 50, 61, 1, 0"),
        "带符号整除四舍五入": ("5, 2", "4, 2", "-5, 2", "-4, 2"),
        "模周期归一": ("5, 4", "-5, 4", "5, 0"),
        "EWA更新中心": ("10, 20, 500, 1000",),
        "候选MSE评分": ("-2, 3, 4, 5",),
        "累加实际执行修正量": ("2, -5",),
        "帧转60FPS毫秒": ("5", "-5"),
        "帧转120FPS毫秒": ("5", "-5"),
        "计算普通F2帧": ("100, 2, 3, 4, 5",),
        "计算TV帧": ("100, 2, 3, 4, 5, 10",),
        "计算TV模式F2帧": ("100, 2, 3, 4, 5, 10",),
        "奇偶修正后F1帧": ("10, 3", "10, 4"),
        "奇偶修正后F2帧": ("3", "4"),
    }
    lines: list[str] = []
    counter = 0
    for function, arguments in cases.items():
        for values in arguments:
            counter += 1
            lines.extend((f"$value{counter} = {function}({values})", f"PRINT $value{counter}"))
    return "\n".join(lines) + "\n"


class FrlgComputeMigration(unittest.TestCase):
    def test_generated_python_functions_match_untouched_ecs(self):
        if not CORPUS.is_dir():
            self.skipTest(f"缺少审计脚本包: {CORPUS}")
        with tempfile.TemporaryDirectory() as temporary:
            generated = Path(temporary) / "generated"
            shutil.copytree(CORPUS, generated)
            migration = materialize_python_compute_libs(generated)
            self.assertEqual(migration["migration_version"], 1)
            self.assertTrue((generated / "lib/python_backup/11_计算_RNG基础.ecs").is_file())
            self.assertTrue((generated / "lib/python_backup/14_计算_等待参数.ecs").is_file())
            self.assertIn("EXTERN FUNC RNG下一HI", (generated / "lib/11_计算_RNG基础.ecs").read_text(encoding="utf-8"))
            self.assertEqual(json.loads((generated / "python_compute.json").read_text(encoding="utf-8"))["migration_version"], 1)

            engine = EasyConScriptEngine()
            probe = _probe_text()
            old = engine.compile(probe, source="<old>", script_dir=CORPUS)
            new = engine.compile(probe, source="<new>", script_dir=generated)
            old_output: list[str] = []
            new_output: list[str] = []
            old.run(output=old_output.append)
            new.run(output=new_output.append, extern_functions=extern_functions())
            self.assertEqual("".join(old_output).splitlines(), "".join(new_output).splitlines())

    def test_generated_lookup_data_matches_untouched_ecs(self):
        if not CORPUS.is_dir():
            self.skipTest(f"缺少审计脚本包: {CORPUS}")
        probe_lines: list[str] = []
        counter = 0

        def probe(function: str, arguments: str) -> None:
            nonlocal counter
            counter += 1
            probe_lines.extend((f"$value{counter} = {function}({arguments})", f"PRINT $value{counter}"))

        for species in (1, 29, 32, 386, 999):
            for game in (1, 2, 0):
                probe("目标名称", f"{game}, {species}")
                probe("目标中文名称", f"{game}, {species}")
            probe("目标英文名称", str(species))
            probe("取性别阈值", str(species))
            for function in ("取种族HP", "取种族ATK", "取种族DEF", "取种族SPA", "取种族SPD", "取种族SPE"):
                for game in (1, 2, 0):
                    probe(function, f"{game}, {species}")
        for value in ("BULBASAUR", "DEOXYS", "NOPE"):
            probe("英文名称查图鉴编号", repr(value))
        for value in ("妙蛙种子", "Bulbasaur", "bulbasaur", "nidoran-f", "Porygon", "NOPE"):
            probe("目标宝可梦名称查图鉴编号", repr(value))

        with tempfile.TemporaryDirectory() as temporary:
            generated = Path(temporary) / "generated"
            shutil.copytree(CORPUS, generated)
            migration = materialize_python_data_libs(generated)
            self.assertEqual(migration["counts"]["species"], 152)
            self.assertTrue((generated / "lib/python_backup/04_数据_宝可梦名称.ecs").is_file())
            self.assertIn("EXTERN FUNC 取种族HP", (generated / "lib/05_数据_宝可梦种族值.ecs").read_text(encoding="utf-8"))

            engine = EasyConScriptEngine()
            probe_text = "\n".join(probe_lines) + "\n"
            old = engine.compile(probe_text, source="<old-data>", script_dir=CORPUS)
            new = engine.compile(probe_text, source="<new-data>", script_dir=generated)
            old_output: list[str] = []
            new_output: list[str] = []
            old.run(output=old_output.append)
            new.run(output=new_output.append, extern_functions=DataRuntime.from_project(generated).extern_functions())
            self.assertEqual("".join(old_output).splitlines(), "".join(new_output).splitlines())

    def test_catalog_text_and_wild_data_match_untouched_ecs(self):
        if not CORPUS.is_dir():
            self.skipTest(f"缺少审计脚本包: {CORPUS}")
        probe_lines: list[str] = []
        counter = 0

        def probe(function: str, arguments: str) -> None:
            nonlocal counter
            counter += 1
            probe_lines.extend((f"$value{counter} = {function}({arguments})", f"PRINT $value{counter}"))

        for function, values in {
            "性别文本": (-1, 0, 1, 2, 3),
            "性格文本": (-1, 0, 24, 25),
            "反查算法文本": (-1, 1, 2, 4, 101, 102, 104, 199, 200),
            "雌性比例文本": (-1, 0, 31, 63, 127, 191, 254, 255, 256),
        }.items():
            for value in values:
                probe(function, str(value))
        for game, species, method, location in ((1, 35, 4, 0), (2, 127, 4, 0), (1, 101, 101, 19), (2, 25, 101, 70), (0, 999, 999, 999)):
            for function in ("目标是否支持", "目标默认等级", "目标最低等级", "目标最高等级", "目标出现率", "目标默认计算方法"):
                probe(function, f"{game}, {species}, {method}, {location}")
        for method in (101, 102, 103, 201, 202, 203, 999):
            for value in (-1, 0, 19, 20, 39, 40, 59, 60, 69, 70, 79, 80, 89, 90, 94, 95, 97, 98, 99, 100, 65535):
                probe("野生遇敌槽编号", f"{method}, {value}")
        probe_text = "\n".join(probe_lines) + "\n"

        with tempfile.TemporaryDirectory() as temporary:
            generated = Path(temporary) / "generated"
            shutil.copytree(CORPUS, generated)
            for materialize in (materialize_python_catalog_libs, materialize_python_text_libs, materialize_python_wild_data_libs):
                materialize(generated)
            engine = EasyConScriptEngine()
            old = engine.compile(probe_text, source="<old-catalog>", script_dir=CORPUS)
            new = engine.compile(probe_text, source="<new-catalog>", script_dir=generated)
            old_output: list[str] = []
            new_output: list[str] = []
            old.run(output=old_output.append)
            callbacks = {}
            callbacks.update(CatalogRuntime.from_project(generated).extern_functions())
            callbacks.update(TextRuntime.from_project(generated).extern_functions())
            callbacks.update(WildDataRuntime.from_project(generated).extern_functions())
            new.run(output=new_output.append, extern_functions=callbacks)
            self.assertEqual("".join(old_output).splitlines(), "".join(new_output).splitlines())


if __name__ == "__main__":
    unittest.main()
