# Physics-Informed State of Health (SoH) Estimation for Lithium-Ion Batteries
### NASA Prognostics Center of Excellence (PCoE) Battery Aging Dataset (`B0005`, `B0006`, `B0007`, `B0018`)

A 4-stage engineering pipeline and interactive testing application for State of Health (SoH) prognostics combining electrochemical thermodynamics with machine learning.

---

## 1. Project Overview & Architecture

```
battery_soh_prognostics/
├── app.py                             # Unified CLI & web application launcher
├── pytest.ini                         # Pytest configuration & warning filters
├── run_pipeline.py                    # End-to-end 4-stage pipeline execution
├── data/
│   ├── raw/                           # Raw NASA MATLAB structs (B0005.mat - B0018.mat)
│   └── features_all_batteries.csv     # Extracted 7 physics features across 632 aligned cycles
├── outputs/
│   └── figures/                       # Publication-grade figures (300 DPI)
├── src/
│   ├── __init__.py
│   ├── api.py                         # FastAPI REST application & inference engine
│   ├── data_loader.py                 # Sequential operation alignment, rest-time parsing
│   ├── feature_engineering.py         # 7 physical features, Savitzky-Golay / uniform binning dQ/dV
│   ├── models.py                      # LOBO cross-validation, Ridge, ElasticNet, SVR, GPR, XGBoost
│   ├── analysis_plots.py              # Visualizations, SHAP, Jacobian sensitivities, physical proofs
│   └── static/                        # Interactive Single-Page Web Dashboard
│       ├── index.html                 # Semantic testing UI layout
│       ├── style.css                  # Apple-inspired clean responsive stylesheet
│       └── app.js                     # Real-time Chart.js controller & API client
└── tests/
    ├── test_api.py                    # Unit & integration tests for REST API endpoints
    ├── test_data_loader.py            # Unit tests for alignment and timestamps
    ├── test_feature_engineering.py    # Unit tests for physical features and dQ/dV
    └── test_models.py                 # Unit tests for LOBO, GPR uncertainty, and Baselines
```

---

## 2. Interactive Testing Web UI & REST API

The project includes an interactive web application designed to test models and explore electrochemical features in real-time.

