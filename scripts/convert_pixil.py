"""Convert Pixilart .pixil JSON exports to PNG files."""

from __future__ import annotations

import base64
import json
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image


def decode_pixil_data_url(src: str) -> Image.Image | None:
    if not isinstance(src, str) or "base64," not in src:
        return None
    b64 = src.split("base64,", 1)[1]
    # Pad base64 if needed
    pad = (-len(b64)) % 4
    if pad:
        b64 += "=" * pad
    try:
        raw = base64.b64decode(b64)
        return Image.open(BytesIO(raw)).convert("RGBA")
    except Exception:
        return None


def composite_frame(frame: dict, width: int, height: int) -> Image.Image:
    out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for layer in frame.get("layers", []):
        if layer.get("active") is False:
            continue
        img = decode_pixil_data_url(layer.get("src", ""))
        if img is None:
            continue
        if img.size != (width, height):
            img = img.resize((width, height), Image.NEAREST)
        opacity = float(layer.get("opacity", 1) or 1)
        if opacity < 1:
            a = img.split()[3].point(lambda p: int(p * opacity))
            img.putalpha(a)
        out = Image.alpha_composite(out, img)
    return out


def key_out_near_black(img: Image.Image, threshold: int = 12) -> Image.Image:
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 0 and r <= threshold and g <= threshold and b <= threshold:
                px[x, y] = (0, 0, 0, 0)
    return img


def convert(src: Path, out: Path, key_black: bool = False) -> None:
    data = json.loads(src.read_text(encoding="utf-8"))
    width = int(data["width"])
    height = int(data["height"])
    frames = [composite_frame(f, width, height) for f in data["frames"]]
    if key_black:
        frames = [key_out_near_black(f) for f in frames]
    if len(frames) == 1:
        frames[0].save(out)
    else:
        sheet = Image.new("RGBA", (width * len(frames), height), (0, 0, 0, 0))
        for i, fr in enumerate(frames):
            sheet.paste(fr, (i * width, 0))
        sheet.save(out)
    print(f"{src.name}: {len(frames)}x{width}x{height} -> {out}")


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("usage: convert_pixil.py <src.pixil> <out.png> [--key-black]")
    convert(Path(sys.argv[1]), Path(sys.argv[2]), key_black="--key-black" in sys.argv)


if __name__ == "__main__":
    main()
