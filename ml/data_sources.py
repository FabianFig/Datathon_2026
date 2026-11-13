"""Stdlib-only fetchers for USGS gauge height and Open-Meteo hourly rainfall.

Used by both build_scenarios.py (runs anywhere, no numpy) and
train_stage_forecaster.py (Colab). Responses are cached as gzip JSON so
re-runs don't hit the APIs again.
"""
from __future__ import annotations

import gzip
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

USGS_URL = "https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items"
OPEN_METEO_URL = "https://archive-api.open-meteo.com/v1/archive"

# Gauges linked to UTSA images through image_metadata.csv
# (usgs_gage_height_station_id). Coordinates/drainage from USGS monitoring-locations.
GAUGES: dict[str, dict] = {
    "USGS-08114000": {"name": "Brazos Rv at Richmond", "lat": 29.5825, "lon": -95.7577, "drainage_sq_mi": 45107.0},
    "USGS-08069500": {"name": "W Fk San Jacinto Rv nr Humble", "lat": 30.0272, "lon": -95.258, "drainage_sq_mi": 1741.0},
    "USGS-08072680": {"name": "S Mayde Ck at Heathergold Dr nr Addicks", "lat": 29.8051, "lon": -95.7096, "drainage_sq_mi": 30.6},
    "USGS-08116400": {"name": "Dry Ck nr Rosenberg", "lat": 29.5119, "lon": -95.7469, "drainage_sq_mi": 8.65},
    "USGS-08073500": {"name": "Buffalo Bayou nr Addicks", "lat": 29.7619, "lon": -95.6058, "drainage_sq_mi": 277.0},
    "USGS-08073100": {"name": "Langham Ck at Addicks Res Outflow", "lat": 29.7903, "lon": -95.6239, "drainage_sq_mi": 136.0},
    "USGS-08072760": {"name": "Langham Ck at W Little York Rd", "lat": 29.8672, "lon": -95.6466, "drainage_sq_mi": 24.6},
    "USGS-08072800": {"name": "Langham Ck nr Addicks", "lat": 29.8358, "lon": -95.6258, "drainage_sq_mi": 48.9},
    "USGS-08041700": {"name": "Pine Island Bayou nr Sour Lake", "lat": 30.106, "lon": -94.3346, "drainage_sq_mi": 336.0},
    "USGS-08111850": {"name": "Brazos Rv at San Felipe", "lat": 29.8083, "lon": -96.0956, "drainage_sq_mi": 44670.0},
    "USGS-08072300": {"name": "Buffalo Bayou nr Katy", "lat": 29.7433, "lon": -95.8069, "drainage_sq_mi": 63.3},
    "USGS-08072730": {"name": "Bear Ck nr Barker", "lat": 29.8308, "lon": -95.6869, "drainage_sq_mi": 21.5},
    "USGS-08074800": {"name": "Keegans Bayou at Roark Rd", "lat": 29.6566, "lon": -95.5622, "drainage_sq_mi": 12.7},
    "USGS-08166250": {"name": "Guadalupe Rv nr Center Point", "lat": 29.9878, "lon": -99.11, "drainage_sq_mi": 553.0},
    "USGS-08166140": {"name": "Guadalupe Rv abv Bear Ck at Kerrville", "lat": 30.0697, "lon": -99.1953, "drainage_sq_mi": 494.0},
    "USGS-08166200": {"name": "Guadalupe Rv at Kerrville", "lat": 30.0533, "lon": -99.1634, "drainage_sq_mi": 510.0},
    "USGS-08165500": {"name": "Guadalupe Rv at Hunt", "lat": 30.0699, "lon": -99.3217, "drainage_sq_mi": 288.0},
    "USGS-08167000": {"name": "Guadalupe Rv at Comfort", "lat": 29.9652, "lon": -98.8972, "drainage_sq_mi": 839.0},
}

# Events held out of training and replayed in the app. Times are UTC.
SCENARIOS: list[dict] = [
    {
        "id": "hunt_2025",
        "title": "Guadalupe River at Hunt",
        "event": "Hill Country flood, July 4 2025",
        "event_id": "hill_country_2025",
        "gauge": "USGS-08165500",
        "start": "2025-07-03T18:00:00Z",
        "end": "2025-07-05T06:00:00Z",
    },
    {
        "id": "kerrville_2025",
        "title": "Guadalupe River at Kerrville",
        "event": "Hill Country flood, July 4 2025",
        "event_id": "hill_country_2025",
        "gauge": "USGS-08166200",
        "start": "2025-07-03T18:00:00Z",
        "end": "2025-07-05T06:00:00Z",
    },
    {
        "id": "humble_2017",
        "title": "W Fork San Jacinto near Humble",
        "event": "Hurricane Harvey, Aug 2017",
        "event_id": "harvey_2017",
        "gauge": "USGS-08069500",
        "start": "2017-08-25T12:00:00Z",
        "end": "2017-09-01T12:00:00Z",
    },
    {
        "id": "addicks_2017",
        "title": "Buffalo Bayou near Addicks",
        "event": "Hurricane Harvey, Aug 2017",
        "event_id": "harvey_2017",
        "gauge": "USGS-08073500",
        "start": "2017-08-25T12:00:00Z",
        "end": "2017-09-03T12:00:00Z",
    },
]

