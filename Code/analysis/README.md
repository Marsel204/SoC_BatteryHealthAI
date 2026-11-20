# Rebuild reports and HTML

Run from the repository root after installing `requirements.txt`:

```sh
.venv/bin/python Code/analysis/run_eda.py
.venv/bin/python Code/analysis/validate_data.py --self-test
.venv/bin/python Code/analysis/scatterplots.py
.venv/bin/python Code/analysis/clustering.py --self-test
.venv/bin/python Code/analysis/techniques/autocorrelation.py
.venv/bin/python Code/analysis/techniques/mutual_information.py
.venv/bin/python Code/analysis/techniques/feature_overlap.py --self-test
.venv/bin/python Code/analysis/techniques/coverage.py
.venv/bin/python Code/analysis/techniques/uncertainty.py --self-test
.venv/bin/python Code/analysis/model_results.py
.venv/bin/python Code/analysis/explainer/build.py
.venv/bin/python Code/analysis/explainer/build.py --lang id
```

`run_eda.py` checks the source hashes and restores missing raw data from pinned
download URLs. `source_manifest.json` records upstream paths and local locations
for the unchanged loaders in `Code/src/`. It deliberately excludes documentation
and launchers, which are not scientific inputs.

Results are written to `Reports/`; standalone pages go to `Web/HTML/`.
`Reports/learning/*.json` contains the statistical results embedded in the main
visualization. Templates, JavaScript, fonts and their license in `explainer/`
are needed to rebuild its English and Indonesian editions.

`model_results.py` caches the existing five models' leave-one-battery-out metrics
and predictions. Add `--verify-only` to validate the cache without fitting.
`Model/*.joblib` holds the separate models fitted on all cycles for inference.

The observed analysis retains missing values. The processed training table fills
15 cells in five flagged cycles. All four batteries are exploratory, and several
features require measurements taken after charge end.

Browser checks require Playwright and Chromium; generated evidence is ignored:

```sh
node Code/analysis/verify_clustering.mjs
node Code/analysis/explainer/verify.mjs
node Code/analysis/explainer/verify.mjs --lang id
PYTHON="$PWD/.venv/bin/python" node Code/app/verify_ui.mjs
```
