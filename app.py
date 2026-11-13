"""A small, local review interface for paired Texas flood imagery."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import streamlit as st

from src.catalog import image_path, load_catalog, pairs, search_pairs
from src.dossiers import load_dossier, save_dossier
from src.vision import compare_images


st.set_page_config(page_title="Waterline", page_icon="🌊", layout="wide")
st.title("Waterline")
st.caption("Travel through historical Texas aerial imagery, inspect visible changes, and open a mobile camera portal.")

default_dir = os.getenv("FLOOD_DATA_DIR", "")
data_text = st.sidebar.text_input("Dataset folder", value=default_dir, placeholder="/path/to/Texas_Flood_Student_Data")
if not data_text:
    st.info("Set FLOOD_DATA_DIR or enter the folder containing image_metadata.csv and images/.")
    st.stop()

data_dir = Path(data_text).expanduser()
try:
    rows = load_catalog(data_dir)
except (FileNotFoundError, ValueError) as exc:
    st.error(str(exc))
    st.stop()

all_pairs = pairs(rows)
st.sidebar.metric("Images", len(rows))
st.sidebar.metric("Reciprocal pairs", len(all_pairs))
st.sidebar.link_button("Open mobile Time Portal", os.getenv("AR_PORTAL_URL", "http://127.0.0.1:8765"))
query = st.sidebar.text_input("Filter by ID, locality, date, agency", placeholder="e.g. Houston")
filtered = search_pairs(all_pairs, query)
if not filtered:
    st.warning("No paired images match this metadata filter.")
    st.stop()

def pair_label(pair):
    before, after = pair
    locality = before.get("locality", "").strip() or after.get("locality", "").strip()
    return f"{before['image_id']} → {after['image_id']} · {locality or 'Unknown locality'}"

selected = st.sidebar.selectbox("Image pair", filtered, format_func=pair_label)
before, after = selected
before_path, after_path = image_path(data_dir, before), image_path(data_dir, after)
portal_url = os.getenv("AR_PORTAL_URL", "http://127.0.0.1:8765").rstrip("/")
st.link_button("Open this pair in mobile Time Portal", f"{portal_url}/?index={all_pairs.index(selected)}")

try:
    latitude = float(before.get("latitude", ""))
    longitude = float(before.get("longitude", ""))
except (ValueError, TypeError):
    latitude = longitude = None
if latitude is not None and longitude is not None:
    with st.expander("Locate this historical scene on the map"):
        st.map([{"lat": latitude, "lon": longitude}], zoom=11)

left, right = st.columns(2)
for column, row, path, title in ((left, before, before_path, "Image 1 · earlier"), (right, after, after_path, "Image 2 · later")):
    with column:
        st.subheader(title)
        if path.is_file():
            st.image(str(path), use_container_width=True)
        else:
            st.warning(f"Image missing: {path.name}")
        st.caption(f"{row.get('image_id', '')} · {row.get('acquisition_date', 'Unknown date')} · {row.get('source_agency', '')}")

with st.expander("Metadata and source context"):
    fields = ("locality", "latitude", "longitude", "source_agency", "source_url", "precipitation_mm", "candidate_condition")
    st.json({"earlier": {k: before.get(k, "") for k in fields}, "later": {k: after.get(k, "") for k in fields}})

st.divider()
st.subheader("AI change dossier")
st.caption("The prompt asks for visible observations, uncertainty, and review priority. It does not infer flood depth or current risk.")
key = f"{before['image_id']}:{after['image_id']}"
dossier_dir = Path(os.getenv("FLOOD_DOSSIER_DIR", "reviews/dossiers"))
if st.button("Analyze this pair", disabled=not (before_path.is_file() and after_path.is_file())):
    try:
        with st.spinner("Comparing images on the GB10 server…"):
            result = compare_images(before_path, after_path, before, after)
            st.session_state[f"result:{key}"] = result
            save_dossier(dossier_dir, before["image_id"], after["image_id"], result)
    except Exception as exc:
        st.error(f"Analysis failed: {exc}")

result = st.session_state.get(f"result:{key}") or load_dossier(dossier_dir, before["image_id"], after["image_id"])
if result:
    st.write(result["summary"])
    st.write(f"**Visible water:** earlier {result['visible_water_before']} · later {result['visible_water_after']}")
    st.write(f"**Human image review priority:** {result['review_priority']}")
    st.write("**Visible evidence**")
    for item in result["evidence"]:
        st.write(f"- {item}")
    st.write("**Limitations**")
    for item in result["limitations"]:
        st.write(f"- {item}")

st.divider()
st.subheader("Human review")
with st.form(f"review:{key}"):
    judgment = st.selectbox("Does the later image show a clear possible inundation or access change?", ("uncertain", "yes", "no"))
    notes = st.text_area("Reviewer notes", placeholder="What pixels support your decision? What is unclear?")
    submitted = st.form_submit_button("Save review locally")
if submitted:
    record = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "before_id": before["image_id"],
        "after_id": after["image_id"],
        "human_judgment": judgment,
        "human_notes": notes,
        "model_result": result,
    }
    review_dir = Path("reviews")
    review_dir.mkdir(exist_ok=True)
    with (review_dir / "reviews.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    st.success("Saved to reviews/reviews.jsonl")
