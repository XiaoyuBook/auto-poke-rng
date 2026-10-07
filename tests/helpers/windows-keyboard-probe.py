"""Separate foreground process for the real Windows keyboard integration test.

Only inject into this test window. Never send keys if another program takes
the foreground. F23/F24 avoid interfering with ordinary user typing.
"""
import ctypes
import json
import queue
import sys
import threading
import tkinter as tk
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.GetForegroundWindow.restype = wintypes.HWND
user32.GetAncestor.argtypes = (wintypes.HWND, wintypes.UINT)
user32.GetAncestor.restype = wintypes.HWND
user32.SetForegroundWindow.argtypes = (wintypes.HWND,)
user32.GetWindowRect.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.RECT))
user32.GetCursorPos.argtypes = (ctypes.POINTER(wintypes.POINT),)
user32.mouse_event.argtypes = (wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.c_size_t)
user32.keybd_event.argtypes = (wintypes.BYTE, wintypes.BYTE, wintypes.DWORD, ctypes.c_size_t)
previous_foreground = user32.GetForegroundWindow()
commands = queue.Queue()
pressed = set()
root = tk.Tk()
root.title("Auto Poke RNG keyboard regression")
root.geometry("360x120+60+60")
tk.Label(root, text="Independent foreground window\nF23 / F24 keyboard regression").pack(pady=24)
root.update()
hwnd = user32.GetAncestor(root.winfo_id(), 2)


def emit(value):
    print(json.dumps(value), flush=True)


def foreground():
    return user32.GetForegroundWindow() == hwnd


def close():
    # Always release test-generated held keys, including failed test runs.
    for vk in pressed:
        user32.keybd_event(vk, 0, 2, 0)
    restore_foreground = foreground()
    root.destroy()
    if restore_foreground and previous_foreground:
        user32.SetForegroundWindow(previous_foreground)


root.bind("<KeyPress>", lambda event: emit({"event": "key", "vk": event.keycode, "down": True}))
root.bind("<KeyRelease>", lambda event: emit({"event": "key", "vk": event.keycode, "down": False}))
root.protocol("WM_DELETE_WINDOW", close)


def read_commands():
    try:
        for line in sys.stdin:
            commands.put(json.loads(line))
    finally:
        commands.put({"stop": True})


def poll():
    while not commands.empty():
        command = commands.get()
        if command.get("stop"):
            close()
            return
        if not foreground():
            emit({"event": "error", "message": "Probe lost OS foreground; input was not injected"})
            continue
        vk = command["vk"]
        if vk not in (0x85, 0x86, 0x87, 0x1B, 0xA2):
            emit({"event": "error", "message": "Unexpected regression test key"})
            continue
        if command["down"]:
            pressed.add(vk)
        else:
            pressed.discard(vk)
        user32.keybd_event(vk, 0, 0 if command["down"] else 2, 0)
        emit({"event": "sent", "id": command["id"], "foreground": foreground()})
    root.after(10, poll)


def ready():
    root.lift()
    root.attributes("-topmost", True)
    root.focus_force()
    user32.SetForegroundWindow(hwnd)
    if not foreground():
        # A real click grants foreground ownership when Windows declines a
        # programmatic activation. Restore the cursor immediately afterward.
        cursor, bounds = wintypes.POINT(), wintypes.RECT()
        user32.GetCursorPos(ctypes.byref(cursor))
        user32.GetWindowRect(hwnd, ctypes.byref(bounds))
        user32.SetCursorPos((bounds.left + bounds.right) // 2, (bounds.top + bounds.bottom) // 2)
        user32.mouse_event(2, 0, 0, 0, 0)
        user32.mouse_event(4, 0, 0, 0, 0)
        user32.SetCursorPos(cursor.x, cursor.y)
    root.after(100, lambda: emit({"event": "ready", "foreground": foreground(), "hwnd": hwnd}))


threading.Thread(target=read_commands, daemon=True).start()
root.after(100, ready)
root.after(10, poll)
root.mainloop()
