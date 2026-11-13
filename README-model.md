# Flood visual cue model

Put these files directly in `Model_GB10/`, beside your existing `UTSA-flood-images/` directory:

```
Model_GB10/
├── UTSA-flood-images/       # already downloaded
├── train_flood_cue.py
├── predict_flood_cue.py
├── work/                   # created by the training script
└── models/                 # created by the training script
```

This trains an **image-level cue for visible flooded roads or buildings**. It uses FloodNet's annotated image masks to make training labels. The UTSA image metadata has no verified `flood_visible` labels, so the UTSA images are reserved for visual review and later evaluation.

## Run from the VS Code terminal

Use Python 3.13 and a GPU-capable PyTorch with matching torchvision. In fish, create a separate environment if your current `.venv` uses Python 3.15:

```bash
python3.13 -m venv .venv313
source .venv313/bin/activate.fish
python -V
python -m pip install --index-url https://pypi.org/simple torch torchvision pillow numpy huggingface_hub
python -c "import torch, torchvision, PIL, huggingface_hub; print(torch.__version__, torchvision.__version__)"
```

Stop if `pip install` fails; the later commands will also fail without those packages. If it reports a connection reset, check `curl -I https://pypi.org/simple/pillow/` and retry on a working connection. If you train on NVIDIA DGX Spark instead, use NVIDIA's supported PyTorch environment rather than replacing it with a generic wheel. The [official PyTorch install selector](https://pytorch.org/get-started/locally/) has platform-specific options.

From `Model_GB10/`:

```bash
python train_flood_cue.py --inspect
python train_flood_cue.py --epochs 6
```

The first command downloads the approximately 12.8 GB `torchgeo/floodnet` archive and prints its paired image/mask counts. The download is cached by Hugging Face, so the second command reuses it. If you have the archive already, use `--zip /path/to/floodnet.zip` on both commands. The script prepares 320-pixel thumbnails under `work/floodnet_thumbs/`, trains MobileNetV3 Small, prints validation and test metrics, and saves `models/flood_cue/flood_cue.ts` plus `flood_cue.json`. To make a quick smoke run, add `--max-train 200 --max-val 100 --epochs 1`, then rerun with defaults for the actual model.

Score one or more local images after training:

```bash
python predict_flood_cue.py path/to/aerial_photo.jpg
python predict_flood_cue.py path/to/first.jpg path/to/second.jpg
```

The output is one JSON line per image. The score is a visual cue, **not a calibrated chance of flooding**. The threshold is selected on FloodNet validation images. FloodNet is UAV imagery from Hurricane Harvey; performance on UTSA's mixed sources has not been established. Do not use this score for live hazard, depth, route, or evacuation decisions.

Sources: [FloodNet dataset and license](https://github.com/BinaLab/FloodNet-Supervised_v1.0), [Hugging Face archive](https://huggingface.co/datasets/torchgeo/floodnet/tree/main), [PyTorch installation](https://pytorch.org/get-started/locally/).
