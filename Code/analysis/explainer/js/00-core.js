/* ===== core: helpers, scales, chart frame, tooltip, controls, figure registry ===== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const NS = 'http://www.w3.org/2000/svg';
const D = DATA;
const BAT = D.batteries, FEAT = D.features, CHARGE = FEAT.slice(0, 4);
const finite = (x) => typeof x === 'number' && Number.isFinite(x);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat(Infinity)) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

/* ---- data views ---- */
const cycles = D.cycles.rows.map((r) => Object.fromEntries(D.cycles.columns.map((c, i) => [c, r[i]])));
const byBat = Object.fromEntries(BAT.map((b) => [b, cycles.filter((r) => r.battery_id === b)]));
const FM = {
  t_cc: { name: 'CC charge time', unit: 's', axis: 'CC duration (s)', src: 'Charge', dp: 0 },
  t_cv: { name: 'CV charge time', unit: 's', axis: 'CV duration (s)', src: 'Charge', dp: 0 },
  dq_dv_peak: { name: 'Charge-curve peak', unit: 'Ah/V', axis: 'Peak dQ/dV (Ah/V)', src: 'Charge', dp: 2 },
  v_at_peak: { name: 'Voltage at the peak', unit: 'V', axis: 'Peak voltage (V)', src: 'Charge', dp: 3 },
  delta_T_max: { name: 'Discharge temperature rise', unit: '°C', axis: 'Temperature rise (°C)', src: 'Discharge', dp: 2 },
  delta_V_ohmic: { name: 'Initial voltage drop', unit: 'V', axis: 'Voltage drop (V)', src: 'Discharge', dp: 3 },
  Re: { name: 'Electrolyte resistance', unit: 'Ω', axis: 'Resistance (Ω)', src: 'Impedance sweep', dp: 4 },
  Rct: { name: 'Charge-transfer resistance', unit: 'Ω', axis: 'Resistance (Ω)', src: 'Impedance sweep', dp: 4 },
  rest_time_hours: { name: 'Interval between discharges', unit: 'h', axis: 'Interval (h)', src: 'Schedule', dp: 2 },
  capacity: { name: 'Measured capacity', unit: 'Ah', axis: 'Capacity (Ah)', src: 'Discharge', dp: 3 },
  soh: { name: 'State of health', unit: '%', axis: 'SoH (%)', src: 'Discharge', dp: 1 },
};
const bColor = (b) => `var(--s${BAT.indexOf(b) + 1})`;
const bLabel = (b) => (b === 'ALL' ? 'All batteries' : b);
const stat = (battery, feature) => D.stats.find((r) => r.battery_id === battery && r.feature === feature);

/* ---- formatting ---- */
const fmt = (x, d = 2) => (finite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : 'n/a');
const fmtInt = (x) => (finite(x) ? Math.round(x).toLocaleString('en-US') : 'n/a');
const signed = (x, d = 3) => (finite(x) ? (x >= 0 ? '+' : '-') + Math.abs(x).toFixed(d) : 'n/a');
const fmtF = (feature, x) => (finite(x) ? fmt(x, FM[feature].dp) : 'n/a');
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---- scales and ticks ---- */
const lin = (d0, d1, r0, r1) => {
  const f = (x) => r0 + ((x - d0) / (d1 - d0)) * (r1 - r0);
  f.inv = (y) => d0 + ((y - r0) / (r1 - r0)) * (d1 - d0);
  return f;
};
function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(12));
  return out;
}
function tickFmt(ticks) {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  const d = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step) - 1e-9)));
  return (v) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function extent(values, pad = 0.05) {
  const a = values.filter(finite);
  if (!a.length) return [0, 1];
  const lo = Math.min(...a), hi = Math.max(...a), p = (hi - lo || Math.abs(hi) || 1) * pad;
  return [lo - p, hi + p];
}

