"""Reproduce an exploratory audit of the pinned SoC_BatteryHealthAI dataset.

No predictive model is fitted. Original source files and CSV are kept intact.
Run: python Code/analysis/run_eda.py
"""
from __future__ import annotations

import hashlib
import html
import importlib.metadata
import json
from pathlib import Path
import sys
import urllib.request

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats
from scipy.integrate import trapezoid
from scipy.io import loadmat

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
SOURCE = REPO
OUT = REPO / "Reports"
WEB = REPO / "Web" / "HTML"
FIG = OUT / "figures"
BATTERIES = ["B0005", "B0006", "B0007", "B0018"]
FEATURES = ["t_cc", "t_cv", "dq_dv_peak", "v_at_peak", "delta_T_max",
            "delta_V_ohmic", "Re", "Rct", "rest_time_hours"]
CHARGE_FEATURES = FEATURES[:4]
LABELS = {
    "t_cc": "CC charge duration (s)", "t_cv": "CV charge duration (s)",
    "dq_dv_peak": "Incremental-capacity peak (Ah/V)", "v_at_peak": "Peak voltage (V)",
    "delta_T_max": "Discharge temperature rise (°C)",
    "delta_V_ohmic": "Initial discharge voltage drop (V)",
    "Re": "Electrolyte resistance (Ω)", "Rct": "Charge-transfer resistance (Ω)",
    "rest_time_hours": "Interval between discharges (h)",
}
COLORS = dict(zip(BATTERIES, ["#2671bb", "#d47717", "#28967b", "#a05db5"]))


def ensure_sources():
    manifest = json.loads((ROOT / "source_manifest.json").read_text())
    for record in manifest["files"]:
        path = SOURCE / record["path"]
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(record["url"], timeout=120) as response:
                data = response.read()
            if hashlib.sha256(data).hexdigest() != record["sha256"]:
                raise ValueError(f"Downloaded checksum mismatch: {path}")
            path.write_bytes(data)
        if hashlib.sha256(path.read_bytes()).hexdigest() != record["sha256"]:
            raise ValueError(f"Source checksum mismatch: {path}")
    return manifest


def correlation(x, y, method="spearman"):
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    keep = np.isfinite(x) & np.isfinite(y)
    x, y = x[keep], y[keep]
    if len(x) < 3 or len(np.unique(x)) < 2 or len(np.unique(y)) < 2:
        return np.nan, len(x)
    fn = stats.spearmanr if method == "spearman" else stats.pearsonr
    return float(fn(x, y).statistic), len(x)


