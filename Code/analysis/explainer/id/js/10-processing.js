/* ===== part 1: data processing figures ===== */
const EX = D.examples;
const exKey = (e) => `${e.battery}|${e.cycle}`;
const examplesFor = (b) => EX.filter((e) => e.battery === b).sort((a, c) => a.cycle - c.cycle);
function exampleLabel(e) {
  const list = examplesFor(e.battery), tags = [];
  if (e.cycle === list[0].cycle) tags.push('awal');
  if (e.cycle === list[list.length - 1].cycle) tags.push('akhir');
  if (e.flagged) tags.push('ditandai');
  if (e.timeline.rest_hours >= 80) tags.push(`jeda ${fmtInt(e.timeline.rest_hours)} jam`);
  return `Siklus ${e.cycle}${tags.length ? ' · ' + tags.join(', ') : ''} (SoH ${fmtDecimal(e.soh, 1)}%)`;
}
function currentExample() {
  const b = effective(false);
  let e = EX.find((x) => exKey(x) === S.example && x.battery === b);
  if (!e) { e = examplesFor(b)[0]; S.example = exKey(e); }
  return e;
}
function setExample(key) {
  S.example = key;
  $$('select[data-example]').forEach((sel) => { if ([...sel.options].some((o) => o.value === key)) sel.value = key; });
  ['timeline', 'explorer'].forEach((id) => figs.get(id) && figs.get(id).redraw());
}
function exampleSelect() {
  const sel = h('select', { 'data-example': '', onchange: (ev) => setExample(ev.target.value) });
  const fill = () => {
    const b = effective(false), cur = currentExample();
    sel.replaceChildren(...examplesFor(b).map((e) => h('option', { value: exKey(e), text: exampleLabel(e), selected: exKey(e) === exKey(cur) })));
  };
  fill();
  sel.refill = fill;
  return h('label', { class: 'ctl' }, 'Siklus yang diperiksa', sel);
}
const ctlBox = (label, node) => h('div', { class: 'ctl' }, label, node);
function refillExampleSelects() { $$('select[data-example]').forEach((sel) => sel.refill && sel.refill()); }

