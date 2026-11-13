"""Serve paired flood images, model dossiers, and visual cues to the Expo mobile app."""

from __future__ import annotations

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from src.catalog import image_path, load_catalog, pairs, search_pairs
from src.cues import get_image_cue, load_cue_model
from src.dossiers import load_dossier
from src.model_results import change_for, change_scores, models_summary, scenarios, water_for
from src.reviews import load_reviews_index, save_review

ROOT = Path(__file__).resolve().parent


def change_scores_trained() -> bool:
    return bool(change_scores().get("model", {}).get("trained"))


def pair_data(
    index: int,
    pair: tuple[dict, dict],
    data_dir: Path,
    dossier_dir: Path | None = None,
    model_dir: Path = Path("models/flood_cue"),
    reviews_file: Path = Path("reviews/reviews.jsonl"),
) -> dict:
    before, after = pair
    record = {
        "index": index,
        "before_id": before["image_id"],
        "after_id": after["image_id"],
        "locality": before.get("locality") or after.get("locality") or "Unknown locality",
        "before_date": before.get("acquisition_date") or "Unknown date",
        "after_date": after.get("acquisition_date") or "Unknown date",
        "source": after.get("source_agency") or before.get("source_agency") or "",
        "before_url": f"/image/{before['image_id']}",
        "after_url": f"/image/{after['image_id']}",
        "latitude": before.get("latitude") or after.get("latitude") or "",
        "longitude": before.get("longitude") or after.get("longitude") or "",
    }

    # Vision model dossier (multimodal VLM cautious comparison)
    if dossier_dir is not None:
        record["dossier"] = load_dossier(dossier_dir, before["image_id"], after["image_id"])
    else:
        record["dossier"] = None

    # Visual cue model scores (distinct from VLM dossier)
    try:
        before_file = image_path(data_dir, before)
        record["before_cue"] = get_image_cue(before["image_id"], before_file, model_dir)
    except Exception:
        record["before_cue"] = None

    try:
        after_file = image_path(data_dir, after)
        record["after_cue"] = get_image_cue(after["image_id"], after_file, model_dir)
    except Exception:
        record["after_cue"] = None

    # Photo change model (self-supervised, trained on Colab): rank + heatmap
    record["change"] = change_for(after["image_id"])
    # Floodwater colour index (rule-based, validated by eye): rank + heatmap
    record["water"] = water_for(after["image_id"])

    # Human review status if reviewed
    reviews_map = load_reviews_index(reviews_file)
    record["review"] = reviews_map.get((before["image_id"], after["image_id"]))

    return record


