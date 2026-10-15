"""FastAPI Application & Inference Engine for Battery SoH Prognostics.

Serves REST endpoints for real-time multi-model prediction, GPR epistemic
uncertainty quantification, physical Jacobian sensitivity calculation, raw cycle
telemetry, and LOBO cross-validation benchmarks.
"""

from contextlib import asynccontextmanager
import json
import os
from typing import Dict, List, Optional, Any
import numpy as np
import pandas as pd
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from src.models import (
    FEATURE_NAMES,
    RidgeBaseline,
    ElasticNetBaseline,
    SVRBaseline,
    GaussianProcessModel,
    XGBoostModel,
    BatteryLOBOEvaluator,
)
from src.data_loader import NASADataLoader
from src.feature_engineering import PhysicsFeatureExtractor


class BatteryFeaturesPayload(BaseModel):
    """Input payload representing the 9 physical features of a cycle."""
    t_cc: float = Field(..., description="CC charging duration (3.8V to 4.2V) in seconds", ge=0.0)
    t_cv: float = Field(..., description="CV charging duration (at 4.2V) in seconds", ge=0.0)
    dq_dv_peak: float = Field(..., description="Peak amplitude of dQ/dV curve in Ah/V", ge=0.0)
    v_at_peak: float = Field(..., description="Voltage at peak dQ/dV in Volts", ge=3.5, le=4.5)
    delta_T_max: float = Field(..., description="Max temperature rise during discharge in °C", ge=0.0)
    delta_V_ohmic: float = Field(..., description="Initial ohmic voltage drop in Volts", ge=0.0)
    Re: float = Field(..., description="Electrolyte resistance in Ohms", ge=0.0)
    Rct: float = Field(..., description="Charge-transfer resistance in Ohms", ge=0.0)
    rest_time_hours: float = Field(..., description="Elapsed rest duration prior to cycle in hours", ge=0.0)


