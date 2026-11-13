"""Tests for the Data analysis tab's endpoints, the Data analysis -> Model bridge, and the page
structure that connects the two steps.

The statistics are checked three ways: against the CSV the analysis wrote, against SciPy, and
(for variance inflation) against the values the analysis recorded independently.
"""
import csv
import json
import re
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy import stats as scipy_stats

from server import analysis, paths
from server.api import PrognosticsEngine, app, get_engine

FEATURES = ["t_cc", "t_cv", "dq_dv_peak", "v_at_peak", "delta_T_max",
            "delta_V_ohmic", "Re", "Rct", "rest_time_hours"]
CHARGE_FEATURES = FEATURES[:4]
FLAGGED = [["B0005", 31], ["B0006", 31], ["B0007", 31], ["B0018", 46], ["B0018", 56]]


@pytest.fixture(scope="module")
def client():
    get_engine()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def relationships(client):
    response = client.get("/api/analysis/relationships")
    assert response.status_code == 200
    return response.json()


@pytest.fixture(scope="module")
def bridge(client):
    response = client.get("/api/analysis/bridge")
    assert response.status_code == 200
    return response.json()


# ---- Data analysis tab ---------------------------------------------------------------------
def test_relationships_payload_shape(relationships):
    assert [f["key"] for f in relationships["features"]] == FEATURES
    assert relationships["batteries"] == ["B0005", "B0006", "B0007", "B0018"]
    assert len(relationships["rows"]) == 632
    # [battery, cycle, soh, nine features]
    assert all(len(row) == 3 + len(FEATURES) for row in relationships["rows"])
    assert len(relationships["stats"]) == 5 * len(FEATURES)
    assert relationships["flagged"] == {"count": 5, "cycles": FLAGGED}


def test_flagged_cycles_mask_exactly_the_four_charge_features(relationships):
    rows = relationships["rows"]
    flagged = {(b, c) for b, c in FLAGGED}
    for row in rows:
        charge_values = row[3:7]
        other_values = row[7:]
        if (row[0], row[1]) in flagged:
            assert all(v is None for v in charge_values), row[:2]
        else:
            assert all(v is not None for v in charge_values), row[:2]
        assert all(v is not None for v in other_values), row[:2]


def test_observed_values_are_not_filled_in(relationships):
    """The model table interpolates the flagged cycles; the analysis view must not."""
    import pandas as pd

    model_table = pd.read_csv(paths.FEATURES_CSV).set_index(["battery_id", "cycle"])
    served = {(r[0], r[1]): r for r in relationships["rows"]}
    for battery, cycle in FLAGGED:
        assert served[(battery, cycle)][3] is None
        assert np.isfinite(model_table.loc[(battery, cycle), "t_cc"])


def test_statistics_match_the_analysis_csv(relationships):
    with open(paths.CORRELATIONS_CSV, newline="") as handle:
        expected = list(csv.DictReader(handle))
    served = relationships["stats"]
    assert len(served) == len(expected)
    for got, want in zip(served, expected):
        assert (got["battery_id"], got["feature"]) == (want["battery_id"], want["feature"])
        assert got["n_pairs"] == int(want["n_pairs"])
        assert got["omitted_pairs"] == int(want["omitted_pairs"])
        assert got["pearson_r"] == pytest.approx(float(want["pearson_r"]), abs=1e-12)
        assert got["spearman_rho"] == pytest.approx(float(want["spearman_rho"]), abs=1e-12)


def test_statistics_match_scipy_independently(relationships):
    rows = relationships["rows"]
    for stat in relationships["stats"]:
        column = 3 + FEATURES.index(stat["feature"])
        pairs = [(r[column], r[2]) for r in rows
                 if r[column] is not None and (stat["battery_id"] == "ALL" or r[0] == stat["battery_id"])]
        x, y = np.array(pairs).T
        assert len(pairs) == stat["n_pairs"]
        assert stat["pearson_r"] == pytest.approx(scipy_stats.pearsonr(x, y)[0], abs=1e-9)
        assert stat["spearman_rho"] == pytest.approx(scipy_stats.spearmanr(x, y)[0], abs=1e-9)


