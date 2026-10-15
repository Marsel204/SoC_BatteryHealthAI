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

// Methodology Visual State
let ecmChart = null;
let icAnatomyChart = null;
let gprPlaygroundChart = null;
let modelVisualChartInstance = null;
let loboComparisonChartInstance = null;
let currentLoboBattery = "B0005";
let modelSpecsData = null;
let currentEcmAging = 0;
let currentIcMode = "all";


// Dataset Explorer State
let datasetPage = 1;
let datasetPageSize = 50;
let datasetSelectedCell = "all";
let datasetHealthFilter = "all";
let datasetSortCol = "cycle";
let datasetSortOrder = "asc";
let datasetTotalCount = 632;
let currentDatasetRecords = [];

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
  setupDatasetTab();
  setupMethodologyTab();
  setupModals();
  initCharts();
  initMethodologyCharts();
  initLoboComparisonChart();
  await fetchDatasetSummary();
  await fetchFiguresCatalog();
  await fetchDatasetRecords();
  await fetchModelSpecs();
  // Trigger initial prediction
  triggerPredict();
  // Load initial cycle telemetry
  loadCycleData("B0005", 10);
  setTimeout(renderMathEquations, 600);
});

// Segmented Navigation Switcher
function setupTabs() {
  const segmentBtns = document.querySelectorAll(".segment-btn");
  segmentBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      segmentBtns.forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".view-section").forEach((s) => s.classList.remove("active"));

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      document.getElementById(targetId)?.classList.add("active");
      if (targetId === "tab-methodology") {
        renderMathEquations();
        if (ecmChart) ecmChart.resize();
        if (icAnatomyChart) icAnatomyChart.resize();
        if (gprPlaygroundChart) gprPlaygroundChart.resize();
        if (modelVisualChartInstance) modelVisualChartInstance.resize();
        if (loboComparisonChartInstance) loboComparisonChartInstance.resize();
      }
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
  const presetBtns = document.querySelectorAll(".preset-pill");
  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const presetKey = btn.getAttribute("data-preset");
      if (presets[presetKey]) {
        applyFeatures(presets[presetKey]);
        const cleanName = btn.textContent.trim().split("(")[0].trim();
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
        document.getElementById("activePresetLabel").textContent = "Custom Input";
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
    card.className = "figure-entry";
    card.innerHTML = `
      <div class="figure-preview-box" onclick="openLightbox('${fig.id}')">
        <img src="${fig.url}" alt="${fig.title}" class="figure-preview-img">
      </div>
      <div class="figure-content">
        <div class="figure-stage-tag">${fig.stage}</div>
        <div class="figure-title-text">${fig.title}</div>
        <div class="figure-caption-text">${fig.description}</div>
        <div class="figure-action-bar">
          <button class="btn-quiet" onclick="openLightbox('${fig.id}')" style="flex: 1;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            Inspect
          </button>
          <a href="${fig.url}" download="${fig.filename}" class="btn-solid" style="text-decoration: none; padding: 0.35rem 0.65rem; font-size: 0.74rem;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            300 DPI
          </a>
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

  // Update Model Values
  ["Ridge", "ElasticNet", "SVR", "GPR", "XGBoost"].forEach((m) => {
    const el = document.getElementById(`pred-${m}`);
    if (el && preds[m] !== undefined) {
      el.textContent = `${preds[m].toFixed(2)}%`;
    }
  });

  // GPR Uncertainty & Risk Metric
  if (unc.ci_lower !== undefined && unc.ci_upper !== undefined) {
    const mean = unc.mean;
    const std = unc.std;
    const halfWidth = (unc.ci_upper - unc.ci_lower) / 2.0;
    document.getElementById("unc-GPR").textContent = `95% CI: [${unc.ci_lower.toFixed(2)}%, ${unc.ci_upper.toFixed(2)}%] (±${halfWidth.toFixed(2)}%)`;

    // Normal CDF: P(SoH <= 70.0%)
    const zEol = (70.0 - mean) / (std > 0 ? std : 0.001);
    const pEol = normalCDF(zEol) * 100.0;
    const pText = pEol < 0.01 ? "< 0.01%" : pEol > 99.9 ? "> 99.9%" : `${pEol.toFixed(2)}%`;
    document.getElementById("eolProbText").textContent = `P(SoH ≤ 70.0% EoL): ${pText}`;

    // Update continuous uncertainty distribution
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
  banner.className = "status-strip";

  if (soh > 80.0) {
    banner.classList.add("nominal");
    title.textContent = "CELL STATE: NOMINAL";
    desc.textContent = "SoH comfortably exceeds 80% EoL threshold. Active matrix fully intact.";
  } else if (soh > 70.0) {
    banner.classList.add("caution");
    title.textContent = "CELL STATE: AGING";
    desc.textContent = "Approaching 70% End-of-Life (EoL). Rising internal impedance observed.";
  } else {
    banner.classList.add("critical");
    title.textContent = "CELL STATE: CRITICAL (EOL REACHED)";
    desc.textContent = "Capacity dropped below 70% (1.40 Ah nominal). Severe LAM/LLI degradation.";
  }
}

// Continuous Gaussian Bell Curve Calculation
function updateUncertaintyCurve(mean, std) {
  if (!uncertaintyChart) return;
  const nPoints = 50;
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
          backgroundColor: "rgba(56, 189, 248, 0.12)",
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 1.8,
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
          grid: { color: "rgba(255, 255, 255, 0.04)" },
          ticks: { color: "#64748b", font: { size: 9 }, maxTicksLimit: 6 },
          title: { display: true, text: "SoH (%)", color: "#64748b", font: { size: 9 } },
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
          label: "Sensitivity ∂SoH / ∂x_i",
          data: FEATURE_NAMES.map(() => 0),
          backgroundColor: FEATURE_NAMES.map(() => "#38bdf8"),
          borderColor: "#1e2433",
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
          grid: { color: "rgba(255, 255, 255, 0.04)" },
          ticks: { color: "#64748b", font: { size: 9 } },
          title: { display: true, text: "Analytical Sensitivity ∂SoH / ∂x (% SoH / unit)", color: "#64748b", font: { size: 9 } },
        },
        y: {
          grid: { display: false },
          ticks: { color: "#94a3b8", font: { size: 9 } },
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
          backgroundColor: "rgba(56, 189, 248, 0.08)",
          yAxisID: "yV",
          tension: 0.1,
          pointRadius: 0,
          borderWidth: 1.5,
        },
        {
          label: "Current (A)",
          data: [],
          borderColor: "#f59e0b",
          borderDash: [4, 4],
          yAxisID: "yI",
          tension: 0.1,
          pointRadius: 0,
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          title: { display: true, text: "Charging Duration (s)", color: "#64748b", font: { size: 9 } },
          grid: { color: "rgba(255, 255, 255, 0.04)" },
          ticks: { color: "#64748b", font: { size: 9 } },
        },
        yV: {
          type: "linear",
          position: "left",
          title: { display: true, text: "Voltage (V)", color: "#38bdf8", font: { size: 9 } },
          grid: { color: "rgba(255, 255, 255, 0.04)" },
          ticks: { color: "#38bdf8", font: { size: 9 } },
          min: 3.6,
          max: 4.3,
        },
        yI: {
          type: "linear",
          position: "right",
          title: { display: true, text: "Current (A)", color: "#f59e0b", font: { size: 9 } },
          grid: { drawOnChartArea: false },
          ticks: { color: "#f59e0b", font: { size: 9 } },
          min: -0.1,
          max: 1.8,
        },
      },
      plugins: {
        legend: { labels: { color: "#94a3b8", font: { size: 10 } } },
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
          backgroundColor: "rgba(16, 185, 129, 0.08)",
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: "Terminal Voltage (V)", color: "#64748b", font: { size: 9 } },
          grid: { color: "rgba(255, 255, 255, 0.04)" },
          ticks: { color: "#64748b", font: { size: 9 } },
        },
        y: {
          title: { display: true, text: "Incremental Capacity dQ/dV (Ah/V)", color: "#10b981", font: { size: 9 } },
          grid: { color: "rgba(255, 255, 255, 0.04)" },
          ticks: { color: "#10b981", font: { size: 9 } },
          min: 0,
        },
      },
      plugins: {
        legend: { labels: { color: "#94a3b8", font: { size: 10 } } },
      },
    },
  });
}

function updateJacobianChart(jac) {
  if (!jacobianChart) return;
  const values = FEATURE_NAMES.map((k) => jac[k] || 0);
  const colors = values.map((v) => (v >= 0 ? "rgba(16, 185, 129, 0.85)" : "rgba(239, 68, 68, 0.85)"));

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
      document.getElementById("activePresetLabel").textContent = `Loaded: ${cellSelect.value} Cycle ${scrubber.value}`;
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
    <div class="report-header-line">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <h1 style="font-size: 1.25rem; font-weight: 700; color: #f8fafc; letter-spacing: -0.01em;">PHYSICS-INFORMED STATE OF HEALTH (SOH) EVALUATION</h1>
          <div style="font-size: 0.8rem; color: #94a3b8;">NASA Ames Prognostics Center of Excellence — 18650 Li-ion Cells (B0005, B0006, B0007, B0018)</div>
        </div>
        <div style="text-align: right; font-size: 0.75rem; color: #94a3b8; font-family: var(--font-mono);">
          <div>Generated: ${now}</div>
          <div>Protocol: LOBO 4-Fold CV</div>
        </div>
      </div>
    </div>

    <div class="report-chapter-head">1. Input Physical Feature Vector (x_i)</div>
    <table class="instrument-table" style="margin-bottom: 1rem;">
      <thead>
        <tr>
          <th>Physical Feature</th>
          <th>Notation</th>
          <th>Observed Value</th>
          <th>Electrochemical Rationale</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Constant-Current Charge Time</td><td>t_cc</td><td><strong>${Math.round(currentFeatures.t_cc)} s</strong></td><td>Premature 4.2V cutoff from rising internal impedance R_int</td></tr>
        <tr><td>Constant-Voltage Charge Time</td><td>t_cv</td><td><strong>${Math.round(currentFeatures.t_cv)} s</strong></td><td>Extended secondary current taper decay stage</td></tr>
        <tr><td>Incremental Capacity Peak</td><td>(dQ/dV)_peak</td><td><strong>${currentFeatures.dq_dv_peak.toFixed(2)} Ah/V</strong></td><td>Graphite stage transition plateau retention (LAM/LLI proxy)</td></tr>
        <tr><td>Voltage at Peak</td><td>V_peak</td><td><strong>${currentFeatures.v_at_peak.toFixed(3)} V</strong></td><td>Ohmic overpotential displacement η = I · R_int</td></tr>
        <tr><td>Thermal Dissipation Rise</td><td>ΔT_max</td><td><strong>${currentFeatures.delta_T_max.toFixed(1)} °C</strong></td><td>Joule heating energy dissipation: Q_heat = ∫ I² R dt</td></tr>
        <tr><td>Initial Ohmic Step</td><td>ΔV_ohmic</td><td><strong>${currentFeatures.delta_V_ohmic.toFixed(3)} V</strong></td><td>Instantaneous bulk voltage drop (R0 ≈ ΔV0 / I)</td></tr>
        <tr><td>Bulk Electrolyte Resistance</td><td>R_e</td><td><strong>${currentFeatures.Re.toFixed(3)} Ω</strong></td><td>High-frequency EIS electrolyte ionic transport</td></tr>
        <tr><td>Charge-Transfer Resistance</td><td>R_ct</td><td><strong>${currentFeatures.Rct.toFixed(3)} Ω</strong></td><td>Electrode/electrolyte interfacial charge-transfer barrier & SEI film</td></tr>
        <tr><td>Inter-Cycle Rest Duration</td><td>t_rest</td><td><strong>${currentFeatures.rest_time_hours.toFixed(1)} h</strong></td><td>Solid-state lithium concentration relaxation & regeneration</td></tr>
      </tbody>
    </table>

    <div class="report-chapter-head">2. Multi-Model Estimation & Epistemic Uncertainty Quantification</div>
    <table class="instrument-table" style="margin-bottom: 1rem;">
      <thead>
        <tr>
          <th>Model Architecture</th>
          <th>Estimated SoH (%)</th>
          <th>Uncertainty Interval</th>
          <th>Mathematical Formulation</th>
        </tr>
      </thead>
      <tbody>
        <tr style="background: rgba(14, 165, 233, 0.08);">
          <td><strong>Gaussian Process (GPR)</strong></td>
          <td><strong style="color: #38bdf8; font-size: 1rem;">${(preds.GPR || 0).toFixed(2)}%</strong></td>
          <td><strong>95% CI: [${(unc.ci_lower || 0).toFixed(2)}%, ${(unc.ci_upper || 0).toFixed(2)}%]</strong></td>
          <td>Matérn 5/2 + WhiteKernel Non-Parametric Covariance</td>
        </tr>
        <tr><td>Ridge Regression</td><td>${(preds.Ridge || 0).toFixed(2)}%</td><td>Closed-Form</td><td>Standardized L2 Regularization (α cross-validated)</td></tr>
        <tr><td>ElasticNet Baseline</td><td>${(preds.ElasticNet || 0).toFixed(2)}%</td><td>Sparse Penalty</td><td>Mixed L1 / L2 Coordinate Descent</td></tr>
        <tr><td>XGBoost Ensemble</td><td>${(preds.XGBoost || 0).toFixed(2)}%</td><td>TreeSHAP Attributions</td><td>Gradient Boosted Decision Trees (Depth=3)</td></tr>
        <tr><td>Support Vector Regressor (SVR)</td><td>${(preds.SVR || 0).toFixed(2)}%</td><td>Kernel Distance</td><td>Dual Space RBF Kernel mapping</td></tr>
      </tbody>
    </table>

    <div class="report-chapter-head">3. Analytical Jacobian Sensitivities (∂SoH / ∂x_i) & Physics Audit</div>
    <div style="font-size: 0.78rem; line-height: 1.6; color: #94a3b8; margin-bottom: 0.5rem;">
      <p><strong>• Thevenin Terminal Voltage Dynamics:</strong> V_term(t) = V_OCV(SoC) + I·R_int + V_RC(t). As R_int = R_e + R_ct increases with aging, the 4.2V CC ceiling is hit at lower SoC*, shrinking t_cc (Jacobian: +${(jac.t_cc || 0).toFixed(4)} %/s) and expanding t_cv.</p>
      <p><strong>• Joule Heating Law:</strong> Q_heat = ∫ I² (R_e + R_ct) dt. Thermal energy generated during discharge scales proportionally with internal resistance, validating negative sensitivity on peak thermal rise ΔT_max (Jacobian: ${(jac.delta_T_max || 0).toFixed(4)} %/°C).</p>
      <p><strong>• Phase Transition Retention:</strong> Attenuation of (dQ/dV)_peak reflects Loss of Active Material (LAM) and Loss of Lithium Inventory (LLI) with positive sensitivity +${(jac.dq_dv_peak || 0).toFixed(4)} % per Ah/V.</p>
    </div>
  `;
}

