"""Integration contracts for the new service boundary, without physical devices."""
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import automation_host as host


class AdapterContracts(unittest.TestCase):
    def test_early_double_blink_can_finish_before_warmup_discard(self):
        import blink_core
        detector = blink_core.BlinkDetector('recover', .9, 40, 10)
        for timestamp in (10.2, 10.6, 10.95):
            detector.feed(.8, timestamp)
            host.discard_warmup(detector, 10, timestamp)
        self.assertEqual(detector.blinks, [])
        detector.feed(.8, 11.6)
        self.assertEqual(len(detector.blinks), 1)

    def test_stop_uses_tid_diagnostic_stop_api(self):
        session = host.Session({'kind': 'tid'}, lambda **_: None)
        calls = []
        session.runner = SimpleNamespace(stop=lambda reason: calls.append(reason))
        session.receive({'command': 'stop', 'reason': '设备已断开'})
        self.assertEqual(calls, ['设备已断开'])

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

    def test_static_worker_wires_round_delay_and_scripts_through_the_original_runner(self):
        events, requests = [], []
        config = {'kind': 'static', 'species': 492, 'scriptRoot': '.', 'blink': {}, 'parameters': {
            'start': 'capture', 'loop_mode': 'single', 'fixed_delay': 100, 'shiny_threshold_seconds': None,
            'filters': [{'heightMin': 0, 'heightMax': 255, 'weightMin': 0, 'weightMax': 255}]},
            'scripts': {'advance': {'path': 'advance.rng', 'text': '_目标帧数 = 300\nA 10'},
                        'hit': {'path': 'hit.rng', 'text': '_闪帧 = 60\nA 10'}}}
        session = host.Session(config, lambda **event: events.append(event))
        session.capture = lambda: host.AutoRngSeedResult(host.SeedState32(1,2,3,4), measured_at=0)
        def request(method, **params):
            requests.append((method, params))
            if method == 'delay_profile': return {'config': {'baseline_delay': 1442}, 'samples': []}
            if method == 'search': return []
            raise AssertionError(method)
        session.request = request
        session.run()
        self.assertEqual(events[-1]['status'], 'completed')
        self.assertEqual([item['value'] for item in events if item['event']=='delay'], [1442])
        self.assertIn('cycle_no_candidate', [item.get('name') for item in events])
        self.assertEqual([name for name, _ in requests], ['delay_profile', 'search'])

    def test_script_snapshot_supports_original_recording_path_contract(self):
        snapshot = host.ScriptSnapshot('record.rng', 'Capture 5000')
        self.assertTrue(snapshot.exists())
        self.assertEqual(snapshot.read_text(encoding='utf-8'), 'Capture 5000')

    def test_capture_keepalive_is_only_emitted_before_each_tenth_nonfinal_blink(self):
        import blink_core
        import numpy as np
        events, counter = [], [0]
        class FrameContext:
            def __init__(self, *_): pass
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, **_):
                counter[0] += 1
                if counter[0] > 1000: raise AssertionError('capture did not finish')
                return SimpleNamespace(timestamp_ns=round((100 + counter[0] / 10) * 1e9), width=2, height=2, bgr=bytes(12))
        session = host.Session({'video': {'sharedMemory': 'fake'}, 'parameters': {'max_advances': 100000},
            'blink': {'seed': ['1','2','3','4'], 'eye': '', 'roi': {}, 'npc': 0, 'noisy': False,
                      'sourceWidth': 2, 'sourceHeight': 2, 'threshold': .9}}, lambda **event: events.append(event))
        rng = SimpleNamespace(advance=lambda _: None, get_state=lambda: [1,2,3,4])
        with patch.dict(sys.modules, {'frames': SimpleNamespace(Frames=FrameContext)}), \
             patch.object(blink_core, 'decode_eye'), \
             patch.object(blink_core, 'match_eye', side_effect=lambda *_: (.8 if counter[0]%12 == 2 else 1, {}, np.array([counter[0]]))), \
             patch.object(blink_core, 'recover', return_value=(rng, {'matchedAdvance': None})), \
             patch.object(host.time, 'perf_counter', return_value=100):
            session.capture()
        self.assertEqual(sum(event['event']=='keepalive' for event in events), 3)

    def test_calibration_uses_starter_regions_and_original_45_second_window(self):
        from auto_bdsp_rng.automation.auto_rng import dialog_timing
        events=[]
        session=host.Session({'command':'calibrate','species':387},lambda **event:events.append(event))
        with patch.object(dialog_timing,'measure_keyword_interval',return_value=SimpleNamespace(interval_seconds=2.5)) as measure:
            session.run()
        self.assertEqual(measure.call_args.kwargs['first_keyword'],('去吧','上吧'))
        self.assertEqual(measure.call_args.kwargs['second_keyword'],('战斗','戰鬥'))
        self.assertEqual(measure.call_args.kwargs['timeout_seconds'],45)
        self.assertEqual(events[-1]['result'],{'interval':2.5,'suggested':3.0})


if __name__ == '__main__':
    unittest.main()
