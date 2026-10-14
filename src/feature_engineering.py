"""Physics-Informed Feature Extraction for Battery State of Health (SoH).

Extracts the 7 required physical features per cycle:
1. t_cc: Constant-Current charge duration (3.8V to 4.2V)
2. t_cv: Constant-Voltage charge duration (at 4.2V until I < 20mA)
3. dq_dv_peak & v_at_peak: Incremental Capacity peak amplitude and voltage
4. delta_T_max: Max temperature rise during CC discharge
5. delta_V_ohmic: Initial instantaneous ohmic voltage drop at discharge start
6. Re & Rct: EIS electrolyte and charge-transfer resistances
7. rest_time_hours: Elapsed rest duration prior to discharge cycle
"""

from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import pandas as pd
from scipy.integrate import cumulative_trapezoid
from scipy.signal import savgol_filter

from src.data_loader import AlignedCycle


class PhysicsFeatureExtractor:
    """Extracts electrochemically grounded features from aligned battery cycle data."""

    def __init__(
        self,
        v_cc_min: float = 3.8,
        v_cc_max: float = 4.2,
        v_ic_min: float = 3.8,
        v_ic_max: float = 4.18,
        ic_bin_mv: float = 10.0,
        i_cv_cutoff: float = 0.020,  # 20 mA cutoff
    ) -> None:
        self.v_cc_min = v_cc_min
        self.v_cc_max = v_cc_max
        self.v_ic_min = v_ic_min
        self.v_ic_max = v_ic_max
        self.ic_bin_v = ic_bin_mv / 1000.0  # 0.010 V
        self.i_cv_cutoff = i_cv_cutoff

    def compute_t_cc(self, v_arr: np.ndarray, t_arr: np.ndarray) -> float:
        """Compute Constant-Current duration (time from v_cc_min to v_cc_max)."""
        idx_min = np.where(v_arr >= self.v_cc_min)[0]
        idx_max = np.where(v_arr >= self.v_cc_max)[0]

        if len(idx_min) == 0:
            return 0.0

        t_start = t_arr[idx_min[0]]
        if len(idx_max) > 0:
            t_end = t_arr[idx_max[0]]
        else:
            # If cell didn't reach 4.2V, use peak voltage timestamp
            t_end = t_arr[np.argmax(v_arr)]

        return max(0.0, float(t_end - t_start))

    def compute_t_cv(
        self, v_arr: np.ndarray, i_arr: np.ndarray, t_arr: np.ndarray
    ) -> float:
        """Compute Constant-Voltage duration (time at 4.2V until current drops below 20mA)."""
        idx_42 = np.where(v_arr >= (self.v_cc_max - 0.015))[0]
        if len(idx_42) == 0:
            return 0.0

        t_cv_start = t_arr[idx_42[0]]

        # Search for current dropping below cutoff after reaching CV mode
        cv_indices = np.where(
            (t_arr >= t_cv_start) & (i_arr <= self.i_cv_cutoff) & (i_arr >= -0.1)
        )[0]

        if len(cv_indices) > 0:
            t_cv_end = t_arr[cv_indices[0]]
        else:
            t_cv_end = t_arr[-1]

        return max(0.0, float(t_cv_end - t_cv_start))

    def compute_incremental_capacity(
        self, v_arr: np.ndarray, i_arr: np.ndarray, t_arr: np.ndarray
    ) -> Tuple[float, float]:
        """Compute dQ/dV peak amplitude and peak voltage using uniform binning + Savitzky-Golay.

        Filters out quantization noise and Delta V approx 0 singularities.
        """
        # Filter CC charging region
        mask = (
            (v_arr >= self.v_ic_min)
            & (v_arr <= self.v_ic_max)
            & (i_arr >= 0.5)  # Charging current active
        )
        v_sub = v_arr[mask]
        i_sub = i_arr[mask]
        t_sub = t_arr[mask]

        if len(v_sub) < 10:
            # Fallback if sparse
            return 0.0, 4.0

        # Accumulated charge Q in Ah
        q_cum = cumulative_trapezoid(i_sub, t_sub, initial=0.0) / 3600.0

        # Sort by voltage to ensure monotonicity for interpolation
        sort_idx = np.argsort(v_sub)
        v_sorted = v_sub[sort_idx]
        q_sorted = q_cum[sort_idx]

        # Deduplicate identical voltage levels
        v_unique, unique_indices = np.unique(v_sorted, return_index=True)
        q_unique = q_sorted[unique_indices]

        if len(v_unique) < 5:
            return 0.0, 4.0

        # Uniform grid binning (Delta V = 10 mV)
        v_grid_min = max(self.v_ic_min, float(v_unique[0]))
        v_grid_max = min(self.v_ic_max, float(v_unique[-1]))

        n_bins = int(round((v_grid_max - v_grid_min) / self.ic_bin_v)) + 1
        if n_bins < 5:
            return 0.0, 4.0

        v_grid = np.linspace(v_grid_min, v_grid_max, n_bins)
        q_grid = np.interp(v_grid, v_unique, q_unique)

        # Smooth Q profile with Savitzky-Golay filter
        win_len = min(9, len(q_grid))
        if win_len % 2 == 0:
            win_len -= 1
        poly_order = min(2, win_len - 1)

        if win_len >= 5 and poly_order >= 1:
            q_smoothed = savgol_filter(q_grid, window_length=win_len, polyorder=poly_order)
        else:
            q_smoothed = q_grid

        # Numerical differentiation dQ/dV
        dq_dv = np.gradient(q_smoothed, v_grid)

        # Restrict peak search to reasonable physical Li-ion peak range (3.85V - 4.15V)
        valid_range = (v_grid >= 3.85) & (v_grid <= 4.15)
        if np.any(valid_range):
            v_eval = v_grid[valid_range]
            dq_dv_eval = dq_dv[valid_range]
            peak_idx = np.argmax(dq_dv_eval)
            dq_dv_peak = float(dq_dv_eval[peak_idx])
            v_at_peak = float(v_eval[peak_idx])
        else:
            peak_idx = np.argmax(dq_dv)
            dq_dv_peak = float(dq_dv[peak_idx])
            v_at_peak = float(v_grid[peak_idx])

        return max(0.0, dq_dv_peak), v_at_peak

    def compute_delta_t_max(self, t_meas: np.ndarray) -> float:
        """Compute max temperature rise during discharge (max(T) - T_0)."""
        if len(t_meas) == 0:
            return 0.0
        return float(np.max(t_meas) - t_meas[0])

    def compute_delta_v_ohmic(
        self, v_dis: np.ndarray, i_dis: np.ndarray
    ) -> Tuple[float, float]:
        """Compute initial instantaneous ohmic voltage drop at discharge load application.

        Returns:
            delta_V_ohmic (V) and estimated R_0 (Ohm)
        """
        # Find step where discharge load is first applied (I <= -1.0 A)
        load_indices = np.where(i_dis <= -1.0)[0]
        if len(load_indices) == 0:
            return 0.0, 0.0

        idx_loaded = load_indices[0]
        idx_ocv = max(0, idx_loaded - 1)

        v_ocv = v_dis[idx_ocv]
        v_loaded = v_dis[idx_loaded]
        i_loaded = abs(i_dis[idx_loaded])

        delta_v = max(0.0, float(v_ocv - v_loaded))
        r_0 = float(delta_v / i_loaded) if i_loaded > 0.1 else 0.0
        return delta_v, r_0

    def extract_cycle_features(self, cycle: AlignedCycle) -> Dict[str, Any]:
        """Extract all 7 physics-informed features from an aligned cycle."""
        ch = cycle.charge_data
        dis = cycle.discharge_data

        t_cc = self.compute_t_cc(ch["Voltage_measured"], ch["Time"])
        t_cv = self.compute_t_cv(
            ch["Voltage_measured"], ch["Current_measured"], ch["Time"]
        )
        dq_dv_peak, v_at_peak = self.compute_incremental_capacity(
            ch["Voltage_measured"], ch["Current_measured"], ch["Time"]
        )
        delta_t_max = self.compute_delta_t_max(dis["Temperature_measured"])
        delta_v_ohmic, _ = self.compute_delta_v_ohmic(
            dis["Voltage_measured"], dis["Current_measured"]
        )

        return {
            "battery_id": cycle.battery_id,
            "cycle": cycle.cycle_index,
            "t_cc": t_cc,
            "t_cv": t_cv,
            "dq_dv_peak": dq_dv_peak,
            "v_at_peak": v_at_peak,
            "delta_T_max": delta_t_max,
            "delta_V_ohmic": delta_v_ohmic,
            "Re": cycle.re,
            "Rct": cycle.rct,
            "rest_time_hours": cycle.rest_time_hours,
            "capacity": cycle.capacity,
            "soh": cycle.soh,
        }

    def extract_features_dataframe(
        self, cycles: List[AlignedCycle]
    ) -> pd.DataFrame:
        """Convert a list of aligned cycles into a feature DataFrame."""
        rows = [self.extract_cycle_features(c) for c in cycles]
        return pd.DataFrame(rows)
