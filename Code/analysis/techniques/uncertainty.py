#!/usr/bin/env python3
"""Exploratory within-cell uncertainty for paired consecutive-cycle changes.

Run with .venv/bin/python Code/analysis/techniques/uncertainty.py
--self-test. Reads the observed table, writes only learning/uncertainty.json.
No interpolation, raw-row permutation, population inference, or prediction model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter
from pathlib import Path
import warnings

import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsmodels.tsa.stattools import adfuller, kpss


ROOT = Path(__file__).resolve().parents[3]
INPUT = ROOT / "Reports/cycles_observed_flagged.csv"
CONTRACT = ROOT / "Reports/data_contracts.md"
OUTPUT = ROOT / "Reports/learning/uncertainty.json"
FEATURES = (
    "t_cc", "t_cv", "dq_dv_peak", "v_at_peak", "delta_T_max",
    "delta_V_ohmic", "Re", "Rct", "rest_time_hours",
)
BLOCK_LENGTHS = (3, 5, 10)
SEED = 20261026
REPLICATES = 2000
MIN_DIAGNOSTIC_RUN = 25
POLICY = {
    "minimum_pairs": 80,
    "minimum_stationarity_run": MIN_DIAGNOSTIC_RUN,
    "minimum_diagnosed_pair_fraction": 0.90,
    "adf_p_must_be_less_than": 0.05,
    "kpss_p_must_be_at_least": 0.05,
    "maximum_thirds_sd_ratio": 3.0,
    "maximum_thirds_mean_range_in_overall_sd": 0.75,
    "maximum_thirds_correlation_range": 0.60,
    "trend_hac_p_threshold": 0.05,
    "trend_minimum_span_in_sd": 0.75,
    "minimum_pooled_nonoverlapping_blocks": 10,
    "minimum_blocks_in_every_run": 2,
    "minimum_successful_replicate_fraction": 0.99,
}
TIMING = {
    "t_cc": "Observed before discharge for unflagged cycles.",
    "t_cv": "Observed before discharge for unflagged cycles.",
    "dq_dv_peak": "Observed before discharge for unflagged cycles.",
    "v_at_peak": "Observed before discharge for unflagged cycles.",
    "delta_T_max": "Uses the full discharge; unavailable at discharge start.",
    "delta_V_ohmic": "Uses the load step after discharge start.",
    "Re": "Nearest EIS can be future; completion time is unconfirmed for earlier sweeps.",
    "Rct": "Nearest EIS can be future; completion time is unconfirmed for earlier sweeps.",
    "rest_time_hours": "Known at discharge start, not charge completion; includes intervening charging.",
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def correlation(x: np.ndarray, y: np.ndarray) -> float | None:
    """Pearson correlation, explicitly undefined for constant changes."""
    if len(x) < 3 or not np.isfinite(x).all() or not np.isfinite(y).all():
        return None
    xc, yc = x - x.mean(), y - y.mean()
    denom = np.linalg.norm(xc) * np.linalg.norm(yc)
    if denom == 0 or not np.isfinite(denom):
        return None
    return float(np.clip(xc @ yc / denom, -1, 1))


def aligned_changes(frame: pd.DataFrame, feature: str) -> dict:
    """Keep invalid positions until runs are formed. A gap invalidates both edges."""
    ordered = frame.sort_values("cycle", kind="stable")
    cycles = ordered["cycle"].to_numpy(dtype=float)
    if not np.isfinite(cycles).all() or not np.equal(cycles, np.floor(cycles)).all():
        raise ValueError("Cycle IDs must be finite integers")
    if len(np.unique(cycles)) != len(cycles):
        raise ValueError("Duplicate cycle IDs")
    levels = ordered[[feature, "capacity"]].to_numpy(dtype=float)
    # Subtraction before dropping NaNs prevents a change from spanning a missing row.
    with np.errstate(invalid="ignore"):
        changes = np.diff(levels, axis=0)
    valid = (
        (np.diff(cycles) == 1)
        & np.isfinite(levels[:-1]).all(axis=1)
        & np.isfinite(levels[1:]).all(axis=1)
        & np.isfinite(changes).all(axis=1)
    )
    positions = np.flatnonzero(valid)
    cuts = np.flatnonzero(np.diff(positions) != 1) + 1
    runs = [run for run in np.split(positions, cuts) if len(run)]
    # A cycle-ID jump can leave adjacent valid-array positions on either side.
    split_runs = []
    for run in runs:
        cycle_cuts = np.flatnonzero(np.diff(cycles[run + 1]) != 1) + 1
        split_runs.extend(piece for piece in np.split(run, cycle_cuts) if len(piece))
    return {
        "cycles": cycles,
        "changes": changes,
        "positions": positions,
        "runs": split_runs,
        "invalid_change_end_cycles": cycles[1:][~valid].astype(int).tolist(),
        "nonfinite_level_cycles": cycles[~np.isfinite(levels).all(axis=1)].astype(int).tolist(),
    }


def series_diagnostics(values: np.ndarray) -> dict:
    """Run tests within one continuous run, never on concatenated missing gaps."""
    out = {"n": len(values), "adf_p": None, "kpss_p": None, "concerns": []}
    sd = float(np.std(values, ddof=1)) if len(values) > 1 else 0.0
    out["sd"] = sd
    if sd == 0:
        out["concerns"].append("constant changes")
        return out
    if len(values) < MIN_DIAGNOSTIC_RUN:
        out["test_status"] = "too_short"
        return out
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            adf = adfuller(values, regression="c", autolag="AIC")
            kp = kpss(values, regression="c", nlags="auto")
        out.update({
            "adf_p": float(adf[1]), "adf_statistic": float(adf[0]),
            "adf_lags": int(adf[2]), "kpss_p": float(kp[1]),
            "kpss_statistic": float(kp[0]), "kpss_lags": int(kp[2]),
            "test_warnings": [str(w.message).strip() for w in caught],
            "test_status": "computed",
        })
        if adf[1] >= POLICY["adf_p_must_be_less_than"]:
            out["concerns"].append("ADF does not reject a unit root (inconclusive)")
        if kp[1] < POLICY["kpss_p_must_be_at_least"]:
            out["concerns"].append("KPSS rejects level stationarity")
        # A separate effect-size screen prevents a tiny trend p-value alone gating CIs.
        t = np.linspace(0, 1, len(values))
        fit = sm.OLS(values, sm.add_constant(t)).fit(
            cov_type="HAC", cov_kwds={"maxlags": min(5, len(values) // 4)}
        )
        span_sd = abs(float(fit.params[1])) / sd
        out["hac_linear_trend_p"] = float(fit.pvalues[1])
        out["linear_trend_span_in_sd"] = span_sd
        if fit.pvalues[1] < POLICY["trend_hac_p_threshold"] and span_sd >= POLICY["trend_minimum_span_in_sd"]:
            out["concerns"].append("HAC trend screen and trend effect-size screen flag drift")
    except (ValueError, np.linalg.LinAlgError, ZeroDivisionError) as exc:
        out["test_status"] = "failed"
        out["concerns"].append(f"diagnostic unavailable: {type(exc).__name__}")
    return out


def diagnostics(pairs: dict) -> dict:
    changes, positions, runs = pairs["changes"], pairs["positions"], pairs["runs"]
    reasons = []
    run_details = []
    for run in runs:
        run_details.append({
            "first_change_end_cycle": int(pairs["cycles"][run[0] + 1]),
            "last_change_end_cycle": int(pairs["cycles"][run[-1] + 1]),
            "n_pairs": len(run),
            "feature": series_diagnostics(changes[run, 0]),
            "capacity": series_diagnostics(changes[run, 1]),
        })
    for detail in run_details:
        for name in ("feature", "capacity"):
            for concern in detail[name]["concerns"]:
                reasons.append(f"{name}, run ending cycles {detail['first_change_end_cycle']}–{detail['last_change_end_cycle']}: {concern}")
    tested_n = sum(len(run) for run in runs if len(run) >= MIN_DIAGNOSTIC_RUN)
    fraction = tested_n / len(positions) if len(positions) else 0.0
    if len(positions) < POLICY["minimum_pairs"]:
        reasons.append(f"fewer than {POLICY['minimum_pairs']} aligned change pairs")
    if fraction < POLICY["minimum_diagnosed_pair_fraction"]:
        reasons.append("too many pairs are in runs too short for stationarity diagnostics")
    thirds_details = []
    # Chronological thirds compare moments, not lag structure; no gap is removed for tests.
    thirds = np.array_split(positions, 3)
    for third in thirds:
        vals = changes[third]
        thirds_details.append({
            "n_pairs": len(third),
            "feature_mean": float(vals[:, 0].mean()) if len(vals) else None,
            "capacity_mean": float(vals[:, 1].mean()) if len(vals) else None,
            "feature_sd": float(vals[:, 0].std(ddof=1)) if len(vals) > 1 else None,
            "capacity_sd": float(vals[:, 1].std(ddof=1)) if len(vals) > 1 else None,
            "correlation": correlation(vals[:, 0], vals[:, 1]),
        })
    moment_screens = {}
    for j, name in enumerate(("feature", "capacity")):
        overall_sd = float(changes[positions, j].std(ddof=1)) if len(positions) > 1 else 0.0
        sds = [z[f"{name}_sd"] for z in thirds_details]
        means = [z[f"{name}_mean"] for z in thirds_details]
        ratio = max(sds) / min(sds) if all(v is not None and v > 0 for v in sds) else None
        mean_span = (max(means) - min(means)) / overall_sd if overall_sd > 0 and all(v is not None for v in means) else None
        moment_screens[name] = {"thirds_sd_ratio": ratio, "thirds_mean_span_in_sd": mean_span}
        if overall_sd == 0:
            reasons.append(f"{name} changes are degenerate")
        if ratio is None:
            reasons.append(f"{name} has degenerate or insufficient third-window variability")
        elif ratio > POLICY["maximum_thirds_sd_ratio"]:
            reasons.append(f"{name} third-window SD ratio {ratio:.2f} exceeds {POLICY['maximum_thirds_sd_ratio']}")
        if mean_span is not None and mean_span > POLICY["maximum_thirds_mean_range_in_overall_sd"]:
            reasons.append(f"{name} third-window means differ by {mean_span:.2f} overall SD")
    correlations = [z["correlation"] for z in thirds_details]
    corr_range = max(correlations) - min(correlations) if all(v is not None for v in correlations) else None
    if corr_range is None:
        reasons.append("a third-window change correlation is undefined")
    elif corr_range > POLICY["maximum_thirds_correlation_range"]:
        reasons.append(f"third-window correlation range {corr_range:.2f} exceeds {POLICY['maximum_thirds_correlation_range']}; possible changing association")
    return {
        "status": "concerns" if reasons else "no_screened_concern",
        "reasons": reasons,
        "run_diagnostics": run_details,
        "diagnosed_pair_fraction": fraction,
        "short_run_pairs_not_stationarity_tested": len(positions) - tested_n,
        "thirds": thirds_details,
        "moment_screens": moment_screens,
        "thirds_correlation_range": corr_range,
    }


def draw_run_indices(run: np.ndarray, length: int, count: int, rng: np.random.Generator) -> np.ndarray:
    """Sample overlapping noncircular blocks inside this run, trim its last block."""
    n = len(run)
    if n < length:
        raise ValueError("Cannot sample a block longer than its contiguous run")
    starts = rng.integers(0, n - length + 1, size=(count, math.ceil(n / length)))
    offsets = starts[..., None] + np.arange(length)
    return run[offsets.reshape(count, -1)[:, :n]]


def bootstrap(changes: np.ndarray, runs: list[np.ndarray], length: int, seed: int, count: int = REPLICATES) -> np.ndarray:
    rng = np.random.default_rng(seed)
    indices = np.concatenate([draw_run_indices(run, length, count, rng) for run in runs], axis=1)
    sampled = changes[indices]
    centered = sampled - sampled.mean(axis=1, keepdims=True)
    numerator = np.sum(centered[:, :, 0] * centered[:, :, 1], axis=1)
    denominator = np.sqrt(np.sum(centered[:, :, 0] ** 2, axis=1) * np.sum(centered[:, :, 1] ** 2, axis=1))
    with np.errstate(invalid="ignore", divide="ignore"):
        correlations = numerator / denominator
    return np.clip(correlations[np.isfinite(correlations)], -1, 1)


def stable_seed(battery: str, feature: str, length: int) -> int:
    key = f"{SEED}:{battery}:{feature}:{length}".encode()
    # 32 bits keeps the audit seed exact in browser JSON number handling, too.
    return int.from_bytes(hashlib.sha256(key).digest()[:4], "little")


def analyze(frame: pd.DataFrame, source_hash: str, contract_hash: str) -> dict:
    records, audit = [], []
    for battery, group in frame.groupby("battery_id", sort=True):
        for feature in FEATURES:
            pairs = aligned_changes(group, feature)
            positions, runs, changes = pairs["positions"], pairs["runs"], pairs["changes"]
            diagnostic = diagnostics(pairs)
            estimate = correlation(changes[positions, 0], changes[positions, 1])
            longest = max(diagnostic["run_diagnostics"], key=lambda x: x["n_pairs"], default=None)
            audit_id = f"{battery}/{feature}"
            audit.append({
                "id": audit_id, "battery_id": battery, "feature": feature,
                "n_pairs": len(positions),
                "observed_cycles": len(group),
                "run_lengths": [len(run) for run in runs],
                "valid_change_end_cycles": pairs["cycles"][positions + 1].astype(int).tolist(),
                "invalid_change_end_cycles": pairs["invalid_change_end_cycles"],
                "nonfinite_level_cycles": pairs["nonfinite_level_cycles"],
                "timing_warning": TIMING[feature],
                "assumption_diagnostics": diagnostic,
            })
            for length in BLOCK_LENGTHS:
                reasons = list(diagnostic["reasons"])
                eligible_starts = [max(0, len(run) - length + 1) for run in runs]
                nonoverlap = sum(len(run) // length for run in runs)
                if nonoverlap < POLICY["minimum_pooled_nonoverlapping_blocks"]:
                    reasons.append("fewer than 10 pooled nonoverlapping blocks")
                if any(len(run) < POLICY["minimum_blocks_in_every_run"] * length for run in runs):
                    reasons.append("at least one run has fewer than two full blocks; short runs are retained, so this block length is skipped")
                record = {
                    "battery_id": battery, "feature": feature, "block_length": length,
                    "n_pairs": len(positions), "estimate": estimate,
                    "ci_low": None, "ci_high": None,
                    "status": "skipped" if reasons else "conditional",
                    "reason": "; ".join(reasons) if reasons else (
                        "No configured diagnostic concern. CI is conditional on stable weak dependence, "
                        "stable joint change distribution and adequate block length; these assumptions are not proven. "
                        f"{diagnostic['short_run_pairs_not_stationarity_tested']} pairs in short runs lack stationarity tests."
                    ),
                    "bootstrap_replicates": 0,
                    "adf_feature_p": longest["feature"]["adf_p"] if longest else None,
                    "kpss_feature_p": longest["feature"]["kpss_p"] if longest else None,
                    "adf_capacity_p": longest["capacity"]["adf_p"] if longest else None,
                    "kpss_capacity_p": longest["capacity"]["kpss_p"] if longest else None,
                    "pvalue_scope": "Longest contiguous run only; all tested runs and screens are in assumption_diagnostics.",
                    "audit_id": audit_id,
                    "assumption_diagnostic_status": diagnostic["status"],
                    "short_run_pairs_not_stationarity_tested": diagnostic["short_run_pairs_not_stationarity_tested"],
                    "eligible_block_starts_per_run": eligible_starts,
                    "pooled_nonoverlapping_blocks": nonoverlap,
                    "run_lengths": [len(run) for run in runs],
                    "seed": stable_seed(str(battery), feature, length),
                    "timing_warning": TIMING[feature],
                }
                if not reasons and estimate is not None:
                    values = bootstrap(changes, runs, length, record["seed"])
                    record["bootstrap_replicates"] = len(values)
                    if len(values) < REPLICATES * POLICY["minimum_successful_replicate_fraction"]:
                        record.update(status="skipped", reason="Too many resamples have undefined correlations; no interval reported.")
                    else:
                        low, high = np.quantile(values, [0.025, 0.975])
                        record.update(ci_low=float(low), ci_high=float(high))
                records.append(record)
    counts = dict(Counter(record["status"] for record in records))
    sensitivity = []
    for item in audit:
        selected = [r for r in records if r["audit_id"] == item["id"] and r["status"] == "conditional"]
        sensitivity.append({
            "audit_id": item["id"],
            "reported_block_lengths": [r["block_length"] for r in selected],
            "lower_endpoint_range": max(r["ci_low"] for r in selected) - min(r["ci_low"] for r in selected) if len(selected) > 1 else None,
            "upper_endpoint_range": max(r["ci_high"] for r in selected) - min(r["ci_high"] for r in selected) if len(selected) > 1 else None,
            "all_reported_intervals_exclude_zero": all(r["ci_low"] > 0 or r["ci_high"] < 0 for r in selected) if selected else None,
        })
    return {
        "technique": "uncertainty",
        "method": "Run-stratified paired moving-block bootstrap of consecutive first differences, after exploratory assumption screening; 95% percentile intervals, 2000 resamples, block lengths 3/5/10.",
        "statistic": "Within-battery Pearson correlation of Δfeature(cycle t) and Δcapacity(cycle t), each defined as value(t) − value(t−1) only for consecutive finite observed cycles.",
        "caveats": [
            "All four cells are exploratory. CIs concern within-cell change association under resampling assumptions, not level correlation, causality, prediction intervals or new-cell generalization.",
            "No missing value is filled. A missing measurement invalidates both neighboring first differences. A cycle-ID gap is never differenced or crossed by a sampled block.",
            "Blocks contain paired feature/capacity changes in original order. Each run is resampled separately to its original length; dependence is preserved inside a sampled block and broken at artificial block joins.",
            "Noncircular overlapping blocks undersample run endpoints; the last sampled block is truncated. Short runs have few eligible starts. Run weights and observed missingness are conditioned on, not estimated.",
            "ADF tests a unit-root null; KPSS tests a level-stationarity null. Tests use a constant, ADF AIC lag selection and automatic KPSS lags. KPSS p-values at 0.01/0.10 are table bounds, not exact tail probabilities.",
            "Tests run separately on every contiguous run with at least 25 changes. Shorter runs remain in the estimand and bootstrap; their stationarity is untested. At least 90% of all pairs must be in tested runs. Short-sample tests have limited power and sensitivity to lag selection, breaks and outliers.",
            "Marginal stationarity tests do not establish joint stationarity. Chronological thirds compare means, standard deviations and association; HAC linear-trend screens add evidence. These thresholds are explicit conservative analyst heuristics, not calibrated stationarity tests or guarantees of 95% coverage.",
            "Diagnostic screening is data dependent. Conditional percentile intervals have no selective-inference coverage correction. No single p-value proves assumptions and no multiple-comparison significance claims are made.",
            "The three block lengths are sensitivity scenarios, not independently validated choices. Dependence beyond 10 cycles can remain; no block length was tuned to obtain a preferred interval.",
            "Pearson change association can be driven by jumps and measurement noise; first differencing can introduce serial dependence and changes the scientific question. Cycles are the index; irregular elapsed time is not regularized.",
            "Timing warnings apply to every feature. Full-discharge and nearest-EIS features are retrospective descriptions and are not certified early prediction inputs. No models are trained.",
        ],
        "records": records,
        "summary": [
            f"{len(records)} battery/feature/block-length records: {counts.get('conditional', 0)} conditional intervals and {counts.get('skipped', 0)} skipped intervals.",
            "Read assumption_diagnostics separately from bootstrap results. A skipped row retains a descriptive change correlation when defined, with null CI endpoints.",
            "Compare all available block lengths; report the chosen battery and feature, pair count, missing gaps, diagnostic concerns and timing warning.",
        ],
        "assumption_diagnostics": audit,
        "block_length_sensitivity": sensitivity,
        "audit": {
            "seed": SEED, "requested_replicates": REPLICATES, "status_counts": counts,
            "input_path": str(INPUT.relative_to(ROOT)), "input_sha256": source_hash,
            "data_contract_path": str(CONTRACT.relative_to(ROOT)), "data_contract_sha256": contract_hash,
            "input_rows": len(frame), "battery_count": int(frame.battery_id.nunique()),
            "screening_policy": POLICY,
            "policy_origin": "Analyst-defined exploratory screens selected during this EDA, not preregistered or externally calibrated coverage rules.",
            "sources": [
                "https://www.statsmodels.org/stable/examples/notebooks/generated/stationarity_detrending_adf_kpss.html",
                "https://www.statsmodels.org/stable/generated/statsmodels.tsa.stattools.kpss.html",
                "https://tsbootstrap.readthedocs.io/en/latest/tutorials/observation_resampling.html",
            ],
        },
    }


def validate_artifact(payload: dict, frame: pd.DataFrame) -> None:
    """Check the saved schema and independently recompute alignment and estimates."""
    json.dumps(payload, allow_nan=False)
    assert len(payload["records"]) == frame.battery_id.nunique() * len(FEATURES) * len(BLOCK_LENGTHS)
    keys = set()
    for record in payload["records"]:
        key = record["battery_id"], record["feature"], record["block_length"]
        assert key not in keys
        keys.add(key)
        ordered = frame.loc[frame.battery_id == key[0]].sort_values("cycle")
        # Independent row-by-row check includes endpoints and does not drop NaNs first.
        expected = []
        expected_cycles = []
        for left, right in zip(ordered.to_dict("records"), ordered.to_dict("records")[1:]):
            vals = [left[key[1]], right[key[1]], left["capacity"], right["capacity"]]
            if right["cycle"] - left["cycle"] == 1 and all(np.isfinite(v) for v in vals):
                expected.append([right[key[1]] - left[key[1]], right["capacity"] - left["capacity"]])
                expected_cycles.append(int(right["cycle"]))
        assert record["n_pairs"] == len(expected)
        arr = np.asarray(expected).reshape(-1, 2)
        expected_estimate = correlation(arr[:, 0], arr[:, 1])
        assert record["estimate"] == expected_estimate
        audit = next(a for a in payload["assumption_diagnostics"] if a["id"] == record["audit_id"])
        assert audit["valid_change_end_cycles"] == expected_cycles
        if record["status"] == "conditional":
            assert -1 <= record["ci_low"] <= record["ci_high"] <= 1
            assert record["bootstrap_replicates"] >= 1000
            assert audit["assumption_diagnostics"]["status"] == "no_screened_concern"
        else:
            assert record["status"] == "skipped"
            assert record["ci_low"] is None and record["ci_high"] is None
            assert record["reason"]


def self_test() -> list[str]:
    checks = []
    frame = pd.DataFrame({
        "cycle": [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12],
        "t_cc": [1, 2, np.nan, 4, 5, 6, 7, 9, 10, np.inf, 12],
        "capacity": np.arange(11, dtype=float),
    })
    pairs = aligned_changes(frame, "t_cc")
    actual = pairs["cycles"][pairs["positions"] + 1].astype(int).tolist()
    assert actual == [2, 5, 6, 7, 10], actual
    assert [len(r) for r in pairs["runs"]] == [1, 3, 1]
    checks.append("Synthetic NaN, infinity and missing cycle IDs do not create bridged differences.")
    run = np.arange(20, 47)
    for length in BLOCK_LENGTHS:
        sampled = draw_run_indices(run, length, 200, np.random.default_rng(SEED))
        assert sampled.shape == (200, len(run))
        assert sampled.min() >= run.min() and sampled.max() <= run.max()
        for start in range(0, len(run), length):
            assert (np.diff(sampled[:, start:min(start + length, len(run))], axis=1) == 1).all()
    # Explicitly sample across separate runs, and ensure no real block crosses the gap.
    separated = [np.arange(0, 31), np.arange(40, 78)]
    draws = [draw_run_indices(r, 5, 20, np.random.default_rng(SEED)) for r in separated]
    assert np.all(draws[0] < 31) and np.all(draws[1] >= 40)
    checks.append("Synthetic sampled blocks are adjacent, confined to each original run, and preserve run sample counts.")
    rng = np.random.default_rng(SEED)
    values = rng.normal(size=(80, 2))
    values[:, 1] += 0.6 * values[:, 0]
    sample_a = bootstrap(values, [np.arange(80)], 5, SEED)
    sample_b = bootstrap(values, [np.arange(80)], 5, SEED)
    assert np.array_equal(sample_a, sample_b) and len(sample_a) == REPLICATES
    low, high = np.quantile(sample_a, [0.025, 0.975])
    assert -1 <= low <= high <= 1
    assert correlation(np.ones(80), values[:, 1]) is None
    assert len(bootstrap(np.column_stack([np.ones(80), values[:, 1]]), [np.arange(80)], 5, SEED)) == 0
    checks.append("Synthetic bootstrap is reproducible, correctly ordered and rejects degenerate changes.")
    return checks


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true", help="Also run synthetic and full-output reproducibility checks")
    args = parser.parse_args()
    before = {INPUT: digest(INPUT), CONTRACT: digest(CONTRACT)}
    frame = pd.read_csv(INPUT)
    if frame.duplicated(["battery_id", "cycle"]).any():
        raise ValueError("Duplicate battery/cycle keys")
    payload = analyze(frame, before[INPUT], before[CONTRACT])
    checks = self_test() if args.self_test else []
    validate_artifact(payload, frame)
    checks.append("Actual artifact: unique complete schema, finite JSON, independent pair/estimate alignment, CI ordering and honest skipped rows.")
    if args.self_test:
        repeated = analyze(frame, before[INPUT], before[CONTRACT])
        assert json.dumps(payload, sort_keys=True, allow_nan=False) == json.dumps(repeated, sort_keys=True, allow_nan=False)
        checks.append("Full actual analysis rerun is exactly reproducible with deterministic per-record seeds.")
    assert all(digest(path) == value for path, value in before.items())
    checks.append("Observed input and data contract SHA-256 hashes are unchanged.")
    payload["audit"]["validation_checks"] = checks
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n")
    saved = json.loads(OUTPUT.read_text(), parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
    validate_artifact(saved, frame)
    print(json.dumps({"output": str(OUTPUT.relative_to(ROOT)), "status_counts": payload["audit"]["status_counts"], "validation_checks": checks}, indent=2))


if __name__ == "__main__":
    main()
