"""Score aerial photos with the experimental FloodNet image-level model.

Example: python predict_flood_cue.py UTSA-flood-images/path/to/photo.jpg
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+", type=Path, help="One or more aerial JPG/PNG images")
    parser.add_argument("--model-dir", type=Path, default=Path("models/flood_cue"))
    args = parser.parse_args()

    import numpy as np
    import torch
    from PIL import Image

    metadata = json.loads((args.model_dir / "flood_cue.json").read_text())
    model = torch.jit.load(str(args.model_dir / "flood_cue.ts"), map_location="cpu").eval()
    size = metadata["input_size"]
    mean = np.asarray(metadata["mean"], dtype=np.float32)
    std = np.asarray(metadata["std"], dtype=np.float32)

    for path in args.images:
        with Image.open(path) as image:
            rgb = image.convert("RGB").resize((size, size), Image.Resampling.BILINEAR)
        pixels = np.asarray(rgb, dtype=np.float32) / 255.0
        tensor = torch.from_numpy(((pixels - mean) / std).transpose(2, 0, 1).copy()).unsqueeze(0)
        with torch.inference_mode():
            probability = float(model(tensor).sigmoid().item())
        print(json.dumps({
            "image": str(path),
            "flooded_road_or_building_cue": round(probability, 4),
            "above_validation_threshold": probability >= metadata["threshold"],
            "threshold": metadata["threshold"],
            "note": "Experimental visual cue. Not validated on UTSA imagery or suitable for safety decisions.",
        }))


if __name__ == "__main__":
    main()
