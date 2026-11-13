"""Saved models must preserve inference and refresh when their inputs change."""
import json
from pathlib import Path
import shutil

import numpy as np
import pandas as pd
import pytest

from server import paths
from server.api import PrognosticsEngine
from server.model_store import MODEL_FILES, MODEL_TYPES
from server.models import FEATURE_NAMES


def make_engine(root: Path) -> PrognosticsEngine:
    return PrognosticsEngine(
        data_csv=str(root / "features.csv"),
        raw_dir=str(paths.RAW_DIR),
        model_dir=str(root / "Model"),
    )


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    root = tmp_path_factory.mktemp("trained-models")
    pd.read_csv(paths.FEATURES_CSV).head(32).to_csv(root / "features.csv", index=False)
    engine = make_engine(root)
    engine.initialize()
    return root, engine


@pytest.fixture
def saved(tmp_path, trained):
    root = tmp_path / "saved"
    shutil.copytree(trained[0], root)
    return root


def test_saved_models_reload_without_fitting_and_preserve_inference(saved, trained, monkeypatch):
    def forbid_fit(*args, **kwargs):
        pytest.fail("A matching saved model must be loaded without fitting")

    for model_type in MODEL_TYPES.values():
        monkeypatch.setattr(model_type, "fit", forbid_fit)

    engine = make_engine(saved)
    engine.initialize()
    original = trained[1]
    X = original.df[FEATURE_NAMES].values
    for name in MODEL_TYPES:
        np.testing.assert_allclose(
            engine.models[name].predict(X), original.models[name].predict(X),
            rtol=1e-12, atol=1e-12,
        )
        assert (saved / "Model" / MODEL_FILES[name]).is_file()

    # The public inference result also includes GPR uncertainty, Ridge weights,
    # and the Jacobian, all of which must survive serialization.
    features = original.df.iloc[0][FEATURE_NAMES].to_dict()
    assert engine.predict(features) == original.predict(features)
    np.testing.assert_allclose(
        engine.models["GPR"].predict_with_uncertainty(X)[1],
        original.models["GPR"].predict_with_uncertainty(X)[1],
        rtol=1e-12, atol=1e-12,
    )


def test_changed_training_data_replaces_saved_models(saved, trained):
    manifest_path = saved / "Model" / "manifest.json"
    before = json.loads(manifest_path.read_text())
    csv_path = saved / "features.csv"
    df = pd.read_csv(csv_path)
    df["soh"] += 4
    df.to_csv(csv_path, index=False)

    engine = make_engine(saved)
    engine.initialize()
    after = json.loads(manifest_path.read_text())
    assert after["signature"]["training_data_sha256"] != before["signature"]["training_data_sha256"]
    X = df[FEATURE_NAMES].values
    np.testing.assert_allclose(
        engine.models["Ridge"].predict(X),
        trained[1].models["Ridge"].predict(X) + 4,
        rtol=1e-9, atol=1e-9,
    )


@pytest.mark.parametrize("damage", ["missing_model", "corrupt_model", "corrupt_manifest", "old_versions"])
def test_incomplete_or_outdated_artifacts_are_rebuilt(saved, trained, damage, monkeypatch):
    model_dir = saved / "Model"
    if damage == "missing_model":
        (model_dir / "gpr.joblib").unlink()
    elif damage == "corrupt_model":
        (model_dir / "gpr.joblib").write_bytes(b"incomplete artifact")
    elif damage == "corrupt_manifest":
        (model_dir / "manifest.json").write_text("{")
    else:
        manifest = json.loads((model_dir / "manifest.json").read_text())
        manifest["signature"]["versions"]["scikit-learn"] = "outdated"
        (model_dir / "manifest.json").write_text(json.dumps(manifest))

    engine = make_engine(saved)
    engine.initialize()
    features = trained[1].df.iloc[0][FEATURE_NAMES].to_dict()
    assert engine.predict(features) == trained[1].predict(features)

    def forbid_fit(*args, **kwargs):
        pytest.fail("Rebuilt artifacts should be reusable on the next start")

    for model_type in MODEL_TYPES.values():
        monkeypatch.setattr(model_type, "fit", forbid_fit)
    make_engine(saved).initialize()