def make_handler(data_dir: Path, model_dir: Path = Path("models/flood_cue")):
    catalog = load_catalog(data_dir)
    all_pairs = pairs(catalog)
    by_id = {row["image_id"]: row for pair in all_pairs for row in pair}
    dossier_dir = Path(os.getenv("FLOOD_DOSSIER_DIR", "reviews/dossiers"))
    reviews_file = Path(os.getenv("FLOOD_REVIEWS_FILE", "reviews/reviews.jsonl"))

    class Handler(BaseHTTPRequestHandler):
        def _send_cors_headers(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

        def do_HEAD(self):
            # Same headers as GET without writing the response body
            parsed = urlparse(self.path)
            if parsed.path.startswith("/image/"):
                image_id = parsed.path.removeprefix("/image/")
                row = by_id.get(image_id)
                if row is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                try:
                    path = image_path(data_dir, row)
                    size = path.stat().st_size
                except (OSError, ValueError):
                    self.send_response(404)
                    self.end_headers()
                    return
                content_type = {
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".webp": "image/webp",
                }.get(path.suffix.lower(), "application/octet-stream")
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(size))
                self._send_cors_headers()
                self.send_header("Cache-Control", "private, max-age=300")
                self.end_headers()
                return
            self.send_response(200)
            self._send_cors_headers()
            self.end_headers()

        def do_OPTIONS(self):
            self.send_response(204)
            self._send_cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def send_bytes(self, status: int, body: bytes, content_type: str):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self._send_cors_headers()
            self.send_header("Cache-Control", "no-store" if content_type == "application/json" else "private, max-age=300")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def send_json(self, status: int, value: any):
            self.send_bytes(status, json.dumps(value, ensure_ascii=False).encode("utf-8"), "application/json")

        def do_GET(self):
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)

            if parsed.path == "/" or parsed.path == "/api/status":
                cue_model, cue_meta = load_cue_model(model_dir)
                self.send_json(200, {
                    "name": "Flood Time Machine API",
                    "status": "ready",
                    "pairs": len(all_pairs),
                    "cue_model_available": cue_model is not None,
                    "change_model_trained": change_scores_trained(),
                    "river_forecaster_trained": bool(scenarios().get("model", {}).get("trained")),
                    "cue_model_info": cue_meta if cue_meta else None,
                    "vlm_endpoint": os.getenv("GB10_BASE_URL", "http://127.0.0.1:11434/v1"),
                })
                return

            if parsed.path == "/api/pairs":
                q = query.get("q", [""])[0].strip()
                if q:
                    matching = search_pairs(all_pairs, q)
                    matched_indices = [all_pairs.index(p) for p in matching]
                    self.send_json(200, [
                        pair_data(idx, all_pairs[idx], data_dir, dossier_dir, model_dir, reviews_file)
                        for idx in matched_indices[:100]
                    ])
                else:
                    self.send_json(200, [
                        pair_data(i, p, data_dir, dossier_dir, model_dir, reviews_file)
                        for i, p in enumerate(all_pairs)
                    ])
                return

            if parsed.path == "/api/pair":
                try:
                    index = int(query.get("index", ["0"])[0])
                    if index < 0 or index >= len(all_pairs):
                        raise IndexError
                    pair = all_pairs[index]
                except (IndexError, ValueError):
                    self.send_json(404, {"error": "Unknown pair index"})
                    return
                self.send_json(200, pair_data(index, pair, data_dir, dossier_dir, model_dir, reviews_file))
                return

            if parsed.path.startswith("/image/"):
                image_id = parsed.path.removeprefix("/image/")
                row = by_id.get(image_id)
                if row is None:
                    self.send_json(404, {"error": "Unknown image"})
                    return
                try:
                    path = image_path(data_dir, row)
                    body = path.read_bytes()
                except (OSError, ValueError):
                    self.send_json(404, {"error": "Image unavailable"})
                    return
                content_type = {
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".webp": "image/webp",
                }.get(path.suffix.lower())
                if not content_type:
                    self.send_json(415, {"error": "Unsupported image type"})
                    return
                self.send_bytes(200, body, content_type)
                return

            if parsed.path == "/api/models":
                self.send_json(200, models_summary())
                return

            if parsed.path == "/api/scenarios":
                self.send_json(200, scenarios())
                return

            if parsed.path == "/api/forecast":
                gauge = query.get("gauge", [""])[0].strip()
                try:
                    import sys as _sys

                    _sys.path.insert(0, str(ROOT / "ml"))
                    from live_forecast import forecast  # needs pandas, numpy, lightgbm
                except ImportError as exc:
                    self.send_json(503, {"error": f"Live forecasting needs pandas, numpy and lightgbm on the server ({exc})"})
                    return
                if not gauge:
                    from data_sources import GAUGES

                    self.send_json(200, {"gauges": {g: v["name"] for g, v in GAUGES.items()}})
                    return
                try:
                    self.send_json(200, forecast(gauge))
                except KeyError as exc:
                    self.send_json(404, {"error": str(exc)})
                except Exception as exc:  # upstream API or data gap
                    self.send_json(502, {"error": f"Could not build a forecast right now: {exc}"})
                return

            if parsed.path == "/api/reviews":
                reviews = load_reviews_index(reviews_file)
                self.send_json(200, list(reviews.values()))
                return

            self.send_json(404, {"error": "Not found"})

        def do_POST(self):
            parsed = urlparse(self.path)
            if parsed.path == "/api/review":
                length = int(self.headers.get("Content-Length", 0))
                if length <= 0 or length > 65536:
                    self.send_json(400, {"error": "Invalid payload size"})
                    return
                try:
                    payload = json.loads(self.rfile.read(length).decode("utf-8"))
                    before_id = str(payload.get("before_id", "")).strip()
                    after_id = str(payload.get("after_id", "")).strip()
                    agreement = str(payload.get("agreement", "")).strip()
                    notes = str(payload.get("notes", "")).strip()
                    reviewer = str(payload.get("reviewer", "mobile_user")).strip()
                    if not before_id or not after_id or not agreement:
                        self.send_json(400, {"error": "Missing before_id, after_id, or agreement"})
                        return
                    record = save_review(reviews_file, before_id, after_id, agreement, notes, reviewer)
                    self.send_json(201, {"status": "saved", "review": record})
                except Exception as exc:
                    self.send_json(400, {"error": f"Failed to save review: {exc}"})
                return

            self.send_json(404, {"error": "Not found"})

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Serve the Flood Time Machine API")
    parser.add_argument("--data-dir", default=os.getenv("FLOOD_DATA_DIR", "UTSA-flood-images"))
    parser.add_argument("--model-dir", default=os.getenv("FLOOD_MODEL_DIR", "models/flood_cue"))
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    data_dir = Path(args.data_dir).expanduser().resolve()
    model_dir = Path(args.model_dir).expanduser().resolve()
    if not data_dir.is_dir():
        parser.error(f"Data directory not found: {data_dir}")

    server = ThreadingHTTPServer((args.host, args.port), make_handler(data_dir, model_dir))
    print(f"Flood Time Machine API running at: http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        server.server_close()


if __name__ == "__main__":
    main()
