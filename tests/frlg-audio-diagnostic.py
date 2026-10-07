import sys
from pathlib import Path
import unittest
from threading import Event, Thread
import time
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "runtime/python"), str(ROOT / "runtime/clients")]
from audio import AudioBlock
from frlg_audio_diagnostic import (AudioShinyDiagnostic, encounter_gates, evaluate_window,
                                   load_reference, template_score)
from easycon.native.engine import EasyConScriptEngine


class AudioDiagnosticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference = load_reference(ROOT / "runtime/assets/frlg-audio/shiny-effect-original.wav")
        cls.comparison = load_reference(ROOT / "runtime/assets/frlg-audio/shiny-effect-enhanced.wav")

    def blocks(self, samples, rate=48000, channels=2):
        samples = np.asarray(samples, dtype="<f4").reshape(-1, channels)
        result = []
        for start in range(0, len(samples), rate // 100):
            part = samples[start:start + rate // 100]
            stamp = 1_000_000_000 + start * 1_000_000_000 // rate
            result.append(AudioBlock("one", len(result)+1, stamp, stamp, rate, channels,
                                     len(part), 0, False, False, False, part.tobytes()))
        return result

    def test_reference_recognition_tolerates_gain_and_resampling(self):
        samples, rate = self.reference
        for gain in [0.2, 1]:
            score, _ = template_score(samples * gain, rate, *self.reference)
            self.assertGreater(score, 0.95)
        changed = np.stack([np.interp(np.arange(int(len(samples)*44100/rate))*rate/44100,
                          np.arange(len(samples)), samples[:, i]) for i in range(2)], axis=1)
        self.assertGreater(template_score(changed, 44100, *self.reference)[0], 0.95)
        self.assertLess(template_score(np.random.default_rng(42).normal(0, .05, (rate*2, 2)),
                                       rate, *self.reference)[0], .2)

    def test_post_cutoff_player_shiny_is_excluded(self):
        samples, rate = self.reference
        noise = np.random.default_rng(12).normal(0, .03, (rate*2, 2))
        # The own shiny starts halfway into a packet crossing the closing time.
        cutoff_frames = rate + 240
        noise[cutoff_frames:cutoff_frames+len(samples)] = samples
        end_ns = 1_000_000_000 + cutoff_frames * 1_000_000_000 // rate
        result = evaluate_window(self.blocks(noise), 1_000_000_000, end_ns, self.reference)
        self.assertEqual(result["result"], "not_detected")
        full = evaluate_window(self.blocks(noise), 1_000_000_000, 3_000_000_000, self.reference)
        self.assertEqual(full["result"], "candidate")

    def test_opponent_shiny_scores_and_comparison_are_logged(self):
        samples, rate = self.reference
        noise = np.random.default_rng(3).normal(0, .003, (rate*2, 2))
        noise[rate//2:rate//2+len(samples)] += samples
        result = evaluate_window(self.blocks(noise), 1_000_000_000, 3_000_000_000,
                                 self.reference, comparison=self.comparison)
        self.assertEqual(result["result"], "candidate")
        self.assertIn("enhanced_score", result)

    def test_invalid_audio_is_unknown_instead_of_negative(self):
        samples, rate = self.reference
        samples = np.tile(samples, (3, 1))[:rate*2]
        blocks = self.blocks(samples)
        for flag in ["skipped", "discontinuity", "timestamp_error"]:
            broken = list(blocks)
            broken[30] = replace(broken[30], **{flag: 1})
            self.assertEqual(evaluate_window(broken, 1_000_000_000, 3_000_000_000,
                                            self.reference)["result"], "unknown")
        for selected, ref, failure in [(blocks[30:], self.reference, None),
                                       (blocks[:-30], self.reference, None),
                                       (blocks, None, None),
                                       (blocks, self.reference, "会话已变化"),
                                       (self.blocks(np.zeros((rate*2,2))), self.reference, None)]:
            self.assertEqual(evaluate_window(selected, 1_000_000_000, 3_000_000_000,
                                            ref, failure)["result"], "unknown")

    def source(self):
        return {"lib/17_获取_野生目标.ecs": [
            "FUNC 甜甜香气(): INT", "A", "WAIT 10000",
            "$name = 识别抓捕对象名称优先OCR(85)",
            "$shiny = CheckCaptureShiny(25, 85)", "A", "RETURN 1", "ENDFUNC"]}

    def point(self, line, duration=None, source="lib/17_获取_野生目标.ecs"):
        return SimpleNamespace(location=SimpleNamespace(source=source, line=line),
                               duration_ms=duration)

    def test_gate_survives_nested_ocr_and_closes_before_player_a(self):
        logs = []
        observer = AudioShinyDiagnostic(self.source(), {"status":"idle"}, None, logs.append)
        with patch("frlg_audio_diagnostic.time.perf_counter_ns", side_effect=[1_000_000_000, 11_000_000_000]):
            observer.observe(self.point(3))  # generic statement trace
            self.assertIsNone(observer.active)
            observer.observe(self.point(3, 10000))
            observer.observe(self.point(3, 10000))  # same WAIT may be observed twice
            self.assertEqual(observer.number, 1)
            observer.observe(self.point(4))
            observer.observe(self.point(350, source="lib/20_识图_抓捕对象名称识别.ecs"))
            observer.observe(self.point(5, source="lib/19_OCR文字读取.ecs"))
            observer.observe(self.point(20))  # nested lib17 result-writing function
            self.assertIsNotNone(observer.active)
            observer.observe(self.point(5))
            self.assertIsNotNone(observer.active)
            observer.observe(self.point(6))  # statement trace precedes the actual A request
            self.assertIsNone(observer.active)
            observer.observe(self.point(6, 50))
        self.assertEqual(len(observer.jobs), 1)
        self.assertEqual(observer.jobs[0][2:4], (1_000_000_000, 11_000_000_000))
        self.assertEqual(observer.jobs[0][5:7], ("我方入场A前", 13000))
        observer.close()
        self.assertTrue(any("无法判定" in line and "窗口=1" in line
                            and "planned_seconds=13" in line and "shortfall_seconds=3.000" in line
                            and "截止=我方入场A前" in line and "threshold=0.85" in line for line in logs))

    def test_deadline_expires_off_thread_during_ocr_and_keeps_exact_cutoff(self):
        logs = []
        observer = AudioShinyDiagnostic(self.source(), {}, None, logs.append)
        with patch("frlg_audio_diagnostic.time.perf_counter_ns", return_value=1_000_000_000):
            observer.observe(self.point(3, 10000))
        with patch("frlg_audio_diagnostic.time.perf_counter_ns", return_value=14_800_000_000):
            observer._expire_window()
            self.assertIsNone(observer.active)
            self.assertEqual(observer.jobs[0][2:4], (1_000_000_000, 14_000_000_000))
            observer.observe(self.point(3, 10000))  # paused WAIT resumes after deadline
            self.assertEqual(observer.number, 1)
        observer.observe(self.point(4))
        observer.observe(self.point(6))
        observer.close()
        self.assertTrue(any("截止=时长上限" in line and "window_seconds=13.000" in line for line in logs))

    def test_reader_thread_closes_at_deadline_without_more_script_progress(self):
        clock, wake, reported, logs = [1_000_000_000], Event(), Event(), []
        def read(**kwargs):
            wake.wait(0.01)
            wake.clear()
            return None
        def output(line):
            logs.append(line)
            if "窗口=1" in line:
                reported.set()
        with patch("frlg_audio_diagnostic.time.perf_counter_ns", side_effect=lambda: clock[0]):
            observer = AudioShinyDiagnostic(self.source(), {}, None, output,
                                            reader=SimpleNamespace(read=read))
            try:
                observer.observe(self.point(3, 10000))
                # An OCR call can run for seconds without another source trace.
                clock[0] = 14_800_000_000
                wake.set()
                self.assertTrue(reported.wait(1), "audio worker did not enforce its own deadline")
                self.assertIsNone(observer.active)
                self.assertTrue(any("截止=时长上限" in line and "window_seconds=13.000" in line
                                    for line in logs))
            finally:
                observer.close()

    def test_late_opponent_sound_is_included_but_post_deadline_sound_is_excluded(self):
        samples, rate = self.reference
        noise = np.random.default_rng(9).normal(0, .003, (rate*15, 2))
        # Opponent shiny at 10.5s was outside the old 10s window.
        start = round(rate*10.5)
        noise[start:start+len(samples)] += samples
        blocks = self.blocks(noise)
        old = evaluate_window(blocks, 1_000_000_000, 11_000_000_000, self.reference)
        self.assertEqual(old["result"], "not_detected")
        logs = []
        observer = AudioShinyDiagnostic(self.source(), {}, None, logs.append)
        observer.failure, observer.reference = None, self.reference
        observer._report((1, "甜甜香气", 1_000_000_000, 14_000_000_000,
                          None, "时长上限", 13000, 0), blocks)
        self.assertTrue(any("检出闪光音效候选" in line and "offset_seconds=10.5" in line for line in logs))
        # A shiny sound starting after the 13s boundary is never classified as opponent shiny.
        noise[:] = np.random.default_rng(10).normal(0, .003, noise.shape)
        start = round(rate*13.005)
        noise[start:start+len(samples)] += samples
        result = evaluate_window(self.blocks(noise), 1_000_000_000, 14_000_000_000, self.reference)
        self.assertEqual(result["result"], "not_detected")
        observer.close()

    def test_early_a_negative_is_unknown_but_positive_is_preserved(self):
        rate = self.reference[1]
        noise = np.random.default_rng(15).normal(0, .003, (rate*12, 2))
        job = (1, "甜甜香气", 1_000_000_000, 11_000_000_000,
               None, "我方入场A前", 13000, 0)
        logs = []
        observer = AudioShinyDiagnostic(self.source(), {}, None, logs.append)
        observer.failure, observer.reference = None, self.reference
        observer._report(job, self.blocks(noise))
        self.assertIn("无法判定", logs[-1])
        self.assertIn("提前截止，未覆盖计划音频窗口", logs[-1])
        samples = self.reference[0]
        noise[rate*8:rate*8+len(samples)] += samples
        observer._report(job, self.blocks(noise))
        self.assertIn("检出闪光音效候选", logs[-1])
        observer.close()

    def test_shiny_stop_return_closes_without_waiting_for_deadline(self):
        source = self.source()
        source["lib/17_获取_野生目标.ecs"][5:5] = ["IF $shiny == 1", "    RETURN -1", "ENDIF"]
        observer = AudioShinyDiagnostic(source, {}, None, lambda _: None)
        with patch("frlg_audio_diagnostic.time.perf_counter_ns", side_effect=[1_000_000_000, 11_000_000_000]):
            observer.observe(self.point(3, 10000))
            observer.observe(self.point(4))
            observer.observe(self.point(5))
            observer.observe(self.point(7))
        self.assertIsNone(observer.active)
        self.assertEqual(observer.jobs[0][5], "遭遇函数提前返回")
        observer.close()

    def test_slow_matcher_does_not_block_audio_collection(self):
        analysis_started, release_analysis, collected = Event(), Event(), Event()
        feed = Event()
        block = self.blocks(np.zeros((480, 2)))[0]
        def read_many(**kwargs):
            if feed.wait(.01):
                feed.clear(); collected.set()
                return [block]
            return []
        def report(*args):
            analysis_started.set(); release_analysis.wait(1)
        reader = SimpleNamespace(read=lambda **_: None, read_many=read_many)
        with patch.object(AudioShinyDiagnostic, '_report', side_effect=report):
            observer = AudioShinyDiagnostic(self.source(), {}, None, lambda _: None, reader=reader)
            try:
                with observer.lock:
                    observer.jobs.append((1, '甜甜香气', 1, 2, None, '时长上限', 13000, 0))
                observer.report_wake.set()
                self.assertTrue(analysis_started.wait(1))
                feed.set()
                self.assertTrue(collected.wait(.5), 'template comparison blocked collection')
                with observer.lock:
                    self.assertEqual(observer.blocks[-1], block)
            finally:
                release_analysis.set(); observer.close()
            self.assertFalse(observer.thread.is_alive())
            self.assertFalse(observer.report_thread.is_alive())

    def test_shiny_stop_drains_tail_during_grace_without_moving_cutoff(self):
        samples, rate = self.reference
        audio = np.zeros((rate*2, 2), dtype=np.float32)
        audio[rate:rate+len(samples)] = samples
        blocks = self.blocks(audio)
        ready, tail = Event(), Event()
        calls = [0]
        def read_many(**kwargs):
            calls[0] += 1
            if calls[0] == 1:
                ready.set(); return blocks[:-10]
            if tail.wait(.01):
                tail.clear(); return blocks[-10:]
            return []
        logs = []
        observer = AudioShinyDiagnostic(self.source(), {}, None, logs.append,
            reader=SimpleNamespace(read=lambda **_: None, read_many=read_many))
        observer.reference = self.reference
        self.assertTrue(ready.wait(1))
        with observer.lock:
            observer.jobs.append((1, '甜甜香气', 1_000_000_000, 3_000_000_000,
                                  None, '遭遇函数提前返回', 2000, time.monotonic()+.25))
        closing = Thread(target=observer.close)
        closing.start()
        self.assertTrue(observer.closing.wait(1))
        tail.set(); closing.join(2)
        self.assertFalse(closing.is_alive())
        self.assertTrue(any('检出闪光音效候选' in line and 'end_qpc_ns=3000000000' in line
                            and 'tail_gap_seconds=0.000' in line for line in logs), logs)

    def test_unknown_upstream_layout_is_not_guessed(self):
        source = self.source()
        source["lib/17_获取_野生目标.ecs"][2] = "WAIT 11000"
        self.assertEqual(encounter_gates(source), [])
        source = self.source()
        source["lib/17_获取_野生目标.ecs"].insert(4, "$other = 识别抓捕对象名称优先OCR(85)")
        self.assertEqual(encounter_gates(source), [])
        source = self.source()
        source["lib/17_获取_野生目标.ecs"][5] = "CALL 继续战斗()"
        self.assertEqual(encounter_gates(source), [])
        source = self.source()
        source["lib/17_获取_野生目标.ecs"].insert(4, "A")
        self.assertEqual(encounter_gates(source), [])

    def test_observation_preserves_interpreter_buttons_and_waits(self):
        source = "lib/17_获取_野生目标.ecs"
        text = '\n'.join([
            'EXTERN FUNC 识别抓捕对象名称优先OCR($threshold: INT): STRING FROM "python:test"',
            'EXTERN FUNC CheckCaptureShiny($dex: INT, $threshold: INT): INT FROM "python:test"',
            *self.source()[source], '$result = 甜甜香气()'])
        program = EasyConScriptEngine().compile(text, source=source)
        results = []
        for enabled in [False, True]:
            observer = AudioShinyDiagnostic({source: text.splitlines()}, {}, None, lambda _: None) if enabled else None
            class Pad:
                elapsed = 0
                events = []
                def __init__(self):
                    self.events = []
                def click_buttons(pad, button, duration, cancel=None):
                    self.assertTrue(observer is None or observer.active is None)
                    pad.events.append((button, duration, pad.elapsed))
                    pad.elapsed += duration
                def wait(pad, duration, cancel=None):
                    pad.elapsed += duration
            pad = Pad()
            with patch("frlg_audio_diagnostic.time.perf_counter_ns", side_effect=lambda: pad.elapsed*1_000_000):
                program.run(gamepad=pad, waiter=pad, trace=observer.observe if observer else None,
                            extern_functions={"识别抓捕对象名称优先OCR": lambda _: "PIKACHU",
                                              "CheckCaptureShiny": lambda *_: 0})
            if observer:
                self.assertEqual(observer.number, 1)
                observer.close()
            results.append((pad.events, pad.elapsed))
        self.assertEqual(*results)


if __name__ == "__main__":
    unittest.main()
