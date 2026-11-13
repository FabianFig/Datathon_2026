"""Self-supervised flood change detector trained on the UTSA before/after photos.

No labels. The 575 Harvey pairs are a 2016 USDA NAIP photo and a 2017 NOAA
photo of the same ground. Most of each scene did not change, but the two
cameras render it differently (colour, sun angle, resolution), so naively
comparing them flags *everything* as changed.

So we train a "camera translator": a small conv net that maps features of the
2016 photo to features of the 2017 photo, patch by patch, across all pairs.
It can learn the systematic camera difference because that is shared by every
pair. It cannot learn a flood at one particular location, because that is
unique. Whatever the translator fails to predict is real change on the ground:
standing water, debris, damage.

  backbone   ResNet-50 (ImageNet), frozen, layer3 features pooled to 16x16 patches
  model      residual conv translator, trained with a trimmed cosine loss
             (worst 20% of patches ignored, so real changes don't get learned)
  splits     5-fold, grouped by spatial block, so every pair is scored by a
             model that never saw it or its neighbours
  checks     (1) true pairs vs shuffled pairs AUC   (does it know the place?)
             (2) contrast: top-patch vs typical-patch change  (is camera noise removed?)
             (3) correlation with flood evidence the model never saw:
                 3-day rainfall, gauge rise, FEMA flood zone, distance to a
                 surveyed high-water mark
             each compared with the naive no-translator baseline

Outputs:
  models/change_detector/       translator weights per fold, metrics.json
  ml/outputs/change_scores.csv  every pair, learned + naive scores
  ml/outputs/change_top/*.jpg   top pairs with heatmaps (slides)
  mobile-app/src/data/changeScores.json   score, percentile, 16x16 heatmap per pair

    python ml/train_change_detector.py --data-dir /content/UTSA-flood-images
    python ml/train_change_detector.py --data-dir ... --quick     # smoke test
"""
from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from PIL import Image
from torch import nn

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "models" / "change_detector"
OUT_DIR = ROOT / "ml" / "outputs"
APP_JSON = ROOT / "mobile-app" / "src" / "data" / "changeScores.json"
GRID = 16


# --------------------------------------------------------------------------- data
def load_pairs(data_dir: Path) -> pd.DataFrame:
    meta = pd.read_csv(data_dir / "image_metadata.csv", dtype=str, keep_default_na=False)
    by_id = meta.set_index("image_id")
    rows = []
    for _, b in meta[meta["image_view_type"] == "baseline"].iterrows():
        a_id = b["paired_image_id"]
        if a_id not in by_id.index:
            continue
        a = by_id.loc[a_id]
        same_gauge = b["usgs_gage_height_station_id"] and b["usgs_gage_height_station_id"] == a["usgs_gage_height_station_id"]
        num = lambda v: pd.to_numeric(v, errors="coerce")  # noqa: E731
        rows.append({
            "before_id": b["image_id"],
            "after_id": a_id,
            "before_path": str(data_dir / b["image_path"]),
            "after_path": str(data_dir / a["image_path"]),
            "locality": a["locality"],
            "group": b["spatial_block_005deg"] or b["pair_id"],
            # Evidence the model never sees, used only to check it:
            "rain_3d_mm": num(a["preceding_3d_precipitation_mm"]),
            "gauge_rise_m": (num(a["usgs_daily_mean_gage_height_si"]) - num(b["usgs_daily_mean_gage_height_si"])) if same_gauge else np.nan,
            "fema_sfha": 1.0 if a["fema_sfha_tf"] == "T" else (0.0 if a["fema_sfha_tf"] == "F" else np.nan),
            "hwm_km": num(a["nearest_high_water_mark_distance_km"]),
        })
    df = pd.DataFrame(rows)
    missing = [p for p in df.before_path.tolist() + df.after_path.tolist() if not os.path.exists(p)]
    if missing:
        raise SystemExit(f"{len(missing)} images missing under {data_dir}, e.g. {missing[0]}")
    return df


