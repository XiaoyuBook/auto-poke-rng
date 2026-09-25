"""Shared-frame adapter for the original Project_Xs (MIT, niart120).

The recovery/search modules are vendored unchanged. Detection below adapts
tracking_blink/tracking_poke_blink to source timestamps, without Tk or a camera.
"""
from __future__ import annotations

import base64
from contextlib import redirect_stdout
from pathlib import Path
import sys
import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'third_party' / 'Project_Xs' / 'src'))
import rngtool
from xorshift import Xorshift


def seed_payload(rng):
    words = [f'{value:08X}' for value in rng.get_state()]
    return {'words': words, 'pair': [words[0] + words[1], words[2] + words[3]]}


def decode_eye(data):
    raw = base64.b64decode(data.split(',', 1)[-1], validate=True)
    eye = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_GRAYSCALE)
    if eye is None or min(eye.shape) < 2 or max(eye.shape) > 512:
        raise ValueError('眼睛模板无效，请重新框选（2–512 像素）。')
    if float(eye.std()) < 1:
        raise ValueError('眼睛模板缺少图像细节，请框选睁开的眼睛。')
    return eye


def match_eye(frame, eye, roi):
    x, y, w, h = (roi[key] for key in ('x', 'y', 'width', 'height'))
    height, width = frame.shape[:2]
    if x < 0 or y < 0 or w < eye.shape[1] or h < eye.shape[0] or x + w > width or y + h > height:
        raise ValueError('ROI 超出画面或小于眼睛模板，请重新框选。')
    # The shared frame ABI is explicitly BGR; both template and ROI use the
    # same OpenCV grayscale conversion (upstream's camera loop assumed RGB).
    gray = cv2.cvtColor(frame[y:y+h, x:x+w], cv2.COLOR_BGR2GRAY)
    scores = cv2.matchTemplate(gray, eye, cv2.TM_CCOEFF_NORMED)
    _, score, _, location = cv2.minMaxLoc(scores)
    return float(score), {'x': x + location[0], 'y': y + location[1], 'width': eye.shape[1], 'height': eye.shape[0]}, gray


class BlinkDetector:
    def __init__(self, mode, threshold, count, started):
        self.pokemon = mode == 'munchlax'
        self.threshold, self.count = threshold, count
        self.state = rngtool.IDLE
        self.previous = started
        self.offset = started
        self.blinks, self.intervals = [], []

    def feed(self, score, timestamp, changed=True):
        # Final single/double classification must finish even when the game
        # produces identical pixels for consecutive published video frames.
        if changed and (0.4 if self.pokemon else 0.01) < score < self.threshold:
            if self.state == rngtool.IDLE:
                if len(self.intervals) < self.count:
                    interval = timestamp - self.previous
                    self.intervals.append(interval if self.pokemon else round(interval / 1.017))
                    self.blinks.append(0)
                    self.previous = self.offset = timestamp
                    self.state = rngtool.SINGLE
            elif not self.pokemon and self.state == rngtool.SINGLE and timestamp - self.previous > 0.3:
                self.blinks[-1] = 1
                self.state = rngtool.DOUBLE
        if self.state != rngtool.IDLE and timestamp - self.previous > 0.7:
            self.state = rngtool.IDLE

    @property
    def done(self):
        return len(self.intervals) >= self.count and (self.pokemon or self.state == rngtool.IDLE)


def recover(config, blinks, intervals):
    mode = config['mode']
    # Original functions print diagnostics; stdout belongs to the JSONL IPC.
    with redirect_stdout(sys.stderr):
        try:
            if mode == 'recover':
                if len(blinks) < 40 or len(intervals) != len(blinks):
                    raise ValueError('玩家恢复至少需要 40 次完整眨眼。')
                rng = rngtool.recov(blinks, intervals, npc=config['npc'])
                # The upstream matrix/zip validation only covers the first 39
                # blinks. recov returns the state immediately before the last
                # observed blink, so check that final observation explicitly.
                if Xorshift(*rng.get_state()).next() & 0xF != blinks[-1]:
                    raise ValueError('最后一次眨眼与恢复状态不一致，请检查识别后重新捕获。')
                advance = None
            elif mode == 'munchlax':
                if len(intervals) < 64:
                    raise ValueError('小卡比兽恢复至少需要 64 次眨眼。')
                rng = rngtool.recov_by_munchlax(intervals)
                advance = None
            else:
                rng = Xorshift(*(int(word, 16) for word in config['seed']))
                if config['noisy']:
                    # Upstream noisy search treats search_max as a length after
                    # advancing search_min. Convert the UI's end to that length.
                    found = rngtool.reidentiy_by_intervals_noisy(rng, intervals,
                        search_min=config['searchMin'], search_max=config['searchMax'] - config['searchMin'])
                else:
                    found = rngtool.reidentiy_by_intervals(rng, intervals, npc=config['npc'],
                        search_min=config['searchMin'], search_max=config['searchMax'], return_advance=True)
                if found is None:
                    raise ValueError('搜索范围内未找到匹配状态，请核对 Seed、NPC 数和识别区域。')
                rng, advance = found
        except (AssertionError, IndexError) as error:
            raise ValueError('无法从本次眨眼推算 Seed，请检查模板、阈值和 NPC 数后重新捕获。') from error
    if not any(rng.get_state()):
        raise ValueError('观测得到无效的全零状态，请检查单／双眨眼识别后重新捕获。')
    return rng, {**seed_payload(rng), 'matchedAdvance': advance}
