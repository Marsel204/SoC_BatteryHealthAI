"""Stage 2 & 3: Baseline Models, Nonlinear Regressors, and LOBO Cross-Validation.

Implements:
1. Interpretable Linear Baselines: Ridge, ElasticNet
2. Kernel Baseline: Support Vector Regression (SVR)
3. Nonlinear Regressors: Gaussian Process Regression (GPR with epistemic uncertainty)
   and XGBoost.
4. Leave-One-Battery-Out (LOBO) Cross-Validation across B0005, B0006, B0007, and B0018.
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator
from sklearn.linear_model import RidgeCV, ElasticNetCV
from sklearn.svm import SVR
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import Matern, WhiteKernel, ConstantKernel
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from xgboost import XGBRegressor


FEATURE_NAMES = [
    "t_cc",
    "t_cv",
    "dq_dv_peak",
    "v_at_peak",
    "delta_T_max",
    "delta_V_ohmic",
    "Re",
    "Rct",
    "rest_time_hours",
]


class BaseBatteryModel(ABC):
    """Abstract base class for battery SoH estimation models."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.scaler = StandardScaler()
        self.model: Optional[BaseEstimator] = None

    @abstractmethod
    def fit(self, X: np.ndarray, y: np.ndarray) -> "BaseBatteryModel":
        """Fit model with standard scaling."""
        pass

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Predict target variable."""
        if self.model is None:
            raise RuntimeError(f"Model {self.name} is not fitted.")
        X_scaled = self.scaler.transform(X)
        return self.model.predict(X_scaled)

    @staticmethod
    def evaluate(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
        """Compute RMSE, MAE, R2, and Max Error."""
        rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
        mae = float(mean_absolute_error(y_true, y_pred))
        r2 = float(r2_score(y_true, y_pred))
        max_err = float(np.max(np.abs(y_true - y_pred)))
        return {"rmse": rmse, "mae": mae, "r2": r2, "max_error": max_err}


class RidgeBaseline(BaseBatteryModel):
    """Interpretable Ridge Regression with Cross-Validated L2 Regularization."""

    def __init__(self, alphas: Optional[np.ndarray] = None) -> None:
        super().__init__(name="Ridge")
        if alphas is None:
            alphas = np.logspace(-3, 3, 50)
        self.alphas = alphas

    def fit(self, X: np.ndarray, y: np.ndarray) -> "RidgeBaseline":
        X_scaled = self.scaler.fit_transform(X)
        self.model = RidgeCV(alphas=self.alphas)
        self.model.fit(X_scaled, y)
        return self

    def get_feature_coefficients(self) -> Dict[str, float]:
        """Return standardized coefficients (weights)."""
        if self.model is None:
            raise RuntimeError("Model is not fitted.")
        coefs = self.model.coef_
        return {name: float(coef) for name, coef in zip(FEATURE_NAMES, coefs)}

    def get_jacobian(self) -> np.ndarray:
        """Return Jacobian d(SoH_hat)/dX in original physical units."""
        if self.model is None:
            raise RuntimeError("Model is not fitted.")
        # d(y)/d(X) = coef / scaler.scale_
        return self.model.coef_ / self.scaler.scale_


class ElasticNetBaseline(BaseBatteryModel):
    """Interpretable ElasticNet with mixed L1/L2 penalties."""

    def __init__(self) -> None:
        super().__init__(name="ElasticNet")

    def fit(self, X: np.ndarray, y: np.ndarray) -> "ElasticNetBaseline":
        X_scaled = self.scaler.fit_transform(X)
        self.model = ElasticNetCV(
            l1_ratio=[0.1, 0.5, 0.7, 0.9, 0.99],
            alphas=np.logspace(-3, 2, 40),
            max_iter=5000,
            random_state=42,
        )
        self.model.fit(X_scaled, y)
        return self

    def get_feature_coefficients(self) -> Dict[str, float]:
        if self.model is None:
            raise RuntimeError("Model is not fitted.")
        coefs = self.model.coef_
        return {name: float(coef) for name, coef in zip(FEATURE_NAMES, coefs)}


class SVRBaseline(BaseBatteryModel):
    """Support Vector Regression with RBF Kernel."""

    def __init__(self, C: float = 10.0, epsilon: float = 0.1, gamma: str = "scale") -> None:
        super().__init__(name="SVR")
        self.C = C
        self.epsilon = epsilon
        self.gamma = gamma

    def fit(self, X: np.ndarray, y: np.ndarray) -> "SVRBaseline":
        X_scaled = self.scaler.fit_transform(X)
        self.model = SVR(C=self.C, epsilon=self.epsilon, gamma=self.gamma)
        self.model.fit(X_scaled, y)
        return self


class GaussianProcessModel(BaseBatteryModel):
    """Gaussian Process Regression with Matérn Kernel + White Noise Kernel."""

    def __init__(self, nu: float = 2.5, noise_level: float = 0.1) -> None:
        super().__init__(name="GPR")
        self.kernel = ConstantKernel(
            constant_value=1.0, constant_value_bounds=(1e-4, 1e5)
        ) * Matern(
            length_scale=1.0, length_scale_bounds=(1e-2, 1e3), nu=nu
        ) + WhiteKernel(
            noise_level=0.05, noise_level_bounds=(1e-6, 1e2)
        )

    def fit(self, X: np.ndarray, y: np.ndarray) -> "GaussianProcessModel":
        X_scaled = self.scaler.fit_transform(X)
        self.model = GaussianProcessRegressor(
            kernel=self.kernel,
            alpha=1e-6,
            n_restarts_optimizer=5,
            random_state=42,
            normalize_y=True,
        )
        self.model.fit(X_scaled, y)
        return self

    def predict_with_uncertainty(
        self, X: np.ndarray
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Predict predictive mean and standard deviation (sigma)."""
        if self.model is None:
            raise RuntimeError("GPR model is not fitted.")
        X_scaled = self.scaler.transform(X)
        mean, std = self.model.predict(X_scaled, return_std=True)
        return mean, std


