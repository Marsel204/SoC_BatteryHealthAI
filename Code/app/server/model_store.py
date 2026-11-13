"""Persist fitted estimators and their scalers in the project's Model directory."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
import json
import logging
from pathlib import Path
import pickle
import platform
from tempfile import TemporaryDirectory

import joblib
import pandas as pd
import xgboost

from . import models, paths
from .models import (
    FEATURE_NAMES,
    BaseBatteryModel,
    ElasticNetBaseline,
    GaussianProcessModel,
    RidgeBaseline,
    SVRBaseline,
    XGBoostModel,
)

LOGGER = logging.getLogger(__name__)
MODEL_TYPES = {
    "Ridge": RidgeBaseline,
    "ElasticNet": ElasticNetBaseline,
    "SVR": SVRBaseline,
    "GPR": GaussianProcessModel,
    "XGBoost": XGBoostModel,
}
MODEL_FILES = {name: f"{name.lower()}.joblib" for name in MODEL_TYPES}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _signature(data_csv: Path) -> dict:
    versions = {name: version(name) for name in (
        "numpy", "pandas", "scipy", "scikit-learn", "joblib",
    )}
    versions.update(python=platform.python_version(), xgboost=xgboost.__version__)
    return {
        "format_version": 1,
        "training_data_sha256": _sha256(data_csv),
        "model_code_sha256": _sha256(Path(models.__file__)),
        "features": FEATURE_NAMES,
        "target": "soh",
        "versions": versions,
    }


def _load_models(model_dir: Path, signature: dict) -> dict[str, BaseBatteryModel] | None:
    try:
        manifest = json.loads((model_dir / "manifest.json").read_text())
        if manifest["signature"] != signature or set(manifest["models"]) != set(MODEL_TYPES):
            return None
        # Check the complete set before deserializing any models.
        for name, filename in MODEL_FILES.items():
            artifact = manifest["models"][name]
            if artifact["file"] != filename or artifact["sha256"] != _sha256(model_dir / filename):
                return None
        fitted = {name: joblib.load(model_dir / filename) for name, filename in MODEL_FILES.items()}
        for name, model in fitted.items():
            if not isinstance(model, MODEL_TYPES[name]) or model.model is None:
                return None
            if not hasattr(model.scaler, "scale_"):
                return None
        return fitted
    except (OSError, ValueError, TypeError, KeyError, AttributeError,
            EOFError, ImportError, pickle.UnpicklingError):
        return None


def load_or_train_models(
    data_csv: str | Path = paths.FEATURES_CSV,
    model_dir: str | Path = paths.MODEL_DIR,
    *,
    retrain: bool = False,
) -> dict[str, BaseBatteryModel]:
    """Load matching artifacts, or train and save all five models with their scalers."""
    data_csv, model_dir = Path(data_csv), Path(model_dir)
    signature = _signature(data_csv)
    if not retrain:
        fitted = _load_models(model_dir, signature)
        if fitted is not None:
            LOGGER.info("Loaded five saved models from %s", model_dir)
            return fitted

    df = pd.read_csv(data_csv)
    X, y = df[FEATURE_NAMES].values, df["soh"].values
    fitted = {}
    for name, model_type in MODEL_TYPES.items():
        LOGGER.info("Training %s on %d cycles", name, len(df))
        fitted[name] = model_type().fit(X, y)

    model_dir.mkdir(parents=True, exist_ok=True)
    # Stage complete files, then publish the manifest last. Interrupted writes
    # cannot leave a partial artifact that is accepted on the next start.
    with TemporaryDirectory(prefix=".training-", dir=model_dir) as staging_dir:
        staging = Path(staging_dir)
        artifacts = {}
        for name, filename in MODEL_FILES.items():
            joblib.dump(fitted[name], staging / filename, compress=3)
            artifacts[name] = {"file": filename, "sha256": _sha256(staging / filename)}
        manifest = {
            "signature": signature,
            "trained_at_utc": datetime.now(timezone.utc).isoformat(),
            "training_rows": len(df),
            "batteries": sorted(df["battery_id"].unique().tolist()),
            "models": artifacts,
        }
        (staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        for filename in (*MODEL_FILES.values(), "manifest.json"):
            (staging / filename).replace(model_dir / filename)
    LOGGER.info("Saved five fitted models to %s", model_dir)
    return fitted