def audit_raw(loader, extractor):
    frames, audit_rows, operation_rows = [], [], []
    for battery in BATTERIES:
        cycles = loader.load_and_align_battery(battery, drop_cycle_1=True)
        frames.append(extractor.extract_features_dataframe(cycles))
        mat = loadmat(SOURCE / "data/raw" / f"{battery}.mat")
        raw_ops = mat[battery]["cycle"][0, 0][0]
        ops = []
        for i, raw_op in enumerate(raw_ops):
            data = raw_op["data"][0, 0]
            typ = str(raw_op["type"][0])
            start = pd.Timestamp(loader.parse_time_vector(raw_op["time"][0]))
            time = np.asarray(data["Time"]).ravel().astype(float) if "Time" in data.dtype.names else np.array([])
            op = {"id": i, "type": typ, "start": start, "data": data,
                  "end": start + pd.Timedelta(seconds=float(time[-1])) if len(time) else None}
            ops.append(op)
            signals = [np.asarray(data[k]).ravel().astype(float)
                       for k in ["Voltage_measured", "Current_measured", "Temperature_measured"]
                       if k in data.dtype.names]
            operation_rows.append({"battery_id": battery, "operation_id": i,
                "type": typ, "start": start, "end": op["end"], "sample_count": len(time),
                "nonincreasing_time_steps": int(np.sum(np.diff(time) <= 0)),
                "nonfinite_time_samples": int(np.sum(~np.isfinite(time))),
                "nonfinite_signal_samples": sum(int(np.sum(~np.isfinite(s))) for s in signals),
                "signal_length_mismatches": sum(int(len(s) != len(time)) for s in signals),
                "max_sample_gap_seconds": float(np.diff(time).max()) if len(time) > 1 else np.nan,
                "ambient_temperature_c": float(np.asarray(raw_op["ambient_temperature"]).ravel()[0])})
        impedance = [o for o in ops if o["type"] == "impedance"
                     and all(k in o["data"].dtype.names and np.isfinite(float(o["data"][k][0, 0]))
                             for k in ["Re", "Rct"])]
        discharges = [o for o in ops if o["type"] == "discharge"]
        included = {c.cycle_index for c in cycles}
        for cycle_num, op in enumerate(discharges, 1):
            if cycle_num not in included:
                continue
            charge = next(o for o in reversed(ops[:op["id"]]) if o["type"] == "charge")
            near = min(impedance, key=lambda o: abs((o["start"]-op["start"]).total_seconds())) if impedance else None
            prior = [o for o in impedance if o["start"] <= charge["end"]]
            latest = max(prior, key=lambda o: o["start"]) if prior else None
            dis = op["data"]
            t = np.asarray(dis["Time"]).ravel().astype(float)
            v = np.asarray(dis["Voltage_measured"]).ravel().astype(float)
            current = np.asarray(dis["Current_measured"]).ravel().astype(float)
            q_full = float(trapezoid(np.maximum(-current, 0), t) / 3600)
            # Diagnostic only: NASA describes Capacity using a 2.7 V endpoint.
            # Interpolate the first crossing after discharge load begins.
            loaded = np.flatnonzero(current <= -1)
            crossing = np.flatnonzero((v <= 2.7) & (np.arange(len(v)) >= (loaded[0] if len(loaded) else 0)))
            q_27 = np.nan
            if len(crossing) and crossing[0] > 0:
                j = int(crossing[0]); frac = (v[j-1]-2.7)/(v[j-1]-v[j]) if v[j-1] != v[j] else 1
                tc = t[j-1]+frac*(t[j]-t[j-1]); ic = current[j-1]+frac*(current[j]-current[j-1])
                q_27 = float(trapezoid(np.maximum(-np.r_[current[:j], ic], 0), np.r_[t[:j], tc])/3600)
            ch = charge["data"]
            ch_v = np.asarray(ch["Voltage_measured"]).ravel().astype(float)
            ch_i = np.asarray(ch["Current_measured"]).ravel().astype(float)
            ch_t = np.asarray(ch["Time"]).ravel().astype(float)
            measured_capacity = float(dis["Capacity"][0, 0])
            row = {"battery_id": battery, "cycle": cycle_num,
                "charge_operation_id": charge["id"], "discharge_operation_id": op["id"],
                "charge_end": charge["end"], "discharge_start": op["start"],
                "nearest_impedance_start": near["start"] if near else pd.NaT,
                "nearest_impedance_after_charge_end": near["start"] > charge["end"] if near else False,
                "nearest_impedance_after_discharge_start": near["start"] > op["start"] if near else False,
                "nearest_impedance_offset_hours": (near["start"]-op["start"]).total_seconds()/3600 if near else np.nan,
                "prior_impedance_age_hours_at_charge_end": (charge["end"]-latest["start"]).total_seconds()/3600 if latest else np.nan,
                "Re_prior": float(latest["data"]["Re"][0, 0]) if latest else np.nan,
                "Rct_prior": float(latest["data"]["Rct"][0, 0]) if latest else np.nan,
                "charge_duration_hours": (charge["end"]-charge["start"]).total_seconds()/3600,
                "post_charge_gap_hours": (op["start"]-charge["end"]).total_seconds()/3600,
                "charge_reaches_4_2v": bool(np.any(ch_v >= 4.2)),
                "charge_voltage_decreases": int(np.sum(np.diff(ch_v) < 0)),
                "ohmic_preload_sample_available": bool(len(loaded) and loaded[0] > 0),
                "capacity_ah": measured_capacity, "integrated_full_discharge_ah": q_full,
                "integrated_to_2_7v_ah": q_27,
                "full_integral_minus_label_ah": q_full-measured_capacity,
                "integral_2_7v_minus_label_ah": q_27-measured_capacity,
                "discharge_min_voltage_v": float(v.min()),
                "discharge_load_current_median_a": float(np.median(current[current <= -1])) if len(loaded) else np.nan,
                "charge_current_median_a": float(np.median(ch_i[ch_i >= .5])) if np.any(ch_i >= .5) else np.nan,
                "charge_time_nonincreasing_steps": int(np.sum(np.diff(ch_t) <= 0)),
                "discharge_time_nonincreasing_steps": int(np.sum(np.diff(t) <= 0)),
                "timestamp_precedes_previous_operation": bool(op["id"] and op["start"] < ops[op["id"]-1]["start"])}
            for bin_mv in [5, 20]:
                variant = type(extractor)(ic_bin_mv=bin_mv)
                amp, peak = variant.compute_incremental_capacity(ch_v, ch_i, ch_t)
                row[f"dq_dv_peak_bin_{bin_mv}mv"] = amp
                row[f"v_at_peak_bin_{bin_mv}mv"] = peak
            audit_rows.append(row)
        print(f"Re-extracted {battery}: {len(cycles)} aligned cycles", flush=True)
    return pd.concat(frames, ignore_index=True), pd.DataFrame(audit_rows), pd.DataFrame(operation_rows)


