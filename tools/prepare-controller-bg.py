"""Build the dark mapping-window controller art from the supplied source PNG.

The source drawing is a white controller on a transparent canvas.  A direct
threshold conversion leaves white anti-aliased pixels around the shell, which
show up as broken bright lines on the dark UI.  Re-colour the source by tone
and composite it onto the same neutral canvas used by the mapping board.
"""

from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
source = cv2.imread(str(ROOT / "src/assets/controller_bg.png"), cv2.IMREAD_UNCHANGED)
if source is None or source.shape[-1] != 4:
    raise RuntimeError("controller_bg.png must be an RGBA PNG")

background = np.array([41, 41, 37], dtype=np.float32)  # BGR #252929
shell = np.array([16, 20, 19], dtype=np.float32)       # BGR #131413
body = np.array([57, 58, 53], dtype=np.float32)        # BGR #353a39
stick = np.array([141, 141, 141], dtype=np.float32)

rgb = source[:, :, :3].astype(np.float32)
alpha = source[:, :, 3:4].astype(np.float32) / 255.0
tone = rgb.mean(axis=2)

# The two stick caps are intentionally lighter than the shell.  Their source
# fill is a stable mid-grey, so preserve that visual cue after recolouring.
stick_mask = np.all(source[:, :, :3] == 121, axis=2) & (alpha[:, :, 0] > 0.98)

# The source's anti-aliased white-on-black edge contains a handful of bright
# pixels.  A two-tone mask removes those isolated highlights; the browser adds
# its own smooth edge when this image is scaled in the dialog.
mapped = np.where((tone >= 128.0)[:, :, None], body, shell)
mapped[stick_mask] = stick

canvas = np.broadcast_to(background, source[:, :, :3].shape).copy()
canvas = canvas * (1.0 - alpha) + mapped * alpha
output = np.dstack([np.clip(canvas, 0, 255).astype(np.uint8), np.full(source.shape[:2], 255, np.uint8)])
cv2.imwrite(str(ROOT / "src/assets/controller_bg_dark.png"), output)
