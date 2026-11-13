# Feature overlap: four charging features

Per battery and pooled, use the same complete cases of t_cc, t_cv, dq_dv_peak and v_at_peak. Center and scale columns (sample standard deviation). For a full-rank design, VIF is the diagonal of the inverse Pearson correlation matrix. Independently verify every finite VIF against 1/(1-R²) from a least-squares regression of that feature on an explicit intercept and the other three standardized features. R² = 1 - SSE/SST. In singular designs, inspect each auxiliary regression: a numerically zero residual gives status infinite and JSON null. Constant features have undefined VIF. Rank and condition diagnostics use the standardized feature matrix, excluding the intercept. Pairwise Spearman correlations use the identical four-feature complete cases.

Pooled complete cases: 627 of 632 aligned cycles; 5 cycles excluded without imputation.
Pooled VIF: t_cc 31.52, t_cv 6.49, dq_dv_peak 18.58, v_at_peak 9.02.
Per-cell VIF: B0005: t_cc 245.35, t_cv 31.01, dq_dv_peak 123.09, v_at_peak 23.36; B0006: t_cc 77.69, t_cv 6.80, dq_dv_peak 59.85, v_at_peak 47.87; B0007: t_cc 96.27, t_cv 39.22, dq_dv_peak 55.97, v_at_peak 11.95; B0018: t_cc 24.08, t_cv 3.15, dq_dv_peak 16.22, v_at_peak 7.72.
Compare the battery-specific estimates with pooled estimates before interpreting any coefficient; no feature-removal decision follows automatically.

| Battery | Complete cycles | Feature | VIF | Status |
|---|---:|---|---:|---|
| ALL | 627 | t_cc | 31.520 | finite |
| ALL | 627 | t_cv | 6.487 | finite |
| ALL | 627 | dq_dv_peak | 18.585 | finite |
| ALL | 627 | v_at_peak | 9.017 | finite |
| B0005 | 166 | t_cc | 245.351 | finite |
| B0005 | 166 | t_cv | 31.006 | finite |
| B0005 | 166 | dq_dv_peak | 123.092 | finite |
| B0005 | 166 | v_at_peak | 23.360 | finite |
| B0006 | 166 | t_cc | 77.688 | finite |
| B0006 | 166 | t_cv | 6.802 | finite |
| B0006 | 166 | dq_dv_peak | 59.851 | finite |
| B0006 | 166 | v_at_peak | 47.871 | finite |
| B0007 | 166 | t_cc | 96.266 | finite |
| B0007 | 166 | t_cv | 39.217 | finite |
| B0007 | 166 | dq_dv_peak | 55.973 | finite |
| B0007 | 166 | v_at_peak | 11.950 | finite |
| B0018 | 129 | t_cc | 24.084 | finite |
| B0018 | 129 | t_cv | 3.149 | finite |
| B0018 | 129 | dq_dv_peak | 16.217 | finite |
| B0018 | 129 | v_at_peak | 7.716 | finite |

## Standardized feature diagnostics

| Battery | Rank / 4 | Condition number | Excluded cycles |
|---|---:|---:|---:|
| ALL | 4 / 4 | 13.424 | 5 |
| B0005 | 4 / 4 | 37.928 | 1 |
| B0006 | 4 / 4 | 21.653 | 1 |
| B0007 | 4 / 4 | 24.238 | 1 |
| B0018 | 4 / 4 | 11.238 | 2 |

## Same-row Spearman correlations

| Battery | Feature A | Feature B | Spearman ρ | Cycles |
|---|---|---|---:|---:|
| ALL | t_cc | t_cv | -0.892 | 627 |
| ALL | t_cc | dq_dv_peak | 0.978 | 627 |
| ALL | t_cc | v_at_peak | -0.916 | 627 |
| ALL | t_cv | dq_dv_peak | -0.858 | 627 |
| ALL | t_cv | v_at_peak | 0.898 | 627 |
| ALL | dq_dv_peak | v_at_peak | -0.908 | 627 |
| B0005 | t_cc | t_cv | -0.961 | 166 |
| B0005 | t_cc | dq_dv_peak | 0.991 | 166 |
| B0005 | t_cc | v_at_peak | -0.956 | 166 |
| B0005 | t_cv | dq_dv_peak | -0.948 | 166 |
| B0005 | t_cv | v_at_peak | 0.963 | 166 |
| B0005 | dq_dv_peak | v_at_peak | -0.943 | 166 |
| B0006 | t_cc | t_cv | -0.894 | 166 |
| B0006 | t_cc | dq_dv_peak | 0.996 | 166 |
| B0006 | t_cc | v_at_peak | -0.986 | 166 |
| B0006 | t_cv | dq_dv_peak | -0.891 | 166 |
| B0006 | t_cv | v_at_peak | 0.891 | 166 |
| B0006 | dq_dv_peak | v_at_peak | -0.984 | 166 |
| B0007 | t_cc | t_cv | -0.953 | 166 |
| B0007 | t_cc | dq_dv_peak | 0.989 | 166 |
| B0007 | t_cc | v_at_peak | -0.911 | 166 |
| B0007 | t_cv | dq_dv_peak | -0.951 | 166 |
| B0007 | t_cv | v_at_peak | 0.950 | 166 |
| B0007 | dq_dv_peak | v_at_peak | -0.917 | 166 |
| B0018 | t_cc | t_cv | -0.764 | 129 |
| B0018 | t_cc | dq_dv_peak | 0.932 | 129 |
| B0018 | t_cc | v_at_peak | -0.909 | 129 |
| B0018 | t_cv | dq_dv_peak | -0.636 | 129 |
| B0018 | t_cv | v_at_peak | 0.639 | 129 |
| B0018 | dq_dv_peak | v_at_peak | -0.945 | 129 |

## Interpretation limits

- Exploratory measurements from four cells; cycles within a cell are repeated, temporally ordered observations, not independent experimental replicates.
- VIF measures linear redundancy among input features, whereas Spearman describes monotonic pairwise association; the two need not agree.
- High VIF can make individual linear coefficients unstable or hard to interpret even when predictions remain useful. No prediction model or accuracy estimate is produced here.
- No automatic feature-drop threshold is applied, and no causal conclusion follows from these associations.
- Pooling cells can mix within-cell and between-cell associations and hide battery differences. Read per-cell results alongside ALL.
- Capacity, SoH and cycle number are never included as features. These four inputs are available at charge completion only for unflagged cycles, according to data_contracts.md.
- Complete-case analysis excludes the five jointly masked charging cycles without imputation; missingness can affect conclusions.
- The reported condition number uses standardized feature columns, so it reflects overlap rather than differences in physical units. It is not the condition number of a predictive model.
- Exact or numerical perfect collinearity is represented by a null VIF and status infinite; undefined cases are also null with a distinct status. A singular matrix warns rather than producing a misleading pseudoinverse VIF.

Verification: inverse-correlation VIF agrees with independent intercept-based 1/(1−R²) within relative tolerance 1e-7 and absolute tolerance 1e-9.

Reproduce: `.venv/bin/python Code/analysis/techniques/feature_overlap.py --self-test`.