def make_correlations(versions):
    rows = []
    for version, df in versions.items():
        for group in ["ALL"] + BATTERIES:
            g = df if group == "ALL" else df[df.battery_id == group]
            for feature in FEATURES:
                r, n = correlation(g[feature], g.capacity, "pearson")
                rho, _ = correlation(g[feature], g.capacity)
                rows.append({"version": version, "battery_id": group, "feature": feature,
                             "n_pairs": n, "pearson_r": r, "spearman_rho": rho})
    return pd.DataFrame(rows)


def temporal_diagnostics(df):
    rows = []
    for battery in BATTERIES:
        g = df[df.battery_id == battery].sort_values("cycle")
        for feature in FEATURES:
            h = g[["cycle", feature, "capacity"]].dropna()
            # Rank residualization on cycle rank: diagnostic, not causal adjustment.
            partial = np.nan
            if len(h) >= 5 and h[feature].nunique() > 1:
                z = np.c_[np.ones(len(h)), stats.rankdata(h.cycle)]
                x, y = stats.rankdata(h[feature]), stats.rankdata(h.capacity)
                rx = x-z@np.linalg.lstsq(z, x, rcond=None)[0]
                ry = y-z@np.linalg.lstsq(z, y, rcond=None)[0]
                partial = correlation(rx, ry, "pearson")[0]
            # Difference on the full cycle index, so excluded rows do not bridge gaps.
            d = g[["cycle", feature, "capacity"]].set_index("cycle").diff()
            rho_delta, n_delta = correlation(d[feature], d.capacity)
            rows.append({"battery_id": battery, "feature": feature,
                "n_level_pairs": len(h),
                "feature_vs_cycle_spearman": correlation(h[feature], h.cycle)[0],
                "capacity_vs_cycle_spearman": correlation(h.capacity, h.cycle)[0],
                "cycle_adjusted_rank_correlation": partial,
                "consecutive_change_spearman": rho_delta, "n_change_pairs": n_delta})
    return pd.DataFrame(rows)


def save_figure(fig, name):
    fig.savefig(FIG / f"{name}.png", dpi=160, bbox_inches="tight", facecolor="white")
    fig.savefig(FIG / f"{name}.svg", bbox_inches="tight", facecolor="white")
    plt.close(fig)