def test_pair_counts_reflect_the_five_flagged_cycles(relationships):
    pooled = {s["feature"]: s for s in relationships["stats"] if s["battery_id"] == "ALL"}
    for feature in CHARGE_FEATURES:
        assert (pooled[feature]["n_pairs"], pooled[feature]["omitted_pairs"]) == (627, 5)
    for feature in FEATURES[4:]:
        assert (pooled[feature]["n_pairs"], pooled[feature]["omitted_pairs"]) == (632, 0)


def test_pinned_sources_are_verified(relationships):
    pinned = relationships["source"]["pinned"]
    assert pinned["verified"] is True
    assert pinned["commit"] == "043ec72936025ce59a3753b31c3c3a16e531df5a"
    assert {f["path"] for f in pinned["files"]} == set(analysis.PINNED_SOURCE_FILES)


# ---- Data analysis -> Model bridge ---------------------------------------------------------------
def test_pooled_vif_matches_the_analysis_record(bridge):
    with open(paths.RESULTS_DIR / "learning" / "feature_overlap.json") as handle:
        records = json.load(handle)["records"]
    recorded = {r["feature"]: r["vif"] for r in records if r["battery_id"] == "ALL"}
    assert set(bridge["pooled_vif"]) == set(CHARGE_FEATURES)
    for feature in CHARGE_FEATURES:
        assert bridge["pooled_vif"][feature] == pytest.approx(recorded[feature], rel=1e-6)


def test_bridge_weights_come_from_the_fitted_ridge_model(bridge):
    engine = get_engine()
    weights = engine.ridge_model.get_feature_coefficients()
    assert [f["key"] for f in bridge["features"]] == FEATURES
    for feature in bridge["features"]:
        assert feature["ridge_weight"] == pytest.approx(weights[feature["key"]])
    assert bridge["trained_on"]["cycles"] == len(engine.df) == 632
    assert bridge["trained_on"]["ridge_alpha"] == pytest.approx(float(engine.ridge_model.model.alpha_))


def test_bridge_direction_follows_the_signs(bridge):
    weak = bridge["weak_rho"]
    opposite = []
    for feature in bridge["features"]:
        rho, weight = feature["spearman_all"], feature["ridge_weight"]
        if abs(rho) < weak:
            expected = "unclear"
        elif np.sign(rho) == np.sign(weight):
            expected = "agrees"
        else:
            expected = "opposite"
        assert feature["direction"] == expected, feature["key"]
        if expected == "opposite":
            opposite.append(feature["key"])
    assert bridge["opposite"] == opposite
    # rest_time_hours has no clear univariate direction (|rho| about 0.06), so it is not a disagreement.
    by_key = {f["key"]: f for f in bridge["features"]}
    assert by_key["rest_time_hours"]["direction"] == "unclear"


def test_bridge_timing_matches_the_data_contracts(bridge):
    contracts = json.loads(paths.DATA_CONTRACTS_JSON.read_text())
    expected = {(e["feature"], e["scenario"]): e for e in contracts["availability"]}
    for feature in bridge["features"]:
        for scenario, entry in feature["timing"].items():
            source = expected[(feature["key"], scenario)]
            assert entry["available"] == source["available_and_observed_count"]
            assert entry["later"] == source["starts_or_finishes_after_cutoff_count"]
            assert entry["unknown"] == source["completion_unknown_count"]
            assert entry["flagged"] == source["quality_flagged_count"]

    status = {f["key"]: {s: e["status"] for s, e in f["timing"].items()} for f in bridge["features"]}
    for feature in CHARGE_FEATURES:
        assert status[feature] == {"end_of_charge": "known", "discharge_start": "known"}
    for feature in ("delta_T_max", "delta_V_ohmic"):
        assert status[feature] == {"end_of_charge": "later", "discharge_start": "later"}
    for feature in ("Re", "Rct"):
        assert status[feature] == {"end_of_charge": "unconfirmed", "discharge_start": "unconfirmed"}
    assert status["rest_time_hours"] == {"end_of_charge": "later", "discharge_start": "known"}


