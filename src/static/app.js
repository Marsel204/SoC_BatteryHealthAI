// Physics-Informed Battery SoH Prognostics - Lead Engineering Controller

let presets = {};
let featureStats = {};
let figuresCatalog = [];
let jacobianChart = null;
let uncertaintyChart = null;
let chargeChart = null;
let icChart = null;
let debounceTimer = null;
let currentLoadedCycleFeatures = null;
let latestPredictionData = null;

const FEATURE_NAMES = [
  "t_cc",
  "t_cv",
  "dq_dv_peak",
  "v_at_peak",
  "delta_T_max",
  "delta_V_ohmic",
  "Re",
  "Rct",
  "rest_time_hours",
];

const FEATURE_LABELS = {
  t_cc: "t_cc (CC Time)",
  t_cv: "t_cv (CV Time)",
  dq_dv_peak: "(dQ/dV)_peak",
  v_at_peak: "V_peak",
  delta_T_max: "ΔT_max (Heat)",
  delta_V_ohmic: "ΔV_ohmic (Drop)",
  Re: "Re (Bulk)",
  Rct: "Rct (Charge-Xfer)",
  rest_time_hours: "t_rest (Relax)",
};

const DEFAULT_FEATURES = {
  t_cc: 2850,
  t_cv: 6200,
  dq_dv_peak: 4.60,
  v_at_peak: 3.985,
  delta_T_max: 14.2,
  delta_V_ohmic: 0.220,
  Re: 0.052,
  Rct: 0.075,
  rest_time_hours: 3.5,
};

document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupSliders();
  setupCycleScrubber();
  setupModals();
  initCharts();
  await fetchDatasetSummary();
  await fetchFiguresCatalog();
  // Trigger initial inference
  triggerPredict();
  // Load initial cycle waveforms
  loadCycleData("B0005", 10);
});

// Tab Navigation
function setupTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      document.getElementById(targetId).classList.add("active");
    });
  });

  document.getElementById("btnQuickLightroom")?.addEventListener("click", () => {
    document.querySelector('[data-tab="tab-benchmark"]').click();
    document.getElementById("figuresGalleryContainer")?.scrollIntoView({ behavior: "smooth" });
  });

  document.getElementById("btnResetParams")?.addEventListener("click", () => {
    applyFeatures(DEFAULT_FEATURES);
    document.getElementById("activePresetLabel").textContent = "Default Parameters";
  });
}

// Preset Handlers
function setupPresets() {
  const presetBtns = document.querySelectorAll(".preset-btn");
  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const presetKey = btn.getAttribute("data-preset");
      if (presets[presetKey]) {
        applyFeatures(presets[presetKey]);
        const cleanName = btn.textContent.trim().split("(")[0].replace(/[🟢🟡🟠🔴⚡]/g, "").trim();
        document.getElementById("activePresetLabel").textContent = `Preset: ${cleanName}`;
      }
    });
  });
}

function applyFeatures(featObj) {
  FEATURE_NAMES.forEach((key) => {
    if (featObj[key] !== undefined) {
      const slider = document.getElementById(`slider-${key}`);
      if (slider) {
        slider.value = featObj[key];
        updateSliderLabel(key, featObj[key]);
      }
    }
  });
  triggerPredict();
}

function updateSliderLabel(key, val) {
  const display = document.getElementById(`val-${key}`);
  if (!display) return;
  const num = parseFloat(val);
  if (key === "t_cc" || key === "t_cv") display.textContent = `${Math.round(num)} s`;
  else if (key === "dq_dv_peak") display.textContent = `${num.toFixed(2)} Ah/V`;
  else if (key === "v_at_peak") display.textContent = `${num.toFixed(3)} V`;
  else if (key === "delta_T_max") display.textContent = `${num.toFixed(1)} °C`;
  else if (key === "delta_V_ohmic") display.textContent = `${num.toFixed(3)} V`;
  else if (key === "Re" || key === "Rct") display.textContent = `${num.toFixed(3)} Ω`;
  else if (key === "rest_time_hours") display.textContent = `${num.toFixed(1)} h`;
}

// Sliders Event Handlers
function setupSliders() {
  FEATURE_NAMES.forEach((key) => {
    const slider = document.getElementById(`slider-${key}`);
    if (slider) {
      slider.addEventListener("input", (e) => {
        document.getElementById("activePresetLabel").textContent = "Custom Inputs";
        updateSliderLabel(key, e.target.value);
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(triggerPredict, 35);
      });
    }
  });
}

