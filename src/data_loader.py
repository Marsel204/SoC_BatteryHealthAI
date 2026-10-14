"""NASA Battery Prognostics Data Loader.

Handles loading, cleaning, and aligning sequential charge, discharge, and
impedance operations from NASA PCoE Battery MATLAB (.mat) files.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
import os
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import scipy.io as sio


@dataclass
class AlignedCycle:
    """Represents a synchronized battery cycle with charge, discharge, and impedance."""
    battery_id: str
    cycle_index: int
    capacity: float
    soh: float
    charge_data: Dict[str, np.ndarray]
    discharge_data: Dict[str, np.ndarray]
    re: float
    rct: float
    rest_time_hours: float
    timestamp: datetime


class NASADataLoader:
    """Loader and alignment pipeline for NASA PCoE Battery Dataset."""

    NOMINAL_CAPACITY: float = 2.0  # Ah

    def __init__(self, data_dir: str = "data/raw") -> None:
        self.data_dir = data_dir
        self.battery_ids = ["B0005", "B0006", "B0007", "B0018"]

    @staticmethod
    def parse_time_vector(t_vec: np.ndarray | list) -> datetime:
        """Parse MATLAB date/time vector [Y, M, D, H, M, S] into a Python datetime."""
        y, m, d, h, mn, s = t_vec
        sec_int = int(s)
        microsec = int(round((s - sec_int) * 1e6))
        if microsec >= 1_000_000:
            microsec = 999_999
        return datetime(int(y), int(m), int(d), int(h), int(mn), sec_int, microsec)

    @staticmethod
    def _extract_array(struct_data: Any, field_name: str) -> np.ndarray:
        """Helper to extract a 1D float array from a MATLAB struct field."""
        if field_name not in struct_data.dtype.names:
            raise KeyError(f"Field '{field_name}' not found in struct.")
        raw = struct_data[field_name]
        arr = np.asarray(raw)
        return arr.flatten()

    def load_mat_file(self, battery_id: str) -> Dict[str, Any]:
        """Load .mat file from data directory."""
        file_path = os.path.join(self.data_dir, f"{battery_id}.mat")
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"MAT file not found at: {file_path}")
        return sio.loadmat(file_path)

    def load_and_align_battery(
        self, battery_id: str, drop_cycle_1: bool = True
    ) -> List[AlignedCycle]:
        """Align sequential charge, discharge, and impedance operations for a battery.

        Handles:
        1. Operation Alignment: matches each discharge cycle to its immediately
           preceding charge and the chronologically closest impedance sweep.
        2. Capacity Regeneration Spikes: calculates rest_time_hours between cycles.
        3. Cycle 1 Anomaly: optionally drops cycle 1 due to partial charge startup.
        """
        mat = self.load_mat_file(battery_id)
        if battery_id not in mat:
            raise KeyError(f"Battery key '{battery_id}' missing in .mat file.")

        cycle_array = mat[battery_id]["cycle"][0, 0]
        n_ops = cycle_array.shape[1]

        # 1. Parse all operations chronologically
        operations: List[Dict[str, Any]] = []
        for i in range(n_ops):
            op = cycle_array[0, i]
            op_type = str(op["type"][0])
            t_dt = self.parse_time_vector(op["time"][0])
            data = op["data"][0, 0]
            operations.append({
                "op_index": i,
                "type": op_type,
                "time": t_dt,
                "data": data,
            })

        # 2. Collect impedance sweeps with valid Re and Rct
        impedance_records: List[Dict[str, Any]] = []
        for op in operations:
            if op["type"] == "impedance":
                d = op["data"]
                if "Re" in d.dtype.names and "Rct" in d.dtype.names:
                    try:
                        re_val = float(d["Re"][0, 0])
                        rct_val = float(d["Rct"][0, 0])
                        if np.isfinite(re_val) and np.isfinite(rct_val):
                            impedance_records.append({
                                "time": op["time"],
                                "Re": re_val,
                                "Rct": rct_val,
                            })
                    except (IndexError, TypeError):
                        continue

        # 3. Iterate through operations and align discharge cycles
        aligned_cycles: List[AlignedCycle] = []
        discharge_cycle_counter = 0
        prev_discharge_end_time: Optional[datetime] = None

        for i, op in enumerate(operations):
            if op["type"] != "discharge":
                continue

            discharge_cycle_counter += 1
            d_data = op["data"]

            # Capacity label
            if "Capacity" not in d_data.dtype.names:
                continue
            capacity = float(d_data["Capacity"][0, 0])
            soh = (capacity / self.NOMINAL_CAPACITY) * 100.0

            # Find immediately preceding charge
            charge_op = None
            for k in range(i - 1, -1, -1):
                if operations[k]["type"] == "charge":
                    charge_op = operations[k]
                    break

            if charge_op is None:
                continue

            # Find nearest impedance sweep
            nearest_re = 0.05
            nearest_rct = 0.07
            if impedance_records:
                min_diff = float("inf")
                best_imp = impedance_records[0]
                for imp in impedance_records:
                    diff = abs((imp["time"] - op["time"]).total_seconds())
                    if diff < min_diff:
                        min_diff = diff
                        best_imp = imp
                nearest_re = best_imp["Re"]
                nearest_rct = best_imp["Rct"]

            # Compute rest_time_hours prior to this discharge cycle
            # We calculate rest duration from the completion of the previous discharge
            # cycle (or end of preceding operation), capturing diffusion recovery.
            t_dis_start = op["time"]
            dis_time_arr = self._extract_array(d_data, "Time")
            dis_duration_s = float(dis_time_arr[-1]) if len(dis_time_arr) > 0 else 3600.0

            if prev_discharge_end_time is not None:
                delta_sec = (t_dis_start - prev_discharge_end_time).total_seconds()
                rest_time_hours = max(0.0, delta_sec / 3600.0)
            else:
                # First discharge cycle: rest time since start of preceding charge
                ch_time_arr = self._extract_array(charge_op["data"], "Time")
                ch_dur = float(ch_time_arr[-1]) if len(ch_time_arr) > 0 else 0.0
                ch_end = charge_op["time"] + timedelta(seconds=ch_dur)
                delta_sec = (t_dis_start - ch_end).total_seconds()
                rest_time_hours = max(0.0, delta_sec / 3600.0)

            prev_discharge_end_time = t_dis_start + timedelta(seconds=dis_duration_s)

            # Cycle 1 anomaly handling
            if drop_cycle_1 and discharge_cycle_counter == 1:
                continue

            # Extract charge arrays
            ch_data = charge_op["data"]
            charge_dict = {
                "Voltage_measured": self._extract_array(ch_data, "Voltage_measured"),
                "Current_measured": self._extract_array(ch_data, "Current_measured"),
                "Temperature_measured": self._extract_array(ch_data, "Temperature_measured"),
                "Time": self._extract_array(ch_data, "Time"),
            }

            # Extract discharge arrays
            discharge_dict = {
                "Voltage_measured": self._extract_array(d_data, "Voltage_measured"),
                "Current_measured": self._extract_array(d_data, "Current_measured"),
                "Temperature_measured": self._extract_array(d_data, "Temperature_measured"),
                "Time": dis_time_arr,
                "Capacity": capacity,
            }

            cycle_obj = AlignedCycle(
                battery_id=battery_id,
                cycle_index=discharge_cycle_counter,
                capacity=capacity,
                soh=soh,
                charge_data=charge_dict,
                discharge_data=discharge_dict,
                re=nearest_re,
                rct=nearest_rct,
                rest_time_hours=rest_time_hours,
                timestamp=t_dis_start,
            )
            aligned_cycles.append(cycle_obj)

        return aligned_cycles
