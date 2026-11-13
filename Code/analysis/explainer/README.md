# Single-file battery explainer

Open the generated [English HTML](../../../Web/HTML/index.html) or
[versi Bahasa Indonesia](../../../Web/HTML/index-id.html) directly in a browser.
Each file embeds all data, JavaScript and fonts; sharing that file is sufficient.

The 21 figures explain operation alignment, feature extraction, flagged charge
records, data contracts, availability, correlations, trends, mutual information,
overlap, clustering, coverage and uncertainty. The builder verifies source hashes
and reproduces 32 worked examples from raw data. No predictive model is fitted.

## Build and verify

From the repository root, with the environment in `Code/app/requirements.txt`:

```sh
.venv/bin/python Code/analysis/explainer/build.py
.venv/bin/python Code/analysis/explainer/build.py --lang id
node Code/analysis/explainer/verify.mjs
node Code/analysis/explainer/verify.mjs --lang id
```

Edit `template.html`, `style.css` and `js/*.js` here. Indonesian templates,
modules and supplemental translations are in `id/`. Saved numerical inputs
are in `Reports/`; pinned raw data and loader/extractor are in root `data/`
and `src/`. Fonts and the SIL Open Font License live in `../learning/assets/`.

The browser checks require Playwright/Chromium. Ignored results are written to
`verification/` (and `verification/id/` for Indonesian). Missing data remain
missing and CSV headers retain their machine-readable feature identifiers.
