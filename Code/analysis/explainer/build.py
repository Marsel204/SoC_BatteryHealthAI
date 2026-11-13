"""Build the single-file explainer from saved results and the pinned raw data.

The page explains the whole path from raw NASA files to the analysis findings. Nothing here
fits a model or recomputes a statistic: tables and statistics are read from Reports,
and the worked examples (waveforms behind one cycle's nine numbers) are re-derived with the
pinned loader and extractor and asserted to reproduce the saved table exactly.

Run from the project root:  .venv/bin/python Code/analysis/explainer/build.py
"""
from __future__ import annotations

import base64
import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.integrate import cumulative_trapezoid
from scipy.signal import savgol_filter

ROOT = Path(__file__).resolve().parent
ANALYSIS = ROOT.parent
REPO = ANALYSIS.parents[1]
RESULTS = REPO / "Reports"
WEB = REPO / "Web" / "HTML"
LEARNING = RESULTS / "learning"
SOURCE = REPO
sys.path.insert(0, str(SOURCE))
from src.data_loader import NASADataLoader  # noqa: E402  (pinned, checksummed originals)
from src.feature_engineering import PhysicsFeatureExtractor  # noqa: E402

BATTERIES = ["B0005", "B0006", "B0007", "B0018"]
FEATURES = ["t_cc", "t_cv", "dq_dv_peak", "v_at_peak", "delta_T_max",
            "delta_V_ohmic", "Re", "Rct", "rest_time_hours"]
CHARGE = FEATURES[:4]
OP_CODE = {"charge": 0, "discharge": 1, "impedance": 2}


# ---- helpers -----------------------------------------------------------------------------
def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean(value, digits=6):
    """JSON-safe rounding that keeps small non-zero values."""
    if isinstance(value, np.ndarray):
        return clean(value.tolist(), digits)
    if isinstance(value, dict):
        return {k: clean(v, digits) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v, digits) for v in value]
    if isinstance(value, (np.floating, float)):
        v = float(value)
        if not math.isfinite(v):
            return None
        return v if 0 < abs(v) < 10 ** -digits else round(v, digits)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def verify_pinned_source() -> dict:
    """Refuse to build on source files that differ from the checksummed manifest."""
    manifest = json.loads((ANALYSIS / "source_manifest.json").read_text())
    expected = {f["path"]: f["sha256"] for f in manifest["files"]}
    for relative in ["data/features_all_batteries.csv", "src/data_loader.py", "src/feature_engineering.py"] + \
            [f"data/raw/{b}.mat" for b in BATTERIES]:
        actual = sha256(SOURCE / relative)
        if actual != expected[relative]:
            raise SystemExit(f"Pinned source differs from the manifest: {relative}")
    return manifest


# ---- worked examples: mirror the extractor's own rules, then assert equality ------------------
def decimate(array, n=150):
    array = np.asarray(array)
    if len(array) <= n:
        return array, np.arange(len(array))
    idx = np.unique(np.linspace(0, len(array) - 1, n).round().astype(int))
    return array[idx], idx


