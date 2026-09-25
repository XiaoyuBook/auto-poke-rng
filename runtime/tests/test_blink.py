"""Deterministic Project_Xs contracts: real algorithms, no physical hardware."""
import base64
import contextlib
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from blink_core import BlinkDetector, Xorshift, decode_eye, match_eye, recover, rngtool, seed_payload
import blink_host
import cv2
import numpy as np
from frames import Frame

SEED = [0x12345678, 0x87654321, 0x87654321, 0x12345678]


def player_observation(count=40, npc=0, start=0):
    rng = Xorshift(*SEED)
    rng.advance(start)
    blinks, intervals = [], []
    elapsed, last = 0, 0
    while len(blinks) < count:
        before = rng.get_state()
        rand = rng.next()
        if rand & 0b1110 == 0:
            blinks.append(rand & 1)
            intervals.append(elapsed - last)
            last = elapsed
        rng.advance(npc)
        elapsed += 1
    return blinks, intervals, before, start + (elapsed - 1) * (npc + 1)


def config(mode='recover', **overrides):
    return {'mode': mode, 'npc': 0, 'noisy': False, 'seed': [f'{word:08X}' for word in SEED],
            'searchMin': 0, 'searchMax': 10000, **overrides}


class RecoveryTests(unittest.TestCase):
    def test_player_seed_recovers_exact_pre_last_blink_state(self):
        for npc in (0, 1):
            blinks, intervals, expected, _ = player_observation(npc=npc)
            recovered, payload = recover(config(npc=npc), blinks, intervals)
            self.assertEqual(recovered.get_state(), expected)
            self.assertEqual(payload['pair'], [f'{expected[0]:08X}{expected[1]:08X}', f'{expected[2]:08X}{expected[3]:08X}'])

    def test_reidentify_preserves_nonzero_start_and_original_advance(self):
        blinks, intervals, expected, advance = player_observation(count=7, start=1500)
        recovered, payload = recover(config('reidentify', searchMin=1500, searchMax=10000), blinks, intervals)
        self.assertEqual(recovered.get_state(), expected)
        self.assertEqual(payload['matchedAdvance'], advance)

    def test_noisy_search_converts_end_to_upstream_length(self):
        blinks, intervals, _, _ = player_observation(count=20, start=1500)
        original = rngtool.reidentiy_by_intervals_noisy
        with patch.object(rngtool, 'reidentiy_by_intervals_noisy', wraps=original) as search:
            rng, result = recover(config('reidentify', noisy=True, searchMin=1500, searchMax=4000), blinks, intervals)
        self.assertEqual(search.call_args.kwargs, {'search_min': 1500, 'search_max': 2500})
        self.assertEqual(seed_payload(rng)['words'], result['words'])

    def test_munchlax_recovers_original_state_with_delay_correction(self):
        rng = Xorshift(*SEED)
        # First interval has no previous blink and must be discarded. The
        # original solver compensates the observed intervals by +0.048 seconds.
        intervals = [1.0] + [rngtool.randrange(rng.next(), 100, 370) / 30 - 0.048 for _ in range(63)]
        result, _ = recover(config('munchlax'), [], intervals)
        self.assertEqual(result.get_state(), rng.get_state())

    def test_no_match_and_bad_observation_do_not_return_a_seed(self):
        with self.assertRaisesRegex(ValueError, '未找到'):
            recover(config('reidentify', searchMax=500), [0]*7, [0, 100, 100, 100, 100, 100, 100])
        with self.assertRaisesRegex(ValueError, '40'):
            recover(config(), [], [])

    def test_inconsistent_final_blink_must_not_pass_upstream_39_row_solver(self):
        blinks, intervals, _, _ = player_observation()
        blinks[-1] ^= 1
        with self.assertRaisesRegex(ValueError, '最后'):
            recover(config(), blinks, intervals)

    def test_zero_solution_from_misdetected_single_blinks_is_not_a_valid_seed(self):
        _, intervals, _, _ = player_observation()
        with self.assertRaisesRegex(ValueError, '全零'):
            recover(config(), [0] * 40, intervals)


