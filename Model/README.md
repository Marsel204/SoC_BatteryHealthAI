# Saved battery SoH models

Each `.joblib` file contains the fitted model wrapper, including its trained
`StandardScaler`, so `model.predict(X)` accepts features in their original units.

| File | Model |
|---|---|
| `ridge.joblib` | Ridge regression |
| `elasticnet.joblib` | ElasticNet regression |
| `svr.joblib` | Support vector regression |
| `gpr.joblib` | Gaussian process regression, including predictive uncertainty |
| `xgboost.joblib` | XGBoost regression |

These models are trained on all 632 cycles in
`data/features_all_batteries.csv`, with `soh` (percent) as the target.
They are the app's inference models; LOBO validation still trains separate models
on each fold.

The app loads these artifacts at startup. Missing, damaged, or outdated artifacts
are regenerated automatically. `manifest.json` records the feature order, training
data and model code checksums, dependency versions, training time, and file checksums.

To retrain and replace all artifacts, run from the project root:

```sh
.venv/bin/python Code/app/train_models.py
```

To load a model directly, make `Code/app/` importable so Python can resolve the saved
`server.models` classes:

```sh
PYTHONPATH=Code/app .venv/bin/python - <<'PY'
import joblib
import pandas as pd
from server.models import FEATURE_NAMES

model = joblib.load("Model/ridge.joblib")
data = pd.read_csv("data/features_all_batteries.csv")
print(model.predict(data[FEATURE_NAMES].values[:1]))
PY
```

Feature order: `t_cc`, `t_cv`, `dq_dv_peak`, `v_at_peak`, `delta_T_max`,
`delta_V_ohmic`, `Re`, `Rct`, `rest_time_hours`.