def mirror_charge(e: PhysicsFeatureExtractor, v, i, t):
    """The samples the extractor uses for t_cc, t_cv and the incremental-capacity peak."""
    marks = {}
    idx_min = np.where(v >= e.v_cc_min)[0]
    idx_max = np.where(v >= e.v_cc_max)[0]
    if len(idx_min):
        t0 = float(t[idx_min[0]])
        t1 = float(t[idx_max[0]]) if len(idx_max) else float(t[np.argmax(v)])
        marks["cc"] = {"start": t0, "end": t1, "reaches_limit": bool(len(idx_max)), "duration": max(0.0, t1 - t0)}
    else:
        marks["cc"] = None

    idx_cv = np.where(v >= (e.v_cc_max - 0.015))[0]
    if len(idx_cv):
        s = float(t[idx_cv[0]])
        ends = np.where((t >= s) & (i <= e.i_cv_cutoff) & (i >= -0.1))[0]
        end = float(t[ends[0]]) if len(ends) else float(t[-1])
        marks["cv"] = {"start": s, "end": end, "ended_by_cutoff": bool(len(ends)), "duration": max(0.0, end - s)}
    else:
        marks["cv"] = None

    mask = (v >= e.v_ic_min) & (v <= e.v_ic_max) & (i >= 0.5)
    marks["ic_samples"] = int(mask.sum())
    marks["ic"] = None
    marks["ic_peak"] = (0.0, 4.0)  # the extractor's fallback
    if mask.sum() >= 10:
        v_sub, i_sub, t_sub = v[mask], i[mask], t[mask]
        q_cum = cumulative_trapezoid(i_sub, t_sub, initial=0.0) / 3600.0
        order = np.argsort(v_sub)
        v_u, u_idx = np.unique(v_sub[order], return_index=True)
        q_u = q_cum[order][u_idx]
        if len(v_u) >= 5:
            lo, hi = max(e.v_ic_min, float(v_u[0])), min(e.v_ic_max, float(v_u[-1]))
            n_bins = int(round((hi - lo) / e.ic_bin_v)) + 1
            if n_bins >= 5:
                v_grid = np.linspace(lo, hi, n_bins)
                q_grid = np.interp(v_grid, v_u, q_u)
                win = min(9, len(q_grid))
                if win % 2 == 0:
                    win -= 1
                poly = min(2, win - 1)
                q_smooth = savgol_filter(q_grid, window_length=win, polyorder=poly) if (win >= 5 and poly >= 1) else q_grid
                dq = np.gradient(q_smooth, v_grid)
                valid = (v_grid >= 3.85) & (v_grid <= 4.15)
                if valid.any():
                    k = int(np.argmax(dq[valid]))
                    peak_v, peak = float(v_grid[valid][k]), float(dq[valid][k])
                else:
                    k = int(np.argmax(dq))
                    peak_v, peak = float(v_grid[k]), float(dq[k])
                marks["ic"] = {"v": v_grid, "q": q_grid, "q_smooth": q_smooth, "dq": dq,
                               "t_first": float(t_sub[0]), "t_last": float(t_sub[-1])}
                marks["ic_peak"] = (max(0.0, peak), peak_v)
    return marks


def mirror_discharge(v, i, temp, t):
    out = {"delta_t": float(temp.max() - temp[0]) if len(temp) else 0.0,
           "t_max_index": int(np.argmax(temp)) if len(temp) else 0}
    load = np.where(i <= -1.0)[0]
    out["step"] = None
    out["delta_v"] = 0.0
    if len(load):
        loaded = int(load[0])
        ocv = max(0, loaded - 1)
        out["delta_v"] = max(0.0, float(v[ocv] - v[loaded]))
        lo, hi = max(0, loaded - 4), min(len(t), loaded + 9)
        out["step"] = {"ocv": ocv - lo, "loaded": loaded - lo, "t": t[lo:hi], "v": v[lo:hi], "i": i[lo:hi],
                       "current": float(abs(i[loaded])), "first_loaded_time": float(t[loaded])}
    return out


def build_timeline(ops: pd.DataFrame, audit_row, rest_hours: float):
    """Operations around one discharge, in hours relative to that discharge's start."""
    ops = ops.copy()
    ops["start_ts"] = pd.to_datetime(ops["start"])
    ops["end_ts"] = pd.to_datetime(ops["end"])
    d = ops.loc[ops.operation_id == int(audit_row["discharge_operation_id"])].iloc[0]
    earlier = ops[(ops.type == "discharge") & (ops.operation_id < d.operation_id)]
    prev = earlier.iloc[-1]
    origin = d.start_ts
    window_start = prev.start_ts - pd.Timedelta(minutes=30)
    window_end = d.end_ts + pd.Timedelta(minutes=30)
    inside = ops[(ops.end_ts >= window_start) & (ops.start_ts <= window_end)]
    hours = lambda ts: float((ts - origin).total_seconds() / 3600.0)
    reconstructed = hours(d.start_ts) - hours(prev.end_ts)
    assert abs(reconstructed - rest_hours) < 1e-4, (audit_row["battery_id"], audit_row["cycle"], reconstructed, rest_hours)
    return {
        "ops": [[OP_CODE[r.type], hours(r.start_ts), hours(r.end_ts), int(r.operation_id)] for r in inside.itertuples()],
        "discharge_op": int(d.operation_id), "charge_op": int(audit_row["charge_operation_id"]),
        "prev_discharge_end": hours(prev.end_ts), "rest_hours": float(rest_hours),
        "eis_offset_hours": float(audit_row["nearest_impedance_offset_hours"]),
        "eis_after_charge_end": bool(audit_row["nearest_impedance_after_charge_end"]),
        "eis_after_discharge_start": bool(audit_row["nearest_impedance_after_discharge_start"]),
    }


