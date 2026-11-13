"""Train a multi-horizon river-stage forecaster and export it to the app.

Question the model answers: "Given the last 3 days of river level and rain at
this gauge (and the rain expected over the next hours), how many feet will the
river rise in each of the next 1-12 hours?"

Data: hourly USGS gauge height for the 18 gauges that the UTSA flood images
link to (image_metadata.csv -> usgs_gage_height_station_id), plus Open-Meteo
ERA5 hourly rainfall at each gauge.

Split (no leakage between neighbouring hours):
  train  : 2014-01-01 .. 2020-12-31  (minus held-out event windows)
  val    : 2021-01-01 .. 2022-12-31
  test   : 2023-01-01 .. end, plus the two held-out flood events
  events : Hurricane Harvey (Aug 2017) and the Hill Country flood (Jul 2025)
           are removed from training for *every* gauge and only used to test
           and to drive the app's replay.

Models: persistence baseline (river stays where it is), LightGBM (one model
per lead time), and optionally a GRU sequence model (--gru, use a GPU).

Outputs:
  models/stage_forecaster/   boosters, GRU weights, metrics.json
  ml/outputs/*.png           scenario plots for slides
  mobile-app/src/data/floodScenarios.json  (observed + forecast curves)

Run on Colab (see Flood_Stage_Forecaster.ipynb) or locally:
    python ml/train_stage_forecaster.py --quick          # smoke test, ~2 min
    python ml/train_stage_forecaster.py --gru            # full run
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from data_sources import GAUGES, SCENARIOS, fetch_rain, fetch_stage, parse_utc  # noqa: E402
import build_scenarios  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "models" / "stage_forecaster"
PLOT_DIR = ROOT / "ml" / "outputs"

STAGE_LAGS = [1, 2, 3, 6, 12, 24, 48]
RAIN_PAST = [1, 3, 6, 12, 24, 48, 72]
RAIN_FUTURE = [1, 3, 6, 12]
EVENT_WINDOWS = {  # (start, end) UTC, applied to every gauge
    "harvey_2017": ("2017-08-20", "2017-09-20"),
    "hill_country_2025": ("2025-06-28", "2025-07-20"),
}


# --------------------------------------------------------------------------- data
def load_gauge(gid: str, start: datetime, end: datetime) -> pd.DataFrame | None:
    g = GAUGES[gid]
    raw = fetch_stage(gid, start, end)
    if len(raw) < 1000:
        print(f"  {gid}: only {len(raw)} readings, skipped")
        return None
    s = pd.Series([v for _, v in raw], index=pd.to_datetime([t for t, _ in raw], utc=True))
    s = s[~s.index.duplicated()].sort_index()
    # USGS sometimes reports sentinel values; drop absurd jumps (>15 ft in 15 min).
    s = s[(s.diff().abs().fillna(0) < 15)]
    stage = s.resample("1h").mean()
    stage = stage.interpolate(limit=6, limit_area="inside")

    # rain: snap to 0.25 deg (ERA5 grid) so nearby gauges share one request
    lat, lon = round(g["lat"] * 4) / 4, round(g["lon"] * 4) / 4
    rain = fetch_rain(lat, lon, start, end, ring_km=0)
    r = pd.Series(rain["points"][0], index=pd.to_datetime(rain["time"], utc=True))
    r = r[~r.index.duplicated()]

    df = pd.DataFrame({"stage": stage}).join(r.rename("rain"), how="left")
    df["rain"] = df["rain"].fillna(0.0)
    df["gauge"] = gid
    return df


def add_features(df: pd.DataFrame, horizons: int, stats: dict) -> pd.DataFrame:
    s, r = df["stage"], df["rain"]
    st = stats[df["gauge"].iloc[0]]
    f = pd.DataFrame(index=df.index)
    f["stage_rel"] = (s - st["median"]) / st["scale"]
    for k in STAGE_LAGS:
        f[f"ds_{k}"] = s - s.shift(k)
    for k in RAIN_PAST:
        f[f"rain_p{k}"] = r.rolling(k, min_periods=1).sum()
    for k in RAIN_FUTURE:  # rainfall forecast assumption: next-k-hour totals known
        f[f"rain_f{k}"] = r[::-1].rolling(k, min_periods=1).sum()[::-1].shift(-1)
    f["log_area"] = math.log1p(GAUGES[df["gauge"].iloc[0]]["drainage_sq_mi"])
    doy = df.index.dayofyear
    f["doy_sin"], f["doy_cos"] = np.sin(2 * np.pi * doy / 365.25), np.cos(2 * np.pi * doy / 365.25)
    for h in range(1, horizons + 1):
        f[f"y_{h}"] = s.shift(-h) - s
    f["stage"] = s
    f["gauge"] = df["gauge"].iloc[0]
    return f


def feature_cols(df: pd.DataFrame, future_rain: bool) -> list[str]:
    cols = [c for c in df.columns if not c.startswith("y_") and c not in ("stage", "gauge", "split", "event")]
    return cols if future_rain else [c for c in cols if not c.startswith("rain_f")]


def label_splits(df: pd.DataFrame) -> pd.DataFrame:
    idx = df.index
    df["event"] = ""
    for ev, (a, b) in EVENT_WINDOWS.items():
        df.loc[(idx >= pd.Timestamp(a, tz="UTC")) & (idx <= pd.Timestamp(b, tz="UTC")), "event"] = ev
    df["split"] = np.where(idx < pd.Timestamp("2021-01-01", tz="UTC"), "train",
                           np.where(idx < pd.Timestamp("2023-01-01", tz="UTC"), "val", "test"))
    df.loc[df["event"] != "", "split"] = "event"
    return df


# --------------------------------------------------------------------------- metrics
def rmse(a, b):
    return float(np.sqrt(np.mean((np.asarray(a) - np.asarray(b)) ** 2)))


def evaluate(y: np.ndarray, pred: np.ndarray, rise_ft: float = 2.0) -> dict:
    """y, pred: (n, H) stage changes. Persistence predicts 0 change."""
    out = {"n": int(len(y)), "by_lead": {}}
    for h in range(y.shape[1]):
        yt, yp = y[:, h], pred[:, h]
        rising = yt > 1.0
        hit = (yt >= rise_ft) & (yp >= rise_ft)
        miss = (yt >= rise_ft) & (yp < rise_ft)
        fa = (yt < rise_ft) & (yp >= rise_ft)
        out["by_lead"][h + 1] = {
            "rmse": rmse(yt, yp),
            "rmse_persistence": rmse(yt, 0 * yt),
            "rmse_rising": rmse(yt[rising], yp[rising]) if rising.any() else None,
            "rmse_rising_persistence": rmse(yt[rising], 0 * yt[rising]) if rising.any() else None,
            "csi_rise": float(hit.sum() / max(1, hit.sum() + miss.sum() + fa.sum())),
            "n_rising": int(rising.sum()),
        }
    b = out["by_lead"]
    out["skill_vs_persistence_mean"] = float(np.mean([1 - v["rmse"] / max(1e-9, v["rmse_persistence"]) for v in b.values()]))
    rr = [1 - v["rmse_rising"] / v["rmse_rising_persistence"] for v in b.values() if v["rmse_rising"] is not None]
    out["skill_rising_mean"] = float(np.mean(rr)) if rr else None
    out["csi_rise_mean"] = float(np.mean([v["csi_rise"] for v in b.values()]))
    return out


# --------------------------------------------------------------------------- models
def train_lgbm(tr, va, cols, H, quick):
    import lightgbm as lgb

    models = []
    params = dict(objective="regression", learning_rate=0.05, num_leaves=63, min_data_in_leaf=40,
                  feature_fraction=0.85, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1)
    # Floods are rare: up-weight hours where the river is moving.
    for h in range(1, H + 1):
        y_tr, y_va = tr[f"y_{h}"].values, va[f"y_{h}"].values
        w = 1 + 4 * (np.abs(y_tr) > 1)
        dtr = lgb.Dataset(tr[cols].values, y_tr, weight=w, feature_name=cols)
        dva = lgb.Dataset(va[cols].values, y_va, reference=dtr)
        m = lgb.train(params, dtr, num_boost_round=150 if quick else 1500, valid_sets=[dva],
                      callbacks=[lgb.early_stopping(50, verbose=False)])
        models.append(m)
        print(f"  lead {h:2d}h: {m.best_iteration} trees, val rmse {rmse(y_va, m.predict(va[cols].values, num_iteration=m.best_iteration)):.3f} ft")
    return models


def predict_lgbm(models, X):
    return np.column_stack([m.predict(X, num_iteration=m.best_iteration) for m in models])


SEQ = 72


class SeqData:
    """Windows of the last SEQ hours for a GRU, built per gauge without copying."""

    def __init__(self, frames: dict[str, pd.DataFrame], rows: pd.DataFrame, cols: list[str], H: int, mu, sd):
        self.items = []
        self.arrays = {}
        for gid, f in frames.items():
            self.arrays[gid] = (((f[cols].values - mu) / sd).astype("float32"), f.index)
        pos = {gid: pd.Series(np.arange(len(f)), index=f.index) for gid, f in frames.items()}
        for gid, sub in rows.groupby("gauge"):
            p = pos[gid].reindex(sub.index).values
            ok = p >= SEQ
            self.items += list(zip([gid] * int(ok.sum()), p[ok].astype(int), sub[[f"y_{h}" for h in range(1, H + 1)]].values[ok]))

    def batch(self, idx):
        X = np.stack([self.arrays[self.items[i][0]][0][self.items[i][1] - SEQ + 1: self.items[i][1] + 1] for i in idx])
        Y = np.stack([self.items[i][2] for i in idx]).astype("float32")
        return np.nan_to_num(X), Y


def train_gru(frames, tr, va, cols, H, epochs):
    import torch
    from torch import nn

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    allf = pd.concat([f[cols] for f in frames.values()])
    mu, sd = allf.mean().values, allf.std().replace(0, 1).values
    dtr, dva = SeqData(frames, tr, cols, H, mu, sd), SeqData(frames, va, cols, H, mu, sd)
    print(f"  GRU on {dev}: {len(dtr.items)} train / {len(dva.items)} val windows")

    class Net(nn.Module):
        def __init__(self):
            super().__init__()
            self.gru = nn.GRU(len(cols), 96, num_layers=2, batch_first=True, dropout=0.1)
            self.head = nn.Sequential(nn.Linear(96, 96), nn.ReLU(), nn.Linear(96, H))

        def forward(self, x):
            o, _ = self.gru(x)
            return self.head(o[:, -1])

    net = Net().to(dev)
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-4)
    best, best_state = 1e9, None
    for ep in range(epochs):
        net.train()
        order = np.random.permutation(len(dtr.items))
        for i in range(0, len(order), 512):
            X, Y = dtr.batch(order[i:i + 512])
            X, Y = torch.from_numpy(X).to(dev), torch.from_numpy(Y).to(dev)
            w = 1 + 4 * (Y.abs() > 1).float()
            loss = (w * (net(X) - Y) ** 2).mean()
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()
        P, Yv = gru_predict(net, dva, dev)
        v = rmse(Yv, P)
        print(f"  epoch {ep + 1}/{epochs}: val rmse {v:.3f} ft")
        if v < best:
            best, best_state = v, {k: t.detach().cpu().clone() for k, t in net.state_dict().items()}
    net.load_state_dict(best_state)
    return net, (mu, sd), dev


def gru_predict(net, data, dev):
    import torch

    net.eval()
    P, Y = [], []
    with torch.no_grad():
        for i in range(0, len(data.items), 2048):
            X, y = data.batch(range(i, min(i + 2048, len(data.items))))
            P.append(net(torch.from_numpy(X).to(dev)).cpu().numpy())
            Y.append(y)
    return np.concatenate(P), np.concatenate(Y)


# --------------------------------------------------------------------------- export
def scenario_forecasts(frames, predict_fn, H, leads=(1, 2, 3, 6, 12)):
    """For each app scenario: predicted stage at hour i issued `lead` hours earlier."""
    out = {}
    for sc in SCENARIOS:
        f = frames.get(sc["gauge"])
        if f is None:
            continue
        start, end = pd.Timestamp(parse_utc(sc["start"])), pd.Timestamp(parse_utc(sc["end"]))
        hours = pd.date_range(start, end, freq="1h", inclusive="left")
        issue = f.loc[start - pd.Timedelta(hours=H): end]
        pred = predict_fn(issue)  # (n, H) changes
        base = issue["stage"].values
        by = {}
        for L in leads:
            if L > H:
                continue
            series = pd.Series(base + pred[:, L - 1], index=issue.index + pd.Timedelta(hours=L))
            vals = series.reindex(hours)
            by[str(L)] = [None if pd.isna(v) else round(float(v), 2) for v in vals.values]
        out[sc["id"]] = {"by_lead": by}
    return out


def plot_scenarios(frames, forecasts, tag):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return
    PLOT_DIR.mkdir(parents=True, exist_ok=True)
    for sc in SCENARIOS:
        if sc["id"] not in forecasts:
            continue
        start, end = pd.Timestamp(parse_utc(sc["start"])), pd.Timestamp(parse_utc(sc["end"]))
        hours = pd.date_range(start, end, freq="1h", inclusive="left")
        obs = frames[sc["gauge"]]["stage"].reindex(hours)
        fig, ax = plt.subplots(figsize=(9, 4))
        ax.plot(hours.tz_convert("America/Chicago"), obs.values, color="black", lw=2, label="Observed")
        for L, c in (("1", "#2b6cb0"), ("3", "#c05621"), ("6", "#9b2c2c")):
            if L in forecasts[sc["id"]]["by_lead"]:
                ax.plot(hours.tz_convert("America/Chicago"), np.array(forecasts[sc["id"]]["by_lead"][L], dtype=float), color=c, lw=1.2, label=f"Predicted {L} h ahead")
        ax.set_title(f"{sc['title']} — {sc['event']} ({tag})")
        ax.set_ylabel("Gauge height (ft)")
        ax.legend(frameon=False)
        fig.autofmt_xdate()
        fig.tight_layout()
        fig.savefig(PLOT_DIR / f"{sc['id']}.png", dpi=150)
        plt.close(fig)


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2014-01-01")
    ap.add_argument("--end", default="2025-10-31")
    ap.add_argument("--horizons", type=int, default=12)
    ap.add_argument("--gru", action="store_true", help="also train a GRU (use a GPU runtime)")
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--no-future-rain", action="store_true", help="don't assume a rainfall forecast is available")
    ap.add_argument("--quick", action="store_true", help="4 gauges, 2016-2018 + 2025 only, few trees")
    ap.add_argument("--data-dir", type=Path, default=ROOT.parent / "UTSA-flood-images")
    args = ap.parse_args()
    H = args.horizons
    t0 = time.time()

    gauges = list(GAUGES)
    periods = [(args.start, args.end)]
    if args.quick:
        gauges = ["USGS-08165500", "USGS-08166200", "USGS-08069500", "USGS-08073500"]
        periods = [("2016-01-01", "2018-12-31"), ("2021-01-01", "2022-12-31"), ("2025-06-01", "2025-07-31")]

    print(f"Loading {len(gauges)} gauges ...")
    frames = {}
    for gid in gauges:
        parts = [load_gauge(gid, parse_utc(a + "T00:00:00Z"), parse_utc(b + "T23:00:00Z")) for a, b in periods]
        parts = [p for p in parts if p is not None]
        if parts:
            f = pd.concat(parts).asfreq("1h")  # continuous hourly index so shifts = hours
            f["gauge"], f["rain"] = gid, f["rain"].fillna(0.0)
            frames[gid] = f
            print(f"  {gid} {GAUGES[gid]['name']}: {len(frames[gid])} h")

    # Per-gauge normalisation from training years only.
    stats = {}
    for gid, f in frames.items():
        tr = f.loc[f.index < pd.Timestamp("2021-01-01", tz="UTC"), "stage"].dropna()
        tr = tr if len(tr) > 100 else f["stage"].dropna()
        stats[gid] = {"median": float(tr.median()), "scale": float(max(0.5, tr.quantile(0.99) - tr.median()))}

    feats = {gid: label_splits(add_features(f, H, stats)) for gid, f in frames.items()}
    data = pd.concat(feats.values())
    ycols = [f"y_{h}" for h in range(1, H + 1)]
    cols = feature_cols(data, future_rain=not args.no_future_rain)
    data = data.dropna(subset=ycols + ["ds_24"])
    # Quiet hours dominate; keep every active hour and 15% of quiet ones in train.
    active = (data[ycols].abs().max(axis=1) > 0.3) | (data["rain_p72"] > 5)
    rng = np.random.default_rng(0)
    keep = active | (rng.random(len(data)) < 0.15) | (data["split"] != "train")
    data = data[keep]
    tr, va, te, ev = (data[data.split == s] for s in ("train", "val", "test", "event"))
    print(f"Rows  train {len(tr)}  val {len(va)}  test {len(te)}  held-out events {len(ev)}")
    print(f"Features ({len(cols)}): {', '.join(cols)}")

    print("Training LightGBM ...")
    lgbm = train_lgbm(tr, va, cols, H, args.quick)
    fn_lgbm = lambda df: predict_lgbm(lgbm, df[cols].values)  # noqa: E731

    results = {"persistence": {}, "lightgbm": {}}
    for name, part in (("val", va), ("test", te), ("events", ev)):
        if len(part):
            y = part[ycols].values
            results["persistence"][name] = evaluate(y, np.zeros_like(y))
            results["lightgbm"][name] = evaluate(y, fn_lgbm(part))
    best_name, best_fn = "lightgbm", fn_lgbm

    gru = None
    if args.gru:
        print("Training GRU ...")
        feat_frames = {gid: f[cols].fillna(0) for gid, f in feats.items()}
        gru, (mu, sd), dev = train_gru(feat_frames, tr, va, cols, H, 2 if args.quick else args.epochs)
        results["gru"] = {}
        for name, part in (("val", va), ("test", te), ("events", ev)):
            if len(part):
                P, Y = gru_predict(gru, SeqData(feat_frames, part, cols, H, mu, sd), dev)
                results["gru"][name] = evaluate(Y, P)

        def fn_gru(df):
            gid = df["gauge"].iloc[0]
            d = SeqData(feat_frames, df.assign(**{c: 0.0 for c in ycols}), cols, H, mu, sd)
            P, _ = gru_predict(gru, d, dev)
            out = np.full((len(df), H), np.nan)
            pos = pd.Series(np.arange(len(feat_frames[gid])), index=feat_frames[gid].index).reindex(df.index).values
            out[pos >= SEQ] = P
            return out

        if results["gru"]["val"]["by_lead"][min(6, H)]["rmse"] < results["lightgbm"]["val"]["by_lead"][min(6, H)]["rmse"]:
            best_name, best_fn = "gru", fn_gru

    # Report
    print("\n=== Results (RMSE ft at 1 / 3 / 6 / 12 h; skill = 1 - RMSE/persistence) ===")
    for model, res in results.items():
        for split, r in res.items():
            leads = [r["by_lead"].get(h) for h in (1, 3, 6, 12) if h in r["by_lead"]]
            print(f"{model:12s} {split:7s} " + " / ".join(f"{v['rmse']:.2f}" for v in leads)
                  + f"   skill {r['skill_vs_persistence_mean']:+.2f}   rising-skill {r['skill_rising_mean'] if r['skill_rising_mean'] is None else round(r['skill_rising_mean'], 2)}"
                  + f"   CSI(rise>=2ft) {r['csi_rise_mean']:.2f}")
    print(f"Selected for app: {best_name}")

    # Save
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for h, m in enumerate(lgbm, 1):
        m.save_model(str(MODEL_DIR / f"lgbm_lead{h:02d}.txt"), num_iteration=m.best_iteration)
    if gru is not None:
        import torch
        torch.save({"state": gru.state_dict(), "cols": cols, "seq": SEQ, "horizons": H}, MODEL_DIR / "gru.pt")
    imp = pd.Series(lgbm[min(6, H) - 1].feature_importance("gain"), index=cols).sort_values(ascending=False)
    meta = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "selected": best_name,
        "horizons": H,
        "features": cols,
        "future_rain_assumed": not args.no_future_rain,
        "gauges": {g: GAUGES[g]["name"] for g in frames},
        "gauge_stats": stats,
        "split": "train <2021 / val 2021-22 / test 2023+; Harvey 2017 and Hill Country 2025 windows held out of all training",
        "rows": {"train": len(tr), "val": len(va), "test": len(te), "events": len(ev)},
        "feature_importance_6h": {k: round(float(v), 1) for k, v in imp.head(12).items()},
        "results": results,
        "quick": args.quick,
    }
    (MODEL_DIR / "metrics.json").write_text(json.dumps(meta, indent=2))

    forecasts = scenario_forecasts(feats, best_fn, H)
    plot_scenarios(frames, forecasts, best_name)
    ev_r = results[best_name].get("events", {})
    app_model = {
        "trained": True,
        "name": {"lightgbm": "LightGBM multi-horizon", "gru": "GRU sequence model"}[best_name],
        "trained_at": meta["trained_at"],
        "quick": args.quick,
        "future_rain_assumed": not args.no_future_rain,
        "events_rmse_ft": {str(h): round(ev_r["by_lead"][h]["rmse"], 2) for h in (1, 3, 6) if ev_r and h in ev_r["by_lead"]},
        "events_rmse_persistence_ft": {str(h): round(ev_r["by_lead"][h]["rmse_persistence"], 2) for h in (1, 3, 6) if ev_r and h in ev_r["by_lead"]},
        "note": "Forecasts for these events were made by a model that never saw them during training.",
    }
    build_scenarios.build(args.data_dir, forecasts=forecasts, model=app_model)
    print(f"Done in {(time.time() - t0) / 60:.1f} min. Commit models/stage_forecaster, ml/outputs and mobile-app/src/data/floodScenarios.json.")


if __name__ == "__main__":
    main()
