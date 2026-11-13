"""Build a small, offline feature-versus-SoH scatterplot report.

Uses the existing observed, quality-flagged table; does not impute or train.
Run from the project root: python3 Code/analysis/scatterplots.py
Only Python's standard library is required.
"""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from statistics import correlation


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
RESULTS = REPO / "Reports"
INPUT = RESULTS / "cycles_observed_flagged.csv"
OUTPUT = REPO / "Web" / "HTML" / "scatterplots.html"
FEATURES = [
    ("t_cc", "CC charge duration", "CC duration (s)"),
    ("t_cv", "CV charge duration", "CV duration (s)"),
    ("dq_dv_peak", "Incremental-capacity peak", "Peak dQ/dV (Ah/V)"),
    ("v_at_peak", "Voltage at the peak", "Peak voltage (V)"),
    ("delta_T_max", "Discharge temperature rise", "Temperature rise (°C)"),
    ("delta_V_ohmic", "Initial discharge voltage drop", "Voltage drop (V)"),
    ("Re", "Electrolyte resistance", "Resistance (Ω)"),
    ("Rct", "Charge-transfer resistance", "Resistance (Ω)"),
    ("rest_time_hours", "Interval between discharges", "Discharge interval (h)"),
]
COLORS = ["var(--chart-1, #2671bb)", "var(--chart-2, #d47717)",
          "var(--chart-3, #28967b)", "var(--chart-4, #a05db5)"]


def ranks(values):
    """Average ranks for tied values, as used by Spearman correlation."""
    result = [0.0] * len(values)
    order = sorted(range(len(values)), key=values.__getitem__)
    start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and values[order[end]] == values[order[start]]:
            end += 1
        rank = (start + 1 + end) / 2
        for i in order[start:end]:
            result[i] = rank
        start = end
    return result


def association(x, y):
    if len(x) < 3 or len(set(x)) < 2 or len(set(y)) < 2:
        return None, None
    return correlation(x, y), correlation(ranks(x), ranks(y))


def load_rows():
    if not INPUT.exists():
        raise SystemExit("Run Code/analysis/run_eda.py first to create the observed table.")
    rows, identities = [], set()
    with INPUT.open(newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"battery_id", "cycle", "soh", "capacity", "charge_quality_flag"}
        required.update(f[0] for f in FEATURES)
        if missing := required - set(reader.fieldnames or []):
            raise ValueError(f"Missing columns: {sorted(missing)}")
        for source in reader:
            key = source["battery_id"], int(source["cycle"])
            if key in identities:
                raise ValueError(f"Duplicate battery/cycle: {key}")
            identities.add(key)
            numeric = {}
            for column in ["capacity", "soh"] + [f[0] for f in FEATURES]:
                value = float(source[column]) if source[column] else math.nan
                numeric[column] = value if math.isfinite(value) else None
            if numeric["capacity"] is None or numeric["soh"] is None:
                raise ValueError(f"Missing target: {key}")
            if not math.isclose(numeric["soh"], numeric["capacity"] * 50,
                                rel_tol=1e-10, abs_tol=1e-8):
                raise ValueError(f"SoH does not match the rated 2 Ah reference: {key}")
            flagged = source["charge_quality_flag"].lower() == "true"
            if flagged and any(numeric[f[0]] is not None for f in FEATURES[:4]):
                raise ValueError(f"Flagged charge measurements are not masked: {key}")
            rows.append({"battery_id": key[0], "cycle": key[1], **numeric,
                         "flagged": flagged})
    if not rows:
        raise ValueError("The observed table is empty.")
    return rows


def main():
    rows = load_rows()
    batteries = sorted({r["battery_id"] for r in rows})
    stats = []
    for battery in ["ALL", *batteries]:
        group = [r for r in rows if battery == "ALL" or r["battery_id"] == battery]
        for feature, _, _ in FEATURES:
            pairs = [(r[feature], r["soh"]) for r in group if r[feature] is not None]
            x, y = ([list(v) for v in zip(*pairs)] if pairs else ([], []))
            pearson, spearman = association(x, y)
            stats.append({"target": "soh", "battery_id": battery, "feature": feature,
                          "n_pairs": len(pairs), "omitted_pairs": len(group) - len(pairs),
                          "pearson_r": pearson, "spearman_rho": spearman})
    RESULTS.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    summary = RESULTS / "feature_target_correlations.csv"
    with summary.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(stats[0]))
        writer.writeheader()
        writer.writerows(stats)
    # Compact positional rows retain every observation, with no rounding or sampling.
    payload = {"features": FEATURES, "batteries": batteries, "colors": COLORS,
               "rows": [[r["battery_id"], r["cycle"], r["soh"],
                         *[r[f[0]] for f in FEATURES]] for r in rows],
               "stats": stats, "flagged": sum(r["flagged"] for r in rows)}
    document = HTML.replace("__DATA__", json.dumps(payload, allow_nan=False)
                            .replace("<", "\\u003c"))
    OUTPUT.write_text(document, encoding="utf-8")
    print(f"Built {OUTPUT}: {len(rows)} cycles, {len(FEATURES)} features, "
          f"{len(batteries)} batteries. Summary: {summary.name}")