def choose_cycles(battery: str, observed: pd.DataFrame) -> list[int]:
    rows = observed[observed.battery_id == battery].sort_values("cycle")
    cycles = rows.cycle.tolist()
    picks = {cycles[0], cycles[-1]}
    for q in (0.25, 0.5, 0.75):
        picks.add(cycles[int(round((len(cycles) - 1) * q))])
    flagged = rows[rows.charge_quality_flag].cycle.tolist()
    picks.update(flagged)                                                # flagged cycles: the failure cases
    picks.add(flagged[0] - 1) if flagged else None                       # a normal neighbour to compare with
    picks.add(int(rows.loc[rows.rest_time_hours.idxmax(), "cycle"]))     # the longest rest
    return sorted(picks)


def worked_examples(observed: pd.DataFrame, audit: pd.DataFrame, ops: pd.DataFrame) -> dict:
    loader = NASADataLoader(data_dir=str(SOURCE / "data" / "raw"))
    extractor = PhysicsFeatureExtractor()
    examples = []
    for battery in BATTERIES:
        aligned = {c.cycle_index: c for c in loader.load_and_align_battery(battery, drop_cycle_1=True)}
        for cycle in choose_cycles(battery, observed):
            c = aligned[cycle]
            feat = extractor.extract_cycle_features(c)
            row = observed[(observed.battery_id == battery) & (observed.cycle == cycle)].iloc[0]
            # The saved table masks flagged charge features; every other value must match exactly.
            for name in FEATURES + ["capacity", "soh"]:
                if pd.isna(row[name]):
                    assert bool(row.charge_quality_flag) and name in CHARGE, (battery, cycle, name)
                else:
                    assert abs(float(row[name]) - float(feat[name])) < 1e-9, (battery, cycle, name)
            ch, dis = c.charge_data, c.discharge_data
            v, i, t = ch["Voltage_measured"], ch["Current_measured"], ch["Time"]
            m = mirror_charge(extractor, v, i, t)
            d = mirror_discharge(dis["Voltage_measured"], dis["Current_measured"], dis["Temperature_measured"], dis["Time"])
            # The mirrored rules must reproduce the extractor's raw outputs.
            assert abs((m["cc"]["duration"] if m["cc"] else 0.0) - feat["t_cc"]) < 1e-9
            assert abs((m["cv"]["duration"] if m["cv"] else 0.0) - feat["t_cv"]) < 1e-9
            assert abs(m["ic_peak"][0] - feat["dq_dv_peak"]) < 1e-9 and abs(m["ic_peak"][1] - feat["v_at_peak"]) < 1e-9
            assert abs(d["delta_t"] - feat["delta_T_max"]) < 1e-9 and abs(d["delta_v"] - feat["delta_V_ohmic"]) < 1e-9
            audit_row = audit[(audit.battery_id == battery) & (audit.cycle == cycle)].iloc[0]
            timeline = build_timeline(ops[ops.battery_id == battery], audit_row, float(feat["rest_time_hours"]))

            tc, ic_idx = decimate(t)
            td, id_idx = decimate(dis["Time"])
            charge = {"t": tc, "v": v[ic_idx], "i": i[ic_idx], "n": int(len(t)), "duration": float(t[-1]),
                      "first_v": float(v[0]), "v_min": float(v.min()), "v_max": float(v.max())}
            discharge = {"t": td, "v": dis["Voltage_measured"][id_idx], "temp": dis["Temperature_measured"][id_idx],
                         "n": int(len(dis["Time"])), "duration": float(dis["Time"][-1]),
                         "t_max_time": float(dis["Time"][d["t_max_index"]]),
                         "t_max": float(dis["Temperature_measured"].max()), "t_start": float(dis["Temperature_measured"][0])}
            example = {
                "battery": battery, "cycle": cycle, "capacity": float(feat["capacity"]), "soh": float(feat["soh"]),
                "flagged": bool(row.charge_quality_flag),
                "features": {k: float(feat[k]) for k in FEATURES},          # raw extractor output, before masking
                "charge": charge, "discharge": discharge,
                "cc": m["cc"], "cv": m["cv"], "ic_samples": m["ic_samples"],
                "ic": None if m["ic"] is None else {
                    "v": m["ic"]["v"], "q": m["ic"]["q"], "q_smooth": m["ic"]["q_smooth"], "dq": m["ic"]["dq"],
                    "t_first": m["ic"]["t_first"], "t_last": m["ic"]["t_last"]},
                "peak": {"dq": m["ic_peak"][0], "v": m["ic_peak"][1], "fallback": m["ic"] is None},
                "load_step": d["step"], "timeline": timeline,
                "re": float(c.re), "rct": float(c.rct),
            }
            examples.append(example)
    return {"examples": examples}


