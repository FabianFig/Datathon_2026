"""Export a static HTTPS-ready mobile portal using public Hugging Face image URLs."""

import argparse
import json
import os
import shutil
from pathlib import Path
from urllib.parse import quote

from mobile_server import ROOT, pair_data
from src.catalog import load_catalog, pairs


DATASET_BASE = "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/"


def export(data_dir: Path, output_dir: Path):
    items = pairs(load_catalog(data_dir))
    output_dir.mkdir(parents=True, exist_ok=True)
    mobile_index = ROOT / "mobile" / "index.html"
    if mobile_index.is_file():
        shutil.copyfile(mobile_index, output_dir / "index.html")
    manifest = []
    dossier_dir = Path(os.getenv("FLOOD_DOSSIER_DIR", "reviews/dossiers"))
    for index, pair in enumerate(items):
        record = pair_data(index, pair, data_dir=data_dir, dossier_dir=dossier_dir)
        before, after = pair
        record["before_url"] = DATASET_BASE + quote(before["image_path"], safe="/")
        record["after_url"] = DATASET_BASE + quote(after["image_path"], safe="/")
        manifest.append(record)
    (output_dir / "pairs.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Exported {len(manifest)} pairs to {output_dir}")


def main():
    parser = argparse.ArgumentParser(description="Create a static mobile Time Portal")
    parser.add_argument("--data-dir", default=os.getenv("FLOOD_DATA_DIR", ""))
    parser.add_argument("--output-dir", default="mobile-public")
    args = parser.parse_args()
    if not args.data_dir:
        parser.error("Set FLOOD_DATA_DIR or pass --data-dir")
    export(Path(args.data_dir).expanduser(), Path(args.output_dir))


if __name__ == "__main__":
    main()
