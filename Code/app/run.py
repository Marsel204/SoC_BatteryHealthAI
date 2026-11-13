"""Launcher for the Battery SoH app: a Data analysis tab and a Model tab in one window.

Usage:
    .venv/bin/python Code/app/run.py [--host 127.0.0.1] [--port 8010] [--open-browser] [--reload]

Adapted from the upstream app.py (SoC_BatteryHealthAI@043ec72).
"""
from __future__ import annotations

import argparse
import sys
import threading
import time
import webbrowser
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_DIR))

import uvicorn  # noqa: E402

from server import paths  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Battery SoH: Data analysis -> Model app")
    parser.add_argument("--host", default="127.0.0.1", help="address to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8010, help="port to bind (default: 8010)")
    parser.add_argument("--reload", action="store_true", help="restart on code changes")
    parser.add_argument("--open-browser", action="store_true", help="open the app in a browser")
    return parser.parse_args()


def missing_inputs() -> list[str]:
    """Inputs the app needs but never creates. They come from Code/analysis/run_eda.py."""
    required = [paths.FEATURES_CSV, paths.OBSERVED_CSV, paths.DATA_CONTRACTS_JSON,
                *[paths.RAW_DIR / f"{b}.mat" for b in ("B0005", "B0006", "B0007", "B0018")]]
    return [str(p.relative_to(paths.PROJECT_ROOT)) for p in required if not p.exists()]


def open_browser_after_delay(url: str, delay: float = 1.5) -> None:
    time.sleep(delay)
    webbrowser.open(url)


def main() -> int:
    args = parse_args()
    missing = missing_inputs()
    if missing:
        print("Missing inputs (run Code/analysis/run_eda.py first):", file=sys.stderr)
        for name in missing:
            print(f"  - {name}", file=sys.stderr)
        return 1

    url = f"http://{args.host}:{args.port}"
    print("=" * 72)
    print("BATTERY SOH: DATA ANALYSIS -> MODEL")
    print("=" * 72)
    print(f"  App:        {url}")
    print(f"  API docs:   {url}/docs")
    print("  Data:       632 aligned cycles (B0005, B0006, B0007, B0018)")
    print("  Models:     Ridge, ElasticNet, SVR, GPR (uncertainty), XGBoost")
    print("=" * 72)
    print("Starting up: the five models are fitted once at launch. Press CTRL+C to stop.\n")

    if args.open_browser:
        threading.Thread(target=open_browser_after_delay, args=(url,), daemon=True).start()

    uvicorn.run(
        "server.api:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        reload_dirs=[str(APP_DIR)] if args.reload else None,
        app_dir=str(APP_DIR),
        log_level="info",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
