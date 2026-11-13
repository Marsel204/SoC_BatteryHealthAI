"""Cache the existing five models' leave-one-battery-out predictions for the offline HTML.

Run from the repository root: .venv/bin/python Code/analysis/model_results.py
Check an existing artifact without fitting: add --verify-only.
"""
from __future__ import annotations

import argparse
import hashlib
from importlib.metadata import version
import json
import math
from pathlib import Path
import sys

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "data/features_all_batteries.csv"
IMPLEMENTATION = ROOT / "Code/app/server/models.py"
OUTPUT = ROOT / "Reports/model_results.json"
BATTERIES = ["B0005", "B0006", "B0007", "B0018"]
MODEL_NAMES = ["Ridge", "ElasticNet", "SVR", "GPR", "XGBoost"]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def verify_sources() -> tuple[str, str]:
    data_manifest = json.loads((ROOT / "Code/analysis/source_manifest.json").read_text())
    app_manifest = json.loads((ROOT / "Code/app/source_manifest.json").read_text())
    source_hash, implementation_hash = sha256(SOURCE), sha256(IMPLEMENTATION)
    data_record = next(r for r in data_manifest["files"] if r["path"] == "data/features_all_batteries.csv")
    model_record = next(r for r in app_manifest["files"] if r["local_path"] == "Code/app/server/models.py")
    require(source_hash == data_record["sha256"], "Training table differs from the pinned source.")
    require(not model_record["modified"] and implementation_hash == model_record["upstream_sha256"],
            "Model implementation differs from the pinned source.")
    return source_hash, implementation_hash


def jsonable(value):
    if isinstance(value, np.ndarray):
        return jsonable(value.tolist())
    if isinstance(value, np.generic):
        return jsonable(value.item())
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, float):
        require(math.isfinite(value), "Non-finite model result cannot be published.")
    return value


def check_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    """Independent arithmetic, separate from the evaluator's sklearn metrics."""
    error = predicted - actual
    return {
        "rmse": float(np.sqrt(np.mean(error ** 2))),
        "mae": float(np.mean(np.abs(error))),
        "r2": float(1 - np.sum(error ** 2) / np.sum((actual - np.mean(actual)) ** 2)),
        "max_error": float(np.max(np.abs(error))),
    }


def validate(payload: dict, frame: pd.DataFrame, features: list[str]) -> None:
    source_hash, implementation_hash = verify_sources()
    require(payload["source_file"] == "data/features_all_batteries.csv", "Unexpected source path.")
    require(payload["implementation_file"] == "Code/app/server/models.py", "Unexpected model path.")
    require(payload["source_sha256"] == source_hash, "Cached training-table hash is stale.")
    require(payload["implementation_sha256"] == implementation_hash, "Cached implementation hash is stale.")
    require(payload["validation"] == "leave-one-battery-out", "Wrong evaluation scheme.")
    require(payload["feature_names"] == features and payload["batteries"] == BATTERIES,
            "Feature order or battery identities differ.")
    require(set(payload["models"]) == set(MODEL_NAMES), "The artifact must contain all five models.")
    expected_keys = set(zip(frame.battery_id, frame.cycle))
    require(len(frame) == len(expected_keys) == 632, "Expected 632 unique source cycles.")
    for name, result in payload["models"].items():
        require(result["model_name"] == name, f"{name}: wrong model label.")
        folds = result["folds"]
        require(len(folds) == 4 and {f["test_battery"] for f in folds} == set(BATTERIES),
                f"{name}: expected one held-out fold per battery.")
        seen = set()
        metrics = []
        for fold in folds:
            battery = fold["test_battery"]
            held_out = frame[frame.battery_id == battery]
            train = frame[frame.battery_id != battery]
            train_keys = set(zip(train.battery_id, train.cycle))
            test_keys = {(battery, int(c)) for c in fold["cycles"]}
            require(not train_keys.intersection(test_keys) and not seen.intersection(test_keys),
                    f"{name}/{battery}: overlapping training or test cycles.")
            require(fold["n_train"] == len(train) and fold["n_test"] == len(held_out),
                    f"{name}/{battery}: wrong fold sizes.")
            np.testing.assert_array_equal(fold["cycles"], held_out.cycle.to_numpy())
            actual, predicted = np.asarray(fold["y_true"], dtype=float), np.asarray(fold["y_pred"], dtype=float)
            np.testing.assert_array_equal(actual, held_out.soh.to_numpy())
            require(predicted.shape == actual.shape and np.isfinite(predicted).all(),
                    f"{name}/{battery}: invalid predictions.")
            independent = check_metrics(actual, predicted)
            for key, value in independent.items():
                require(math.isclose(fold["metrics"][key], value, rel_tol=1e-10, abs_tol=1e-12),
                        f"{name}/{battery}: {key} disagrees with predictions.")
            uncertainty = fold["uncertainty"]
            if name == "GPR":
                sigma = np.asarray(uncertainty, dtype=float)
                require(sigma.shape == actual.shape and np.isfinite(sigma).all() and (sigma >= 0).all(),
                        f"{name}/{battery}: invalid predictive standard deviations.")
            else:
                require(uncertainty is None, f"{name}: unexpected uncertainty values.")
            seen.update(test_keys)
            metrics.append(independent)
        require(seen == expected_keys, f"{name}: incomplete held-out coverage.")
        for key in ("rmse", "mae", "r2"):
            values = np.asarray([m[key] for m in metrics])
            for prefix, value in (("mean", np.mean(values)), ("std", np.std(values))):
                require(math.isclose(result[f"{prefix}_{key}"], value, rel_tol=1e-10, abs_tol=1e-12),
                        f"{name}: wrong aggregate {prefix}_{key}.")


