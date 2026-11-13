"""Model inference and caching for the FloodNet visual cue detector."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_MODEL = None
_METADATA: dict[str, Any] | None = None


def load_cue_model(model_dir: Path = Path("models/flood_cue")):
    global _MODEL, _METADATA
    if _MODEL is not None and _METADATA is not None:
        return _MODEL, _METADATA
    meta_path = model_dir / "flood_cue.json"
    ts_path = model_dir / "flood_cue.ts"
    if not meta_path.is_file() or not ts_path.is_file():
        return None, None
    try:
        import torch

        _METADATA = json.loads(meta_path.read_text(encoding="utf-8"))
        _MODEL = torch.jit.load(str(ts_path), map_location="cpu").eval()
        return _MODEL, _METADATA
    except Exception:
        return None, None


def score_image_bytes(image_bytes: bytes, model: Any, metadata: dict[str, Any]) -> dict[str, Any]:
    import io
    import numpy as np
    import torch
    from PIL import Image

    size = metadata.get("input_size", 320)
    mean = np.asarray(metadata.get("mean", [0.485, 0.456, 0.406]), dtype=np.float32)
    std = np.asarray(metadata.get("std", [0.229, 0.224, 0.225]), dtype=np.float32)
    threshold = metadata.get("threshold", 0.5)

    with Image.open(io.BytesIO(image_bytes)) as img:
        rgb = img.convert("RGB").resize((size, size), Image.Resampling.BILINEAR)
    pixels = np.asarray(rgb, dtype=np.float32) / 255.0
    tensor = torch.from_numpy(((pixels - mean) / std).transpose(2, 0, 1).copy()).unsqueeze(0)
    with torch.inference_mode():
        prob = float(model(tensor).sigmoid().item())

    return {
        "cue_score": round(prob, 4),
        "threshold": threshold,
        "above_threshold": prob >= threshold,
        "confidence": "high" if abs(prob - threshold) >= 0.2 else "marginal",
        "label": "Potential flooded road/structure" if prob >= threshold else "No strong flood cue",
        "disclaimer": "Experimental FloodNet UAV cue. Not ground truth or flood depth.",
    }


def get_image_cue(
    image_id: str,
    image_file: Path,
    model_dir: Path = Path("models/flood_cue"),
    cache_dir: Path = Path("reviews/cues"),
) -> dict[str, Any] | None:
    cache_file = cache_dir / f"{image_id}.json"
    if cache_file.is_file():
        try:
            return json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    model, meta = load_cue_model(model_dir)
    if model is None or meta is None:
        return None

    if not image_file.is_file():
        return None

    try:
        result = score_image_bytes(image_file.read_bytes(), model, meta)
        result["image_id"] = image_id
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(result, indent=2), encoding="utf-8")
        return result
    except Exception:
        return None
