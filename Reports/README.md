# Reports and numerical results

Start with [the written audit](report.md), [clustering findings](clustering.md),
or [data-contract checks](data_contracts.md). Interactive pages are in
[Web/HTML](../Web/HTML/README.md).

- `cycles_observed_flagged.csv` is the 632-cycle exploratory table. Four charging
  features are blank in five flagged cycles; observations are never filled here.
- `feature_target_correlations.csv`, `temporal_diagnostics.csv` and the other CSVs
  record statistics, raw-operation alignment, quality checks and cluster assignments.
- `clustering.json` and `data_contracts.json` contain detailed reproducible results.
- `learning/` contains autocorrelation, mutual information, feature overlap,
  distribution coverage and time-aware uncertainty outputs.
- `model_results.json` contains the five models' LOBO metrics and 3,160 held-out
  predictions. Source hashes and independent metric checks guard this cache.
- `figures/` contains the audit's PNG figures. Existing model-methodology figures
  remain in [outputs/figures](../outputs/figures/).
- `verification.json` records scientific reconstruction and consistency checks;
  browser screenshots, downloaded samples and temporary QA directories are excluded.

Reproduction commands are documented in [Code/analysis](../Code/analysis/README.md).
The processed source table and raw NASA recordings are in the repository's
existing `data/` directory, with checksums in
[`Code/analysis/source_manifest.json`](../Code/analysis/source_manifest.json).

All four cells are exploratory. These reports describe associations and geometric
groups; they do not establish causation, untouched-test accuracy, or availability
of every feature at charge end.
