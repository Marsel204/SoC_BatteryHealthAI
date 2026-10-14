"""Stage 4: Mathematical & Electrochemical Justification Plots and Analysis.

Generates 6 publication-grade figures (300 DPI) saved to outputs/figures/:
1. stage1_degradation_regeneration.png: SoH degradation & rest-induced diffusion recovery.
2. stage1_incremental_capacity_evolution.png: dQ/dV curves, peak attenuation (LAM) & peak shift (LLI).
3. stage4_thevenin_charging_dynamics.png: Thevenin equation verification (t_cc shrinking, t_cv expanding).
4. stage4_joule_heating_law.png: Joule heating thermal balance & negative delta_T_max sensitivity.
5. stage3_lobo_predictions_uncertainty.png: LOBO cross-validation parity & GPR 95% epistemic uncertainty bands.
6. stage4_interpretability_shap_jacobian.png: Standardized coefficients, SHAP importance, and Jacobian sensitivities.
"""

import os
from typing import Dict, List, Any
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import numpy as np
import pandas as pd
import seaborn as sns
import shap

from src.models import FEATURE_NAMES, BatteryLOBOEvaluator, RidgeBaseline, XGBoostModel, GaussianProcessModel
from src.data_loader import NASADataLoader
from src.feature_engineering import PhysicsFeatureExtractor


# Publication aesthetics
plt.rcParams.update({
    "font.family": "serif",
    "font.size": 10,
    "axes.labelsize": 11,
    "axes.titlesize": 12,
    "xtick.labelsize": 10,
    "ytick.labelsize": 10,
    "legend.fontsize": 9,
    "figure.titlesize": 13,
    "figure.dpi": 300,
    "axes.grid": True,
    "grid.alpha": 0.3,
})


