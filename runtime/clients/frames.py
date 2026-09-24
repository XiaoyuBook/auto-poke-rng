"""Windows shared-memory reader; stdlib only. One instance/cursor per consumer.

Pass state.video.sharedMemory from the runtime protocol. Returned bytes are owned
by the caller and remain valid after reconnect/overwrite. Always inspect skipped.
"""
from __future__ import annotations

import ctypes
import struct
import time
from dataclasses import dataclass
from ctypes import wintypes


@dataclass(frozen=True)
class Frame:
    sequence: int
    timestamp_ns: int
    width: int
    height: int
    stride: int
    skipped: int
    bgr: bytes


class Frames:
    def __init__(self, descriptor: dict):
        if descriptor.get("version") != 1:
            raise ValueError("Unsupported frame protocol")
        self.cursor = 0
        self._view = self._mapping = self._mutex = None
        self._api = ctypes.WinDLL("kernel32", use_last_error=True)
        for name, args, result in (
            ("OpenFileMappingW", [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR], wintypes.HANDLE),
            ("OpenMutexW", [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR], wintypes.HANDLE),
            ("MapViewOfFile", [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.c_size_t], ctypes.c_void_p),
            ("WaitForSingleObject", [wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD),
            ("ReleaseMutex", [wintypes.HANDLE], wintypes.BOOL),
            ("UnmapViewOfFile", [ctypes.c_void_p], wintypes.BOOL),
            ("CloseHandle", [wintypes.HANDLE], wintypes.BOOL),
        ):
            fn = getattr(self._api, name)
            fn.argtypes, fn.restype = args, result
        self._slots, self._capacity = descriptor["slots"], descriptor["capacity"]
        if not 2 <= self._slots <= 8 or not 1 <= self._capacity <= 3840 * 2160 * 3:
            raise ValueError("Invalid mapping bounds")
        try:
            self._mapping = self._api.OpenFileMappingW(4, False, descriptor["mapping"])
            self._mutex = self._api.OpenMutexW(0x100001, False, descriptor["mutex"])
            if not self._mapping or not self._mutex:
                raise ctypes.WinError(ctypes.get_last_error())
            self._view = self._api.MapViewOfFile(self._mapping, 4, 0, 0, 64 + self._slots * (32 + self._capacity))
            if not self._view:
                raise ctypes.WinError(ctypes.get_last_error())
        except Exception:
            self.close()
            raise

    def read(self, *, next_frame=False, max_age_ms=1000) -> Frame | None:
        if not self._view:
            raise RuntimeError("Frame reader is closed")
        result = self._api.WaitForSingleObject(self._mutex, 2)
        if result == 258:
            return None
        if result not in (0, 0x80):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            # Abandoned mutex means the writer may have died mid-copy.
            if result == 0x80:
                raise RuntimeError("Frame writer exited during publication")
            header = ctypes.string_at(self._view, 64)
            magic, version, header_size, slots, capacity, latest, timestamp, width, height, stride, state, _ = struct.unpack("<8sIIIIQQIIIIQ", header)
            if (magic, version, header_size, slots, capacity) != (b"PKFRAME1", 1, 64, self._slots, self._capacity):
                raise RuntimeError("Invalid frame mapping")
            # On Windows perf_counter_ns uses QueryPerformanceCounter, matching qpc_ns.
            now_ns = time.perf_counter_ns()
            max_age_ns = max_age_ms * 1_000_000
            if state != 1 or now_ns - timestamp > max_age_ns:
                raise RuntimeError("Video source stopped or frame is stale")
            candidates = []
            for index in range(slots):
                address = self._view + 64 + index * (32 + capacity)
                metadata = struct.unpack("<QQIIII", ctypes.string_at(address, 32))
                # The mapping header can be fresh while the selected slot is
                # already too old. Filter each candidate before choosing the
                # oldest/newest frame so next-frame reads honor max_age_ms.
                if self.cursor < metadata[0] <= latest and now_ns - metadata[1] <= max_age_ns:
                    candidates.append((metadata, address))
            if not candidates:
                return None
            metadata, address = (min if next_frame else max)(candidates, key=lambda item: item[0][0])
            sequence, captured, size, width, height, stride = metadata
            if size != width * height * 3 or size != capacity or stride != width * 3:
                raise RuntimeError("Invalid frame layout")
            frame = Frame(sequence, captured, width, height, stride, sequence - self.cursor - 1 if self.cursor else 0, ctypes.string_at(address + 32, size))
            self.cursor = sequence
            return frame
        finally:
            self._api.ReleaseMutex(self._mutex)

    def close(self):
        if self._view:
            self._api.UnmapViewOfFile(self._view)
            self._view = None
        for name in ("_mutex", "_mapping"):
            handle = getattr(self, name, None)
            if handle:
                self._api.CloseHandle(handle)
                setattr(self, name, None)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
