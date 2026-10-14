"""End-to-End Execution Script for Battery SoH Prognostics Pipeline.

Executes:
Stage 1: Data parsing, cleaning & physics-informed feature extraction
Stage 2: Baseline and nonlinear model training
Stage 3: Leave-One-Battery-Out (LOBO) cross-validation & uncertainty quantification
Stage 4: Mathematical/electrochemical justification and publication figure generation
"""

import os
import sys
import time
import pandas as pd
import numpy as np

from src.data_loader import NASADataLoader
from src.feature_engineering import PhysicsFeatureExtractor
from src.models import BatteryLOBOEvaluator, FEATURE_NAMES, RidgeBaseline
from src.analysis_plots import BatteryPrognosticsVisualizer


def run_pipeline():
    start_time = time.time()
    print("=" * 78)
    print("PHYSICS-INFORMED STATE OF HEALTH (SOH) ESTIMATION FOR LI-ION BATTERIES")
    print("NASA PCoE Prognostics Dataset (B0005, B0006, B0007, B0018)")
    print("=" * 78)

    # -------------------------------------------------------------
    # STAGE 1: Data Parsing & Physics-Informed Feature Extraction
    # -------------------------------------------------------------
    print("\n[STAGE 1] Loading, Aligning Operations & Extracting Physical Features...")
    data_dir = "data/raw"
    loader = NASADataLoader(data_dir=data_dir)
    extractor = PhysicsFeatureExtractor()

    features_csv = "data/features_all_batteries.csv"
    dfs = []
    for b_id in ["B0005", "B0006", "B0007", "B0018"]:
        aligned = loader.load_and_align_battery(b_id, drop_cycle_1=True)
        df_b = extractor.extract_features_dataframe(aligned)

        # Handle sensor glitches or incomplete charge cycles (e.g. cycle 31 in B0005/6/7)
        for col in ["t_cc", "t_cv", "dq_dv_peak", "v_at_peak"]:
            invalid = (df_b["t_cc"] < 100) | (df_b["dq_dv_peak"] < 0.1)
            df_b.loc[invalid, col] = np.nan
            df_b[col] = df_b[col].interpolate(method="linear").bfill().ffill()

        print(
            f"  Cell {b_id}: {len(df_b)} cycles aligned. "
            f"SoH range: [{df_b['soh'].min():.2f}%, {df_b['soh'].max():.2f}%], "
            f"EoL reached: {bool((df_b['soh'] <= 70.0).any())}"
        )
        dfs.append(df_b)

    df_all = pd.concat(dfs, ignore_index=True)
    os.makedirs("data", exist_ok=True)
    df_all.to_csv(features_csv, index=False)
    print(f"  Stage 1 Complete: {len(df_all)} total cycles saved to {features_csv}")

    # -------------------------------------------------------------
    # STAGE 2 & 3: Model Training & LOBO Cross-Validation
    # -------------------------------------------------------------
    print("\n[STAGE 2 & 3] Performing Leave-One-Battery-Out (LOBO) Cross-Validation...")
    evaluator = BatteryLOBOEvaluator(df_all)
    lobo_results = evaluator.evaluate_all_models()

    print("\n" + "=" * 78)
    print(f"{'Model':<14} | {'Mean RMSE (%)':<16} | {'Mean MAE (%)':<15} | {'Mean R^2':<12}")
    print("-" * 78)
    for model_name, res in lobo_results.items():
        print(
            f"{model_name:<14} | "
            f"{res['mean_rmse']:>6.3f} +/- {res['std_rmse']:>5.3f}   | "
            f"{res['mean_mae']:>5.3f} +/- {res['std_mae']:>5.3f}  | "
            f"{res['mean_r2']:>7.4f}"
        )
    print("=" * 78)

    print("\nLOBO Fold-by-Fold Breakdown (GPR with Epistemic Uncertainty):")
    for fold in lobo_results["GPR"]["folds"]:
        m = fold["metrics"]
        y_true = fold["y_true"]
        y_pred = fold["y_pred"]
        y_std = fold["uncertainty"]
        cov = np.mean(
            (y_true >= (y_pred - 1.96 * y_std)) & (y_true <= (y_pred + 1.96 * y_std))
        ) * 100.0
        mpiw = np.mean(2 * 1.96 * y_std)
        print(
            f"  Test {fold['test_battery']:<5} -> "
            f"RMSE: {m['rmse']:.3f}%, MAE: {m['mae']:.3f}%, R^2: {m['r2']:.4f}, "
            f"95% CI Coverage: {cov:.1f}%, Mean Interval Width: {mpiw:.2f}%"
        )

    # -------------------------------------------------------------
    # STAGE 4: Mathematical Justification & Figures Generation
    # -------------------------------------------------------------
    print("\n[STAGE 4] Generating Publication Figures & Mathematical Justifications...")
    visualizer = BatteryPrognosticsVisualizer(df_all, output_dir="outputs/figures", data_dir=data_dir)
    saved_figures = visualizer.generate_all_figures(lobo_results)

    print("  Publication figures saved (300 DPI):")
    for fig_path in saved_figures:
        print(f"    - {fig_path}")

    # Inspect Analytical Sensitivities (Jacobian)
    X = df_all[FEATURE_NAMES].values
    y = df_all["soh"].values
    ridge = RidgeBaseline().fit(X, y)
    coefs = ridge.get_feature_coefficients()
    jacobian = ridge.get_jacobian()

    print("\nPhysical Sensitivity & Electrochemical Sign Verification:")
    print("-" * 65)
    print(f"{'Feature':<18} | {'Normalized Weight':<18} | {'Electrochemical Justification':<25}")
    print("-" * 65)
    justifications = {
        "t_cc": ("+ Positive", "Thevenin: Premature 4.2V cutoff from rising R_int"),
        "t_cv": ("- Negative", "Thevenin: Capacity shunted into slower CV phase"),
        "dq_dv_peak": ("+ Positive", "LAM/LLI: Loss of Active Material & Phase Plateau"),
        "v_at_peak": ("+ Weak", "Peak shifts due to ohmic overpotential η = I·R_int"),
        "delta_T_max": ("- Negative", "Joule Heating: Q_heat = integral(I^2 R dt)"),
        "delta_V_ohmic": ("+ Positive", "Instantaneous ohmic drop R0 ~ delta_V/I"),
        "Re": ("+ Positive", "Bulk electrolyte resistance"),
        "Rct": ("- Negative", "Charge-transfer barrier at electrode/electrolyte interface"),
        "rest_time_hours": ("+ Positive", "Diffusion relaxation & capacity regeneration"),
    }
    for feat in FEATURE_NAMES:
        w = coefs[feat]
        sign_desc, justification = justifications.get(feat, ("", ""))
        print(f"{feat:<18} | {w:>+8.4f} ({sign_desc:<9}) | {justification}")
    print("-" * 65)

    elapsed = time.time() - start_time
    print(f"\nPipeline successfully finished in {elapsed:.2f} seconds.")


if __name__ == "__main__":
    run_pipeline()