// ============================================================
// DATASET EXPLORER CONTROLLER
// ============================================================
function setupDatasetTab() {
  // Cell filter pills
  const cellBtns = document.querySelectorAll(".dataset-filter-btn");
  cellBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      cellBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      datasetSelectedCell = btn.getAttribute("data-cell") || "all";
      datasetPage = 1;
      fetchDatasetRecords();
    });
  });

  // Health regime filter
  document.getElementById("datasetHealthFilter")?.addEventListener("change", (e) => {
    datasetHealthFilter = e.target.value;
    datasetPage = 1;
    fetchDatasetRecords();
  });

  // Sort column
  document.getElementById("datasetSortCol")?.addEventListener("change", (e) => {
    datasetSortCol = e.target.value;
    fetchDatasetRecords();
  });

  // Sort order
  document.getElementById("datasetSortOrder")?.addEventListener("change", (e) => {
    datasetSortOrder = e.target.value;
    fetchDatasetRecords();
  });

  // Page size
  document.getElementById("datasetPageSize")?.addEventListener("change", (e) => {
    datasetPageSize = parseInt(e.target.value, 10);
    datasetPage = 1;
    fetchDatasetRecords();
  });

  // Pagination Previous
  document.getElementById("btnDatasetPrev")?.addEventListener("click", () => {
    if (datasetPage > 1) {
      datasetPage--;
      fetchDatasetRecords();
    }
  });

  // Pagination Next
  document.getElementById("btnDatasetNext")?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(datasetTotalCount / datasetPageSize));
    if (datasetPage < totalPages) {
      datasetPage++;
      fetchDatasetRecords();
    }
  });

  // Export CSV
  document.getElementById("btnExportDatasetCsv")?.addEventListener("click", () => {
    exportDatasetCsv();
  });
}

