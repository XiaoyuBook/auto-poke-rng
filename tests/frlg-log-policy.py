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
    def test_audio_summary_keeps_actual_verdict_and_primary_score(self):
        # Rounding or the enhanced reference must never turn a negative or an
        # incomplete window into a positive. Missing scores are not zeroes.
        prefix = '【音频判闪·实验】'
        for payload, expected in (
            ('窗口=5；无法判定；score=0.6338；enhanced_score=0.99；threshold=0.85；reason=提前截止，未覆盖计划音频窗口',
             '无法判定；分数 0.6338 / 阈值 0.85；采样提前结束'),
            ('窗口=6；未检出闪光音效；score=0.85；enhanced_score=0.99；threshold=0.85',
             '未检出；分数 0.85 / 阈值 0.85'),
            ('窗口=7；检出闪光音效候选；score=0.92；threshold=0.9',
             '疑似出闪；分数 0.92 / 阈值 0.9'),
            ('窗口=8；无法判定；reason=音频静音或音量过低',
             '无法判定；分数 — / 阈值 0.85；音频静音或音量过低'),
            ('窗口=9；无法判定；检测器异常',
             '无法判定；分数 — / 阈值 0.85；检测器异常'),
            ('参考音效已加载；匹配阈值尚待实机验证；仅观察普通野生遭遇，不参与抓捕或停止决策',
             '已启用；阈值 0.85'),
            ('无法启动检测；继续原有图像判闪流程', '无法启动检测'),
        ):
            with self.subTest(payload=payload):
                self.assertEqual(script_host._compact_ecs_line(prefix + payload), prefix + expected)

    def test_full_audio_report_is_archived_before_ui_summary(self):
        events = []
        original_emit = script_host.emit
        raw = ('【音频判闪·实验】窗口=5；遭遇=甜甜香气；截止=我方入场A前；无法判定；'
               'threshold=0.85；planned_seconds=13；shortfall_seconds=2.944；'
               'start_qpc_ns=25754107661700；end_qpc_ns=25764163227400；'
               'packet_count=1007；score=0.6338；enhanced_score=0.1108；'
               'reason=提前截止，未覆盖计划音频窗口')
        try:
            script_host.emit = events.append
            for mode in ('compact', 'full'):
                events.clear()
                logger = script_host.make_script_log_emitter({
                    'text': '# GUI_ECS_LOG_POLICY_V1 mode=' + mode, 'diagnostics': True})
                logger(raw)
                self.assertEqual([x['message'] for x in events if x['event'] == 'script.diagnostic'], [raw])
                displayed = [x['message'] for x in events if x['event'] == 'script.log']
                self.assertEqual(displayed, [raw] if mode == 'full' else [
                    '【音频判闪·实验】无法判定；分数 0.6338 / 阈值 0.85；采样提前结束'])
                self.assertFalse(any(x['event'] == 'script.round' for x in events))
        finally:
            script_host.emit = original_emit

    def test_short_refinement_logs_preserve_round_progress_and_stop_reason(self):
        events = []
        original_emit = script_host.emit
        prefix = 'FRLG_REFINEMENT|V=1|CANDIDATES=2|POINTS=2|LEVEL=7|CANDIES=2|'
        reason = '升级能力值无法区分剩余落点，等待跨轮证据'
        try:
            script_host.emit = events.append
            logger = script_host.make_script_log_emitter({'text': '# GUI_ECS_LOG_POLICY_V1 mode=compact'})
            logger('第2轮开始')
            logger(prefix + 'NEXT_LEVEL=9|STATUS=refining|REASON=继续升级至有效观测LV9')
            self.assertEqual(events[-1]['message'], '候选细分：2 个，已用 2 颗糖；继续升至 LV9')
            progress = [x['data'] for x in events if x['event'] == 'script.round' and 'data' in x]
            self.assertEqual(progress[-1]['nextObservationLevel'], 9)
            self.assertEqual(progress[-1]['observedLevel'], 7)
            logger(prefix + 'NEXT_LEVEL=0|STATUS=unresolved|REASON=' + reason)
            self.assertEqual(events[-1]['message'], '候选细分：2 个，已用 2 颗糖；升级无法消歧，转下一轮')
            self.assertEqual(events[-2]['data']['note'], reason)
            self.assertEqual(events[-2]['data']['result'], '待消歧')
            self.assertNotIn('hitSeed', events[-2]['data'])
        finally:
            script_host.emit = original_emit

    def test_encounter_scope_summary_survives_compact_without_inventing_a_hit(self):
        events = []
        original_emit = script_host.emit
        try:
            script_host.emit = events.append
            logger = script_host.make_script_log_emitter({'text': '# GUI_ECS_LOG_POLICY_V1 mode=compact', 'diagnostics': True})
            summary = 'OCR地点筛选: 游戏1，地点17，遭遇方式101；候选物种5'
            logger(summary)
            self.assertEqual([x['message'] for x in events if x['event'] == 'script.log'], [summary])
            self.assertFalse(any(x['event'] == 'script.round' for x in events))
        finally:
            script_host.emit = original_emit

    def test_pokedex_confirmation_requires_exact_positive_markers(self):
        from frlg_round_records import RoundRecorder
        records = []
        recorder = RoundRecorder(records.append)
        for line in ('FRLG_TARGET_CONFIRMED|V=2|DEX=25|KIND=TARGET_SHINY',
                     'FRLG_TARGET_CONFIRMED|V=1|DEX=0|KIND=TARGET_SHINY',
                     'FRLG_TARGET_CONFIRMED|V=1|DEX=387|KIND=TARGET_SHINY',
                     '已命中目标', '未命中目标，脚本停止'):
            recorder.consume(line)
        self.assertEqual(records, [])
        recorder.consume('FRLG_TARGET_CONFIRMED|V=1|DEX=25|KIND=TARGET_SHINY')
        self.assertEqual(records[-1]['data'], {'result': '目标出闪', 'shiny': True, 'observedDex': 25})
        recorder.consume('已命中目标，脚本停止')
        self.assertEqual(records[-1]['data'], {'result': '完整命中', 'targetHit': True})

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
            self.assertEqual([item["message"] for item in events if item['event'] == 'script.log'], ["已命中目标，脚本停止"])
            self.assertEqual(events[0], {'event': 'script.round', 'number': 0, 'data': {'result': '完整命中', 'targetHit': True}})
            compact("【BINGO】\n消耗帧　－４－３－２－１　０＋１＋２＋３＋４\n－４　．　．　．\n")
            self.assertEqual([item for item in events if item['event'] == 'script.log'], [{"event": "script.log", "message": "已命中目标，脚本停止"}])
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