class PrognosticsEngine:
    """Singleton inference and data management engine."""

    def __init__(self, data_csv: str = "data/features_all_batteries.csv", raw_dir: str = "data/raw") -> None:
        self.data_csv = data_csv
        self.raw_dir = raw_dir
        self.df: Optional[pd.DataFrame] = None
        self.loader: Optional[NASADataLoader] = None
        self.extractor: Optional[PhysicsFeatureExtractor] = None

        # Trained models
        self.models: Dict[str, Any] = {}
        self.ridge_model: Optional[RidgeBaseline] = None
        self.lobo_cache: Optional[Dict[str, Any]] = None
        self.aligned_cache: Dict[str, List[Any]] = {}

    def initialize(self) -> None:
        """Load dataset and fit full models."""
        if not os.path.exists(self.data_csv):
            # If CSV does not exist, run extraction
            loader = NASADataLoader(data_dir=self.raw_dir)
            extractor = PhysicsFeatureExtractor()
            dfs = []
            for b_id in ["B0005", "B0006", "B0007", "B0018"]:
                aligned = loader.load_and_align_battery(b_id, drop_cycle_1=True)
                df_b = extractor.extract_features_dataframe(aligned)
                dfs.append(df_b)
            self.df = pd.concat(dfs, ignore_index=True)
            self.df.to_csv(self.data_csv, index=False)
        else:
            self.df = pd.read_csv(self.data_csv)

        self.loader = NASADataLoader(data_dir=self.raw_dir)
        self.extractor = PhysicsFeatureExtractor()

        # Fit models on full dataset for live interactive inference
        X = self.df[FEATURE_NAMES].values
        y = self.df["soh"].values

        self.ridge_model = RidgeBaseline().fit(X, y)
        self.models = {
            "Ridge": self.ridge_model,
            "ElasticNet": ElasticNetBaseline().fit(X, y),
            "SVR": SVRBaseline().fit(X, y),
            "GPR": GaussianProcessModel().fit(X, y),
            "XGBoost": XGBoostModel().fit(X, y),
        }

    def get_presets(self) -> Dict[str, Dict[str, float]]:
        """Return representative physical presets across key aging regimes."""
        if self.df is None:
            return {}

        b5 = self.df[self.df["battery_id"] == "B0005"].copy()

        def row_to_dict(row: pd.Series) -> Dict[str, float]:
            return {k: float(row[k]) for k in FEATURE_NAMES + ["soh", "cycle"]}

        # Fresh cell (cycle 2)
        fresh = row_to_dict(b5.iloc[0])
        # Mid-life cell (~80% SoH)
        mid_idx = (b5["soh"] - 80.0).abs().argmin()
        mid = row_to_dict(b5.iloc[mid_idx])
        # Near-EoL cell (~70% SoH)
        eol_idx = (b5["soh"] - 70.0).abs().argmin()
        near_eol = row_to_dict(b5.iloc[eol_idx])
        # Severely degraded (last cycle)
        degraded = row_to_dict(b5.iloc[-1])
        # Regeneration cycle (cycle 20, max rest)
        regen_idx = b5["rest_time_hours"].argmax()
        regen = row_to_dict(b5.iloc[regen_idx])

        return {
            "fresh_cell": fresh,
            "mid_life": mid,
            "near_eol": near_eol,
            "degraded": degraded,
            "regeneration_spike": regen,
        }

    def predict(self, features: Dict[str, float]) -> Dict[str, Any]:
        """Compute predictions across all 5 models with uncertainty and Jacobian."""
        if not self.models or self.ridge_model is None:
            raise RuntimeError("Engine models not initialized.")

        x_vec = np.array([[features[k] for k in FEATURE_NAMES]])

        predictions = {}
        for name, model in self.models.items():
            if name == "GPR":
                mean_val, std_val = model.predict_with_uncertainty(x_vec)
                predictions[name] = float(mean_val[0])
                gpr_std = float(std_val[0])
            else:
                preds = model.predict(x_vec)
                predictions[name] = float(preds[0])

        ci_lower = float(predictions["GPR"] - 1.96 * gpr_std)
        ci_upper = float(predictions["GPR"] + 1.96 * gpr_std)

        # Standardized weights and Jacobian sensitivities
        weights = self.ridge_model.get_feature_coefficients()
        jacobian = self.ridge_model.get_jacobian()
        jacobian_dict = {k: float(j) for k, j in zip(FEATURE_NAMES, jacobian)}

        return {
            "predictions": predictions,
            "gpr_uncertainty": {
                "mean": predictions["GPR"],
                "std": gpr_std,
                "ci_lower": ci_lower,
                "ci_upper": ci_upper,
                "ci_width": float(ci_upper - ci_lower),
            },
            "weights": weights,
            "jacobian": jacobian_dict,
        }

    def get_lobo_results(self) -> Dict[str, Any]:
        """Compute or return cached LOBO results."""
        if self.lobo_cache is not None:
            return self.lobo_cache

        if self.df is None:
            raise RuntimeError("Dataset is not loaded.")

        evaluator = BatteryLOBOEvaluator(self.df)
        raw_results = evaluator.evaluate_all_models()

        # Format serializable summary
        summary: Dict[str, Any] = {}
        for m_name, res in raw_results.items():
            folds_summary = []
            for f in res["folds"]:
                folds_summary.append({
                    "test_battery": f["test_battery"],
                    "metrics": f["metrics"],
                    "n_test": f["n_test"],
                })
            summary[m_name] = {
                "mean_rmse": res["mean_rmse"],
                "std_rmse": res["std_rmse"],
                "mean_mae": res["mean_mae"],
                "std_mae": res["std_mae"],
                "mean_r2": res["mean_r2"],
                "std_r2": res["std_r2"],
                "folds": folds_summary,
            }
        self.lobo_cache = summary
        return self.lobo_cache

    def get_aligned_cycles(self, battery_id: str) -> List[Any]:
        """Cache and retrieve aligned cycles for a battery."""
        if battery_id not in self.aligned_cache:
            if self.loader is None:
                raise RuntimeError("Loader not initialized.")
            self.aligned_cache[battery_id] = self.loader.load_and_align_battery(
                battery_id, drop_cycle_1=True
            )
        return self.aligned_cache[battery_id]


# Singleton engine instance
_engine: Optional[PrognosticsEngine] = None


def get_engine() -> PrognosticsEngine:
    global _engine
    if _engine is None:
        _engine = PrognosticsEngine()
        _engine.initialize()
    return _engine


