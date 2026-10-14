// Physics-Informed Battery SoH Prognostics - Client Controller

let presets = {};
let featureStats = {};
let jacobianChart = null;
let chargeChart = null;
let icChart = null;
let debounceTimer = null;
let currentLoadedCycleFeatures = null;

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

document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupSliders();
  setupCycleScrubber();
  initCharts();
  await fetchDatasetSummary();
  // Initial inference
  triggerPredict();
  // Initial cycle waveforms
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

  // GPR Uncertainty display
  if (unc.ci_lower !== undefined && unc.ci_upper !== undefined) {
    const halfWidth = (unc.ci_upper - unc.ci_lower) / 2.0;
    document.getElementById("unc-GPR").textContent = `95% Epistemic CI: [${unc.ci_lower.toFixed(2)}%, ${unc.ci_upper.toFixed(2)}%] (±${halfWidth.toFixed(2)}%)`;
  }

  // Update Health Banner based on GPR prediction
  const primarySoH = preds["GPR"] !== undefined ? preds["GPR"] : preds["Ridge"];
  updateHealthBanner(primarySoH);

  // Update Jacobian chart
  updateJacobianChart(jac);
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

// Chart Initializations
function initCharts() {
  // 1. Jacobian Horizontal Bar Chart
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

  // 2. CC-CV Waveform Chart
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

  // 3. dQ/dV Incremental Capacity Chart
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
