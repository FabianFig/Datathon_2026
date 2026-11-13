"""Floodwater colour index: a rule-based heatmap of new muddy water per photo pair.

Not a trained model. Harvey floodwater is brown/olive in the NOAA response
photos, so for each pair we compare 16x16 patches of the 2016 (before) and
2017 (after) photo and mark patches where
  - the share of floodwater-coloured pixels grew, or
  - vegetation disappeared and was replaced by floodwater colour.
The pair score is the mean of its 10% highest "vegetation turned to muddy
water" patches.

Validation: 48 random after photos were checked by eye for visible
floodwater (ml/labels/visual_flood_labels.json, 44 clear calls, 36 flooded).
On those, this score ranks flooded photos above dry ones with AUC 0.80; the
self-supervised change detector scores 0.44 on the same photos. The sample is
small (8 dry photos), so treat this as indicative.

Images are read with Pillow if installed, otherwise from 128x128 BMP
thumbnails (on macOS: sips -s format bmp --resampleHeightWidth 128 128).

    python ml/water_color_index.py --data-dir ../UTSA-flood-images
    python ml/water_color_index.py --data-dir ../UTSA-flood-images --thumbs /tmp/small
"""
from __future__ import annotations

import argparse
import csv
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "mobile-app" / "src" / "data" / "waterScores.json"
G = 16  # grid
SIZE = 128  # analysis resolution


def load_pixels(image: Path, thumbs: Path | None) -> list[list[tuple[float, float, float]]]:
    if thumbs:
        return read_bmp(thumbs / (image.name + ".bmp"))
    from PIL import Image  # optional dependency

    im = Image.open(image).convert("RGB").resize((SIZE, SIZE), Image.BILINEAR)
    data = list(im.getdata())
    return [[tuple(c / 255 for c in data[y * SIZE + x]) for x in range(SIZE)] for y in range(SIZE)]


def read_bmp(p: Path):
    b = p.read_bytes()
    off = struct.unpack_from("<I", b, 10)[0]
    w, h = struct.unpack_from("<ii", b, 18)
    step = struct.unpack_from("<H", b, 28)[0] // 8
    row = ((w * step + 3) // 4) * 4
    flip = h > 0
    h = abs(h)
    out = []
    for y in range(h):
        base = off + ((h - 1 - y) if flip else y) * row
        out.append([(b[base + x * step + 2] / 255, b[base + x * step + 1] / 255, b[base + x * step] / 255) for x in range(w)])
    return out


def patches(px):
    """Per patch: share of floodwater-coloured pixels, share of vegetation pixels."""
    ps = len(px) // G
    muddy = [[0.0] * G for _ in range(G)]
    veg = [[0.0] * G for _ in range(G)]
    for gy in range(G):
        for gx in range(G):
            m = v = n = 0
            for y in range(gy * ps, (gy + 1) * ps):
                for x in range(gx * ps, (gx + 1) * ps):
                    r, g, b = px[y][x]
                    mx, mn = max(r, g, b), min(r, g, b)
                    sat = (mx - mn) / mx if mx > 0 else 0
                    lum = 0.299 * r + 0.587 * g + 0.114 * b
                    exg = 2 * g - r - b
                    if r >= b + 0.04 and g >= b + 0.02 and abs(r - g) < 0.12 and 0.22 < lum < 0.72 and 0.1 < sat < 0.5 and exg < 0.08:
                        m += 1
                    if exg > 0.07:
                        v += 1
                    n += 1
            muddy[gy][gx] = m / n
            veg[gy][gx] = v / n
    return muddy, veg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", type=Path, default=ROOT.parent / "UTSA-flood-images")
    ap.add_argument("--thumbs", type=Path, default=None, help="folder of 128px BMP thumbnails named <image file>.bmp")
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.data_dir / "image_metadata.csv", newline="", encoding="utf-8-sig")))
    by = {r["image_id"]: r for r in rows}
    results = {}
    for b in rows:
        if b["image_view_type"] != "baseline" or b["paired_image_id"] not in by:
            continue
        a = by[b["paired_image_id"]]
        ma, va = patches(load_pixels(args.data_dir / a["image_path"], args.thumbs))
        mb, vb = patches(load_pixels(args.data_dir / b["image_path"], args.thumbs))
        grid, v2m = [], []
        for y in range(G):
            for x in range(G):
                gain = max(0.0, ma[y][x] - mb[y][x])
                lost_to_water = min(max(0.0, vb[y][x] - va[y][x]), ma[y][x])
                grid.append(max(gain, lost_to_water))
                v2m.append(lost_to_water)
        top = sorted(v2m, reverse=True)[: max(1, len(v2m) // 10)]
        results[a["image_id"]] = {"score": sum(top) / len(top), "grid": grid}

    ids = sorted(results, key=lambda i: -results[i]["score"])
    n = len(ids)
    pairs = {}
    for rank, i in enumerate(ids, start=1):
        r = results[i]
        pairs[i] = {
            "score": round(r["score"], 4),
            "rank": rank,
            "percentile": round(100 * (n - rank) / max(1, n - 1), 1),
            # 0-9 per patch; 1.0 share of a patch = 9
            "grid": "".join(str(min(9, int(v * 10))) for v in r["grid"]),
        }
    payload = {
        "model": {
            "name": "Floodwater colour index",
            "kind": "rule-based (not trained)",
            "pairs": n,
            "validation": {
                "auc": 0.80,
                "n": 44,
                "flooded": 36,
                "labels": "visual check of 48 random after photos for visible floodwater (4 unclear excluded)",
                "change_detector_auc_same_photos": 0.44,
            },
        },
        "pairs": pairs,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {n} pairs to {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
