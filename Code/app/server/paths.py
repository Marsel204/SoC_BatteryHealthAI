"""Filesystem layout shared by the server modules.

The app lives in <repo>/Code/app. It reads Reports/ outputs and the original
checksummed data/ and src/ files at repository root. All inputs are read-only.
"""
from __future__ import annotations

import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = APP_DIR.parents[1]
ANALYSIS_DIR = PROJECT_ROOT / "Code" / "analysis"

# Pinned snapshot of the upstream SoC_BatteryHealthAI repository (see source_manifest.json).
SOURCE_DIR = PROJECT_ROOT
FEATURES_CSV = SOURCE_DIR / "data" / "features_all_batteries.csv"
RAW_DIR = SOURCE_DIR / "data" / "raw"
SOURCE_MANIFEST = ANALYSIS_DIR / "source_manifest.json"

# Outputs of the data analysis.
RESULTS_DIR = PROJECT_ROOT / "Reports"
HTML_DIR = PROJECT_ROOT / "Web" / "HTML"
LEARNING_DIR = HTML_DIR / "learning"
OBSERVED_CSV = RESULTS_DIR / "cycles_observed_flagged.csv"
CORRELATIONS_CSV = RESULTS_DIR / "feature_target_correlations.csv"
DATA_CONTRACTS_JSON = RESULTS_DIR / "data_contracts.json"
SCATTERPLOTS_PY = ANALYSIS_DIR / "scatterplots.py"

# The app's own assets.
STATIC_DIR = APP_DIR / "static"
FIGURES_DIR = PROJECT_ROOT / "outputs" / "figures"

# The pinned loader and feature modules import each other as `src.*`. Expose them
# unchanged rather than keeping a second copy that could drift from the checksummed one.
if str(SOURCE_DIR) not in sys.path:
    sys.path.insert(0, str(SOURCE_DIR))
