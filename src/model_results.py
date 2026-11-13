"""Read the trained models' saved outputs for the API (stdlib only).

Both models were trained offline (Colab L4 and the USAA Datathon Qwen server)
and wrote their results as JSON into the app bundle:

  mobile-app/src/data/changeScores.json    photo change model, one entry per pair
  mobile-app/src/data/floodScenarios.json  river forecaster replays of held-out floods
  models/*/metrics.json                    evaluation against baselines

The server reads the same files so the app gets identical numbers whether it
uses its bundle or a live connection.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_DATA = ROOT / "mobile-app" / "src" / "data"


def _read(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


@lru_cache(maxsize=1)
def change_scores() -> dict:
    return _read(APP_DATA / "changeScores.json") or {"model": {"trained": False}, "pairs": {}}


def change_for(after_id: str) -> dict | None:
    return change_scores().get("pairs", {}).get(after_id)


@lru_cache(maxsize=1)
def water_scores() -> dict:
    return _read(APP_DATA / "waterScores.json") or {"model": {}, "pairs": {}}


def water_for(after_id: str) -> dict | None:
    return water_scores().get("pairs", {}).get(after_id)


def flood_scores() -> dict:
    # not cached: retraining rewrites it while the server runs
    return _read(APP_DATA / "floodScores.json") or {"model": {"trained": False}, "pairs": {}}


def flood_for(after_id: str) -> dict | None:
    d = flood_scores()
    return d["pairs"].get(after_id) if d.get("model", {}).get("trained") else None


@lru_cache(maxsize=1)
def scenarios() -> dict:
    return _read(APP_DATA / "floodScenarios.json") or {"model": {"trained": False}, "scenarios": []}


def models_summary() -> dict:
    """Headline numbers for both models, each next to its baseline."""
    out: dict = {}
    fc = _read(ROOT / "models" / "stage_forecaster" / "metrics.json")
    if fc:
        sel = fc["selected"]
        res = fc["results"]

        def leads(model: str, split: str) -> dict | None:
            r = res.get(model, {}).get(split)
            if not r:
                return None
            return {h: round(r["by_lead"][h]["rmse"], 3) for h in ("1", "3", "6", "12") if h in r["by_lead"]}

        out["river_forecaster"] = {
            "trained_at": fc["trained_at"],
            "selected": sel,
            "question": "How many feet will the river rise in the next 1-12 hours?",
            "rows": fc["rows"],
            "rmse_ft_test": leads(sel, "test"),
            "rmse_ft_test_baseline": leads("persistence", "test"),
            "rmse_ft_held_out_floods": leads(sel, "events"),
            "rmse_ft_held_out_floods_baseline": leads("persistence", "events"),
            "baseline": "persistence (river stays at its current level)",
            "future_rain_assumed": fc.get("future_rain_assumed"),
        }
    cd = _read(ROOT / "models" / "change_detector" / "metrics.json")
    if cd:
        out["photo_change_model"] = {
            "trained_at": cd["trained_at"],
            "question": "Where did the ground change between the 2016 and 2017 photos?",
            "pairs": cd["pairs"],
            "checks": cd["checks"],
            "baseline": "naive feature distance without the camera translator",
        }
    fs = flood_scores().get("model")
    if fs and fs.get("trained"):
        out["flood_classifier"] = fs
    ws = water_scores().get("model")
    if ws:
        out["floodwater_colour_index"] = ws
    return out