def test_bridge_caveats_quote_the_audit_numbers(bridge):
    by_id = {c["id"]: c["text"] for c in bridge["caveats"]}
    assert list(by_id) == ["evaluation", "timing", "flagged", "weights"]
    assert "no untouched test set" in by_id["evaluation"]
    assert "all 632 cycles" in by_id["timing"]
    assert "599 of 632" in by_id["timing"] and "33 more" in by_id["timing"]
    assert "B0018 cycles 46 and 56" in by_id["flagged"] and "15 feature cells" in by_id["flagged"]
    for key in bridge["opposite"]:
        assert key in by_id["weights"]
    assert f"{len(bridge['opposite'])} have a Ridge weight" in by_id["weights"]


def test_missing_pinned_table_is_an_error_and_is_never_rewritten(tmp_path):
    missing = tmp_path / "features_all_batteries.csv"
    engine = PrognosticsEngine(data_csv=str(missing), raw_dir=str(paths.RAW_DIR))
    with pytest.raises(FileNotFoundError, match="run_eda"):
        engine.initialize()
    assert not missing.exists()


# ---- Serving ---------------------------------------------------------------------------------
@pytest.mark.parametrize("url", [
    "/analysis/clustering.html",
    "/analysis/report.html",
    "/analysis/scatterplots.html",
    "/analysis/feature_target_correlations.csv",
])
def test_analysis_outputs_are_served_read_only(client, url):
    assert client.get(url).status_code == 200
    assert client.post(url).status_code in (404, 405)


def test_learning_lab_is_served(client):
    response = client.get("/learning/")
    assert response.status_code == 200
    assert "Battery data learning lab" in response.text


def test_ui_files_revalidate_on_reload(client):
    for url in ("/", "/static/app.js", "/static/analysis.js", "/static/analysis.css"):
        assert client.get(url).headers["cache-control"] == "no-cache", url


# ---- Page structure joining the two steps ------------------------------------------------------
INDEX = (paths.STATIC_DIR / "index.html").read_text()
APP_JS = (paths.STATIC_DIR / "app.js").read_text()
VIEW_BUTTONS = re.findall(r'<button class="segment-btn" data-tab="(tab-[a-z]+)" data-group="(analysis|model)"', INDEX)


def test_every_view_button_has_a_section():
    sections = re.findall(r'<section id="(tab-[a-z]+)" class="view-section', INDEX)
    assert sorted(t for t, _ in VIEW_BUTTONS) == sorted(sections)
    assert len(VIEW_BUTTONS) == 8


def test_navigation_groups_in_javascript_match_the_markup():
    for group in ("analysis", "model"):
        listed = re.search(rf"{group}: \[(.*?)\]", APP_JS, re.S).group(1)
        assert set(re.findall(r'"(tab-[a-z]+)"', listed)) == {t for t, g in VIEW_BUTTONS if g == group}


def test_data_analysis_comes_before_model():
    assert INDEX.index('class="primary-btn active" data-group="analysis"') < INDEX.index('data-group="model" aria-pressed')
    assert [g for _, g in VIEW_BUTTONS] == ["analysis"] * 5 + ["model"] * 3


def test_landing_view_is_the_first_data_analysis_view():
    assert re.findall(r'<section id="(tab-[a-z]+)" class="view-section active"', INDEX) == ["tab-relationships"]


def test_analysis_script_registers_before_the_first_tab_change():
    assert INDEX.index('/static/analysis.js') < INDEX.index('/static/app.js')


def test_every_goto_target_exists():
    targets = set(re.findall(r'data-goto="(tab-[a-z]+)"', INDEX))
    assert targets and targets <= {t for t, _ in VIEW_BUTTONS}


# ---- Provenance of the vendored upstream files ------------------------------------------------
def test_files_marked_unmodified_still_match_upstream():
    import hashlib

    manifest = json.loads((paths.APP_DIR / "source_manifest.json").read_text())
    assert manifest["commit"] == "043ec72936025ce59a3753b31c3c3a16e531df5a"
    unmodified = [e for e in manifest["files"] if not e["modified"]]
    assert {Path(e["local_path"]).name for e in unmodified} >= {"models.py", "style.css", "pytest.ini"}
    for entry in manifest["files"]:
        local = paths.PROJECT_ROOT / entry["local_path"]
        assert local.exists(), entry["local_path"]
        if not entry["modified"]:
            assert hashlib.sha256(local.read_bytes()).hexdigest() == entry["upstream_sha256"], entry["local_path"]
        else:
            assert entry["changes"], f"{entry['local_path']} is modified but does not say how"