async function fetchDatasetRecords() {
  const tbody = document.getElementById("datasetTableBody");
  if (!tbody) return;

  const params = new URLSearchParams();
  if (datasetSelectedCell && datasetSelectedCell !== "all") {
    params.set("battery_id", datasetSelectedCell);
  }
  if (datasetHealthFilter === "nominal") {
    params.set("min_soh", "80.0");
  } else if (datasetHealthFilter === "caution") {
    params.set("min_soh", "70.0");
    params.set("max_soh", "80.0");
  } else if (datasetHealthFilter === "eol") {
    params.set("max_soh", "70.0");
  }

  params.set("sort_by", datasetSortCol);
  params.set("order", datasetSortOrder);
  params.set("limit", datasetPageSize.toString());
  params.set("offset", ((datasetPage - 1) * datasetPageSize).toString());

  try {
    const res = await fetch(`/api/dataset/records?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    currentDatasetRecords = data.records || [];
    datasetTotalCount = data.total_count || 0;

    const totalPages = Math.max(1, Math.ceil(datasetTotalCount / datasetPageSize));
    const startRec = datasetTotalCount === 0 ? 0 : data.offset + 1;
    const endRec = Math.min(data.offset + currentDatasetRecords.length, datasetTotalCount);

    const summaryEl = document.getElementById("datasetRecordSummary");
    if (summaryEl) {
      summaryEl.textContent = `Showing ${startRec}–${endRec} of ${datasetTotalCount} records`;
    }

    const pageInfoEl = document.getElementById("datasetPaginationInfo");
    if (pageInfoEl) {
      pageInfoEl.textContent = `Page ${datasetPage} of ${totalPages} (${datasetTotalCount} records)`;
    }

    const badgeEl = document.getElementById("datasetCurrentPageBadge");
    if (badgeEl) {
      badgeEl.textContent = `${datasetPage}`;
    }

    const prevBtn = document.getElementById("btnDatasetPrev");
    if (prevBtn) prevBtn.disabled = datasetPage <= 1;

    const nextBtn = document.getElementById("btnDatasetNext");
    if (nextBtn) nextBtn.disabled = datasetPage >= totalPages;

    renderDatasetRows(currentDatasetRecords);
  } catch (err) {
    console.error("Failed to fetch dataset records:", err);
    tbody.innerHTML = `<tr><td colspan="15" style="text-align: center; color: var(--text-tertiary); padding: 2rem;">Error loading records.</td></tr>`;
  }
}

function renderDatasetRows(records) {
  const tbody = document.getElementById("datasetTableBody");
  if (!tbody) return;

  if (!records || records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="15" style="text-align: center; color: var(--text-tertiary); padding: 2.5rem 1rem;">No records match the current filter criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = records
    .map((r, idx) => {
      let statusBadge = "";
      let cellClass = "";
      if (r.soh >= 80.0) {
        statusBadge = '<span class="status-badge nominal" style="font-size: 0.68rem; padding: 0.15rem 0.45rem;">Nominal</span>';
        cellClass = "cell-nominal";
      } else if (r.soh >= 70.0) {
        statusBadge = '<span class="status-badge caution" style="font-size: 0.68rem; padding: 0.15rem 0.45rem;">Degraded</span>';
        cellClass = "cell-caution";
      } else {
        statusBadge = '<span class="status-badge critical" style="font-size: 0.68rem; padding: 0.15rem 0.45rem;">EoL</span>';
        cellClass = "cell-critical";
      }

      return `
        <tr>
          <td style="font-weight: 600; color: var(--text-primary); font-family: var(--font-mono);">${r.battery_id}</td>
          <td style="text-align: right; color: var(--accent-cyan); font-weight: 600;">${r.cycle}</td>
          <td style="text-align: right;">${Number(r.capacity).toFixed(3)}</td>
          <td style="text-align: right; font-weight: 600;" class="${cellClass}">${Number(r.soh).toFixed(2)}%</td>
          <td style="text-align: center;">${statusBadge}</td>
          <td style="text-align: right;">${Number(r.t_cc).toFixed(1)}</td>
          <td style="text-align: right;">${Number(r.t_cv).toFixed(1)}</td>
          <td style="text-align: right;">${Number(r.dq_dv_peak).toFixed(2)}</td>
          <td style="text-align: right;">${Number(r.v_at_peak).toFixed(3)}</td>
          <td style="text-align: right;">${Number(r.delta_T_max).toFixed(2)}</td>
          <td style="text-align: right;">${Number(r.delta_V_ohmic).toFixed(3)}</td>
          <td style="text-align: right;">${Number(r.Re).toFixed(4)}</td>
          <td style="text-align: right;">${Number(r.Rct).toFixed(4)}</td>
          <td style="text-align: right;">${Number(r.rest_time_hours).toFixed(1)}</td>
          <td style="text-align: center;">
            <button class="btn-quiet btn-row-simulate" data-idx="${idx}" title="Simulate this cycle in workbench">
              Simulate
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  // Attach simulate click handler
  tbody.querySelectorAll(".btn-row-simulate").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      const row = currentDatasetRecords[idx];
      if (row) {
        applyFeatures(row);
        const presetLbl = document.getElementById("activePresetLabel");
        if (presetLbl) {
          presetLbl.textContent = `${row.battery_id} · Cycle ${row.cycle} (${Number(row.soh).toFixed(1)}% SoH)`;
        }
        // Switch to simulator tab
        document.querySelector('[data-tab="tab-simulator"]')?.click();
      }
    });
  });
}