def plots(df, audit, correlations, temporal):
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False,
        "axes.spines.right": False, "axes.grid": True, "grid.alpha": .16,
        "axes.titleweight": "bold", "figure.constrained_layout.use": True})
    fig, axes = plt.subplots(2, 2, figsize=(11, 7), sharey=True)
    for ax, battery in zip(axes.flat, BATTERIES):
        g = df[df.battery_id == battery]
        ax.plot(g.cycle, g.capacity, color=COLORS[battery], lw=1.4)
        ax.scatter(g.cycle, g.capacity, color=COLORS[battery], s=9)
        ax.set(title=f"{battery} · {len(g)} cycles", xlabel="Discharge cycle", ylabel="Capacity (Ah)")
        ax.secondary_yaxis("right", functions=(lambda q: q*50, lambda s: s/50)).set_ylabel("SoH (%)")
    fig.suptitle("Measured capacity over battery life · 2 Ah SoH reference", fontsize=14)
    save_figure(fig, "01_capacity_trajectories")

    fig, axes = plt.subplots(3, 3, figsize=(13, 11))
    for ax, feature in zip(axes.flat, FEATURES):
        for battery in BATTERIES:
            g = df[df.battery_id == battery]
            ax.scatter(g[feature], g.capacity, s=12, alpha=.65, color=COLORS[battery], label=battery)
        ax.set(xlabel=LABELS[feature], ylabel="Capacity (Ah)")
        if feature == "rest_time_hours":
            ax.set_xscale("symlog", linthresh=5)
            ax.set_xlabel(LABELS[feature]+" · symlog")
    axes.flat[0].legend(fontsize=8)
    fig.suptitle("Feature–capacity relationships · flagged charge values omitted", fontsize=14)
    save_figure(fig, "02_feature_scatter_all_batteries")

    for battery in BATTERIES:
        g = df[df.battery_id == battery]
        fig, axes = plt.subplots(3, 3, figsize=(12, 10))
        for ax, feature in zip(axes.flat, FEATURES):
            rho, n = correlation(g[feature], g.capacity)
            ax.scatter(g[feature], g.capacity, c=g.cycle, cmap="viridis", s=16, alpha=.75)
            ax.set(xlabel=LABELS[feature], ylabel="Capacity (Ah)",
                   title=f"ρ = {rho:+.2f} · n = {n}" if np.isfinite(rho) else f"Undefined · n = {n}")
            if feature == "rest_time_hours": ax.set_xscale("symlog", linthresh=5)
        fig.suptitle(f"{battery} · each dot is a cycle · purple = earlier, yellow = later", fontsize=13)
        save_figure(fig, f"scatter_{battery}")

    c = correlations[correlations.version == "observed_flagged"]
    matrix = c.pivot(index="feature", columns="battery_id", values="spearman_rho").reindex(index=FEATURES, columns=BATTERIES+["ALL"])
    fig, ax = plt.subplots(figsize=(8, 6))
    im = ax.imshow(matrix.values, vmin=-1, vmax=1, cmap="RdBu_r", aspect="auto")
    for i in range(len(FEATURES)):
        for j in range(5):
            val = matrix.iloc[i,j]
            ax.text(j, i, f"{val:+.2f}" if np.isfinite(val) else "n/a", ha="center", va="center",
                    color="white" if abs(val) > .65 else "#18212d", fontsize=11)
    ax.set_xticks(range(5), BATTERIES+["Pooled"])
    ax.set_yticks(range(len(FEATURES)), FEATURES)
    ax.grid(False)
    ax.set_title("Spearman association with capacity\nFlagged charge values omitted; Re / Rct use nearest EIS", pad=15)
    fig.colorbar(im, ax=ax, label="Spearman ρ", shrink=.8)
    save_figure(fig, "03_spearman_by_battery")

    fig, axes = plt.subplots(3, 3, figsize=(13, 10))
    for ax, feature in zip(axes.flat, FEATURES):
        for battery in BATTERIES:
            g = df[df.battery_id == battery]
            ax.plot(g.cycle, g[feature], lw=1, color=COLORS[battery], label=battery)
        ax.set(xlabel="Discharge cycle", ylabel=LABELS[feature])
        if feature == "rest_time_hours": ax.set_yscale("symlog", linthresh=5)
    axes.flat[0].legend(fontsize=8)
    fig.suptitle("Feature trajectories · gaps preserve flagged measurements", fontsize=14)
    save_figure(fig, "04_feature_trajectories")

    fig, axes = plt.subplots(1, 2, figsize=(11, 5), sharey=True)
    for ax, col, title in zip(axes, ["spearman_rho", "consecutive_change_spearman"],
            ["Relationship in feature levels", "Relationship in cycle-to-cycle changes"]):
        if col == "spearman_rho":
            m = c[c.battery_id != "ALL"].pivot(index="feature", columns="battery_id", values=col)
        else: m = temporal.pivot(index="feature", columns="battery_id", values=col)
        m = m.reindex(index=FEATURES, columns=BATTERIES)
        im = ax.imshow(m, vmin=-1, vmax=1, cmap="RdBu_r", aspect="auto")
        for i in range(len(FEATURES)):
            for j in range(4):
                val = m.iloc[i,j]
                ax.text(j, i, f"{val:+.2f}" if np.isfinite(val) else "n/a", ha="center", va="center",
                        fontsize=9, color="white" if abs(val) > .65 else "#18212d")
        ax.set_xticks(range(4), BATTERIES, rotation=30)
        ax.set_yticks(range(len(FEATURES)), FEATURES)
        ax.set_title(title); ax.grid(False)
    fig.suptitle("Shared aging trends can strengthen apparent relationships", fontsize=13)
    fig.colorbar(im, ax=axes, shrink=.8, label="Spearman ρ")
    save_figure(fig, "05_levels_vs_changes")

    rows = []
    for battery in BATTERIES:
        g = df[df.battery_id == battery]
        matrix = g[FEATURES].corr(method="spearman")
        for i, a in enumerate(FEATURES):
            for b in FEATURES[i+1:]:
                valid = g[[a,b]].dropna()
                rows.append({"battery_id": battery,"feature_a": a,"feature_b": b,
                    "spearman_rho": matrix.loc[a,b],"n_pairs": len(valid)})
    pd.DataFrame(rows).to_csv(OUT / "feature_redundancy.csv", index=False)