@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    # Startup: ensure engine is warmed up
    get_engine()
    yield


app = FastAPI(
    title="Physics-Informed Battery SoH Prognostics API",
    description="REST API for NASA PCoE Battery Dataset SoH Estimation & Testing UI",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/status")
def get_status() -> Dict[str, Any]:
    """Health check and model load status."""
    engine = get_engine()
    return {
        "status": "healthy",
        "models_loaded": list(engine.models.keys()),
        "total_cycles": len(engine.df) if engine.df is not None else 0,
        "batteries": sorted(list(engine.df["battery_id"].unique())) if engine.df is not None else [],
    }


@app.get("/api/dataset/summary")
def get_dataset_summary() -> Dict[str, Any]:
    """Dataset statistics, feature bounds, and physical aging presets."""
    engine = get_engine()
    if engine.df is None:
        raise HTTPException(status_code=500, detail="Dataset not loaded.")

    stats: Dict[str, Any] = {}
    for col in FEATURE_NAMES + ["soh", "capacity"]:
        stats[col] = {
            "min": float(engine.df[col].min()),
            "max": float(engine.df[col].max()),
            "mean": float(engine.df[col].mean()),
            "std": float(engine.df[col].std()),
        }

    battery_counts = {
        b: int((engine.df["battery_id"] == b).sum())
        for b in sorted(list(engine.df["battery_id"].unique()))
    }

    return {
        "total_cycles": len(engine.df),
        "batteries": battery_counts,
        "feature_stats": stats,
        "presets": engine.get_presets(),
    }


@app.post("/api/predict")
def predict_soh(payload: BatteryFeaturesPayload) -> Dict[str, Any]:
    """Execute real-time multi-model prediction and uncertainty estimation."""
    engine = get_engine()
    data_dict = payload.model_dump()
    return engine.predict(data_dict)


@app.get("/api/lobo/results")
def get_lobo_benchmark() -> Dict[str, Any]:
    """Get Leave-One-Battery-Out cross-validation benchmark metrics."""
    engine = get_engine()
    return engine.get_lobo_results()


@app.get("/api/cycle/{battery_id}/{cycle_idx}")
def get_cycle_telemetry(battery_id: str, cycle_idx: int) -> Dict[str, Any]:
    """Retrieve raw charging waveforms and incremental capacity curve for a cycle."""
    engine = get_engine()
    if battery_id not in ["B0005", "B0006", "B0007", "B0018"]:
        raise HTTPException(status_code=404, detail=f"Battery {battery_id} not found.")

    cycles = engine.get_aligned_cycles(battery_id)
    target_cycle = None
    for c in cycles:
        if c.cycle_index == cycle_idx:
            target_cycle = c
            break

    if target_cycle is None:
        raise HTTPException(
            status_code=404, detail=f"Cycle {cycle_idx} not found for {battery_id}."
        )

    # Downsample CC-CV charging curve to ~120 points for smooth frontend plotting
    ch = target_cycle.charge_data
    v_arr = ch["Voltage_measured"]
    i_arr = ch["Current_measured"]
    t_arr = ch["Time"]

    n_points = len(t_arr)
    step = max(1, n_points // 120)
    idx_down = np.arange(0, n_points, step)

    # Compute dQ/dV curve for this cycle
    from scipy.integrate import cumulative_trapezoid
    from scipy.signal import savgol_filter

    mask = (v_arr >= 3.8) & (v_arr <= 4.18) & (i_arr >= 0.5)
    v_sub, i_sub, t_sub = v_arr[mask], i_arr[mask], t_arr[mask]

    ic_v = []
    ic_dq = []
    if len(v_sub) >= 10:
        q_cum = cumulative_trapezoid(i_sub, t_sub, initial=0.0) / 3600.0
        s_idx = np.argsort(v_sub)
        v_s, q_s = v_sub[s_idx], q_cum[s_idx]
        v_u, u_idx = np.unique(v_s, return_index=True)
        q_u = q_s[u_idx]
        v_grid = np.linspace(3.8, 4.18, 80)
        q_grid = np.interp(v_grid, v_u, q_u)
        q_smooth = savgol_filter(q_grid, window_length=9, polyorder=2)
        dq_dv = np.gradient(q_smooth, v_grid)
        ic_v = [float(val) for val in v_grid]
        ic_dq = [float(val) for val in dq_dv]

    features = engine.extractor.extract_cycle_features(target_cycle)

    return {
        "battery_id": battery_id,
        "cycle_index": cycle_idx,
        "capacity": target_cycle.capacity,
        "soh": target_cycle.soh,
        "features": {k: float(features[k]) for k in FEATURE_NAMES},
        "charge_waveform": {
            "time": [float(val) for val in t_arr[idx_down]],
            "voltage": [float(val) for val in v_arr[idx_down]],
            "current": [float(val) for val in i_arr[idx_down]],
        },
        "ic_curve": {
            "voltage": ic_v,
            "dq_dv": ic_dq,
        },
    }


# Static Files & Frontend Routing
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

figures_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "outputs", "figures"))
if os.path.exists(figures_dir):
    app.mount("/outputs/figures", StaticFiles(directory=figures_dir), name="figures")


