"""Data-analysis endpoints and the Data analysis -> Model bridge.

Everything here is read-only. It serves the observed, quality-flagged table and the
feature-versus-SoH statistics produced by the analysis, and joins them with facts about
the fitted models so the Model tab can be read in light of what the analysis found.
Every number in the bridge is computed from those files or from the fitted models;
nothing is hard-coded.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from functools import lru_cache
from typing import Any, Callable, Dict, List

import numpy as np
from fastapi import APIRouter, HTTPException

from . import paths
from .models import FEATURE_NAMES

# |rho| below this is shown as "no clear direction" rather than as a sign disagreement.
WEAK_RHO = 0.1
CHARGE_FEATURES = ["t_cc", "t_cv", "dq_dv_peak", "v_at_peak"]
PINNED_SOURCE_FILES = [
    "data/features_all_batteries.csv",
    "src/data_loader.py",
    "src/feature_engineering.py",
]


@lru_cache(maxsize=1)
def _scatterplots():
    """Load analysis/scatterplots.py by path to reuse its validated table loader.

    Reusing the builder's own loader keeps the app's checks (unique cycles, SoH equal to
    capacity / 2 Ah, flagged charge features masked) identical to the standalone report.
    """
    spec = importlib.util.spec_from_file_location("analysis_scatterplots", paths.SCATTERPLOTS_PY)
    if spec is None or spec.loader is None:
        raise FileNotFoundError(f"Cannot load {paths.SCATTERPLOTS_PY}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@lru_cache(maxsize=1)
def observed_rows() -> List[Dict[str, Any]]:
    """The observed table: missing values stay None, flagged charge features are masked."""
    module = _scatterplots()
    try:
        return module.load_rows()
    except SystemExit as exc:  # the builder's "run analysis/run_eda.py first" message
        raise FileNotFoundError(str(exc)) from exc


@lru_cache(maxsize=1)
def relationship_stats() -> List[Dict[str, Any]]:
    """Pearson r and Spearman rho of each feature with SoH, pooled and per battery."""
    module = _scatterplots()
    rows = observed_rows()
    batteries = sorted({r["battery_id"] for r in rows})
    stats: List[Dict[str, Any]] = []
    for battery in ["ALL", *batteries]:
        group = [r for r in rows if battery == "ALL" or r["battery_id"] == battery]
        for feature, _, _ in module.FEATURES:
            pairs = [(r[feature], r["soh"]) for r in group if r[feature] is not None]
            x, y = ([list(v) for v in zip(*pairs)] if pairs else ([], []))
            pearson, spearman = module.association(x, y)
            stats.append({
                "target": "soh",
                "battery_id": battery,
                "feature": feature,
                "n_pairs": len(pairs),
                "omitted_pairs": len(group) - len(pairs),
                "pearson_r": pearson,
                "spearman_rho": spearman,
            })
    return stats


def _sha256(path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


@lru_cache(maxsize=1)
def pinned_source_status() -> Dict[str, Any]:
    """Check that the upstream files the models and loaders use match the pinned manifest."""
    manifest = json.loads(paths.SOURCE_MANIFEST.read_text())
    expected = {entry["path"]: entry["sha256"] for entry in manifest["files"]}
    files = []
    for relative in PINNED_SOURCE_FILES:
        target = paths.SOURCE_DIR / relative
        actual = _sha256(target) if target.exists() else None
        files.append({"path": relative, "ok": actual is not None and actual == expected.get(relative)})
    return {
        "repository": manifest["repository"],
        "commit": manifest["commit"],
        "files": files,
        "verified": all(f["ok"] for f in files),
    }


@lru_cache(maxsize=1)
def _data_contracts() -> Dict[str, Any]:
    return json.loads(paths.DATA_CONTRACTS_JSON.read_text())


def pooled_charge_vif() -> Dict[str, float]:
    """Variance inflation of the four charging features on their complete cycles.

    VIF is the diagonal of the inverse correlation matrix. This reproduces the pooled
    values in analysis/results/learning/feature_overlap.md (a test pins them).
    """
    rows = observed_rows()
    complete = [[r[c] for c in CHARGE_FEATURES] for r in rows
                if all(r[c] is not None for c in CHARGE_FEATURES)]
    matrix = np.asarray(complete, dtype=float)
    standardized = (matrix - matrix.mean(axis=0)) / matrix.std(axis=0, ddof=1)
    inverse = np.linalg.inv(np.corrcoef(standardized, rowvar=False))
    return {name: float(value) for name, value in zip(CHARGE_FEATURES, np.diag(inverse))}


def _timing_status(entry: Dict[str, Any]) -> str:
    """'known' only when every cycle's value is observed with no later or unconfirmed timing."""
    total = entry["total_cycles"]
    if entry["starts_or_finishes_after_cutoff_count"] == total:
        return "later"
    if (entry["available_and_observed_count"] > 0
            and entry["starts_or_finishes_after_cutoff_count"] == 0
            and entry["completion_unknown_count"] == 0):
        return "known"
    return "unconfirmed"