class TrainingAudit:
    """Check the evaluator's actual fit inputs before forwarding to an unchanged model."""

    def __init__(self, model, frame: pd.DataFrame, features: list[str], held_out: str):
        self.model = model
        self.expected = frame[frame.battery_id != held_out]
        self.features = features
        self.fitted = False

    def fit(self, x, y):
        np.testing.assert_array_equal(x, self.expected[self.features].to_numpy())
        np.testing.assert_array_equal(y, self.expected.soh.to_numpy())
        self.model.fit(x, y)
        self.fitted = True
        return self

    def __getattr__(self, name):
        return getattr(self.model, name)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true", help="Validate the saved results without refitting.")
    args = parser.parse_args()
    source_hash, implementation_hash = verify_sources()
    sys.path.insert(0, str(ROOT / "Code/app"))
    from server.models import BatteryLOBOEvaluator, FEATURE_NAMES

    frame = pd.read_csv(SOURCE)
    require(len(frame) == 632 and sorted(frame.battery_id.unique()) == BATTERIES,
            "Training data does not match the pinned four-cell snapshot.")
    require(not frame.duplicated(["battery_id", "cycle"]).any(), "Duplicated source cycles.")
    require(np.isfinite(frame[FEATURE_NAMES + ["soh"]].to_numpy(dtype=float)).all(),
            "Training table contains missing or non-finite values.")
    np.testing.assert_allclose(frame.soh, frame.capacity * 50, rtol=0, atol=1e-9)
    if args.verify_only:
        validate(json.loads(OUTPUT.read_text()), frame, FEATURE_NAMES)
        print("Verified five models, 20 disjoint folds, 3,160 held-out predictions and all metrics/hashes.")
        return

    evaluator = BatteryLOBOEvaluator(frame)
    payload = {
        "source_file": "data/features_all_batteries.csv", "source_sha256": source_hash,
        "implementation_file": "Code/app/server/models.py", "implementation_sha256": implementation_hash,
        "validation": "leave-one-battery-out", "feature_names": FEATURE_NAMES, "batteries": BATTERIES,
        "software": {"python": sys.version.split()[0], **{p: version(p) for p in
                     ("numpy", "pandas", "scipy", "scikit-learn", "xgboost-cpu")}},
        "models": {},
    }
    for name in MODEL_NAMES:
        print(f"Fitting {name}: four held-out battery folds...", flush=True)
        audits = []

        def factory():
            model = TrainingAudit(evaluator.get_model_instances()[name], frame, FEATURE_NAMES,
                                  BATTERIES[len(audits)])
            audits.append(model)
            return model

        result = evaluator.evaluate_model(factory, name)
        require(len(audits) == 4 and all(m.fitted for m in audits), f"{name}: missing training audits.")
        payload["models"][name] = jsonable(result)
        print(f"  {name}: mean RMSE {result['mean_rmse']:.6f}, MAE {result['mean_mae']:.6f}, R² {result['mean_r2']:.6f}", flush=True)
    validate(payload, frame, FEATURE_NAMES)
    encoded = json.dumps(payload, indent=2, allow_nan=False) + "\n"
    validate(json.loads(encoded), frame, FEATURE_NAMES)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(encoded)
    print(f"Saved {OUTPUT}: five models, 20 disjoint folds and 3,160 held-out predictions.")


if __name__ == "__main__":
    main()