# ---- payload ---------------------------------------------------------------------------------
def prune(full: dict, keep: set) -> dict:
    return {k: v for k, v in full.items() if k in keep}


def load_payload() -> tuple[dict, dict]:
    manifest = verify_pinned_source()
    observed_path = RESULTS / "cycles_observed_flagged.csv"
    observed = pd.read_csv(observed_path)
    audit = pd.read_csv(RESULTS / "raw_cycle_audit.csv")
    ops = pd.read_csv(RESULTS / "operations.csv")
    contracts = json.loads((RESULTS / "data_contracts.json").read_text())
    stats = pd.read_csv(RESULTS / "feature_target_correlations.csv")
    changes = pd.read_csv(RESULTS / "feature_changes.csv")
    raw_extracted = pd.read_csv(RESULTS / "cycles_raw_extracted.csv")
    repo_csv = pd.read_csv(SOURCE / "data" / "features_all_batteries.csv")
    clusters = pd.read_csv(RESULTS / "cycle_clusters.csv")
    feature_clusters = pd.read_csv(RESULTS / "feature_clusters.csv")
    clustering = json.loads((RESULTS / "clustering.json").read_text())
    temporal = pd.read_csv(RESULTS / "temporal_diagnostics.csv")
    bins = pd.read_csv(RESULTS / "peak_bin_sensitivity.csv")
    quality = pd.read_csv(RESULTS / "data_quality.csv")
    recon = pd.read_csv(RESULTS / "csv_reconstruction_checks.csv")
    summary = pd.read_csv(RESULTS / "battery_summary.csv")
    verification = json.loads((RESULTS / "verification.json").read_text())
    environment = json.loads((RESULTS / "environment.json").read_text())

    # The saved technique results must have been computed from this exact observed table.
    mi = json.loads((LEARNING / "mutual_information.json").read_text())
    assert mi["metadata"]["source_sha256"] == sha256(observed_path), "learning results are stale: rebuild them first"
    assert clustering["source"]["sha256"] == sha256(observed_path), "clustering results are stale: rebuild them first"

    # --- operation tape (chapter 1) ---
    ops = ops.copy()
    ops["start_ts"] = pd.to_datetime(ops["start"])
    ops["end_ts"] = pd.to_datetime(ops["end"])
    tape = {}
    for b in BATTERIES:
        g = ops[ops.battery_id == b].sort_values("operation_id")
        origin = g.start_ts.min()
        tape[b] = {"first": str(g.start_ts.min())[:10], "last": str(g.end_ts.max())[:10],
                   "ops": [[OP_CODE[r.type], float((r.start_ts - origin).total_seconds() / 3600.0),
                            float((r.end_ts - r.start_ts).total_seconds() / 3600.0)] for r in g.itertuples()],
                   "counts": g.type.value_counts().to_dict()}

    # --- observed cycles + the source CSV's filled values for flagged cycles ---
    cols = ["battery_id", "cycle", "capacity", "soh"] + FEATURES + ["charge_quality_flag"]
    cycles = {"columns": cols, "rows": [[(None if (isinstance(x, float) and math.isnan(x)) else (bool(x) if isinstance(x, (np.bool_, bool)) else x))
                                         for x in r] for r in observed[cols].itertuples(index=False, name=None)]}
    flagged_rows = observed[observed.charge_quality_flag]
    repo_idx = repo_csv.set_index(["battery_id", "cycle"])
    raw_idx = raw_extracted.set_index(["battery_id", "cycle"])
    flagged = []
    for r in flagged_rows.itertuples():
        flagged.append({"battery": r.battery_id, "cycle": int(r.cycle),
                        "raw": {k: float(raw_idx.loc[(r.battery_id, r.cycle), k]) for k in CHARGE},
                        "repo": {k: float(repo_idx.loc[(r.battery_id, r.cycle), k]) for k in CHARGE}})
    assert len(changes) == 15 and len(flagged) == 5

    # --- clusters ---
    default = clustering["scopes"]["ALL"]["all"]
    ev = default["projection"]["explained_variance_ratio"]
    cluster_rows = clusters[["battery_id", "cycle", "soh", "included", "pc1", "pc2",
                             "cluster_k2", "cluster_k3", "cluster_k4", "cluster_k5", "cluster_k6"]]
    cluster_payload = {
        "columns": list(cluster_rows.columns),
        "rows": [[None if (isinstance(x, float) and math.isnan(x)) else (bool(x) if isinstance(x, (np.bool_, bool)) else x) for x in r]
                 for r in cluster_rows.itertuples(index=False, name=None)],
        "explained": [float(x) for x in ev[:2]],
        "silhouette": {k: float(v["silhouette"]) for k, v in default["cuts"].items()},
        "groups": {k: v["groups"] for k, v in default["cuts"].items()},
        "features": default["features"],
        "feature_maps": {scope: {"rho": clustering["scopes"][scope]["all"]["feature_rho"],
                                 "order": clustering["scopes"][scope]["all"]["feature_order"],
                                 "cuts": clustering["scopes"][scope]["all"]["feature_cuts"]}
                         for scope in ["ALL", *BATTERIES]},
    }

    payload = {
        "meta": {"commit": manifest["commit"], "repository": manifest["repository"],
                 "observed_sha256": sha256(observed_path), "environment": environment,
                 "verification": verification},
        "batteries": BATTERIES, "features": FEATURES,
        "cycles": cycles, "flagged": flagged,
        "stats": json.loads(stats.to_json(orient="records")),
        "tape": tape,
        "eis": {b: [[float(r.nearest_impedance_offset_hours), int(r.nearest_impedance_after_charge_end), int(r.nearest_impedance_after_discharge_start)]
                    for r in audit[audit.battery_id == b].sort_values("cycle").itertuples()] for b in BATTERIES},
        "summary": json.loads(summary.to_json(orient="records")),
        "quality": json.loads(quality.to_json(orient="records")),
        "recon": json.loads(recon.to_json(orient="records")),
        "temporal": json.loads(temporal.to_json(orient="records")),
        "bins": json.loads(bins.to_json(orient="records")),
        "contracts": {k: contracts[k] for k in ("checks", "snapshot", "raw_metadata", "availability", "mutation_tests")},
        "autocorrelation": prune(json.loads((LEARNING / "autocorrelation.json").read_text()),
                                 {"method", "records", "summary", "caveats", "estimator"}),
        "mutual_information": prune(mi, {"method", "records", "synthetic", "summary", "caveats"}),
        "feature_overlap": prune(json.loads((LEARNING / "feature_overlap.json").read_text()),
                                 {"method", "records", "pairs", "summary", "caveats"}),
        "coverage": prune(json.loads((LEARNING / "coverage.json").read_text()),
                          {"method", "records", "support", "temporal_support", "caveats", "features"}),
        "uncertainty": prune(json.loads((LEARNING / "uncertainty.json").read_text()),
                             {"method", "statistic", "records", "summary", "caveats"}),
        "clusters": cluster_payload,
        "feature_clusters": json.loads(feature_clusters.to_json(orient="records")),
        "clustering_method": clustering["method"], "clustering_caveats": clustering["caveats"],
    }
    # Per-record bulky diagnostics stay in the scientific JSON beside the report.
    for r in payload["uncertainty"]["records"]:
        for k in ("run_lengths", "adf_feature_p", "kpss_feature_p", "adf_capacity_p", "kpss_capacity_p",
                  "pvalue_scope", "audit_id", "seed", "eligible_block_starts_per_run", "pooled_nonoverlapping_blocks",
                  "short_run_pairs_not_stationarity_tested", "bootstrap_replicates"):
            r.pop(k, None)

    payload["examples"] = worked_examples(observed, audit, ops)["examples"]
    return payload, {"observed": observed, "audit": audit, "contracts": contracts, "stats": stats,
                     "changes": changes, "ops": ops, "clustering": clustering}