async function exportDatasetCsv() {
  // Fetch all filtered records for export
  const params = new URLSearchParams();
  if (datasetSelectedCell && datasetSelectedCell !== "all") {
    params.set("battery_id", datasetSelectedCell);
  }
  if (datasetHealthFilter === "nominal") {
    params.set("min_soh", "80.0");
  } else if (datasetHealthFilter === "caution") {
    params.set("min_soh", "70.0");
    params.set("max_soh", "80.0");
  } else if (datasetHealthFilter === "eol") {
    params.set("max_soh", "70.0");
  }
  params.set("sort_by", datasetSortCol);
  params.set("order", datasetSortOrder);
  params.set("limit", "1000");
  params.set("offset", "0");

  try {
    const res = await fetch(`/api/dataset/records?${params.toString()}`);
    const data = await res.json();
    const rows = data.records || [];
    if (rows.length === 0) return;

    const headers = [
      "battery_id",
      "cycle",
      "capacity",
      "soh",
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

    const csvContent =
      headers.join(",") +
      "\n" +
      rows.map((r) => headers.map((h) => r[h]).join(",")).join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `nasa_battery_dataset_${datasetSelectedCell}_${Date.now()}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error("Failed to export CSV:", err);
  }
}

function renderMathEquations() {
  if (window.renderMathInElement) {
    const el = document.getElementById("tab-methodology");
    if (el) {
      window.renderMathInElement(el, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true },
        ],
        throwOnError: false,
      });
    }
  }
}

// ============================================================
// METHODOLOGY INTERACTIVE VISUAL CONTROLLERS
// ============================================================

async function fetchModelSpecs() {
  try {
    const res = await fetch("/api/models/specs");
    if (!res.ok) return;
    modelSpecsData = await res.json();
    renderModelInspector("Ridge");
  } catch (err) {
    console.error("Failed to fetch model specs:", err);
  }
}

function setupMethodologyTab() {
  // 1. Pipeline SVG flowchart node interaction
  const svgNodes = document.querySelectorAll(".pipeline-svg-node");
  svgNodes.forEach((node) => {
    node.addEventListener("click", () => {
      svgNodes.forEach((n) => n.classList.remove("active"));
      node.classList.add("active");
      const stage = node.getAttribute("data-stage");
      const card = document.getElementById(`flowCard-${stage}`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        card.style.borderColor = "var(--accent-primary)";
        setTimeout(() => {
          card.style.borderColor = "var(--border-subtle)";
        }, 1500);
      }
    });
  });

  // 2. Thevenin ECM Aging Slider
  const ecmSlider = document.getElementById("ecmAgingSlider");
  ecmSlider?.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    currentEcmAging = val;
    updateEcmSimulation(val);
  });

  // 3. dQ/dV Mode Buttons
  const icButtons = document.querySelectorAll(".ic-mode-btn");
  icButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      icButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const mode = btn.getAttribute("data-mode") || "all";
      currentIcMode = mode;
      updateIcAnatomy(mode);
    });
  });

  // 4. GPR Playground Sliders
  const gprLength = document.getElementById("gprLengthSlider");
  const gprNoise = document.getElementById("gprNoiseSlider");
  gprLength?.addEventListener("input", () => {
    const l = parseFloat(gprLength.value);
    document.getElementById("gprLengthVal").textContent = l.toFixed(2);
    updateGprPlayground(l, parseFloat(gprNoise.value));
  });
  gprNoise?.addEventListener("input", () => {
    const n = parseFloat(gprNoise.value);
    document.getElementById("gprNoiseVal").textContent = n.toFixed(3);
    updateGprPlayground(parseFloat(gprLength.value), n);
  });

  // 5. Model Inspector Switcher Buttons
  const modelBtns = document.querySelectorAll(".model-inspect-btn");
  modelBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      modelBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const modelName = btn.getAttribute("data-model");
      renderModelInspector(modelName);
    });
  });
}

function initMethodologyCharts() {
  // Chart 1: Thevenin ECM Charging Waveform
  const ctxEcm = document.getElementById("ecmChargingChart")?.getContext("2d");
  if (ctxEcm && !ecmChart) {
    ecmChart = new Chart(ctxEcm, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Terminal Voltage V_term(t)",
            data: [],
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.08)",
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.15,
          },
          {
            label: "Open-Circuit Voltage V_OCV(t)",
            data: [],
            borderColor: "#64748b",
            borderDash: [4, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
          },
          {
            label: "4.20V Cutoff Ceiling",
            data: [],
            borderColor: "#f43f5e",
            borderDash: [6, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 150 },
        scales: {
          x: {
            title: { display: true, text: "Charging Time (seconds)", color: "#64748b", font: { size: 9.5 } },
            grid: { color: "rgba(255, 255, 255, 0.04)" },
            ticks: { color: "#64748b", font: { family: "monospace", size: 9 }, maxTicksLimit: 6 },
          },
          y: {
            min: 3.6,
            max: 4.28,
            title: { display: true, text: "Voltage (V)", color: "#64748b", font: { size: 9.5 } },
            grid: { color: "rgba(255, 255, 255, 0.04)" },
            ticks: { color: "#64748b", font: { family: "monospace", size: 9 } },
          },
        },
        plugins: {
          legend: {
            labels: { color: "#94a3b8", font: { size: 9.5 }, boxWidth: 10 },
          },
        },
      },
    });
    updateEcmSimulation(0);
  }

  // Chart 2: Incremental Capacity (dQ/dV) Anatomy
  const ctxIc = document.getElementById("icAnatomyChart")?.getContext("2d");
  if (ctxIc && !icAnatomyChart) {
    icAnatomyChart = new Chart(ctxIc, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Fresh Cell (Cycle 10 · 95% SoH)",
            data: [],
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.12)",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3,
            fill: false,
          },
          {
            label: "Aged Cell (Cycle 140 · 68% SoH)",
            data: [],
            borderColor: "#f43f5e",
            backgroundColor: "rgba(244, 63, 94, 0.12)",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        scales: {
          x: {
            title: { display: true, text: "Voltage (V)", color: "#64748b", font: { size: 9.5 } },
            grid: { color: "rgba(255, 255, 255, 0.04)" },
            ticks: { color: "#64748b", font: { family: "monospace", size: 9 }, maxTicksLimit: 7 },
          },
          y: {
            min: 0,
            max: 5.8,
            title: { display: true, text: "dQ/dV (Ah / V)", color: "#64748b", font: { size: 9.5 } },
            grid: { color: "rgba(255, 255, 255, 0.04)" },
            ticks: { color: "#64748b", font: { family: "monospace", size: 9 } },
          },
        },
        plugins: {
          legend: {
            labels: { color: "#94a3b8", font: { size: 9.5 }, boxWidth: 10 },
          },
        },
      },
    });
    updateIcAnatomy("all");
  }

  // Chart 3: Gaussian Process Epistemic Uncertainty Playground
  const ctxGpr = document.getElementById("gprPlaygroundChart")?.getContext("2d");
  if (ctxGpr && !gprPlaygroundChart) {
    gprPlaygroundChart = new Chart(ctxGpr, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Epistemic Upper 95% CI (+1.96σ)",
            data: [],
            borderColor: "transparent",
            pointRadius: 0,
            fill: "+1",
            backgroundColor: "rgba(56, 189, 248, 0.12)",
          },
          {
            label: "Epistemic Lower 95% CI (-1.96σ)",
            data: [],
            borderColor: "transparent",
            pointRadius: 0,
            fill: false,
          },
          {
            label: "GPR Posterior Mean μ(Cycle)",
            data: [],
            borderColor: "#38bdf8",
            borderWidth: 2.2,
            pointRadius: 0,
            tension: 0.2,
          },
          {
            label: "Observed Cycles",
            data: [],
            type: "scatter",
            backgroundColor: "#ffffff",
            borderColor: "#38bdf8",
            borderWidth: 1.5,
            pointRadius: 3,
          },
          {
            label: "70% EoL Criterion",
            data: [],
            borderColor: "#f43f5e",
            borderDash: [5, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 200 },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: 168,
            title: { display: true, text: "Aging Cycles", color: "#64748b", font: { size: 9.5 } },
            grid: { color: "rgba(255, 255, 255, 0.04)" },
            ticks: { color: "#64748b", font: { family: "monospace", size: 9 } },
          },
          y: {
            min: 60,
            max: 104,
            title: { display: true, text: "State of Health SoH (%)", color: "#64748b", font: { size: 9.5 } },
            grid: { color: "rgba(255, 255, 255, 0.04)" },
            ticks: { color: "#64748b", font: { family: "monospace", size: 9 } },
          },
        },
        plugins: {
          legend: {
            labels: { color: "#94a3b8", font: { size: 9.5 }, boxWidth: 10 },
          },
        },
      },
    });
    updateGprPlayground(1.2, 0.015);
  }
}

function updateEcmSimulation(pct) {
  // pct: 0 (fresh) to 100 (aged)
  const norm = pct / 100.0;
  const re = 0.045 + 0.070 * norm;
  const rct = 0.065 + 0.215 * norm;
  const rTotal = re + rct;
  const ohmicDrop = 1.5 * rTotal;

  // t_cc decreases as impedance increases; t_cv increases
  const tcc = Math.round(3024 - 1200 * norm);
  const tcv = Math.round(6960 + 2400 * norm);

  // Update text & badges
  const stateTxt = document.getElementById("ecmAgingStateText");
  const badge = document.getElementById("ecmCutoffBadge");
  if (stateTxt) {
    if (pct < 25) {
      stateTxt.textContent = `Fresh Cell (Cycle 2 · 100% SoH)`;
      if (badge) { badge.className = "status-badge nominal"; badge.textContent = "Normal Cutoff"; }
    } else if (pct < 70) {
      stateTxt.textContent = `Mid-Life Cell (Cycle 85 · 82% SoH)`;
      if (badge) { badge.className = "status-badge caution"; badge.textContent = "Overpotential Shift"; }
    } else {
      stateTxt.textContent = `Aged Cell (Cycle 160 · 67% SoH)`;
      if (badge) { badge.className = "status-badge critical"; badge.textContent = "Premature Cutoff (EoL)"; }
    }
  }

  const reEl = document.getElementById("ecmReVal");
  const rctEl = document.getElementById("ecmRctVal");
  const ohmicEl = document.getElementById("ecmOhmicVal");
  const tccEl = document.getElementById("ecmTccVal");
  const tcvEl = document.getElementById("ecmTcvVal");
  if (reEl) reEl.textContent = `${re.toFixed(3)} Ω`;
  if (rctEl) rctEl.textContent = `${rct.toFixed(3)} Ω`;
  if (ohmicEl) ohmicEl.textContent = `${ohmicDrop.toFixed(3)} V`;
  if (tccEl) tccEl.textContent = `${tcc} s`;
  if (tcvEl) tcvEl.textContent = `${tcv} s`;

  const svgRe = document.getElementById("svgReText");
  const svgRct = document.getElementById("svgRctText");
  if (svgRe) svgRe.textContent = `${re.toFixed(3)} Ω`;
  if (svgRct) svgRct.textContent = `${rct.toFixed(3)} Ω`;

  if (!ecmChart) return;

  // Generate 60 points for CC-CV charging curve
  const labels = [];
  const vTerm = [];
  const vOcv = [];
  const vCeil = [];

  const timeMax = 9000;
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const t = Math.round((i / steps) * timeMax);
    labels.push(t);
    vCeil.push(4.20);

    // Baseline OCV rises from 3.65V to 4.18V
    const frac = Math.min(1.0, t / 4200);
    const ocv = 3.65 + 0.50 * Math.pow(frac, 0.65);
    vOcv.push(parseFloat(ocv.toFixed(3)));

    if (t <= tcc) {
      // CC mode: terminal voltage = OCV + ohmicDrop + polarization
      const polar = 0.05 * (1 - Math.exp(-t / 300));
      const term = Math.min(4.20, ocv + ohmicDrop + polar);
      vTerm.push(parseFloat(term.toFixed(3)));
    } else {
      // CV mode: clamped at 4.20V
      vTerm.push(4.20);
    }
  }

  ecmChart.data.labels = labels;
  ecmChart.data.datasets[0].data = vTerm;
  ecmChart.data.datasets[1].data = vOcv;
  ecmChart.data.datasets[2].data = vCeil;
  ecmChart.update();
}

function updateIcAnatomy(mode) {
  const titleEl = document.getElementById("icModeTitle");
  const descEl = document.getElementById("icModeDesc");

  if (!icAnatomyChart) return;

  const vVals = [];
  const freshCurve = [];
  const agedCurve = [];

  // Voltage range 3.80V to 4.18V in steps of 0.005V
  for (let v = 3.80; v <= 4.18; v += 0.005) {
    const vRound = parseFloat(v.toFixed(3));
    vVals.push(vRound);

    // Fresh cell: Peak 1 at 3.900V (height 4.6), Peak 2 at 4.020V (height 5.1)
    const p1Fresh = 4.6 * Math.exp(-Math.pow((vRound - 3.900) / 0.035, 2));
    const p2Fresh = 5.1 * Math.exp(-Math.pow((vRound - 4.020) / 0.030, 2));
    const bgFresh = 0.6 + 0.4 * (vRound - 3.80);
    freshCurve.push(parseFloat((p1Fresh + p2Fresh + bgFresh).toFixed(3)));

    // Aged cell: Peak 1 shifted to 3.935V (height 2.6), Peak 2 shifted to 4.050V (height 2.9)
    const p1Aged = 2.6 * Math.exp(-Math.pow((vRound - 3.935) / 0.038, 2));
    const p2Aged = 2.9 * Math.exp(-Math.pow((vRound - 4.050) / 0.032, 2));
    const bgAged = 0.4 + 0.3 * (vRound - 3.80);
    agedCurve.push(parseFloat((p1Aged + p2Aged + bgAged).toFixed(3)));
  }

  icAnatomyChart.data.labels = vVals;
  icAnatomyChart.data.datasets[0].data = freshCurve;
  icAnatomyChart.data.datasets[1].data = agedCurve;

  if (mode === "lam") {
    if (titleEl) titleEl.textContent = "Loss of Active Material (LAM): Peak Amplitude Collapse";
    if (descEl) descEl.innerHTML = "Notice the sharp collapse of Peak 1 (from <strong>5.2 Ah/V down to 2.8 Ah/V</strong>). In lithium-ion cells, mechanical particle cracking and graphite exfoliation reduce the active surface area available for intercalation, directly lowering the derivative peak amplitude without necessarily shifting its intrinsic open-circuit potential.";
    icAnatomyChart.data.datasets[0].fill = false;
    icAnatomyChart.data.datasets[1].fill = false;
    icAnatomyChart.data.datasets[1].borderColor = "#f43f5e";
  } else if (mode === "lli") {
    if (titleEl) titleEl.textContent = "Loss of Lithium Inventory (LLI): Total Integrated Area Shrinkage";
    if (descEl) descEl.innerHTML = "Because \\(\\int_{V_1}^{V_2} (dQ/dV)\\,dV = \\Delta Q\\), the total area bounded under the curve corresponds to total transferable discharge capacity. Irreversible solid electrolyte interphase (SEI) thickening consumes cyclable lithium ions, shrinking the area between curves (a loss of <strong>0.54 Ah</strong> over 140 cycles).";
    icAnatomyChart.data.datasets[0].fill = true;
    icAnatomyChart.data.datasets[1].fill = true;
  } else if (mode === "ohmic") {
    if (titleEl) titleEl.textContent = "Ohmic Overpotential Drift: Rightward Peak Displacement (ΔV)";
    if (descEl) descEl.innerHTML = "Observe that the aged peak positions are displaced to the right: Peak 1 shifts from <strong>3.900V → 3.935V (+35 mV)</strong>. Because \\(\\Delta V = I_{\\text{charge}} \\cdot R_{\\text{int}}\\), measuring peak drift directly quantifies internal resistance growth in situ without requiring an external electrochemical impedance spectroscopy (EIS) sweep.";
    icAnatomyChart.data.datasets[0].fill = false;
    icAnatomyChart.data.datasets[1].fill = false;
    icAnatomyChart.data.datasets[1].borderColor = "#fbbf24";
  } else {
    if (titleEl) titleEl.textContent = "Graphite Staging & Redox Phase Transition Peaks";
    if (descEl) descEl.innerHTML = "The Incremental Capacity curve converts plateau regions in the charging curve into distinct diagnostic peaks. Peak 1 at \\(\\approx 3.90\\text{ V}\\) reflects Stage 2 graphite intercalation (\\(\\text{LiC}_{12} \\to \\text{LiC}_6\\)), while Peak 2 at \\(\\approx 4.02\\text{ V}\\) reflects cathode transition-metal redox couples.";
    icAnatomyChart.data.datasets[0].fill = false;
    icAnatomyChart.data.datasets[1].fill = false;
    icAnatomyChart.data.datasets[1].borderColor = "#f43f5e";
  }

  icAnatomyChart.update();
  renderMathEquations();
}

function updateGprPlayground(lengthScale, noiseVar) {
  if (!gprPlaygroundChart) return;

  const cycles = [];
  const meanVals = [];
  const upperVals = [];
  const lowerVals = [];
  const eolLine = [];

  // Generate cycles 1 to 168
  for (let c = 1; c <= 168; c += 2) {
    cycles.push(c);
    eolLine.push(70.0);

    // True degradation path
    const trueSoh = 100 - 0.17 * c - 0.00045 * Math.pow(c, 2);
    // Add diffusion recovery wave around cycle 20 and 80
    const regen = (c > 20 && c < 35 ? 1.8 : 0) + (c > 80 && c < 95 ? 1.4 : 0);
    const mean = trueSoh + regen;
    meanVals.push(parseFloat(mean.toFixed(2)));

    // Epistemic uncertainty: increases away from training clusters and inversely with length scale
    const dist = Math.abs(c - 70) / 70.0;
    const epistemicStd = Math.sqrt(noiseVar * 100 + (Math.pow(dist, 2) * 4.5) / lengthScale);
    const halfWidth = 1.96 * epistemicStd;

    upperVals.push(parseFloat((mean + halfWidth).toFixed(2)));
    lowerVals.push(parseFloat((mean - halfWidth).toFixed(2)));
  }

  // Scattered observations
  const obsPoints = [
    { x: 2, y: 99.4 }, { x: 15, y: 97.2 }, { x: 30, y: 96.1 },
    { x: 50, y: 91.5 }, { x: 70, y: 86.8 }, { x: 90, y: 82.3 },
    { x: 110, y: 77.9 }, { x: 130, y: 72.8 }, { x: 150, y: 66.4 }
  ];

  gprPlaygroundChart.data.labels = cycles;
  gprPlaygroundChart.data.datasets[0].data = upperVals;
  gprPlaygroundChart.data.datasets[1].data = lowerVals;
  gprPlaygroundChart.data.datasets[2].data = meanVals;
  gprPlaygroundChart.data.datasets[3].data = obsPoints;
  gprPlaygroundChart.data.datasets[4].data = eolLine;
  gprPlaygroundChart.update();
}

function renderModelInspector(modelName) {
  const container = document.getElementById("modelInspectorCard");
  if (!container) return;

  if (!modelSpecsData || !modelSpecsData.models || !modelSpecsData.models[modelName]) {
    container.innerHTML = `<div style="color: var(--text-tertiary); font-size: 0.8rem;">Loading model specifications...</div>`;
    return;
  }

  const m = modelSpecsData.models[modelName];

  let hyperRows = "";
  if (m.hyperparameters) {
    hyperRows = Object.entries(m.hyperparameters)
      .map(([k, v]) => `
        <tr>
          <td><code>${k}</code></td>
          <td><strong>${v}</strong></td>
        </tr>
      `)
      .join("");
  }

  // Visual header descriptors per model
  const visualMeta = {
    Ridge: {
      title: "L2 Regularization Shrinkage Path (Tikhonov)",
      badge: "α = 1.0 Optimal Point",
      subtitle: "Weight trajectory as penalty log10(α) sweeps from 10⁻³ to 10⁺³. L2 shrinkage stabilizes ill-conditioned R_ct and ΔT_max inversion without zeroing.",
      footnote: "Condition number κ(X^T X + αI) is stabilized at α=1.0, preserving physical signals while attenuating high-frequency noise."
    },
    ElasticNet: {
      title: "L1 / L2 Sparsity & Collinear Grouping Path",
      badge: "ρ = 0.5 Grouping Mode",
      subtitle: "Feature retention across l1_ratio ρ ∈ [0, 1]. Correlated bulk (Re) and charge-transfer (Rct) resistances are retained together instead of arbitrarily dropped.",
      footnote: "Strict convexity from (1-ρ)||w||_2^2 forces collinear pairs to share weights, preventing random single-feature selection seen in pure Lasso."
    },
    SVR: {
      title: "ε-Insensitive Loss Tube & Support Vector Boundaries",
      badge: "ε = ±0.1% Margin",
      subtitle: "Deviation envelope. Residuals within ±ε incur zero penalty (ξ=0). Margin vectors and slack violations (ξ>0) shape the optimal dual hyperplane.",
      footnote: "Dual optimization: min 1/2||w||^2 + C Σ(ξ_i + ξ_i^*). Noise inside the ±0.1% tube is completely ignored by the loss function."
    },
    GPR: {
      title: "Covariance Kernel Spatial Decay: k(r) vs Distance r",
      badge: "Matérn 5/2 (ν = 2.5)",
      subtitle: "Spatial correlation function decay across normalized distance r = ||x - x'|| / l. Matérn 5/2 yields realistic C² twice-differentiable degradation trajectories.",
      footnote: "Avoids unrealistically smooth, analytic infinite-differentiability artifacts of RBF while matching continuous electrochemical battery wear."
    },
    XGBoost: {
      title: "TreeSHAP Feature Attribution & Shapley Values",
      badge: "8-Channel Importance",
      subtitle: "Polynomial-time TreeSHAP attributions revealing positive health indicators (t_cc, dQ/dV_peak) vs degradation drivers (Rct, t_cv, ΔT_max).",
      footnote: "Dominant feature t_cc drives 36% of total tree split gain; impedance features exhibit strong negative partial dependence."
    }
  };

  const meta = visualMeta[modelName] || visualMeta.Ridge;

  container.innerHTML = `
    <div class="model-inspector-grid" style="grid-template-columns: 1fr 1.15fr; gap: 1.25rem; align-items: start;">
      <!-- Left Column: Equations & Parameters -->
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.35rem;">
            <h3 style="font-size: 0.98rem; font-weight: 600; color: var(--text-primary); margin: 0;">${m.name}</h3>
            <span class="brand-pill">${m.family}</span>
          </div>
          <p style="font-size: 0.78rem; color: var(--text-secondary); line-height: 1.55; margin-bottom: 0.6rem;">
            ${m.role}
          </p>

          <div style="font-size: 0.72rem; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; letter-spacing: 0.05em; margin-bottom: 0.25rem;">
            Optimization Objective
          </div>
          <div class="katex-equation-block">
            $$${m.objective || m.prior || ""}$$
          </div>

          ${m.solution ? `
            <div style="font-size: 0.72rem; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; letter-spacing: 0.05em; margin-top: 0.5rem; margin-bottom: 0.25rem;">
              Analytical Solution / Solver
            </div>
            <div class="katex-equation-block">
              $$${m.solution}$$
            </div>
          ` : ""}
        </div>

        <div>
          <div style="font-size: 0.74rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.35rem;">
            Configured Hyperparameters
          </div>
          <table class="instrument-table" style="font-size: 0.76rem;">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Setting</th>
              </tr>
            </thead>
            <tbody>
              ${hyperRows}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Right Column: Interactive Diagnostic Architecture Visualization -->
      <div style="background: #080a0f; border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px; padding: 0.85rem; display: flex; flex-direction: column;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem;">
          <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-primary);">${meta.title}</span>
          <span class="brand-pill" style="font-size: 0.68rem; color: var(--accent-cyan); border-color: rgba(56, 189, 248, 0.3);">${meta.badge}</span>
        </div>
        <div style="font-size: 0.72rem; color: var(--text-tertiary); margin-bottom: 0.5rem; line-height: 1.45;">
          ${meta.subtitle}
        </div>

        <div class="chart-box" style="height: 250px; position: relative;">
          <canvas id="modelVisualChart"></canvas>
        </div>

        <div style="margin-top: 0.5rem; font-size: 0.71rem; color: var(--text-secondary); border-top: 1px solid var(--border-subtle); padding-top: 0.4rem; font-family: var(--font-mono); line-height: 1.4;">
          ${meta.footnote}
        </div>
      </div>
    </div>
  `;

  renderMathEquations();
  drawModelVisualChart(modelName);
}

function drawModelVisualChart(modelName) {
  const canvas = document.getElementById("modelVisualChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  if (modelVisualChartInstance) {
    modelVisualChartInstance.destroy();
    modelVisualChartInstance = null;
  }

  const baseScales = {
    x: {
      grid: { color: "rgba(255, 255, 255, 0.04)" },
      ticks: { color: "#64748b", font: { family: "monospace", size: 9 } },
    },
    y: {
      grid: { color: "rgba(255, 255, 255, 0.04)" },
      ticks: { color: "#64748b", font: { family: "monospace", size: 9 } },
    },
  };

  const baseLegend = {
    labels: { color: "#94a3b8", font: { size: 9 }, boxWidth: 10 },
  };

  if (modelName === "Ridge") {
    // Regularization shrinkage trace across log10(alpha)
    const labels = ["-3", "-2", "-1", "0 (α=1.0)", "+1", "+2", "+3"];
    modelVisualChartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "t_cc (CC Duration)",
            data: [0.65, 0.62, 0.58, 0.52, 0.35, 0.15, 0.04],
            borderColor: "#38bdf8",
            borderWidth: 2,
            pointRadius: [3, 3, 3, 6, 3, 3, 3],
            pointBackgroundColor: ["#38bdf8", "#38bdf8", "#38bdf8", "#ffffff", "#38bdf8", "#38bdf8", "#38bdf8"],
            tension: 0.25,
          },
          {
            label: "(dQ/dV)_peak",
            data: [0.55, 0.51, 0.46, 0.41, 0.28, 0.12, 0.03],
            borderColor: "#34d399",
            borderWidth: 2,
            pointRadius: [3, 3, 3, 6, 3, 3, 3],
            pointBackgroundColor: ["#34d399", "#34d399", "#34d399", "#ffffff", "#34d399", "#34d399", "#34d399"],
            tension: 0.25,
          },
          {
            label: "R_ct (Charge-Transfer)",
            data: [-0.95, -0.65, -0.42, -0.34, -0.20, -0.08, -0.02],
            borderColor: "#f43f5e",
            borderWidth: 2,
            pointRadius: [3, 3, 3, 6, 3, 3, 3],
            pointBackgroundColor: ["#f43f5e", "#f43f5e", "#f43f5e", "#ffffff", "#f43f5e", "#f43f5e", "#f43f5e"],
            tension: 0.25,
          },
          {
            label: "t_cv (CV Duration)",
            data: [-0.38, -0.35, -0.31, -0.27, -0.18, -0.08, -0.02],
            borderColor: "#fbbf24",
            borderWidth: 1.5,
            pointRadius: 2.5,
            tension: 0.25,
          },
          {
            label: "ΔT_max (Thermal Rise)",
            data: [-0.28, -0.25, -0.22, -0.19, -0.12, -0.05, -0.01],
            borderColor: "#a78bfa",
            borderWidth: 1.5,
            pointRadius: 2.5,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        scales: {
          x: {
            ...baseScales.x,
            title: { display: true, text: "Regularization Penalty log10(α)", color: "#64748b", font: { size: 9.5 } },
          },
          y: {
            ...baseScales.y,
            title: { display: true, text: "Standardized Coefficient w_i", color: "#64748b", font: { size: 9.5 } },
          },
        },
        plugins: {
          legend: baseLegend,
          tooltip: {
            callbacks: {
              title: (items) => `log10(α) = ${items[0].label}`,
            },
          },
        },
      },
    });
  } else if (modelName === "ElasticNet") {
    // L1/L2 trade-off across l1_ratio rho
    const labels = ["0.0 (Ridge)", "0.2", "0.4", "0.5 (Active)", "0.6", "0.8", "1.0 (Lasso)"];
    modelVisualChartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "t_cc",
            data: [0.52, 0.51, 0.49, 0.48, 0.46, 0.45, 0.43],
            borderColor: "#38bdf8",
            borderWidth: 2,
            pointRadius: [3, 3, 3, 6, 3, 3, 3],
            pointBackgroundColor: ["#38bdf8", "#38bdf8", "#38bdf8", "#ffffff", "#38bdf8", "#38bdf8", "#38bdf8"],
            tension: 0.2,
          },
          {
            label: "(dQ/dV)_peak",
            data: [0.41, 0.40, 0.39, 0.38, 0.37, 0.36, 0.34],
            borderColor: "#34d399",
            borderWidth: 2,
            pointRadius: [3, 3, 3, 6, 3, 3, 3],
            pointBackgroundColor: ["#34d399", "#34d399", "#34d399", "#ffffff", "#34d399", "#34d399", "#34d399"],
            tension: 0.2,
          },
          {
            label: "R_ct (Charge-Transfer)",
            data: [-0.34, -0.32, -0.30, -0.29, -0.28, -0.26, -0.25],
            borderColor: "#f43f5e",
            borderWidth: 2,
            pointRadius: [3, 3, 3, 6, 3, 3, 3],
            pointBackgroundColor: ["#f43f5e", "#f43f5e", "#f43f5e", "#ffffff", "#f43f5e", "#f43f5e", "#f43f5e"],
            tension: 0.2,
          },
          {
            label: "R_e (Collinear Bulk Res.)",
            data: [-0.22, -0.20, -0.18, -0.16, -0.13, -0.06, 0.00],
            borderColor: "#fbbf24",
            borderWidth: 2,
            pointRadius: [3, 3, 3, 6, 3, 3, 4],
            pointBackgroundColor: ["#fbbf24", "#fbbf24", "#fbbf24", "#ffffff", "#fbbf24", "#fbbf24", "#ef4444"],
            tension: 0.2,
          },
          {
            label: "Noise Feature (Zeroed at Lasso)",
            data: [0.08, 0.05, 0.02, 0.00, 0.00, 0.00, 0.00],
            borderColor: "#64748b",
            borderWidth: 1.5,
            borderDash: [4, 4],
            pointRadius: 2,
            tension: 0.2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        scales: {
          x: {
            ...baseScales.x,
            title: { display: true, text: "L1 Ratio ρ (0 = Pure L2 Ridge, 1 = Pure L1 Lasso)", color: "#64748b", font: { size: 9.5 } },
          },
          y: {
            ...baseScales.y,
            title: { display: true, text: "Standardized Coefficient w_i", color: "#64748b", font: { size: 9.5 } },
          },
        },
        plugins: {
          legend: baseLegend,
          tooltip: {
            callbacks: {
              title: (items) => `l1_ratio ρ = ${items[0].label}`,
            },
          },
        },
      },
    });
  } else if (modelName === "SVR") {
    // Epsilon-insensitive tube visualization
    const predSoh = [68, 72, 76, 80, 84, 88, 92, 96, 100];
    const upperMargin = predSoh.map(() => 0.10);
    const zeroLine = predSoh.map(() => 0.00);
    const lowerMargin = predSoh.map(() => -0.10);

    // Non-support vectors (inside tube)
    const insideTubePoints = [
      { x: 69, y: 0.03 }, { x: 71, y: -0.04 }, { x: 73, y: 0.06 }, { x: 75, y: -0.02 },
      { x: 78, y: 0.01 }, { x: 81, y: -0.05 }, { x: 83, y: 0.04 }, { x: 85, y: -0.03 },
      { x: 87, y: 0.05 }, { x: 89, y: -0.06 }, { x: 91, y: 0.02 }, { x: 93, y: -0.04 },
      { x: 95, y: 0.05 }, { x: 97, y: -0.01 }, { x: 99, y: 0.03 },
    ];

    // Margin Support Vectors (on boundary |e| ~ 0.10)
    const marginVectors = [
      { x: 70, y: 0.10 }, { x: 74, y: -0.10 }, { x: 79, y: 0.10 }, { x: 86, y: -0.10 },
      { x: 90, y: 0.10 }, { x: 94, y: -0.10 }, { x: 98, y: 0.10 },
    ];

    // Slack Violations (outside tube, xi > 0)
    const slackPoints = [
      { x: 72, y: 0.22 }, { x: 77, y: -0.24 }, { x: 82, y: 0.19 },
      { x: 88, y: -0.21 }, { x: 92, y: 0.25 }, { x: 96, y: -0.18 },
    ];

    modelVisualChartInstance = new Chart(ctx, {
      type: "scatter",
      data: {
        datasets: [
          {
            type: "line",
            label: "+ε Upper Margin (+0.10%)",
            data: predSoh.map((x, i) => ({ x, y: upperMargin[i] })),
            borderColor: "#38bdf8",
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0,
            fill: false,
          },
          {
            type: "line",
            label: "Zero Loss Line (y = ŷ)",
            data: predSoh.map((x, i) => ({ x, y: zeroLine[i] })),
            borderColor: "#475569",
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
          },
          {
            type: "line",
            label: "-ε Lower Margin (-0.10%)",
            data: predSoh.map((x, i) => ({ x, y: lowerMargin[i] })),
            borderColor: "#38bdf8",
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0,
            fill: "-2",
            backgroundColor: "rgba(56, 189, 248, 0.08)",
          },
          {
            label: "Inside Tube (Zero Loss, ξ=0)",
            data: insideTubePoints,
            backgroundColor: "#64748b",
            pointRadius: 3.5,
          },
          {
            label: "Margin Support Vectors (|e| = ε)",
            data: marginVectors,
            backgroundColor: "#38bdf8",
            borderColor: "#ffffff",
            borderWidth: 1.5,
            pointRadius: 5.5,
          },
          {
            label: "Slack Errors (Penalty ξ > 0)",
            data: slackPoints,
            backgroundColor: "#f43f5e",
            borderColor: "#ffffff",
            borderWidth: 1.5,
            pointRadius: 5.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        scales: {
          x: {
            ...baseScales.x,
            min: 67,
            max: 101,
            title: { display: true, text: "Predicted State of Health ŷ (%)", color: "#64748b", font: { size: 9.5 } },
          },
          y: {
            ...baseScales.y,
            min: -0.32,
            max: 0.32,
            title: { display: true, text: "Residual Error (y - ŷ, % SoH)", color: "#64748b", font: { size: 9.5 } },
          },
        },
        plugins: {
          legend: baseLegend,
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ŷ=${ctx.raw.x}%, error=${ctx.raw.y > 0 ? "+" : ""}${ctx.raw.y.toFixed(2)}%`,
            },
          },
        },
      },
    });
  } else if (modelName === "GPR") {
    // Kernel spatial covariance decay comparison
    const rVals = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0, 2.5, 3.0];
    const labels = rVals.map((r) => r.toFixed(1));

    // Matérn 5/2: (1 + sqrt(5)*r + 5/3*r^2) * exp(-sqrt(5)*r)
    const matern52 = rVals.map((r) => {
      const s5 = Math.sqrt(5);
      const val = (1 + s5 * r + (5 / 3) * Math.pow(r, 2)) * Math.exp(-s5 * r);
      return parseFloat(val.toFixed(3));
    });

    // RBF / Squared Exponential: exp(-r^2 / 2)
    const rbf = rVals.map((r) => parseFloat(Math.exp(-Math.pow(r, 2) / 2).toFixed(3)));

    // Exponential / Matérn 1/2: exp(-r)
    const expKernel = rVals.map((r) => parseFloat(Math.exp(-r).toFixed(3)));

    modelVisualChartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Matérn 5/2 (Configured Kernel)",
            data: matern52,
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.08)",
            borderWidth: 2.5,
            pointRadius: 3,
            fill: true,
            tension: 0.25,
          },
          {
            label: "RBF / Gaussian (Overly Smooth C^∞)",
            data: rbf,
            borderColor: "#fbbf24",
            borderWidth: 2,
            borderDash: [5, 4],
            pointRadius: 2.5,
            fill: false,
            tension: 0.25,
          },
          {
            label: "Exponential ν=0.5 (Rough C⁰)",
            data: expKernel,
            borderColor: "#f43f5e",
            borderWidth: 1.5,
            borderDash: [3, 3],
            pointRadius: 2.5,
            fill: false,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        scales: {
          x: {
            ...baseScales.x,
            title: { display: true, text: "Normalized Distance r = ||x - x'|| / l", color: "#64748b", font: { size: 9.5 } },
          },
          y: {
            ...baseScales.y,
            min: 0.0,
            max: 1.05,
            title: { display: true, text: "Covariance Correlation k(r)", color: "#64748b", font: { size: 9.5 } },
          },
        },
        plugins: {
          legend: baseLegend,
          tooltip: {
            callbacks: {
              title: (items) => `Distance r/l = ${items[0].label}`,
            },
          },
        },
      },
    });
  } else if (modelName === "XGBoost") {
    // TreeSHAP horizontal bar chart
    const shapFeatures = [
      "t_cc (CC Duration)",
      "(dQ/dV)_peak",
      "R_ct (Charge-Transfer)",
      "t_cv (CV Duration)",
      "R_e (Bulk Resistance)",
      "ΔT_max (Thermal Rise)",
      "ΔV_ohmic (Ohmic Step)",
      "V_peak (Peak Voltage)",
    ];
    const shapValues = [5.82, 4.12, 3.85, 3.10, 2.45, 1.90, 1.35, 0.80];
    const barColors = [
      "#38bdf8", // t_cc (positive)
      "#38bdf8", // dQ/dV (positive)
      "#f43f5e", // R_ct (negative)
      "#f43f5e", // t_cv (negative)
      "#f43f5e", // R_e (negative)
      "#f43f5e", // ΔT_max (negative)
      "#f43f5e", // ΔV_ohmic (negative)
      "#34d399", // V_peak (positive)
    ];

    modelVisualChartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: shapFeatures,
        datasets: [
          {
            label: "Mean |SHAP Value| (% SoH Impact)",
            data: shapValues,
            backgroundColor: barColors,
            borderRadius: 3,
            borderWidth: 0,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        scales: {
          x: {
            ...baseScales.x,
            title: { display: true, text: "Mean |SHAP Attribution| (% SoH Variance)", color: "#64748b", font: { size: 9.5 } },
          },
          y: {
            ...baseScales.y,
            ticks: { color: "#94a3b8", font: { size: 9.5 } },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `Impact: ${ctx.raw}% SoH contribution`,
            },
          },
        },
      },
    });
  }
}

