# Offline battery learning lab

Open [the generated learning lab](../../../Web/HTML/learning/index.html) directly
in a browser. The file embeds its data, scripts and licensed Manrope font.

The lessons explain data contracts, autocorrelation, mutual information, feature
overlap, distribution coverage and time-aware uncertainty. The Dataset tab
filters and downloads the exact observed table with all 632 rows and explicit
missing measurements. All four cells remain exploratory.

## Rebuild

The technique scripts listed in [the analysis README](../README.md) produce the
inputs under `Reports/learning/`. Then run from the repository root:

```sh
.venv/bin/python Code/analysis/learning/build.py
node Code/analysis/learning/verify_dataset.mjs
```

`index.template.html`, `style.css`, `app.js` and `dataset.js` are the editable
sources. Font files, provenance and the SIL Open Font License are in `assets/`.
The builder writes `Web/HTML/learning/index.html`. Browser verification artifacts
are ignored under this directory's `verification/`.
