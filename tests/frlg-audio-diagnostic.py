import sys
from pathlib import Path
import unittest
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

    def point(self, line, duration=None):
        return SimpleNamespace(location=SimpleNamespace(source="lib/17_获取_野生目标.ecs", line=line),
                               duration_ms=duration)

    def test_gate_closes_before_ocr_and_ignores_player_actions(self):
        logs = []
        observer = AudioShinyDiagnostic(self.source(), {"status":"idle"}, None, logs.append)
        with patch("frlg_audio_diagnostic.time.perf_counter_ns", side_effect=[10, 20]):
            observer.observe(self.point(3))  # generic statement trace
            self.assertIsNone(observer.active)
            observer.observe(self.point(3, 10000))
            observer.observe(self.point(3, 10000))  # same WAIT may be observed twice
            self.assertEqual(observer.number, 1)
            observer.observe(self.point(4))
            self.assertIsNone(observer.active)
            observer.observe(self.point(5))
            observer.observe(self.point(6, 50))
        self.assertEqual(len(observer.jobs), 1)
        self.assertEqual(observer.jobs[0][2:4], (10,20))
        observer.close()
        self.assertTrue(any("无法判定" in line and "窗口=1" in line for line in logs))

    def test_unknown_upstream_layout_is_not_guessed(self):
        source = self.source()
        source["lib/17_获取_野生目标.ecs"][2] = "WAIT 11000"
        self.assertEqual(encounter_gates(source), [])
        source = self.source()
        source["lib/17_获取_野生目标.ecs"].insert(4, "$other = 识别抓捕对象名称优先OCR(85)")
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
