"""Timing parity against executable statements from the original Project_Xs GUI."""
import ast
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
from queue import Queue

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from blink_core import Xorshift
from blink_timing import TimelineClock, BlinkTracking
import blink_host

SEED = [0x12345678, 0x87654321, 0x87654321, 0x12345678]


def original_timeline(config, count=50):
    # Execute the upstream timeline block without importing Tk/camera/keyboard.
    source = Path(__file__).resolve().parents[2] / 'third_party/Project_Xs/src/player_blink_gui.py'
    tree = ast.parse(source.read_text(encoding='utf-8'))
    gui = next(node for node in tree.body if isinstance(node, ast.ClassDef))
    monitor = next(node for node in gui.body if isinstance(node, ast.FunctionDef) and node.name == 'monitoring_work')
    block = monitor.body[-1]
    assert isinstance(block, ast.If) and ast.unparse(block.test) == 'self.timelining'
    function = ast.FunctionDef(name='reference', args=monitor.args, body=block.body, decorator_list=[])
    module = ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[]))
    clock = [100.0]
    control = types.SimpleNamespace(rng=Xorshift(*SEED), config_json={
        'white_delay': config['timeDelay'], 'advance_delay': config['advanceDelay'],
        'advance_delay_2': config['advanceDelay2'], 'timeline_npc': config['timelineNpc'], 'pokemon_npc': config['pokemonNpc'],
    }, advances=7, tracking=True, menu_check_var=types.SimpleNamespace(get=lambda: config['menuClose']),
        auto_timeline_check_var=types.SimpleNamespace(get=lambda: False), keypress_advance=types.SimpleNamespace(get=lambda: -1))
    records = []
    def capture(message):
        if str(message).startswith('advances:'):
            records.append((clock[0], control.advances, control.rng.get_state()))
            if len(records) == count:
                control.tracking = False
    namespace = {'heapq': __import__('heapq'), 'time': types.SimpleNamespace(perf_counter=lambda: clock[0], sleep=lambda delay: clock.__setitem__(0, clock[0] + delay)), 'print': capture}
    exec(compile(module, str(source), 'exec'), namespace)
    namespace['reference'](control)
    return records


class TimingTests(unittest.TestCase):
    def test_timeline_matches_original_gui_npc_queue_menu_and_both_delays(self):
        for timeline_npc, pokemon_npc, menu in [(0, 0, False), (2, 2, True), (-1, 1, False)]:
            config = {'timeDelay': .8, 'advanceDelay': 13, 'advanceDelay2': 27, 'timelineNpc': timeline_npc, 'pokemonNpc': pokemon_npc, 'menuClose': menu}
            records = original_timeline(config)
            tracker = TimelineClock(Xorshift(*SEED), config, 7, 100.)
            self.assertEqual(tracker.update(100.7)['advances'], 7, 'white delay precedes advance delay')
            # All NPCs at the same timestamp must run in the original heap order.
            grouped = {timestamp: (advance, words) for timestamp, advance, words in records}
            for timestamp, (advance, words) in list(grouped.items())[:-1]:
                current = tracker.update(timestamp)
                self.assertEqual(current['advances'], advance)
                self.assertEqual(current['words'], [f'{word:08X}' for word in words])

    def test_recovery_catchup_and_original_manual_timeline_countdown(self):
        config = {'mode': 'recover', 'npc': 1, 'menuClose': True}
        tracker = BlinkTracking(Xorshift(*SEED), config, None, 97.6, 100.)
        expected = Xorshift(*SEED); expected.advance(4)
        self.assertEqual(tracker.initial['words'], [f'{word:08X}' for word in expected.get_state()])
        self.assertEqual(tracker.update(100.)['advances'], 3)
        tracker.request_timeline()
        for index in range(1, 12):
            self.assertEqual(tracker.update(100. + index * 1.018)['phase'], 'countdown')
        self.assertEqual(tracker.update(100. + 12 * 1.018)['phase'], 'timeline')

    def test_tidsid_uses_original_random_intervals_without_timeline(self):
        tracker = BlinkTracking(Xorshift(*SEED), {'mode': 'munchlax'}, None, 99., 100.)
        expected = Xorshift(*SEED); interval = expected.rangefloat(3, 12) + .285
        current = tracker.update(100.)
        self.assertEqual(current['advances'], 1)
        self.assertAlmostEqual(current['nextIn'], interval)
        self.assertFalse(tracker.request_timeline())

    def test_live_worker_consumes_timeline_command_and_emits_tracking(self):
        tracker = BlinkTracking(Xorshift(*SEED), {'mode': 'recover'}, None, 100., 100.)
        commands = Queue(); commands.put({'command': 'timeline'})
        output = []
        with patch.object(blink_host, 'emit', side_effect=lambda **value: output.append(value)):
            with self.assertRaises(StopIteration):
                blink_host.track(tracker, commands, clock=lambda: 100., pause=lambda _: next(iter(())))
        self.assertEqual(output[0]['event'], 'tracking')
        self.assertEqual(output[0]['tracking']['phase'], 'countdown')
        self.assertEqual(output[0]['tracking']['countdown'], 10)


if __name__ == '__main__':
    unittest.main()
