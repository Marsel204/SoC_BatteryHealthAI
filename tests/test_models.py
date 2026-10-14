import pytest
import numpy as np
import pandas as pd
from src.models import (
    BatteryLOBOEvaluator,
    RidgeBaseline,
    ElasticNetBaseline,
    SVRBaseline,
    GaussianProcessModel,
    XGBoostModel,
)

@pytest.fixture
def sample_feature_df():
    # Create small synthetic dataframe for 4 batteries
    np.random.seed(42)
    batteries = ["B0005", "B0006", "B0007", "B0018"]
    rows = []
    for b in batteries:
        for c in range(2, 22):
            t_cc = 3000 - 10 * c + np.random.normal(0, 10)
            t_cv = 6000 + 20 * c + np.random.normal(0, 20)
            dq_dv = 5.0 - 0.05 * c + np.random.normal(0, 0.02)
            v_peak = 4.0 + 0.001 * c
            dT = 14.0 + 0.05 * c
            dV = 0.20 + 0.0005 * c
            Re = 0.04 + 0.0002 * c
            Rct = 0.06 + 0.0003 * c
            rest = 3.0 + np.random.exponential(2.0)
            soh = 100.0 - 0.5 * c + 0.05 * rest
            cap = (soh / 100.0) * 2.0
            rows.append({
                "battery_id": b,
                "cycle": c,
                "t_cc": t_cc,
                "t_cv": t_cv,
                "dq_dv_peak": dq_dv,
                "v_at_peak": v_peak,
                "delta_T_max": dT,
                "delta_V_ohmic": dV,
                "Re": Re,
                "Rct": Rct,
                "rest_time_hours": rest,
                "capacity": cap,
                "soh": soh,
            })
    return pd.DataFrame(rows)

def test_ridge_fit_predict(sample_feature_df):
    model = RidgeBaseline()
    feature_cols = [
        "t_cc", "t_cv", "dq_dv_peak", "v_at_peak",
        "delta_T_max", "delta_V_ohmic", "Re", "Rct", "rest_time_hours"
    ]
    train_mask = sample_feature_df["battery_id"] != "B0018"
    test_mask = sample_feature_df["battery_id"] == "B0018"
    
    X_train = sample_feature_df.loc[train_mask, feature_cols].values
    y_train = sample_feature_df.loc[train_mask, "soh"].values
    X_test = sample_feature_df.loc[test_mask, feature_cols].values
    y_test = sample_feature_df.loc[test_mask, "soh"].values
    
    model.fit(X_train, y_train)
    preds = model.predict(X_test)
    assert len(preds) == len(y_test)
    metrics = model.evaluate(y_test, preds)
    assert "rmse" in metrics and "mae" in metrics and "r2" in metrics
    assert metrics["rmse"] < 5.0

def test_gpr_uncertainty(sample_feature_df):
    model = GaussianProcessModel()
    feature_cols = [
        "t_cc", "t_cv", "dq_dv_peak", "v_at_peak",
        "delta_T_max", "delta_V_ohmic", "Re", "Rct", "rest_time_hours"
    ]
    train_mask = sample_feature_df["battery_id"] != "B0018"
    test_mask = sample_feature_df["battery_id"] == "B0018"
    
    X_train = sample_feature_df.loc[train_mask, feature_cols].values
    y_train = sample_feature_df.loc[train_mask, "soh"].values
    X_test = sample_feature_df.loc[test_mask, feature_cols].values
    y_test = sample_feature_df.loc[test_mask, "soh"].values
    
    model.fit(X_train, y_train)
    preds, sigma = model.predict_with_uncertainty(X_test)
    assert len(preds) == len(y_test)
    assert len(sigma) == len(y_test)
    assert (sigma > 0).all()

def test_lobo_evaluator(sample_feature_df):
    evaluator = BatteryLOBOEvaluator(sample_feature_df)
    results = evaluator.evaluate_all_models()
    assert "Ridge" in results
    assert "GPR" in results
    assert "ElasticNet" in results
    assert "SVR" in results
    assert "XGBoost" in results
    for m_name, res in results.items():
        assert len(res["folds"]) == 4
        assert res["mean_rmse"] > 0
