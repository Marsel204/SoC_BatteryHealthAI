"""Build the offline learning UI from saved, reproducible analysis outputs."""
from pathlib import Path
import json
import base64

import pandas as pd

ROOT = Path(__file__).resolve().parent
ANALYSIS = ROOT.parent
REPO = ANALYSIS.parents[1]
RESULTS = REPO / "Reports"
OUTPUT = REPO / "Web" / "HTML" / "learning" / "index.html"
FEATURES = ["t_cc", "t_cv", "dq_dv_peak", "v_at_peak", "delta_T_max",
            "delta_V_ohmic", "Re", "Rct", "rest_time_hours"]


def main():
    payload = {}
    for name in ["autocorrelation", "mutual_information", "feature_overlap", "coverage", "uncertainty"]:
        path = RESULTS / "learning" / f"{name}.json"
        full = json.loads(path.read_text())
        # Detailed audits remain in the scientific JSON beside the dashboard.
        # The browser needs the reproducible results and interpretation limits.
        payload[name] = {k:v for k,v in full.items() if k in {
            "technique", "method", "statistic", "caveats", "records", "summary",
            "features", "pairs", "synthetic", "support", "temporal_support"}}
    payload["contracts"] = json.loads((RESULTS / "data_contracts.json").read_text())
    payload["dataset"] = {"csv": (RESULTS / "cycles_observed_flagged.csv").read_text(),
                          "filename": "battery-observed-cycles.csv"}
    columns = ["battery_id", "cycle", "capacity"] + FEATURES
    frame = pd.read_csv(RESULTS / "cycles_observed_flagged.csv")
    payload["cycles"] = {"columns": columns, "rows": json.loads(frame[columns].to_json(orient="values", double_precision=6))}
    payload["correlations"] = json.loads(pd.read_csv(RESULTS / "correlations.csv").query("version == 'observed_flagged'").to_json(orient="records", double_precision=6))
    payload["provenance"] = json.loads((ANALYSIS / "source_manifest.json").read_text())
    # Preserve full numerical precision in scientific JSON/CSV. Round only the
    # browser's display payload to six decimal places to keep the file compact.
    def rounded(value):
        if isinstance(value, dict): return {k:rounded(v) for k,v in value.items()}
        if isinstance(value, list): return [rounded(v) for v in value]
        if isinstance(value, float): return value if 0 < abs(value) < 1e-5 else round(value, 6)
        return value
    data = json.dumps(rounded(payload), separators=(",", ":"), allow_nan=False).replace("<", "\\u003c")
    template = (ROOT / "index.template.html").read_text()
    license_text = (ROOT / "assets" / "OFL.txt").read_text()
    assert "*/" not in license_text
    output = template.replace("/*__STYLE__*/", "/* Manrope font license\n"+license_text+"\n*/\n"+(ROOT / "style.css").read_text())
    for subset in ["latin", "greek"]:
        filename = f"manrope-{subset}.woff2"
        encoded = base64.b64encode((ROOT / "assets" / filename).read_bytes()).decode()
        output = output.replace(f'url("assets/{filename}")', f'url("data:font/woff2;base64,{encoded}")')
    output = output.replace("/*__DATA__*/", "const DATA="+data+";")
    output = output.replace("/*__APP__*/", (ROOT / "app.js").read_text())
    output = output.replace("/*__DATASET__*/", (ROOT / "dataset.js").read_text())
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(output)
    print(f"Built {OUTPUT} ({len(output.encode()):,} bytes)")


if __name__ == "__main__": main()