class DetectorTests(unittest.TestCase):
    def test_double_blink_and_final_wait_survive_identical_frames(self):
        detector = BlinkDetector('recover', .9, 1, 0)
        detector.feed(.5, 1.017)
        detector.feed(1, 1.217)
        detector.feed(.5, 1.367)
        self.assertEqual(detector.blinks, [1])
        self.assertFalse(detector.done)
        detector.feed(.5, 1.75, changed=False)
        self.assertTrue(detector.done)
        self.assertEqual(detector.intervals, [1])

    def test_upstream_threshold_bounds_do_not_count_missing_eye(self):
        for mode, floor in [('recover', .01), ('munchlax', .4)]:
            detector = BlinkDetector(mode, .9, 1, 0)
            for score in (-1, 0, floor, .9, 1):
                detector.feed(score, 2)
            self.assertEqual(detector.intervals, [])
            detector.feed((floor + .9) / 2, 3)
            self.assertEqual(len(detector.intervals), 1)

    def test_real_template_location_and_reject_out_of_bounds_or_blank_eye(self):
        eye = np.random.default_rng(77).integers(0, 256, (12, 16), dtype=np.uint8)
        frame = np.zeros((80, 100, 3), np.uint8)
        frame[27:39, 33:49] = cv2.cvtColor(eye, cv2.COLOR_GRAY2BGR)
        score, location, _ = match_eye(frame, eye, {'x': 25, 'y': 20, 'width': 40, 'height': 30})
        self.assertAlmostEqual(score, 1, places=5)
        self.assertEqual(location, {'x': 33, 'y': 27, 'width': 16, 'height': 12})
        with self.assertRaisesRegex(ValueError, 'ROI'):
            match_eye(frame, eye, {'x': 95, 'y': 70, 'width': 40, 'height': 30})
        _, encoded = cv2.imencode('.png', np.zeros((10, 10), np.uint8))
        with self.assertRaisesRegex(ValueError, '细节'):
            decode_eye(base64.b64encode(encoded).decode())

    def test_shared_frame_capture_to_original_solver(self):
        blinks, intervals, expected, _ = player_observation()
        eye = np.random.default_rng(7).integers(0, 256, (12, 16), dtype=np.uint8)
        noise = np.random.default_rng(8).integers(0, 256, eye.shape, dtype=np.uint8)
        closed_eye = (eye.astype(float) * .55 + noise.astype(float) * .45).astype(np.uint8)
        open_frame = cv2.cvtColor(eye, cv2.COLOR_GRAY2BGR)
        closed_frame = cv2.cvtColor(closed_eye, cv2.COLOR_GRAY2BGR)
        roi = {'x': 0, 'y': 0, 'width': 16, 'height': 12}
        score, _, _ = match_eye(closed_frame, eye, roi)
        self.assertTrue(.01 < score < .9)
        events = []
        timestamp = 2
        for index, blink in enumerate(blinks):
            timestamp += intervals[index] * 1.017 if index else 0
            events.extend([(timestamp, True), (timestamp + .15, False)])
            if blink:
                events.extend([(timestamp + .35, True), (timestamp + .5, False)])
        events.append((timestamp + .8, False))
        output = []
        clock = [0.]
        class ReplayFrames:
            def __init__(self, descriptor):
                self.sequence, self.time, self.closed, self.index = 0, 0., False, 0
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, **_):
                self.time += 1 / 60
                clock[0] = self.time
                while self.index < len(events) and self.time >= events[self.index][0]:
                    self.closed = events[self.index][1]; self.index += 1
                self.sequence += 1
                frame = closed_frame if self.closed else open_frame
                return Frame(self.sequence, int(self.time * 1e9), 16, 12, 48, 0, frame.tobytes())
        _, encoded = cv2.imencode('.png', eye)
        request = {**config(), 'eye': base64.b64encode(encoded).decode(), 'roi': roi, 'sourceWidth': 16, 'sourceHeight': 12, 'threshold': .9, 'video': {'sharedMemory': {}}}
        with patch.object(blink_host, 'Frames', ReplayFrames), patch.object(blink_host, 'emit', side_effect=lambda **value: output.append(value)), patch.object(blink_host, 'track') as track, patch.object(blink_host.time, 'perf_counter', side_effect=lambda: clock[0]):
            blink_host.run(request)
        self.assertEqual(output[-1]['event'], 'result')
        self.assertEqual(output[-1]['result']['rawWords'], [f'{word:08X}' for word in expected])
        current = Xorshift(*expected); current.next()  # round(0.7s) upstream catch-up
        self.assertEqual(output[-1]['result']['words'], [f'{word:08X}' for word in current.get_state()])
        self.assertEqual(output[-1]['result']['blinks'], blinks)
        track.assert_called_once()


if __name__ == '__main__':
    unittest.main()
