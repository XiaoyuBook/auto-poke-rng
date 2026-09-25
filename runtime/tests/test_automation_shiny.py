"""Shiny monitoring contracts at the script/OCR boundary."""
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import automation_host as host
from auto_bdsp_rng.automation.auto_rng import dialog_timing


class ShinyContracts(unittest.TestCase):
    def monitor(self, outcome):
        trace, ids = [], []
        started, released, stopped = threading.Event(), threading.Event(), threading.Event()
        session = host.Session({'species': 492}, lambda **_: None)
        def script(text, name, script_id=None):
            ids.append(script_id)
            started.set()
            if not released.wait(.2):
                trace.append('tail-key')
            trace.append('released')
        def request(method, **params):
            self.assertEqual(method, 'stop_script')
            self.assertEqual(params['scriptId'], ids[0])
            trace.append('stop-script')
            stopped.set()
            released.set()
        def measure(*_, **__):
            self.assertTrue(started.wait(2))
            if outcome == 'unknown':
                event = dialog_timing.DialogTimingEvent('timeout_before_first', 30, 30)
                raise dialog_timing.DialogKeywordTimeoutError('unknown', stage='before_first', event=event, events=(event,))
            return SimpleNamespace(interval_seconds=outcome)
        session.run_script, session.request = script, request
        with patch.object(dialog_timing, 'measure_keyword_interval', side_effect=measure):
            result = session.shiny('A 1\nWAIT 100\nB 1', 'hit.rng', 4)
        return session, result, trace, stopped.is_set()

    def test_definite_non_shiny_stops_tail_actions_and_waits_for_release(self):
        session, result, trace, stopped = self.monitor(1)
        self.assertFalse(result.is_shiny)
        self.assertEqual(result.interval_seconds, 1)
        self.assertTrue(stopped)
        self.assertEqual(trace, ['stop-script', 'released'])
        self.assertFalse(session.cancel.is_set(), 'stopping this script must not cancel the workflow')

    def test_shiny_waits_for_the_script_to_finish(self):
        _, result, trace, stopped = self.monitor(5)
        self.assertTrue(result.is_shiny)
        self.assertFalse(stopped)
        self.assertEqual(trace, ['tail-key', 'released'])

    def test_keyword_timeout_remains_unknown_and_does_not_stop_the_script(self):
        _, result, trace, stopped = self.monitor('unknown')
        self.assertFalse(result.is_shiny)
        self.assertIsNone(result.interval_seconds)
        self.assertFalse(stopped)
        self.assertEqual(trace, ['tail-key', 'released'])

    def roamer_monitor(self, *, overrun=False, cancelled=False):
        clock = [0.0]
        finish_script = threading.Event()
        session = host.Session({'species': 481}, lambda **_: None)
        class Battle:
            calls = 0
            def clear(self): pass
            def wait(self, *_):
                self.calls += 1
                if self.calls == 1:
                    clock[0] = 301.0
                    if cancelled:
                        session.cancel.set()
                    return False
                return True
        session.battle = Battle()
        session.run_script = lambda *_args, **_kwargs: finish_script.wait(2)
        session.ocr = lambda *_args, **_kwargs: {'text': '出现了！'}
        def measure(capture, read, **kwargs):
            self.assertEqual(session.battle.calls, 2)
            self.assertEqual(kwargs['hard_timeout_seconds'], 300)
            if overrun:
                clock[0] += 301
            self.assertEqual(read(None), '出现了！')
            finish_script.set()
            self.assertTrue(kwargs['script_done'].wait(2))
            return SimpleNamespace(interval_seconds=5)
        try:
            with patch.object(host.time, 'monotonic', side_effect=lambda: clock[0]), \
                 patch.object(dialog_timing, 'measure_keyword_interval', side_effect=measure):
                return session.shiny('WAIT 60000', 'roamer.rng', 4)
        finally:
            finish_script.set()

    def test_roamer_tracking_can_exceed_300_seconds_before_monitoring_starts(self):
        self.assertTrue(self.roamer_monitor().is_shiny)

    def test_roamer_monitor_still_times_out_300_seconds_after_battle(self):
        with self.assertRaisesRegex(RuntimeError, '300秒'):
            self.roamer_monitor(overrun=True)

    def test_roamer_long_tracking_can_still_be_cancelled(self):
        with self.assertRaises(host.Cancelled):
            self.roamer_monitor(cancelled=True)


if __name__ == '__main__':
    unittest.main()
