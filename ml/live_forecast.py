"""Run the trained river forecaster on live data for one gauge.

Uses the LightGBM models saved by train_stage_forecaster.py (one per lead
time) and builds features with the exact same add_features() code used in
training. Inputs:
  - last 4 days of 15-minute gauge height from the USGS Water Data API
  - hourly rain from Open-Meteo: the past 4 days plus the next hours'
    forecast, which fills the "rain in the next k hours" features the model
    was trained with

Needs pandas, numpy and lightgbm (the same environment as training). The API
server imports this lazily and reports 503 if they are missing.

    python ml/live_forecast.py USGS-08165500
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from data_sources import GAUGES, USGS_URL  # noqa: E402
from train_stage_forecaster import add_features  # noqa: E402

ROOT = HERE.parent
MODEL_DIR = ROOT / "models" / "stage_forecaster"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
_CACHE: dict[str, tuple[float, dict]] = {}
_MODELS: dict = {}


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "flood-time-machine-datathon/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def _load_models():
    if not _MODELS:
        import lightgbm as lgb

        meta = json.loads((MODEL_DIR / "metrics.json").read_text())
        H = int(meta["horizons"])
        _MODELS["meta"] = meta
        _MODELS["boosters"] = [lgb.Booster(model_file=str(MODEL_DIR / f"lgbm_lead{h:02d}.txt")) for h in range(1, H + 1)]
    return _MODELS["meta"], _MODELS["boosters"]


def _recent_stage(gauge: str, start: datetime, end: datetime) -> pd.Series:
    params = {
        "monitoring_location_id": gauge,
        "parameter_code": "00065",
        "time": f"{start:%Y-%m-%dT%H:%M:%SZ}/{end:%Y-%m-%dT%H:%M:%SZ}",
        "limit": "50000",
        "skipGeometry": "true",
        "properties": "time,value",
        "f": "json",
    }
    d = _get(f"{USGS_URL}?{urllib.parse.urlencode(params)}")
    rows = [(f["properties"]["time"], float(f["properties"]["value"])) for f in d.get("features", []) if f["properties"].get("value") not in (None, "")]
    if not rows:
        return pd.Series(dtype=float)
    s = pd.Series([v for _, v in rows], index=pd.to_datetime([t for t, _ in rows], utc=True)).sort_index()
    s = s[~s.index.duplicated()]
    s = s[(s.diff().abs().fillna(0) < 15)]
    return s.resample("1h").mean().interpolate(limit=6, limit_area="inside")


def _rain(lat: float, lon: float) -> pd.Series:
    # Same 0.25 degree snapping as training
    lat, lon = round(lat * 4) / 4, round(lon * 4) / 4
    params = {"latitude": lat, "longitude": lon, "hourly": "precipitation", "past_days": 4, "forecast_days": 2, "timezone": "GMT"}
    d = _get(f"{FORECAST_URL}?{urllib.parse.urlencode(params)}")
    t = pd.to_datetime([x + ":00Z" for x in d["hourly"]["time"]], utc=True)
    return pd.Series([v if v is not None else 0.0 for v in d["hourly"]["precipitation"]], index=t)


def forecast(gauge: str, cache_seconds: int = 600) -> dict:
    if gauge not in GAUGES:
        raise KeyError(f"Unknown gauge {gauge}. Known: {', '.join(GAUGES)}")
    hit = _CACHE.get(gauge)
    if hit and time.time() - hit[0] < cache_seconds:
        return hit[1]

    meta, boosters = _load_models()
    H = len(boosters)
    cols = meta["features"]
    stats = meta["gauge_stats"]
    if gauge not in stats:
        raise KeyError(f"{gauge} has no training statistics")

    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    stage = _recent_stage(gauge, now - timedelta(days=4), now + timedelta(hours=1))
    if stage.dropna().empty:
        raise RuntimeError("USGS returned no recent readings for this gauge")
    rain = _rain(GAUGES[gauge]["lat"], GAUGES[gauge]["lon"])

    idx = pd.date_range(stage.index.min(), rain.index.max(), freq="1h")
    df = pd.DataFrame({"stage": stage.reindex(idx), "rain": rain.reindex(idx).fillna(0.0)}, index=idx)
    df["gauge"] = gauge
    feats = add_features(df, H, stats)

    issued = stage.dropna().index.max()  # latest hour with a reading
    row = feats.loc[[issued], cols]
    if row[["ds_1", "ds_3", "ds_24"]].isna().any(axis=None):
        raise RuntimeError("Not enough recent readings to build features (gauge gap)")
    current = float(df.loc[issued, "stage"])
    rises = [float(b.predict(row.values)[0]) for b in boosters]

    result = {
        "gauge": gauge,
        "name": GAUGES[gauge]["name"],
        "issued_at": issued.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "current_ft": round(current, 2),
        "forecast": [
            {"lead_h": h, "time": (issued + pd.Timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ"), "stage_ft": round(current + r, 2), "rise_ft": round(r, 2)}
            for h, r in enumerate(rises, start=1)
        ],
        "rain_next_6h_mm": round(float(rain[(rain.index > issued) & (rain.index <= issued + pd.Timedelta(hours=6))].sum()), 1),
        "model": f"{meta['selected']} trained {meta['trained_at'][:10]}",
        "note": "Experimental. Uses forecast rainfall. Not an official flood forecast; follow the National Weather Service.",
    }
    _CACHE[gauge] = (time.time(), result)
    return result


if __name__ == "__main__":
    print(json.dumps(forecast(sys.argv[1] if len(sys.argv) > 1 else "USGS-08165500"), indent=2))
