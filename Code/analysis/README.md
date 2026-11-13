# Reproducible battery data analysis

The source code here builds the reports in [`../../Reports/`](../../Reports/)
and offline pages in [`../../Web/HTML/`](../../Web/HTML/). It reads the existing
repository `data/` and pinned loader/extractor in `src/`; these files are verified
against `source_manifest.json`, not duplicated here.

All four cells are exploratory. Observed analysis preserves missing values.
`model_results.py` separately caches leave-one-battery-out predictions from the
existing five models for the offline HTML. The separate app under
[`../app/`](../app/README.md) uses the existing five SoH models.

## Reproduce

From the repository root, using the environment from `Code/app/requirements.txt`:

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
.venv/bin/python Code/analysis/learning/build.py
.venv/bin/python Code/analysis/model_results.py
.venv/bin/python Code/analysis/explainer/build.py
.venv/bin/python Code/analysis/explainer/build.py --lang id
```

`run_eda.py` restores any missing raw data from pinned upstream URLs and checks
SHA-256 hashes. Existing source files must match the manifest. Do not edit the
pinned files to change the analysis; implement new logic in `Code/`.

## Verify

```sh
node Code/analysis/verify_clustering.mjs
node Code/analysis/learning/verify_dataset.mjs
node Code/analysis/explainer/verify.mjs
node Code/analysis/explainer/verify.mjs --lang id
```

The browser checks use Playwright and Chromium (`/usr/bin/chromium` on this
workstation), open files offline and write ignored verification artifacts beside
the source scripts. The explainer checks compare all displayed correlations,
32 worked cycles, every chart control, CSV output and responsive layouts; the
Indonesian checks additionally require data parity with the English file.
