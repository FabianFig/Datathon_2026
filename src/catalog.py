"""Load paired imagery from the UTSA metadata CSV without extra dependencies."""

import csv
from pathlib import Path


REQUIRED_COLUMNS = {"image_id", "image_path", "paired_image_id"}


def load_catalog(data_dir: Path) -> list[dict[str, str]]:
    csv_path = data_dir / "image_metadata.csv"
    if not csv_path.is_file():
        raise FileNotFoundError(f"Metadata not found: {csv_path}")
    with csv_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Metadata missing columns: {', '.join(sorted(missing))}")
        rows = list(reader)
    ids = [row["image_id"] for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate image_id values in metadata")
    return rows


def image_path(data_dir: Path, row: dict[str, str]) -> Path:
    """Resolve a metadata path, rejecting paths outside the dataset directory."""
    root = data_dir.resolve()
    relative = Path(row["image_path"])
    if relative.is_absolute():
        raise ValueError(f"Absolute image_path: {relative}")
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"Image path escapes data directory: {relative}")
    return path


def pairs(rows: list[dict[str, str]]) -> list[tuple[dict[str, str], dict[str, str]]]:
    """Return each reciprocal pair once, with the earlier image first when dated."""
    by_id = {row["image_id"]: row for row in rows}
    seen: set[frozenset[str]] = set()
    output = []
    for row in rows:
        mate_id = row.get("paired_image_id", "").strip()
        mate = by_id.get(mate_id)
        if not mate or mate.get("paired_image_id", "").strip() != row["image_id"]:
            continue
        key = frozenset((row["image_id"], mate_id))
        if len(key) != 2 or key in seen:
            continue
        seen.add(key)
        ordered = sorted((row, mate), key=lambda x: (x.get("acquisition_date", ""), x["image_id"]))
        output.append((ordered[0], ordered[1]))
    return sorted(output, key=lambda pair: pair[0]["image_id"])


def search_pairs(items, query: str):
    terms = query.lower().split()
    if not terms:
        return items
    fields = ("image_id", "locality", "source_agency", "acquisition_date", "candidate_condition")
    return [
        pair for pair in items
        if all(term in " ".join(row.get(field, "") for row in pair for field in fields).lower() for term in terms)
    ]