def _availability() -> Dict[str, Dict[str, Dict[str, Any]]]:
    table: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for entry in _data_contracts()["availability"]:
        table.setdefault(entry["feature"], {})[entry["scenario"]] = {
            "status": _timing_status(entry),
            "available": entry["available_and_observed_count"],
            "later": entry["starts_or_finishes_after_cutoff_count"],
            "unknown": entry["completion_unknown_count"],
            "flagged": entry["quality_flagged_count"],
            "total": entry["total_cycles"],
        }
    return table


def _flagged_cycles() -> List[List[Any]]:
    return [[r["battery_id"], r["cycle"]] for r in observed_rows() if r["flagged"]]


def _join_and(items: List[str]) -> str:
    if len(items) <= 2:
        return " and ".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _describe_flagged(flagged: List[List[Any]]) -> str:
    by_battery: Dict[str, List[int]] = {}
    for battery, cycle in flagged:
        by_battery.setdefault(battery, []).append(cycle)
    parts = []
    for battery, cycles in by_battery.items():
        noun = "cycle" if len(cycles) == 1 else "cycles"
        parts.append(f"{battery} {noun} {_join_and([str(c) for c in cycles])}")
    return "; ".join(parts)


def _describe_later(temperature_later: int, voltage_later: int, total: int) -> str:
    """How many cycles need the discharge for temperature rise and the voltage drop."""
    if temperature_later == voltage_later == total:
        return f"which comes after charge completion in all {total} cycles"
    return (f"which comes after charge completion in {temperature_later} (temperature rise) and "
            f"{voltage_later} (voltage drop) of {total} cycles")


def build_relationships_payload() -> Dict[str, Any]:
    module = _scatterplots()
    rows = observed_rows()
    return {
        "target": {
            "key": "soh",
            "label": "State of health (SoH, %)",
            "definition": "measured capacity / 2 Ah x 100",
        },
        "features": [{"key": k, "title": t, "axis": a} for k, t, a in module.FEATURES],
        "batteries": sorted({r["battery_id"] for r in rows}),
        # Compact positional rows keep every observation, with no rounding or sampling.
        "rows": [[r["battery_id"], r["cycle"], r["soh"], *[r[k] for k, _, _ in module.FEATURES]]
                 for r in rows],
        "stats": relationship_stats(),
        "flagged": {"count": len(_flagged_cycles()), "cycles": _flagged_cycles()},
        "source": {
            "table": "analysis/results/cycles_observed_flagged.csv",
            "statistics": "analysis/results/feature_target_correlations.csv",
            "pinned": pinned_source_status(),
        },
    }