// ============================================================
// CROSS-MODEL LEAVE-ONE-BATTERY-OUT (LOBO) TRAJECTORY EXPLORER
// ============================================================

function initLoboComparisonChart() {
  const canvas = document.getElementById("loboComparisonChart");
  if (!canvas || loboComparisonChartInstance) return;

  const ctx = canvas.getContext("2d");
  loboComparisonChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Ground Truth (Actual SoH)",
          data: [],
          borderColor: "#f8fafc",
          backgroundColor: "#f8fafc",
          borderWidth: 2.2,
          pointRadius: 2.5,
          pointHoverRadius: 4.5,
          tension: 0.1,
          order: 1,
        },
        {
          label: "Gaussian Process (GPR Mean)",
          data: [],
          borderColor: "#38bdf8",
          backgroundColor: "#38bdf8",
          borderWidth: 2,
          pointRadius: 1.5,
          tension: 0.2,
          order: 2,
        },
        {
          label: "GPR Upper 95% CI",
          data: [],
          borderColor: "rgba(56, 189, 248, 0.4)",
          borderWidth: 0.8,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: "+1",
          backgroundColor: "rgba(56, 189, 248, 0.10)",
          tension: 0.2,
          order: 4,
        },
        {
          label: "GPR Lower 95% CI",
          data: [],
          borderColor: "rgba(56, 189, 248, 0.4)",
          borderWidth: 0.8,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: false,
          tension: 0.2,
          order: 5,
        },
        {
          label: "XGBoost Ensemble",
          data: [],
          borderColor: "#34d399",
          borderWidth: 1.8,
          pointRadius: 0,
          tension: 0.15,
          order: 3,
        },
        {
          label: "Support Vector (SVR)",
          data: [],
          borderColor: "#a78bfa",
          borderWidth: 1.4,
          borderDash: [4, 3],
          pointRadius: 0,
          tension: 0.15,
          order: 6,
        },
        {
          label: "ElasticNet",
          data: [],
          borderColor: "#fbbf24",
          borderWidth: 1.4,
          borderDash: [3, 3],
          pointRadius: 0,
          tension: 0.15,
          order: 7,
        },
        {
          label: "Ridge Baseline",
          data: [],
          borderColor: "#94a3b8",
          borderWidth: 1.4,
          borderDash: [5, 4],
          pointRadius: 0,
          tension: 0.15,
          order: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: {
        mode: "index",
        intersect: false,
      },
      scales: {
        x: {
          grid: { color: "rgba(255, 255, 255, 0.04)" },
          ticks: { color: "#64748b", font: { family: "monospace", size: 9 }, maxTicksLimit: 12 },
          title: { display: true, text: "Aging Cycle Index", color: "#64748b", font: { size: 9.5 } },
        },
        y: {
          grid: { color: "rgba(255, 255, 255, 0.04)" },
          ticks: { color: "#64748b", font: { family: "monospace", size: 9 } },
          title: { display: true, text: "State of Health SoH (%)", color: "#64748b", font: { size: 9.5 } },
        },
      },
      plugins: {
        legend: {
          labels: { color: "#94a3b8", font: { size: 9.5 }, boxWidth: 10 },
        },
        tooltip: {
          callbacks: {
            title: (items) => `Cycle ${items[0].label}`,
            label: (ctx) => `${ctx.dataset.label}: ${typeof ctx.raw === "number" ? ctx.raw.toFixed(2) : ctx.raw}%`,
          },
        },
      },
    },
  });

  // Cell selector listener
  const cellSelect = document.getElementById("loboModelTestCell");
  cellSelect?.addEventListener("change", (e) => {
    currentLoboBattery = e.target.value;
    loadLoboTestPredictions(currentLoboBattery);
  });

  loadLoboTestPredictions(currentLoboBattery);
}

