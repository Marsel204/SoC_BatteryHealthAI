# Models, analysis and HTML source

This directory contains the implementation behind [Models](../Models/README.md),
[Reports](../Reports/README.md) and the [HTML deliverables](../Web/HTML/README.md).
The existing repository's `data/`, `src/` and `outputs/figures/` supply the pinned
NASA data, original loader/extractor and model illustrations.

```text
Models/       model catalogue and evaluation notes
Reports/      observed tables, numerical results, written reports and plots
Web/HTML/     offline English/Indonesian explainers and analysis pages
Code/
  app/        combined Data analysis → Model app, API and tests
  analysis/   reproducible analysis and HTML builders, templates and fonts
```

## Run the combined app

From the repository root:

```sh
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -r Code/app/requirements.txt
.venv/bin/python Code/app/run.py
```

Open `http://127.0.0.1:8010`. The existing five models fit once at startup.
The standalone [English](../Web/HTML/index.html) and
[Indonesian](../Web/HTML/index-id.html) explainers work without Python or a server.

## Reproduce and verify

The [analysis instructions](analysis/README.md) list the processing, validation,
statistics and HTML build commands. Processing verifies the original files using
[the pinned SHA-256 manifest](analysis/source_manifest.json). Missing raw files
are restored from its pinned download URLs.

```sh
.venv/bin/python -m pytest -q Code/app
.venv/bin/python Code/analysis/validate_data.py --self-test
.venv/bin/python Code/analysis/explainer/build.py
.venv/bin/python Code/analysis/explainer/build.py --lang id
node Code/analysis/explainer/verify.mjs
node Code/analysis/explainer/verify.mjs --lang id
PYTHON="$PWD/.venv/bin/python" node Code/app/verify_ui.mjs
```

Browser verification requires Playwright and Chromium. Generated verification
screenshots and caches are ignored. The app's model charts load Chart.js/KaTeX
from jsDelivr; the explainers embed their data, scripts and fonts for offline use.

## Reading the results

The reports retain missing observations. The model training table fills 15 values
in five flagged cycles, so the two tables deliberately differ. All four cells
have been explored: leave-one-battery-out results are development estimates.
Several inputs require discharge data or a later impedance sweep; the existing
models estimate SoH retrospectively rather than demonstrate charge-end prediction.