/* ---- 1. operation tape ---- */
const OP_NAMES = ['Pengisian', 'Pengosongan', 'Uji impedansi'];
figure('tape', {
  controls: (api) => api.controls.append(ctlBox('Baterai', batteryChips(true))),
  render(api) {
    const W = api.width(), lane = 9, gap = 3, rowH = lane * 3 + gap * 2 + 24, left = 66, right = 12, top = 6;
    const spanH = Math.max(...BAT.map((b) => { const o = D.tape[b].ops; return o[o.length - 1][1] + o[o.length - 1][2]; }));
    const sx = lin(0, spanH / 24, left, W - right), pxDay = sx(1) - sx(0);
    const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${top + rowH * 4 + 38}`, role: 'img',
      'aria-label': 'Semua operasi pengisian, pengosongan, dan uji impedansi tiap baterai, menurut waktu' });
    const ticks = niceTicks(0, spanH / 24, Math.max(4, Math.floor((W - left) / 90)));
    for (const v of ticks) {
      svg.append(s('line', { class: 'grid', x1: sx(v), x2: sx(v), y1: top, y2: top + rowH * 4 }));
      svg.append(s('text', { x: sx(v), y: top + rowH * 4 + 16, 'text-anchor': 'middle' }, String(v)));
    }
    svg.append(s('text', { x: left + (W - left - right) / 2, y: top + rowH * 4 + 36, 'text-anchor': 'middle' }, 'hari sejak operasi pertama sel'));
    BAT.forEach((b, i) => {
      const y0 = top + i * rowH, dim = S.battery !== 'ALL' && S.battery !== b;
      const g = s('g', { opacity: dim ? 0.28 : 1 });
      g.append(s('circle', { cx: 8, cy: y0 + lane * 1.5 + gap, r: 5, fill: bColor(b) }));
      g.append(s('text', { x: 20, y: y0 + lane * 1.5 + gap + 4, class: 't-strong' }, b));
      for (const [type, start, dur] of D.tape[b].ops) {
        const laneY = y0 + type * (lane + gap), w = Math.max(1.3, (dur / 24) * pxDay);
        g.append(s('rect', { x: sx(start / 24), y: laneY, width: w, height: type === 2 ? lane - 3 : lane, rx: 0.8, fill: bColor(b), 'shape-rendering': 'crispEdges' }));
      }
      svg.append(g);
      const hit = s('rect', { class: 'hit', x: left, y: y0, width: W - left - right, height: lane * 3 + gap * 2 });
      hover(hit, (e) => {
        const box = hit.getBoundingClientRect(), k = W / box.width;
        const x = ((e.clientX ?? box.left) - box.left) * k, ly = Math.min(2, Math.max(0, Math.floor((((e.clientY ?? box.top) - box.top) * k) / (lane + gap))));
        let best = null, bd = Infinity;
        for (const op of D.tape[b].ops) if (op[0] === ly) { const d = Math.abs(sx(op[1] / 24) - x); if (d < bd) { bd = d; best = op; } }
        if (!best) return h('div', { text: 'Tidak ada operasi di sini' });
        const mins = best[2] * 60;
        return tipRows(`${b} · ${OP_NAMES[best[0]].toLowerCase()}`, [['Hari', fmtDecimal(best[1] / 24, 2)], ['Durasi', mins < 90 ? `${fmtDecimal(mins, 0)} menit` : `${fmtDecimal(best[2], 1)} jam`]]);
      });
      svg.append(hit);
    });
    api.body.append(svg);
    api.body.append(h('div', { class: 'legend' }, h('span', null, 'Baris atas: pengisian'), h('span', null, 'Baris tengah: pengosongan'), h('span', null, 'Baris bawah: uji impedansi'),
      ...BAT.map((b) => tick3(b, bColor(b)))));
  },
  caption: () => `Satu tanda per operasi; celah menunjukkan istirahat. B0005–B0007 berbagi jadwal (${D.tape.B0005.first}–${D.tape.B0005.last}); B0018 direkam kemudian (${D.tape.B0018.first}–${D.tape.B0018.last}) dengan lebih sedikit uji impedansi.`,
  table: () => tableEl(['Baterai', 'Pengisian', 'Pengosongan', 'Uji impedansi', 'Operasi pertama', 'Operasi terakhir'],
    BAT.map((b) => [b, D.tape[b].counts.charge, D.tape[b].counts.discharge, D.tape[b].counts.impedance, D.tape[b].first, D.tape[b].last]), { num: [1, 2, 3] }),
});

/* ---- 2. timeline: which operations belong to one cycle ---- */
function drawTimeline(host, e, W) {
  const tl = e.timeline, ops = tl.ops, lane = 22, gap = 14, left = 14, right = 16, top = 34, laneNames = ['Pengisian', 'Pengosongan', 'Impedansi'];
  const lo = Math.min(...ops.map((o) => o[1]), tl.prev_discharge_end) - 0.15, hi = Math.max(...ops.map((o) => o[2])) + 0.15;
  const xs = lin(lo, hi, left + 74, W - right);
  const H = top + 3 * (lane + gap) + 70;
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Operasi di sekitar siklus ${e.cycle} pada ${e.battery}` });
  const ticks = niceTicks(lo, hi, Math.max(3, Math.floor(W / 110)));
  for (const v of ticks) {
    svg.append(s('line', { class: 'grid', x1: xs(v), x2: xs(v), y1: top - 6, y2: top + 3 * (lane + gap) }));
    svg.append(s('text', { x: xs(v), y: top + 3 * (lane + gap) + 14, 'text-anchor': 'middle' }, fmtTickH(v)));
  }
  svg.append(s('text', { x: left + 74 + (W - right - left - 74) / 2, y: H - 6, 'text-anchor': 'middle' }, W < 500 ? 'jam dari awal pengosongan (0)' : 'jam dari awal pengosongan siklus ini (0 = mulai pengosongan)'));
  laneNames.forEach((n, i) => svg.append(s('text', { x: left, y: top + i * (lane + gap) + lane / 2 + 4 }, n)));
  for (const [type, a, b, id] of ops) {
    const mine = id === tl.discharge_op || id === tl.charge_op;
    const w = Math.max(3, xs(b) - xs(a));
    const rect = s('rect', { x: xs(a), y: top + type * (lane + gap), width: w, height: lane, rx: 4, fill: mine ? bColor(e.battery) : 'var(--muted)', opacity: mine ? 1 : 0.4 });
    rect.setAttribute('tabindex', '0');
    hover(rect, () => tipRows(`${OP_NAMES[type]} #${id}${mine ? ' (siklus ini)' : ''}`, [['Mulai', `${fmt(a, 2)} jam`], ['Selesai', `${fmt(b, 2)} jam`]]));
    svg.append(rect);
  }
  const mark = (x, text, color, anchor) => {
    svg.append(s('line', { x1: xs(x), x2: xs(x), y1: top - 12, y2: top + 3 * (lane + gap), stroke: color, 'stroke-width': 1.2, opacity: 0.85 }));
    svg.append(s('text', { x: xs(x) + (anchor === 'end' ? -5 : 5), y: top - 16, 'text-anchor': anchor, class: 't-strong' }, text));
  };
  const chargeEnd = ops.find((o) => o[3] === tl.charge_op)[2];
  mark(chargeEnd, 'pengisian selesai', 'var(--muted)', 'end');
  mark(0, 'pengosongan mulai', bColor(e.battery), 'start');
  // rest interval bracket
  const by = top + 3 * (lane + gap) + 30;
  svg.append(s('path', { d: `M${xs(tl.prev_discharge_end)} ${by - 5}V${by}H${xs(0)}V${by - 5}`, fill: 'none', stroke: 'var(--fg)', 'stroke-width': 1.4 }));
  svg.append(s('text', { x: (xs(tl.prev_discharge_end) + xs(0)) / 2, y: by + 16, 'text-anchor': 'middle', class: 't-strong' }, `jeda antar pengosongan: ${fmt(tl.rest_hours, 2)} jam`));
  // nearest impedance sweep
  const off = tl.eis_offset_hours, inside = off >= lo && off <= hi;
  const sweepY = top + 2 * (lane + gap) + lane / 2;
  if (inside) {
    svg.append(s('path', { d: `M${xs(off)} ${sweepY - 9}l8 9l-8 9l-8 -9z`, fill: 'var(--s2)', stroke: 'var(--card)', 'stroke-width': 2 }));
    svg.append(s('text', { x: xs(off) + (off > hi - (hi - lo) * 0.25 ? -14 : 14), y: sweepY + 4, 'text-anchor': off > hi - (hi - lo) * 0.25 ? 'end' : 'start', class: 't-strong' },
      `uji terdekat: ${off >= 0 ? '+' : ''}${fmt(off, 1)} jam`));
  } else {
    const isRight = off > hi;
    svg.append(s('text', { x: isRight ? W - 20 : xs(lo) + 6, y: sweepY + 4, 'text-anchor': isRight ? 'end' : 'start', class: 't-strong' },
      `uji terdekat: ${off >= 0 ? '+' : ''}${fmt(off, 1)} h ${isRight ? '→ (di luar skala)' : '← (di luar skala)'}`));
  }
  host.append(svg);
}
const fmtTickH = (v) => (Math.abs(v) >= 100 ? fmt(v, 0) : Math.abs(v) >= 10 ? fmt(v, 0) : fmt(v, 1));

figure('timeline', {
  controls(api) { api.controls.append(ctlBox('Baterai', batteryChips(false)), exampleSelect()); },
  render(api) { drawTimeline(api.body, currentExample(), api.width()); },
  caption() {
    const e = currentExample(), tl = e.timeline;
    const side = tl.eis_after_discharge_start ? 'setelah pengosongan ini dimulai' : tl.eis_after_charge_end ? 'setelah pengisian selesai tetapi sebelum pengosongan dimulai' : 'sebelum pengisian selesai';
    return `<b>${e.battery}, siklus ${e.cycle}.</b>${oneCellNote()} Kapasitas ${fmt(e.capacity, 3)} Ah ÷ 2 × 100 menghasilkan SoH <b>${fmt(e.soh, 1)}%</b>. Uji terdekat dimulai ${side}: Re ${fmt(e.re, 4)} Ω, Rct ${fmt(e.rct, 4)} Ω.`;
  },
  table() {
    const e = currentExample(), tl = e.timeline;
    return tableEl(['Operasi', 'Mulai (jam)', 'Selesai (jam)', 'Peran'], tl.ops.map((o) => [`${OP_NAMES[o[0]]} #${o[3]}`, fmt(o[1], 3), fmt(o[2], 3),
      o[3] === tl.discharge_op ? 'pengosongan siklus ini' : o[3] === tl.charge_op ? 'pengisian siklus ini' : 'operasi lain']), { num: [1, 2] });
  },
});

