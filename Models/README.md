# Battery state-of-health models

The five existing model implementations are in
[Code/app/server/models.py](../Code/app/server/models.py). Their model computation
is unchanged from repository commit `043ec72936025ce59a3753b31c3c3a16e531df5a`.
[catalog.json](catalog.json) records their entry points, input order and evaluation context.

| Model | Class | Configuration |
|---|---|---|
| Ridge | `RidgeBaseline` | StandardScaler; 50 L2 penalties from 10⁻³ to 10³ selected by RidgeCV |
| ElasticNet | `ElasticNetBaseline` | StandardScaler; cross-validated mixed L1/L2 penalties |
| SVR | `SVRBaseline` | StandardScaler; RBF kernel, C=10, epsilon=0.1 |
| Gaussian process | `GaussianProcessModel` | StandardScaler; constant × Matérn 5/2 + white-noise kernel |
| XGBoost | `XGBoostModel` | StandardScaler; 120 trees, depth 3, learning rate 0.05 |

The fitted models and their scalers are included in [`Model/`](../Model/README.md)
as five `.joblib` files, trained on [the existing processed table](../data/features_all_batteries.csv).
The combined app loads them at startup and refreshes missing, damaged, or outdated
artifacts. The manifest records feature order, data and code checksums, and dependency versions.
Run the app with the commands in [Code/README.md](../Code/README.md), or explicitly
retrain with `.venv/bin/python Code/app/train_models.py`.

## Evaluation

The offline [Models tab](../Web/HTML/index.html#models) compares all five models
and plots measured versus held-out predictions. Its
[saved results](../Reports/model_results.json) include every test cycle and fold.
Refresh them with `.venv/bin/python Code/analysis/model_results.py`, or add
`--verify-only` to validate the cache without fitting.

Leave-one-battery-out evaluation trains on three batteries and evaluates on the
fourth, repeating for all four cells. The evaluator fits its scaler on each
training fold. The app exposes a fresh benchmark through `/api/lobo/results`;
the validation view also retains the original repository's published table.
The original published mean RMSE values (SoH percentage points) are Ridge 1.922,
ElasticNet 2.295, GPR 2.704, XGBoost 2.784 and SVR 4.380. These quoted figures are
the existing benchmark, not a new evaluation of this packaging change.

All four cells were inspected during analysis. These scores are development
estimates, not an untouched final holdout. Five flagged charging cycles have 15
interpolated training values; [the observed analysis](../Reports/README.md) leaves
their four charging features blank. Some inputs require discharge data or a later
impedance sweep. Neither the current model scores nor the correlations establish
online prediction at charge end or transfer to new cells.

Model weights describe effects conditional on the other features. Strong feature
overlap can reverse a weight relative to its individual correlation with SoH;
weights should not be treated as physical causation.

## Existing model illustrations

The repository already contains the [LOBO trajectories](../outputs/figures/stage3_lobo_predictions_uncertainty.png)
and [interpretability figure](../outputs/figures/stage4_interpretability_shap_jacobian.png).
The combined app reuses these existing assets.
