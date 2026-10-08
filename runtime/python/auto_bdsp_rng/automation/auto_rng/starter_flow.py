"""Dialogue-gated starter automation driven by the existing Project_Xs clock.

Only the observer thread performs OCR. The main thread owns the RNG clock and
dispatches both countdown presses without waiting for an OCR response.
"""
from __future__ import annotations

import re
import threading
import time
from collections.abc import Callable

TIMELINE_BUFFER = 200
STARTER_TIMING = {"threshold": 0.7, "timeDelay": 0.0, "advanceDelay": 41,
                  "advanceDelay2": 48, "npc": 1, "timelineNpc": -1,
                  "pokemonNpc": 2, "noisy": False}
STARTER_SLOTS = {387: 0, 390: 1, 393: 2}
# Eleven tracking ticks, the initial transition, eleven timeline events, and
# the second transition must finish before the final selection can begin.
TRANSITION_ADVANCES = 11 * (STARTER_TIMING["npc"] + 1) + STARTER_TIMING["advanceDelay"] + 11 + STARTER_TIMING["advanceDelay2"]


class StarterTargetMissed(RuntimeError):
    """No selection was dispatched; this dialogue must be restarted."""


def validate_starter_delay(delay: int) -> None:
    maximum = TIMELINE_BUFFER - TRANSITION_ADVANCES
    if delay < 0 or delay >= maximum:
        raise ValueError(f"御三家全自动本轮 delay 为 {delay} 帧，固定 200 帧窗口要求 delay 小于 {maximum} 帧；请检查该御三家的 delay 策略")


def normalize_dialog(text: object) -> str:
    # An ellipsis-only page in the recording still needs one A press.
    return re.sub(r"[^\w….]+", "", str(text))


