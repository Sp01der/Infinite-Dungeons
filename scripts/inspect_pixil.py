import json
import base64
from pathlib import Path
from io import BytesIO

from PIL import Image


def inspect(path: str) -> None:
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    print("===", Path(path).name, "===")
    print("size", d["width"], d["height"], "frames", len(d["frames"]))
    for i, f in enumerate(d["frames"]):
        print(" frame", i, "keys", list(f.keys()))
        for k, v in f.items():
            if isinstance(v, str):
                print("  ", k, "str", len(v), v[:80].replace("\n", " "))
            elif isinstance(v, list):
                print("  ", k, "list", len(v), "sample", v[0] if v else None)
            elif isinstance(v, dict):
                print("  ", k, "dict", list(v.keys())[:10])
            else:
                print("  ", k, type(v).__name__, v)
    prev = d.get("preview", "")
    if isinstance(prev, str) and prev.startswith("data:image"):
        b64 = prev.split(",", 1)[1]
        # pixil preview encoding is nonstandard; try common paths
        try:
            img = Image.open(BytesIO(base64.b64decode(b64)))
            print(" preview", img.size, img.mode)
        except Exception as e:
            print(" preview decode fail", e)


for p in [
    r"C:\Users\theod\Downloads\mapShifty.pixil",
    r"C:\Users\theod\Downloads\Shifty'sDialogue.pixil",
    r"C:\Users\theod\Downloads\potionOfHarming.pixil",
]:
    inspect(p)
    print()
