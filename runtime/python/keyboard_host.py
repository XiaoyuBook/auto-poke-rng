"""Small Windows low-level keyboard hook used by the Electron virtual pad.

The hook is intentionally kept in a separate process. It follows the mature
EasyCon hook's important guarantees: key transitions are deduplicated, mapped
keys can be put into standby without losing Escape, and stopping emits no
stuck key state back to the application.
"""
from __future__ import annotations

import ctypes
import json
import os
import sys
import threading
from ctypes import wintypes

WH_KEYBOARD_LL = 13
WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
WM_SYSKEYDOWN = 0x0104
WM_SYSKEYUP = 0x0105
WM_QUIT = 0x0012
PM_NOREMOVE = 0
VK_ESCAPE = 0x1B
VK_LCONTROL = 0xA2
VK_RCONTROL = 0xA3
VK_CONTROL = 0x11


class KbdLlHookStruct(ctypes.Structure):
    _fields_ = (
        ("vkCode", wintypes.DWORD),
        ("scanCode", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_size_t),
    )


class Message(ctypes.Structure):
    _fields_ = (
        ("hwnd", wintypes.HWND),
        ("message", wintypes.UINT),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", wintypes.DWORD),
        ("pt", wintypes.POINT),
        ("lPrivate", wintypes.DWORD),
    )


