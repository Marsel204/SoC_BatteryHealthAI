# Single-file battery explainer

Open the generated [English HTML](../../../Web/HTML/index.html) or
[versi Bahasa Indonesia](../../../Web/HTML/index-id.html) directly in a browser.
Each file embeds all data, JavaScript and fonts; sharing that file is sufficient.

Three tabs cover processing, analysis and the five SoH models. Detailed methods
are collapsed until needed. The Models tab embeds genuine held-out predictions
and an error ranking from `Reports/model_results.json`; the browser works offline.
The builder verifies source hashes and reproduces 32 worked cycles from raw data.

## Build and verify

From the repository root, with the environment in `Code/app/requirements.txt`:

```sh
.venv/bin/python Code/analysis/model_results.py  # refresh cached LOBO predictions
.venv/bin/python Code/analysis/explainer/build.py
.venv/bin/python Code/analysis/explainer/build.py --lang id
node Code/analysis/explainer/verify.mjs
node Code/analysis/explainer/verify.mjs --lang id
```

Use `model_results.py --verify-only` to validate the saved results without fitting.

Edit `template.html`, `style.css` and `js/*.js` here. Indonesian templates,
modules and supplemental translations are in `id/`. Saved numerical inputs
are in `Reports/`; pinned raw data and loader/extractor are in root `data/`
and `src/`. Fonts and the SIL Open Font License live in `../learning/assets/`.

The browser checks require Playwright/Chromium. Ignored results are written to
`verification/` (and `verification/id/` for Indonesian). Missing data remain
missing and CSV headers retain their machine-readable feature identifiers.