/* ---- 3. how far away is the nearest impedance sweep? ---- */
const EIS_BINS = [
  ['1–15 jam sebelum', -Infinity, -1], ['< 1 jam sebelum', -1, 0], ['< 1 jam sesudah', 0, 1], ['1–5 jam sesudah', 1, 5],
  ['5–24 jam sesudah', 5, 24], ['1–4 hari sesudah', 24, 100], ['> 4 hari sesudah', 100, Infinity],
];
function eisCounts(battery) {
  const rows = (battery === 'ALL' ? BAT.flatMap((b) => D.eis[b]) : D.eis[battery]);
  return { rows, counts: EIS_BINS.map(([, lo, hi]) => rows.filter((r) => r[0] >= lo && r[0] < hi).length) };
}
figure('eis', {
  controls: (api) => api.controls.append(ctlBox('Baterai', batteryChips(true))),
  render(api) {
    const { rows, counts } = eisCounts(S.battery), W = api.width(), left = Math.min(150, W * 0.3), right = 54, bar = 22, step = 34, top = 6;
    const max = Math.max(...counts), sx = lin(0, max * 1.08, left, W - right);
    const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${top + EIS_BINS.length * step + 24}`, role: 'img', 'aria-label': 'Jumlah siklus menurut waktu mulai uji impedansi terdekat' });
    niceTicks(0, max, Math.max(3, Math.floor((W - left) / 100))).forEach((v) => {
      svg.append(s('line', { class: 'grid', x1: sx(v), x2: sx(v), y1: top, y2: top + EIS_BINS.length * step }));
      svg.append(s('text', { x: sx(v), y: top + EIS_BINS.length * step + 16, 'text-anchor': 'middle' }, fmtInt(v)));
    });
    EIS_BINS.forEach(([label, lo], i) => {
      const y = top + i * step + (step - bar) / 2, after = lo >= 0, c = counts[i], color = after ? 'var(--s2)' : 'var(--s1)';
      svg.append(s('text', { x: left - 10, y: y + bar / 2 + 4, 'text-anchor': 'end' }, label));
      const r = s('rect', { x: left, y, width: Math.max(0, sx(c) - left), height: bar, rx: 4, fill: color, tabindex: '0' });
      hover(r, () => tipRows(label, [['Siklus', fmtInt(c)], ['Proporsi', `${fmtDecimal(100 * c / rows.length, 1)}%`]]));
      svg.append(r);
      svg.append(s('text', { x: sx(c) + 8, y: y + bar / 2 + 4, class: 't-strong' }, fmtInt(c)));
    });
    api.body.append(svg);
    api.body.append(h('div', { class: 'legend' }, tick3('uji dimulai sebelum pengosongan', 'var(--s1)'), tick3('uji dimulai setelah pengosongan berjalan', 'var(--s2)')));
  },
  caption() {
    const { rows } = eisCounts(S.battery), n = rows.length, late = rows.filter((r) => r[2]).length, afterCharge = rows.filter((r) => r[1]).length;
    return `<b>${bLabel(S.battery)}:</b> uji terdekat setelah pengisian: ${fmtInt(afterCharge)}/${fmtInt(n)} siklus (${fmtDecimal(100 * afterCharge / n, 1)}%); setelah pengosongan dimulai: ${fmtInt(late)} (${fmtDecimal(100 * late / n, 1)}%). Rentang tak seragam mencakup menit hingga hari.`;
  },
  table() {
    const { rows, counts } = eisCounts(S.battery);
    return tableEl(['Waktu mulai uji terdekat', 'Siklus', 'Proporsi'], EIS_BINS.map(([label], i) => [label, fmtInt(counts[i]), `${fmtDecimal(100 * counts[i] / rows.length, 1)}%`]), { num: [1, 2] });
  },
});

/* ---- 4. cycle explorer: waveforms to numbers ---- */
function nearestIndex(arr, x) {
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid; else hi = mid; }
  return Math.abs(arr[lo] - x) <= Math.abs(arr[hi] - x) ? lo : hi;
}
function crosshair(f, xs, ys, build) {
  const line = s('line', { y1: f.m.t, y2: f.m.t + f.ih, stroke: 'var(--fg)', 'stroke-width': 1, opacity: 0.55, visibility: 'hidden' });
  const dot = s('circle', { r: 4.5, fill: 'var(--card)', stroke: 'var(--fg)', 'stroke-width': 2, visibility: 'hidden' });
  const hit = s('rect', { class: 'hit', x: f.m.l, y: f.m.t, width: f.iw, height: f.ih });
  f.svg.append(line, dot, hit);
  hit.addEventListener('pointermove', (ev) => {
    const box = f.svg.getBoundingClientRect(), k = f.w / box.width, x = f.sx.inv((ev.clientX - box.left) * k);
    const i = nearestIndex(xs, x);
    line.setAttribute('x1', f.sx(xs[i])); line.setAttribute('x2', f.sx(xs[i]));
    dot.setAttribute('cx', f.sx(xs[i])); dot.setAttribute('cy', f.sy(ys[i]));
    line.setAttribute('visibility', 'visible'); dot.setAttribute('visibility', 'visible');
    tipShow(build(i), ev.clientX, ev.clientY);
  });
  hit.addEventListener('pointerleave', () => { line.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tipHide(); });
}
const VCLIP = [3.0, 4.5];
function drawCharge(host, e, W, opts = {}) {
  const c = e.charge, color = bColor(e.battery), dur = c.duration;
  const f = frame(host, { w: W, h: opts.compact ? 190 : 200, x: [0, dur], y: VCLIP, yLabel: 'Tegangan (V)', xLabel: opts.compact ? 'detik sejak awal pengisian' : null,
    m: { l: 52, r: 14, t: 14, b: opts.compact ? 40 : 24 }, aria: `Tegangan pengisian siklus ${e.cycle} pada ${e.battery}`,
    xFmt: (v) => fmtInt(v) });
  const shade = (a, b, opacity, label, align) => {
    const x0 = f.sx(a), w = Math.max(2, f.sx(b) - f.sx(a));
    f.layer.append(s('rect', { x: x0, y: f.m.t, width: w, height: f.ih, fill: 'var(--primary)', opacity }));
    const text = s('text', { x: align === 'end' ? x0 - 5 : x0 + (w < 70 ? w + 5 : w / 2), y: f.m.t + 14, 'text-anchor': align === 'end' ? 'end' : w < 70 ? 'start' : 'middle', class: 't-strong' }, label);
    f.svg.append(text);
  };
  if (e.cc && e.cc.duration > 0) shade(e.cc.start, e.cc.end, 0.14, `CC ${fmtInt(e.cc.duration)} s`);
  if (e.cv && e.cv.duration > 0) shade(e.cv.start, e.cv.end, 0.26, `CV ${fmtInt(e.cv.duration)} s`);
  f.layer.append(lineMark(pathD(c.t.map((t, i) => [t, c.v[i]]), f.sx, f.sy), color, 1.8));
  if (c.first_v > VCLIP[1]) {
    f.svg.append(s('path', { d: `M${f.sx(0)} ${f.m.t + 1}l-6 10h12z`, fill: 'var(--bad)' }));
    f.svg.append(s('text', { x: f.sx(0) + 12, y: f.m.t + 11, class: 't-strong', style: 'fill:var(--bad)' }, `sampel awal: ${fmt(c.first_v, 2)} V (di luar skala)`));
  }
  crosshair(f, c.t, c.v, (i) => tipRows(`${fmtInt(c.t[i])} s`, [['Tegangan', `${fmt(c.v[i], 3)} V`, color], ['Arus', `${fmt(c.i[i], 3)} A`]]));
  if (opts.compact) return f;
  const g = frame(host, { w: W, h: 120, x: [0, dur], y: [-0.3, 1.8], yTicks: [0, 0.5, 1, 1.5], yLabel: 'Arus (A)', xLabel: 'detik sejak awal pengisian', m: { l: 52, r: 14, t: 8, b: 40 },
    aria: `Arus pengisian siklus ${e.cycle} pada ${e.battery}`, xFmt: (v) => fmtInt(v) });
  g.layer.append(s('line', { x1: g.m.l, x2: g.m.l + g.iw, y1: g.sy(0.02), y2: g.sy(0.02), stroke: 'var(--s2)', 'stroke-width': 1.2 }));
  g.svg.append(s('text', { x: g.m.l + g.iw - 4, y: g.sy(0.02) - 5, 'text-anchor': 'end', class: 't-strong' }, 'batas 20 mA'));
  g.layer.append(lineMark(pathD(c.t.map((t, i) => [t, c.i[i]]), g.sx, g.sy), color, 1.8));
  crosshair(g, c.t, c.i, (i) => tipRows(`${fmtInt(c.t[i])} s`, [['Arus', `${fmt(c.i[i], 3)} A`, color], ['Tegangan', `${fmt(c.v[i], 3)} V`]]));
  return f;
}
function drawPeak(host, e, W) {
  if (!e.ic) {
    host.append(h('div', { class: 'empty' }, `Tidak ada sampel yang dapat digunakan. Catatan pengisian ini memiliki ${e.ic_samples} sampel pada kenaikan 3,8 hingga 4,18 V dengan arus minimal 0,5 A (siklus normal memiliki ratusan). Karena itu, aturan menggunakan nilai bawaan 0 Ah/V dan 4,0 V.`));
    return;
  }
  const ic = e.ic, color = bColor(e.battery), wide = W > 700, pw = wide ? Math.floor((W - 18) / 2) : W;
  const row = h('div', { class: wide ? 'grid-2' : '' });
  const a = h('div', { class: 'mini' }), b = h('div', { class: 'mini' });
  row.append(a, b); host.append(row);
  a.append(h('h4', { text: 'Muatan terkumpul terhadap tegangan' }));
  const fa = frame(a, { w: pw, h: 210, x: [ic.v[0], ic.v[ic.v.length - 1]], y: extent([...ic.q, ...ic.q_smooth], 0.06), xLabel: 'tegangan (V)', yLabel: 'muatan masuk (Ah)', aria: 'Muatan terkumpul terhadap tegangan' });
  ic.v.forEach((v, i) => fa.layer.append(s('circle', { cx: fa.sx(v), cy: fa.sy(ic.q[i]), r: 3, fill: 'var(--muted)', opacity: 0.7 })));
  fa.layer.append(lineMark(pathD(ic.v.map((v, i) => [v, ic.q_smooth[i]]), fa.sx, fa.sy), color, 2));

  b.append(h('h4', { text: 'Muatan per volt (kemiringan kurva)' }));
  const peak = e.peak, top = Math.max(...ic.dq) * 1.18;
  const fb = frame(b, { w: pw, h: 210, x: [ic.v[0], ic.v[ic.v.length - 1]], y: [0, top], xLabel: 'tegangan (V)', yLabel: 'dQ/dV (Ah/V)', aria: 'Kapasitas inkremental terhadap tegangan' });
  fb.layer.append(s('rect', { x: fb.sx(Math.max(3.85, ic.v[0])), y: fb.m.t, width: fb.sx(Math.min(4.15, ic.v[ic.v.length - 1])) - fb.sx(Math.max(3.85, ic.v[0])), height: fb.ih, fill: 'var(--primary)', opacity: 0.1 }));
  fb.layer.append(lineMark(pathD(ic.v.map((v, i) => [v, ic.dq[i]]), fb.sx, fb.sy), color, 2));
  const pk = s('circle', { cx: fb.sx(peak.v), cy: fb.sy(peak.dq), r: 6, fill: color, stroke: 'var(--card)', 'stroke-width': 2 });
  fb.svg.append(pk);
  fb.svg.append(s('text', { x: Math.min(fb.m.l + fb.iw - 4, fb.sx(peak.v) + 10), y: fb.sy(peak.dq) - 8, class: 't-strong', 'text-anchor': fb.sx(peak.v) > fb.m.l + fb.iw * 0.7 ? 'end' : 'start' },
    `puncak ${fmt(peak.dq, 2)} Ah/V pada ${fmt(peak.v, 3)} V`));
  crosshair(fb, ic.v, ic.dq, (i) => tipRows(`${fmt(ic.v[i], 3)} V`, [['dQ/dV', `${fmt(ic.dq[i], 3)} Ah/V`, color]]));
  host.append(h('div', { class: 'legend' }, h('span', null, 'Titik: kisi tegangan 10 mV'), h('span', null, 'Garis: hasil penghalusan'), h('span', null, 'Arsiran: daerah pencarian puncak (3,85–4,15 V)')));
}
function drawDischarge(host, e, W) {
  const d = e.discharge, color = bColor(e.battery), dur = d.duration;
  host.append(h('h4', { class: 'panel-title', text: 'Tegangan selama pengosongan' }));
  const f = frame(host, { w: W, h: 150, x: [0, dur], y: extent(d.v, 0.06), yLabel: 'tegangan (V)', m: { l: 52, r: 14, t: 8, b: 14 }, aria: 'Tegangan pengosongan', xFmt: fmtInt });
  f.layer.append(lineMark(pathD(d.t.map((t, i) => [t, d.v[i]]), f.sx, f.sy), color, 1.8));
  crosshair(f, d.t, d.v, (i) => tipRows(`${fmtInt(d.t[i])} s`, [['Tegangan', `${fmt(d.v[i], 3)} V`, color], ['Suhu', `${fmt(d.temp[i], 2)} °C`]]));
  host.append(h('h4', { class: 'panel-title', text: 'Suhu selama pengosongan' }));
  const tr = [Math.floor(d.t_start - 0.8), Math.ceil(d.t_max + 0.8)];
  const g = frame(host, { w: W, h: 150, x: [0, dur], y: tr, yLabel: 'suhu (°C)', xLabel: 'detik sejak awal pengosongan', m: { l: 52, r: 14, t: 8, b: 40 }, aria: 'Suhu pengosongan', xFmt: fmtInt });
  g.layer.append(lineMark(pathD(d.t.map((t, i) => [t, d.temp[i]]), g.sx, g.sy), color, 1.8));
  const xm = g.sx(d.t_max_time);
  g.svg.append(s('path', { d: `M${xm} ${g.sy(d.t_start)}V${g.sy(d.t_max)}`, stroke: 'var(--fg)', 'stroke-width': 1.4, fill: 'none' }));
  g.svg.append(s('circle', { cx: g.sx(0), cy: g.sy(d.t_start), r: 5, fill: 'var(--card)', stroke: 'var(--fg)', 'stroke-width': 2 }));
  g.svg.append(s('circle', { cx: xm, cy: g.sy(d.t_max), r: 5, fill: color, stroke: 'var(--card)', 'stroke-width': 2 }));
  g.svg.append(s('text', { x: xm - 8, y: (g.sy(d.t_start) + g.sy(d.t_max)) / 2, 'text-anchor': 'end', class: 't-strong' }, `ΔT = ${fmt(e.features.delta_T_max, 2)} °C`));
  crosshair(g, d.t, d.temp, (i) => tipRows(`${fmtInt(d.t[i])} s`, [['Suhu', `${fmt(d.temp[i], 2)} °C`, color]]));
  const step = e.load_step;
  host.append(h('h4', { class: 'panel-title', text: 'Perbesaran: detik awal setelah beban diaktifkan' }));
  if (!step) { host.append(h('div', { class: 'empty' }, 'Tidak ada sampel dengan arus minimal 1 A, sehingga penurunan tegangan tidak diukur.')); return; }
  const z = frame(host, { w: W, h: 190, x: [step.t[0], step.t[step.t.length - 1]], y: extent(step.v, 0.2), yLabel: 'tegangan (V)', xLabel: 'detik sejak awal pengosongan', m: { l: 52, r: 14, t: 12, b: 40 }, aria: 'Tegangan sekitar saat beban diaktifkan', xFmt: (v) => fmt(v, 1) });
  z.layer.append(lineMark(pathD(step.t.map((t, i) => [t, step.v[i]]), z.sx, z.sy), 'var(--muted)', 1.4));
  step.t.forEach((t, i) => z.layer.append(s('circle', { cx: z.sx(t), cy: z.sy(step.v[i]), r: 3, fill: 'var(--muted)' })));
  const a = z.sx(step.t[step.ocv]), b = z.sx(step.t[step.loaded]);
  z.svg.append(s('circle', { cx: a, cy: z.sy(step.v[step.ocv]), r: 6, fill: color, stroke: 'var(--card)', 'stroke-width': 2 }));
  z.svg.append(s('circle', { cx: b, cy: z.sy(step.v[step.loaded]), r: 6, fill: 'var(--card)', stroke: color, 'stroke-width': 3 }));
  z.svg.append(s('path', { d: `M${b + 14} ${z.sy(step.v[step.ocv])}V${z.sy(step.v[step.loaded])}`, stroke: 'var(--fg)', 'stroke-width': 1.4, fill: 'none' }));
  z.svg.append(s('text', { x: b + 22, y: (z.sy(step.v[step.ocv]) + z.sy(step.v[step.loaded])) / 2 + 4, class: 't-strong' }, `ΔV = ${fmt(e.features.delta_V_ohmic, 3)} V pada ${fmt(step.current, 2)} A`));
  z.svg.append(s('text', { x: a, y: z.sy(step.v[step.ocv]) - 12, 'text-anchor': 'middle', class: 't-strong' }, 'sampel terakhir sebelum beban'));
  z.svg.append(s('text', { x: b - 10, y: z.sy(step.v[step.loaded]) + 22, 'text-anchor': 'end', class: 't-strong' }, 'sampel pertama ≥ 1 A'));
}
const WHAT = {
  t_cc: 'Lama pengisian arus konstan untuk naik dari 3,8 V ke 4,2 V.',
  t_cv: 'Lama tahap tegangan konstan, dari 4,185 V sampai arus turun ke 20 mA.',
  dq_dv_peak: 'Tinggi puncak utama pada kurva muatan per volt (kapasitas inkremental).',
  v_at_peak: 'Tegangan saat puncak tersebut terjadi.',
  delta_T_max: 'Kenaikan suhu selama pengosongan: suhu tertinggi dikurangi suhu awal.',
  delta_V_ohmic: 'Penurunan tegangan saat beban pengosongan diaktifkan.',
  Re: 'Hambatan elektrolit dari uji impedansi yang waktunya paling dekat.',
  Rct: 'Hambatan transfer muatan dari uji impedansi yang sama.',
  rest_time_hours: 'Jam dari akhir pengosongan sebelumnya hingga awal pengosongan ini, termasuk waktu pengisian.',
};
const TAB_FEATURES = { charge: ['t_cc', 't_cv'], peak: ['dq_dv_peak', 'v_at_peak'], discharge: ['delta_T_max', 'delta_V_ohmic'] };
function readout(e, active) {
  const rows = FEAT.map((k) => {
    const v = e.features[k], blank = e.flagged && CHARGE.includes(k);
    const value = h('span', null, `${fmtF(k, v)} ${FM[k].unit}`, blank ? h('span', { class: 'pill warn', style: 'margin-left:8px' }, 'dikosongkan dalam analisis') : null);
    return { tr: [h('span', null, h('code', null, k), ` ${FM[k].name}`), value, WHAT[k]], on: active.includes(k) };
  });
  const t = tableEl(['Fitur', 'Nilai siklus ini', 'Penjelasan aturan'], rows.map((r) => r.tr), { caption: 'Sembilan nilai untuk siklus ini', cls: 'wide' });
  $$('tbody tr', t).forEach((tr, i) => { if (rows[i].on) tr.className = 'active-row'; });
  return t;
}
const TAB_TEXT = {
  charge: (e) => `<b>t_cc</b>: lintasan pertama 3,8→4,2 V (<b>${fmt(e.features.t_cc, 0)} s</b>). <b>t_cv</b>: mulai 4,185 V hingga 20 mA atau akhir catatan (<b>${fmt(e.features.t_cv, 0)} s</b>); kedua batas ini membuat daerah berarsir bertumpang tindih.`,
  peak: (e) => `Jumlahkan muatan pada 3,8–4,18 V dan ≥0,5 A, sampel ulang tiap 10 mV, haluskan, lalu turunkan terhadap tegangan. Puncak tertinggi pada 3,85–4,15 V memberi <b>dq_dv_peak</b> (${fmt(e.features.dq_dv_peak, 2)} Ah/V) dan <b>v_at_peak</b> (${fmt(e.features.v_at_peak, 3)} V).`,
  discharge: (e) => `<b>delta_T_max</b>: suhu tertinggi dikurangi suhu awal (${fmt(e.features.delta_T_max, 2)} °C). <b>delta_V_ohmic</b>: tegangan sebelum beban dikurangi sampel pertama berarus ≥1 A (${fmt(e.features.delta_V_ohmic, 3)} V).`,
};
figure('explorer', {
  state: { tab: 'charge' },
  controls(api) {
    api.controls.append(ctlBox('Baterai', batteryChips(false)), exampleSelect(),
      ctlBox('Tahap', ctlSeg([['charge', '1 Waktu pengisian'], ['peak', '2 Puncak kurva'], ['discharge', '3 Pengosongan']], api.state.tab, (v) => { api.state.tab = v; api.redraw(); }, 'Tahap')));
  },
  render(api) {
    const e = currentExample(), tab = api.state.tab, W = api.width();
    const box = h('div', { class: 'rule-box' });
    box.innerHTML = TAB_TEXT[tab](e);
    api.body.append(box);
    if (e.flagged) api.body.append(h('div', { class: 'flagnote' }, `Satu dari ${D.tokens.n_flagged} siklus bermasalah: kenaikan tegangan normal tidak ada. Sampel awal ${fmt(e.charge.first_v, 2)} V${e.charge.first_v > 5 ? ' (lonjakan tak masuk akal)' : ''}; fitur pengisian dikosongkan.`));
    const host = h('div'); api.body.append(host);
    if (tab === 'charge') drawCharge(host, e, W); else if (tab === 'peak') drawPeak(host, e, W); else drawDischarge(host, e, W);
    api.body.append(h('div', { class: 'panel-title', text: 'Sembilan nilai untuk siklus ini' }), readout(e, TAB_FEATURES[tab]));
  },
  caption() {
    const e = currentExample();
    return `${oneCellNote()} Hasil dari data mentah cocok hingga sembilan angka desimal. Kurva menampilkan sekitar 150 titik; perhitungan memakai seluruh ${fmtInt(e.charge.n)} sampel pengisian dan ${fmtInt(e.discharge.n)} sampel pengosongan.`;
  },
  table() {
    const e = currentExample(), c = e.charge;
    return tableEl(['Detik', 'Tegangan (V)', 'Arus (A)'], c.t.map((t, i) => [fmt(t, 1), fmt(c.v[i], 3), fmt(c.i[i], 3)]), { num: [0, 1, 2], caption: 'Catatan pengisian, titik dikurangi untuk tampilan' });
  },
});

/* ---- 5. feature dictionary ---- */
function timingStatus(entry) {
  if (!entry) return null;
  if (entry.starts_or_finishes_after_cutoff_count === entry.total_cycles) return 'later';
  if (entry.available_and_observed_count > 0 && entry.starts_or_finishes_after_cutoff_count === 0 && entry.completion_unknown_count === 0) return 'known';
  return 'unconfirmed';
}
const TIMING = { known: ['ok', '✓ sudah diketahui'], later: ['warn', '✗ perlu data berikutnya'], unconfirmed: ['mute', '? belum dipastikan'] };
function timingPill(feature, scenario) {
  const entry = D.contracts.availability.find((r) => r.feature === feature && r.scenario === scenario), st = timingStatus(entry), [cls, text] = TIMING[st];
  const pill = h('span', { class: `pill ${cls}`, tabindex: '0' }, text);
  hover(pill, () => tipRows(`${feature} pada ${scenario === 'end_of_charge' ? 'akhir pengisian' : 'awal pengosongan'}`, [
    ['Terukur dan tersedia', fmtInt(entry.available_and_observed_count)], ['Perlu data berikutnya', fmtInt(entry.starts_or_finishes_after_cutoff_count)],
    ['Waktu selesai tidak diketahui', fmtInt(entry.completion_unknown_count)], ['Ditandai karena kualitas', fmtInt(entry.quality_flagged_count)]]));
  return pill;
}
figure('dict', {
  render(api) {
    const rows = FEAT.map((k) => {
      const vals = cycles.map((r) => r[k]).filter(finite), miss = cycles.length - vals.length;
      return [h('span', null, h('code', null, k), h('br'), FM[k].name), WHAT[k], FM[k].unit, FM[k].src,
        `${fmtF(k, Math.min(...vals))} hingga ${fmtF(k, Math.max(...vals))}`, miss ? `${miss} kosong` : 'tidak ada', timingPill(k, 'end_of_charge'), timingPill(k, 'discharge_start')];
    });
    api.body.append(tableEl(['Fitur', 'Yang diukur', 'Satuan', 'Sumber', 'Rentang terukur', 'Siklus kosong', 'Diketahui saat pengisian selesai?', 'Diketahui saat pengosongan mulai?'], rows, { caption: 'Sembilan fitur', cls: 'wide' }));
  },
  caption: () => 'Rentang teramati dari empat sel. Arahkan penunjuk ke label ketersediaan untuk jumlah siklus dan bukti waktunya.',
});

/* ---- 6. the five flagged cycles ---- */
const normalNeighbour = (b) => { const f = D.flagged.filter((x) => x.battery === b)[0]; return { normal: EX.find((e) => e.battery === b && e.cycle === f.cycle - 1), flagged: EX.find((e) => e.battery === b && e.cycle === f.cycle) }; };
figure('flagpair', {
  controls: (api) => api.controls.append(ctlBox('Baterai', batteryChips(false))),
  render(api) {
    const b = effective(false), { normal, flagged } = normalNeighbour(b), W = api.width(), wide = W > 680, pw = wide ? Math.floor((W - 18) / 2) : W;
    const row = h('div', { class: wide ? 'grid-2' : '' });
    for (const [e, label] of [[normal, 'Siklus normal'], [flagged, 'Siklus yang ditandai']]) {
      const cell = h('div', { class: 'mini' }, h('h4', { text: `${label}: ${e.battery} siklus ${e.cycle}` }));
      row.append(cell);
      drawCharge(cell, e, pw, { compact: true });
      cell.append(h('div', { class: 'stat', text: `${fmtInt(e.charge.n)} sampel selama ${fmtInt(e.charge.duration)} s · ${fmtInt(e.ic_samples)} sampel pada kenaikan 3,8–4,18 V dengan arus ≥ 0,5 A` }));
    }
    api.body.append(row);
  },
  caption() {
    const { normal, flagged } = normalNeighbour(effective(false));
    return `${oneCellNote()} Sampel awal: catatan bermasalah ${fmt(flagged.charge.first_v, 2)} V${flagged.charge.first_v > 5 ? ' (lonjakan tak masuk akal)' : ' (sesuai pola pengisian tambahan)'}; siklus normal di sebelahnya ${fmt(normal.charge.first_v, 2)} V. Catatan bermasalah tidak memiliki kenaikan normal yang dibutuhkan aturan pengisian.`;
  },
  table() {
    const { normal, flagged } = normalNeighbour(effective(false));
    return tableEl(['Siklus', 'Sampel', 'Detik', 'Sampel awal (V)', 'Sampel pada kenaikan'], [normal, flagged].map((e) => [e.cycle, fmtInt(e.charge.n), fmtInt(e.charge.duration), fmt(e.charge.first_v, 3), fmtInt(e.ic_samples)]), { num: [0, 1, 2, 3, 4] });
  },
});
function flaggedLine(b, feature, view) {
  const rows = byBat[b], filled = new Map(D.flagged.filter((x) => x.battery === b).map((x) => [x.cycle, x.repo[feature]]));
  return { rows, filled };
}
figure('flags', {
  state: { feature: 't_cc', view: 'observed' },
  controls(api) {
    api.controls.append(ctlBox('Baterai', batteryChips(false)),
      ctlSelect('Fitur pengisian', CHARGE.map((k) => [k, `${k} (${FM[k].unit})`]), api.state.feature, (v) => { api.state.feature = v; api.redraw(); }),
      ctlBox('Tampilkan', ctlSeg([['observed', 'Dalam analisis (kosong)'], ['source', 'Dalam CSV sumber (diisi)']], api.state.view, (v) => { api.state.view = v; api.redraw(); }, 'Tampilan')));
  },
  render(api) {
    const b = effective(false), k = api.state.feature, { rows, filled } = flaggedLine(b, k), W = api.width();
    const vals = rows.map((r) => r[k]).filter(finite).concat([...filled.values()]);
    const f = frame(api.body, { w: W, h: 270, x: [Math.min(...rows.map((r) => r.cycle)) - 2, Math.max(...rows.map((r) => r.cycle)) + 2], y: extent(vals, 0.08), xLabel: 'nomor siklus', yLabel: FM[k].axis, aria: `${k} sepanjang siklus ${b}`, xFmt: fmtInt });
    const pts = rows.map((r) => [r.cycle, r[k]]);
    f.layer.append(lineMark(pathD(pts, f.sx, f.sy), bColor(b), 1.6));
    rows.forEach((r) => { if (finite(r[k])) f.layer.append(s('circle', { cx: f.sx(r.cycle), cy: f.sy(r[k]), r: 2.6, fill: bColor(b) })); });
    for (const [cycle, value] of filled) {
      const x = f.sx(cycle);
      if (api.state.view === 'observed') {
        f.layer.append(s('rect', { x: x - 5, y: f.m.t, width: 10, height: f.ih, fill: 'var(--warn)', opacity: 0.2 }));
        f.svg.append(s('text', { x, y: f.m.t + 12, 'text-anchor': 'middle', class: 't-strong' }, 'kosong'));
      } else {
        f.svg.append(s('circle', { cx: x, cy: f.sy(value), r: 7, fill: 'var(--card)', stroke: 'var(--warn)', 'stroke-width': 3 }));
        f.svg.append(s('text', { x: x + 11, y: f.sy(value) + 4, class: 't-strong' }, `diisi: ${fmtF(k, value)}`));
      }
    }
  },
  caption() {
    const b = effective(false), n = D.flagged.filter((x) => x.battery === b).length;
    return `${oneCellNote()} ${b}: ${n} siklus bermasalah. Lingkaran kosong: interpolasi CSV sumber; celah berarsir: analisis teramati. Baris siklus dan label kapasitas tetap dipertahankan.`;
  },
  table(api) {
    const b = effective(false), k = api.state.feature;
    return tableEl(['Siklus', 'Hasil aturan', 'Isian dalam CSV sumber'], D.flagged.filter((x) => x.battery === b).map((x) => [x.cycle, fmtF(k, x.raw[k]), fmtF(k, x.repo[k])]), { num: [0, 1, 2] });
  },
});
(function flagTable() {
  const host = document.getElementById('flag-table');
  if (!host) return;
  const rows = D.flagged.map((x) => {
    const e = EX.find((q) => q.battery === x.battery && q.cycle === x.cycle);
    return [`${x.battery} · ${x.cycle}`, `${fmt(e.charge.first_v, 2)} V`, `${fmtInt(e.charge.duration)} s`, fmtInt(e.ic_samples),
      `${fmt(x.raw.t_cc, 1)} · ${fmt(x.raw.t_cv, 0)} · ${fmt(x.raw.dq_dv_peak, 2)} · ${fmt(x.raw.v_at_peak, 1)}`,
      `${fmt(x.repo.t_cc, 0)} · ${fmt(x.repo.t_cv, 0)} · ${fmt(x.repo.dq_dv_peak, 2)} · ${fmt(x.repo.v_at_peak, 1)}`];
  });
  host.append(tableEl(['Sel · siklus', 'Sampel awal', 'Lama catatan', 'Sampel pada kenaikan 3,8–4,18 V', 'Hasil aturan: t_cc · t_cv · dQ/dV · V puncak', 'CSV sumber: empat nilai yang sama'], rows, { caption: 'Lima siklus yang ditandai', num: [3], cls: 'wide' }));
})();

/* ---- 7. contracts ---- */
const CAT = { invariant: 'rule', raw_invariant: 'rule', source: 'rule', quality_exception: 'exception', snapshot_expectation: 'snapshot' };
const HUMAN = (n) => translateText(n);
figure('rules', {
  state: { cat: 'rule' },
  controls(api) {
    const checks = D.contracts.checks, count = (c) => checks.filter((x) => CAT[x.category] === c).length;
    api.controls.append(ctlBox('Tampilkan', ctlSeg([['rule', `Aturan umum ${count('rule')}`], ['exception', `Pengecualian ${count('exception')}`], ['snapshot', `Cek rekaman ini ${count('snapshot')}`], ['all', `Semua ${checks.length}`]], api.state.cat, (v) => { api.state.cat = v; api.redraw(); }, 'Jenis pemeriksaan')));
  },
  render(api) {
    const list = D.contracts.checks.filter((x) => api.state.cat === 'all' || CAT[x.category] === api.state.cat);
    const chips = h('div', { class: 'chips' });
    for (const x of list) {
      const ok = x.status === 'pass', chip = h('span', { class: `pill ${ok ? 'ok' : 'warn'}`, tabindex: '0' }, `${ok ? '✓' : '!'} ${HUMAN(x.check)}`);
      hover(chip, () => h('div', null, h('b', { text: HUMAN(x.check) }), h('div', { text: translateText(x.description) }), x.affected_count ? h('div', { text: `Baris terkait: ${fmtInt(x.affected_count)}` }) : null));
      chips.append(chip);
    }
    api.body.append(chips);
    api.body.append(h('div', { class: 'panel-title', text: 'Bisakah pemeriksaan mendeteksi kerusakan? Enam kerusakan sengaja dibuat pada salinan sementara' }));
    api.body.append(tableEl(['Kerusakan', 'Aturan yang seharusnya gagal', 'Terdeteksi?'], D.contracts.mutation_tests.map((m) => [HUMAN(m.case), HUMAN(m.expected_failure),
      h('span', { class: `pill ${m.detected ? 'ok' : 'bad'}` }, m.detected ? '✓ terdeteksi' : '✗ terlewat')])));
  },
  caption: () => `${D.tokens.n_rules} aturan lolos; ${D.tokens.n_mutations} kerusakan sengaja terdeteksi. Ini memastikan aturan tabel, bukan kalibrasi sensor atau ketersediaan fitur lebih awal. Arahkan penunjuk atau buka tabel untuk rinciannya.`,
  table(api) {
    const list = D.contracts.checks.filter((x) => api.state.cat === 'all' || CAT[x.category] === api.state.cat);
    return tableEl(['Hasil', 'Pemeriksaan', 'Jenis', 'Yang diperiksa', 'Baris terkait'], list.map((x) => [x.status === 'pass' ? 'lolos' : 'peringatan', HUMAN(x.check), translateText(CAT[x.category]), translateText(x.description), x.affected_count ? fmtInt(x.affected_count) : '']), { num: [4], caption: 'Pemeriksaan kontrak data' });
  },
});
const MOMENTS = [['end_of_charge', 'Saat pengisian selesai'], ['discharge_start', 'Saat pengosongan mulai']];
figure('avail', {
  render(api) {
    const rows = FEAT.map((k) => [h('span', null, h('code', null, k), ` ${FM[k].name}`), ...MOMENTS.map(([m]) => timingPill(k, m))]);
    api.body.append(tableEl(['Fitur', ...MOMENTS.map((m) => m[1])], rows, { caption: 'Kapan setiap fitur diketahui' }));
    api.body.append(h('div', { class: 'legend' }, h('span', null, h('b', null, '✓ sudah diketahui'), ': terukur dari data yang sudah tersedia saat itu'), h('span', null, h('b', null, '✗ perlu data berikutnya'), ': dihitung dari data yang dicatat setelahnya'),
      h('span', null, h('b', null, '? belum dipastikan'), ': waktunya tidak dapat dipastikan dari berkas')));
  },
  caption: () => `Hanya empat fitur pengisian yang diketahui saat pengisian berakhir, untuk ${D.tokens.n_complete}/${D.tokens.n_cycles} siklus. Kedua batas waktu ditampilkan; waktu penggunaan model belum dipilih.`,
});
