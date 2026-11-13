# Battery cycle and feature clustering

Open [clustering.html](../Web/HTML/clustering.html) for both interactive views.

627 complete cycles out of 632; five flagged charge cycles are excluded without filling missing values.

## Three-group exploratory view

Group names follow PC1 position, using features only. They are not health classes.

| Group | Cycles | Mean SoH (%) | Battery counts |
|---|---:|---:|---|
| 1 | 258 | 88.9 | B0005: 66, B0006: 52, B0007: 76, B0018: 64 |
| 2 | 271 | 73.3 | B0005: 100, B0006: 16, B0007: 90, B0018: 65 |
| 3 | 98 | 68.1 | B0006: 98 |

Two of the three default groups mix batteries; the third contains only B0006. This combines within-cell aging patterns with between-cell differences, rather than establishing universal health classes.

The first two principal components retain 82.3% of standardized feature variance. The default three-group silhouette is 0.376.

## Related features

The default four-group feature cut has the following membership. Strong inverse associations may share a group; the signed heatmap shows their direction.

- Group 1: `rest_time_hours`
- Group 2: `delta_T_max`
- Group 3: `delta_V_ohmic`, `dq_dv_peak`, `t_cc`, `v_at_peak`, `t_cv`
- Group 4: `Rct`, `Re`

CC duration and dQ/dV peak have Spearman rho +0.978; the two resistances have rho +0.943. CC duration and peak voltage move in opposite directions (rho -0.916). These describe the 627 complete pooled cycles.

## Method

- Each row is one aligned discharge cycle. Only complete observed feature vectors enter clustering; no imputation or interpolation is applied.
- For each battery scope and feature setting, center each feature and divide by its population standard deviation (z-score). Fit again when scope or feature setting changes.
- Group cycles by agglomerative Ward linkage on Euclidean distances in the full standardized feature space. Cuts at 2–6 groups share the same hierarchy. Three is an illustrative default, not an estimated true number of groups.
- PCA (principal component analysis) compresses the standardized features to two axes for display only. Clusters are fitted in the full feature space; apparent two-dimensional overlaps may hide separation.
- Capacity, SoH, cycle number and battery ID are excluded from the feature matrix. SoH and battery ID describe groups only after fitting. Group numbers follow feature-only PC1 position and are local to each fit.
- Silhouette compares each cycle's mean distance to its own group with its closest other group; (b−a)/max(a,b), from −1 to +1. Singletons are zero. It measures geometric separation, not prediction accuracy.
- Related features use Spearman rank correlations on the same complete cycles. Average-linkage hierarchical clustering uses distance 1−|rho|, so strong inverse relationships can share a group. The heatmap preserves signed correlations.
- The interval toggle removes rest_time_hours and refits both analyses; it helps reveal sensitivity to the long gaps retained in this observed table.

## Limits

- All four cells are exploratory. Repeated cycles share aging trends and are not independent experimental replicates; these groups do not establish causes, health classes or predictive performance.
- Pooling cells mixes differences between batteries with changes within a battery. Compare individual batteries; their refitted coordinates and group numbers are not directly comparable.
- Standard scaling does not remove outliers or correct skewness. Long discharge intervals can create very small groups; compare the interval setting and read group sizes alongside silhouette.
- The first four charge features are masked in five flagged cycles; their exclusion can affect the result. Source data and missing values are preserved.
- The discharge interval includes charging, so it is not pure idle rest. Nearest impedance alignment can use future measurements; temperature rise needs the full discharge. This is a retrospective description, not a certified online input set.
- Several features are redundant, so equal per-feature scaling can count shared aging information more than once. PCA variance retained does not certify preserved cluster distances or the existence of discrete natural groups.

Rebuild: `python3 Code/analysis/clustering.py --self-test`.

The full-precision JSON and assignment CSVs sit beside the report. The CSVs retain all 632 source rows; excluded rows have blank coordinates and labels.
