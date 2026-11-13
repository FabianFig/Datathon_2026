"""Build the flood replay scenarios the mobile app animates.

Stdlib only. Pulls observed hourly river stage + rainfall for each held-out
event in data_sources.SCENARIOS and writes
mobile-app/src/data/floodScenarios.json.

train_stage_forecaster.py calls build() again with model forecasts so the app
can show "what the model predicted N hours earlier" next to what happened.

    python ml/build_scenarios.py --data-dir ../UTSA-flood-images
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from data_sources import GAUGES, SCENARIOS, fetch_rain, fetch_stage, fill_gaps, hourly, parse_utc

ROOT = Path(__file__).resolve().parent.parent
APP_JSON = ROOT / "mobile-app" / "src" / "data" / "floodScenarios.json"
HF_BASE = "https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images/resolve/main/"


def linked_images(data_dir: Path | None, gauge: str, event_id: str, limit: int = 4) -> list[dict]:
    """UTSA images whose metadata links them to this gauge for this event."""
    if not data_dir or not (data_dir / "image_metadata.csv").exists():
        return []
    rows = []
    with open(data_dir / "image_metadata.csv", newline="") as f:
        for r in csv.DictReader(f):
            if r["usgs_gage_height_station_id"] == gauge and r["event_id"] == event_id and r["image_view_type"] != "baseline":
                rows.append(
                    {
                        "image_id": r["image_id"],
                        "url": HF_BASE + r["image_path"],
                        "date": r["acquisition_date"],
                        "locality": r["locality"],
                        "source": r["source_agency"],
                    }
                )
    return rows[:limit]


def _trim(forecast: dict | None, n: int) -> dict | None:
    if not forecast:
        return None
    return {**forecast, "by_lead": {k: v[:n] for k, v in forecast["by_lead"].items()}}


def build(data_dir: Path | None = None, forecasts: dict | None = None, model: dict | None = None, out: Path = APP_JSON) -> dict:
    # Without the dataset folder (e.g. on Colab) keep the image links already in the JSON.
    previous = {}
    if out.exists():
        previous = {x["id"]: x.get("images", []) for x in json.loads(out.read_text()).get("scenarios", [])}
    scenarios = []
    for sc in SCENARIOS:
        g = GAUGES[sc["gauge"]]
        start, end = parse_utc(sc["start"]), parse_utc(sc["end"])
        print(f"{sc['id']}: {g['name']} {start:%Y-%m-%d} → {end:%Y-%m-%d}")
        stage = fill_gaps(hourly(fetch_stage(sc["gauge"], start, end), start, end))
        rain = fetch_rain(g["lat"], g["lon"], start, end)
        r_idx = {t: i for i, t in enumerate(rain["time"])}
        n = len(stage)
        hours = [datetime.fromtimestamp(start.timestamp() + 3600 * i, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") for i in range(n)]
        rain_mm = []
        for t in hours:
            i = r_idx.get(t)
            vals = [p[i] for p in rain["points"]] if i is not None else [0.0]
            rain_mm.append(round(sum(vals) / len(vals), 2))
        valid = [v for v in stage if v is not None]
        if not valid:
            print("  no stage data, skipped")
            continue
        # A gauge that stops reporting mid-flood (Hunt, 2025 was destroyed) gets
        # trimmed 2 h after its last reading and flagged for the app.
        last = max(i for i, v in enumerate(stage) if v is not None)
        gauge_lost_at = hours[last + 1] if last < n - 3 else None
        if gauge_lost_at:
            n = last + 3
            hours, stage, rain_mm = hours[:n], stage[:n], rain_mm[:n]
        entry = {
            **{k: sc[k] for k in ("id", "title", "event", "event_id")},
            "gauge_id": sc["gauge"],
            "gauge_name": g["name"],
            "lat": g["lat"],
            "lon": g["lon"],
            "timezone": "America/Chicago",
            "hours": hours,
            "stage_ft": [round(v, 2) if v is not None else None for v in stage],
            "rain_mm": rain_mm,
            "baseline_ft": round(valid[0], 2),
            "peak_ft": round(max(valid), 2),
            "gauge_lost_at": gauge_lost_at,
            "images": linked_images(data_dir, sc["gauge"], sc["event_id"]) or previous.get(sc["id"], []),
            "forecast": _trim((forecasts or {}).get(sc["id"]), n),
        }
        print(f"  {n} h, stage {entry['baseline_ft']} → peak {entry['peak_ft']} ft")
        scenarios.append(entry)

    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sources": {
            "stage": "USGS Water Data API, continuous gauge height (00065)",
            "rain": "Open-Meteo historical archive (ERA5), mean of gauge + 4 points 25 km away",
            "images": "UTSA Texas flood images (jennifer-fowler/UTSA-flood-images), CC BY-NC 4.0",
        },
        "model": model or {"trained": False, "name": None, "note": "Run ml/Flood_Stage_Forecaster.ipynb in Colab to add model forecasts."},
        "scenarios": scenarios,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
    return payload


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", type=Path, default=ROOT.parent / "UTSA-flood-images")
    args = ap.parse_args()
    existing = json.loads(APP_JSON.read_text()) if APP_JSON.exists() else {}
    keep = {s["id"]: s.get("forecast") for s in existing.get("scenarios", []) if s.get("forecast")}
    build(args.data_dir, forecasts=keep or None, model=existing.get("model") if keep else None)
