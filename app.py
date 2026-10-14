"""Unified Application Launcher for Battery SoH Prognostics & Testing UI.

Starts the FastAPI backend server and serves the single-page interactive UI.

Usage:
    python app.py [--host 127.0.0.1] [--port 8000] [--open-browser] [--reload]
"""

import argparse
import sys
import webbrowser
import threading
import time
import uvicorn


def parse_args():
    parser = argparse.ArgumentParser(
        description="Physics-Informed Battery SoH Prognostics Application & UI"
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Host address to bind (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to bind server to (default: 8000)",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload on code modifications",
    )
    parser.add_argument(
        "--open-browser",
        action="store_true",
        help="Automatically open default browser to UI",
    )
    return parser.parse_args()


def open_browser_after_delay(url: str, delay: float = 1.0):
    time.sleep(delay)
    webbrowser.open(url)


def main():
    args = parse_args()
    url = f"http://{args.host}:{args.port}"

    print("=" * 72)
    print("🔋 PHYSICS-INFORMED BATTERY SOH PROGNOSTICS APPLICATION")
    print("=" * 72)
    print(f"  Interactive Testing UI:   {url}")
    print(f"  Interactive API Docs:     {url}/docs")
    print(f"  Dataset Status:           632 Synchronized Cycles (B0005, B0006, B0007, B0018)")
    print(f"  Active Models:            Ridge, ElasticNet, SVR, GPR (Uncertainty), XGBoost")
    print("=" * 72)
    print("Press CTRL+C to terminate the application.\n")

    if args.open_browser:
        threading.Thread(
            target=open_browser_after_delay, args=(url,), daemon=True
        ).start()

    uvicorn.run(
        "src.api:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
