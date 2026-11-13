# Distribution and coverage

Sort each battery by its original cycle ID. Split chronological row positions into three contiguous groups with numpy.array_split: sizes differ by at most one, with any remainder assigned to early then middle. Preserve original cycle IDs and report each stage's full membership. Compute univariate quantiles using linear interpolation at (n_valid - 1) × probability, excluding missing values separately for each variable and retaining n_valid/n_total. For each battery and variable, compare its finite observations with the inclusive observed min/max of the pooled other batteries; count values strictly below or above that reference range. Also compare late-stage observations with the same battery's early-stage range. Capacity is a measured outcome shown for context, not an input feature. These are descriptive range comparisons, not model training, held-out evaluation, significance tests or generalization estimates.

632 cycles from 4 batteries; 20 missing variable cells remain explicit in n_valid/n_total.
Early → late median capacity: B0005 1.804 → 1.349 Ah; B0006 1.862 → 1.290 Ah; B0007 1.849 → 1.462 Ah; B0018 1.727 → 1.389 Ah.
Largest other-battery marginal range differences among the nine inputs: B0018 rest_time_hours: 81/131 (61.8%) outside; B0006 Re: 103/167 (61.7%) outside; B0006 delta_V_ohmic: 98/167 (58.7%) outside; B0006 v_at_peak: 89/166 (53.6%) outside.
A later model could encounter values beyond earlier experience. Battery identity and aging stage both change distributions, so inspect per-battery and per-stage distributions before choosing a future validation design.
Outside an observed range does not prove a defect or prediction failure; inside a range does not establish a familiar distribution or successful prediction.

## Chronological stages

| Battery | Stage | Cycles | Count |
|---|---|---|---:|
| B0005 | early | 2–57 | 56 |
| B0005 | middle | 58–113 | 56 |
| B0005 | late | 114–168 | 55 |
| B0006 | early | 2–57 | 56 |
| B0006 | middle | 58–113 | 56 |
| B0006 | late | 114–168 | 55 |
| B0007 | early | 2–57 | 56 |
| B0007 | middle | 58–113 | 56 |
| B0007 | late | 114–168 | 55 |
| B0018 | early | 2–45 | 44 |
| B0018 | middle | 46–89 | 44 |
| B0018 | late | 90–132 | 43 |

## Other-battery observed-range comparisons

Reference: all finite observations from the other three batteries. Endpoints count as inside. Capacity is an outcome shown for context.

