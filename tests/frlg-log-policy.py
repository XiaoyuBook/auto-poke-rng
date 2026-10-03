"""Checks for the generated FRLG ECS log policy and BINGO state channel."""

from __future__ import annotations

import sys
import unittest
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime/python"))

import script_host  # noqa: E402

_BINGO_PATH = ROOT / "runtime/python/frlg_planner/automation/frlg_bingo_runtime.py"
_BINGO_SPEC = importlib.util.spec_from_file_location("frlg_bingo_runtime_test", _BINGO_PATH)
assert _BINGO_SPEC and _BINGO_SPEC.loader
_BINGO_MODULE = importlib.util.module_from_spec(_BINGO_SPEC)
sys.modules[_BINGO_SPEC.name] = _BINGO_MODULE
_BINGO_SPEC.loader.exec_module(_BINGO_MODULE)


class FrlgLogPolicy(unittest.TestCase):
    def test_positive_shiny_observation_survives_without_precalibration(self):
        from frlg_round_records import RoundRecorder
        records = []
        recorder = RoundRecorder(records.append)
        recorder.consume("第 3 轮开始\n【出闪检测】\n已识别到闪光个体\n闪光录像：长按CAPTURE保存最近约30秒录像\n")
        observations = [x for x in records if x.get('data', {}).get('shiny')]
        self.assertEqual(observations, [{'number': 3, 'data': {'result': '发现闪光', 'shiny': True}}])
        recorder.consume("遇到非目标闪光：图鉴19，目标25；按配置停止脚本\n")
        self.assertEqual(records[-1]['data'], {'result': '非目标出闪', 'shiny': True, 'observedDex': 19})
        recorder.consume("已在孵化蛋能力页识别到闪光，目标命中并结束反查\n")
        self.assertEqual(records[-1]['data'], {'result': '目标出闪', 'shiny': True})

    def test_detection_headers_thresholds_and_failure_logs_do_not_invent_a_shiny(self):
        from frlg_round_records import RoundRecorder
        records = []
        recorder = RoundRecorder(records.append)
        for line in ('【出闪检测】', '闪光匹配度:99', '未找到对应普通/闪光标签，图鉴编号:25',
                     '出闪后继续抓捕', '遇到非目标闪光：图鉴25，目标25；按配置停止脚本'):
            recorder.consume(line)
        self.assertEqual(records, [])

    def test_complete_file_channel_preserves_ocr_and_calibration_before_ui_filter(self):
        events = []
        original_emit = script_host.emit
        try:
            script_host.emit = events.append
            logger = script_host.make_script_log_emitter({'text': '# GUI_ECS_LOG_POLICY_V1 mode=compact', 'diagnostics': True})
            for message in ('OCR原文:HAGNEHITE', '后处理:MAGNEMITE', 'Seed可信度:0，帧数冻结', '已命中目标'):
                logger(message)
            self.assertEqual([x['message'] for x in events if x['event'] == 'script.log'], ['已命中目标'])
            archive = [x for x in events if x['event'] == 'script.diagnostic']
            self.assertEqual(len(archive), 4)
            self.assertEqual(archive[0]['message'], 'OCR原文:HAGNEHITE')
            self.assertTrue(all(x['monotonicNs'] and x['hostTimestamp'] for x in archive))
        finally:
            script_host.emit = original_emit

    def test_outlier_skip_survives_compact_logs_and_records_real_outcome(self):
        events = []
        original_emit = script_host.emit
        try:
            script_host.emit = events.append
            logger = script_host.make_script_log_emitter({"text": "# GUI_ECS_LOG_POLICY_V1 mode=compact"})
            logger("第8轮开始\n")
            logger("本轮结果波动较大，参数保持不变\n")
            logger("第9轮开始\n")
            skip = next(event for event in events if event["event"] == "script.round" and event.get("data", {}).get("result") == "校准跳过")
            self.assertEqual(skip["number"], 8)
            self.assertNotIn("hitSeed", skip["data"])
            self.assertIn("参数保持不变", skip["data"]["note"])
            self.assertTrue(any(event["event"] == "script.log" and "本轮结果波动较大" in event["message"] for event in events))
        finally:
            script_host.emit = original_emit

    def test_round_data_survives_compact_filter_and_ignores_setup_instructions(self):
        events = []
        original_emit = script_host.emit
        try:
            script_host.emit = events.append
            logger = script_host.make_script_log_emitter({"text": "# GUI_ECS_LOG_POLICY_V1 mode=compact"})
            logger("第0轮会按当前流程自动检查并切换快捷登记\n第 1 轮开始\n")
            logger("本轮请求: Seed 1200 ms，F1 10，TV 314，F2 20，菜单 0\n")
            logger("本轮结果: Seed 7422（偏差 -1），消耗帧 25295（偏差 -1）\n")
            logger("下轮请求: Seed 1205 ms，F1 10，TV 314，F2 21，菜单 1\n")
            records = [event for event in events if event["event"] == "script.round"]
            self.assertEqual([record["number"] for record in records], [1, 1, 1, 1])
            self.assertEqual(records[1]["data"]["request"]["seedMs"], 1200)
            self.assertEqual(records[2]["data"]["hitSeed"], "7422")
            self.assertEqual(records[2]["data"]["frameError"], -1)
            self.assertEqual(records[3]["data"]["nextRequest"]["f2"], 21)
        finally:
            script_host.emit = original_emit

    def test_full_mode_and_egg_rounds_keep_distinct_units(self):
        from frlg_round_records import RoundRecorder
        records = []
        recorder = RoundRecorder(records.append)
        recorder.consume("第 2 轮\n命中Seed: ABCD\n与目标Seed差: -2个seed\n误差: 5 ms\n误差: -3 帧\n")
        self.assertEqual(records[-2]["data"], {"seedMsError": 5})
        self.assertEqual(records[-1]["data"], {"frameError": -3})
        recorder.consume("孵蛋同Seed实战第 3 轮\n本轮请求: Seed 400 ms，Held 100，Pickup 200，生成菜单 0，领取菜单 0\n")
        self.assertEqual(records[-1]["number"], 3)
        self.assertEqual(records[-1]["data"]["request"], {"seedMs": 400, "held": 100, "pickup": 200})

    def test_bingo_observation_prediction_and_reset_are_structured(self):
        states = []
        session = _BINGO_MODULE.BingoSession(update=states.append)
        session.output()
        self.assertFalse(states[-1]["observed"])
        session.set_cluster(1, 2, -1, 1)
        self.assertEqual(states[-1]["prediction"], {"seed": 1, "seedRadius": 2, "frame": -1, "frameRadius": 1})
        session.set_context(1, -1, 0, 0, 0, 2, 10, 100, 0, 0, 0, 314, 0, 0)
        session.record_hit()
        self.assertTrue(states[-1]["observed"])
        self.assertEqual(states[-1]["grid"][5][3]["count"], 1)
        session.clear()
        self.assertFalse(states[-1]["observed"])

    def test_structured_bingo_replaces_text_grid(self):
        logs: list[str] = []
        states: list[dict[str, object]] = []
        session = _BINGO_MODULE.BingoSession(emit=logs.append, update=states.append)
        session.output()
        self.assertEqual(logs, [])
        self.assertEqual(len(states[-1]["grid"]), 9)
        self.assertEqual(len(states[-1]["grid"][0]), 9)

    def test_compact_mode_keeps_stage_outcomes_and_machine_records(self):
        self.assertEqual(
            script_host._compact_ecs_line(
                "FRLG_STAGE|BEGIN|main.home_buffer|main.home_buffer|0|labels|!"
            ),
            "阶段开始：main.home_buffer",
        )
        self.assertEqual(
            script_host._compact_ecs_line(
                "FRLG_STAGE|FAIL|main.home_buffer|校准达到上限|!"
            ),
            "阶段失败：main.home_buffer：校准达到上限",
        )
        marker = "PRINT test\n# GUI_ECS_LOG_POLICY_V1 mode=compact\n"
        self.assertEqual(script_host._ecs_log_mode({"text": marker}), "compact")
        self.assertEqual(
            script_host._compact_ecs_line("PRECALIBRATION_UPDATE|V=1|FRAME_PRE=0"),
            "PRECALIBRATION_UPDATE|V=1|FRAME_PRE=0",
        )

    def test_compact_mode_drops_repeated_diagnostics(self):
        for line in (
            "HOME_BUFFER_RECOVERY|NX=1|HOME=0",
            "孵蛋池塘冲浪检测|尝试=3|冲浪=90",
            "设置识别 TEXT 第3次: FAST=90 MID=88 SLOW=71",
            "【BINGO】",
            "TV帧　　－４－３－２－１　０＋１＋２＋３＋４",
            "SIDREV|ATTEMPT_RETRY|MON=1|ATTEMPT=2",
            "共同紧密区|独立轮=4/12|重复集=1|Seed总跨度上限=20ms",
        ):
            self.assertIsNone(script_host._compact_ecs_line(line), line)
        self.assertEqual(
            script_host._compact_ecs_line("已命中目标，脚本停止"),
            "已命中目标，脚本停止",
        )

    def test_emitter_preserves_full_mode_and_filters_compact_mode(self):
        events: list[dict[str, str]] = []
        original_emit = script_host.emit
        try:
            script_host.emit = events.append
            compact = script_host.make_script_log_emitter(
                {"text": "# GUI_ECS_LOG_POLICY_V1 mode=compact"}
            )
            compact("HOME_BUFFER_RECOVERY|NX=1\n已命中目标，脚本停止\n")
            self.assertEqual([item["message"] for item in events], ["已命中目标，脚本停止"])
            compact("【BINGO】\n消耗帧　－４－３－２－１　０＋１＋２＋３＋４\n－４　．　．　．\n")
            self.assertEqual(events, [{"event": "script.log", "message": "已命中目标，脚本停止"}])
            bingo = script_host.make_script_bingo_emitter()
            bingo({"version": 1, "grid": []})
            self.assertEqual(events[-1], {"event": "script.bingo", "state": {"version": 1, "grid": []}})
            events.clear()
            full = script_host.make_script_log_emitter(
                {"text": "# GUI_ECS_LOG_POLICY_V1 mode=full"}
            )
            full("HOME_BUFFER_RECOVERY|NX=1\n")
            self.assertEqual(events[0]["message"], "HOME_BUFFER_RECOVERY|NX=1\n")
        finally:
            script_host.emit = original_emit


if __name__ == "__main__":
    unittest.main()