HTML = """<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Battery features versus state of health</title>
<style>
:root{color-scheme:light dark;--foreground:light-dark(#17212b,#e6eaf0);--muted:light-dark(#52616e,#a6b2c0);--border:light-dark(#d7dfe6,#3e4a58);--card:light-dark(#fff,#202a35);--ring:light-dark(#2671bb,#7fbbff);--font-sans:system-ui,sans-serif;--font-mono:ui-monospace,monospace;--radius:8px}
*{box-sizing:border-box}body{margin:0;color:var(--foreground);font:14px/1.5 var(--font-sans)}
p{margin:0 0 10px}.muted{color:var(--muted)}
.controls,.legend{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0}
select{font:inherit;color:var(--foreground);background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:6px 10px}
select:focus-visible,input:focus-visible{outline:2px solid var(--ring);outline-offset:3px}
.legend span{display:inline-flex;align-items:center;gap:6px;font-size:12px}.swatch{width:9px;height:9px;border-radius:50%;display:inline-block}
.plots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 16px;margin:18px 0}
.plot{min-width:0}h2{font-size:14px;font-weight:600;margin:0}.stat{font:12px/1.6 var(--font-mono);color:var(--muted)}
svg{width:100%;height:205px;display:block;overflow:visible}svg text{fill:var(--muted);font:11px var(--font-sans)}
.footnote{font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:12px}
details{font-size:12px;color:var(--muted);margin:10px 0}summary{cursor:pointer}details p{margin-top:8px}
@media(min-width:1050px){.plots{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:520px){.plots{grid-template-columns:minmax(0,1fr)}}
@media print{.plots{grid-template-columns:repeat(3,minmax(0,1fr))}.plot{break-inside:avoid}}
</style>
<body>
<p>Explore <a href="clustering.html">similar cycles and related features with clustering</a>.</p>
<p><strong>Target: state of health (SoH, %)</strong> = measured capacity / 2 Ah × 100.</p>
<p class="muted">Each dot is one discharge cycle. Color identifies the battery. Hover over a dot for its cycle and values.</p>
<div class="controls">
 <label>Battery <select id="battery" aria-label="Filter all scatterplots by battery"></select></label>
 <label><input id="log" type="checkbox"> Log scale for discharge interval</label>
</div>
<div id="legend" class="legend" aria-label="Battery colors"></div>
<p id="coverage" class="muted" aria-live="polite"></p>
<div id="plots" class="plots"></div>
<div class="footnote">
<p><strong>Reading the numbers:</strong> r is Pearson correlation (a straight-line relationship); ρ is Spearman correlation (a consistently increasing or decreasing relationship). Both range from −1 to +1. Positive means higher feature values accompany higher SoH; negative means they accompany lower SoH. Near zero means little association of that type.</p>
<p id="quality"></p>
<p>Battery cycles share aging trends; these are descriptive relationships, not evidence of causation or predictive accuracy. Filter by battery to compare relationships within a cell.</p>
<details><summary>Measurement timing and source</summary>
<p>Re and Rct retain the existing nearest-impedance alignment, which can use later measurements. Temperature rise requires the full discharge; voltage drop requires the initial load step. The discharge interval includes charging and is not pure idle rest. These plots do not establish which features are available at a prediction cutoff.</p>
<p>Source: Reports/cycles_observed_flagged.csv, generated by Code/analysis/run_eda.py from the pinned battery data. Capacity is excluded from the features because it directly defines SoH. Values above 100% are preserved.</p>
</details>
</div>
<noscript>This report needs JavaScript to draw the scatterplots.</noscript>
<script>
const D=__DATA__;
const NS='http://www.w3.org/2000/svg';
const $=id=>document.getElementById(id);
function el(tag,attrs={},text){const node=document.createElementNS(NS,tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;return node;}
function signed(value){return value===null?'n/a':(value>=0?'+':'')+value.toFixed(3);}
function tick(value){const v=Math.abs(value)<1e-12?0:value;return v.toLocaleString('en-US',{maximumFractionDigits:Math.abs(v)<1?3:Math.abs(v)<10?2:Math.abs(v)<100?1:0});}
function extent(values){const lo=Math.min(...values),hi=Math.max(...values),pad=(hi-lo||Math.abs(lo)*.1||1)*.055;return [lo-pad,hi+pad];}
const targetRange=extent(D.rows.map(r=>r[2]));
const color=b=>D.colors[D.batteries.indexOf(b)%D.colors.length];
for(const b of ['ALL',...D.batteries]){const option=document.createElement('option');option.value=b;option.textContent=b==='ALL'?'All batteries':b;$('battery').append(option);}
for(const [i,f]of D.features.entries()){
 const section=document.createElement('section');section.className='plot';
 const title=document.createElement('h2');title.textContent=f[1];section.append(title);
 const stat=document.createElement('div');stat.className='stat';stat.id='stat-'+i;section.append(stat);
 const svg=el('svg',{id:'plot-'+i,role:'img','aria-label':f[1]+' versus state of health'});section.append(svg);$('plots').append(section);
}
function draw(){
 const battery=$('battery').value,rows=D.rows.filter(r=>battery==='ALL'||r[0]===battery);
 $('coverage').textContent=rows.length+' cycles · nine features · common SoH axis across all plots and battery selections';
 $('quality').textContent=D.flagged+' cycles have four flagged charge measurements omitted. Each panel uses its available feature–target pairs (n); remaining feature measurements and targets are retained. No interpolation, imputation, or model fitting.';
 $('legend').replaceChildren();
 for(const b of D.batteries){if(battery!=='ALL'&&battery!==b)continue;const item=document.createElement('span'),swatch=document.createElement('i');swatch.className='swatch';swatch.style.background=color(b);item.append(swatch,document.createTextNode(b));$('legend').append(item);}
 D.features.forEach((f,i)=>{
  const svg=$('plot-'+i);svg.replaceChildren();
  const pairs=rows.filter(r=>Number.isFinite(r[i+3])&&Number.isFinite(r[2]));
  const stat=D.stats.find(s=>s.battery_id===battery&&s.feature===f[0]);
  $('stat-'+i).textContent=f[0]+' · n='+pairs.length+' · r '+signed(stat.pearson_r)+' · ρ '+signed(stat.spearman_rho);
  const w=Math.max(svg.clientWidth,240),h=205,left=45,right=12,top=12,bottom=46,pw=w-left-right,ph=h-top-bottom;
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  if(!pairs.length){svg.append(el('text',{x:w/2,y:h/2,'text-anchor':'middle'},'No observed pairs'));return;}
  const log=f[0]==='rest_time_hours'&&$('log').checked;
  const transform=x=>log?Math.log1p(x):x,inverse=x=>log?Math.expm1(x):x;
  let [xmin,xmax]=extent(pairs.map(r=>transform(r[i+3])));
  if(f[0]==='rest_time_hours')xmin=Math.max(0,xmin);
  const [ymin,ymax]=targetRange;
  const sx=x=>left+(transform(x)-xmin)/(xmax-xmin)*pw,sy=y=>top+(ymax-y)/(ymax-ymin)*ph;
  const desc=el('desc',{},`${pairs.length} observed pairs for ${battery}. Pearson r ${signed(stat.pearson_r)}; Spearman rho ${signed(stat.spearman_rho)}.`);svg.append(desc);
  for(let j=0;j<=3;j++){
   const y=ymin+(ymax-ymin)*j/3,tx=xmin+(xmax-xmin)*j/3,x=left+pw*j/3;
   svg.append(el('line',{x1:left,y1:sy(y),x2:w-right,y2:sy(y),stroke:'var(--border)','stroke-width':.7}));
   svg.append(el('text',{x:left-6,y:sy(y)+4,'text-anchor':'end'},tick(y)));
   svg.append(el('text',{x,y:h-bottom+17,'text-anchor':'middle'},tick(inverse(tx))));
  }
  svg.append(el('line',{x1:left,y1:top,x2:left,y2:h-bottom,stroke:'var(--border)'}));
  svg.append(el('line',{x1:left,y1:h-bottom,x2:w-right,y2:h-bottom,stroke:'var(--border)'}));
  for(const row of pairs){const point=el('circle',{cx:sx(row[i+3]),cy:sy(row[2]),r:2.5,fill:color(row[0]),opacity:.55});point.append(el('title',{},`${row[0]} · cycle ${row[1]}\n${f[0]}: ${row[i+3].toPrecision(6)}\nSoH: ${row[2].toFixed(2)}%`));svg.append(point);}
  svg.append(el('text',{x:left+pw/2,y:h-7,'text-anchor':'middle'},f[2]+(log?' · log(1+x)':'')));
  const cy=top+ph/2;svg.append(el('text',{x:12,y:cy,'text-anchor':'middle',transform:`rotate(-90 12 ${cy})`},'SoH (%)'));
 });
}
$('battery').addEventListener('change',draw);$('log').addEventListener('change',draw);
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(draw,80);});draw();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    main()
