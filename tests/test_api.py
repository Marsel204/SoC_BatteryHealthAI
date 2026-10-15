import pytest
from fastapi.testclient import TestClient

from src.api import app, get_engine


@pytest.fixture(scope="module")
def client():
    # Warm up engine
    get_engine()
    with TestClient(app) as test_client:
        yield test_client


def test_api_status(client):
    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "Ridge" in data["models_loaded"]
    assert "GPR" in data["models_loaded"]
    assert data["total_cycles"] > 0


def test_dataset_summary(client):
    response = client.get("/api/dataset/summary")
    assert response.status_code == 200
    data = response.json()
    assert "batteries" in data
    assert "B0005" in data["batteries"]
    assert "presets" in data
    assert "fresh_cell" in data["presets"]
    assert "near_eol" in data["presets"]


def test_predict_endpoint_valid(client):
    payload = {
        "t_cc": 2800.0,
        "t_cv": 6500.0,
        "dq_dv_peak": 4.5,
        "v_at_peak": 3.98,
        "delta_T_max": 14.5,
        "delta_V_ohmic": 0.22,
        "Re": 0.05,
        "Rct": 0.07,
        "rest_time_hours": 3.5,
    }
    response = client.post("/api/predict", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "predictions" in data
    preds = data["predictions"]
    for m in ["Ridge", "ElasticNet", "SVR", "GPR", "XGBoost"]:
        assert m in preds
        assert 50.0 <= preds[m] <= 110.0

    # GPR uncertainty
    assert "gpr_uncertainty" in data
    unc = data["gpr_uncertainty"]
    assert unc["std"] > 0
    assert unc["ci_lower"] < unc["ci_upper"]

    # Jacobian sensitivities
    assert "jacobian" in data
    assert "t_cc" in data["jacobian"]
    assert data["jacobian"]["t_cc"] > 0  # Physical sign verification: t_cc positive


def test_predict_endpoint_validation_error(client):
    # Missing required fields
    bad_payload = {"t_cc": 2800.0}
    response = client.post("/api/predict", json=bad_payload)
    assert response.status_code == 422


def test_cycle_detail_endpoint(client):
    response = client.get("/api/cycle/B0005/10")
    assert response.status_code == 200
    data = response.json()
    assert data["battery_id"] == "B0005"
    assert data["cycle_index"] == 10
    assert "soh" in data
    assert "features" in data
    assert "charge_waveform" in data
    assert "ic_curve" in data
    assert len(data["charge_waveform"]["voltage"]) > 0
    assert len(data["ic_curve"]["voltage"]) > 0


def test_lobo_results_endpoint(client):
    response = client.get("/api/lobo/results")
    assert response.status_code == 200
    data = response.json()
    assert "Ridge" in data
    assert "GPR" in data
    assert "mean_rmse" in data["Ridge"]


def test_static_ui_serving(client):
    r_index = client.get("/")
    assert r_index.status_code == 200
    assert "Battery SoH Prognostics" in r_index.text

    r_css = client.get("/static/style.css")
    assert r_css.status_code == 200

    r_js = client.get("/static/app.js")
    assert r_js.status_code == 200


def test_figures_catalog_endpoint(client):
    response = client.get("/api/figures")
    assert response.status_code == 200
    catalog = response.json()
    assert len(catalog) == 6
    assert catalog[0]["id"] == "degradation_regeneration"
    assert "url" in catalog[0]
    
    # Test that figure image file itself can be served
    fig_res = client.get(catalog[0]["url"])
    assert fig_res.status_code == 200


