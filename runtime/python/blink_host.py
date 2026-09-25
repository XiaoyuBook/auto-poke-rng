"""One cancellable Project_Xs job. Receives frames only from the existing ABI."""
from __future__ import annotations
import json
from pathlib import Path
import sys
import time
import threading
from queue import Queue, Empty
import numpy as np
from blink_core import BlinkDetector, decode_eye, match_eye, recover
from blink_timing import BlinkTracking

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'clients'))
from frames import Frames


def emit(**payload):
    print(json.dumps(payload, ensure_ascii=False, allow_nan=False), flush=True)


def track(tracker, commands, *, clock=time.perf_counter, pause=time.sleep):
    while True:
        try:
            while True:
                if commands.get_nowait().get('command') == 'timeline':
                    tracker.request_timeline()
        except Empty:
            pass
        emit(event='tracking', tracking=tracker.update(clock()))
        pause(.1)


def run(config, commands=None):
    eye = decode_eye(config['eye'])
    preview = config['mode'] == 'preview'
    detector = None
    previous_gray = None
    last_time = None
    last_update = 0
    skipped = 0
    count = 64 if config['mode'] == 'munchlax' else 20 if config['mode'] == 'reidentify' and config['noisy'] else 7 if config['mode'] == 'reidentify' else 40
    emit(event='ready', target=count)
    with Frames(config['video']['sharedMemory']) as frames:
        while True:
            frame = frames.read(next_frame=True, max_age_ms=250)
            if frame is None:
                time.sleep(0.003)
                continue
            timestamp = frame.timestamp_ns / 1_000_000_000
            if last_time is not None and timestamp - last_time > 0.2 and not preview:
                raise ValueError('视频帧间隔超过 200 毫秒，可能漏掉眨眼，请重新捕获。')
            if (frame.width, frame.height) != (config['sourceWidth'], config['sourceHeight']):
                raise ValueError('视频分辨率已改变，请重新框选眼睛与 ROI。')
            last_time = timestamp
            skipped += frame.skipped
            if detector is None:
                detector = BlinkDetector(config['mode'], config['threshold'], count, timestamp)
            pixels = np.frombuffer(frame.bgr, np.uint8).reshape(frame.height, frame.width, 3)
            score, location, gray = match_eye(pixels, eye, config['roi'])
            changed = previous_gray is None or not np.array_equal(previous_gray, gray)
            previous_gray = gray
            before = (len(detector.intervals), detector.state)
            if not preview:
                detector.feed(score, timestamp, changed)
            if time.perf_counter() - last_update >= 0.1 or before != (len(detector.intervals), detector.state) or detector.done:
                emit(event='progress', score=score, location=location, captured=len(detector.intervals), target=count,
                     blinks=detector.blinks, intervals=detector.intervals, skipped=skipped)
                last_update = time.perf_counter()
            if not preview and detector.done:
                break
    emit(event='solving')
    rng, result = recover(config, detector.blinks, detector.intervals)
    tracker = BlinkTracking(rng, config, result['matchedAdvance'], detector.offset, time.perf_counter())
    emit(event='result', result={**result, **tracker.initial, 'rawWords': result['words'], 'mode': config['mode'], 'capturedAt': detector.offset,
                                'blinks': detector.blinks, 'intervals': detector.intervals})
    track(tracker, commands or Queue())


def read_commands(queue):
    for line in sys.stdin:
        try:
            command = json.loads(line)
            if isinstance(command, dict):
                queue.put(command)
        except ValueError:
            continue


if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    try:
        config = json.loads(sys.stdin.readline())
        commands = Queue()
        threading.Thread(target=read_commands, args=(commands,), daemon=True).start()
        run(config, commands)
    except Exception as error:
        emit(event='error', message=str(error) or type(error).__name__)
        sys.exit(1)