async function loadLoboTestPredictions(batteryId) {
  try {
    const res = await fetch(`/api/lobo/predictions/${batteryId}`);
    if (!res.ok) return;
    const data = await res.json();

    if (!loboComparisonChartInstance) return;

    const cycles = data.cycles || [];
    const yTrue = data.y_true || [];
    const models = data.models || {};

    const gprData = models.GPR?.y_pred || [];
    const gprStd = models.GPR?.uncertainty || [];
    const gprUpper = gprData.map((v, i) => (gprStd[i] !== undefined ? v + 1.96 * gprStd[i] : v));
    const gprLower = gprData.map((v, i) => (gprStd[i] !== undefined ? v - 1.96 * gprStd[i] : v));

    loboComparisonChartInstance.data.labels = cycles;
    loboComparisonChartInstance.data.datasets[0].data = yTrue;
    loboComparisonChartInstance.data.datasets[1].data = gprData;
    loboComparisonChartInstance.data.datasets[2].data = gprUpper;
    loboComparisonChartInstance.data.datasets[3].data = gprLower;
    loboComparisonChartInstance.data.datasets[4].data = models.XGBoost?.y_pred || [];
    loboComparisonChartInstance.data.datasets[5].data = models.SVR?.y_pred || [];
    loboComparisonChartInstance.data.datasets[6].data = models.ElasticNet?.y_pred || [];
    loboComparisonChartInstance.data.datasets[7].data = models.Ridge?.y_pred || [];
    loboComparisonChartInstance.update();

    // Render per-model held-out metrics
    const statsContainer = document.getElementById("loboComparisonStats");
    if (statsContainer) {
      const modelColors = {
        GPR: "#38bdf8",
        XGBoost: "#34d399",
        SVR: "#a78bfa",
        ElasticNet: "#fbbf24",
        Ridge: "#94a3b8",
      };

      statsContainer.innerHTML = Object.entries(models)
        .map(([name, mData]) => {
          const c = modelColors[name] || "#94a3b8";
          const m = mData.metrics || {};
          return `
            <div style="background: #080a0f; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 5px; padding: 0.5rem 0.65rem;">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.2rem;">
                <span style="font-weight: 600; color: ${c}; font-size: 0.74rem;">${name}</span>
                <span style="font-size: 0.68rem; color: var(--text-tertiary); font-family: var(--font-mono);">Held-Out Fold</span>
              </div>
              <div style="font-size: 0.98rem; font-weight: 600; font-family: var(--font-mono); color: var(--text-primary); margin-bottom: 0.15rem;">
                ${m.rmse !== undefined ? m.rmse.toFixed(3) : "—"}% <span style="font-size: 0.68rem; font-weight: 400; color: var(--text-tertiary);">RMSE</span>
              </div>
              <div style="font-size: 0.68rem; color: var(--text-secondary); font-family: var(--font-mono);">
                MAE: ${m.mae !== undefined ? m.mae.toFixed(3) : "—"}% · R²: ${m.r2 !== undefined ? m.r2.toFixed(3) : "—"}
              </div>
            </div>
          `;
        })
        .join("");
    }
  } catch (err) {
    console.error("Failed to load LOBO predictions:", err);
  }
}



