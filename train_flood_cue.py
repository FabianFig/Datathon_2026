"""Train an experimental flooded-road/building image cue on labeled FloodNet.

Run beside UTSA-flood-images/ in Model_GB10. The UTSA images are for later
evaluation; their blank flood labels are never used as training targets.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import random
import re
from pathlib import Path
from zipfile import ZipFile


REPO = "torchgeo/floodnet"
IMAGE_SIZE = 320
FLOOD_FRACTION = 0.001  # >=0.1% annotated flooded road/building pixels
SEED = 42


def split_of(name: str) -> str | None:
    for part in Path(name).parts:
        value = part.lower()
        if value in {"train", "training"} or value.startswith("train-"):
            return "train"
        if value in {"val", "valid", "validation"} or value.startswith("val-"):
            return "val"
        if value == "test" or value.startswith("test-"):
            return "test"
    return None


def stem_of(name: str) -> str:
    return re.sub(r"(?:_lab|_label|_mask)$", "", Path(name).stem.lower())


def discover(zip_path: Path) -> dict[str, list[tuple[str, str]]]:
    """Pair FloodNet images and label masks, supporting both challenge and torchgeo zip formats."""
    images: dict[str, str] = {}
    masks: dict[str, str] = {}
    with ZipFile(zip_path) as archive:
        for name in archive.namelist():
            if name.endswith("/"):
                continue
            lower = name.lower()
            stem = stem_of(name)
            is_img = ("org-img" in lower or "/image/" in lower) and lower.endswith((".jpg", ".jpeg", ".png"))
            is_mask = ("label-img" in lower or "/mask/" in lower) and lower.endswith((".png", ".jpg"))
            if is_img:
                images[stem] = name
            elif is_mask:
                if stem not in masks or "dec" in lower:
                    masks[stem] = name

    paired = []
    for stem, img_name in sorted(images.items()):
        if stem in masks:
            paired.append((img_name, masks[stem]))

    if not paired:
        raise RuntimeError(
            f"Could not pair FloodNet images and masks in {zip_path}. Expected images and masks folders."
        )

    # If archive had explicit train/val/test splits, respect them; otherwise stratify
    has_explicit_val = any("val" in img.lower() for img, _ in paired)
    if has_explicit_val:
        result = {"train": [], "val": [], "test": []}
        for img, mask in paired:
            sp = split_of(img) or "train"
            result[sp].append((img, mask))
        return result

    # Stratified split by class keyword if available
    pos_pairs = [p for p in paired if "flooded" in p[0].lower() and "non-flooded" not in p[0].lower()]
    neg_pairs = [p for p in paired if p not in pos_pairs]

    rng = random.Random(SEED)
    rng.shuffle(pos_pairs)
    rng.shuffle(neg_pairs)

    def split_list(lst: list, r_train=0.70, r_val=0.15):
        n = len(lst)
        n_tr = max(1, int(r_train * n)) if n >= 3 else n
        n_va = max(1, int(r_val * n)) if n >= 3 else 0
        return lst[:n_tr], lst[n_tr : n_tr + n_va], lst[n_tr + n_va :]

    pos_tr, pos_va, pos_te = split_list(pos_pairs)
    neg_tr, neg_va, neg_te = split_list(neg_pairs)

    result = {
        "train": sorted(pos_tr + neg_tr),
        "val": sorted(pos_va + neg_va),
        "test": sorted(pos_te + neg_te),
    }
    return result


def flood_fraction(mask_bytes: bytes) -> float:
    """FloodNet classes 1 and 3 are flooded building and flooded road."""
    import numpy as np
    from PIL import Image

    mask = Image.open(io.BytesIO(mask_bytes))
    mask.thumbnail((512, 512), Image.Resampling.NEAREST)
    values = np.asarray(mask)
    if values.ndim == 2:
        unique = np.unique(values)
        if not set(unique.tolist()).issubset(set(range(10)) | {255}):
            raise ValueError(f"Unrecognized FloodNet mask values: {unique[:20]}")
        flooded = (values == 1) | (values == 3)
    else:
        rgb = np.asarray(mask.convert("RGB"))
        red_building = (rgb[:, :, 0] == 255) & (rgb[:, :, 1] == 0) & (rgb[:, :, 2] == 0)
        road_a = np.all(rgb == (150, 150, 0), axis=2)
        road_b = np.all(rgb == (160, 150, 20), axis=2)
        flooded = red_building | road_a | road_b
    return float(flooded.mean())


def prepare(
    zip_path: Path, manifest: dict[str, list[tuple[str, str]]], cache: Path,
    limits: dict[str, int],
) -> dict[str, list[dict]]:
    from PIL import Image

    rng = random.Random(SEED)
    prepared: dict[str, list[dict]] = {}
    cache.mkdir(parents=True, exist_ok=True)
    with ZipFile(zip_path) as archive:
        for split, pairs in manifest.items():
            chosen = pairs.copy()
            rng.shuffle(chosen)
            if limits[split] > 0:
                chosen = chosen[:limits[split]]
            examples = []
            folder = cache / split
            folder.mkdir(exist_ok=True)
            for number, (image_name, mask_name) in enumerate(chosen, 1):
                fraction = flood_fraction(archive.read(mask_name))
                label = int(fraction >= FLOOD_FRACTION)
                image_id = hashlib.sha1(image_name.encode()).hexdigest()[:16]
                thumb = folder / f"{image_id}.jpg"
                if not thumb.exists():
                    with Image.open(io.BytesIO(archive.read(image_name))) as image:
                        image.convert("RGB").resize((IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BILINEAR).save(
                            thumb, "JPEG", quality=88
                        )
                examples.append({"path": str(thumb), "label": label, "fraction": fraction})
                if number % 100 == 0:
                    print(f"{split}: prepared {number}/{len(chosen)}")
            positives = sum(item["label"] for item in examples)
            print(f"{split}: {len(examples)} images, {positives} positive, {len(examples)-positives} negative")
            if split in {"train", "val"} and (positives == 0 or positives == len(examples)):
                raise RuntimeError(f"{split} has only one class; inspect mask encoding and flood threshold")
            prepared[split] = examples
    return prepared


def train(args: argparse.Namespace, prepared: dict[str, list[dict]]) -> None:
    import torch
    from PIL import Image
    from torch import nn
    from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
    from torchvision import transforms
    from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small

    torch.manual_seed(SEED)
    random.seed(SEED)
    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    print("Training device:", device)

    mean = [0.485, 0.456, 0.406]
    std = [0.229, 0.224, 0.225]

    class FloodDataset(Dataset):
        def __init__(self, rows: list[dict], augment: bool):
            self.rows = rows
            ops = []
            if augment:
                ops += [transforms.RandomHorizontalFlip(), transforms.RandomVerticalFlip()]
            ops += [transforms.ToTensor(), transforms.Normalize(mean, std)]
            self.transform = transforms.Compose(ops)

        def __len__(self) -> int:
            return len(self.rows)

        def __getitem__(self, index: int):
            row = self.rows[index]
            with Image.open(row["path"]) as image:
                tensor = self.transform(image.convert("RGB"))
            return tensor, torch.tensor([row["label"]], dtype=torch.float32)

    train_rows = prepared["train"]
    counts = [sum(row["label"] == label for row in train_rows) for label in (0, 1)]
    weights = [1.0 / counts[row["label"]] for row in train_rows]
    sampler = WeightedRandomSampler(weights, num_samples=len(train_rows), replacement=True)
    bs = min(args.batch_size, len(train_rows))
    train_loader = DataLoader(FloodDataset(train_rows, True), batch_size=bs, sampler=sampler, num_workers=0)
    val_loader = DataLoader(FloodDataset(prepared["val"], False), batch_size=bs, num_workers=0)
    test_loader = DataLoader(FloodDataset(prepared["test"], False), batch_size=bs, num_workers=0)

    pretrained = None if args.no_pretrained else MobileNet_V3_Small_Weights.DEFAULT
    model = mobilenet_v3_small(weights=pretrained)
    model.classifier[-1] = nn.Linear(model.classifier[-1].in_features, 1)
    for parameter in model.features.parameters():
        parameter.requires_grad = False
    for parameter in model.features[-3:].parameters():
        parameter.requires_grad = True
    model.to(device)
    criterion = nn.BCEWithLogitsLoss()
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=args.lr, weight_decay=0.01)

    def scores(loader):
        model.eval()
        truth, predictions = [], []
        with torch.inference_mode():
            for images, labels in loader:
                probabilities = model(images.to(device)).sigmoid().flatten().cpu().tolist()
                truth.extend(int(value) for value in labels.flatten().tolist())
                predictions.extend(probabilities)
        return truth, predictions

    def metrics(truth, probabilities, threshold):
        predicted = [int(value >= threshold) for value in probabilities]
        tp = sum(a == 1 and b == 1 for a, b in zip(truth, predicted))
        fp = sum(a == 0 and b == 1 for a, b in zip(truth, predicted))
        fn = sum(a == 1 and b == 0 for a, b in zip(truth, predicted))
        tn = sum(a == 0 and b == 0 for a, b in zip(truth, predicted))
        precision = tp / max(tp + fp, 1)
        recall = tp / max(tp + fn, 1)
        return {"precision": precision, "recall": recall,
                "f1": 2 * precision * recall / max(precision + recall, 1e-8),
                "accuracy": (tp + tn) / max(len(truth), 1),
                "tp": tp, "fp": fp, "fn": fn, "tn": tn}

    best_f1 = -1.0
    best_state = None
    for epoch in range(1, args.epochs + 1):
        model.train()
        losses = []
        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(model(images), labels)
            loss.backward()
            optimizer.step()
            losses.append(float(loss.item()))
        val_y, val_scores = scores(val_loader)
        report = metrics(val_y, val_scores, 0.5)
        print(f"epoch {epoch}: loss={sum(losses)/len(losses):.4f} val_f1={report['f1']:.3f} val_recall={report['recall']:.3f}")
        if report["f1"] > best_f1:
            best_f1 = report["f1"]
            best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}

    assert best_state is not None
    model.load_state_dict(best_state)
    val_y, val_scores = scores(val_loader)
    threshold = max((n / 100 for n in range(20, 81, 2)), key=lambda cut: metrics(val_y, val_scores, cut)["f1"])
    test_y, test_scores = scores(test_loader)
    report = {
        "task": "experimental visual cue for flooded road/building pixels",
        "source": "FloodNet supervised, rehosted at torchgeo/floodnet",
        "label_rule": f"class 1 or 3 occupies >= {FLOOD_FRACTION:.1%} of image",
        "input_size": IMAGE_SIZE, "mean": mean, "std": std, "threshold": threshold,
        "split_sizes": {key: len(value) for key, value in prepared.items()},
        "validation": metrics(val_y, val_scores, threshold),
        "test": metrics(test_y, test_scores, threshold) if test_y else None,
        "warning": "Not validated on UTSA imagery. Do not use for current hazards, depth, or evacuation decisions.",
    }
    args.output.mkdir(parents=True, exist_ok=True)
    model.eval().cpu()
    traced = torch.jit.trace(model, torch.randn(1, 3, IMAGE_SIZE, IMAGE_SIZE))
    traced.save(str(args.output / "flood_cue.ts"))
    (args.output / "flood_cue.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    print("Saved:", args.output / "flood_cue.ts", args.output / "flood_cue.json")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path, help="Local FloodNet ZIP; downloaded from Hugging Face if omitted")
    parser.add_argument("--output", type=Path, default=Path("models/flood_cue"))
    parser.add_argument("--cache", type=Path, default=Path("work/floodnet_thumbs"))
    parser.add_argument("--max-train", type=int, default=1200)
    parser.add_argument("--max-val", type=int, default=300)
    parser.add_argument("--max-test", type=int, default=300)
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--no-pretrained", action="store_true")
    parser.add_argument("--inspect", action="store_true", help="Only inspect ZIP image/mask pairing")
    args = parser.parse_args()

    if args.zip is None:
        if Path("work/floodnet_subset.zip").is_file():
            args.zip = Path("work/floodnet_subset.zip")
            print(f"Using local FloodNet archive: {args.zip}")
        else:
            from huggingface_hub import hf_hub_download
            print("Downloading FloodNet archive from Hugging Face...")
            args.zip = Path(hf_hub_download(repo_id=REPO, filename="floodnet.zip", repo_type="dataset"))
    if not args.zip.is_file():
        parser.error(f"FloodNet ZIP not found: {args.zip}")
    manifest = discover(args.zip)
    for split, pairs in manifest.items():
        print(f"{split}: {len(pairs)} paired images/masks")
    if args.inspect:
        print("Example pair:", manifest["train"][0])
        return
    prepared = prepare(args.zip, manifest, args.cache,
                       {"train": args.max_train, "val": args.max_val, "test": args.max_test})
    train(args, prepared)


if __name__ == "__main__":
    main()
