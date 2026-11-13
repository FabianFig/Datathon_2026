# Flood Time Machine

Datathon prototype for exploring historical Texas floods. The desktop analysis tool shows paired aerial imagery on a map, asks a GB10 vision model for a cautious change dossier, and collects human reviews. The main experience is a **React Native app for iOS and Android** in `mobile-app/`, with Rise, Explore, Compare, and Settings screens.

Rise replays historical floods; it is not a current flood forecast for any address. The images and metadata come from the [UTSA flood dataset](https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images). The [GB10 competition repo](https://github.com/jennifer-fowler/GB10competition) provides related notebooks and context.

## Rise: AR flood timelapse (main demo)

The app opens on **Rise**. Pick a real flood, press Play, and watch the water rise around you hour by hour, with the clock, depth in feet and inches, and markers for when moving water knocks you down, cars float, and water goes over your head.

* **Camera mode** draws a water surface over the live camera that stays level with the real ground as you tilt the phone. It uses the phone's motion sensors (pitch/roll from gravity) plus one tap: **Set spot**, then tap where the ground meets a wall, car or curb. The app works out that spot's distance from the tilt angle and your phone's height, then draws the waterline at the correct height on it. This runs in **Expo Go**. LiDAR (the infrared depth sensor on Pro iPhones) would remove the tap step, but Expo Go can't access ARKit depth; that needs a development build (`expo-dev-client`).
* **Side view** is the non-camera, screen-reader-friendly version: an adult and a car with the water rising.
* Haptics and screen-reader announcements fire as each depth threshold is crossed.
* **Water level from → Model forecast** swaps the observed river level for what the ML model predicted 1, 3 or 6 hours earlier.

Replayed events (all held out of model training): Guadalupe River at Hunt and at Kerrville (July 4 2025), W Fork San Jacinto near Humble and Buffalo Bayou near Addicks (Harvey 2017). Depth at "your spot" = river rise minus the ground height you set (default 20 ft above normal river level). It is an illustration, not a forecast for an address.

## Using the trained models

Both models were trained offline, and their results ship with the app as JSON, so Expo Go works with no server:

| Model | Trained on | Output file | Used in the app |
|---|---|---|---|
| River-level forecaster (LightGBM) | USAA Datathon Qwen server | `mobile-app/src/data/floodScenarios.json` (forecasts 1–12 h ahead for each replayed hour) | Rise → More → Water level from → Model forecast |
| Photo change model | Google Colab L4 | `mobile-app/src/data/changeScores.json` (rank + 16×16 heatmap per pair) | Compare card and heatmap; Explore "Top 10% change" badge |

`mobile_server.py` serves the same results plus a live forecast:

| Endpoint | Returns |
|---|---|
| `GET /api/models` | Each model's headline metrics next to its baseline |
| `GET /api/scenarios` | The four flood replays with model forecasts |
| `GET /api/pairs`, `/api/pair?index=` | Pairs now include `change` (score, percentile, rank, heatmap) |
| `GET /api/forecast?gauge=USGS-08165500` | Runs the trained LightGBM models on the gauge's last 4 days of USGS readings and Open-Meteo's rain forecast; returns the predicted rise 1–12 h ahead. `GET /api/forecast` lists the 18 gauges. |

The live forecast needs `pandas numpy lightgbm` on the server (the training environment); without them it returns 503 and everything else still works. When the app is connected in Settings, Rise → More shows a **Live forecast** card for the selected gauge. It is experimental and not an official flood forecast.

## ML model 1: photo change detector (`ml/train_change_detector.py`)

Self-supervised, trained on the 575 UTSA Harvey photo pairs with no labels. A frozen ResNet-50 turns each photo into a 16x16 grid of patch features, and a small conv "camera translator" learns to predict the 2017 NOAA photo's features from the 2016 USDA photo's features. Because the camera difference is shared by every pair, the translator learns it; a flood at one location is unique, so it can't. The patches it fails to predict are the change heatmap. Training uses a trimmed loss that ignores the 20% hardest patches so real changes aren't learned away, and 5-fold cross-validation grouped by spatial block, so every pair is scored by a model that never saw that area.

Checks without labels, each compared with naive before/after feature distance: true-vs-shuffled-pair AUC, change contrast (top patches vs typical patch), and rank correlation with evidence the model never sees: 3-day rainfall, gauge rise between the two dates, FEMA flood zone and distance to a surveyed high-water mark. The app's Compare screen shows each pair's rank and heatmap, and the Explore "high priority" filter includes the top 10%.

## ML model 2: river-stage forecaster (`ml/`)

Predicts how many feet a river rises over the next 1–12 hours from the last 72 h of gauge height and rainfall. Trained on the 18 USGS gauges that the UTSA images link to (`usgs_gage_height_station_id`), 2014–2025, with Open-Meteo ERA5 hourly rain. Train <2021, validate 2021–22, test 2023+, and Harvey 2017 and the July 2025 Hill Country flood removed from training for every gauge. Compared with a persistence baseline (the river stays where it is) using RMSE, rising-water RMSE and CSI for 2 ft rises. Models: LightGBM per lead time, plus a GRU when run with `--gru`.

**Train on Colab:** open `ml/Train_Models_Colab.ipynb` in Colab (GPU runtime), add a `GITHUB_TOKEN` secret with write access to this repo, and run all cells. The photos download straight into Colab in Part A, so nothing needs uploading. The last cell commits both models, `ml/outputs/`, `floodScenarios.json` and `changeScores.json`, and pushes. Everyone else: `git pull`, and Expo Go reloads with the forecast toggle enabled.

Without Colab: `python ml/train_stage_forecaster.py --quick` (needs `pandas numpy lightgbm`; add `torch` for `--gru`). `python ml/build_scenarios.py` (stdlib only) refreshes the observed curves.

## Data

The local data directory must contain `image_metadata.csv` and `images/`:

```bash
hf download jennifer-fowler/UTSA-flood-images --repo-type dataset --local-dir ~/Texas_Flood_Student_Data
export FLOOD_DATA_DIR="$HOME/Texas_Flood_Student_Data"
```

The public dataset includes 1,204 aerial images and 575 reciprocal Harvey pairs. Flood annotation columns are blank, so the model output is a review lead, not a verified label. The weather SQLite file mentioned in the dataset guide is not needed here and is not in the public repository's top-level file listing.

## Desktop app on GB10

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
export FLOOD_DATA_DIR="$HOME/Texas_Flood_Student_Data"
export GB10_BASE_URL=http://127.0.0.1:8000/v1
export GB10_MODEL=your-model-name
export GB10_API_KEY=NONE
streamlit run app.py --server.address 127.0.0.1
```

Ask the organizer for the actual model URL, model name, and key if needed. If using Ollama, its local OpenAI-compatible URL is `http://127.0.0.1:11434/v1` and `GB10_MODEL` is the pulled model tag. Keep any real key in environment variables. The app browses images before a model is configured.

From your laptop, forward the desktop port with `ssh -L 8501:127.0.0.1:8501 USER@GB10_HOST`, then open `http://127.0.0.1:8501`.

## Native mobile app

Start the data service on a machine your phone can reach:

```bash
python mobile_server.py --data-dir "$FLOOD_DATA_DIR" --host 0.0.0.0 --port 8765
```

In a second terminal on your laptop (or on the GB10):

```bash
cd mobile-app
npm ci
npx expo start --lan
```

Install **Expo Go** on your phone and scan the QR code printed by Expo. This project uses Expo SDK 58 to match current Expo Go. For remote testing from anywhere, use `npx expo start --tunnel`. With `--lan`, your phone and the machine running Expo need to share a reachable network. If that network isolates devices, restart with `npx expo start --tunnel ngrok` and scan the new QR code. In **Settings**, enter `http://YOUR_REACHABLE_HOST:8765`, then select a pair in Explore. If the GB10 is only reachable by SSH from your laptop, run the data service through an SSH tunnel and expose that tunnel to the phone through a trusted local network or HTTPS endpoint. `127.0.0.1` on the phone points to the phone itself.

The app ships with all 575 UTSA before/after pairs (`mobile-app/src/data/catalog.json`, regenerated with `python export_catalog.py`), so Explore and Compare work in Expo Go without a server. Images load from Hugging Face and need internet access. The data service is optional; it adds live reviews and new model dossiers.

The app requests camera permission only after **Use camera** is tapped on Rise, and the side view works without it. It uses native labeled controls and text findings so the comparison remains usable without the visual overlay. The old `mobile/` folder is a browser prototype and is not the mobile deliverable.

## What to demonstrate

1. Pick a Harvey pair on the desktop and show the map, images, and model evidence.
2. In the app, select a location, switch between before and after, and read the observation if a dossier exists.
3. Open Rise, play the Hunt 2025 replay in side view, then switch to **Use camera**, set a spot, and replay it in AR.
4. Save a human review in `reviews/reviews.jsonl` for the evaluation story. Analyzed pairs save model dossiers in `reviews/dossiers/`, which the mobile server reads. Rerun the static export after new analyses to include them.

The app works without a model; until a pair is analyzed, the comparison prompts a direct visual review. The four USCG views lack precise coordinates, and the July 2025 Hill Country images were captured after the flood peak; this first version uses the reciprocal 2016/2017 Harvey pairs.