| Battery | Variable | Valid / total | Reference valid | Outside | Fraction |
|---|---|---:|---:|---:|---:|
| B0005 | capacity | 167 / 167 | 465 | 0 | 0.0% |
| B0005 | t_cc | 166 / 167 | 461 | 0 | 0.0% |
| B0005 | t_cv | 166 / 167 | 461 | 0 | 0.0% |
| B0005 | dq_dv_peak | 166 / 167 | 461 | 0 | 0.0% |
| B0005 | v_at_peak | 166 / 167 | 461 | 3 | 1.8% |
| B0005 | delta_T_max | 167 / 167 | 465 | 0 | 0.0% |
| B0005 | delta_V_ohmic | 167 / 167 | 465 | 0 | 0.0% |
| B0005 | Re | 167 / 167 | 465 | 0 | 0.0% |
| B0005 | Rct | 167 / 167 | 465 | 0 | 0.0% |
| B0005 | rest_time_hours | 167 / 167 | 465 | 0 | 0.0% |
| B0006 | capacity | 167 / 167 | 465 | 49 | 29.3% |
| B0006 | t_cc | 166 / 167 | 461 | 69 | 41.6% |
| B0006 | t_cv | 166 / 167 | 461 | 51 | 30.7% |
| B0006 | dq_dv_peak | 166 / 167 | 461 | 44 | 26.5% |
| B0006 | v_at_peak | 166 / 167 | 461 | 89 | 53.6% |
| B0006 | delta_T_max | 167 / 167 | 465 | 10 | 6.0% |
| B0006 | delta_V_ohmic | 167 / 167 | 465 | 98 | 58.7% |
| B0006 | Re | 167 / 167 | 465 | 103 | 61.7% |
| B0006 | Rct | 167 / 167 | 465 | 76 | 45.5% |
| B0006 | rest_time_hours | 167 / 167 | 465 | 0 | 0.0% |
| B0007 | capacity | 167 / 167 | 465 | 0 | 0.0% |
| B0007 | t_cc | 166 / 167 | 461 | 0 | 0.0% |
| B0007 | t_cv | 166 / 167 | 461 | 0 | 0.0% |
| B0007 | dq_dv_peak | 166 / 167 | 461 | 0 | 0.0% |
| B0007 | v_at_peak | 166 / 167 | 461 | 0 | 0.0% |
| B0007 | delta_T_max | 167 / 167 | 465 | 0 | 0.0% |
| B0007 | delta_V_ohmic | 167 / 167 | 465 | 2 | 1.2% |
| B0007 | Re | 167 / 167 | 465 | 41 | 24.6% |
| B0007 | Rct | 167 / 167 | 465 | 40 | 24.0% |
| B0007 | rest_time_hours | 167 / 167 | 465 | 0 | 0.0% |
| B0018 | capacity | 131 / 131 | 501 | 0 | 0.0% |
| B0018 | t_cc | 129 / 131 | 498 | 0 | 0.0% |
| B0018 | t_cv | 129 / 131 | 498 | 0 | 0.0% |
| B0018 | dq_dv_peak | 129 / 131 | 498 | 0 | 0.0% |
| B0018 | v_at_peak | 129 / 131 | 498 | 0 | 0.0% |
| B0018 | delta_T_max | 131 / 131 | 501 | 0 | 0.0% |
| B0018 | delta_V_ohmic | 131 / 131 | 501 | 0 | 0.0% |
| B0018 | Re | 131 / 131 | 501 | 0 | 0.0% |
| B0018 | Rct | 131 / 131 | 501 | 0 | 0.0% |
| B0018 | rest_time_hours | 131 / 131 | 501 | 81 | 61.8% |

## Interpretation limits

- All four batteries have already been explored; none is an untouched test set. The word held-out in a range comparison does not create an independent evaluation set.
- Cycles within a battery are ordered repeated observations. No naive iid KS p-values, PSI thresholds or statistical significance claims are used.
- An observed min/max is sample-dependent and sensitive to extremes; it is not a physical limit or a probability support estimate. A larger reference sample has more opportunities to contain extremes.
- These are one-variable comparisons. A value inside every marginal range can still form an unfamiliar multivariable combination; inside-range values can also have very different frequencies.
- Battery identity, aging stage, discharge current and resistance measurement protocols can all change distributions. Current/protocol differences confound comparisons; natural aging is not necessarily a defect.
- Stages are relative chronological thirds of observed cycles, not equal elapsed time, equal capacity loss or the same aging state across batteries. Cycle IDs are retained; absent earlier/later observations are not inferred.
- Five flagged cycles keep capacity and other measurements but have all four charge features missing (20 feature cells). No imputation or whole-row deletion is performed.
- Availability matters separately from coverage: delta_T_max needs full discharge, delta_V_ohmic needs the later load step, and nearest EIS Re/Rct can be future or have unknown completion. See data_contracts.md.
- rest_time_hours ends at discharge start and includes intervening charging; it is not pure idle rest. Charging feature values are available only on unflagged cycles at charge completion.
- No capacity-matched comparison or extrapolation is performed. Four cells and their finite observed ranges cannot establish behavior in new cells, operating conditions or future aging stages.

## Verification

- stage_partitions: passed: chronological, disjoint, exhaustive; original cycle IDs preserved
- counts: passed: all variable counts reconcile across stages
- quantile_ordering: passed for all records
- independent_quantiles: passed: sorted-order interpolation matches all 160 records within 1e-12
- independent_support: passed: Python list comparisons match all 80 support records
- strict_json: passed: no NaN or Infinity

The JSON also contains all quantiles, exact stage cycle memberships and early-reference/late-target support comparisons.

Reproduce: `.venv/bin/python Code/analysis/techniques/coverage.py`.