class XGBoostModel(BaseBatteryModel):
    """Gradient Boosted Decision Trees Regressor."""

    def __init__(
        self,
        n_estimators: int = 120,
        max_depth: int = 3,
        learning_rate: float = 0.05,
        reg_alpha: float = 0.1,
        reg_lambda: float = 1.0,
    ) -> None:
        super().__init__(name="XGBoost")
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.learning_rate = learning_rate
        self.reg_alpha = reg_alpha
        self.reg_lambda = reg_lambda

    def fit(self, X: np.ndarray, y: np.ndarray) -> "XGBoostModel":
        X_scaled = self.scaler.fit_transform(X)
        self.model = XGBRegressor(
            n_estimators=self.n_estimators,
            max_depth=self.max_depth,
            learning_rate=self.learning_rate,
            reg_alpha=self.reg_alpha,
            reg_lambda=self.reg_lambda,
            random_state=42,
            n_jobs=1,
        )
        self.model.fit(X_scaled, y)
        return self


class BatteryLOBOEvaluator:
    """Leave-One-Battery-Out (LOBO) Cross-Validation Evaluator."""

    def __init__(
        self,
        df: pd.DataFrame,
        feature_cols: Optional[List[str]] = None,
        target_col: str = "soh",
    ) -> None:
        self.df = df.copy()
        self.feature_cols = feature_cols if feature_cols is not None else FEATURE_NAMES
        self.target_col = target_col
        self.batteries = sorted(list(self.df["battery_id"].unique()))

    def get_model_instances(self) -> Dict[str, BaseBatteryModel]:
        """Return fresh dictionary of all evaluated model instances."""
        return {
            "Ridge": RidgeBaseline(),
            "ElasticNet": ElasticNetBaseline(),
            "SVR": SVRBaseline(),
            "GPR": GaussianProcessModel(),
            "XGBoost": XGBoostModel(),
        }

    def evaluate_model(
        self, model_factory: Any, model_name: str
    ) -> Dict[str, Any]:
        """Perform 4-fold LOBO cross-validation for a specific model."""
        fold_results = []
        all_true = []
        all_pred = []

        for test_battery in self.batteries:
            train_mask = self.df["battery_id"] != test_battery
            test_mask = self.df["battery_id"] == test_battery

            X_train = self.df.loc[train_mask, self.feature_cols].values
            y_train = self.df.loc[train_mask, self.target_col].values
            X_test = self.df.loc[test_mask, self.feature_cols].values
            y_test = self.df.loc[test_mask, self.target_col].values
            test_cycles = self.df.loc[test_mask, "cycle"].values

            model = model_factory()
            model.fit(X_train, y_train)

            uncertainty = None
            if hasattr(model, "predict_with_uncertainty"):
                preds, stds = model.predict_with_uncertainty(X_test)
                uncertainty = stds
            else:
                preds = model.predict(X_test)

            metrics = BaseBatteryModel.evaluate(y_test, preds)

            fold_info = {
                "test_battery": test_battery,
                "n_train": len(X_train),
                "n_test": len(X_test),
                "metrics": metrics,
                "cycles": test_cycles,
                "y_true": y_test,
                "y_pred": preds,
                "uncertainty": uncertainty,
            }

            if hasattr(model, "get_feature_coefficients"):
                fold_info["coefficients"] = model.get_feature_coefficients()
            if hasattr(model, "get_jacobian"):
                fold_info["jacobian"] = model.get_jacobian()

            fold_results.append(fold_info)
            all_true.extend(y_test)
            all_pred.extend(preds)

        mean_rmse = float(np.mean([f["metrics"]["rmse"] for f in fold_results]))
        std_rmse = float(np.std([f["metrics"]["rmse"] for f in fold_results]))
        mean_mae = float(np.mean([f["metrics"]["mae"] for f in fold_results]))
        std_mae = float(np.std([f["metrics"]["mae"] for f in fold_results]))
        mean_r2 = float(np.mean([f["metrics"]["r2"] for f in fold_results]))
        std_r2 = float(np.std([f["metrics"]["r2"] for f in fold_results]))

        return {
            "model_name": model_name,
            "folds": fold_results,
            "mean_rmse": mean_rmse,
            "std_rmse": std_rmse,
            "mean_mae": mean_mae,
            "std_mae": std_mae,
            "mean_r2": mean_r2,
            "std_r2": std_r2,
        }

    def evaluate_all_models(self) -> Dict[str, Dict[str, Any]]:
        """Evaluate Ridge, ElasticNet, SVR, GPR, and XGBoost under LOBO."""
        models = self.get_model_instances()
        overall_results = {}
        for name in models.keys():
            factory = lambda n=name: self.get_model_instances()[n]
            overall_results[name] = self.evaluate_model(factory, name)
        return overall_results
