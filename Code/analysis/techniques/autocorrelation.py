#!/usr/bin/env python3
"""Explore lag association without deleting missing battery-cycle positions."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import pearsonr


ROOT = Path(__file__).resolve().parents[3]
FEATURES = [
    "capacity", "t_cc", "t_cv", "dq_dv_peak", "v_at_peak",
    "delta_T_max", "delta_V_ohmic", "Re", "Rct", "rest_time_hours",
]


def lag_correlation(values: np.ndarray, lag: int) -> tuple[float | None, int]:
    """Pearson correlation of x[t-lag], x[t] over finite endpoint pairs.

    Each endpoint vector is centered and scaled on its own retained values.
    No rows are removed before shifting, so missing cycles retain their distance.
    """
    values = np.asarray(values, dtype=float)
    if lag < 1:
        raise ValueError("lag must be positive")
    earlier, later = values[:-lag], values[lag:]
    valid = np.isfinite(earlier) & np.isfinite(later)
    earlier, later = earlier[valid], later[valid]
    n_pairs = int(valid.sum())
    if n_pairs < 2:
        return None, n_pairs
    x = earlier - earlier.mean()
    y = later - later.mean()
    norm = float(np.linalg.norm(x) * np.linalg.norm(y))
    if norm == 0:
        return None, n_pairs
    return float(np.clip(np.dot(x, y) / norm, -1, 1)), n_pairs


def consecutive_differences(values: np.ndarray) -> np.ndarray:
    """Keep Δx[t] at cycle t; a missing endpoint makes that difference missing."""
    return np.r_[np.nan, np.diff(np.asarray(values, dtype=float))]


def self_test() -> dict:
    # Hand checks: never bridge the missing third cycle when differencing.
    x = np.array([1., 2., np.nan, 4., 8., 7., 9.])
    expected_diff = np.array([np.nan, 1., np.nan, np.nan, 4., -1., 2.])
    np.testing.assert_allclose(consecutive_differences(x), expected_diff, equal_nan=True)
    value, n = lag_correlation(x, 1)
    expected = np.corrcoef([1., 4., 8., 7.], [2., 8., 7., 9.])[0, 1]
    assert n == 4
    np.testing.assert_allclose(value, expected, rtol=1e-13)
    value, n = lag_correlation(expected_diff, 1)
    assert n == 2
    np.testing.assert_allclose(value, -1., atol=1e-14)
    assert lag_correlation(expected_diff, 2) == (None, 1)
    assert lag_correlation(np.array([1., np.nan, 3., 4.]), 1) == (None, 1)
    assert lag_correlation(np.ones(6), 1) == (None, 5)
    assert lag_correlation(np.array([np.nan, np.nan]), 1) == (None, 0)
    return {
        "synthetic_missing_gap_checks": "passed",
        "synthetic_sequence": [1, 2, None, 4, 8, 7, 9],
        "expected_consecutive_differences": [None, 1, None, None, 4, -1, 2],
        "level_lag1_n_pairs": 4,
        "difference_lag1_n_pairs": 2,
        "difference_lag2_n_pairs": 1,
        "constant_and_insufficient_pairs_checks": "passed",
    }


def analyze(source: Path) -> dict:
    validation = self_test()
    df = pd.read_csv(source)
    required = {"battery_id", "cycle", *FEATURES}
    if missing := required - set(df.columns):
        raise ValueError(f"Missing columns: {sorted(missing)}")
    if df[["battery_id", "cycle"]].isna().any().any():
        raise ValueError("Battery and cycle keys must be present")
    if df.duplicated(["battery_id", "cycle"]).any():
        raise ValueError("Battery/cycle keys must be unique")
    records = []
    batteries = []
    independent_checks = []
    for battery_id, frame in df.groupby("battery_id", sort=True):
        frame = frame.sort_values("cycle")
        cycles = frame["cycle"].to_numpy(dtype=float)
        if not np.isfinite(cycles).all() or not np.equal(cycles, np.floor(cycles)).all():
            raise ValueError("Cycle identifiers must be finite integers")
        if len(cycles) > 1 and not np.equal(np.diff(cycles), 1).all():
            raise ValueError("Expected contiguous cycle indices; do not compress gaps")
        batteries.append({
            "battery_id": str(battery_id), "n_cycles": len(frame),
            "first_cycle": int(cycles[0]), "last_cycle": int(cycles[-1]),
            "missing_values": {feature: int(frame[feature].isna().sum()) for feature in FEATURES},
        })
        for feature in FEATURES:
            levels = frame[feature].to_numpy(dtype=float)
            if np.isinf(levels).any():
                raise ValueError(f"Infinite value in {battery_id}/{feature}")
            for series, values in [("level", levels), ("difference", consecutive_differences(levels))]:
                for lag in range(1, 21):
                    value, n_pairs = lag_correlation(values, lag)
                    records.append({
                        "battery_id": str(battery_id), "feature": feature,
                        "series": series, "lag": lag, "value": value, "n_pairs": n_pairs,
                    })
                    # Independent library estimators verify 12 combinations per cell.
                    if feature in {"capacity", "t_cc"} and lag in {1, 7, 20}:
                        paired = np.column_stack([values[:-lag], values[lag:]])
                        paired = paired[np.isfinite(paired).all(axis=1)]
                        if value is not None:
                            scipy_value = float(pearsonr(paired[:, 0], paired[:, 1]).statistic)
                            numpy_value = float(np.corrcoef(paired, rowvar=False)[0, 1])
                            np.testing.assert_allclose(value, scipy_value, atol=1e-12, rtol=1e-12)
                            np.testing.assert_allclose(value, numpy_value, atol=1e-12, rtol=1e-12)
                            independent_checks.append({
                                "battery_id": str(battery_id), "feature": feature,
                                "series": series, "lag": lag, "n_pairs": n_pairs,
                                "max_absolute_error": max(abs(value - scipy_value), abs(value - numpy_value)),
                            })

    def result(battery: str, feature: str, series: str, lag: int = 1) -> dict:
        return next(r for r in records if r["battery_id"] == battery and r["feature"] == feature
                    and r["series"] == series and r["lag"] == lag)

    summary = [
        "Neighboring battery cycles share information: measurements from consecutive cycles should not be treated as independent replicates.",
        "High lag correlation on levels can reflect the shared aging trend. Consecutive differences compare cycle-to-cycle changes and reduce that trend, but do not guarantee stationarity or independence.",
    ]
    for battery in batteries:
        battery_id = battery["battery_id"]
        level = result(battery_id, "capacity", "level")
        difference = result(battery_id, "capacity", "difference")
        summary.append(
            f"{battery_id}: capacity lag-1 correlation is {level['value']:.3f} on levels "
            f"({level['n_pairs']} pairs) and {difference['value']:.3f} on consecutive differences "
            f"({difference['n_pairs']} pairs)."
        )
    summary.append("Lag k means k recorded battery cycles, not a fixed number of hours; operating and rest intervals vary.")
    validation["independent_library_checks"] = independent_checks
    validation["independent_library_check_count"] = len(independent_checks)
    validation["record_count"] = len(records)
    assert len(records) == len(batteries) * len(FEATURES) * 2 * 20
    return {
        "technique": "autocorrelation",
        "method": "Pairwise lag Pearson correlation (not the conventional globally normalized sample ACF)",
        "source": str(source.relative_to(ROOT)) if source.is_relative_to(ROOT) else str(source),
        "estimator": {
            "definition": "For lag k, correlate x[t-k] with x[t] over cycle positions where both endpoints are finite, using separate means and variances for the retained earlier and later vectors.",
            "formula": "sum((a-mean(a))*(b-mean(b))) / sqrt(sum((a-mean(a))^2)*sum((b-mean(b))^2))",
            "difference": "Δx[t] = x[t] - x[t-1]. The first cycle and any difference touching a missing value remain missing. Differences retain original cycle positions before lagging.",
            "undefined": "value=null when fewer than two finite endpoint pairs remain or either endpoint vector has zero variance; n_pairs still reports available pairs.",
            "lags": list(range(1, 21)),
        },
        "caveats": [
            "These pairwise correlations use lag-specific endpoint means and scales; they differ from standard sample ACF estimates that use a single global mean and variance.",
            "No iid significance bands or p-values are reported. Aging trends and serial dependence invalidate a naive independence interpretation for levels.",
            "All four cells are exploratory; no cell is an untouched final holdout. These diagnostics do not establish generalization or causality.",
            "Missing charging features remain missing. Rows are not dropped before lagging or differencing, and no missing-cycle gap is bridged.",
            "Lag counts cycles, not elapsed clock time. Changing operating conditions and variable rest intervals can affect correlations.",
            "Repeated nearest-sweep EIS values can create persistence in Re and Rct. Their timing/availability limits remain as documented in data_contracts.md.",
            "Consecutive differences can induce negative lag-1 association even for independent measurement noise; negative correlation alone does not prove alternating physical behavior.",
            "With only two nonconstant pairs Pearson correlation is necessarily ±1 and is not robust evidence. Always inspect n_pairs.",
            "Capacity is measured in Ah. SoH=capacity*50 is a positive rescaling and has identical lag correlations, so it is not duplicated in records.",
        ],
        "batteries": batteries,
        "records": records,
        "summary": summary,
        "validation": validation,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "Reports/cycles_observed_flagged.csv")
    parser.add_argument("--output", type=Path, default=ROOT / "Reports/learning/autocorrelation.json")
    args = parser.parse_args()
    output = analyze(args.input.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(output['records'])} records to {args.output}")
    for line in output["summary"]:
        print(line)
    print(f"Validation: missing-gap checks passed; {output['validation']['independent_library_check_count']} NumPy/SciPy checks passed.")


if __name__ == "__main__":
    main()