class KeyboardHook:
    def __init__(self) -> None:
        if os.name != "nt":
            raise RuntimeError("Windows keyboard hooks are only available on Windows")
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self.proc_type = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
        self.user32.SetWindowsHookExW.argtypes = (ctypes.c_int, self.proc_type, wintypes.HINSTANCE, wintypes.DWORD)
        self.user32.SetWindowsHookExW.restype = wintypes.HANDLE
        self.user32.UnhookWindowsHookEx.argtypes = (wintypes.HANDLE,)
        self.user32.UnhookWindowsHookEx.restype = wintypes.BOOL
        self.user32.CallNextHookEx.argtypes = (wintypes.HANDLE, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
        self.user32.CallNextHookEx.restype = ctypes.c_ssize_t
        self.user32.GetAsyncKeyState.argtypes = (ctypes.c_int,)
        self.user32.GetAsyncKeyState.restype = ctypes.c_short
        self.user32.PeekMessageW.argtypes = (ctypes.POINTER(Message), wintypes.HWND, wintypes.UINT, wintypes.UINT, wintypes.UINT)
        self.user32.GetMessageW.argtypes = (ctypes.POINTER(Message), wintypes.HWND, wintypes.UINT, wintypes.UINT)
        self.user32.TranslateMessage.argtypes = (ctypes.POINTER(Message),)
        self.user32.DispatchMessageW.argtypes = (ctypes.POINTER(Message),)
        self.user32.PostThreadMessageW.argtypes = (wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
        self.kernel32.GetCurrentThreadId.restype = wintypes.DWORD
        self.kernel32.GetModuleHandleW.argtypes = (wintypes.LPCWSTR,)
        self.kernel32.GetModuleHandleW.restype = wintypes.HMODULE
        self.lock = threading.RLock()
        self.keys: set[int] = set()
        self.mapped_keys: set[int] = set()
        self.pressed: set[int] = set()
        self.enabled = True
        self.running = False
        self.thread_id: int | None = None
        self.handle = None
        self.proc = None
        self.thread: threading.Thread | None = None

    def start(self, keys: list[int], enabled: bool = True) -> None:
        with self.lock:
            self.mapped_keys = {int(key) for key in keys}
            self.keys = self.mapped_keys | {VK_ESCAPE, VK_LCONTROL, VK_RCONTROL, VK_CONTROL}
            self.enabled = bool(enabled)
        self.thread = threading.Thread(target=self._run, name="AutoPoke keyboard hook", daemon=True)
        self.thread.start()
        for _ in range(500):
            with self.lock:
                if self.running or (self.thread and not self.thread.is_alive()):
                    break
            threading.Event().wait(0.01)
        with self.lock:
            if not self.running:
                raise RuntimeError("无法启动 Windows 键盘捕获")

    def set_keys(self, keys: list[int]) -> None:
        with self.lock:
            self.mapped_keys = {int(key) for key in keys}
            self.keys = self.mapped_keys | {VK_ESCAPE, VK_LCONTROL, VK_RCONTROL, VK_CONTROL}

    def set_enabled(self, enabled: bool) -> None:
        with self.lock:
            self.enabled = bool(enabled)
            if not self.enabled:
                self.pressed.clear()

    def stop(self) -> None:
        with self.lock:
            thread_id = self.thread_id
            thread = self.thread
        if thread and thread.is_alive() and thread_id:
            self.user32.PostThreadMessageW(thread_id, WM_QUIT, 0, 0)
            thread.join(2)
        with self.lock:
            self.running = False
            self.thread = None
            self.thread_id = None
            self.handle = None

    def _run(self) -> None:
        hook = None
        try:
            message = Message()
            self.user32.PeekMessageW(ctypes.byref(message), None, 0, 0, PM_NOREMOVE)
            with self.lock:
                self.thread_id = int(self.kernel32.GetCurrentThreadId())
            self.proc = self.proc_type(self._callback)
            module = self.kernel32.GetModuleHandleW(None)
            hook = self.user32.SetWindowsHookExW(WH_KEYBOARD_LL, self.proc, module, 0)
            if not hook:
                raise ctypes.WinError(ctypes.get_last_error())
            with self.lock:
                self.handle = hook
                self.running = True
            self.emit({"event": "ready"})
            while True:
                result = int(self.user32.GetMessageW(ctypes.byref(message), None, 0, 0))
                if result <= 0:
                    break
                self.user32.TranslateMessage(ctypes.byref(message))
                self.user32.DispatchMessageW(ctypes.byref(message))
        except Exception as error:
            self.emit({"event": "error", "message": str(error)})
        finally:
            if hook:
                self.user32.UnhookWindowsHookEx(hook)
            with self.lock:
                self.running = False
                self.handle = None
            self.emit({"event": "stopped"})

    def _callback(self, code: int, message: int, data: int) -> int:
        if code < 0:
            return self.user32.CallNextHookEx(self.handle, code, message, data)
        event = ctypes.cast(data, ctypes.POINTER(KbdLlHookStruct)).contents
        vk = int(event.vkCode)
        down = message in (WM_KEYDOWN, WM_SYSKEYDOWN)
        up = message in (WM_KEYUP, WM_SYSKEYUP)
        if not (down or up):
            return self.user32.CallNextHookEx(self.handle, code, message, data)
        with self.lock:
            keys = vk in self.keys
            mapped = vk in self.mapped_keys
            enabled = self.enabled
            if not keys:
                return self.user32.CallNextHookEx(self.handle, code, message, data)
            control = bool(self.user32.GetAsyncKeyState(VK_LCONTROL) & 0x8000 or self.user32.GetAsyncKeyState(VK_RCONTROL) & 0x8000 or self.user32.GetAsyncKeyState(VK_CONTROL) & 0x8000)
            if down:
                if vk in self.pressed:
                    return 1 if vk == VK_ESCAPE or (enabled and mapped) else self.user32.CallNextHookEx(self.handle, code, message, data)
                self.pressed.add(vk)
            elif up:
                if vk not in self.pressed:
                    return 1 if vk == VK_ESCAPE or (enabled and mapped) else self.user32.CallNextHookEx(self.handle, code, message, data)
                self.pressed.remove(vk)
            capture = vk == VK_ESCAPE or (enabled and mapped)
        if capture:
            self.emit({"event": "key", "vk": vk, "down": down, "control": control})
            return 1
        return self.user32.CallNextHookEx(self.handle, code, message, data)

    @staticmethod
    def emit(value: dict) -> None:
        sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def main() -> int:
    hook: KeyboardHook | None = None
    for line in sys.stdin:
        try:
            command = json.loads(line)
            name = command.get("command")
            if name == "start":
                hook = KeyboardHook()
                hook.start(command.get("keys", []), enabled=bool(command.get("enabled", True)))
            elif name == "keys" and hook:
                hook.set_keys(command.get("keys", []))
            elif name == "enabled" and hook:
                hook.set_enabled(bool(command.get("value")))
            elif name == "stop":
                if hook:
                    hook.stop()
                return 0
        except Exception as error:
            KeyboardHook.emit({"event": "error", "message": str(error)})
    if hook:
        hook.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
