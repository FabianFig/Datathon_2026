"""Store and retrieve human reviews of flood image pairs."""

from __future__ import annotations

import datetime
import json
from pathlib import Path
from typing import Any


def save_review(
    reviews_file: Path,
    before_id: str,
    after_id: str,
    agreement: str,
    notes: str = "",
    reviewer: str = "mobile_user",
) -> dict[str, Any]:
    reviews_file.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "before_id": before_id,
        "after_id": after_id,
        "agreement": agreement,  # "confirmed_change", "no_significant_change", "unclear_or_artifact", "false_positive"
        "notes": notes.strip(),
        "reviewer": reviewer,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    with reviews_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record


def load_reviews_index(reviews_file: Path) -> dict[tuple[str, str], dict[str, Any]]:
    if not reviews_file.is_file():
        return {}
    results = {}
    with reviews_file.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
                key = (item["before_id"], item["after_id"])
                results[key] = item
            except Exception:
                continue
    return results