/* ---- chart frame: hairline solid grid, one axis pair, no dual axes ---- */
let uid = 0;
function frame(host, o) {
  const w = o.w, ht = o.h;
  const m = Object.assign({ l: 50, r: 14, t: 10, b: 38 }, o.m || {});
  const ih = ht - m.t - m.b;
  const yt = o.yTicks || niceTicks(o.y[0], o.y[1], Math.max(3, Math.floor(ih / 42)));
  const yf = o.yFmt || tickFmt(yt);
  m.l = Math.max(m.l, 26 + 6.6 * Math.max(...yt.map((v) => yf(v).length)));
  const iw = w - m.l - m.r;
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${w} ${ht}`, role: 'img', 'aria-label': o.aria || o.yLabel || 'Chart' });
  if (o.title) svg.append(s('title', null, o.title));
  const sx = o.xScale || lin(o.x[0], o.x[1], m.l, m.l + iw);
  const sy = lin(o.y[0], o.y[1], m.t + ih, m.t);
  const xt = o.xTicks || niceTicks(o.x[0], o.x[1], Math.max(3, Math.floor(iw / 95)));
  const xf = o.xFmt || tickFmt(xt);
  for (const v of yt) {
    svg.append(s('line', { class: 'grid', x1: m.l, x2: m.l + iw, y1: sy(v), y2: sy(v) }));
    svg.append(s('text', { x: m.l - 7, y: sy(v) + 4, 'text-anchor': 'end' }, yf(v)));
  }
  for (const v of xt) {
    svg.append(s('line', { class: 'axis', x1: sx(v), x2: sx(v), y1: m.t + ih, y2: m.t + ih + 4 }));
    svg.append(s('text', { x: sx(v), y: m.t + ih + 17, 'text-anchor': 'middle' }, xf(v)));
  }
  svg.append(s('line', { class: 'axis', x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih }));
  svg.append(s('line', { class: 'axis', x1: m.l, x2: m.l, y1: m.t, y2: m.t + ih }));
  if (o.xLabel) svg.append(s('text', { x: m.l + iw / 2, y: ht - 5, 'text-anchor': 'middle' }, o.xLabel));
  if (o.yLabel) {
    const cy = m.t + ih / 2;
    svg.append(s('text', { x: 12, y: cy, 'text-anchor': 'middle', transform: `rotate(-90 12 ${cy})` }, o.yLabel));
  }
  const clipId = `clip${++uid}`;
  const defs = s('defs', null, s('clipPath', { id: clipId }, s('rect', { x: m.l, y: m.t, width: iw, height: ih })));
  const layer = s('g', { 'clip-path': `url(#${clipId})` });
  svg.append(defs, layer);
  host.append(svg);
  return { svg, layer, sx, sy, m, iw, ih, w, h: ht };
}
function pathD(points, sx, sy) {
  let d = '', pen = false;
  for (const p of points) {
    if (!finite(p[0]) || !finite(p[1])) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`;
    pen = true;
  }
  return d;
}
const lineMark = (d, color, width = 2) => s('path', { class: 'mark', d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });

/* ---- tooltip: enhances, never gates (every value is also in a table twin) ---- */
const tipEl = document.getElementById('tip');
function tipShow(content, x, y) {
  tipEl.replaceChildren(content);
  tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  tipEl.style.left = `${Math.max(8, left)}px`;
  tipEl.style.top = `${Math.max(8, top)}px`;
}
const tipHide = () => { tipEl.hidden = true; };
function tipRows(title, rows) {
  const box = h('div');
  if (title) box.append(h('b', { text: title }));
  for (const [k, v, c] of rows) {
    box.append(h('div', { class: 'r' }, h('span', null, c ? h('i', { style: `background:${c}` }) : null, k), h('span', { text: v })));
  }
  return box;
}
function hover(el, build) {
  el.addEventListener('pointermove', (e) => tipShow(build(e), e.clientX, e.clientY));
  el.addEventListener('pointerleave', tipHide);
  el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); tipShow(build({}), r.left + r.width / 2, r.top); });
  el.addEventListener('blur', tipHide);
}
/* Nearest-mark hover: a hit target far larger than the dot, as the dense-scatter rule asks. */
function nearestHover(svgEl, pts, radius, build, ring) {
  let last = null;
  const clear = () => { last = null; ring.setAttribute('visibility', 'hidden'); tipHide(); };
  svgEl.addEventListener('pointermove', (e) => {
    const box = svgEl.getBoundingClientRect(), k = svgEl.viewBox.baseVal.width / box.width;
    const x = (e.clientX - box.left) * k, y = (e.clientY - box.top) * k;
    let best = null, bd = radius * radius;
    for (const p of pts) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
    if (!best) return clear();
    if (best !== last) { last = best; ring.setAttribute('cx', best.x); ring.setAttribute('cy', best.y); ring.setAttribute('visibility', 'visible'); }
    tipShow(build(best), e.clientX, e.clientY);
  });
  svgEl.addEventListener('pointerleave', clear);
}

/* ---- controls ---- */
function ctlSelect(label, options, value, onChange) {
  const sel = h('select', { onchange: (e) => onChange(e.target.value) });
  for (const [v, t] of options) sel.append(h('option', { value: v, text: t, selected: String(v) === String(value) }));
  return h('label', { class: 'ctl' }, label, sel);
}
function ctlSeg(options, value, onChange, aria) {
  const box = h('div', { class: 'seg', role: 'group', 'aria-label': aria });
  for (const [v, t] of options) {
    box.append(h('button', { type: 'button', 'aria-pressed': String(String(v) === String(value)), 'data-v': v, text: t,
      onclick: () => { $$('button', box).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v)))); onChange(v); } }));
  }
  return box;
}
function ctlCheck(label, checked, onChange) {
  return h('label', { class: 'ctl check' }, h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), label);
}

/* ---- tables ---- */
function tableEl(head, rows, o = {}) {
  const num = new Set(o.num || []);
  const t = h('table', { class: 'data' + (o.cls ? ` ${o.cls}` : '') });
  if (o.caption) t.append(h('caption', { class: 'sr', text: o.caption }));
  t.append(h('thead', null, h('tr', null, head.map((c, i) => h('th', { scope: 'col', class: num.has(i) ? 'n' : '' }, c)))));
  t.append(h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { class: num.has(i) ? 'n' : '' }, c))))));
  return h('div', { class: 'table-scroll' }, t);
}
const tick3 = (label, color) => h('span', null, h('i', { style: `background:${color}` }), label);

/* ---- global state: one battery selection for the whole page ---- */
const S = { battery: 'ALL', example: null };
const figs = new Map();
const effective = (supportsAll) => (S.battery === 'ALL' && !supportsAll ? BAT[0] : S.battery);
function setBattery(b) {
  S.battery = b;
  if (typeof refillExampleSelects === 'function') refillExampleSelects();
  $$('[data-battery-select]').forEach((sel) => { sel.value = b; });
  $$('.seg[data-battery]').forEach((box) => {
    const eff = box.dataset.battery === 'all' ? b : effective(false);
    $$('button', box).forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.v === eff)));
  });
  figs.forEach((f) => f.redraw());
}
function batteryChips(supportsAll) {
  const opts = (supportsAll ? [['ALL', 'All']] : []).concat(BAT.map((b) => [b, b]));
  const box = ctlSeg(opts, effective(supportsAll), setBattery, 'Battery');
  box.dataset.battery = supportsAll ? 'all' : 'one';
  return box;
}

/* ---- figure registry ---- */
function figure(id, def) {
  const root = document.getElementById(`fig-${id}`);
  if (!root) return;
  const api = {
    id, root, state: Object.assign({}, def.state),
    controls: $('.fig-controls', root), body: $('.fig-body', root), note: $('.fig-note', root), twin: $('details.twin', root),
    width: () => Math.max(300, Math.floor($('.fig-body', root).getBoundingClientRect().width || root.getBoundingClientRect().width - 44 || 640)),
  };
  if (def.controls) def.controls(api);
  let pending = 0;
  const fillTwin = () => {
    if (!api.twin || !def.table) return;
    const t = def.table(api);
    const body = $('.twin-body', api.twin);
    body.replaceChildren(t);
  };
  const draw = () => {
    pending = 0;
    api.body.replaceChildren();
    def.render(api);
    if (def.caption) api.note.innerHTML = def.caption(api);
    if (api.twin && api.twin.open) fillTwin();
  };
  api.redraw = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(draw); };
  api.drawNow = draw;
  if (api.twin) api.twin.addEventListener('toggle', () => api.twin.open && fillTwin());
  let lastW = 0;
  new ResizeObserver(() => {
    const w = Math.round(api.body.getBoundingClientRect().width);
    if (Math.abs(w - lastW) > 6) { lastW = w; api.redraw(); }
  }).observe(api.body);
  figs.set(id, api);
  api.redraw();
  return api;
}