def extract_features(paths: list[str], size: int, device: str, cache: Path | None) -> torch.Tensor:
    if cache and cache.exists():
        feats = torch.load(cache)
        if feats.shape[0] == len(paths):
            print(f"  features from cache {cache}")
            return feats
    import torchvision
    from torchvision.models import ResNet50_Weights

    net = torchvision.models.resnet50(weights=ResNet50_Weights.IMAGENET1K_V2)
    body = nn.Sequential(net.conv1, net.bn1, net.relu, net.maxpool, net.layer1, net.layer2, net.layer3).to(device).eval()
    mean = torch.tensor([0.485, 0.456, 0.406], device=device).view(1, 3, 1, 1)
    std = torch.tensor([0.229, 0.224, 0.225], device=device).view(1, 3, 1, 1)
    out = []
    with torch.no_grad():
        for i in range(0, len(paths), 16):
            batch = []
            for p in paths[i:i + 16]:
                im = Image.open(p).convert("RGB").resize((size, size), Image.BILINEAR)
                batch.append(torch.from_numpy(np.asarray(im, dtype=np.float32) / 255.0).permute(2, 0, 1))
            x = (torch.stack(batch).to(device) - mean) / std
            f = F.adaptive_avg_pool2d(body(x), GRID)
            out.append(f.half().cpu())
            print(f"  features {min(i + 16, len(paths))}/{len(paths)}", end="\r")
    print()
    feats = torch.cat(out)
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        torch.save(feats, cache)
    return feats


# --------------------------------------------------------------------------- model
class Translator(nn.Module):
    """Predict 2017-camera features from 2016-camera features (residual)."""

    def __init__(self, ch: int = 1024, hidden: int = 512):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(ch, hidden, 3, padding=1), nn.GELU(),
            nn.Conv2d(hidden, hidden, 1), nn.GELU(),
            nn.Conv2d(hidden, ch, 1),
        )

    def forward(self, x):
        return x + self.net(x)


def change_map(pred: torch.Tensor, after: torch.Tensor) -> torch.Tensor:
    """1 - cosine similarity per patch -> (N, GRID, GRID)."""
    return 1 - F.cosine_similarity(pred.float(), after.float(), dim=1)


def augment(b, a):
    k = int(torch.randint(0, 4, (1,)))
    b, a = torch.rot90(b, k, (2, 3)), torch.rot90(a, k, (2, 3))
    if torch.rand(1) < 0.5:
        b, a = b.flip(3), a.flip(3)
    return b, a


def train_fold(Xb, Xa, idx, epochs, device, keep=0.8):
    model = Translator(Xb.shape[1]).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, epochs)
    for ep in range(epochs):
        model.train()
        perm = idx[torch.randperm(len(idx))]
        tot = 0.0
        for i in range(0, len(perm), 16):
            j = perm[i:i + 16]
            b, a = augment(Xb[j].to(device).float(), Xa[j].to(device).float())
            loss_map = change_map(model(b), a).flatten()
            # Trimmed loss: ignore the hardest patches, which are the real changes.
            k = max(1, int(keep * loss_map.numel()))
            loss = torch.topk(loss_map, k, largest=False).values.mean()
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += float(loss) * len(j)
        sched.step()
        if ep == 0 or (ep + 1) % 5 == 0 or ep == epochs - 1:
            print(f"    epoch {ep + 1}/{epochs}  trimmed loss {tot / len(perm):.4f}")
    return model


def image_score(m: torch.Tensor) -> torch.Tensor:
    """Mean of the top 10% most-changed patches."""
    flat = m.flatten(1)
    k = max(1, int(0.1 * flat.shape[1]))
    return torch.topk(flat, k, dim=1).values.mean(1)


