"""Derive the transparent EasyCon shell without changing the source PNG.

Run with .deps/script-python/Scripts/python.exe (OpenCV is already a runtime
dependency). Matches auto-bdsp-rng's white removal and also removes the white
matte from exterior antialias pixels, which otherwise glow on dark desktops.
"""
from collections import deque
from pathlib import Path

import cv2
import numpy as np

asset_dir = Path(__file__).resolve().parents[1] / "src/assets/vpad"
image = cv2.imread(str(asset_dir / "JoyCon.png"), cv2.IMREAD_UNCHANGED)
height, width = image.shape[:2]
exterior = np.zeros((height, width), dtype=bool)
queue = deque((x, y) for y in range(height) for x in range(width)
              if x in (0, width - 1) or y in (0, height - 1))
while queue:
    x, y = queue.popleft()
    if not (0 <= x < width and 0 <= y < height) or exterior[y, x]:
        continue
    b, g, r, a = map(int, image[y, x])
    # Only traverse transparent space and the light, neutral outer matte.
    if a and (max(b, g, r) - min(b, g, r) > 2 or min(b, g, r) < 128):
        continue
    exterior[y, x] = True
    queue.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))

for y, x in np.argwhere(exterior):
    brightness = int(min(image[y, x, :3]))
    alpha = int(image[y, x, 3])
    image[y, x] = [0, 0, 0, round(alpha * (255 - brightness) / 255)]
# Same threshold as the original _load_background_asset.
image[np.min(image[:, :, :3], axis=2) >= 253] = [0, 0, 0, 0]
cv2.imwrite(str(asset_dir / "JoyCon-transparent.png"), image)