def build_bridge(engine: Any) -> Dict[str, Any]:
    """Join the analysis findings with the fitted Ridge model and the input timing audit."""
    stats = relationship_stats()
    rho = {s["feature"]: s["spearman_rho"] for s in stats if s["battery_id"] == "ALL"}
    weights = engine.ridge_model.get_feature_coefficients()
    jacobian = dict(zip(FEATURE_NAMES, (float(v) for v in engine.ridge_model.get_jacobian())))
    availability = _availability()
    contracts = _data_contracts()
    snapshot = contracts["snapshot"]

    features: List[Dict[str, Any]] = []
    for key in FEATURE_NAMES:
        r, w = rho[key], weights[key]
        if r is None or abs(r) < WEAK_RHO:
            direction = "unclear"
        elif np.sign(r) == np.sign(w):
            direction = "agrees"
        else:
            direction = "opposite"
        features.append({
            "key": key,
            "spearman_all": r,
            "ridge_weight": float(w),
            "ridge_jacobian": jacobian[key],
            "direction": direction,
            "timing": availability.get(key, {}),
        })

    opposite = [f["key"] for f in features if f["direction"] == "opposite"]
    clear = [f for f in features if f["direction"] != "unclear"]
    vif = pooled_charge_vif()
    flagged = _flagged_cycles()
    eoc = lambda name: availability[name]["end_of_charge"]  # noqa: E731

    caveats = [
        {
            "id": "evaluation",
            "title": "Scores are development estimates",
            "text": (
                "Leave-one-battery-out trains on three cells and scores the fourth, so "
                "neighbouring cycles of one cell never sit on both sides of a split. The data "
                "analysis, however, inspected all four cells and no untouched test set exists. "
                "Read the scores as development estimates from four cells, not as evidence of "
                "how a new cell will behave."
            ),
        },
        {
            "id": "timing",
            "title": "Some inputs are only known after the cycle",
            "text": (
                f"Temperature rise and the initial voltage drop need the discharge, "
                f"{_describe_later(eoc('delta_T_max')['later'], eoc('delta_V_ohmic')['later'], eoc('delta_T_max')['total'])}. "
                f"Re and Rct come from the nearest impedance sweep, which starts after charging ends in "
                f"{snapshot['eis_starts_after_charge_end']} of {eoc('Re')['total']} cycles and has no "
                f"known completion time in {eoc('Re')['unknown']} more. These nine-input models "
                f"therefore estimate SoH retrospectively; the scores say nothing about "
                f"end-of-charge prediction."
            ),
        },
        {
            "id": "flagged",
            "title": "Flagged cycles are filled in for the models",
            "text": (
                f"{len(flagged)} cycles have flagged charging measurements "
                f"({_describe_flagged(flagged)}). The Data analysis tab leaves them blank. The "
                f"models' training table (the original processed CSV) fills "
                f"{snapshot['processed_feature_cells_changed_from_raw']} feature cells in them "
                f"by interpolation."
            ),
        },
        {
            "id": "weights",
            "title": "Weights depend on the other inputs",
            "text": (
                f"Of the {len(clear)} features with a clear direction (|ρ| ≥ {WEAK_RHO}), "
                f"{len(opposite)} have a Ridge weight with the opposite sign to their own "
                f"Spearman correlation with SoH"
                + (f" ({', '.join(opposite)})" if opposite else "")
                + f". The four charging features overlap strongly (pooled VIF "
                f"{min(vif.values()):.1f} to {max(vif.values()):.1f}), so read individual weights "
                f"and Jacobians as effects given the other eight inputs, not as one-at-a-time "
                f"physical sensitivities."
            ),
        },
    ]

    return {
        "trained_on": {
            "cycles": int(len(engine.df)),
            "table": "original processed CSV (flagged charge cycles interpolated)",
            "ridge_alpha": float(engine.ridge_model.model.alpha_),
        },
        "weak_rho": WEAK_RHO,
        "features": features,
        "opposite": opposite,
        "pooled_vif": vif,
        "snapshot": snapshot,
        "caveats": caveats,
    }


def build_analysis_router(get_engine: Callable[[], Any]) -> APIRouter:
    router = APIRouter(prefix="/api/analysis", tags=["analysis"])

    @router.get("/relationships")
    def relationships() -> Dict[str, Any]:
        """Observed cycles and feature-versus-SoH statistics for the Data analysis tab."""
        try:
            return build_relationships_payload()
        except FileNotFoundError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @router.get("/bridge")
    def bridge() -> Dict[str, Any]:
        """Data-analysis findings that qualify how the Model tab's scores should be read."""
        try:
            return build_bridge(get_engine())
        except FileNotFoundError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    return router