def finding_paragraphs(corr, temporal, summary, audit):
    c = corr[(corr.version == "observed_flagged") & (corr.battery_id != "ALL")]
    def bounds(feature, column="spearman_rho"):
        s = c.loc[c.feature == feature, column]
        return f"{s.min():+.3f} to {s.max():+.3f}"
    future_dis = int(audit.nearest_impedance_after_discharge_start.sum())
    future_charge = int(audit.nearest_impedance_after_charge_end.sum())
    flags = sum(s["charge_quality_flag_count"] for s in summary)
    return [
        f"1. **Charging duration and incremental-capacity peak are the clearest candidates for further validation.** Per-battery Spearman ρ: t_cc {bounds('t_cc')}; dq_dv_peak {bounds('dq_dv_peak')}. The peak's capacity association remains strong with 5, 10 and 20 mV bins. This does not establish generalization to new cells or other operating conditions.", "",
        "2. **The two leading charge features are redundant.** Their within-battery Spearman association is +0.932 to +0.996. Later validation should compare each alone and together rather than assume both add independent information.", "",
        "3. **Aging trends account for part of the apparent association.** Correlation of consecutive changes falls to +0.075–+0.361 for t_cc and +0.475–+0.633 for dq_dv_peak. Rank residualization on cycle retains positive associations for both. These are different descriptive diagnostics, not proof of a mechanism.", "",
        f"4. **CV duration and peak position associate negatively with capacity.** Per-battery ρ: t_cv {bounds('t_cv')}; v_at_peak {bounds('v_at_peak')}. This is an observed direction; coefficients should not be forced to an assumed sign.", "",
        f"5. **The current interval feature is inconsistent.** rest_time_hours has per-battery ρ {bounds('rest_time_hours')}. It includes charging time. This result cannot establish that actual idle rest has no relationship to capacity recovery.", "",
        f"6. **Five charge cycles require flags, not hidden repairs.** The source pipeline fills t_cc, t_cv and dq_dv_peak in {flags} cycles: B0005/6/7 cycle 31; B0018 cycles 46 and 56. The sequential cleaning loop leaves the fallback v_at_peak = 4 V unchanged in those cycles. Primary plots omit all four affected charge measurements and retain the capacity labels.", "",
        f"7. **Impedance alignment uses future information.** Of 632 rows, {future_dis} ({future_dis/632:.1%}) select an EIS start after discharge starts, and {future_charge} ({future_charge/632:.1%}) select an EIS start after charging ends. A prior-start alternative is exported with missing values preserved. Impedance completion times still need verification.", "",
        "8. **Discharge temperature and voltage-drop associations are strong but timing-dependent.** They cannot be inputs for an end-of-charge prediction. The temperature feature requires the complete discharge; the voltage drop requires the initial load step.", "",
        "**Before training:** validate t_cc and dq_dv_peak against raw waveforms, repair the quality flags and prediction-time alignment, define actual idle rest, and establish new validation data. Keep the current findings exploratory.",
    ]


def make_html(versions, corr, temporal, summary, audit, manifest):
    payload = {
        "versions": {name: json.loads(frame[["battery_id", "cycle", "capacity"]+FEATURES].to_json(orient="records", double_precision=6))
                     for name, frame in versions.items()},
        "correlations": json.loads(corr.to_json(orient="records", double_precision=6)),
        "labels": LABELS, "colors": COLORS,
    }
    primary = corr[corr.version == "observed_flagged"]
    table = primary.pivot(index="feature", columns="battery_id", values="spearman_rho").reindex(index=FEATURES, columns=BATTERIES+["ALL"])
    rows = []
    for feature, row in table.iterrows():
        cells = "".join(f'<td>{value:+.3f}</td>' for value in row)
        rows.append(f'<tr><th scope="row">{html.escape(feature)}</th>{cells}</tr>')
    coverage = "".join(f'<tr><th scope="row">{r["battery_id"]}</th><td>{r["n_cycles"]}</td><td>{r["capacity_min_ah"]:.3f}–{r["capacity_max_ah"]:.3f}</td><td>{r["charge_quality_flag_count"]}</td></tr>' for r in summary)
    content = (ROOT / "report_template.html").read_text()
    replacements = {"__DATA__": json.dumps(payload, separators=(",", ":")).replace("<", "\\u003c"),
        "__ROWS__":"".join(rows),"__COVERAGE__":coverage,
        "__COMMIT__":manifest["commit"],
        "__FUTURE_DIS__":str(int(audit.nearest_impedance_after_discharge_start.sum())),
        "__FUTURE_CHARGE__":str(int(audit.nearest_impedance_after_charge_end.sum()))}
    for key, value in replacements.items(): content = content.replace(key, value)
    WEB.mkdir(parents=True, exist_ok=True)
    (WEB / "report.html").write_text(content)