@app.get("/api/figures")
def get_figures_catalog() -> List[Dict[str, str]]:
    """Return catalog of 6 high-DPI publication diagnostics."""
    return [
        {
            "id": "degradation_regeneration",
            "filename": "stage1_degradation_regeneration.png",
            "title": "Stage 1: Degradation Trajectories & Diffusion Regeneration",
            "stage": "Stage 1: Data Parsing",
            "description": "Quantifies SoH capacity fade across 4 cells and lithium diffusion relaxation recovery spikes (+0.044 Ah in B0005 after 309.5h rest).",
            "url": "/outputs/figures/stage1_degradation_regeneration.png",
        },
        {
            "id": "incremental_capacity",
            "filename": "stage1_incremental_capacity_evolution.png",
            "title": "Stage 1: Incremental Capacity Evolution (dQ/dV)",
            "stage": "Stage 1: Feature Extraction",
            "description": "Tracks graphite/NMC phase transition peak attenuation (LAM/LLI) and rightward ohmic overpotential displacement across cycles 10–160.",
            "url": "/outputs/figures/stage1_incremental_capacity_evolution.png",
        },
        {
            "id": "thevenin_dynamics",
            "filename": "stage4_thevenin_charging_dynamics.png",
            "title": "Stage 4: Thevenin Terminal Voltage Dynamics",
            "stage": "Stage 4: Mathematical Justification",
            "description": "Verifies that rising internal impedance trips the 4.2V ceiling earlier, compressing constant-current duration t_cc and expanding constant-voltage duration t_cv.",
            "url": "/outputs/figures/stage4_thevenin_charging_dynamics.png",
        },
        {
            "id": "joule_heating",
            "filename": "stage4_joule_heating_law.png",
            "title": "Stage 4: Joule Heating Law Verification",
            "stage": "Stage 4: Mathematical Justification",
            "description": "Validates thermodynamic energy dissipation Q_heat = integral(I^2 R dt) and justifies the negative sensitivity of peak temperature rise delta_T_max.",
            "url": "/outputs/figures/stage4_joule_heating_law.png",
        },
        {
            "id": "lobo_predictions_uncertainty",
            "filename": "stage3_lobo_predictions_uncertainty.png",
            "title": "Stage 3: LOBO Cross-Validation & Epistemic Uncertainty",
            "stage": "Stage 3: Evaluation",
            "description": "4-Panel Leave-One-Battery-Out cross-validation parity curves featuring Gaussian Process 95% epistemic confidence intervals (±1.96 sigma).",
            "url": "/outputs/figures/stage3_lobo_predictions_uncertainty.png",
        },
        {
            "id": "interpretability_shap_jacobian",
            "filename": "stage4_interpretability_shap_jacobian.png",
            "title": "Stage 4: Model Interpretability, SHAP & Jacobian Sensitivities",
            "stage": "Stage 4: Sensitivity Audit",
            "description": "Comparative diagnostic of standardized Ridge weights, XGBoost TreeSHAP attributions, and exact analytical Jacobian sensitivities.",
            "url": "/outputs/figures/stage4_interpretability_shap_jacobian.png",
        },
    ]


@app.get("/")
def serve_index():
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "Battery SoH Prognostics API is online. UI available at /static/index.html"}