CACHE = Path(os.environ.get("FLOOD_CACHE_DIR", Path(__file__).resolve().parent / "cache"))


def _get_json(url: str, retries: int = 5) -> dict:
    headers = {"User-Agent": "flood-time-machine-datathon/1.0"}
    key = os.environ.get("USGS_API_KEY")
    if key and "waterdata.usgs.gov" in url:
        headers["X-Api-Key"] = key
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as r:
                return json.loads(r.read())
        except Exception as exc:  # network hiccups / 429s
            if attempt == retries - 1:
                raise
            wait = 20 * (attempt + 1)  # USGS rate limits unkeyed clients; set USGS_API_KEY
            print(f"  retry in {wait}s ({exc})")
            time.sleep(wait)
    raise RuntimeError("unreachable")


def _cached(name: str, fetch):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{name}.json.gz"
    if path.exists():
        with gzip.open(path, "rt") as f:
            return json.load(f)
    data = fetch()
    with gzip.open(path, "wt") as f:
        json.dump(data, f)
    return data


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_utc(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


def fetch_stage(gauge: str, start: datetime, end: datetime) -> list[tuple[str, float]]:
    """15-minute gauge height (ft) as [(iso_time, value)], paged and cached by chunk."""
    out: list[tuple[str, float]] = []
    chunk = timedelta(days=500)  # 500 days * 96 obs/day = 48k rows < 50k limit
    t = start
    while t < end:
        t2 = min(t + chunk, end)
        name = f"usgs_{gauge}_{t:%Y%m%d}_{t2:%Y%m%d}"

        def fetch(t=t, t2=t2):
            rows: list[list] = []
            params = {
                "monitoring_location_id": gauge,
                "parameter_code": "00065",
                "time": f"{_iso(t)}/{_iso(t2)}",
                "limit": "50000",
                "skipGeometry": "true",
                "properties": "time,value",
                "f": "json",
            }
            url = f"{USGS_URL}?{urllib.parse.urlencode(params)}"
            while url:
                d = _get_json(url)
                for feat in d.get("features", []):
                    p = feat["properties"]
                    if p.get("value") not in (None, ""):
                        rows.append([p["time"], float(p["value"])])
                url = next((l["href"] for l in d.get("links", []) if l.get("rel") == "next"), None)
            return rows

        out.extend((r[0], r[1]) for r in _cached(name, fetch))
        t = t2
    return out


def fetch_rain(lat: float, lon: float, start: datetime, end: datetime, ring_km: float = 25.0) -> dict:
    """Hourly precipitation (mm) at the gauge and 4 points ~ring_km away (N/S/E/W).

    Returns {"time": [...], "points": [[mm,...] x5]}. Upstream rain matters for
    flash floods, so the model sees the mean and max of the ring.
    """
    dlat = ring_km / 111.0
    dlon = ring_km / (111.0 * max(0.2, abs(__import__("math").cos(__import__("math").radians(lat)))))
    pts = [(lat, lon), (lat + dlat, lon), (lat - dlat, lon), (lat, lon + dlon), (lat, lon - dlon)]
    if ring_km <= 0:
        pts = pts[:1]
    name = f"rain_{lat:.3f}_{lon:.3f}_{start:%Y%m%d}_{end:%Y%m%d}_r{ring_km:g}"

    def fetch():
        params = {
            "latitude": ",".join(f"{p[0]:.4f}" for p in pts),
            "longitude": ",".join(f"{p[1]:.4f}" for p in pts),
            "start_date": start.strftime("%Y-%m-%d"),
            "end_date": end.strftime("%Y-%m-%d"),
            "hourly": "precipitation",
            "timezone": "GMT",
        }
        d = _get_json(f"{OPEN_METEO_URL}?{urllib.parse.urlencode(params)}")
        d = d if isinstance(d, list) else [d]
        return {
            "time": [t + ":00Z" for t in d[0]["hourly"]["time"]],
            "points": [[v if v is not None else 0.0 for v in x["hourly"]["precipitation"]] for x in d],
        }

    return _cached(name, fetch)


def hourly(series: list[tuple[str, float]], start: datetime, end: datetime) -> list[float | None]:
    """Hourly mean of 15-min readings, aligned to [start, end) on the hour."""
    n = int((end - start).total_seconds() // 3600)
    sums = [0.0] * n
    counts = [0] * n
    for ts, v in series:
        i = int((parse_utc(ts) - start).total_seconds() // 3600)
        if 0 <= i < n:
            sums[i] += v
            counts[i] += 1
    return [sums[i] / counts[i] if counts[i] else None for i in range(n)]


def fill_gaps(values: list[float | None], max_gap: int = 6) -> list[float | None]:
    """Linear interpolation across short gaps only."""
    out = list(values)
    i = 0
    while i < len(out):
        if out[i] is None:
            j = i
            while j < len(out) and out[j] is None:
                j += 1
            if 0 < i and j < len(out) and j - i <= max_gap:
                a, b = out[i - 1], out[j]
                for k in range(i, j):
                    out[k] = a + (b - a) * (k - i + 1) / (j - i + 1)
            i = j
        else:
            i += 1
    return out
