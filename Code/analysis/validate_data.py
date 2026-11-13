"""Validate battery data without modifying measurements or training a model.

Run from the project root:
    python Code/analysis/validate_data.py --self-test

Reusable table/raw invariants are separate from expectations for this pinned
snapshot. Availability checks describe hypothetical prediction moments, not an
assumed deployment objective. An EIS start is not its completion time.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.io import loadmat

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
RESULTS = REPO / "Reports"
KEYS = ["battery_id", "cycle"]
CHARGE = ["t_cc", "t_cv", "dq_dv_peak", "v_at_peak"]
FEATURES = CHARGE + ["delta_T_max", "delta_V_ohmic", "Re", "Rct", "rest_time_hours"]
REQUIRED = KEYS + FEATURES + ["capacity", "soh", "charge_quality_flag"]


def result(name, category, passed, description, *, count=0, examples=None, warning=False):
    return {"check": name, "category": category,
            "status": "pass" if passed else ("warning" if warning else "fail"),
            "affected_count": int(count), "description": description,
            "examples": examples or []}


def rows_for(df, mask):
    return df.loc[mask, [k for k in KEYS if k in df]].head(10).to_dict("records")


def validate_cycle_table(df, reference_capacity_ah=2.0):
    """Return reusable checks. Missing charge features require a true quality flag.

    The current observed-data policy masks all four charge features together.
    No upper bound of 2 Ah or 100% is imposed: rated capacity is a reference.
    """
    checks = []
    missing = sorted(set(REQUIRED)-set(df.columns))
    checks.append(result("required_columns", "invariant", not missing,
                         "Required cycle-table fields must exist.", count=len(missing), examples=missing))
    if missing:
        return checks
    bad_battery = ~df.battery_id.map(lambda x: isinstance(x, str) and bool(x.strip()))
    checks.append(result("battery_id_type", "invariant", not bad_battery.any(),
                         "Battery IDs must be nonempty strings.", count=bad_battery.sum(),
                         examples=rows_for(df, bad_battery)))
    numeric = ["cycle"]+FEATURES+["capacity", "soh"]
    bad_types = [c for c in numeric if not pd.api.types.is_numeric_dtype(df[c])
                 or pd.api.types.is_bool_dtype(df[c])]
    checks.append(result("numeric_column_types", "invariant", not bad_types,
                         "Cycles, features, capacity and SoH must have numeric dtypes.",
                         count=len(bad_types), examples=bad_types))
    bad_flags = ~df.charge_quality_flag.map(lambda x: isinstance(x, (bool, np.bool_)))
    checks.append(result("quality_flag_type", "invariant", not bad_flags.any(),
                         "charge_quality_flag must be boolean, not a string, number or missing value.",
                         count=bad_flags.sum(), examples=rows_for(df, bad_flags)))
    duplicate = df.duplicated(KEYS, keep=False)
    checks.append(result("unique_cycle_keys", "invariant", not duplicate.any(),
                         "Each battery/cycle pair must identify exactly one row.",
                         count=duplicate.sum(), examples=rows_for(df, duplicate)))
    if bad_types or bad_flags.any():
        return checks  # Invalid types must not be silently coerced for later checks.
    bad_cycle = ~np.isfinite(df.cycle) | (df.cycle <= 0) | (df.cycle % 1 != 0)
    checks.append(result("positive_integer_cycle", "invariant", not bad_cycle.any(),
                         "Cycle IDs must be finite positive integers.", count=bad_cycle.sum(),
                         examples=rows_for(df, bad_cycle)))
    bad_capacity = ~np.isfinite(df.capacity) | (df.capacity <= 0)
    checks.append(result("positive_finite_capacity", "invariant", not bad_capacity.any(),
                         "Capacity must be finite and positive. Values above rated capacity are allowed.",
                         count=bad_capacity.sum(), examples=rows_for(df, bad_capacity)))
    bad_soh = ~np.isfinite(df.soh) | ~np.isclose(
        df.soh, df.capacity/reference_capacity_ah*100, rtol=1e-10, atol=1e-8)
    checks.append(result("soh_matches_capacity", "invariant", not bad_soh.any(),
                         f"SoH must equal capacity / {reference_capacity_ah:g} Ah × 100 within numerical tolerance.",
                         count=bad_soh.sum(), examples=rows_for(df, bad_soh)))
    flag = df.charge_quality_flag
    unexpected_missing = df[FEATURES].isna()
    unexpected_missing.loc[flag, CHARGE] = False
    mask = unexpected_missing.any(axis=1)
    checks.append(result("missing_features_explained", "invariant", not mask.any(),
                         "Only the four explicitly flagged charge features may be missing under this table policy.",
                         count=int(unexpected_missing.sum().sum()), examples=rows_for(df, mask)))
    unmasked_flag = flag & df[CHARGE].notna().any(axis=1)
    checks.append(result("flagged_charge_values_masked", "invariant", not unmasked_flag.any(),
                         "This observed-data version masks all four charge features for a flagged cycle.",
                         count=unmasked_flag.sum(), examples=rows_for(df, unmasked_flag)))
    nonfinite = (~np.isfinite(df[FEATURES])) & df[FEATURES].notna()
    checks.append(result("finite_present_features", "invariant", not nonfinite.any().any(),
                         "Present feature values must be finite; an explicit missing value is different from infinity.",
                         count=int(nonfinite.sum().sum()), examples=rows_for(df, nonfinite.any(axis=1))))
    negative = (df[FEATURES] < 0).any(axis=1)
    checks.append(result("nonnegative_feature_values", "invariant", not negative.any(),
                         "These feature definitions produce nonnegative durations, resistances, rises, drops and peaks.",
                         count=negative.sum(), examples=rows_for(df, negative)))
    checks.append(result("documented_charge_quality_flags", "quality_exception", not flag.any(),
                         "Flagged observations remain in the table with missing charge features; no values are filled.",
                         count=flag.sum(), examples=rows_for(df, flag), warning=True))
    return checks


def start_time(vector):
    year, month, day, hour, minute, second = np.asarray(vector, dtype=float).ravel()
    return pd.Timestamp(datetime(int(year), int(month), int(day), int(hour), int(minute))) + pd.Timedelta(seconds=float(second))


def inspect_raw(source, audit, df):
    """Check raw arrays directly, including unused operations, and derive timing."""
    checks, timing, issues = [], [], []
    selected = set(zip(audit.battery_id, audit.charge_operation_id)) | set(zip(audit.battery_id, audit.discharge_operation_id))
    total_ops = sampled_ops = total_discharges = selected_ops = 0
    nonfinite_selected = nonfinite_unused = mismatches = bad_times = empty_arrays = 0
    link_errors, label_errors, timestamp_errors = [], [], []
    indexed_audit = {(r.battery_id, int(r.cycle)): r for r in audit.itertuples()}
    indexed_table = {(r.battery_id, int(r.cycle)): r for r in df.itertuples()}
    for path in sorted((source/"data/raw").glob("*.mat")):
        battery = path.stem
        ops = loadmat(path, simplify_cells=True)[battery]["cycle"]
        if isinstance(ops, dict):
            ops = [ops]
        parsed = []
        for i, op in enumerate(ops):
            typ, data = op["type"], op["data"]
            start = start_time(op["time"])
            t = np.asarray(data.get("Time", []), dtype=float).ravel()
            parsed.append({"id":i, "type":typ, "start":start, "data":data,
                           "end":start+pd.Timedelta(seconds=float(t[-1])) if len(t) else None})
            total_ops += 1
            if typ not in {"charge", "discharge"}:
                continue
            sampled_ops += 1
            total_discharges += int(typ == "discharge")
            used = (battery, i) in selected
            selected_ops += int(used)
            signals = [np.asarray(data.get(k, []), dtype=float).ravel()
                       for k in ["Voltage_measured", "Current_measured", "Temperature_measured"]]
            n_bad = int(sum((~np.isfinite(s)).sum() for s in signals))
            n_length = sum(len(s) != len(t) for s in signals)
            n_time = int((~np.isfinite(t)).sum()+np.sum(np.diff(t) <= 0))
            n_empty = int(not len(t) or any(not len(s) for s in signals))
            mismatches += n_length; bad_times += n_time; empty_arrays += n_empty
            if used: nonfinite_selected += n_bad
            else: nonfinite_unused += n_bad
            if n_bad or n_length or n_time or n_empty:
                issues.append({"battery_id":battery,"operation_id":i,"type":typ,
                    "used_by_aligned_cycle":used,"nonfinite_sensor_values":n_bad,
                    "signal_length_mismatches":int(n_length),"invalid_time_values_or_steps":n_time,
                    "empty_array":bool(n_empty)})
        impedance = [op for op in parsed if op["type"] == "impedance"
                     and all(k in op["data"] and np.isfinite(float(op["data"][k])) for k in ["Re", "Rct"])]
        discharge_cycle = 0
        for op in parsed:
            if op["type"] != "discharge": continue
            discharge_cycle += 1
            key = (battery, discharge_cycle)
            if key not in indexed_audit or key not in indexed_table: continue
            row, table = indexed_audit[key], indexed_table[key]
            charge = parsed[int(row.charge_operation_id)]
            if charge["type"] != "charge" or int(row.discharge_operation_id) != op["id"]:
                link_errors.append({"battery_id":battery,"cycle":discharge_cycle})
            raw_capacity = float(op["data"]["Capacity"])
            if not np.isclose(raw_capacity, table.capacity, rtol=0, atol=1e-10):
                label_errors.append({"battery_id":battery,"cycle":discharge_cycle})
            charge_end = charge["end"]
            if not charge_end or charge_end > op["start"]:
                timestamp_errors.append({"battery_id":battery,"cycle":discharge_cycle})
            near = min(impedance, key=lambda z:abs((z["start"]-op["start"]).total_seconds())) if impedance else None
            t = np.asarray(op["data"]["Time"], dtype=float).ravel()
            current = np.asarray(op["data"]["Current_measured"], dtype=float).ravel()
            load = np.flatnonzero(current <= -1)
            voltage_ready = op["start"]+pd.Timedelta(seconds=float(t[load[0]])) if len(load) else None
            timing.append({"battery_id":battery,"cycle":discharge_cycle,
                "charge_end":charge_end,"discharge_start":op["start"],"discharge_end":op["end"],
                "voltage_drop_ready":voltage_ready,"nearest_eis_start":near["start"] if near else None,
                "charge_quality_flag":bool(table.charge_quality_flag)})
    for name, count, description in [
        ("raw_waveform_arrays_nonempty",empty_arrays,"Every charge/discharge record must have time, voltage, current and temperature samples."),
        ("raw_waveform_lengths",mismatches,"Time, voltage, current and temperature arrays must have matching lengths."),
        ("raw_sample_times",bad_times,"Sample times must be finite and strictly increasing within each operation."),
        ("selected_raw_signals_finite",nonfinite_selected,"Sensor samples in selected charge/discharge records must be finite."),
        ("raw_operation_links",len(link_errors),"Aligned rows must reference the correct raw charge and discharge operation types."),
        ("capacity_matches_raw_record",len(label_errors),"Cycle labels must agree with the raw discharge Capacity field."),
        ("charge_finishes_before_discharge",len(timestamp_errors),"The preceding charge must finish no later than discharge starts.")]:
        examples = link_errors if name == "raw_operation_links" else label_errors if name == "capacity_matches_raw_record" else timestamp_errors if name == "charge_finishes_before_discharge" else issues
        checks.append(result(name,"raw_invariant",count == 0,description,count=count,examples=examples[:10] if count else []))
    checks.append(result("unused_raw_nonfinite_samples","quality_exception",nonfinite_unused == 0,
        "Unused raw operations are still audited and reported; their defects do not disappear because they are unselected.",
        count=nonfinite_unused,examples=[i for i in issues if not i["used_by_aligned_cycle"]][:10],warning=True))
    metadata = {"total_raw_operations":total_ops,"sampled_charge_discharge_operations":sampled_ops,
        "raw_discharge_records":total_discharges,"selected_charge_discharge_operations":selected_ops,
        "selected_nonfinite_sensor_values":nonfinite_selected,"unused_nonfinite_sensor_values":nonfinite_unused,
        "raw_array_issues":issues}
    return checks, pd.DataFrame(timing), metadata


def availability_checks(timing):
    records = []
    total = len(timing)
    for scenario, cutoff_column in [("end_of_charge","charge_end"),("discharge_start","discharge_start")]:
        cutoff = timing[cutoff_column]
        for feature in FEATURES:
            unavailable = np.zeros(total,dtype=bool)
            unknown = np.zeros(total,dtype=bool)
            quality = np.zeros(total,dtype=bool)
            if feature in CHARGE:
                unavailable = (timing.charge_end > cutoff).to_numpy()
                quality = timing.charge_quality_flag.to_numpy()
                reason = "Charge recording is complete at both hypothetical moments. Five flagged cycles lack an accepted observed charge feature."
            elif feature == "delta_T_max":
                unavailable = (timing.discharge_end > cutoff).to_numpy()
                reason = "The maximum temperature rise requires the complete discharge recording."
            elif feature == "delta_V_ohmic":
                unavailable = (timing.voltage_drop_ready > cutoff).to_numpy()
                unknown = timing.voltage_drop_ready.isna().to_numpy()
                reason = "The initial voltage-drop calculation requires samples through the first discharge load step."
            elif feature in {"Re","Rct"}:
                unavailable = (timing.nearest_eis_start > cutoff).to_numpy()
                unknown = ~unavailable  # No sweep completion timestamps exist in these files.
                reason = "A future sweep start proves unavailability. A past start alone cannot establish completion; end timestamps are missing."
            else:
                unavailable = (timing.discharge_start > cutoff).to_numpy()
                reason = "The current interval feature ends at discharge start and includes intervening charging; its exact value is not known at charge completion."
            blocked = unavailable | unknown | quality
            records.append({"scenario":scenario,"feature":feature,"total_cycles":total,
                "available_and_observed_count":int((~blocked).sum()),
                "starts_or_finishes_after_cutoff_count":int(unavailable.sum()),
                "completion_unknown_count":int(unknown.sum()),"quality_flagged_count":int(quality.sum()),
                "status":"available" if not blocked.any() else "requires_handling",
                "reason":reason})
    return records


def snapshot_checks(table, raw, existing, audit, metadata):
    """Expectations for this pinned snapshot, not universal battery-data rules."""
    expected_flags = {("B0005",31),("B0006",31),("B0007",31),("B0018",46),("B0018",56)}
    flags = set(map(tuple,table.loc[table.charge_quality_flag,KEYS].to_numpy()))
    aligned = existing.merge(raw,on=KEYS,suffixes=("_existing","_raw"),validate="one_to_one")
    changes = sum(int((~np.isclose(aligned[c+"_existing"],aligned[c+"_raw"],rtol=1e-10,atol=1e-9)).sum()) for c in FEATURES)
    fallbacks = existing.merge(table[KEYS+["charge_quality_flag"]],on=KEYS,validate="one_to_one")
    fallback_count = int((fallbacks.charge_quality_flag & fallbacks.v_at_peak.eq(4.0)).sum())
    actual = {"aligned_cycles":len(table),"batteries":table.battery_id.nunique(),
              "quality_flagged_cycles":int(table.charge_quality_flag.sum()),
              "processed_feature_cells_changed_from_raw":changes,"flagged_peak_voltage_fallbacks":fallback_count,
              "raw_discharge_records":metadata["raw_discharge_records"],
              "eis_starts_after_charge_end":int(audit.nearest_impedance_after_charge_end.sum()),
              "eis_starts_after_discharge_start":int(audit.nearest_impedance_after_discharge_start.sum()),
              "unused_nonfinite_sensor_values":metadata["unused_nonfinite_sensor_values"]}
    expected = dict(zip(actual,[632,4,5,15,5,636,599,175,6]))
    checks = [result(name,"snapshot_expectation",value == expected[name],
        f"Pinned snapshot expectation: {expected[name]}; observed: {value}.",count=0 if value == expected[name] else 1)
        for name,value in actual.items()]
    checks.append(result("flagged_cycle_identities","snapshot_expectation",flags == expected_flags,
        "The five snapshot charge-quality flags must match the documented cycle identities.",count=len(flags ^ expected_flags)))
    # Validate policy lineage without requiring a universal 100 s / 0.1 Ah/V limit.
    policy = raw[(raw.t_cc < 100) | (raw.dq_dv_peak < .1)]
    policy_flags = set(map(tuple,policy[KEYS].to_numpy()))
    checks.append(result("screening_policy_lineage","snapshot_expectation",flags == policy_flags,
        "The current flags reproduce the source screening policy (raw t_cc < 100 s or dq_dv_peak < 0.1 Ah/V). These are inherited flags, not proven physical limits.",count=len(flags ^ policy_flags)))
    return checks, actual


def mutation_checks(table):
    """Disposable corruptions prove that the reusable rules reject bad tables."""
    cases = []
    bad = pd.concat([table,table.iloc[[0]]],ignore_index=True)
    cases.append(("duplicate_cycle",bad,"unique_cycle_keys"))
    bad = table.copy(); bad.loc[0,"soh"] += 5
    cases.append(("inconsistent_soh",bad,"soh_matches_capacity"))
    bad = table.copy(); bad.loc[0,"capacity"] = -1
    cases.append(("negative_capacity",bad,"positive_finite_capacity"))
    bad = table.copy(); bad.loc[0,"t_cc"] = np.nan
    cases.append(("unflagged_missing_feature",bad,"missing_features_explained"))
    bad = table.copy(); bad["charge_quality_flag"] = bad.charge_quality_flag.astype(str)
    cases.append(("string_quality_flags",bad,"quality_flag_type"))
    bad = table.drop(columns="capacity")
    cases.append(("missing_required_field",bad,"required_columns"))
    outcomes = []
    for name,frame,wanted in cases:
        failed = {c["check"] for c in validate_cycle_table(frame) if c["status"] == "fail"}
        outcomes.append({"case":name,"expected_failure":wanted,"detected":wanted in failed})
    return outcomes


def write_report(report, output):
    output.mkdir(parents=True,exist_ok=True)
    (output/"data_contracts.json").write_text(json.dumps(report,indent=2,default=str,allow_nan=False)+"\n")
    checks = report["checks"]
    invariant_fails = [c for c in checks if c["status"] == "fail"]
    md = ["# Data contracts: battery dataset validation","",
        "A data contract is a set of explicit rules the dataset must follow. Think of it as a delivery inspection: check labels, identifiers, measurements and timing, then record exceptions instead of hiding them.","",
        "## Outcome","",
        f"Validated {report['snapshot']['aligned_cycles']} aligned cycles from {report['snapshot']['batteries']} batteries. "
        f"{'All reusable table and raw-record rules pass.' if not invariant_fails else str(len(invariant_fails))+' checks failed; inspect the JSON report.'} "
        "This means the exploratory table follows its documented rules. It does not certify that all nine features can be used at an earlier prediction moment.","",
        "## Rules checked","",
        "| Rule | Result |","|---|---|"]
    for c in checks:
        if c["category"] in {"invariant","raw_invariant","source"}:
            md.append(f"| {c['description']} | {c['status']} |")
    md += ["","## Explicit exceptions","",
        "- **Five cycles have a charge-quality flag.** The observed-data table keeps their capacity labels and masks all four charging features. They are B0005/B0006/B0007 cycle 31 and B0018 cycles 46 and 56. There are 20 explicitly masked feature cells, not 20 missing cycles.",
        "- **The original processed CSV fills 15 feature cells.** It interpolates t_cc, t_cv and dq_dv_peak in those five cycles. The 4 V fallback peak voltage remains. The validator reports this lineage; it does not fill or change anything.",
        "- **One unused raw charging operation contains six non-finite sensor values.** These are two samples each in voltage, current and temperature for B0018 operation 114 (zero-based). That operation is followed by another charge and is not selected for any aligned cycle. Selected charge/discharge measurements are finite.",
        "- **SoH above 100% is accepted.** The 2 Ah rated capacity is a denominator, not a hard upper bound on the measured capacity of an individual cell. B0006 has values above 100%; clipping them would change the labels.","",
        "## Prediction timing: two hypothetical scenarios","",
        "No deployment objective has been selected here. Both scenarios are reported so the user can choose what information will be available. 'Discharge start' means the operation-start timestamp, before the later load step.","",
        "| Feature | At charge completion | At discharge start |","|---|---|---|"]
    by_key = {(r["scenario"],r["feature"]):r for r in report["availability"]}
    for feature in FEATURES:
        descriptions = []
        for scenario in ["end_of_charge","discharge_start"]:
            r = by_key[(scenario,feature)]
            descriptions.append(f"{r['available_and_observed_count']} observed/available; {r['starts_or_finishes_after_cutoff_count']} future; {r['completion_unknown_count']} completion unknown; {r['quality_flagged_count']} flagged")
        md.append(f"| {feature} | {' | '.join(descriptions)} |")
    md += ["",
        "- A nearest EIS measurement starting after the cutoff is definitely unavailable: 599 rows at charge completion and 175 at discharge start. A sweep that started earlier is not certified available either: the files do not provide its completion timestamp. These counts refer to the source nearest-sweep choice, not a repaired prior-only feature.",
        "- delta_T_max requires the full discharge. delta_V_ohmic requires the load step, which occurs roughly 19–36 seconds after discharge starts in these records. Neither is available at the operation-start instant.",
        "- rest_time_hours is the interval ending at discharge start, including intervening charging. Its final value is unavailable at charge completion. At discharge start it can be known, but it is not pure idle-rest duration.",
        "- The four charging features are available for 627 unflagged cycles at either scenario. The five flagged cycles still need an explicit missing-data/exclusion policy before model use.","",
        "## Reusable rules versus snapshot checks","",
        "Reusable rules include unique keys, numeric fields, finite positive capacity, the stated SoH formula, explicit missing-data flags, array lengths, increasing sample time, and label agreement with the raw record. They do not require a fixed battery list, 632 rows, or exactly five flags.","",
        "Separate snapshot expectations record the known row counts, flag identities, interpolation counts and timing counts for source commit `"+report["source_commit"]+"`. Those checks detect accidental changes to this particular analysis. The inherited 100 s and 0.1 Ah/V screening thresholds are documented policy choices, not universal battery laws.","",
        "## Reproduce and interpret the exit status","",
        "```sh",".venv/bin/python Code/analysis/validate_data.py --self-test","```","",
        "Exit 0 means required structural/source checks and requested mutation checks passed. Known quality exceptions and hypothetical availability limits remain visible in the report. Exit 1 means validation failed. If a complete nine-feature prediction scenario is explicitly requested with `--require-scenario end_of_charge` or `--require-scenario discharge_start`, exit 2 means that scenario has unavailable, flagged or unconfirmed inputs.","",
        "The validator reads the original files and existing analysis tables; it does not rerun the full EDA, alter measurements, impute values or train a model.","",
        "## Verification","",
        f"Mutation tests: {sum(r['detected'] for r in report['mutation_tests'])}/{len(report['mutation_tests'])} detected expected failures." if report["mutation_tests"] else "Mutation tests were not requested; add --self-test to run them.","",
        "The disposable tests introduce a duplicate cycle, inconsistent SoH, negative capacity, an unflagged missing feature, string quality flags and a missing required field. The original table is never modified.","",
        "Limitations: validation rules cannot prove sensor calibration, physical peak identity, causal relationships or generalization. The analysis remains exploratory across only four cells. EIS completion and a final deployment prediction moment still need to be defined.","",
        "Machine-readable details, examples and counts are in [data_contracts.json](data_contracts.json).",
        ""]
    (output/"data_contracts.md").write_text("\n".join(md))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test",action="store_true",help="Check the validator using disposable corruptions.")
    parser.add_argument("--require-scenario",choices=["end_of_charge","discharge_start"],
                        help="Require all nine feature inputs to be observed and available at this hypothetical cutoff.")
    parser.add_argument("--output",type=Path,default=RESULTS)
    args = parser.parse_args()
    manifest = json.loads((ROOT/"source_manifest.json").read_text())
    source = REPO
    checksum_bad = [r["path"] for r in manifest["files"]
                    if not (source/r["path"]).exists()
                    or hashlib.sha256((source/r["path"]).read_bytes()).hexdigest() != r["sha256"]]
    checks = [result("source_checksums","source",not checksum_bad,
        "Every raw/source file must match the pinned SHA-256 manifest.",count=len(checksum_bad),examples=checksum_bad)]
    if checksum_bad:
        print("Source checksum validation failed:",", ".join(checksum_bad))
        return 1
    table = pd.read_csv(RESULTS/"cycles_observed_flagged.csv")
    raw = pd.read_csv(RESULTS/"cycles_raw_extracted.csv")
    existing = pd.read_csv(source/"data/features_all_batteries.csv")
    audit = pd.read_csv(RESULTS/"raw_cycle_audit.csv")
    checks.extend(validate_cycle_table(table))
    if any(c["status"] == "fail" for c in checks):
        print("Cycle-table validation failed:",", ".join(c["check"] for c in checks if c["status"] == "fail"))
        return 1
    audit_keys_ok = not audit.duplicated(KEYS).any() and set(map(tuple,audit[KEYS].to_numpy())) == set(map(tuple,table[KEYS].to_numpy()))
    checks.append(result("audit_cycle_links","invariant",audit_keys_ok,
                         "The raw-cycle audit must have exactly one record for every aligned cycle."))
    raw_checks, timing, metadata = inspect_raw(source,audit,table)
    checks.extend(raw_checks)
    snapshot, observed_snapshot = snapshot_checks(table,raw,existing,audit,metadata)
    checks.extend(snapshot)
    availability = availability_checks(timing)
    tests = mutation_checks(table) if args.self_test else []
    report = {"source_commit":manifest["commit"],"reference_capacity_ah":2.0,
        "checks":checks,"snapshot":observed_snapshot,"raw_metadata":metadata,
        "availability":availability,"mutation_tests":tests,
        "scenario_requested":args.require_scenario,
        "notes":["No data values were changed.","Hypothetical cutoffs do not establish a user-selected deployment objective.",
                 "Past EIS start timestamps do not establish sweep completion."]}
    write_report(report,args.output)
    failures = [c["check"] for c in checks if c["status"] == "fail"]
    if any(not r["detected"] for r in tests): failures.append("mutation_self_tests")
    print(f"Contract checks: {sum(c['status']=='pass' for c in checks)} pass, "
          f"{sum(c['status']=='warning' for c in checks)} documented exceptions, {len(failures)} failures")
    print(f"Rows: {len(table)}; mutation tests: {sum(t['detected'] for t in tests)}/{len(tests)}")
    print(f"Reports: {args.output/'data_contracts.md'} and {args.output/'data_contracts.json'}")
    if failures: return 1
    if args.require_scenario and any(r["status"] != "available" for r in availability if r["scenario"] == args.require_scenario):
        print(f"Scenario requires handling: {args.require_scenario}; see availability counts.")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
