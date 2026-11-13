"""Train a small flood / no-flood classifier on the team's photo labels.

Pure Python (no installs), so it runs anywhere in seconds.

Labels come from the app's Label photos screen, either
  - reviews/flood_labels.jsonl  (saved by mobile_server.py when phones were connected), or
  - exported JSON files dropped in ml/labels/  (Export button on the label screen;
    paste the shared text into a .json file)
Several labellers are combined by majority vote per photo; "unsure" is ignored.

Features per pair (computed earlier, already in the app bundle):
  floodwater colour index: score, share of patches >= 3 and >= 6
  self-supervised change model: score, share of patches >= 5
Model: L2-regularised logistic regression on standardised features.

Evaluation: 5-fold cross-validation grouped by spatial block (neighbouring
photos never sit in both train and test), compared with ranking by each single
score. Then it fits on all labels and scores all 575 pairs.

Writes mobile-app/src/data/floodScores.json and prints the metrics.

    python ml/train_flood_classifier.py --data-dir ../UTSA-flood-images
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import random
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "mobile-app" / "src" / "data"
OUT = DATA / "floodScores.json"


# --------------------------------------------------------------------------- labels
def read_labels(extra: list[Path]) -> dict[str, int]:
    """Majority vote per photo across labellers; each labeller's latest answer counts once."""
    latest: dict[tuple[str, str], str] = {}

    jsonl = ROOT / "reviews" / "flood_labels.jsonl"
    if jsonl.is_file():
        for line in jsonl.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
                latest[(r.get("labeler") or "server", r["after_id"])] = r["label"]
            except (ValueError, KeyError):
                pass
    for path in extra:
        d = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(d, dict) and d.get("format") == "flood-labels-v1":
            for r in d["labels"]:
                latest[(r.get("labeler") or path.stem, r["after_id"])] = r["label"]
        elif isinstance(d, dict) and isinstance(d.get("labels"), dict):  # {after_id: 0/1}
            for aid, v in d["labels"].items():
                latest[(path.stem, aid)] = "flooded" if int(v) else "dry"

    votes: dict[str, list[int]] = defaultdict(list)
    for (_, aid), label in latest.items():
        if label in ("flooded", "dry"):
            votes[aid].append(1 if label == "flooded" else 0)
    return {aid: int(sum(v) * 2 > len(v)) for aid, v in votes.items() if sum(v) * 2 != len(v)}


# --------------------------------------------------------------------------- features
def features() -> tuple[list[str], dict[str, list[float]]]:
    water = json.loads((DATA / "waterScores.json").read_text())["pairs"]
    change = json.loads((DATA / "changeScores.json").read_text()).get("pairs", {})
    names = ["water_score", "water_share_3", "water_share_6", "change_score", "change_share_5"]
    feats = {}
    for aid, w in water.items():
        c = change.get(aid)
        if not c:
            continue
        wg = [int(ch) for ch in w["grid"]]
        cg = [int(ch) for ch in c["grid"]]
        feats[aid] = [
            w["score"],
            sum(v >= 3 for v in wg) / len(wg),
            sum(v >= 6 for v in wg) / len(wg),
            c["score"],
            sum(v >= 5 for v in cg) / len(cg),
        ]
    return names, feats


# --------------------------------------------------------------------------- model
def standardise(X):
    n, d = len(X), len(X[0])
    mu = [sum(r[j] for r in X) / n for j in range(d)]
    sd = [max(1e-9, (sum((r[j] - mu[j]) ** 2 for r in X) / n) ** 0.5) for j in range(d)]
    return mu, sd


def fit(X, y, l2=1.0, steps=3000, lr=0.1):
    mu, sd = standardise(X)
    Z = [[(r[j] - mu[j]) / sd[j] for j in range(len(r))] for r in X]
    d = len(Z[0])
    w = [0.0] * d
    pos = sum(y)
    b = math.log((pos + 1) / (len(y) - pos + 1))
    # balance classes so the rarer one counts as much
    cw = {1: len(y) / (2 * max(1, pos)), 0: len(y) / (2 * max(1, len(y) - pos))}
    for _ in range(steps):
        gw = [0.0] * d
        gb = 0.0
        for z, t in zip(Z, y):
            p = 1 / (1 + math.exp(-(b + sum(wi * zi for wi, zi in zip(w, z)))))
            e = (p - t) * cw[t]
            gb += e
            for j in range(d):
                gw[j] += e * z[j]
        n = len(y)
        b -= lr * gb / n
        w = [wj - lr * (gw[j] / n + l2 * wj / n) for j, wj in enumerate(w)]
    return {"mu": mu, "sd": sd, "w": w, "b": b}


def predict(m, X):
    out = []
    for r in X:
        z = [(r[j] - m["mu"][j]) / m["sd"][j] for j in range(len(r))]
        out.append(1 / (1 + math.exp(-(m["b"] + sum(wi * zi for wi, zi in zip(m["w"], z))))))
    return out