def crop_starter_dialog(image):
    """Find the actual white dialogue body, excluding the speaker and scenery."""
    import cv2
    import numpy as np
    height, width = image.shape[:2]
    top = int(height * .66)
    lower = image[top:]
    hsv = cv2.cvtColor(lower, cv2.COLOR_BGR2HSV)
    white = ((hsv[:, :, 2] > 205) & (hsv[:, :, 1] < 70)).astype('uint8') * 255
    contours, _ = cv2.findContours(white, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    for contour in contours:
        x,y,w,h = cv2.boundingRect(contour)
        if w >= width*.5 and height*.045 <= h <= height*.20 and cv2.contourArea(contour) >= width*height*.02:
            candidates.append((w*h,x,top+y,w,h))
    if not candidates:
        return None
    _,x,y,w,h = max(candidates)
    return image[y:y+h,x:x+w]


def is_start_dialog(text: str) -> bool:
    return ("怎么回事" in text or "怎麼回事" in text) and ("刚才那两人" in text or "剛才那兩人" in text)


def is_doctor_dialog(text: str) -> bool:
    return ("想还" in text or "想還" in text) and "博士" in text


def is_second_dialog(text: str) -> bool:
    return "搞什么" in text or "搞什麼" in text


def is_ball_dialog(text: str) -> bool:
    return "要选哪" in text or "要選哪" in text


def selection_script(species: int) -> str:
    if species not in STARTER_SLOTS:
        raise ValueError("御三家全自动目标无效")
    # The suitcase cursor starts at Turtwig; the confirmation defaults to No.
    navigation = "RIGHT 100\nWAIT 120\n" * STARTER_SLOTS[species]
    return navigation + "A 100\nWAIT 1800\nUP 100\nWAIT 100\nA 100\n"


class DialogObserver:
    """Publish complete, repeated OCR observations without blocking the clock."""
    def __init__(self, read_text: Callable[[], str], should_stop: Callable[[], bool]):
        self.read_text, self.should_stop = read_text, should_stop
        self.stopped = threading.Event()
        self.lock = threading.Lock()
        self.text: str | None = None
        self.observed_at = 0.0
        self.error: Exception | None = None
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def close(self) -> None:
        # Do not add a join delay immediately before the final controller press.
        self.stopped.set()

    def latest(self) -> str | None:
        with self.lock:
            if self.error is not None:
                raise RuntimeError(f"御三家对话识别失败: {self.error}") from self.error
            if time.monotonic() - self.observed_at > 2.0:
                return None
            return self.text

    def _run(self) -> None:
        previous, repeated = None, 0
        try:
            while not self.stopped.is_set() and not self.should_stop():
                current = normalize_dialog(self.read_text())
                if self.stopped.is_set() or self.should_stop():
                    return
                repeated = repeated + 1 if current == previous else 1
                previous = current
                with self.lock:
                    self.text = current if repeated >= 2 else None
                    self.observed_at = time.monotonic()
                self.stopped.wait(0.1)
        except Exception as error:
            if not self.stopped.is_set() and not self.should_stop():
                with self.lock:
                    self.error = error


class StarterFlow:
    def __init__(self, seed, target, delay: int, species: int, blink: dict, *,
                 latest_text: Callable[[], str | None], run_script: Callable[[str, str], object],
                 progress: Callable[[str, str, int], None] = lambda *_: None,
                 monotonic: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep,
                 should_stop: Callable[[], bool] = lambda: False,
                 tracker=None, on_balls: Callable[[], None] = lambda: None):
        validate_starter_delay(delay)
        self.delay, self.species = delay, species
        self.anchor = target.raw_target_advances - TIMELINE_BUFFER
        self.select_at = target.raw_target_advances - delay
        self.latest_text, self.run_script, self.progress = latest_text, run_script, progress
        self.monotonic, self.sleep, self.should_stop, self.on_balls = monotonic, sleep, should_stop, on_balls
        if tracker is None:
            from blink_core import Xorshift
            from blink_timing import BlinkTracking
            config = {**blink, **STARTER_TIMING, "mode": "recover"}
            measured = seed.measured_at if seed.measured_at is not None else monotonic()
            tracker = BlinkTracking(Xorshift(*seed.seed.words), config,
                                    seed.current_advances - int(config.get("menuClose", True)), measured, measured)
        self.tracker = tracker

    def run(self) -> str:
        stage, entered_at = "start", self.monotonic()
        last_pressed, last_press_at, reported_at = None, float("-inf"), float("-inf")
        labels = {"start": "确认起点对话", "doctor": "自动推进到博士对话",
                  "anchor": "博士对话等待目标前 200 帧", "first_countdown": "Timeline 第一段倒计时",
                  "second": "自动推进到搞什么啊对话", "second_countdown": "Timeline 第二段倒计时",
                  "balls": "自动推进到精灵球界面", "selection": "精灵球界面等待本轮 delay 触发"}
        reported_stage = None
        while True:
            if self.should_stop():
                raise RuntimeError("御三家自动接管已停止")
            now = self.monotonic()
            tracking = self.tracker.update(now)
            current = tracking["advances"]
            timeline = self.tracker.timeline
            text = self.latest_text() or ""
            if stage != reported_stage or now - reported_at >= 0.2:
                self.progress(stage, labels[stage], current)
                reported_stage, reported_at = stage, now
            if current > self.select_at:
                raise StarterTargetMissed(f"御三家已错过选择帧 {self.select_at}（当前 {current}），本轮不选精灵")
            if stage in ("start", "doctor", "anchor") and current > self.anchor:
                raise StarterTargetMissed(f"御三家未及时进入博士对话，错过固定启动帧 {self.anchor}")
            if stage == "start":
                if is_start_dialog(text):
                    self.run_script("A 100\n", "御三家·起点对话")
                    last_pressed, last_press_at = text, self.monotonic()
                    stage = "doctor"
            elif stage == "doctor":
                if is_doctor_dialog(text):
                    stage = "anchor"
                elif is_second_dialog(text) or is_ball_dialog(text):
                    raise RuntimeError("御三家起点之后未识别到博士对话，已停止")
                elif text and "就是" not in text and "想还" not in text and "想還" not in text and text != last_pressed and now-last_press_at >= 0.6:
                    self.run_script("A 100\n", "御三家·推进对话")
                    last_pressed, last_press_at = text, self.monotonic()
            elif stage == "anchor":
                if text and not is_doctor_dialog(text):
                    raise RuntimeError("等待 Timeline 时博士对话发生变化，已停止")
                if current == self.anchor:
                    if not self.tracker.request_timeline():
                        raise RuntimeError("御三家 Timeline 无法启动")
                    stage = "first_countdown"
            elif stage == "first_countdown":
                if timeline is not None:
                    if now - (timeline.starts_at - timeline.config.get("timeDelay", 0)) > 0.15:
                        raise StarterTargetMissed("御三家第一段倒计时按键超时，本轮不选精灵")
                    self.run_script("A 100\n", "御三家·第一段归零")
                    last_pressed, last_press_at = text, self.monotonic()
                    stage = "second"
            elif stage == "second":
                if is_ball_dialog(text) or "是精灵球" in text or "是精靈球" in text:
                    raise StarterTargetMissed("未确认第二段对话就进入精灵球界面，本轮不选精灵")
                if timeline.delay2_count < 0:
                    raise StarterTargetMissed("第二段倒计时结束前未进入搞什么啊对话，本轮不选精灵")
                if is_second_dialog(text):
                    stage = "second_countdown"
                elif text and "搞" not in text and text != last_pressed and now-last_press_at >= 0.6:
                    self.run_script("A 100\n", "御三家·推进遭遇对话")
                    last_pressed, last_press_at = text, self.monotonic()
            elif stage == "second_countdown":
                if timeline.delay2_count < 0:
                    if now - timeline.delay2_at > 0.15:
                        raise StarterTargetMissed("御三家第二段倒计时按键超时，本轮不选精灵")
                    self.run_script("A 100\n", "御三家·第二段归零")
                    last_pressed, last_press_at = text, self.monotonic()
                    stage = "balls"
            elif stage == "balls":
                if is_ball_dialog(text):
                    self.on_balls()
                    stage = "selection"
                elif text and "要选" not in text and "要選" not in text and text != last_pressed and now-last_press_at >= 0.6:
                    self.run_script("A 100\n", "御三家·推进精灵球对话")
                    last_pressed, last_press_at = text, self.monotonic()
            elif stage == "selection" and current == self.select_at:
                self.progress("confirm", f"到达选择帧 {self.select_at}，使用本轮 delay {self.delay} 帧", current)
                return selection_script(self.species)
            if stage != reported_stage:
                entered_at = now
            if stage in ("start", "doctor", "second", "balls") and now-entered_at > 45:
                raise RuntimeError(f"御三家对话识别超时：{labels[stage]}")
            if current == self.select_at and stage != "selection":
                raise StarterTargetMissed("到达选择帧时尚未进入精灵球界面，本轮不选精灵")
            next_at = self.tracker.next_at
            if timeline is not None:
                next_at = timeline.queue[0][0] if timeline.queue else timeline.starts_at
            self.sleep(max(0.001, min(0.02, next_at-self.monotonic())))