### Starting the Web UI
```bash
# Activate environment
source .venv/bin/activate

# Launch the interactive server
python app.py --port 8000
```
- **Web UI Interface:** [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **Interactive OpenAPI Documentation:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### UI Capabilities:
1. **🧪 Model Testing & Sensitivity Workbench:**
   - Real-time sliders for all 9 degradation parameters ($t_{\text{cc}}$, $t_{\text{cv}}$, $(dQ/dV)_{\text{peak}}$, $V_{\text{at\_peak}}$, $\Delta T_{\max}$, $\Delta V_{\text{ohmic}}$, $R_e$, $R_{\text{ct}}$, $t_{\text{rest}}$).
   - Instant aging regime presets: *Fresh Cell* (92.6% SoH), *Mid-Life* (82.0% SoH), *Near-EoL* (70.5% SoH), *Degraded* (64.5% SoH), and *Regeneration Post-Rest* (+0.04 Ah recovery after 309.5h rest).
   - Live multi-model comparison across Ridge, ElasticNet, SVR, XGBoost, and GPR.
   - Gaussian Process 95% epistemic confidence intervals ($\pm 1.96\sigma$).
   - Dynamic health status badges (Optimal, Aging, Critical/EoL).
   - Real-time analytical Jacobian bar chart ($\partial \widehat{\text{SoH}} / \partial x_i$).

2. **📈 NASA Cycle & Waveform Explorer:**
   - Cell selector (`B0005`, `B0006`, `B0007`, `B0018`) and cycle scrubber slider ($2 \dots 168$).
   - Synchronized CC-CV charging curves (Voltage & Current) with cutoff markers.
   - Smoothed Incremental Capacity ($dQ/dV$) phase transition profiles.
   - One-click **"Load into Simulator"** button transferring raw cycle features directly to the model workbench.

3. **📊 LOBO Benchmark & Figure Gallery:**
   - Leave-One-Battery-Out cross-validation performance metrics.
   - High-resolution publication diagnostic figure summaries.

---

## 3. Benchmark Results (Leave-One-Battery-Out LOBO Cross-Validation)

| Model | Mean RMSE (%) | Mean MAE (%) | Mean $R^2$ | Interpretability / Uncertainty |
| :--- | :---: | :---: | :---: | :--- |
| **Ridge Regression** | **1.922 ± 0.622** | **1.530 ± 0.558** | **0.9560** | Closed-form linear weights; exact physical Jacobian $\frac{\partial \widehat{\text{SoH}}}{\partial x_i}$ |
| **ElasticNet** | 2.295 ± 1.180 | 1.944 ± 1.164 | 0.9384 | Sparse feature selection with mixed $L_1/L_2$ penalties |
| **GPR (Matérn 5/2)** | 2.704 ± 1.249 | 2.137 ± 1.013 | 0.9085 | 95% epistemic confidence intervals ($\pm 1.96\sigma$), 90.6% empirical coverage |
| **XGBoost** | 2.784 ± 1.261 | 2.359 ± 1.104 | 0.9131 | Non-linear feature interactions, tree-based SHAP attributions |
| **SVR (RBF Kernel)** | 4.380 ± 3.152 | 3.357 ± 2.287 | 0.7609 | Kernel distance mapping in dual space |

### Per-Cell Held-Out Evaluation (GPR Model)
- **Cell B0005**: $\text{RMSE} = 1.079\%$, $\text{MAE} = 0.863\%$, $R^2 = 0.9870$, $95\%\text{ CI Coverage} = 99.4\%$
- **Cell B0006**: $\text{RMSE} = 4.591\%$, $\text{MAE} = 3.627\%$, $R^2 = 0.8642$, $95\%\text{ CI Coverage} = 81.4\%$
- **Cell B0007**: $\text{RMSE} = 2.594\%$, $\text{MAE} = 2.373\%$, $R^2 = 0.8946$, $95\%\text{ CI Coverage} = 86.8\%$
- **Cell B0018**: $\text{RMSE} = 2.553\%$, $\text{MAE} = 1.687\%$, $R^2 = 0.8882$, $95\%\text{ CI Coverage} = 94.7\%$

---

## 4. Mathematical & Electrochemical Justifications

### 1. Thevenin Terminal Voltage Dynamics ($t_{\text{cc}}$ and $t_{\text{cv}}$)
$$V_{\text{term}}(t) = V_{\text{OCV}}(\text{SoC}(t)) \pm I(t) \cdot (R_e + R_{\text{ct}}) + V_{\text{RC}}(t)$$
- As cell degrades, internal resistance $R_{\text{int}} = R_e + R_{\text{ct}}$ increases.
- In constant-current (CC) charge ($I = 1.5\text{ A}$), terminal voltage hits the $4.2\text{ V}$ cutoff prematurely:
  $$V_{\text{OCV}}(\text{SoC}^*) = 4.2\text{ V} - I \cdot R_{\text{int}}$$
- This forces lower initial state of charge at cutoff, shrinking $t_{\text{cc}}$ ($\frac{\partial \widehat{\text{SoH}}}{\partial t_{\text{cc}}} > 0$) and shunting more charge transfer into the prolonged constant-voltage (CV) decay stage ($\frac{\partial \widehat{\text{SoH}}}{\partial t_{\text{cv}}} < 0$).

### 2. Joule Heating Law ($\Delta T_{\max}$)
$$Q_{\text{heat}} = \int_0^{t_{\text{dis}}} I^2 (R_e + R_{\text{ct}})\, dt$$
- Thermal energy generated during $2.0\text{ A}$ CC discharge scales proportionally with internal resistance.
- Degraded cells produce higher heat dissipation, increasing peak temperature rise $\Delta T_{\max} = \max(T) - T_0$.
- Empirically confirms the negative model sensitivity: $\frac{\partial \widehat{\text{SoH}}}{\partial \Delta T_{\max}} < 0$.

### 3. Electrochemical Phase Transitions ($dQ/dV$)
$$\frac{dQ}{dV} = \frac{I}{dV/dt}$$
- Attenuation of $(dQ/dV)_{\text{peak}}$ reflects **Loss of Active Material (LAM)** and **Loss of Lithium Inventory (LLI)**.
- Rightward voltage shift of the peak ($\Delta V_{\text{peak}} \propto I \cdot R_{\text{int}}$) reflects rising ohmic overpotential.

---

## 5. How to Run

```bash
# 1. Activate environment
source .venv/bin/activate

# 2. Run full automated test suite (15 tests)
pytest -v tests/

# 3. Execute 4-stage pipeline batch runner
python run_pipeline.py

# 4. Start the interactive testing web UI
python app.py --port 8000
```