def auc(scores, labels):
    pos = [s for s, l in zip(scores, labels) if l]
    neg = [s for s, l in zip(scores, labels) if not l]
    if not pos or not neg:
        return None
    return sum((p > q) + 0.5 * (p == q) for p in pos for q in neg) / (len(pos) * len(neg))


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", type=Path, default=ROOT.parent / "UTSA-flood-images")
    ap.add_argument("--labels", type=Path, nargs="*", default=None, help="label files (default: every .json in ml/labels/ except the AI-made visual_flood_labels.json)")
    ap.add_argument("--include-ai-labels", action="store_true", help="also use ml/labels/visual_flood_labels.json")
    ap.add_argument("--folds", type=int, default=5)
    args = ap.parse_args()

    extra = args.labels if args.labels is not None else [
        p for p in sorted((ROOT / "ml" / "labels").glob("*.json")) if args.include_ai_labels or p.name != "visual_flood_labels.json"
    ]
    labels = read_labels(extra)
    names, feats = features()
    ids = [a for a in labels if a in feats]
    if len(ids) < 20 or len(set(labels[a] for a in ids)) < 2:
        raise SystemExit(f"Need at least 20 labelled photos with both answers; have {len(ids)}.")

    block = {}
    meta = args.data_dir / "image_metadata.csv"
    if meta.is_file():
        for r in csv.DictReader(open(meta, newline="", encoding="utf-8-sig")):
            block[r["image_id"]] = r["spatial_block_005deg"] or r["pair_id"]
    groups = sorted({block.get(a, a) for a in ids})
    random.Random(0).shuffle(groups)
    fold_of = {g: i % args.folds for i, g in enumerate(groups)}

    y = [labels[a] for a in ids]
    X = [feats[a] for a in ids]
    oof = [0.0] * len(ids)
    for k in range(args.folds):
        tr = [i for i, a in enumerate(ids) if fold_of[block.get(a, a)] != k]
        te = [i for i, a in enumerate(ids) if fold_of[block.get(a, a)] == k]
        if not te or len({y[i] for i in tr}) < 2:
            continue
        m = fit([X[i] for i in tr], [y[i] for i in tr])
        for i, p in zip(te, predict(m, [X[i] for i in te])):
            oof[i] = p

    cv_auc = auc(oof, y)
    acc = sum((p >= 0.5) == bool(t) for p, t in zip(oof, y)) / len(y)
    tp = sum(p >= 0.5 and t for p, t in zip(oof, y))
    tn = sum(p < 0.5 and not t for p, t in zip(oof, y))
    rec_wet, rec_dry = tp / max(1, sum(y)), tn / max(1, len(y) - sum(y))
    bal = (rec_wet + rec_dry) / 2

    def boot_ci(scores, labels, n=1000):
        rng = random.Random(1)
        vals = []
        for _ in range(n):
            idx = [rng.randrange(len(labels)) for _ in labels]
            v = auc([scores[i] for i in idx], [labels[i] for i in idx])
            if v is not None:
                vals.append(v)
        vals.sort()
        return vals[int(0.025 * len(vals))], vals[int(0.975 * len(vals)) - 1]

    ci = boot_ci(oof, y)
    base = {n: auc([x[j] for x in X], y) for j, n in enumerate(names) if n in ("water_score", "change_score")}
    print(f"{len(ids)} labelled photos ({sum(y)} flooded, {len(y) - sum(y)} dry), {len(groups)} spatial groups, {args.folds}-fold grouped CV")
    print(f"classifier   AUC {cv_auc:.3f} (95% CI {ci[0]:.2f}-{ci[1]:.2f})   balanced accuracy {bal:.3f}  [flooded found {rec_wet:.0%}, dry found {rec_dry:.0%}]   accuracy {acc:.3f}")
    for n, v in base.items():
        print(f"{n:12s} AUC {v:.3f} (single score, no training)")
    print(f"always-'flooded' baseline: accuracy {max(sum(y), len(y) - sum(y)) / len(y):.3f}, balanced accuracy 0.500")

    final = fit(X, y)
    all_ids = list(feats)
    probs = predict(final, [feats[a] for a in all_ids])
    order = sorted(range(len(all_ids)), key=lambda i: -probs[i])
    pairs = {all_ids[i]: {"prob": round(probs[i], 3), "rank": r + 1} for r, i in enumerate(order)}
    payload = {
        "model": {
            "trained": True,
            "name": "Flood photo classifier (logistic regression)",
            "labels": len(ids),
            "flooded": sum(y),
            "cv_auc": round(cv_auc, 3) if cv_auc is not None else None,
            "cv_accuracy": round(acc, 3),
            "cv_balanced_accuracy": round(bal, 3),
            "cv_recall_flooded": round(rec_wet, 3),
            "cv_recall_dry": round(rec_dry, 3),
            "cv_auc_95ci": [round(ci[0], 3), round(ci[1], 3)],
            "baseline_auc": {k: round(v, 3) for k, v in base.items() if v is not None},
            "majority_accuracy": round(max(sum(y), len(y) - sum(y)) / len(y), 3),
            "features": names,
            "weights": dict(zip(names, (round(w, 3) for w in final["w"]))),
            "label_sources": sorted({p.name for p in extra} | ({"reviews/flood_labels.jsonl"} if (ROOT / "reviews" / "flood_labels.jsonl").is_file() else set())),
        },
        "pairs": pairs,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB); weights {payload['model']['weights']}")


if __name__ == "__main__":
    main()