# ---- tokens: every number quoted in prose is computed here and tagged for verification ---------------
def tokens(payload: dict, src: dict) -> dict:
    observed, audit, contracts, stats, changes = src["observed"], src["audit"], src["contracts"], src["stats"], src["changes"]
    snap, raw = contracts["snapshot"], contracts["raw_metadata"]
    T: dict[str, tuple[float | int | str, str]] = {}

    def put(key, value, text=None):
        T[key] = (value, text if text is not None else (f"{value:,}" if isinstance(value, int) else str(value)))

    n = len(observed)
    put("n_cycles", n)
    put("n_batteries", observed.battery_id.nunique())
    put("n_features", len(FEATURES))
    put("n_raw_discharges", snap["raw_discharge_records"])
    put("n_dropped", snap["raw_discharge_records"] - n)
    put("n_ops", raw["total_raw_operations"])
    kinds = src["ops"].type.value_counts()
    put("n_ops_charge", int(kinds["charge"]))
    put("n_ops_discharge", int(kinds["discharge"]))
    put("n_ops_impedance", int(kinds["impedance"]))
    put("n_flagged", snap["quality_flagged_cycles"])
    put("n_masked_cells", snap["quality_flagged_cycles"] * 4)
    put("n_filled_cells", snap["processed_feature_cells_changed_from_raw"])
    put("eis_after_charge", snap["eis_starts_after_charge_end"])
    put("eis_after_charge_pct", round(100 * snap["eis_starts_after_charge_end"] / n, 1), f"{100 * snap['eis_starts_after_charge_end'] / n:.1f}%")
    put("eis_after_discharge", snap["eis_starts_after_discharge_start"])
    put("eis_after_discharge_pct", round(100 * snap["eis_starts_after_discharge_start"] / n, 1), f"{100 * snap['eis_starts_after_discharge_start'] / n:.1f}%")
    put("n_complete", n - snap["quality_flagged_cycles"])
    cats = pd.Series([c["category"] for c in contracts["checks"]]).value_counts()
    put("n_checks", len(contracts["checks"]))
    put("n_rules", int(cats.get("invariant", 0) + cats.get("raw_invariant", 0) + cats.get("source", 0)))
    put("n_exceptions", int(cats.get("quality_exception", 0)))
    put("n_snapshot", int(cats.get("snapshot_expectation", 0)))
    put("n_mutations", len(contracts["mutation_tests"]))
    put("n_mutations_caught", sum(1 for m in contracts["mutation_tests"] if m["detected"]))
    put("recon_columns", len(payload["recon"]))
    put("recon_mismatches", int(sum(r["mismatch_count_at_1e_8"] for r in payload["recon"])))

    # Spearman ranges between batteries (observed table, per-battery rows)
    per = stats[stats.battery_id != "ALL"]
    for feature in FEATURES:
        sub = per[per.feature == feature].spearman_rho
        put(f"rho_{feature}_min", round(float(sub.min()), 3), f"{sub.min():+.3f}")
        put(f"rho_{feature}_max", round(float(sub.max()), 3), f"{sub.max():+.3f}")
        pooled = float(stats[(stats.battery_id == "ALL") & (stats.feature == feature)].spearman_rho.iloc[0])
        put(f"rho_{feature}_all", round(pooled, 3), f"{pooled:+.3f}")

    # Variance inflation (pooled)
    vif = {r["feature"]: r["vif"] for r in payload["feature_overlap"]["records"] if r["battery_id"] == "ALL"}
    for feature, value in vif.items():
        put(f"vif_{feature}", round(value, 2), f"{value:.1f}")
    cell_vif = [r["vif"] for r in payload["feature_overlap"]["records"] if r["battery_id"] != "ALL" and r["vif"] is not None]
    put("vif_cell_max", round(max(cell_vif), 1), f"{max(cell_vif):.0f}")

    # Autocorrelation of capacity at lag 1
    lag1 = [r for r in payload["autocorrelation"]["records"] if r["feature"] == "capacity" and r["lag"] == 1]
    level = [r["value"] for r in lag1 if r["series"] == "level"]
    diff = [r["value"] for r in lag1 if r["series"] == "difference"]
    put("lag1_level_min", round(min(level), 3), f"{min(level):.3f}")
    put("lag1_level_max", round(max(level), 3), f"{max(level):.3f}")
    put("lag1_diff_min", round(min(diff), 3), f"{min(diff):+.3f}")
    put("lag1_diff_max", round(max(diff), 3), f"{max(diff):+.3f}")

    # Mutual information (k = 5)
    mi5 = [r for r in payload["mutual_information"]["records"] if r["neighbors"] == 5 and r["value"] is not None]
    top = {b: max((r for r in mi5 if r["battery_id"] == b), key=lambda r: r["value"]) for b in BATTERIES}
    assert all(t["feature"] == "t_cc" for t in top.values())
    put("mi_tcc_min", round(min(t["value"] for t in top.values()), 2), f"{min(t['value'] for t in top.values()):.2f}")
    put("mi_tcc_max", round(max(t["value"] for t in top.values()), 2), f"{max(t['value'] for t in top.values()):.2f}")
    put("mi_synthetic", round(payload["mutual_information"]["synthetic"]["mi"], 2), f"{payload['mutual_information']['synthetic']['mi']:.2f}")

    # Uncertainty
    recs = payload["uncertainty"]["records"]
    put("unc_records", len(recs))
    put("unc_conditional", sum(1 for r in recs if r["status"] == "conditional"))
    put("unc_skipped", sum(1 for r in recs if r["status"] == "skipped"))

    # Clusters
    cl = payload["clusters"]
    put("cluster_included", int(sum(1 for r in cl["rows"] if r[3])))
    put("cluster_var2", round(100 * sum(cl["explained"]), 1), f"{100 * sum(cl['explained']):.1f}%")
    put("cluster_sil3", round(cl["silhouette"]["3"], 3), f"{cl['silhouette']['3']:.3f}")
    sizes = [g["n"] for g in cl["groups"]["3"]]
    put("cluster_sizes", "/".join(str(s) for s in sizes), " / ".join(str(s) for s in sizes))

    # Long rests and the capacity change after them
    rests = observed.nlargest(5, "rest_time_hours")[["battery_id", "cycle", "rest_time_hours"]]
    jumps = []
    for r in rests.itertuples():
        cap = observed[(observed.battery_id == r.battery_id)].set_index("cycle").capacity
        jumps.append(float(cap[r.cycle] - cap[r.cycle - 1]))
    put("rest_max", round(float(rests.rest_time_hours.max()), 1), f"{rests.rest_time_hours.max():.1f}")
    put("rest_jump_min", round(min(jumps), 3), f"{min(jumps):+.3f}")
    put("rest_jump_max", round(max(jumps), 3), f"{max(jumps):+.3f}")
    payload["rests"] = [{"battery": r.battery_id, "cycle": int(r.cycle), "rest": float(r.rest_time_hours), "jump": j}
                        for r, j in zip(rests.itertuples(), jumps)]

    # Health range
    put("soh_min", round(float(observed.soh.min()), 1), f"{observed.soh.min():.1f}")
    put("soh_max", round(float(observed.soh.max()), 1), f"{observed.soh.max():.1f}")
    put("above_100", int((observed.soh > 100).sum()))
    put("source_commit", payload["meta"]["commit"][:7])

    # Counts per schedule (B0005 to B0007 share one schedule)
    tape = payload["tape"]
    assert all(tape[b]["counts"] == tape["B0005"]["counts"] for b in ("B0006", "B0007"))
    put("dis_main", tape["B0005"]["counts"]["discharge"])
    put("imp_main", tape["B0005"]["counts"]["impedance"])
    put("dis_b0018", tape["B0018"]["counts"]["discharge"])
    put("imp_b0018", tape["B0018"]["counts"]["impedance"])

    # Levels, trend-removed and change correlations for the two leading charging features
    temporal = pd.DataFrame(payload["temporal"])
    for feature in ("t_cc", "dq_dv_peak"):
        sub = temporal[temporal.feature == feature]
        for tag, column in (("chg", "consecutive_change_spearman"), ("adj", "cycle_adjusted_rank_correlation")):
            put(f"{tag}_{feature}_min", round(float(sub[column].min()), 3), f"{sub[column].min():+.3f}")
            put(f"{tag}_{feature}_max", round(float(sub[column].max()), 3), f"{sub[column].max():+.3f}")
    pair = [p["spearman"] for p in payload["feature_overlap"]["pairs"]
            if p["battery_id"] != "ALL" and {p["feature_a"], p["feature_b"]} == {"t_cc", "dq_dv_peak"}]
    assert len(pair) == 4
    put("pair_tcc_dq_min", round(min(pair), 3), f"{min(pair):+.3f}")
    put("pair_tcc_dq_max", round(max(pair), 3), f"{max(pair):+.3f}")
    return T


