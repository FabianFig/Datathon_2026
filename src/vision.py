"""Prompt and client for conservative visual comparison of a paired image."""

import base64
import json
import mimetypes
import os
from pathlib import Path


SYSTEM_PROMPT = """You are assisting a human reviewer of Texas aerial imagery.
Compare the two images using only visible pixels. Image 1 is the earlier image;
Image 2 is the later image. Do not assume a change was caused by flooding.
Do not infer water depth, safety, damage cost, or current conditions.
Distinguish visible water from wet ground, shadows, and image artifacts.
If resolution, alignment, or timing prevents a conclusion, say so.
Return only a JSON object with these keys:
summary: one concise sentence about visible change;
visible_water_before: "yes", "no", or "uncertain";
visible_water_after: "yes", "no", or "uncertain";
evidence: array of 1 to 3 short observations, each explicitly naming Image 1 or Image 2;
limitations: array of short limitations or uncertainties;
review_priority: "high", "medium", or "low" for HUMAN IMAGE REVIEW only.
High means a visually striking possible inundation or access change;
it does not mean an emergency severity or response priority."""

ALLOWED_WATER = {"yes", "no", "uncertain"}
ALLOWED_PRIORITY = {"high", "medium", "low"}


def _data_url(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0]
    if mime not in {"image/png", "image/jpeg", "image/webp"}:
        raise ValueError(f"Unsupported image type: {path.suffix}")
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def parse_response(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    result = json.loads(cleaned)
    if not isinstance(result, dict):
        raise ValueError("Model response must be a JSON object")
    for key in ("summary", "visible_water_before", "visible_water_after", "evidence", "limitations", "review_priority"):
        if key not in result:
            raise ValueError(f"Model response missing {key}")
    if result["visible_water_before"] not in ALLOWED_WATER or result["visible_water_after"] not in ALLOWED_WATER:
        raise ValueError("Unexpected water visibility value")
    if result["review_priority"] not in ALLOWED_PRIORITY:
        raise ValueError("Unexpected review priority")
    if not isinstance(result["summary"], str) or not isinstance(result["evidence"], list) or not isinstance(result["limitations"], list):
        raise ValueError("Unexpected response field types")
    return result


def compare_images(before_path: Path, after_path: Path, before: dict, after: dict) -> dict:
    from openai import OpenAI

    base_url = os.getenv("GB10_BASE_URL", "").strip()
    model = os.getenv("GB10_MODEL", "").strip()
    if not base_url or not model:
        raise RuntimeError("Set GB10_BASE_URL and GB10_MODEL before running vision analysis")
    api_key = os.getenv("GB10_API_KEY", "NONE")
    context = (
        f"Image 1: {before.get('image_id')}, date {before.get('acquisition_date')}. "
        f"Image 2: {after.get('image_id')}, date {after.get('acquisition_date')}. "
        "Compare visible changes. Treat metadata as context, not visual proof."
    )
    content = [
        {"type": "text", "text": context},
        {"type": "image_url", "image_url": {"url": _data_url(before_path)}},
        {"type": "image_url", "image_url": {"url": _data_url(after_path)}},
    ]
    with OpenAI(base_url=base_url, api_key=api_key, timeout=120, max_retries=0) as client:
        response = client.chat.completions.create(
            model=model,
            temperature=0,
            max_tokens=500,
            messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": content}],
        )
    return parse_response(response.choices[0].message.content or "")
