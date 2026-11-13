#!/usr/bin/env python3
"""Describe battery/stage distributions and marginal observed-range coverage.

No model is fitted. Other-battery references are descriptive comparisons, not
training folds. Run from any directory; source measurements are read only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[3]
FEATURES = (
    "capacity", "t_cc", "t_cv", "dq_dv_peak", "v_at_peak", "delta_T_max",
    "delta_V_ohmic", "Re", "Rct", "rest_time_hours",
)
STAGES = ("early", "middle", "late")
QUANTILES = {"min": 0.0, "q10": 0.1, "q25": 0.25, "median": 0.5,
             "q75": 0.75, "q90": 0.9, "max": 1.0}
METHOD = (
    "Sort each battery by its original cycle ID. Split chronological row positions "
    "into three contiguous groups with numpy.array_split: sizes differ by at most "
    "one, with any remainder assigned to early then middle. Preserve original cycle "
    "IDs and report each stage's full membership. Compute univariate quantiles using "
    "linear interpolation at (n_valid - 1) × probability, excluding missing values "
    "separately for each variable and retaining n_valid/n_total. For each battery "
    "and variable, compare its finite observations with the inclusive observed "
    "min/max of the pooled other batteries; count values strictly below or above "
    "that reference range. Also compare late-stage observations with the same "
    "battery's early-stage range. Capacity is a measured outcome shown for context, "
    "not an input feature. These are descriptive range comparisons, not model "
    "training, held-out evaluation, significance tests or generalization estimates."
)
CAVEATS = [
    "All four batteries have already been explored; none is an untouched test set. The word held-out in a range comparison does not create an independent evaluation set.",
    "Cycles within a battery are ordered repeated observations. No naive iid KS p-values, PSI thresholds or statistical significance claims are used.",
    "An observed min/max is sample-dependent and sensitive to extremes; it is not a physical limit or a probability support estimate. A larger reference sample has more opportunities to contain extremes.",
    "These are one-variable comparisons. A value inside every marginal range can still form an unfamiliar multivariable combination; inside-range values can also have very different frequencies.",
    "Battery identity, aging stage, discharge current and resistance measurement protocols can all change distributions. Current/protocol differences confound comparisons; natural aging is not necessarily a defect.",
    "Stages are relative chronological thirds of observed cycles, not equal elapsed time, equal capacity loss or the same aging state across batteries. Cycle IDs are retained; absent earlier/later observations are not inferred.",
    "Five flagged cycles keep capacity and other measurements but have all four charge features missing (20 feature cells). No imputation or whole-row deletion is performed.",
    "Availability matters separately from coverage: delta_T_max needs full discharge, delta_V_ohmic needs the later load step, and nearest EIS Re/Rct can be future or have unknown completion. See data_contracts.md.",
    "rest_time_hours ends at discharge start and includes intervening charging; it is not pure idle rest. Charging feature values are available only on unflagged cycles at charge completion.",
    "No capacity-matched comparison or extrapolation is performed. Four cells and their finite observed ranges cannot establish behavior in new cells, operating conditions or future aging stages.",
]


def finite_values(frame: pd.DataFrame, feature: str) -> np.ndarray:
    values = frame[feature].to_numpy(dtype=float)
    return values[np.isfinite(values)]


def describe(frame: pd.DataFrame, battery: str, feature: str, stage: str) -> dict:
    values = finite_values(frame, feature)
    quantiles = np.quantile(values, list(QUANTILES.values()), method="linear") if len(values) else [None] * len(QUANTILES)
    return dict(
        battery_id=battery, feature=feature, stage=stage,
        n_valid=int(len(values)), n_total=int(len(frame)),
        **{key: float(value) if value is not None else None
           for key, value in zip(QUANTILES, quantiles)},
        first_cycle=int(frame["cycle"].iloc[0]), last_cycle=int(frame["cycle"].iloc[-1]),
    )


def compare_support(target: pd.DataFrame, reference: pd.DataFrame,
                    battery: str, feature: str) -> dict:
    values = finite_values(target, feature)
    ref = finite_values(reference, feature)
    lo, hi = (float(ref.min()), float(ref.max())) if len(ref) else (None, None)
    outside = int(((values < lo) | (values > hi)).sum()) if len(ref) else 0
    return dict(
        battery_id=battery, feature=feature, n_valid=int(len(values)),
        n_reference=int(len(ref)), outside_count=outside,
        outside_fraction=float(outside / len(values)) if len(values) and len(ref) else None,
        reference_min=lo, reference_max=hi,
        n_total=int(len(target)), n_reference_total=int(len(reference)),
        below_count=int((values < lo).sum()) if len(ref) else 0,
        above_count=int((values > hi).sum()) if len(ref) else 0,
        status="observed_range_comparison" if len(values) and len(ref) else "insufficient_support",
    )


def manual_quantile(values: list[float], probability: float) -> float | None:
    """Independent sorted-order calculation, without numpy/pandas quantiles."""
    ordered = sorted(value for value in values if math.isfinite(value))
    if not ordered:
        return None
    position = (len(ordered) - 1) * probability
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (position - low) * (ordered[high] - ordered[low])


def verify(payload: dict, groups: dict, staged: dict, frame: pd.DataFrame) -> dict:
    """Check partitions and independently recalculate every exported statistic."""
    for battery, group in groups.items():
        parts = [staged[(battery, stage)] for stage in STAGES]
        cycles = [int(cycle) for part in parts for cycle in part["cycle"]]
        assert cycles == group["cycle"].astype(int).tolist(), battery
        assert len(set(cycles)) == len(group), battery
        assert max(map(len, parts)) - min(map(len, parts)) <= 1, battery
    for record in payload["records"]:
        key = (record["battery_id"], record["stage"])
        data = groups[key[0]] if key[1] == "all" else staged[key]
        values = data[record["feature"]].astype(float).tolist()
        assert record["n_total"] == len(values)
        assert record["n_valid"] == sum(math.isfinite(v) for v in values)
        assert record["first_cycle"] == int(data["cycle"].iloc[0])
        assert record["last_cycle"] == int(data["cycle"].iloc[-1])
        actual = [record[key] for key in QUANTILES]
        assert all(value is None for value in actual) or all(a <= b for a, b in zip(actual, actual[1:]))
        for key, probability in QUANTILES.items():
            independent = manual_quantile(values, probability)
            assert (record[key] is None and independent is None) or math.isclose(record[key], independent, rel_tol=1e-12, abs_tol=1e-12)
    for collection in ("support", "temporal_support"):
        for record in payload[collection]:
            battery, feature = record["battery_id"], record["feature"]
            target = groups[battery] if collection == "support" else staged[(battery, "late")]
            reference = frame[frame["battery_id"] != battery] if collection == "support" else staged[(battery, "early")]
            values = [float(v) for v in target[feature] if math.isfinite(v)]
            ref = [float(v) for v in reference[feature] if math.isfinite(v)]
            outside = sum(value < min(ref) or value > max(ref) for value in values) if ref else 0
            assert record["n_valid"] == len(values) and record["n_reference"] == len(ref)
            assert record["outside_count"] == outside
            assert record["below_count"] + record["above_count"] == outside
            if ref and values:
                assert record["outside_fraction"] == outside / len(values)
                assert record["reference_min"] == min(ref) and record["reference_max"] == max(ref)
    # Every per-variable count reconciles across all disjoint chronological thirds.
    for battery in groups:
        for feature in FEATURES:
            rows = [r for r in payload["records"] if r["battery_id"] == battery and r["feature"] == feature]
            whole = next(r for r in rows if r["stage"] == "all")
            assert sum(r["n_valid"] for r in rows if r["stage"] != "all") == whole["n_valid"]
            assert sum(r["n_total"] for r in rows if r["stage"] != "all") == whole["n_total"]
    json.dumps(payload, allow_nan=False)
    return dict(
        stage_partitions="passed: chronological, disjoint, exhaustive; original cycle IDs preserved",
        counts="passed: all variable counts reconcile across stages",
        quantile_ordering="passed for all records",
        independent_quantiles=f"passed: sorted-order interpolation matches all {len(payload['records'])} records within 1e-12",
        independent_support=f"passed: Python list comparisons match all {len(payload['support']) + len(payload['temporal_support'])} support records",
        strict_json="passed: no NaN or Infinity",
    )


def build_payload(input_path: Path) -> dict:
    frame = pd.read_csv(input_path)
    required = {"battery_id", "cycle", *FEATURES}
    if required - set(frame.columns):
        raise ValueError(f"Missing columns: {sorted(required - set(frame.columns))}")
    if frame["battery_id"].isna().any() or frame.duplicated(["battery_id", "cycle"]).any():
        raise ValueError("Battery IDs must be present; battery/cycle pairs must be unique")
    values = frame[["cycle", *FEATURES]].to_numpy(dtype=float)
    if np.isinf(values).any():
        raise ValueError("Infinite source values cannot be silently omitted")
    cycles = frame["cycle"].to_numpy(dtype=float)
    if not np.isfinite(cycles).all() or (cycles <= 0).any() or (cycles != np.floor(cycles)).any():
        raise ValueError("Cycle IDs must be finite positive integers")
    groups, staged, partitions, records, support, temporal = {}, {}, [], [], [], []
    for battery, group in frame.groupby("battery_id", sort=True):
        battery = str(battery)
        group = group.sort_values("cycle").reset_index(drop=True)
        if len(group) < 3:
            raise ValueError(f"{battery}: at least three rows needed for nonempty thirds")
        groups[battery] = group
        stage_metadata = []
        for stage, positions in zip(STAGES, np.array_split(np.arange(len(group)), 3)):
            subset = group.iloc[positions]
            staged[(battery, stage)] = subset
            stage_metadata.append(dict(
                stage=stage, n_total=int(len(subset)), first_position=int(positions[0]) + 1,
                last_position=int(positions[-1]) + 1, first_cycle=int(subset["cycle"].iloc[0]),
                last_cycle=int(subset["cycle"].iloc[-1]), cycle_ids=subset["cycle"].astype(int).tolist(),
            ))
        partitions.append(dict(battery_id=battery, n_total=int(len(group)), stages=stage_metadata))
        for stage, subset in [("all", group), *((stage, staged[(battery, stage)]) for stage in STAGES)]:
            records.extend(describe(subset, battery, feature, stage) for feature in FEATURES)
        reference = frame[frame["battery_id"] != battery]
        support.extend(compare_support(group, reference, battery, feature) for feature in FEATURES)
        for feature in FEATURES:
            comparison = compare_support(staged[(battery, "late")], staged[(battery, "early")], battery, feature)
            comparison.update(target_stage="late", reference_stage="early")
            temporal.append(comparison)

    largest = sorted((r for r in support if r["feature"] != "capacity" and r["outside_fraction"] is not None),
                     key=lambda r: r["outside_fraction"], reverse=True)[:4]
    stage_text = []
    for battery in groups:
        early = next(r for r in records if r["battery_id"] == battery and r["feature"] == "capacity" and r["stage"] == "early")
        late = next(r for r in records if r["battery_id"] == battery and r["feature"] == "capacity" and r["stage"] == "late")
        stage_text.append(f"{battery} {early['median']:.3f} → {late['median']:.3f} Ah")
    missing_count = int(frame[list(FEATURES)].isna().sum().sum())
    payload = dict(
        technique="coverage", method=METHOD, caveats=CAVEATS, records=records,
        support=support, temporal_support=temporal, stage_partitions=partitions,
        features=list(FEATURES), input_features=list(FEATURES[1:]),
        outcome="capacity", n_cycles=int(len(frame)), n_batteries=len(groups),
        summary=[
            f"{len(frame)} cycles from {len(groups)} batteries; {missing_count} missing variable cells remain explicit in n_valid/n_total.",
            "Early → late median capacity: " + "; ".join(stage_text) + ".",
            "Largest other-battery marginal range differences among the nine inputs: " + "; ".join(
                f"{r['battery_id']} {r['feature']}: {r['outside_count']}/{r['n_valid']} ({r['outside_fraction']:.1%}) outside"
                for r in largest) + ".",
            "A later model could encounter values beyond earlier experience. Battery identity and aging stage both change distributions, so inspect per-battery and per-stage distributions before choosing a future validation design.",
            "Outside an observed range does not prove a defect or prediction failure; inside a range does not establish a familiar distribution or successful prediction.",
        ],
        source=dict(path=str(input_path.relative_to(ROOT)) if input_path.is_relative_to(ROOT) else str(input_path),
                    sha256=hashlib.sha256(input_path.read_bytes()).hexdigest(),
                    contracts="Reports/data_contracts.md"),
    )
    payload["verification"] = verify(payload, groups, staged, frame)
    return payload


def markdown(payload: dict) -> str:
    lines = ["# Distribution and coverage", "", payload["method"], "", *payload["summary"], "",
             "## Chronological stages", "", "| Battery | Stage | Cycles | Count |", "|---|---|---|---:|"]
    for battery in payload["stage_partitions"]:
        for stage in battery["stages"]:
            lines.append(f"| {battery['battery_id']} | {stage['stage']} | {stage['first_cycle']}–{stage['last_cycle']} | {stage['n_total']} |")
    lines.extend(["", "## Other-battery observed-range comparisons", "",
                  "Reference: all finite observations from the other three batteries. Endpoints count as inside. Capacity is an outcome shown for context.", "",
                  "| Battery | Variable | Valid / total | Reference valid | Outside | Fraction |", "|---|---|---:|---:|---:|---:|"])
    for record in payload["support"]:
        fraction = f"{record['outside_fraction']:.1%}" if record["outside_fraction"] is not None else "insufficient support"
        lines.append(f"| {record['battery_id']} | {record['feature']} | {record['n_valid']} / {record['n_total']} | {record['n_reference']} | {record['outside_count']} | {fraction} |")
    lines.extend(["", "## Interpretation limits", "", *[f"- {caveat}" for caveat in payload["caveats"]], "",
                  "## Verification", "", *[f"- {key}: {value}" for key, value in payload["verification"].items()], "",
                  "The JSON also contains all quantiles, exact stage cycle memberships and early-reference/late-target support comparisons.", "",
                  "Reproduce: `.venv/bin/python Code/analysis/techniques/coverage.py`.", ""])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "Reports/cycles_observed_flagged.csv")
    parser.add_argument("--output", type=Path, default=ROOT / "Reports/learning/coverage.json")
    parser.add_argument("--report", type=Path, default=ROOT / "Reports/learning/coverage.md")
    args = parser.parse_args()
    payload = build_payload(args.input.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n")
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(markdown(payload))
    print("\n".join(payload["summary"]))
    print(f"Verified {len(payload['records'])} distribution records, {len(payload['support'])} other-battery and {len(payload['temporal_support'])} temporal support records.")
    print(f"Wrote {args.output} and {args.report}")


if __name__ == "__main__":
    main()