# --------------------------------------------------------------------------- checks
def auc(pos: np.ndarray, neg: np.ndarray) -> float:
    """P(score of a true change > score of a non-change), via ranks."""
    s = np.concatenate([pos, neg])
    r = pd.Series(s).rank().values
    return float((r[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def spearman(x: pd.Series, y: pd.Series) -> float | None:
    ok = x.notna() & y.notna()
    if ok.sum() < 20:
        return None
    return float(x[ok].rank().corr(y[ok].rank()))


# --------------------------------------------------------------------------- outputs
def save_examples(df: pd.DataFrame, maps: np.ndarray, n: int = 12):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return
    d = OUT_DIR / "change_top"
    d.mkdir(parents=True, exist_ok=True)
    for rank, i in enumerate(df["score"].sort_values(ascending=False).index[:n]):
        r = df.loc[i]
        fig, ax = plt.subplots(1, 3, figsize=(12, 4.2))
        ax[0].imshow(Image.open(r.before_path).convert("RGB"))
        ax[0].set_title(f"Before ({r.before_id})")
        ax[1].imshow(Image.open(r.after_path).convert("RGB"))
        ax[1].set_title(f"After ({r.after_id})")
        after = Image.open(r.after_path).convert("RGB")
        ax[2].imshow(after)
        ax[2].imshow(maps[i], cmap="magma", alpha=0.55, extent=(0, after.width, after.height, 0), interpolation="bilinear")
        ax[2].set_title(f"Unexplained change, score {r.score:.2f}")
        for a in ax:
            a.axis("off")
        fig.suptitle(f"#{rank + 1}  {r.locality}")
        fig.tight_layout()
        fig.savefig(d / f"{rank + 1:02d}_{r.after_id}.jpg", dpi=90)
        plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", type=Path, default=ROOT.parent / "UTSA-flood-images")
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--cache", type=Path, default=Path(os.environ.get("FLOOD_CACHE_DIR", ROOT / "ml" / "cache")))
    ap.add_argument("--quick", action="store_true", help="60 pairs, 2 folds, 3 epochs")
    args = ap.parse_args()
    t0 = time.time()
    torch.manual_seed(0)
    np.random.seed(0)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    df = load_pairs(args.data_dir)
    if args.quick:
        df = df.sample(60, random_state=0).reset_index(drop=True)
        args.folds, args.epochs = 2, 3
    print(f"{len(df)} pairs, {df.group.nunique()} spatial groups, device {device}")

    tag = f"{'quick_' if args.quick else ''}{args.size}"
    print("Extracting backbone features ...")
    Xb = extract_features(df.before_path.tolist(), args.size, device, None if args.quick else args.cache / f"feat_before_{tag}.pt")
    Xa = extract_features(df.after_path.tolist(), args.size, device, None if args.quick else args.cache / f"feat_after_{tag}.pt")

    # Grouped K-fold over spatial blocks
    groups = df.group.unique()
    rng = np.random.default_rng(0)
    rng.shuffle(groups)
    fold_of_group = {g: i % args.folds for i, g in enumerate(groups)}
    fold = df.group.map(fold_of_group).values

    learned = np.zeros((len(df), GRID, GRID), dtype=np.float32)
    shuffled_learned = np.zeros(len(df), dtype=np.float32)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for k in range(args.folds):
        tr = torch.from_numpy(np.where(fold != k)[0])
        te = np.where(fold == k)[0]
        print(f"Fold {k + 1}/{args.folds}: train {len(tr)} pairs, score {len(te)}")
        model = train_fold(Xb, Xa, tr, args.epochs, device)
        torch.save(model.state_dict(), MODEL_DIR / f"translator_fold{k}.pt")
        model.eval()
        with torch.no_grad():
            tet = torch.from_numpy(te)
            pred = model(Xb[tet].to(device).float())
            learned[te] = change_map(pred, Xa[tet].to(device)).cpu().numpy()
            # Shuffled control: same "before", another location's "after"
            other = tet[torch.randperm(len(tet))]
            shuffled_learned[te] = image_score(change_map(pred, Xa[other].to(device))).cpu().numpy()

    with torch.no_grad():
        naive = change_map(Xb.float(), Xa.float()).numpy()
        perm = torch.randperm(len(df))
        shuffled_naive = image_score(change_map(Xb.float(), Xa[perm].float())).numpy()

    df["score"] = image_score(torch.from_numpy(learned)).numpy()
    df["score_naive"] = image_score(torch.from_numpy(naive)).numpy()
    df["typical_patch"] = np.median(learned.reshape(len(df), -1), axis=1)
    df["typical_patch_naive"] = np.median(naive.reshape(len(df), -1), axis=1)

    checks = {}
    for name, score, typ, shuf in (
        ("learned", "score", "typical_patch", shuffled_learned),
        ("naive", "score_naive", "typical_patch_naive", shuffled_naive),
    ):
        checks[name] = {
            "true_vs_shuffled_auc": auc(shuf, df[score].values),
            "median_typical_patch_change": float(df[typ].median()),
            "contrast_top_vs_typical": float((df[score] / df[typ].clip(lower=1e-6)).median()),
            "spearman_rain_3d": spearman(df[score], df.rain_3d_mm),
            "spearman_gauge_rise": spearman(df[score], df.gauge_rise_m),
            "spearman_fema_flood_zone": spearman(df[score], df.fema_sfha),
            "spearman_high_water_mark_distance": spearman(df[score], df.hwm_km),
        }

    print("\n=== Checks (learned translator vs naive comparison) ===")
    for key in checks["learned"]:
        a, b = checks["learned"][key], checks["naive"][key]
        fmt = lambda v: "n/a" if v is None else f"{v:+.3f}"  # noqa: E731
        print(f"{key:38s} learned {fmt(a):>7}   naive {fmt(b):>7}")
    print("AUC: how often a real pair scores lower than a mismatched pair (1.0 = always).")
    print("Contrast: higher means changes stand out from camera noise.")
    print("Spearman: + for rain / gauge rise / flood zone, - for distance to high-water mark, if the score tracks flooding.")

    # Save
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    df.drop(columns=["before_path", "after_path"]).sort_values("score", ascending=False).to_csv(OUT_DIR / "change_scores.csv", index=False)
    meta = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "method": "self-supervised camera translator on frozen ResNet-50 layer3 features; score = mean of top-10% unexplained patches",
        "pairs": len(df),
        "folds": args.folds,
        "epochs": args.epochs,
        "image_size": args.size,
        "quick": args.quick,
        "checks": checks,
    }
    (MODEL_DIR / "metrics.json").write_text(json.dumps(meta, indent=2))
    save_examples(df, learned)

    # App export: percentile and a 16x16 heatmap as 256 digits (0-9)
    lo, hi = np.percentile(learned, 50), np.percentile(learned, 99.5)
    pct = df["score"].rank(pct=True)
    rank = df["score"].rank(ascending=False, method="first")
    app = {
        "model": {
            "trained": True,
            "trained_at": meta["trained_at"],
            "quick": args.quick,
            "pairs": len(df),
            "auc_true_vs_shuffled": round(checks["learned"]["true_vs_shuffled_auc"], 3),
            "contrast": round(checks["learned"]["contrast_top_vs_typical"], 2),
            "contrast_naive": round(checks["naive"]["contrast_top_vs_typical"], 2),
        },
        "pairs": {
            r.after_id: {
                "score": round(float(r.score), 4),
                "percentile": round(float(pct[i]) * 100, 1),
                "rank": int(rank[i]),
                "grid": "".join(str(int(v)) for v in np.clip((learned[i] - lo) / (hi - lo) * 9.99, 0, 9).astype(int).flatten()),
            }
            for i, r in df.iterrows()
        },
    }
    APP_JSON.write_text(json.dumps(app, separators=(",", ":")))
    print(f"wrote {APP_JSON} ({APP_JSON.stat().st_size / 1024:.0f} KB). Done in {(time.time() - t0) / 60:.1f} min.")


if __name__ == "__main__":
    main()
