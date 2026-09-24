"""Deterministic shared-memory ABI fixtures; no capture card or Windows hook.

The real Frames.read implementation consumes a ctypes buffer and a fixed clock.
This avoids turning a 50 ms freshness contract into a flaky wall-clock test.
"""
import ctypes
from pathlib import Path
import struct
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "clients"))
from frames import Frames

NOW_NS = 10_000_000_000


class Mutex:
    def __init__(self):
        self.releases = 0

    def WaitForSingleObject(self, *_):
        return 0

    def ReleaseMutex(self, *_):
        self.releases += 1
        return True


def reader_fixture(*, state=1):
    reader = Frames.__new__(Frames)
    reader.cursor = 1
    reader._slots, reader._capacity = 2, 6
    reader._api, reader._mutex = Mutex(), 1
    reader._buffer = ctypes.create_string_buffer(64 + 2 * (32 + 6))
    reader._view = ctypes.addressof(reader._buffer)
    header = struct.pack("<8sIIIIQQIIIIQ", b"PKFRAME1", 1, 64, 2, 6,
                         3, NOW_NS - 1_000_000, 2, 1, 6, state, 0)
    ctypes.memmove(reader._view, header, 64)
    for sequence, age_ms in ((2, 300), (3, 1)):
        offset = 64 + ((sequence - 1) % 2) * (32 + 6)
        slot = struct.pack("<QQIIII", sequence, NOW_NS - age_ms * 1_000_000, 6, 2, 1, 6)
        ctypes.memmove(reader._view + offset, slot + bytes([sequence]) * 6, 38)
    return reader


class FrameFreshnessTests(unittest.TestCase):
    def setUp(self):
        clock = patch("frames.time.perf_counter_ns", return_value=NOW_NS)
        clock.start()
        self.addCleanup(clock.stop)

    def test_dev004_selected_frame_must_meet_max_age(self):
        reader = reader_fixture()
        try:
            try:
                frame = reader.read(next_frame=True, max_age_ms=50)
            except RuntimeError as error:
                # Explicit stale rejection is valid. Merely throwing an unrelated
                # layout/protocol error must not make this regression pass.
                self.assertRegex(str(error).lower(), "stale|expired|过期|超龄")
                self.assertEqual(reader.cursor, 1)
                return
            if frame is not None:
                self.assertLessEqual((NOW_NS - frame.timestamp_ns) / 1_000_000, 50,
                                     "fresh header does not make the selected old frame fresh")
                self.assertEqual(frame.skipped, frame.sequence - 2,
                                 "skipping an expired frame must remain visible to the consumer")
            else:
                self.assertEqual(reader.cursor, 1,
                                 "rejecting a stale read must not silently advance the cursor")
        finally:
            self.assertEqual(reader._api.releases, 1)

    def test_latest_mode_returns_the_fresh_frame(self):
        reader = reader_fixture()
        frame = reader.read(max_age_ms=50)
        self.assertIsNotNone(frame)
        self.assertEqual((frame.sequence, frame.skipped, frame.bgr), (3, 1, b"\x03" * 6))

    def test_next_mode_preserves_order_when_the_older_frame_is_allowed(self):
        reader = reader_fixture()
        frame = reader.read(next_frame=True, max_age_ms=1000)
        self.assertIsNotNone(frame)
        self.assertEqual((frame.sequence, frame.skipped, frame.bgr), (2, 0, b"\x02" * 6))

    def test_stopped_source_is_rejected_and_mutex_released(self):
        reader = reader_fixture(state=0)
        with self.assertRaisesRegex(RuntimeError, "stopped"):
            reader.read()
        self.assertEqual(reader.cursor, 1)
        self.assertEqual(reader._api.releases, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
