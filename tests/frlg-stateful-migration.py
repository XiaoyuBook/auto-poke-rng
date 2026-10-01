"""Regression probes for the Python stateful 24/25/28 migration."""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "runtime/python"), str(ROOT / "runtime/python/frlg_planner")]

from easycon.native.engine import EasyConScriptEngine  # noqa: E402
from automation.easycon118 import (materialize_python_bingo_lib, materialize_python_catalog_libs,
                                    materialize_python_flow_helpers, materialize_python_seed_tables,
                                    materialize_python_stateful_libs)  # noqa: E402
from automation.frlg_egg_reverse_runtime import EggReverseSession  # noqa: E402
from automation.frlg_bingo_runtime import BingoSession  # noqa: E402
from automation.frlg_catalog_runtime import CatalogRuntime  # noqa: E402
from automation.frlg_flow_runtime import EggFlowRuntime, FlowRuntime  # noqa: E402
from automation.seed_table_runtime import SeedTableRuntime  # noqa: E402
from automation.frlg_vote_runtime import CalibrationVoteSession  # noqa: E402


CORPUS = Path("D:/project/auto-poke-rng-scripts/bundles/frlg-automation/files")


class StatefulMigration(unittest.TestCase):
    def test_generation_replaces_both_calculation_libraries_and_keeps_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(CORPUS / "lib", root / "lib")
            snapshot = materialize_python_stateful_libs(root)
            self.assertEqual(set(snapshot["files"]), {"25_校准_投票决策.ecs", "28_反查_孵蛋.ecs"})
            for name in snapshot["files"]:
                text = (root / "lib" / name).read_text(encoding="utf-8")
                self.assertIn("PYTHON_STATEFUL_MIGRATION_V1", text)
                self.assertIn("EXTERN FUNC", text)
                self.assertTrue((root / "lib/python_backup" / name).is_file())
            self.assertTrue((root / "python_vote.json").is_file())
            self.assertTrue((root / "python_egg_reverse.json").is_file())

    def test_vote_state_is_session_local_and_updates_in_python(self):
        first = CalibrationVoteSession()
        first.set_config(2, 5, 0, 1, 0, 2, 1, 2, 5, 4, 3)
        first.vote_candidate(0, 1, 0, 0, 1, 0, 0)
        first.set_frame_window(1, 0, 0)
        first.decide(0, 0, 0)
        second = CalibrationVoteSession()
        self.assertEqual(first.getter("投票取帧最高堆"), 1)
        self.assertEqual(second.getter("投票取帧最高堆"), 0)
        first.remember_truth(1, 0)
        first.remember_truth(1, 0)
        self.assertEqual(first.update_stop(), 1)

    def test_bingo_state_and_rendering_are_session_local_python_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(CORPUS / "lib", root / "lib")
            snapshot = materialize_python_bingo_lib(root)
            self.assertEqual(set(snapshot["files"]), {"24_显示_BINGO.ecs"})
            generated = (root / "lib" / "24_显示_BINGO.ecs").read_text(encoding="utf-8")
            self.assertIn("PYTHON_BINGO_MIGRATION_V1", generated)
            self.assertIn("EXTERN FUNC 记录BINGO命中", generated)
            self.assertTrue((root / "lib/python_backup/24_显示_BINGO.ecs").is_file())
        first_logs: list[str] = []
        first = BingoSession(emit=first_logs.append)
        first.set_context(0, 0, 0, 0, 0, 0, 0, 100, 1, 0, 0, 0, 0, 0)
        first.record_hit()
        second = BingoSession()
        self.assertEqual(first.read_count(), 1)
        self.assertEqual(second.read_count(), 0)
        first.output()
        self.assertTrue(any("【BINGO】" in line for line in first_logs))

    def test_bingo_probe_matches_original_ecs_output(self):
        probe = (
            '设置BINGO上下文(0,0,0,0,0,0,100,200,1,0,0,0,0,0)\n'
            '设置BINGO簇(0,1,0,1)\n'
            '设置BINGOSeed文本("a","b","c","d","e","f","g","h","i")\n'
            '记录BINGO命中()\n输出BINGO()\n'
        )
        engine = EasyConScriptEngine()
        original_output: list[str] = []
        engine.compile(probe, source="<original>", script_dir=CORPUS).run(
            output=original_output.append, waiter=lambda _ms, _cancel: None
        )
        with tempfile.TemporaryDirectory() as directory:
            generated = Path(directory)
            shutil.copytree(CORPUS / "lib", generated / "lib")
            materialize_python_bingo_lib(generated)
            migrated_output: list[str] = []
            engine.compile(probe, source="<migrated>", script_dir=generated).run(
                output=migrated_output.append,
                waiter=lambda _ms, _cancel: None,
                extern_functions=BingoSession(emit=migrated_output.append).extern_functions(),
            )
        self.assertEqual(migrated_output, original_output)

    def test_mixed_flow_helpers_are_the_only_functions_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(CORPUS / "lib", root / "lib")
            snapshot = materialize_python_flow_helpers(root)
            self.assertEqual(set(snapshot["files"]), {
                "15_获取_入口.ecs", "17_获取_野生目标.ecs", "27_孵蛋测试流程.ecs"
            })
            for name in snapshot["files"]:
                text = (root / "lib" / name).read_text(encoding="utf-8")
                self.assertIn("PYTHON_FLOW_MIGRATION_V1", text)
                self.assertIn("EXTERN FUNC", text)
                self.assertTrue((root / "lib/python_backup" / name).is_file())
        runtime = FlowRuntime()
        self.assertEqual(runtime.is_hunting_zone(54), 1)
        self.assertEqual(runtime.is_hunting_zone(53), 0)
        self.assertEqual(runtime.target_supported(999, 101, 0), 1)
        self.assertEqual(runtime.target_supported(999, 999, 0), 0)

    def test_egg_seed_wait_helper_matches_original_ecs(self):
        with tempfile.TemporaryDirectory() as directory:
            generated = Path(directory)
            shutil.copytree(CORPUS / "lib", generated / "lib")
            materialize_python_seed_tables(generated)
            materialize_python_catalog_libs(generated)
            materialize_python_flow_helpers(generated)
            seed = SeedTableRuntime.from_project(generated)
            catalog = CatalogRuntime.from_project(generated)
            target = seed.get_seed_hex(1, 0, 0)
            probe = f'孵蛋测试_查找Seed等待MS("火红","{target}",0,1,0,0,0)\n'
            original_output: list[str] = []
            original_result = EasyConScriptEngine().compile(
                probe, source="<original-egg>", script_dir=CORPUS
            ).run(output=original_output.append, waiter=lambda _ms, _cancel: None)
            migrated_output: list[str] = []
            callbacks = {
                **seed.extern_functions(),
                **catalog.extern_functions(),
                **FlowRuntime().extern_functions(),
                **EggFlowRuntime(seed_runtime=seed, catalog_runtime=catalog,
                                 emit=migrated_output.append).extern_functions(),
            }
            migrated_result = EasyConScriptEngine().compile(
                probe, source="<migrated-egg>", script_dir=generated
            ).run(output=migrated_output.append, waiter=lambda _ms, _cancel: None,
                 extern_functions=callbacks)
            self.assertEqual(migrated_result, original_result)
            self.assertEqual(migrated_output, original_output)

    def test_common_region_keeps_bounded_majority_when_one_round_is_outlier(self):
        session = CalibrationVoteSession()
        session.common_set_strict(1)
        rounds = [
            [(100, 10, 1), (108, 12, 2)],
            [(102, 11, 3), (111, 15, 4)],
            [(99, 9, 5), (110, 14, 6)],
            [(200, 99, 7)],
        ]
        for pairs in rounds:
            session.common_start()
            for pair in pairs:
                session.common_collect_pair(*pair)
            session.common_submit()
        session.common_start()
        session.common_collect_pair(104, 13, 8)
        self.assertEqual(session.common_select(), 0)
        self.assertEqual(session.common_predict_adv(50, 2), 8)
        self.assertEqual(session.common_distance(8, 13, 2, 3), 30)

    def test_egg_reverse_keeps_explicit_parent_observation_and_result_state(self):
        class Data:
            @staticmethod
            def gender_threshold(_species):
                return 127

        session = EggReverseSession(data_runtime=Data())
        self.assertEqual(session.set_parents(*([31] * 12)), 1)
        self.assertEqual(session.set_observation_iv(1, 0, 31, 0, 31, 0, 31, 0, 31, 0, 31, 0, 31), 1)
        # A zero-width scan still exercises the Python RNG/validation path.
        result = session.execute(0, 0x1234, 0x1234, 0, 0, 0, 0, 0, 0, 11, 20, 5)
        self.assertGreaterEqual(result, 0)
        self.assertEqual(session.total_hits, len(session.results) if result <= 5 else result)
        self.assertEqual(session.result_value(-1, "held"), -1)


if __name__ == "__main__":
    unittest.main()
