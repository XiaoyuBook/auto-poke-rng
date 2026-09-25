"""Integration contracts for the new service boundary, without physical devices."""
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import automation_host as host


class AdapterContracts(unittest.TestCase):
    def test_reidentify_windows_match_original_hint_and_noisy_length_rules(self):
        self.assertEqual(host.reidentify_windows(False, 250000, 800000), [(240000, 270000), (0, 800000)])
        self.assertEqual(host.reidentify_windows(True, 250000, 800000), [(240000, 270000), (150000, 250000), (250000, 350000)])
        self.assertEqual(host.reidentify_windows(True, None, 800000), [(0, 100000)])
        self.assertEqual(host.reidentify_windows(False, None, 800000, exit_scene=True), [(0, 1000000)])

    def test_exit_capture_forces_noisy_and_preserves_original_seed(self):
        import blink_core
        seed = host.SeedState32(1, 2, 3, 4)
        previous = host.AutoRngSeedResult(seed, expected_advances_hint=800000)
        session = host.Session({'blink': {'noisy': False, 'seed': ['1','2','3','4'], 'npc': 2,
            'sourceWidth': 2, 'sourceHeight': 2, 'threshold': .9, 'eye': '', 'roi': {}},
            'parameters': {'max_advances': 800000}, 'video': {'sharedMemory': 'fake'}}, lambda **_: None)
        frames = SimpleNamespace(read=lambda **_: SimpleNamespace(timestamp_ns=10000000000, width=2, height=2, bgr=bytes(12)))
        detector = SimpleNamespace(feed=lambda *_: None, intervals=list(range(20)), blinks=[0]*20, offset=10, done=True)
        rng = SimpleNamespace(advance=lambda _: None, get_state=lambda: [5,6,7,8])
        module = SimpleNamespace(Frames=lambda _: SimpleNamespace(__enter__=lambda _: frames))
        class FrameContext:
            def __init__(self, *_): pass
            def __enter__(self): return frames
            def __exit__(self, *_): pass
        with patch.dict(sys.modules, {'frames': SimpleNamespace(Frames=FrameContext)}), \
             patch.object(blink_core, 'BlinkDetector', return_value=detector) as capture, \
             patch.object(blink_core, 'decode_eye'), patch.object(blink_core, 'match_eye', return_value=(.8, {}, None)), \
             patch.object(blink_core, 'recover', return_value=(rng, {'matchedAdvance': 100})) as recover, \
             patch.object(host.time, 'perf_counter', return_value=11):
            result = session.capture(previous, exit_scene=True)
        self.assertEqual(capture.call_args.args[2], 20)
        self.assertTrue(recover.call_args.args[0]['noisy'])
        self.assertEqual(result.current_advances, 103)
        self.assertIs(result.seed, seed)
        self.assertEqual(result.advance_mode, 'timeline')

    def test_capture_entry_allows_empty_seed_script(self):
        session = host.Session({'kind': 'tid', 'scriptRoot': '.', 'parameters': {'start': 'capture'},
            'scripts': {'name': {'path': 'name.rng', 'text': 'A 1'}}}, lambda **_: None)
        runner = SimpleNamespace(run=lambda **_: SimpleNamespace(phase=SimpleNamespace(value='已完成'), log_message='done'))
        with patch.object(host, 'AutoTidRngRunner', return_value=runner) as factory:
            session.run()
        self.assertIsNone(factory.call_args.args[0].seed_script_path)

    def test_reverse_reads_notes_then_turns_and_retries_stats(self):
        events, expansions = [], []
        session = host.Session({}, lambda **value: events.append(value))
        session.runner = SimpleNamespace(config=SimpleNamespace(reverse_script_path=host.ScriptSnapshot('reverse.rng', 'A 1'), fixed_delay=999))
        session.run_script = lambda text, name: events.append(name)
        session.sleep = lambda _: None
        session.frame = lambda: None
        def ocr(_image, operation, **options):
            events.append(operation)
            if operation == 'notes': return {'nature': '认真', 'characteristic': None}
            expansions.append(options['expansion'])
            return {'stats': dict(zip(['HP','攻击','防御','特攻','特防','速度'], [1,2,3,4,5,6])) if options['expansion'] == 2 else {}}
        session.ocr = ocr
        session.search = lambda *_args, **_: [SimpleNamespace(advances=151, stats=[1,2,3,4,5,6])]
        result = session.reverse(None, SimpleNamespace(raw_target_advances=150, used_delay=1442))
        self.assertEqual(events[:4], ['reverse.rng', 'notes', '反查翻页', 'stats'])
        self.assertEqual(expansions, [0,1,2])
        self.assertEqual(result, [1443])


if __name__ == '__main__':
    unittest.main()
