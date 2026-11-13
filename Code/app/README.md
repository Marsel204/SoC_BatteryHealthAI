# Battery SoH: Data analysis → Model

One app with two steps. **Data analysis** shows what the data says; **Model** estimates state of
health (SoH) from the same nine features, and carries the analysis' findings into how its scores
should be read.

| Step | Views |
|---|---|
| 1 · Data analysis | Feature relationships (scatterplots and a Spearman table by battery) · Clusters · Dataset Explorer · Cycle Telemetry · Audit report · link to the learning lab |
| 2 · Model | Simulator & Sensitivities (Ridge, ElasticNet, SVR, GPR with uncertainty, XGBoost) · Validation & Proofs (leave-one-battery-out) · Math & Methodology |

## Run

From the project root:

```sh
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -r Code/app/requirements.txt
.venv/bin/python Code/app/run.py            # http://127.0.0.1:8010
```

Options: `--port`, `--host`, `--open-browser`, `--reload`. The five fitted models and their scalers
are saved in [`Model/`](../../Model/README.md) as individual `.joblib` files and loaded at startup.
Missing, damaged, or outdated artifacts are retrained (about 15 s) and saved automatically;
the manifest checks the training data, model code, feature order, and dependency versions.
To force retraining, run `.venv/bin/python Code/app/train_models.py` from the repository root.
The app needs the pinned data in `data/` and `src/` and the analysis
outputs in `Reports/` and HTML in `Web/HTML/`; if any are missing it says which, and `Code/analysis/run_eda.py` recreates
them. It reads all analysis inputs without modifying them.

Model views draw charts and equations with Chart.js and KaTeX from jsDelivr, as the upstream app
does, so they need a network connection. The scatterplots, tables and reports do not.

The standalone explainers are [English](../../Web/HTML/index.html) and
[Bahasa Indonesia](../../Web/HTML/index-id.html). The app preserves `/analysis/*.html`
as redirects to `/Web/HTML/*.html`; numerical files are available at `/analysis/`
and `/Reports/`, and the classic lab remains at `/learning/`.

## How the two steps connect

The Model step opens with **From the data analysis**: four notes and a table that sets each feature's
Spearman ρ with SoH next to its Ridge weight and whether its value is known at charge end. Every number
is computed from the analysis files or the fitted models, and tests pin them:

- **Scores are development estimates.** Leave-one-battery-out never puts neighbouring cycles of one cell on
  both sides of a split, but all four cells were inspected, so there is no untouched test set.
- **Some inputs are only known after the cycle.** Temperature rise and the initial voltage drop need the
  discharge; Re and Rct come from a nearest impedance sweep that mostly starts later. The models estimate
  SoH retrospectively; the scores say nothing about end-of-charge prediction.
- **Flagged cycles are filled in for the models.** Five cycles have flagged charging measurements. The Data
  analysis step leaves them blank; the models' training table interpolates 15 cells in them.
- **Weights depend on the other inputs.** Four of the eight features with a clear univariate direction get a
  Ridge weight of the opposite sign, and the four charging features overlap strongly (pooled VIF 6.5 to 31.5).
  Upstream's Jacobian view describes the weights as a physical sign check; read them as effects given the
  other eight inputs instead.

## Where the data comes from

| Used by | Source |
|---|---|
| Feature relationships | `Reports/cycles_observed_flagged.csv`, read with the validated loader in `Code/analysis/scatterplots.py`: observed values, no interpolation |
| Clusters, Audit report | `Web/HTML/clustering.html` and `report.html`, shown in frames that follow the app's dark theme |
| Models, Dataset Explorer | `data/features_all_batteries.csv`, the original processed table |
| Cycle Telemetry | `data/raw/*.mat` through the pinned loader in `src/` |

At start-up the app checks the processed CSV and the two loader files against `Code/analysis/source_manifest.json`.

## Provenance

`server/models.py`, the dashboard and the tests come from
[Marsel204/SoC_BatteryHealthAI](https://github.com/Marsel204/SoC_BatteryHealthAI) at commit `043ec72`.
`source_manifest.json` lists each file's upstream SHA-256 and what changed in the modified ones; a test
fails if a file marked unmodified drifts. The model definitions, API responses and upstream views are unchanged.
Startup now persists and reloads models through `server/model_store.py`. What
this app also adds is `server/analysis.py`, `server/paths.py`, `static/analysis.js`, `static/analysis.css`, the
two-step navigation and this README.

## Checks

```sh
cd Code/app && ../../.venv/bin/python -m pytest -q    # API, models, statistics, bridge, page structure
node Code/app/verify_ui.mjs                    # browser checks; starts its own server
# With a Python environment elsewhere:
PYTHON=/path/to/venv/bin/python node Code/app/verify_ui.mjs
```

The browser check compares every displayed scatter statistic and correlation cell with the API, follows the
hand-off between the steps, and tests each view at phone width. Screenshots go to `Code/app/verification/`.

## Limits

- Four cells and 632 aligned cycles. The analysis and the models both come from these same cells.
- The table in Validation & Proofs is static text from upstream. A fresh run reproduces it, with XGBoost
  within 0.01 RMSE; `/api/lobo/results` computes the benchmark live.
- No authentication, and CORS is open as upstream. It binds to 127.0.0.1 by default; do not expose it.
