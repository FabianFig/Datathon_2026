# Flood Time Machine

Datathon prototype for exploring historical Texas floods. The desktop analysis tool shows paired aerial imagery on a map, asks a GB10 vision model for a cautious change dossier, and collects human reviews. The main experience is a **React Native app for iOS and Android** in `mobile-app/`, with Explore, Compare, Camera, and Settings screens.

The phone camera view is an **illustrative historical overlay**, not a geographically registered waterline or a current flood forecast. The images and metadata come from the [UTSA flood dataset](https://huggingface.co/datasets/jennifer-fowler/UTSA-flood-images). The [GB10 competition repo](https://github.com/jennifer-fowler/GB10competition) provides related notebooks and context.

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

Install **Expo Go** on your phone and scan the QR code printed by Expo. This project uses Expo SDK 58 to match current Expo Go. With `--lan`, your phone and the machine running Expo need to share a reachable network. If that network isolates devices, restart with `npx expo start --tunnel ngrok` and scan the new QR code. In **Settings**, enter `http://YOUR_REACHABLE_HOST:8765`, then select a pair in Explore. If the GB10 is only reachable by SSH from your laptop, run the data service through an SSH tunnel and expose that tunnel to the phone through a trusted local network or HTTPS endpoint. `127.0.0.1` on the phone points to the phone itself.

The app opens with eight real public sample pairs, so you can test Explore, Compare, and Camera before connecting the data service. Their images load from Hugging Face and require internet access. Connecting the service replaces the samples with the full paired catalog and available model dossiers.

The app requests camera permission only after **Start camera** is tapped. It uses native labeled controls and text findings so the comparison remains usable without the visual overlay. The old `mobile/` folder is a browser prototype and is not the mobile deliverable.

## What to demonstrate

1. Pick a Harvey pair on the desktop and show the map, images, and model evidence.
2. In the app, select a location, switch between before and after, and read the observation if a dossier exists.
3. Open Camera, start the live view, and adjust overlay opacity. Explain what the aerial image cannot establish.
4. Save a human review in `reviews/reviews.jsonl` for the evaluation story. Analyzed pairs save model dossiers in `reviews/dossiers/`, which the mobile server reads. Rerun the static export after new analyses to include them.

The app works without a model; until a pair is analyzed, the comparison prompts a direct visual review. The four USCG views lack precise coordinates, and the July 2025 Hill Country images were captured after the flood peak; this first version uses the reciprocal 2016/2017 Harvey pairs.
