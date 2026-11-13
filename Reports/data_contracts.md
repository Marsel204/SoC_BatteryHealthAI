# Data contracts: battery dataset validation

A data contract is a set of explicit rules the dataset must follow. Think of it as a delivery inspection: check labels, identifiers, measurements and timing, then record exceptions instead of hiding them.

## Outcome

Validated 632 aligned cycles from 4 batteries. All reusable table and raw-record rules pass. This means the exploratory table follows its documented rules. It does not certify that all nine features can be used at an earlier prediction moment.

## Rules checked

| Rule | Result |
|---|---|
| Every raw/source file must match the pinned SHA-256 manifest. | pass |
| Required cycle-table fields must exist. | pass |
| Battery IDs must be nonempty strings. | pass |
| Cycles, features, capacity and SoH must have numeric dtypes. | pass |
| charge_quality_flag must be boolean, not a string, number or missing value. | pass |
| Each battery/cycle pair must identify exactly one row. | pass |
| Cycle IDs must be finite positive integers. | pass |
| Capacity must be finite and positive. Values above rated capacity are allowed. | pass |
| SoH must equal capacity / 2 Ah × 100 within numerical tolerance. | pass |
| Only the four explicitly flagged charge features may be missing under this table policy. | pass |
| This observed-data version masks all four charge features for a flagged cycle. | pass |
| Present feature values must be finite; an explicit missing value is different from infinity. | pass |
| These feature definitions produce nonnegative durations, resistances, rises, drops and peaks. | pass |
| The raw-cycle audit must have exactly one record for every aligned cycle. | pass |
| Every charge/discharge record must have time, voltage, current and temperature samples. | pass |
| Time, voltage, current and temperature arrays must have matching lengths. | pass |
| Sample times must be finite and strictly increasing within each operation. | pass |
| Sensor samples in selected charge/discharge records must be finite. | pass |
| Aligned rows must reference the correct raw charge and discharge operation types. | pass |
| Cycle labels must agree with the raw discharge Capacity field. | pass |
| The preceding charge must finish no later than discharge starts. | pass |

## Explicit exceptions

- **Five cycles have a charge-quality flag.** The observed-data table keeps their capacity labels and masks all four charging features. They are B0005/B0006/B0007 cycle 31 and B0018 cycles 46 and 56. There are 20 explicitly masked feature cells, not 20 missing cycles.
- **The original processed CSV fills 15 feature cells.** It interpolates t_cc, t_cv and dq_dv_peak in those five cycles. The 4 V fallback peak voltage remains. The validator reports this lineage; it does not fill or change anything.
- **One unused raw charging operation contains six non-finite sensor values.** These are two samples each in voltage, current and temperature for B0018 operation 114 (zero-based). That operation is followed by another charge and is not selected for any aligned cycle. Selected charge/discharge measurements are finite.
- **SoH above 100% is accepted.** The 2 Ah rated capacity is a denominator, not a hard upper bound on the measured capacity of an individual cell. B0006 has values above 100%; clipping them would change the labels.

## Prediction timing: two hypothetical scenarios

No deployment objective has been selected here. Both scenarios are reported so the user can choose what information will be available. 'Discharge start' means the operation-start timestamp, before the later load step.

| Feature | At charge completion | At discharge start |
|---|---|---|
| t_cc | 627 observed/available; 0 future; 0 completion unknown; 5 flagged | 627 observed/available; 0 future; 0 completion unknown; 5 flagged |
| t_cv | 627 observed/available; 0 future; 0 completion unknown; 5 flagged | 627 observed/available; 0 future; 0 completion unknown; 5 flagged |
| dq_dv_peak | 627 observed/available; 0 future; 0 completion unknown; 5 flagged | 627 observed/available; 0 future; 0 completion unknown; 5 flagged |
| v_at_peak | 627 observed/available; 0 future; 0 completion unknown; 5 flagged | 627 observed/available; 0 future; 0 completion unknown; 5 flagged |
| delta_T_max | 0 observed/available; 632 future; 0 completion unknown; 0 flagged | 0 observed/available; 632 future; 0 completion unknown; 0 flagged |
| delta_V_ohmic | 0 observed/available; 632 future; 0 completion unknown; 0 flagged | 0 observed/available; 632 future; 0 completion unknown; 0 flagged |
| Re | 0 observed/available; 599 future; 33 completion unknown; 0 flagged | 0 observed/available; 175 future; 457 completion unknown; 0 flagged |
| Rct | 0 observed/available; 599 future; 33 completion unknown; 0 flagged | 0 observed/available; 175 future; 457 completion unknown; 0 flagged |
| rest_time_hours | 0 observed/available; 632 future; 0 completion unknown; 0 flagged | 632 observed/available; 0 future; 0 completion unknown; 0 flagged |

- A nearest EIS measurement starting after the cutoff is definitely unavailable: 599 rows at charge completion and 175 at discharge start. A sweep that started earlier is not certified available either: the files do not provide its completion timestamp. These counts refer to the source nearest-sweep choice, not a repaired prior-only feature.
- delta_T_max requires the full discharge. delta_V_ohmic requires the load step, which occurs roughly 19–36 seconds after discharge starts in these records. Neither is available at the operation-start instant.
- rest_time_hours is the interval ending at discharge start, including intervening charging. Its final value is unavailable at charge completion. At discharge start it can be known, but it is not pure idle-rest duration.
- The four charging features are available for 627 unflagged cycles at either scenario. The five flagged cycles still need an explicit missing-data/exclusion policy before model use.

## Reusable rules versus snapshot checks

Reusable rules include unique keys, numeric fields, finite positive capacity, the stated SoH formula, explicit missing-data flags, array lengths, increasing sample time, and label agreement with the raw record. They do not require a fixed battery list, 632 rows, or exactly five flags.

Separate snapshot expectations record the known row counts, flag identities, interpolation counts and timing counts for source commit `043ec72936025ce59a3753b31c3c3a16e531df5a`. Those checks detect accidental changes to this particular analysis. The inherited 100 s and 0.1 Ah/V screening thresholds are documented policy choices, not universal battery laws.

## Reproduce and interpret the exit status

```sh
.venv/bin/python Code/analysis/validate_data.py --self-test
```

Exit 0 means required structural/source checks and requested mutation checks passed. Known quality exceptions and hypothetical availability limits remain visible in the report. Exit 1 means validation failed. If a complete nine-feature prediction scenario is explicitly requested with `--require-scenario end_of_charge` or `--require-scenario discharge_start`, exit 2 means that scenario has unavailable, flagged or unconfirmed inputs.

The validator reads the original files and existing analysis tables; it does not rerun the full EDA, alter measurements, impute values or train a model.

## Verification

Mutation tests: 6/6 detected expected failures.

The disposable tests introduce a duplicate cycle, inconsistent SoH, negative capacity, an unflagged missing feature, string quality flags and a missing required field. The original table is never modified.

Limitations: validation rules cannot prove sensor calibration, physical peak identity, causal relationships or generalization. The analysis remains exploratory across only four cells. EIS completion and a final deployment prediction moment still need to be defined.

Machine-readable details, examples and counts are in [data_contracts.json](data_contracts.json).
