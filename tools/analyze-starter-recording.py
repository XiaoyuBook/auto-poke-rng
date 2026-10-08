"""Measure the visible controller edges in the user's 916 x 954 starter video.

This reads a recording only; it never connects to a controller or a video device.
Timestamps come from decoded frame PTS, not the container's average frame rate.
Example: python tools/analyze-starter-recording.py D:/video/ev/11.mp4 --output DIR
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np


# The green pressed indicators in 11.mp4, in source pixels (x, y, w, h).
BUTTON_REGIONS = {
    "A": (510, 824, 16, 15),
    "B": (498, 836, 16, 15),
    "X": (498, 811, 16, 15),
    "Y": (486, 824, 16, 15),
    "HOME": (490, 902, 13, 13),
}


def analyze(video: Path, output: Path) -> dict:
    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        raise ValueError(f"Cannot open {video}")
    size = [int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
            int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))]
    if size != [916, 954]:
        raise ValueError("These controller regions apply only to the supplied 916 x 954 recording")
    output.mkdir(parents=True, exist_ok=True)
    events, active = [], {}
    previous, last_ms, frame_index = None, 0.0, 0
    frame_periods = []
    average_fps = capture.get(cv2.CAP_PROP_FPS)
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            pts_ms = capture.get(cv2.CAP_PROP_POS_MSEC)
            if previous is not None:
                frame_periods.append(pts_ms - last_ms)
            hsv = cv2.cvtColor(frame[787:928, 398:536], cv2.COLOR_BGR2HSV)
            green = ((hsv[:, :, 0] >= 40) & (hsv[:, :, 0] <= 85)
                     & (hsv[:, :, 1] > 95) & (hsv[:, :, 2] > 155))
            for key, (x, y, w, h) in BUTTON_REGIONS.items():
                is_down = np.count_nonzero(green[y-787:y-787+h, x-398:x-398+w]) >= 18
                if is_down and key not in active:
                    active[key] = {"key": key, "down_frame": frame_index, "down_ms": round(pts_ms, 3)}
                    if key == "A" and pts_ms < 30000 and previous is not None:
                        cv2.imwrite(str(output / f"before-A-{frame_index}.png"), previous[:515])
                elif not is_down and key in active:
                    event = active.pop(key)
                    event.update(up_frame=frame_index, up_ms=round(pts_ms, 3),
                                 hold_ms=round(pts_ms-event["down_ms"], 3))
                    events.append(event)
            previous, last_ms = frame, pts_ms
            frame_index += 1
    finally:
        capture.release()
    if active:
        raise ValueError("Recording ends with a visible button held; its release cannot be measured")
    events.sort(key=lambda event: (event["down_frame"], event["key"]))
    previous_a = None
    for event in events:
        if event["key"] == "A":
            if previous_a is not None:
                event["since_previous_A_down_ms"] = round(event["down_ms"]-previous_a["down_ms"], 3)
                event["since_previous_A_up_ms"] = round(event["down_ms"]-previous_a["up_ms"], 3)
            previous_a = event
    with video.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    result = {"source": str(video.resolve()), "sha256": digest, "size": size,
              "frames": frame_index, "container_average_fps": average_fps,
              "median_frame_period_ms": round(float(np.median(frame_periods)), 3),
              "uncertainty": "Each edge is localized to one recorded frame; this does not measure serial or capture latency.",
              "button_regions": BUTTON_REGIONS, "events": events}
    (output / "controller-timing.json").write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = analyze(args.video, args.output)
    print(json.dumps(result, ensure_ascii=False, indent=2))