def make_report(df, raw, existing, audit, ops, corr, temporal, summary, manifest):
    primary = corr[corr.version == "observed_flagged"]
    table = primary.pivot(index="feature", columns="battery_id", values="spearman_rho").reindex(index=FEATURES, columns=BATTERIES+["ALL"])
    table = table.rename(columns={"ALL":"Pooled"})
    md = ["# Early battery data analysis", "",
        f"Source commit: `{manifest['commit']}`. All four batteries are exploratory; there is no untouched test set in this analysis.", "",
        "No predictive models were trained. Each row is one aligned discharge cycle. The raw files contain 636 discharges; the source loader excludes the first discharge of each battery, leaving 632 aligned cycles. This analysis preserves those 632 rows. The label is measured capacity in Ah. SoH = capacity / 2 Ah × 100, so Pearson and Spearman correlations are identical for either label.", "",
        "## Main findings", "", *finding_paragraphs(corr, temporal, summary, audit), "",
        "## Dataset coverage", "",
        "| Battery | Cycles | Capacity range (Ah) | SoH range (%) | Flagged charge cycles | Nearest EIS starts after discharge |",
        "|---|---:|---:|---:|---:|---:|"]
    for row in summary:
        md.append(f"| {row['battery_id']} | {row['n_cycles']} | {row['capacity_min_ah']:.3f}–{row['capacity_max_ah']:.3f} | {row['soh_min_percent']:.1f}–{row['soh_max_percent']:.1f} | {row['charge_quality_flag_count']} | {row['future_impedance_at_discharge_count']} |")
    md += ["", "## Feature–label relationships", "",
        "Spearman correlations below use re-extracted features with flagged charge values omitted, without interpolation. EIS correlations here reproduce nearest-sweep alignment and are descriptive only: some measurements start in the future. Use `prior_impedance` in the CSV for a timing-aware alternative. The interval feature includes charging time.", "",
        "| Feature | B0005 | B0006 | B0007 | B0018 | Pooled |", "|---|---:|---:|---:|---:|---:|"]
    for feature, row in table.iterrows():
        md.append("| "+feature+" | "+" | ".join(f"{x:+.3f}" if np.isfinite(x) else "n/a" for x in row)+" |")
    md += ["", "Positive values mean higher feature values accompany higher capacity. Negative values mean they accompany lower capacity. Neither proves causation or out-of-battery predictive value.", "",
        "![Capacity trajectories](figures/01_capacity_trajectories.png)", "",
        "![Feature–capacity scatter plots](figures/02_feature_scatter_all_batteries.png)", "",
        "![Per-battery correlations](figures/03_spearman_by_battery.png)", "",
        "![Levels versus consecutive changes](figures/05_levels_vs_changes.png)", "",
        "## Audit and limitations", "",
        "- Source CSV and re-extracted values are retained separately. The primary observed version masks all four charge features when original t_cc < 100 s or original dq_dv_peak < 0.1 Ah/V. These are the repository's screening thresholds, used as flags rather than proven error labels. No rows or target labels are deleted, no imputation is applied, and pair counts are exported.",
        f"- The operation audit found {int(ops.nonfinite_signal_samples.sum())} non-finite sensor values in one extra B0018 charging operation (operation_id 114, zero-based). That charge is followed by another charge and is not selected for any aligned cycle. Selected charge/discharge records have finite sensor values, matching array lengths, and increasing sample times. No raw values were repaired.",
        "- The repository's cleaning loop recomputes its invalid mask after each column. This can leave v_at_peak unchanged after an earlier dq_dv_peak replacement clears the condition. `csv_reconstruction_checks.csv` records exact reproduction of the sequential loop; `feature_changes.csv` records all changed feature cells relative to raw extraction.",
        "- All available batteries were inspected. Their labels must not subsequently be presented as an untouched test set after selecting features from this report. Obtain an external holdout, or report development results honestly and use nested group evaluation for further selection.",
        "- Cycles from one battery are temporally dependent. No naive independent-row p-values or confidence intervals are reported. Only four cells are available, and pooled results can obscure cell-specific behavior. Operating conditions are exported in the audit but no multivariable adjustment for temperature/current/protocol has been performed.",
        "- B0006 reaches 101.26% SoH with the rated 2 Ah denominator. Values above 100% are retained: rated capacity is a reference and may be lower than an individual measured capacity. Do not automatically clip them.",
        "- Full-discharge temperature rise is available after discharge. The voltage-drop feature becomes available after discharge load application. Both are unavailable for an end-of-charge prediction. Capacity itself is a label and must not be used as a predictor of SoH.",
        "- The nearest impedance sweep is chosen using the discharge start timestamp and can be in the future. Future-start counts are definite unavailability cases. Even a past start does not establish sweep completion: impedance end timestamps are unavailable here. The prior-start alternative is a diagnostic, not a certified online-ready feature.",
        "- The feature called rest_time_hours includes intervening charge time. The post-charge gap exported by the audit can include other operations; it is not automatically pure idle rest either.",
        "- Capacity integration is a diagnostic. The supplied label is compared with both full-record integration and integration to an interpolated 2.7 V crossing, when present. Endpoint and sampling conventions can cause differences; labels are not replaced.",
        "- Cycle-adjusted rank correlation removes a linear relationship with cycle ranks only. It does not remove every aging trend or establish causation. Consecutive differences amplify noise and answer a different question from long-term feature levels.",
        "- Peak extraction sorts by voltage after integrating in time. Small voltage reversals and the smoothing/bin-width choices can affect peaks. A 5/10/20 mV sensitivity comparison is exported, but electrochemical peak identity has not been validated.", "",
        "## Files and method", "",
        "- `correlations.csv`: Pearson and Spearman, valid pair counts, four data versions, per battery and pooled. Versions: repository_csv; raw_extracted; observed_flagged; prior_impedance (flagged charge values plus latest EIS starting by charge end).",
        "- `cycles_observed_flagged.csv`: primary exploratory table; original CSV is in ../data/.",
        "- `raw_cycle_audit.csv` and `operations.csv`: raw alignment timestamps, operating conditions, integration checks, extraction diagnostics, and alternate bin widths.",
        "- `data_quality.csv`, `battery_summary.csv`, `feature_changes.csv`, and `csv_reconstruction_checks.csv`: quality, coverage, replacements and reproduction checks.",
        "- `temporal_diagnostics.csv`: feature/capacity trends with cycle, rank residualization, and consecutive-change association.",
        "- `feature_redundancy.csv`: pairwise feature correlations within each battery.",
        "- `peak_bin_sensitivity.csv`: peak correlations with capacity and rank stability versus the 10 mV extraction.",
        "- `figures/`: PNG and SVG plots, including separate scatter grids for every battery.", "",
        "Reproduce with the pinned dependencies in ../Code/analysis/requirements.txt and `python Code/analysis/run_eda.py` from the project root. Missing raw files are downloaded from the pinned GitHub URLs and checked against SHA-256 hashes in ../Code/analysis/source_manifest.json.", "",
        "References: [source repository](https://github.com/Marsel204/SoC_BatteryHealthAI/tree/"+manifest['commit']+"); [NASA field documentation](https://data.nasa.gov/dataset/li-ion-battery-aging-datasets); [Pearson](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.pearsonr.html); [Spearman](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.spearmanr.html).", ""]
    (OUT / "report.md").write_text("\n".join(md))