# ---- assembly -----------------------------------------------------------------------------------
FIG_RE = re.compile(r'<fig id="([a-z0-9]+)" title="([^"]*)"(?: sub="([^"]*)")?( notwin)? />')


def expand_figures(text: str, language: str = "en") -> str:
    """<fig id=... title=... sub=... /> becomes a titled figure slot that the page script fills."""
    def swap(m):
        fid, title, sub, notwin = m.group(1), m.group(2), m.group(3), m.group(4)
        summary = "Lihat data dalam tabel" if language == "id" else "View the data as a table"
        twin = "" if notwin else (f'<details class="twin"><summary>{summary}</summary>'
                                  '<div class="twin-body"></div></details>')
        return (f'<figure class="fig" id="fig-{fid}" aria-labelledby="fig-{fid}-t"><div class="fig-head">'
                f'<h3 id="fig-{fid}-t">{title}</h3>' + (f"<p>{sub}</p>" if sub else "") +
                '</div><div class="fig-controls"></div><div class="fig-body"></div>'
                '<p class="fig-note" aria-live="polite"></p>' + twin + "</figure>")
    return FIG_RE.sub(swap, text)


def render(template: str, T: dict, language: str = "en") -> str:
    template = expand_figures(template, language)
    def swap(match):
        key = match.group(1)
        if key not in T:
            raise KeyError(f"template uses an undefined token: {key}")
        value, text = T[key]
        if language == "id" and isinstance(value, (int, float, np.integer, np.floating)):
            text = text.translate(str.maketrans({",": ".", ".": ","}))
        return f'<span class="num" data-t="{key}" data-v="{value}">{text}</span>'
    return re.sub(r"\{\{([A-Za-z0-9_]+)\}\}", swap, template)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lang", choices=("en", "id"), default="en", help="Language of the standalone HTML")
    args = parser.parse_args()
    language = args.lang
    content_root = ROOT / "id" if language == "id" else ROOT
    payload, src = load_payload()
    T = tokens(payload, src)
    payload["tokens"] = {k: v[0] for k, v in T.items()}
    data = json.dumps(clean(payload), separators=(",", ":"), allow_nan=False).replace("<", "\\u003c")

    template = (content_root / "template.html").read_text()
    license_text = (ANALYSIS / "learning" / "assets" / "OFL.txt").read_text()
    assert "*/" not in license_text
    css = "/* Manrope font license\n" + license_text + "\n*/\n" + (ROOT / "style.css").read_text()
    for subset in ("latin", "greek"):
        encoded = base64.b64encode((ANALYSIS / "learning" / "assets" / f"manrope-{subset}.woff2").read_bytes()).decode()
        css = css.replace(f'url("assets/manrope-{subset}.woff2")', f'url("data:font/woff2;base64,{encoded}")')

    html = render(template, T, language)
    html = html.replace("/*__STYLE__*/", css)
    html = html.replace("/*__DATA__*/", "const DATA=" + data + ";")
    parts = [part.read_text() for part in sorted((content_root / "js").glob("*.js"))]
    if language == "id":
        translations = json.loads((content_root / "data-translations.json").read_text())
        assert all(c["description"] in translations and c["check"] in translations for c in payload["contracts"]["checks"]), "Missing Indonesian contract translation"
        text_data = json.dumps(translations, ensure_ascii=False).replace("<", "\\u003c")
        parts.insert(0, "const UI_TEXT=" + text_data + ";\nconst translateText=(text)=>UI_TEXT[text] ?? text;")
    app = "(() => {\n'use strict';\n" + "\n".join(parts) + "\n})();"
    html = html.replace("/*__APP__*/", app)
    leftover = re.findall(r"\{\{[^}]*\}\}", html)
    assert not leftover, f"unresolved template tokens: {leftover[:5]}"
    WEB.mkdir(parents=True, exist_ok=True)
    out = WEB / ("index-id.html" if language == "id" else "index.html")
    out.write_text(html, encoding="utf-8")
    print(f"Built {out} ({len(html.encode()):,} bytes; data {len(data.encode()):,} bytes; "
          f"{len(payload['examples'])} worked examples; {len(T)} traced numbers)")


if __name__ == "__main__":
    main()
