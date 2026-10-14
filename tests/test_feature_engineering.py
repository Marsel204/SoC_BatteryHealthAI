import pytest
import numpy as np
import pandas as pd
from src.data_loader import NASADataLoader
from src.feature_engineering import PhysicsFeatureExtractor

def test_feature_extractor_synthetic():
    extractor = PhysicsFeatureExtractor()
    
    # Synthetic charge: V from 3.5 to 4.2V CC, then CV at 4.2V until I drops to 0.01A
    t_cc_part = np.linspace(0, 3000, 300)
    v_cc_part = np.linspace(3.5, 4.2, 300)
    i_cc_part = np.ones(300) * 1.5
    
    t_cv_part = np.linspace(3001, 7000, 400)
    v_cv_part = np.ones(400) * 4.2
    i_cv_part = np.linspace(1.5, 0.01, 400)
    
    v_ch = np.concatenate([v_cc_part, v_cv_part])
    i_ch = np.concatenate([i_cc_part, i_cv_part])
    t_ch = np.concatenate([t_cc_part, t_cv_part])
    
    t_cc = extractor.compute_t_cc(v_ch, t_ch)
    assert t_cc > 0
    
    t_cv = extractor.compute_t_cv(v_ch, i_ch, t_ch)
    assert t_cv > 0

def test_feature_extraction_from_real_cycle():
    loader = NASADataLoader(data_dir="data/raw")
    aligned = loader.load_and_align_battery("B0005", drop_cycle_1=True)
    extractor = PhysicsFeatureExtractor()
    
    feat = extractor.extract_cycle_features(aligned[0])
    
    expected_keys = [
        "battery_id", "cycle", "t_cc", "t_cv", "dq_dv_peak",
        "v_at_peak", "delta_T_max", "delta_V_ohmic", "Re", "Rct",
        "rest_time_hours", "capacity", "soh"
    ]
    for key in expected_keys:
        assert key in feat, f"Missing key {key}"
        if key not in ["battery_id", "cycle"]:
            assert not np.isnan(feat[key]), f"NaN found in {key}"
            assert np.isfinite(feat[key]), f"Non-finite value in {key}"

def test_extract_battery_dataframe():
    loader = NASADataLoader(data_dir="data/raw")
    aligned = loader.load_and_align_battery("B0005", drop_cycle_1=True)
    extractor = PhysicsFeatureExtractor()
    df = extractor.extract_features_dataframe(aligned)
    
    assert isinstance(df, pd.DataFrame)
    assert len(df) == len(aligned)
    assert "soh" in df.columns
    assert (df["soh"] >= 0).all() and (df["soh"] <= 100).all()
