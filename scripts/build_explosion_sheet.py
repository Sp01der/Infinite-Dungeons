"""Rebuild public/assets/fireball_explosion.png from the source GIF with transparency.

Background removal: flood-fill from the frame borders, clearing only background-colored
pixels connected to the edge so the explosion's white core is preserved.
"""

import sys
from collections import deque

from PIL import Image, ImageSequence

SRC = sys.argv[1]
OUT = sys.argv[2]


def clear_background(frame: Image.Image) -> Image.Image:
    rgba = frame.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()

    if any(px[x, y][3] == 0 for y in range(h) for x in range(w)):
        return rgba  # GIF transparency survived; nothing to key out.

    def is_bg(p):
        r, g, b, _ = p
        return r >= 240 and g >= 240 and b >= 240

    seen = set()
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_bg(px[x, y]):
                queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_bg(px[x, y]):
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h):
            continue
        seen.add((x, y))
        if not is_bg(px[x, y]):
            continue
        px[x, y] = (0, 0, 0, 0)
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    return rgba


gif = Image.open(SRC)
frames = [clear_background(f.copy()) for f in ImageSequence.Iterator(gif)]
fw, fh = frames[0].size
sheet = Image.new("RGBA", (fw * len(frames), fh), (0, 0, 0, 0))
for i, f in enumerate(frames):
    sheet.paste(f, (i * fw, 0))
sheet.save(OUT)
print(f"{len(frames)} frames of {fw}x{fh} -> {OUT}")