class BatteryPrognosticsVisualizer:
    """Generates publication-quality diagnostic and justification figures."""

    def __init__(
        self,
        features_df: pd.DataFrame,
        output_dir: str = "outputs/figures",
        data_dir: str = "data/raw",
    ) -> None:
        self.df = features_df.copy()
        self.output_dir = output_dir
        self.data_dir = data_dir
        os.makedirs(self.output_dir, exist_ok=True)
        self.color_map = {
            "B0005": "#1f77b4",
            "B0006": "#ff7f0e",
            "B0007": "#2ca02c",
            "B0018": "#d62728",
        }

    def plot_degradation_and_regeneration(self) -> str:
        """Plot SoH degradation trajectories with capacity regeneration callouts."""
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 7), sharex=True, gridspec_kw={"height_ratios": [2, 1]})

        # Panel 1: SoH vs Cycle
        for b_id, color in self.color_map.items():
            b_df = self.df[self.df["battery_id"] == b_id]
            ax1.plot(b_df["cycle"], b_df["soh"], label=f"{b_id} (24°C)", color=color, lw=1.8)

        ax1.axhline(70.0, color="crimson", linestyle="--", lw=1.5, label="End-of-Life (EoL, 70% SoH = 1.4 Ah)")
        ax1.set_ylabel("State of Health, SoH (%)")
        ax1.set_title("Li-ion Battery Degradation Trajectories & Diffusion Regeneration Spikes")
        ax1.legend(loc="lower left", framealpha=0.9)

        # Highlight major regeneration spike in B0005 at cycle 20 & 31
        b5 = self.df[self.df["battery_id"] == "B0005"]
        ax1.annotate(
            "Regeneration Spike\n(+0.044 Ah, Δt=309.5h rest)",
            xy=(20, b5[b5["cycle"] == 20]["soh"].values[0]),
            xytext=(35, 96),
            arrowprops=dict(facecolor="black", shrink=0.05, width=1, headwidth=5),
            fontsize=9,
            bbox=dict(boxstyle="round,pad=0.3", fc="yellow", alpha=0.5),
        )

        # Panel 2: Rest time hours
        for b_id, color in self.color_map.items():
            b_df = self.df[self.df["battery_id"] == b_id]
            ax2.plot(b_df["cycle"], b_df["rest_time_hours"], color=color, alpha=0.7, lw=1.2)

        ax2.set_ylabel("Rest Duration (hours)")
        ax2.set_xlabel("Cycle Number")
        ax2.set_yscale("log")
        ax2.set_title("Inter-Cycle Rest Duration (Lithium Diffusion Relaxation Opportunity)")

        plt.tight_layout()
        save_path = os.path.join(self.output_dir, "stage1_degradation_regeneration.png")
        plt.savefig(save_path, dpi=300)
        plt.close(fig)
        return save_path

    def plot_incremental_capacity_evolution(self) -> str:
        """Plot dQ/dV curves across aging cycles for B0005 showing LAM and LLI."""
        loader = NASADataLoader(data_dir=self.data_dir)
        extractor = PhysicsFeatureExtractor()
        cycles = loader.load_and_align_battery("B0005", drop_cycle_1=True)

        target_cycles = [10, 40, 80, 120, 160]
        selected_cycles = [c for c in cycles if c.cycle_index in target_cycles]

        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
        cmap = plt.get_cmap("viridis")
        norm = plt.Normalize(vmin=10, vmax=160)

        for c in selected_cycles:
            ch = c.charge_data
            v = ch["Voltage_measured"]
            i = ch["Current_measured"]
            t = ch["Time"]

            # Compute dQ/dV curve
            mask = (v >= 3.8) & (v <= 4.18) & (i >= 0.5)
            v_sub, i_sub, t_sub = v[mask], i[mask], t[mask]
            if len(v_sub) > 10:
                from scipy.integrate import cumulative_trapezoid
                q_cum = cumulative_trapezoid(i_sub, t_sub, initial=0.0) / 3600.0
                s_idx = np.argsort(v_sub)
                v_s, q_s = v_sub[s_idx], q_cum[s_idx]
                v_u, u_idx = np.unique(v_s, return_index=True)
                q_u = q_s[u_idx]
                v_grid = np.linspace(3.8, 4.18, 100)
                q_grid = np.interp(v_grid, v_u, q_u)
                from scipy.signal import savgol_filter
                q_smooth = savgol_filter(q_grid, window_length=9, polyorder=2)
                dq_dv = np.gradient(q_smooth, v_grid)

                color = cmap(norm(c.cycle_index))
                ax1.plot(v_grid, dq_dv, label=f"Cycle {c.cycle_index} (SoH {c.soh:.1f}%)", color=color, lw=2)

        ax1.set_xlabel("Terminal Voltage, $V$ (V)")
        ax1.set_ylabel("Incremental Capacity, $dQ/dV$ (Ah/V)")
        ax1.set_title("Incremental Capacity (IC) Profile Evolution\n(Loss of Active Material & Lithium Inventory)")
        ax1.legend(loc="upper right", framealpha=0.9)
        ax1.annotate(
            "Peak Attenuation (LAM)\n& Rightward Shift (LLI / $\\eta_{\\text{ohmic}}$)",
            xy=(3.98, 4.2),
            xytext=(3.82, 4.8),
            arrowprops=dict(facecolor="black", shrink=0.05, width=1, headwidth=5),
            bbox=dict(boxstyle="round,pad=0.3", fc="lightblue", alpha=0.5),
        )

        # Panel 2: Peak Amplitude vs SoH
        for b_id, color in self.color_map.items():
            b_df = self.df[self.df["battery_id"] == b_id]
            ax2.scatter(b_df["dq_dv_peak"], b_df["soh"], color=color, alpha=0.6, s=25, label=b_id)

        # Trend line
        z = np.polyfit(self.df["dq_dv_peak"], self.df["soh"], 1)
        p = np.poly1d(z)
        x_vals = np.linspace(self.df["dq_dv_peak"].min(), self.df["dq_dv_peak"].max(), 50)
        ax2.plot(x_vals, p(x_vals), "k--", lw=1.8, label=f"Fit: SoH = {z[0]:.2f}·$(dQ/dV) + {z[1]:.1f}$")

        ax2.set_xlabel("Incremental Capacity Peak Amplitude, $(dQ/dV)_{\\text{peak}}$ (Ah/V)")
        ax2.set_ylabel("State of Health, SoH (%)")
        ax2.set_title("Electrochemical Phase Transition Peak vs SoH")
        ax2.legend(loc="lower right", framealpha=0.9)

        plt.tight_layout()
        save_path = os.path.join(self.output_dir, "stage1_incremental_capacity_evolution.png")
        plt.savefig(save_path, dpi=300)
        plt.close(fig)
        return save_path

    def plot_thevenin_charging_dynamics(self) -> str:
        """Verify Thevenin equation: V_term = V_ocv + I*R_int causes shrinking t_cc and expanding t_cv."""
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5))

        # Panel 1: t_cc and t_cv vs Cycle for B0005
        b5 = self.df[self.df["battery_id"] == "B0005"]
        ax1.plot(b5["cycle"], b5["t_cc"], color="#1f77b4", lw=2, label="CC Duration $t_{\\text{cc}}$ (3.8V $\\to$ 4.2V)")
        ax1.set_ylabel("Constant-Current Duration $t_{\\text{cc}}$ (seconds)", color="#1f77b4")
        ax1.tick_params(axis="y", labelcolor="#1f77b4")

        ax1_twin = ax1.twinx()
        ax1_twin.plot(b5["cycle"], b5["t_cv"], color="#d62728", lw=2, linestyle="-.", label="CV Duration $t_{\\text{cv}}$ (at 4.2V)")
        ax1_twin.set_ylabel("Constant-Voltage Duration $t_{\\text{cv}}$ (seconds)", color="#d62728")
        ax1_twin.tick_params(axis="y", labelcolor="#d62728")
        ax1.set_xlabel("Cycle Number")
        ax1.set_title("Thevenin Dynamics: $t_{\\text{cc}}$ Shrinkage vs $t_{\\text{cv}}$ Expansion")

        # Annotation of physical mechanism
        ax1.text(
            0.05, 0.20,
            "Thevenin Cutoff Rule:\n"
            "$V_{\\text{term}} = V_{\\text{OCV}}(\\text{SoC}) + I\\cdot R_{\\text{int}} = 4.2\\text{ V}$\n"
            "Rising $R_{\\text{int}}$ trips 4.2V cutoff at lower SoC,\n"
            "forcing earlier transition into slow CV phase.",
            transform=ax1.transAxes,
            bbox=dict(boxstyle="round,pad=0.4", fc="white", ec="navy", alpha=0.85),
            fontsize=8.5,
        )

        # Panel 2: t_cc vs Internal Resistance (Re + Rct) across all batteries
        r_int = self.df["Re"] + self.df["Rct"]
        for b_id, color in self.color_map.items():
            mask = self.df["battery_id"] == b_id
            ax2.scatter(r_int[mask] * 1e3, self.df.loc[mask, "t_cc"], color=color, alpha=0.6, s=25, label=b_id)

        ax2.set_xlabel("Total Internal Resistance, $R_e + R_{\\text{ct}}$ (m$\\Omega$)")
        ax2.set_ylabel("Constant-Current Duration $t_{\\text{cc}}$ (seconds)")
        ax2.set_title("Physical Correlation: $R_{\\text{int}}$ vs CC Stage Duration")
        ax2.legend(loc="upper right", framealpha=0.9)

        plt.tight_layout()
        save_path = os.path.join(self.output_dir, "stage4_thevenin_charging_dynamics.png")
        plt.savefig(save_path, dpi=300)
        plt.close(fig)
        return save_path

    def plot_joule_heating_law(self) -> str:
        """Verify Joule Heating Law Q_heat = integral(I^2 R dt) and justify negative delta_T_max sensitivity."""
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

        # Panel 1: delta_T_max vs SoH
        for b_id, color in self.color_map.items():
            b_df = self.df[self.df["battery_id"] == b_id]
            ax1.scatter(b_df["delta_T_max"], b_df["soh"], color=color, alpha=0.6, s=25, label=b_id)

        z = np.polyfit(self.df["delta_T_max"], self.df["soh"], 1)
        p = np.poly1d(z)
        x_vals = np.linspace(self.df["delta_T_max"].min(), self.df["delta_T_max"].max(), 50)
        ax1.plot(x_vals, p(x_vals), "k--", lw=1.8, label=f"Fit: d(SoH)/d(ΔT) = {z[0]:.2f} %/°C")

        ax1.set_xlabel("Max Temperature Rise during Discharge, $\\Delta T_{\\max}$ (°C)")
        ax1.set_ylabel("State of Health, SoH (%)")
        ax1.set_title("Thermal Dissipation vs SoH (Negative Gradient)")
        ax1.legend(loc="lower left", framealpha=0.9)

        # Panel 2: delta_T_max vs Internal Resistance
        r_int = (self.df["Re"] + self.df["Rct"]) * 1e3
        for b_id, color in self.color_map.items():
            mask = self.df["battery_id"] == b_id
            ax2.scatter(r_int[mask], self.df.loc[mask, "delta_T_max"], color=color, alpha=0.6, s=25, label=b_id)

        ax2.set_xlabel("Total Internal Resistance, $R_e + R_{\\text{ct}}$ (m$\\Omega$)")
        ax2.set_ylabel("Max Temperature Rise, $\\Delta T_{\\max}$ (°C)")
        ax2.set_title("Joule Heating Law: $Q_{\\text{heat}} = \\int I^2 (R_e + R_{\\text{ct}} )\\,dt$")
        ax2.legend(loc="upper left", framealpha=0.9)

        ax2.text(
            0.05, 0.15,
            "Thermodynamic Balance:\n"
            "$m c_p \\frac{dT}{dt} = I^2 R_{\\text{int}} - h A(T - T_{\\text{amb}})$\n"
            "Higher $R_{\\text{int}}$ generates more irreversible heat,\n"
            "forcing negative sensitivity $\\partial \\widehat{SoH}/\\partial \\Delta T_{\\max} < 0$.",
            transform=ax2.transAxes,
            bbox=dict(boxstyle="round,pad=0.4", fc="white", ec="darkred", alpha=0.85),
            fontsize=8.5,
        )

        plt.tight_layout()
        save_path = os.path.join(self.output_dir, "stage4_joule_heating_law.png")
        plt.savefig(save_path, dpi=300)
        plt.close(fig)
        return save_path

    def plot_lobo_predictions_uncertainty(self, lobo_results: Dict[str, Any]) -> str:
        """Plot LOBO cross-validation predictions with GPR 95% epistemic confidence intervals."""
        fig, axes = plt.subplots(2, 2, figsize=(14, 10), sharey=True)
        axes = axes.flatten()

        gpr_folds = lobo_results["GPR"]["folds"]
        ridge_folds = lobo_results["Ridge"]["folds"]

        for idx, (g_fold, r_fold) in enumerate(zip(gpr_folds, ridge_folds)):
            ax = axes[idx]
            b_id = g_fold["test_battery"]
            cycles = g_fold["cycles"]
            y_true = g_fold["y_true"]
            gpr_pred = g_fold["y_pred"]
            gpr_std = g_fold["uncertainty"]
            ridge_pred = r_fold["y_pred"]

            # Sort by cycle for smooth plotting
            sort_order = np.argsort(cycles)
            cycles_s = cycles[sort_order]
            y_true_s = y_true[sort_order]
            gpr_pred_s = gpr_pred[sort_order]
            gpr_std_s = gpr_std[sort_order]
            ridge_pred_s = ridge_pred[sort_order]

            # Ground truth
            ax.plot(cycles_s, y_true_s, "k-", lw=2.2, label="Ground Truth SoH")

            # GPR prediction + 95% CI
            ax.plot(cycles_s, gpr_pred_s, color=self.color_map[b_id], lw=2.0, label="GPR Mean $\\mu(x)$")
            ax.fill_between(
                cycles_s,
                gpr_pred_s - 1.96 * gpr_std_s,
                gpr_pred_s + 1.96 * gpr_std_s,
                color=self.color_map[b_id],
                alpha=0.25,
                label="GPR 95% CI ($\\pm 1.96\\sigma$)",
            )

            # Ridge prediction
            ax.plot(cycles_s, ridge_pred_s, color="gray", linestyle="--", lw=1.5, label="Ridge Baseline")

            ax.axhline(70.0, color="crimson", linestyle=":", lw=1.2, label="EoL Threshold (70%)")

            # Metrics inset
            m = g_fold["metrics"]
            coverage = np.mean(
                (y_true >= (gpr_pred - 1.96 * gpr_std))
                & (y_true <= (gpr_pred + 1.96 * gpr_std))
            ) * 100.0

            text_str = (
                f"Held-out Cell: {b_id}\n"
                f"GPR RMSE: {m['rmse']:.3f}%\n"
                f"GPR MAE:  {m['mae']:.3f}%\n"
                f"GPR $R^2$:  {m['r2']:.4f}\n"
                f"95% Coverage: {coverage:.1f}%"
            )
            ax.text(
                0.05, 0.12,
                text_str,
                transform=ax.transAxes,
                bbox=dict(boxstyle="round,pad=0.4", fc="white", alpha=0.9),
                fontsize=9,
            )

            ax.set_title(f"Unseen Battery Test: {b_id}")
            ax.set_xlabel("Cycle Number")
            if idx in [0, 2]:
                ax.set_ylabel("State of Health, SoH (%)")
            if idx == 0:
                ax.legend(loc="upper right", framealpha=0.9, fontsize=8)

        plt.suptitle("Leave-One-Battery-Out (LOBO) Cross-Validation & Epistemic Uncertainty Quantification", y=0.99)
        plt.tight_layout()
        save_path = os.path.join(self.output_dir, "stage3_lobo_predictions_uncertainty.png")
        plt.savefig(save_path, dpi=300)
        plt.close(fig)
        return save_path

    def plot_interpretability_shap_jacobian(self) -> str:
        """Plot standardized feature weights, SHAP importance, and Jacobian sensitivities."""
        fig = plt.figure(figsize=(15, 5))
        gs = gridspec.GridSpec(1, 3, width_ratios=[1.2, 1.2, 1.2])

        # 1. Standardized Linear Coefficients (Ridge & ElasticNet)
        ax1 = fig.add_subplot(gs[0])
        X = self.df[FEATURE_NAMES].values
        y = self.df["soh"].values

        ridge = RidgeBaseline().fit(X, y)
        coefs = ridge.get_feature_coefficients()
        feature_labels = [
            "$t_{\\text{cc}}$",
            "$t_{\\text{cv}}$",
            "$(dQ/dV)_{\\text{peak}}$",
            "$V_{\\text{peak}}$",
            "$\\Delta T_{\\max}$",
            "$\\Delta V_{\\text{ohmic}}$",
            "$R_e$",
            "$R_{\\text{ct}}$",
            "$t_{\\text{rest}}$",
        ]

        y_pos = np.arange(len(FEATURE_NAMES))
        weights = [coefs[name] for name in FEATURE_NAMES]
        colors = ["#2ca02c" if w >= 0 else "#d62728" for w in weights]

        ax1.barh(y_pos, weights, color=colors, alpha=0.85, edgecolor="black")
        ax1.set_yticks(y_pos)
        ax1.set_yticklabels(feature_labels)
        ax1.axvline(0, color="black", lw=1)
        ax1.set_xlabel("Standardized Weight ($z$-score impact)")
        ax1.set_title("Interpretable Ridge Weights\n(Green = Positive, Red = Negative)")

        # 2. SHAP summary bar plot for XGBoost
        ax2 = fig.add_subplot(gs[1])
        xgb = XGBoostModel().fit(X, y)
        X_scaled = xgb.scaler.transform(X)
        explainer = shap.TreeExplainer(xgb.model)
        shap_vals = explainer.shap_values(X_scaled)
        mean_abs_shap = np.mean(np.abs(shap_vals), axis=0)

        sort_shap = np.argsort(mean_abs_shap)
        ax2.barh(
            np.arange(len(sort_shap)),
            mean_abs_shap[sort_shap],
            color="#1f77b4",
            alpha=0.85,
            edgecolor="black",
        )
        ax2.set_yticks(np.arange(len(sort_shap)))
        ax2.set_yticklabels([feature_labels[i] for i in sort_shap])
        ax2.set_xlabel("Mean Absolute SHAP Value ($\\Delta$ SoH %)")
        ax2.set_title("XGBoost SHAP Feature Importance\n(Global Non-Linear Attribution)")

        # 3. Physical Jacobian Sensitivity d(SoH)/dx_i
        ax3 = fig.add_subplot(gs[2])
        jacobian = ridge.get_jacobian()
        # Scale to intuitive units:
        # t_cc: per 100s, t_cv: per 100s, dq_dv: per 1 Ah/V, dT: per 1°C, Re/Rct: per 10 mOhm, rest: per 10h
        unit_multipliers = [100.0, 100.0, 1.0, 0.010, 1.0, 0.010, 0.010, 0.010, 10.0]
        jacobian_scaled = jacobian * np.array(unit_multipliers)
        unit_names = [
            "per +100s",
            "per +100s",
            "per +1 Ah/V",
            "per +10 mV",
            "per +1 °C",
            "per +10 mV",
            "per +10 m$\\Omega$",
            "per +10 m$\\Omega$",
            "per +10 h",
        ]

        ax3.barh(y_pos, jacobian_scaled, color=colors, alpha=0.85, edgecolor="black")
        ax3.set_yticks(y_pos)
        ax3.set_yticklabels([f"{l} ({u})" for l, u in zip(feature_labels, unit_names)])
        ax3.axvline(0, color="black", lw=1)
        ax3.set_xlabel("Analytical Sensitivity $\\partial \\widehat{SoH} / \\partial x_i$ (% SoH)")
        ax3.set_title("Physical Jacobian Sensitivities\n(Thermodynamic Sign Verification)")

        plt.tight_layout()
        save_path = os.path.join(self.output_dir, "stage4_interpretability_shap_jacobian.png")
        plt.savefig(save_path, dpi=300)
        plt.close(fig)
        return save_path

    def generate_all_figures(self, lobo_results: Dict[str, Any]) -> List[str]:
        """Generate and save all 6 publication figures."""
        paths = [
            self.plot_degradation_and_regeneration(),
            self.plot_incremental_capacity_evolution(),
            self.plot_thevenin_charging_dynamics(),
            self.plot_joule_heating_law(),
            self.plot_lobo_predictions_uncertainty(lobo_results),
            self.plot_interpretability_shap_jacobian(),
        ]
        return paths
