"""Persist model evidence so desktop and mobile views share the same result."""

import hashlib
import json
from pathlib import Path


def _path(directory: Path, before_id: str, after_id: str) -> Path:
    key = f"{before_id}\0{after_id}".encode("utf-8")
    return directory / f"{hashlib.sha256(key).hexdigest()}.json"


def save_dossier(directory: Path, before_id: str, after_id: str, result: dict) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    path = _path(directory, before_id, after_id)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def load_dossier(directory: Path, before_id: str, after_id: str) -> dict | None:
    path = _path(directory, before_id, after_id)
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))
