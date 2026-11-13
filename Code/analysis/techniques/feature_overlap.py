#!/usr/bin/env python3
"""Explore linear redundancy among four charge-end features; never fit capacity.

Run from any directory. Outputs are strict JSON and a short explanatory report.
Only complete rows of the four charging features enter any group calculation.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr


ROOT = Path(__file__).resolve().parents[3]
FEATURES = ("t_cc", "t_cv", "dq_dv_peak", "v_at_peak")
METHOD = (
    "Per battery and pooled, use the same complete cases of t_cc, t_cv, "
    "dq_dv_peak and v_at_peak. Center and scale columns (sample standard deviation). "
    "For a full-rank design, VIF is the diagonal of the inverse Pearson correlation "
    "matrix. Independently verify every finite VIF against 1/(1-R²) from a least-"
    "squares regression of that feature on an explicit intercept and the other "
    "three standardized features. R² = 1 - SSE/SST. In singular designs, inspect "
    "each auxiliary regression: a numerically zero residual gives status infinite "
    "and JSON null. Constant features have undefined VIF. Rank and condition "
    "diagnostics use the standardized feature matrix, excluding the intercept. "
    "Pairwise Spearman correlations use the identical four-feature complete cases."
)
CAVEATS = [
    "Exploratory measurements from four cells; cycles within a cell are repeated, temporally ordered observations, not independent experimental replicates.",
    "VIF measures linear redundancy among input features, whereas Spearman describes monotonic pairwise association; the two need not agree.",
    "High VIF can make individual linear coefficients unstable or hard to interpret even when predictions remain useful. No prediction model or accuracy estimate is produced here.",
    "No automatic feature-drop threshold is applied, and no causal conclusion follows from these associations.",
    "Pooling cells can mix within-cell and between-cell associations and hide battery differences. Read per-cell results alongside ALL.",
    "Capacity, SoH and cycle number are never included as features. These four inputs are available at charge completion only for unflagged cycles, according to data_contracts.md.",
    "Complete-case analysis excludes the five jointly masked charging cycles without imputation; missingness can affect conclusions.",
    "The reported condition number uses standardized feature columns, so it reflects overlap rather than differences in physical units. It is not the condition number of a predictive model.",
    "Exact or numerical perfect collinearity is represented by a null VIF and status infinite; undefined cases are also null with a distinct status. A singular matrix warns rather than producing a misleading pseudoinverse VIF.",
]


def auxiliary_vif(z: np.ndarray, index: int) -> tuple[float | None, str, float | None]:
    """Independent intercept-based 1/(1-R²), with explicit degenerate states."""
    y = z[:, index]
    others = np.delete(z, index, axis=1)
    design = np.column_stack((np.ones(len(z)), others))
    coefficients, _, _, _ = np.linalg.lstsq(design, y, rcond=None)
    residual = y - design @ coefficients
    sst = float(np.dot(y - y.mean(), y - y.mean()))
    if sst == 0:
        return None, "undefined_constant", None
    sse = float(np.dot(residual, residual))
    ratio = sse / sst
    # A residual at roundoff scale is not a finite, interpretable VIF.
    tolerance = (np.finfo(float).eps * max(design.shape) * 10) ** 2
    r_squared = float(1 - ratio)
    if ratio <= tolerance:
        return None, "infinite", r_squared
    return float(1 / ratio), "finite", r_squared


def analyze_group(frame: pd.DataFrame, battery_id: str) -> dict:
    values = frame.loc[:, FEATURES].to_numpy(dtype=float)
    complete = np.isfinite(values).all(axis=1)
    values = values[complete]
    n_rows, n_features = values.shape
    records, pairs, warnings = [], [], []
    diagnostics = {
        "battery_id": battery_id,
        "n_input_rows": len(frame),
        "n_complete_rows": n_rows,
        "n_excluded_rows": int((~complete).sum()),
        "n_features": n_features,
    }
    if n_rows < n_features + 1:
        warnings.append("Too few complete rows to estimate four-feature VIF with an intercept.")
        for feature in FEATURES:
            records.append(dict(battery_id=battery_id, feature=feature, vif=None,
                                status="undefined_insufficient_rows", n_rows=n_rows))
        diagnostics.update(rank=None, condition_number=None, condition_status="undefined", warnings=warnings)
        return dict(records=records, pairs=pairs, diagnostics=diagnostics)

    centered = values - values.mean(axis=0)
    scales = values.std(axis=0, ddof=1)
    constant = scales == 0
    z = centered / np.where(constant, 1.0, scales)
    singular_values = np.linalg.svd(z, compute_uv=False)
    rank = int(np.linalg.matrix_rank(z))
    full_rank = rank == n_features
    condition = float(singular_values[0] / singular_values[-1]) if full_rank else None
    if not full_rank:
        warnings.append("Singular standardized feature matrix: do not invert its correlation matrix or interpret a pseudoinverse diagonal as VIF.")
    elif condition > 1e4:
        warnings.append("Standardized feature matrix has a condition number above 10,000; inverse-based estimates may be numerically sensitive.")
    inverse_diagonal = np.diag(np.linalg.inv(z.T @ z / (n_rows - 1))) if full_rank else None
    maximum_relative_error = 0.0
    for index, feature in enumerate(FEATURES):
        independent, status, r_squared = auxiliary_vif(z, index)
        vif = float(inverse_diagonal[index]) if inverse_diagonal is not None else independent
        if status != "finite":
            vif = None
        if status == "finite" and inverse_diagonal is not None:
            relative_error = abs(vif - independent) / max(1.0, abs(independent))
            maximum_relative_error = max(maximum_relative_error, relative_error)
            if not np.isclose(vif, independent, rtol=1e-7, atol=1e-9):
                raise AssertionError(f"{battery_id}/{feature}: inverse VIF disagrees with auxiliary regression")
        records.append(dict(battery_id=battery_id, feature=feature, vif=vif, status=status,
                            n_rows=n_rows, auxiliary_r_squared=r_squared,
                            independently_verified_vif=independent))
    for i, j in itertools.combinations(range(n_features), 2):
        rho = None if constant[i] or constant[j] else float(spearmanr(values[:, i], values[:, j]).statistic)
        pairs.append(dict(battery_id=battery_id, feature_a=FEATURES[i], feature_b=FEATURES[j],
                          spearman=rho, n_pairs=n_rows))
    diagnostics.update(
        rank=rank,
        rank_with_intercept=int(np.linalg.matrix_rank(np.column_stack((np.ones(n_rows), z)))),
        condition_number=condition,
        condition_status="finite" if full_rank else "infinite",
        singular_values=[float(s) for s in singular_values],
        inverse_vs_auxiliary_max_relative_error=maximum_relative_error if full_rank else None,
        warnings=warnings,
    )
    return dict(records=records, pairs=pairs, diagnostics=diagnostics)


def self_test() -> list[str]:
    # Balanced factorial columns are exactly independent in this synthetic sample.
    independent = np.asarray(list(itertools.product((-1.0, 1.0), repeat=4)))
    base = pd.DataFrame(independent, columns=FEATURES)
    result = analyze_group(base, "SYNTHETIC_INDEPENDENT")
    assert all(record["status"] == "finite" and np.isclose(record["vif"], 1) for record in result["records"])
    redundant = base.copy()
    redundant[FEATURES[2]] = redundant[FEATURES[0]] + redundant[FEATURES[1]]
    result = analyze_group(redundant, "SYNTHETIC_REDUNDANT")
    assert [r["status"] for r in result["records"]] == ["infinite", "infinite", "infinite", "finite"]
    assert np.isclose(result["records"][3]["vif"], 1)
    assert result["diagnostics"]["rank"] == 3
    assert result["diagnostics"]["warnings"]
    json.dumps(result, allow_nan=False)
    constant = base.copy()
    constant[FEATURES[0]] = 7
    result = analyze_group(constant, "SYNTHETIC_CONSTANT")
    assert result["records"][0]["status"] == "undefined_constant"
    json.dumps(result, allow_nan=False)
    return ["Synthetic independent inputs yield VIF 1.",
            "Synthetic exact redundancy yields null/infinite VIF and a rank warning; unrelated input retains VIF 1.",
            "Synthetic constant input yields null/undefined_constant; all synthetic results serialize as strict JSON."]


def build_payload(input_path: Path) -> dict:
    frame = pd.read_csv(input_path)
    missing = {"battery_id", *FEATURES} - set(frame.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")
    if frame["battery_id"].isna().any():
        raise ValueError("Battery IDs must be present")
    nonnumeric = [feature for feature in FEATURES if not pd.api.types.is_numeric_dtype(frame[feature])]
    if nonnumeric:
        raise ValueError(f"Nonnumeric feature columns: {nonnumeric}")
    if np.isinf(frame.loc[:, FEATURES].to_numpy(dtype=float)).any():
        raise ValueError("Infinite source feature values must be corrected before analysis")
    groups = [("ALL", frame), *list(frame.groupby("battery_id", sort=True))]
    results = [analyze_group(group, str(battery)) for battery, group in groups]
    records = [r for result in results for r in result["records"]]
    pooled = [record for record in records if record["battery_id"] == "ALL"]
    pooled_text = ", ".join(f"{r['feature']} {r['vif']:.2f}" if r["vif"] is not None else f"{r['feature']} {r['status']}" for r in pooled)
    battery_text = "; ".join(
        f"{result['diagnostics']['battery_id']}: " + ", ".join(
            f"{r['feature']} {r['vif']:.2f}" if r["vif"] is not None else f"{r['feature']} {r['status']}"
            for r in result["records"])
        for result in results[1:]
    )
    diagnostics = [result["diagnostics"] for result in results]
    return dict(
        technique="feature_overlap", method=METHOD, caveats=CAVEATS, features=list(FEATURES),
        records=records, pairs=[p for result in results for p in result["pairs"]],
        summary=[
            f"Pooled complete cases: {diagnostics[0]['n_complete_rows']} of {len(frame)} aligned cycles; {diagnostics[0]['n_excluded_rows']} cycles excluded without imputation.",
            f"Pooled VIF: {pooled_text}.",
            f"Per-cell VIF: {battery_text}.",
            "Compare the battery-specific estimates with pooled estimates before interpreting any coefficient; no feature-removal decision follows automatically.",
        ],
        diagnostics=diagnostics,
        source={"path": str(input_path.relative_to(ROOT)) if input_path.is_relative_to(ROOT) else str(input_path),
                "sha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
                "availability_reference": "Reports/data_contracts.md"},
        verification={"inverse_vif_vs_independent_intercept_regression": "passed for all full-rank finite estimates",
                      "relative_tolerance": 1e-7, "absolute_tolerance": 1e-9},
    )


def markdown(payload: dict) -> str:
    lines = ["# Feature overlap: four charging features", "", payload["method"], "",
             *payload["summary"], "", "| Battery | Complete cycles | Feature | VIF | Status |",
             "|---|---:|---|---:|---|"]
    for record in payload["records"]:
        value = f"{record['vif']:.3f}" if record["vif"] is not None else "—"
        lines.append(f"| {record['battery_id']} | {record['n_rows']} | {record['feature']} | {value} | {record['status']} |")
    lines.extend(["", "## Standardized feature diagnostics", "",
                  "| Battery | Rank / 4 | Condition number | Excluded cycles |",
                  "|---|---:|---:|---:|"])
    for diag in payload["diagnostics"]:
        condition = f"{diag['condition_number']:.3f}" if diag["condition_number"] is not None else diag["condition_status"]
        lines.append(f"| {diag['battery_id']} | {diag['rank']} / 4 | {condition} | {diag['n_excluded_rows']} |")
    lines.extend(["", "## Same-row Spearman correlations", "",
                  "| Battery | Feature A | Feature B | Spearman ρ | Cycles |", "|---|---|---|---:|---:|"])
    for pair in payload["pairs"]:
        rho = f"{pair['spearman']:.3f}" if pair["spearman"] is not None else "undefined"
        lines.append(f"| {pair['battery_id']} | {pair['feature_a']} | {pair['feature_b']} | {rho} | {pair['n_pairs']} |")
    lines.extend(["", "## Interpretation limits", "", *[f"- {caveat}" for caveat in payload["caveats"]], "",
                  "Verification: inverse-correlation VIF agrees with independent intercept-based 1/(1−R²) within relative tolerance 1e-7 and absolute tolerance 1e-9.", "",
                  "Reproduce: `.venv/bin/python Code/analysis/techniques/feature_overlap.py --self-test`.", ""])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "Reports/cycles_observed_flagged.csv")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "Reports/learning")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    tests = self_test() if args.self_test else []
    payload = build_payload(args.input.resolve())
    payload["verification"]["synthetic_checks"] = tests
    encoded = json.dumps(payload, indent=2, allow_nan=False) + "\n"
    json.loads(encoded)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "feature_overlap.json").write_text(encoded)
    (args.output_dir / "feature_overlap.md").write_text(markdown(payload))
    print("\n".join(payload["summary"]))
    print(f"Saved {args.output_dir / 'feature_overlap.json'}")


if __name__ == "__main__":
    main()
