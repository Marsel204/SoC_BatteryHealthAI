# Battery State of Health

State-of-health estimation and analysis of the NASA B0005, B0006, B0007 and B0018
batteries: 632 aligned cycles, nine features and five regression models.

```text
Model/       fitted models, scalers and their checksum manifest
Reports/     written findings, numerical results and figures
Code/        app, training pipeline, analysis and HTML builders
data/        original MATLAB recordings and the processed training CSV
Web/HTML/    standalone HTML visualizations in English and Indonesian
```

Open the [English visualization](Web/HTML/index.html) or
[versi Bahasa Indonesia](Web/HTML/index-id.html) directly in a browser. Both work
offline. The [audit report](Reports/report.md), [clustering findings](Reports/clustering.md)
and [data checks](Reports/data_contracts.md) contain the written results.
Separate HTML views cover [scatterplots](Web/HTML/scatterplots.html),
[clustering](Web/HTML/clustering.html) and the [audit](Web/HTML/report.html).

## Run

From the repository root, using Python 3.13:

```sh
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python Code/app/run.py
```

Open `http://127.0.0.1:8010`. The app combines data exploration, cycle telemetry,
model comparison and inference. Its model charts use Chart.js and KaTeX from a CDN.

## Train and reproduce

```sh
# Replace the five fitted models and scalers in Model/.
.venv/bin/python Code/app/train_models.py

# Extract features, evaluate all models with LOBO, and regenerate model figures.
.venv/bin/python Code/run_pipeline.py

# Check the app, models and preprocessing.
.venv/bin/python -m pytest -q
```

The pipeline reads `data/raw/`, writes `data/features_all_batteries.csv`, and saves
figures under `Reports/figures/`. See the [analysis guide](Code/analysis/README.md)
to rebuild the reports and HTML, or the [model guide](Model/README.md) to load an
individual saved model. All training, inference and evaluation use the model
definitions in `Code/app/server/models.py`.

## Data and interpretation

SoH is measured capacity divided by the rated 2 Ah capacity, expressed as a
percentage. The training table fills 15 values in five flagged cycles; the
observed report table preserves missing values. The raw data and preprocessing
code are checked against [pinned source hashes](Code/analysis/source_manifest.json).

All four batteries have been explored. Leave-one-battery-out scores are development
estimates, and some features require discharge or later impedance measurements.
The current models estimate SoH retrospectively; these results do not establish
charge-end prediction or performance on new batteries.
