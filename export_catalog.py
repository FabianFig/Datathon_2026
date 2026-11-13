"""Bundle the full UTSA before/after catalog into the mobile app.

Writes mobile-app/src/data/catalog.json with every reciprocal pair (575 Harvey
pairs), image URLs on Hugging Face, and any saved model dossiers, cached cue
scores and human reviews. The app then shows the whole dataset in Expo Go
without running mobile_server.py. Stdlib only.

    python export_catalog.py --data-dir ../UTSA-flood-images
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from urllib.parse import quote

from src.catalog import load_catalog, pairs
from src.dossiers import load_dossier
from src.reviews import load_reviews_index

ROOT = Path(__file__).resolve().parent
DATASET_BASE = "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/"
OUT = ROOT / "mobile-app" / "src" / "data" / "catalog.json"


def cached_cue(image_id: str) -> dict | None:
    path = ROOT / "reviews" / "cues" / f"{image_id}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", type=Path, default=Path(os.getenv("FLOOD_DATA_DIR", ROOT.parent / "UTSA-flood-images")))
    args = ap.parse_args()

    items = pairs(load_catalog(args.data_dir.expanduser()))
    reviews = load_reviews_index(ROOT / "reviews" / "reviews.jsonl")
    dossier_dir = ROOT / "reviews" / "dossiers"
    records = []
    for index, (before, after) in enumerate(items):
        rec = {
            "index": index,
            "before_id": before["image_id"],
            "after_id": after["image_id"],
            "locality": before.get("locality") or after.get("locality") or "Unknown locality",
            "before_date": before.get("acquisition_date") or "",
            "after_date": after.get("acquisition_date") or "",
            "source": after.get("source_agency") or "",
            "before_url": DATASET_BASE + quote(before["image_path"], safe="/"),
            "after_url": DATASET_BASE + quote(after["image_path"], safe="/"),
            "latitude": before.get("latitude") or "",
            "longitude": before.get("longitude") or "",
        }
        # Only include optional fields when present, to keep the bundle small
        dossier = load_dossier(dossier_dir, before["image_id"], after["image_id"])
        if dossier:
            rec["dossier"] = dossier
        for key, image in (("before_cue", before), ("after_cue", after)):
            cue = cached_cue(image["image_id"])
            if cue:
                rec[key] = cue
        review = reviews.get((before["image_id"], after["image_id"]))
        if review:
            rec["review"] = review
        records.append(rec)

    OUT.write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(records)} pairs to {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