function getCurrentFeatures() {
  const features = {};
  FEATURE_NAMES.forEach((key) => {
    const slider = document.getElementById(`slider-${key}`);
    features[key] = parseFloat(slider.value);
  });
  return features;
}

// REST API calls
async function fetchDatasetSummary() {
  try {
    const res = await fetch("/api/dataset/summary");
    if (!res.ok) return;
    const data = await res.json();
    presets = data.presets || {};
    featureStats = data.feature_stats || {};
    setupPresets();
  } catch (err) {
    console.error("Failed to fetch dataset summary:", err);
  }
}

async function fetchFiguresCatalog() {
  try {
    const res = await fetch("/api/figures");
    if (!res.ok) return;
    figuresCatalog = await res.json();
    renderFiguresGallery(figuresCatalog);
  } catch (err) {
    console.error("Failed to fetch figures catalog:", err);
  }
}

function renderFiguresGallery(catalog) {
  const container = document.getElementById("figuresGalleryContainer");
  if (!container) return;
  container.innerHTML = "";

  catalog.forEach((fig) => {
    const card = document.createElement("div");
    card.className = "figure-card";
    card.innerHTML = `
      <div class="figure-thumb-wrapper" onclick="openLightbox('${fig.id}')">
        <img src="${fig.url}" alt="${fig.title}" class="figure-thumb">
        <div class="figure-overlay-hint">🔍 Click to Expand</div>
      </div>
      <div class="figure-body">
        <div class="figure-tag">${fig.stage}</div>
        <div class="figure-name">${fig.title}</div>
        <div class="figure-desc">${fig.description}</div>
        <div class="figure-actions">
          <button class="btn-action" onclick="openLightbox('${fig.id}')" style="flex: 1;">🔍 Inspect</button>
          <a href="${fig.url}" download="${fig.filename}" class="btn-primary" style="text-decoration: none; padding: 0.35rem 0.75rem;">⬇️ 300 DPI</a>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

async function triggerPredict() {
  const payload = getCurrentFeatures();
  try {
    const res = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const data = await res.json();
    latestPredictionData = { payload, ...data };
    updateModelResults(data);
  } catch (err) {
    console.error("Prediction error:", err);
  }
}

function updateModelResults(data) {
  const preds = data.predictions || {};
  const unc = data.gpr_uncertainty || {};
  const jac = data.jacobian || {};

  // Update Model Cards
  ["Ridge", "ElasticNet", "SVR", "GPR", "XGBoost"].forEach((m) => {
    const el = document.getElementById(`pred-${m}`);
    if (el && preds[m] !== undefined) {
      el.textContent = `${preds[m].toFixed(2)}%`;
    }
  });

  // GPR Uncertainty & EoL Tail Probability
  if (unc.ci_lower !== undefined && unc.ci_upper !== undefined) {
    const mean = unc.mean;
    const std = unc.std;
    const halfWidth = (unc.ci_upper - unc.ci_lower) / 2.0;
    document.getElementById("unc-GPR").textContent = `95% Epistemic CI: [${unc.ci_lower.toFixed(2)}%, ${unc.ci_upper.toFixed(2)}%] (±${halfWidth.toFixed(2)}%)`;

    // Normal CDF: P(SoH <= 70)
    const zEol = (70.0 - mean) / (std > 0 ? std : 0.001);
    const pEol = normalCDF(zEol) * 100.0;
    const pText = pEol < 0.01 ? "< 0.01%" : pEol > 99.9 ? "> 99.9%" : `${pEol.toFixed(2)}%`;
    document.getElementById("eolProbText").textContent = `P(SoH ≤ 70.0% EoL): ${pText}`;

    // Update continuous uncertainty bell curve
    updateUncertaintyCurve(mean, std);
  }

  // Update Health Banner
  const primarySoH = preds["GPR"] !== undefined ? preds["GPR"] : preds["Ridge"];
  updateHealthBanner(primarySoH);

  // Update Jacobian chart
  updateJacobianChart(jac);
}

// Error function approximation for Gaussian CDF
function normalCDF(x) {
  const t = 1.0 / (1.0 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2.0);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1.0 - prob : prob;
}

function updateHealthBanner(soh) {
  const banner = document.getElementById("healthBanner");
  const title = document.getElementById("healthTitle");
  const desc = document.getElementById("healthDesc");
  const val = document.getElementById("healthSoHVal");

  val.textContent = `${soh.toFixed(1)}%`;
  banner.className = "status-banner";

  if (soh > 80.0) {
    banner.classList.add("status-optimal");
    title.textContent = "CELL HEALTH: OPTIMAL (HEALTHY CELL)";
    desc.textContent = "SoH comfortably exceeds 80%. Cathode/anode matrix and electrolyte are fully intact.";
  } else if (soh > 70.0) {
    banner.classList.add("status-caution");
    title.textContent = "CELL HEALTH: AGING / ACCELERATED RETENTION";
    desc.textContent = "Approaching 70% End-of-Life (EoL). Increased internal impedance and SEI thickening observed.";
  } else {
    banner.classList.add("status-critical");
    title.textContent = "CELL HEALTH: CRITICAL (END-OF-LIFE REACHED)";
    desc.textContent = "Capacity dropped below 70% (1.40 Ah nominal). Severe Loss of Active Material & Lithium Inventory.";
  }
}

// Continuous Gaussian Bell Curve Calculation
function updateUncertaintyCurve(mean, std) {
  if (!uncertaintyChart) return;
  const nPoints = 60;
  const spread = Math.max(3.0 * std, 4.0);
  const minX = mean - spread;
  const maxX = mean + spread;
  const step = (maxX - minX) / nPoints;

  const labels = [];
  const data = [];
  for (let x = minX; x <= maxX; x += step) {
    labels.push(x.toFixed(1));
    const exponent = -0.5 * Math.pow((x - mean) / std, 2);
    const pdf = (1.0 / (std * Math.sqrt(2.0 * Math.PI))) * Math.exp(exponent);
    data.push(pdf);
  }

  uncertaintyChart.data.labels = labels;
  uncertaintyChart.data.datasets[0].data = data;
  uncertaintyChart.update("none");
}

// Chart Initializations
function initCharts() {
  // 1. Live Epistemic Uncertainty Distribution Chart
  const ctxUnc = document.getElementById("uncertaintyCurveChart").getContext("2d");
  uncertaintyChart = new Chart(ctxUnc, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Epistemic Density N(μ, σ²)",
          data: [],
          borderColor: "#38bdf8",
          backgroundColor: "rgba(56, 189, 248, 0.18)",
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `SoH: ${items[0].label}%`,
            label: (item) => `Density: ${item.raw.toFixed(4)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#94a3b8", font: { size: 9 }, maxTicksLimit: 7 },
          title: { display: true, text: "SoH (%)", color: "#94a3b8", font: { size: 9 } },
        },
        y: {
          display: false,
        },
      },
    },
  });

  // 2. Jacobian Horizontal Bar Chart
  const ctxJac = document.getElementById("jacobianChart").getContext("2d");
  jacobianChart = new Chart(ctxJac, {
    type: "bar",
    data: {
      labels: FEATURE_NAMES.map((k) => FEATURE_LABELS[k]),
      datasets: [
        {
          label: "Analytical Sensitivity ∂SoH / ∂x_i",
          data: FEATURE_NAMES.map(() => 0),
          backgroundColor: FEATURE_NAMES.map(() => "#38bdf8"),
          borderColor: "#263554",
          borderWidth: 1,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { left: 5, right: 15, top: 0, bottom: 0 },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `∂SoH/∂x = ${ctx.raw > 0 ? "+" : ""}${ctx.raw.toFixed(4)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(255, 255, 255, 0.06)" },
          ticks: { color: "#94a3b8", font: { size: 10 } },
          title: { display: true, text: "Sensitivity ∂SoH / ∂x (% SoH / unit)", color: "#94a3b8", font: { size: 10 } },
        },
        y: {
          grid: { display: false },
          ticks: { color: "#f1f5f9", font: { size: 10 } },
        },
      },
    },
  });

  // 3. CC-CV Waveform Chart
  const ctxCharge = document.getElementById("chargeWaveformChart").getContext("2d");
  chargeChart = new Chart(ctxCharge, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Voltage (V)",
          data: [],
          borderColor: "#38bdf8",
          backgroundColor: "rgba(56, 189, 248, 0.1)",
          yAxisID: "yV",
          tension: 0.1,
          pointRadius: 0,
        },
        {
          label: "Current (A)",
          data: [],
          borderColor: "#f59e0b",
          borderDash: [5, 5],
          yAxisID: "yI",
          tension: 0.1,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          title: { display: true, text: "Charging Time (s)", color: "#94a3b8", font: { size: 10 } },
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#94a3b8", font: { size: 10 } },
        },
        yV: {
          type: "linear",
          position: "left",
          title: { display: true, text: "Voltage (V)", color: "#38bdf8", font: { size: 10 } },
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#38bdf8", font: { size: 10 } },
          min: 3.6,
          max: 4.3,
        },
        yI: {
          type: "linear",
          position: "right",
          title: { display: true, text: "Current (A)", color: "#f59e0b", font: { size: 10 } },
          grid: { drawOnChartArea: false },
          ticks: { color: "#f59e0b", font: { size: 10 } },
          min: -0.1,
          max: 1.8,
        },
      },
      plugins: {
        legend: { labels: { color: "#f8fafc", font: { size: 11 } } },
      },
    },
  });

  // 4. dQ/dV Incremental Capacity Chart
  const ctxIC = document.getElementById("icCurveChart").getContext("2d");
  icChart = new Chart(ctxIC, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "dQ/dV (Ah/V)",
          data: [],
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          fill: true,
          tension: 0.2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: "Voltage (V)", color: "#94a3b8", font: { size: 10 } },
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#94a3b8", font: { size: 10 } },
        },
        y: {
          title: { display: true, text: "Incremental Capacity dQ/dV (Ah/V)", color: "#10b981", font: { size: 10 } },
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#10b981", font: { size: 10 } },
          min: 0,
        },
      },
      plugins: {
        legend: { labels: { color: "#f8fafc", font: { size: 11 } } },
      },
    },
  });
}

function updateJacobianChart(jac) {
  if (!jacobianChart) return;
  const values = FEATURE_NAMES.map((k) => jac[k] || 0);
  const colors = values.map((v) => (v >= 0 ? "rgba(16, 185, 129, 0.85)" : "rgba(244, 63, 94, 0.85)"));

  jacobianChart.data.datasets[0].data = values;
  jacobianChart.data.datasets[0].backgroundColor = colors;
  jacobianChart.update("none");
}

// Cycle Scrubber Setup
function setupCycleScrubber() {
  const cellSelect = document.getElementById("cellSelect");
  const scrubber = document.getElementById("cycleScrubber");
  const display = document.getElementById("cycleNumDisplay");
  const btnLoad = document.getElementById("btnLoadCycle");

  cellSelect.addEventListener("change", () => {
    const bId = cellSelect.value;
    scrubber.max = bId === "B0018" ? 131 : 168;
    loadCycleData(bId, parseInt(scrubber.value));
  });

  scrubber.addEventListener("input", (e) => {
    display.textContent = `Cycle ${e.target.value}`;
  });

  scrubber.addEventListener("change", (e) => {
    loadCycleData(cellSelect.value, parseInt(e.target.value));
  });

  btnLoad.addEventListener("click", () => {
    if (currentLoadedCycleFeatures) {
      applyFeatures(currentLoadedCycleFeatures);
      // Switch to simulator tab
      document.querySelector('[data-tab="tab-simulator"]').click();
      document.getElementById("activePresetLabel").textContent = `Loaded from ${cellSelect.value} Cycle ${scrubber.value}`;
    }
  });
}

async function loadCycleData(batteryId, cycleIdx) {
  try {
    const res = await fetch(`/api/cycle/${batteryId}/${cycleIdx}`);
    if (!res.ok) return;
    const data = await res.json();
    currentLoadedCycleFeatures = data.features;

    // Update Waveform Chart
    if (chargeChart && data.charge_waveform) {
      const times = data.charge_waveform.time.map((t) => Math.round(t));
      chargeChart.data.labels = times;
      chargeChart.data.datasets[0].data = data.charge_waveform.voltage;
      chargeChart.data.datasets[1].data = data.charge_waveform.current;
      chargeChart.update();
    }

    // Update dQ/dV Chart
    if (icChart && data.ic_curve) {
      const voltages = data.ic_curve.voltage.map((v) => v.toFixed(3));
      icChart.data.labels = voltages;
      icChart.data.datasets[0].data = data.ic_curve.dq_dv;
      icChart.update();
    }

    document.getElementById("chargeInfoBadge").textContent = `Cycle ${cycleIdx} SoH: ${data.soh.toFixed(1)}% (${data.capacity.toFixed(3)} Ah)`;
  } catch (err) {
    console.error("Failed to load cycle data:", err);
  }
}

// Modals: Lightroom & Exam Report
function setupModals() {
  // Lightroom modal
  const lightboxModal = document.getElementById("lightboxModal");
  document.getElementById("btnCloseLightbox")?.addEventListener("click", () => {
    lightboxModal.classList.remove("open");
  });
  lightboxModal?.addEventListener("click", (e) => {
    if (e.target === lightboxModal) lightboxModal.classList.remove("open");
  });

  // Report modal
  const reportModal = document.getElementById("reportModal");
  document.getElementById("btnOpenReport")?.addEventListener("click", () => {
    buildExamReportContent();
    reportModal.classList.add("open");
  });
  document.getElementById("btnCloseReport")?.addEventListener("click", () => {
    reportModal.classList.remove("open");
  });
  reportModal?.addEventListener("click", (e) => {
    if (e.target === reportModal) reportModal.classList.remove("open");
  });
  document.getElementById("btnPrintReport")?.addEventListener("click", () => {
    window.print();
  });
}

function openLightbox(figId) {
  const fig = figuresCatalog.find((f) => f.id === figId);
  if (!fig) return;
  document.getElementById("modalFigStage").textContent = fig.stage;
  document.getElementById("modalFigTitle").textContent = fig.title;
  document.getElementById("modalFigImg").src = fig.url;
  document.getElementById("modalFigDesc").textContent = fig.description;
  const btnDl = document.getElementById("btnDownloadFig");
  btnDl.href = fig.url;
  btnDl.download = fig.filename;
  document.getElementById("lightboxModal").classList.add("open");
}
window.openLightbox = openLightbox;

function buildExamReportContent() {
  const container = document.getElementById("reportContentArea");
  if (!container) return;

  const currentFeatures = getCurrentFeatures();
  const preds = latestPredictionData?.predictions || {};
  const unc = latestPredictionData?.gpr_uncertainty || {};
  const jac = latestPredictionData?.jacobian || {};
  const now = new Date().toLocaleString();

  container.innerHTML = `
    <div class="report-header-print">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <h1 style="font-size: 1.4rem; font-weight: 800; color: #38bdf8;">PHYSICS-INFORMED STATE OF HEALTH (SOH) ESTIMATION</h1>
          <div style="font-size: 0.85rem; color: #94a3b8;">NASA PCoE Battery Dataset (18650 Li-ion Cells B0005, B0006, B0007, B0018)</div>
        </div>
        <div style="text-align: right; font-size: 0.8rem; color: #94a3b8;">
          <div><strong>Generated:</strong> ${now}</div>
          <div><strong>Evaluation:</strong> LOBO Cross-Validation</div>
        </div>
      </div>
    </div>

    <div class="report-section-title">1. Operational Parameters & Physical Feature Vector (x_i)</div>
    <table class="data-table" style="margin-bottom: 1rem;">
      <thead>
        <tr>
          <th>Physical Feature</th>
          <th>Symbol</th>
          <th>Observed Value</th>
          <th>Electrochemical Role</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>CC Charging Duration</td><td>t_cc</td><td><strong>${Math.round(currentFeatures.t_cc)} s</strong></td><td>Premature 4.2V cutoff from rising R_int</td></tr>
        <tr><td>CV Charging Duration</td><td>t_cv</td><td><strong>${Math.round(currentFeatures.t_cv)} s</strong></td><td>Extended current decay retention phase</td></tr>
        <tr><td>Incremental Capacity Peak</td><td>(dQ/dV)_peak</td><td><strong>${currentFeatures.dq_dv_peak.toFixed(2)} Ah/V</strong></td><td>Graphite/NMC phase transition plateau (LAM/LLI)</td></tr>
        <tr><td>Voltage at Peak</td><td>V_peak</td><td><strong>${currentFeatures.v_at_peak.toFixed(3)} V</strong></td><td>Ohmic overpotential shift η = I · R_int</td></tr>
        <tr><td>Max Temperature Rise</td><td>ΔT_max</td><td><strong>${currentFeatures.delta_T_max.toFixed(1)} °C</strong></td><td>Joule heat dissipation: Q_heat = ∫ I² R dt</td></tr>
        <tr><td>Initial Ohmic Drop</td><td>ΔV_ohmic</td><td><strong>${currentFeatures.delta_V_ohmic.toFixed(3)} V</strong></td><td>Instantaneous bulk ohmic jump (R0 ≈ ΔV0 / I)</td></tr>
        <tr><td>Electrolyte Resistance</td><td>R_e</td><td><strong>${currentFeatures.Re.toFixed(3)} Ω</strong></td><td>Bulk ionic transport resistance (EIS sweep)</td></tr>
        <tr><td>Charge-Transfer Resistance</td><td>R_ct</td><td><strong>${currentFeatures.Rct.toFixed(3)} Ω</strong></td><td>Interfacial electrochemical kinetics & SEI film</td></tr>
        <tr><td>Inter-Cycle Rest Duration</td><td>t_rest</td><td><strong>${currentFeatures.rest_time_hours.toFixed(1)} h</strong></td><td>Diffusion relaxation & capacity regeneration</td></tr>
      </tbody>
    </table>

    <div class="report-section-title">2. Multi-Model Prognostic Predictions & Epistemic Uncertainty</div>
    <table class="data-table" style="margin-bottom: 1rem;">
      <thead>
        <tr>
          <th>Model Architecture</th>
          <th>Predicted SoH (%)</th>
          <th>Uncertainty Bounds</th>
          <th>Mathematical Formulation</th>
        </tr>
      </thead>
      <tbody>
        <tr style="background: rgba(56, 189, 248, 0.08);">
          <td><strong>Gaussian Process (GPR)</strong></td>
          <td><strong style="color: #38bdf8; font-size: 1.05rem;">${(preds.GPR || 0).toFixed(2)}%</strong></td>
          <td><strong>95% CI: [${(unc.ci_lower || 0).toFixed(2)}%, ${(unc.ci_upper || 0).toFixed(2)}%]</strong></td>
          <td>Matérn 5/2 + WhiteKernel Epistemic Covariance</td>
        </tr>
        <tr><td>Ridge Regression</td><td>${(preds.Ridge || 0).toFixed(2)}%</td><td>Exact Closed-Form</td><td>Standardized L2 Regularization (α cross-validated)</td></tr>
        <tr><td>ElasticNet Baseline</td><td>${(preds.ElasticNet || 0).toFixed(2)}%</td><td>Sparse Penalty</td><td>Mixed L1 / L2 Coordinate Descent</td></tr>
        <tr><td>XGBoost Ensemble</td><td>${(preds.XGBoost || 0).toFixed(2)}%</td><td>TreeSHAP Bounds</td><td>Gradient Boosted Decision Trees (Depth=3)</td></tr>
        <tr><td>Support Vector Regressor (SVR)</td><td>${(preds.SVR || 0).toFixed(2)}%</td><td>Kernel Distance</td><td>Dual Space RBF Kernel mapping</td></tr>
      </tbody>
    </table>

    <div class="report-section-title">3. Analytical Sensitivities (Jacobian ∂SoH / ∂x_i) & Physical Justifications</div>
    <div style="font-size: 0.82rem; line-height: 1.6; color: #cbd5e1; margin-bottom: 1rem;">
      <p><strong>• Thevenin Terminal Voltage Dynamics:</strong> V_term(t) = V_OCV(SoC) + I·R_int + V_RC(t). As R_int = R_e + R_ct increases with cell aging, the 4.2V CC ceiling is hit at lower SoC*, shrinking t_cc (Jacobian: +${(jac.t_cc || 0).toFixed(4)} %/s) and expanding t_cv.</p>
      <p><strong>• Joule Heating Law:</strong> Q_heat = ∫ I² (R_e + R_ct) dt. Irreversible heat generation scales with impedance, enforcing negative sensitivity on peak thermal rise ΔT_max (Jacobian: ${(jac.delta_T_max || 0).toFixed(4)} %/°C).</p>
      <p><strong>• Active Material Retention:</strong> Peak height collapse of (dQ/dV)_peak directly validates Loss of Active Material (LAM) and Loss of Lithium Inventory (LLI) with positive sensitivity +${(jac.dq_dv_peak || 0).toFixed(4)} % per Ah/V.</p>
    </div>
  `;
}
