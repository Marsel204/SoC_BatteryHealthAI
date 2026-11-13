#!/usr/bin/env python3
"""Explore feature–capacity dependence; never train a prediction model.

Run from any directory with the analysis environment's Python. The default input
and outputs are resolved from this file, not the current working directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import scipy
from scipy.stats import spearmanr
import sklearn
from sklearn.feature_selection import mutual_info_regression


ROOT = Path(__file__).resolve().parents[3]
FEATURES = (
    "t_cc", "t_cv", "dq_dv_peak", "v_at_peak", "delta_T_max",
    "delta_V_ohmic", "Re", "Rct", "rest_time_hours",
)
NEIGHBORS = (3, 5, 10)
SEED = 20261026
DOC_URL = (
    "https://scikit-learn.org/stable/modules/generated/"
    "sklearn.feature_selection.mutual_info_regression.html"
)


def estimate(x: np.ndarray, y: np.ndarray, neighbors: int) -> float | None:
    """Use explicit continuous-variable treatment and seeded tie-breaking noise."""
    if len(x) <= neighbors or np.unique(x).size < 2 or np.unique(y).size < 2:
        return None
    return float(mutual_info_regression(
        x.reshape(-1, 1), y, discrete_features=False,
        n_neighbors=neighbors, random_state=SEED, copy=True,
    )[0])


def correlation(x: np.ndarray, y: np.ndarray) -> float | None:
    if len(x) < 2 or np.unique(x).size < 2 or np.unique(y).size < 2:
        return None
    return float(spearmanr(x, y).statistic)


def records_for(frame: pd.DataFrame) -> list[dict]:
    records = []
    for battery_id, group in frame.groupby("battery_id", sort=True):
        group = group.sort_values("cycle", kind="stable")
        for feature in FEATURES:
            x_all = group[feature].to_numpy(dtype=float)
            y_all = group["capacity"].to_numpy(dtype=float)
            valid = np.isfinite(x_all) & np.isfinite(y_all)
            x, y = x_all[valid], y_all[valid]
            rho = correlation(x, y)
            for neighbors in NEIGHBORS:
                records.append({
                    "battery_id": str(battery_id),
                    "feature": feature,
                    "neighbors": neighbors,
                    "value": estimate(x, y, neighbors),
                    "spearman": rho,
                    "n_pairs": len(x),
                    "n_excluded": int((~valid).sum()),
                    "n_unique_feature": int(np.unique(x).size),
                    "n_repeated_feature_rows": int(len(x) - np.unique(x).size),
                    "n_unique_target": int(np.unique(y).size),
                    "status": (
                        "estimated" if len(x) > neighbors
                        and np.unique(x).size > 1 and np.unique(y).size > 1
                        else "insufficient pairs or constant variable"
                    ),
                })
    return records


def synthetic_example() -> dict:
    # Integer symmetry makes both arms and their tied target ranks exact.
    # This deterministic teaching curve has no battery measurements or labels.
    x = np.arange(-100, 101, dtype=float) / 100
    y = x ** 2
    return {
        "label": "Synthetic teaching example only: y = x² (not battery data)",
        "x": x.tolist(), "y": y.tolist(),
        "spearman": correlation(x, y),
        "mi": estimate(x, y, 5), "neighbors": 5,
        "explanation": (
            "Both negative and positive x values determine y. The falling left "
            "arm and rising right arm cancel in a rank correlation, while mutual "
            "information detects dependence without needing one direction. "
            "This noiseless teaching curve is not a calibrated MI benchmark."
        ),
    }


def build_summary(records: list[dict], synthetic: dict) -> list[str]:
    summaries = [
        "Read MI as estimated dependence in nats, then use Spearman to see "
        "whether the association has a monotonic direction. Their scales differ.",
    ]
    for battery in sorted({r["battery_id"] for r in records}):
        available = [r for r in records if r["battery_id"] == battery
                     and r["neighbors"] == 5 and r["value"] is not None]
        if available:
            top = max(available, key=lambda r: r["value"])
            values = [r["value"] for r in records
                      if r["battery_id"] == battery and r["feature"] == top["feature"]
                      and r["value"] is not None]
            summaries.append(
                f"{battery}: at k=5, {top['feature']} has the largest estimated "
                f"MI among these nine features ({top['value']:.3f} nats; "
                f"Spearman {top['spearman']:+.3f}; {top['n_pairs']} valid pairs). "
                f"Its k=3/5/10 estimates span {min(values):.3f}–{max(values):.3f} "
                "nats. This describes this cell and estimator setting."
            )
    summaries.extend([
        f"Synthetic U shape: Spearman is {synthetic['spearman']:.3f}, while "
        f"MI is {synthetic['mi']:.3f} nats at k=5. A rank correlation near zero "
        "can miss a relationship that changes direction.",
        "Comparing k=3, 5 and 10 reveals estimator sensitivity; it is not a "
        "confidence interval. Smaller k can be more variable and larger k can "
        "smooth away structure.",
        "All four cells are exploratory. Shared aging trends, serial dependence "
        "and measurement timing prevent these values from establishing "
        "independent predictive value or a universal feature ranking.",
    ])
    return summaries


def validate(frame: pd.DataFrame, records: list[dict], synthetic: dict) -> dict:
    expected = frame["battery_id"].nunique() * len(FEATURES) * len(NEIGHBORS)
    if len(records) != expected:
        raise AssertionError("Incomplete battery/feature/neighbor grid")
    if records != records_for(frame) or synthetic != synthetic_example():
        raise AssertionError("Fixed-seed repeat did not reproduce exactly")
    for record in records:
        value, rho = record["value"], record["spearman"]
        if value is not None and (not np.isfinite(value) or value < 0):
            raise AssertionError("MI must be finite and nonnegative")
        if rho is not None and (not np.isfinite(rho) or abs(rho) > 1):
            raise AssertionError("Invalid Spearman coefficient")
        group = frame.loc[frame["battery_id"] == record["battery_id"]]
        valid_count = np.isfinite(group[[record["feature"], "capacity"]]
                                  .to_numpy(dtype=float)).all(axis=1).sum()
        if record["n_pairs"] != valid_count:
            raise AssertionError("Valid-pair count does not match source")
    if not (abs(synthetic["spearman"]) < 0.02
            and np.isfinite(synthetic["mi"]) and synthetic["mi"] > 0.5):
        raise AssertionError("Synthetic U shape does not demonstrate dependence")
    return {
        "deterministic_reproduction": "pass: exact full recomputation with fixed seed",
        "record_grid": f"pass: {len(records)} records",
        "valid_pair_counts": "pass: checked against source for every record",
        "finite_nonnegative_mi": "pass: every non-null battery MI and synthetic MI",
        "synthetic_demonstration": "pass: abs(Spearman) < 0.02 and MI > 0.5 nats",
        "strict_json": "pass: serialized with allow_nan=False",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path,
                        default=ROOT / "Reports/cycles_observed_flagged.csv")
    parser.add_argument("--output", type=Path,
                        default=ROOT / "Reports/learning/mutual_information.json")
    args = parser.parse_args()
    frame = pd.read_csv(args.input)
    required = {"battery_id", "cycle", "capacity", *FEATURES}
    if missing := required - set(frame.columns):
        raise ValueError(f"Missing required columns: {sorted(missing)}")
    if frame["battery_id"].isna().any() or frame.duplicated(["battery_id", "cycle"]).any():
        raise ValueError("Battery IDs must be present and battery/cycle keys unique")
    records = records_for(frame)
    synthetic = synthetic_example()
    result = {
        "technique": "mutual_information",
        "method": "Continuous k-nearest-neighbor mutual information against capacity, "
                  "computed separately for each battery and feature with k=3,5,10; "
                  "Spearman uses the same finite observed pairs, without imputation.",
        "caveats": [
            "MI is measured in nats, is not bounded by 1, has no sign or direction, "
            "and does not establish causation.",
            "This finite-sample estimator clips negative estimates to zero. "
            "An estimated zero does not prove independence.",
            "All features are treated as continuous. Repeated values, especially "
            "reused EIS measurements, challenge that assumption. Scikit-learn "
            "adds small seeded noise to break ties; ties are counted in records. "
            "This numerical handling neither creates new measurements nor fixes "
            "the dependence between cycles sharing the same measurement.",
            "Neighbor settings change the bias/variance tradeoff. The three "
            "estimates are sensitivity checks, not confidence bounds.",
            "Cycles are ordered, serially dependent observations. Shared aging "
            "trends can raise MI and correlation. No raw-row permutation p-values "
            "or claims of independent predictive value are made.",
            "Only valid finite feature–capacity pairs are used for each feature. "
            "Flagged charge values remain missing; no values are imputed.",
            "Nearest EIS alignment may select future measurements, and EIS "
            "completion times are unknown. Re/Rct associations do not certify "
            "availability at an earlier prediction moment.",
            "delta_T_max needs the full discharge; delta_V_ohmic needs the load "
            "step after discharge starts. rest_time_hours includes intervening "
            "charging and is not pure idle rest.",
            "All four batteries are exploratory, with no held-out cells or "
            "predictive model. Observed associations are not a universal ranking.",
        ],
        "records": records,
        "synthetic": synthetic,
        "summary": build_summary(records, synthetic),
        "metadata": {
            "source_file": args.input.name,
            "source_sha256": hashlib.sha256(args.input.read_bytes()).hexdigest(),
            "n_cycles": len(frame), "target": "capacity", "units": "nats",
            "features": list(FEATURES), "neighbor_settings": list(NEIGHBORS),
            "random_state": SEED,
            "estimator": "sklearn.feature_selection.mutual_info_regression",
            "discrete_features": False,
            "versions": {"numpy": np.__version__, "pandas": pd.__version__,
                         "scipy": scipy.__version__, "scikit_learn": sklearn.__version__},
            "source_documentation": DOC_URL,
            "data_contract": "Reports/data_contracts.md",
            "reproduction_command": ".venv/bin/python "
                                    "Code/analysis/techniques/mutual_information.py",
        },
        "validation": validate(frame, records, synthetic),
    }
    payload = json.dumps(result, indent=2, allow_nan=False) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(payload, encoding="utf-8")
    print(f"Wrote {args.output}: {len(records)} MI estimates; validation passed.")
    for summary in result["summary"]:
        print(summary)


if __name__ == "__main__":
    main()