def main():
    OUT.mkdir(parents=True, exist_ok=True); FIG.mkdir(exist_ok=True)
    manifest = ensure_sources()
    sys.path.insert(0, str(SOURCE))
    from src.data_loader import NASADataLoader
    from src.feature_engineering import PhysicsFeatureExtractor
    existing = pd.read_csv(SOURCE / "data/features_all_batteries.csv")
    raw, audit, ops = audit_raw(NASADataLoader(str(SOURCE / "data/raw")), PhysicsFeatureExtractor())
    keys = ["battery_id", "cycle"]
    existing = existing.sort_values(keys).reset_index(drop=True)
    raw = raw.sort_values(keys).reset_index(drop=True)
    assert not existing.duplicated(keys).any() and not raw.duplicated(keys).any()
    assert existing[keys].equals(raw[keys]), "CSV/raw cycle keys disagree"
    assert np.allclose(existing.capacity, raw.capacity, rtol=0, atol=1e-10)
    assert np.allclose(existing.soh, existing.capacity*50, rtol=0, atol=1e-10)
    # Reproduce exactly, including the sequential invalid-mask recomputation.
    reconstructed = raw.copy()
    for battery in BATTERIES:
        ix = reconstructed.battery_id == battery
        g = reconstructed.loc[ix].copy()
        for col in CHARGE_FEATURES:
            invalid = (g.t_cc < 100) | (g.dq_dv_peak < .1)
            g.loc[invalid, col] = np.nan
            g[col] = g[col].interpolate(method="linear").bfill().ffill()
        reconstructed.loc[ix, CHARGE_FEATURES] = g[CHARGE_FEATURES]
    checks, changed = [], []
    for col in FEATURES+["capacity", "soh"]:
        delta = np.abs(existing[col]-reconstructed[col])
        checks.append({"column": col,"max_abs_csv_vs_reconstructed": delta.max(),
            "mismatch_count_at_1e_8": int((delta > 1e-8).sum())})
        for i in np.flatnonzero(~np.isclose(raw[col], existing[col], rtol=1e-10, atol=1e-9)):
            changed.append({"battery_id": raw.at[i,"battery_id"],"cycle": int(raw.at[i,"cycle"]),
                "feature": col,"raw_value": raw.at[i,col],"repository_csv_value": existing.at[i,col]})
    assert all(c["mismatch_count_at_1e_8"] == 0 for c in checks), "Processed CSV not reproducible"
    pd.DataFrame(checks).to_csv(OUT / "csv_reconstruction_checks.csv", index=False)
    pd.DataFrame(changed).to_csv(OUT / "feature_changes.csv", index=False)
    observed = raw.copy()
    flag = (raw.t_cc < 100) | (raw.dq_dv_peak < .1)
    observed.loc[flag, CHARGE_FEATURES] = np.nan
    observed["charge_quality_flag"] = flag
    audit = audit.merge(raw[keys+["t_cc","dq_dv_peak","v_at_peak"]], on=keys, validate="one_to_one")
    prior = observed.merge(audit[keys+["Re_prior","Rct_prior"]], on=keys, validate="one_to_one")
    prior["Re"], prior["Rct"] = prior.Re_prior, prior.Rct_prior
    corr = make_correlations({"repository_csv":existing,"raw_extracted":raw,
                              "observed_flagged":observed,"prior_impedance":prior})
    temporal = temporal_diagnostics(observed)
    quality = []
    summary = []
    for battery in BATTERIES:
        g = observed[observed.battery_id == battery]
        a = audit[audit.battery_id == battery]
        for col in FEATURES+["capacity","soh"]:
            vals = g[col]
            quality.append({"battery_id":battery,"column":col,"n_rows":len(g),
                "missing_or_masked_count":int(vals.isna().sum()),
                "nonfinite_present_count":int((~np.isfinite(vals[vals.notna()])).sum()),
                "zero_count":int(vals.eq(0).sum()),"unique_valid_values":int(vals.nunique()),
                "min":vals.min(),"median":vals.median(),"max":vals.max()})
        summary.append({"battery_id":battery,"n_cycles":len(g),
            "first_cycle":int(g.cycle.min()),"last_cycle":int(g.cycle.max()),
            "capacity_min_ah":float(g.capacity.min()),"capacity_max_ah":float(g.capacity.max()),
            "soh_min_percent":float(g.soh.min()),"soh_max_percent":float(g.soh.max()),
            "charge_quality_flag_count":int(g.charge_quality_flag.sum()),
            "future_impedance_at_charge_end_count":int(a.nearest_impedance_after_charge_end.sum()),
            "future_impedance_at_discharge_count":int(a.nearest_impedance_after_discharge_start.sum()),
            "charge_below_4_2v_count":int((~a.charge_reaches_4_2v).sum()),
            "capacity_increases_count":int((g.capacity.diff() > 0).sum()),
            "max_capacity_increase_ah":float(g.capacity.diff().max()),
            "full_integral_median_abs_error_ah":float(a.full_integral_minus_label_ah.abs().median()),
            "integral_2_7v_median_abs_error_ah":float(a.integral_2_7v_minus_label_ah.abs().median()),
            "unique_nearest_Re":int(g.Re.nunique()),"unique_nearest_Rct":int(g.Rct.nunique())})
    peak_rows = []
    for battery in BATTERIES:
        a = audit[audit.battery_id == battery]
        good = (a.t_cc >= 100) & (a.dq_dv_peak >= .1)
        a = a[good]
        for feature in ["dq_dv_peak","v_at_peak"]:
            for bins in [5,10,20]:
                values = a[feature if bins == 10 else f"{feature}_bin_{bins}mv"]
                rho, n = correlation(values, a.capacity_ah)
                peak_rows.append({"battery_id":battery,"feature":feature,"bin_width_mv":bins,
                    "n_pairs":n,"spearman_with_capacity":rho,
                    "rank_agreement_with_10mv":correlation(values,a[feature])[0]})
    pd.DataFrame(peak_rows).to_csv(OUT / "peak_bin_sensitivity.csv", index=False)
    corr.to_csv(OUT / "correlations.csv", index=False)
    temporal.to_csv(OUT / "temporal_diagnostics.csv", index=False)
    observed.to_csv(OUT / "cycles_observed_flagged.csv", index=False)
    raw.to_csv(OUT / "cycles_raw_extracted.csv", index=False)
    audit.to_csv(OUT / "raw_cycle_audit.csv", index=False)
    ops.to_csv(OUT / "operations.csv", index=False)
    pd.DataFrame(quality).to_csv(OUT / "data_quality.csv", index=False)
    pd.DataFrame(summary).to_csv(OUT / "battery_summary.csv", index=False)
    env = {name:importlib.metadata.version(name) for name in ["numpy","pandas","scipy","matplotlib"]}
    (OUT / "environment.json").write_text(json.dumps(env,indent=2)+"\n")
    plots(observed, audit, corr, temporal)
    make_report(observed, raw, existing, audit, ops, corr, temporal, summary, manifest)
    make_html({"observed_flagged":observed,"repository_csv":existing,
               "prior_impedance":prior}, corr, temporal, summary, audit, manifest)
    print(pd.DataFrame(summary).to_string(index=False), flush=True)
    print("\nSPEARMAN\n"+corr[corr.version == "observed_flagged"].pivot(index="feature",columns="battery_id",values="spearman_rho").round(3).to_string(), flush=True)
    print(f"\nWrote results to {OUT}", flush=True)


if __name__ == "__main__":
    main()
