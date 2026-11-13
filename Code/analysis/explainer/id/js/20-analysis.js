/* ===== part 2: analysis figures ===== */
const fmtTick = (v) => v.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(v) < 1 ? 3 : Math.abs(v) < 10 ? 2 : Math.abs(v) < 100 ? 1 : 0 });
const oneCellNote = () => (S.battery === 'ALL' ? ` Tampilan ini menampilkan satu sel baterai, yaitu ${BAT[0]}; pilih sel lain di atas untuk menggantinya.` : '');
const sohAt = Object.fromEntries(BAT.map((b) => [b, new Map(byBat[b].map((r) => [r.cycle, r.soh]))]));
const legendBatteries = (list) => h('div', { class: 'legend' }, list.map((b) => tick3(b, bColor(b))));

/* small multiples: one panel per battery when "All" is chosen, one panel otherwise */
function panelsFor(api, supportsAll, drawPanel) {
  const W = api.width(), list = S.battery === 'ALL' && supportsAll ? BAT : [effective(supportsAll)];
  const cols = list.length > 1 && W >= 760 ? 2 : 1, pw = Math.floor((W - (cols - 1) * 22) / cols);
  const wrap = h('div', { class: cols === 2 ? 'grid-2' : '' });
  api.body.append(wrap);
  for (const b of list) {
    const cell = h('div', { class: 'mini' }, h('h4', null, tick3(b, bColor(b))));
    wrap.append(cell);
    drawPanel(cell, b, pw);
  }
}

/* ---- 6. state of health against cycle ---- */
figure('soh', {
  controls: (api) => api.controls.append(ctlBox('Sorot baterai', batteryChips(true))),
  render(api) {
    const W = api.width(), f = frame(api.body, { w: W, h: 340, x: [0, 172], y: [54, 106], xLabel: 'nomor siklus', yLabel: 'Kesehatan baterai (%)', m: { l: 54, r: 62, t: 12, b: 40 }, xFmt: fmtInt,
      aria: 'Kesehatan setiap baterai terhadap nomor siklus' });
    const ref = (v, text, right) => {
      f.layer.append(s('line', { x1: f.m.l, x2: f.m.l + f.iw, y1: f.sy(v), y2: f.sy(v), stroke: 'var(--muted)', 'stroke-width': 1, opacity: 0.55 }));
      f.svg.append(s('text', { x: right ? f.m.l + f.iw - 6 : f.m.l + 6, y: f.sy(v) - 5, 'text-anchor': right ? 'end' : 'start' }, text));
    };
    ref(100, '100% = 2 Ah, kapasitas acuan', true);
    ref(70, '70%: batas akhir masa pakai pada kode sumber', false);
    for (const b of BAT) {
      const dim = S.battery !== 'ALL' && S.battery !== b;
      const path = lineMark(pathD(byBat[b].map((r) => [r.cycle, r.soh]), f.sx, f.sy), dim ? 'var(--muted)' : bColor(b), dim ? 1.4 : 2);
      if (dim) path.setAttribute('opacity', 0.4);
      f.layer.append(path);
      if (!dim) {
        const last = byBat[b][byBat[b].length - 1];
        f.svg.append(s('text', { x: f.sx(last.cycle) + 7, y: f.sy(last.soh) + (last.cycle < 150 ? 19 : 4), class: 't-strong' }, b));
      }
    }
    for (const r of D.rests) {
      const dim = S.battery !== 'ALL' && S.battery !== r.battery, row = byBat[r.battery].find((c) => c.cycle === r.cycle);
      const tri = s('path', { d: `M${f.sx(r.cycle)} ${f.sy(row.soh) - 9}l6 11h-12z`, fill: dim ? 'var(--muted)' : bColor(r.battery), stroke: 'var(--card)', 'stroke-width': 2, opacity: dim ? 0.4 : 1, tabindex: '0' });
      hover(tri, () => tipRows(`${r.battery} · siklus ${r.cycle}`, [['Jeda sebelumnya', `${fmt(r.rest, 1)} h`], ['Perubahan kapasitas', `${r.jump >= 0 ? '+' : ''}${fmt(r.jump, 3)} Ah`]]));
      f.svg.append(tri);
    }
    const line = s('line', { y1: f.m.t, y2: f.m.t + f.ih, stroke: 'var(--fg)', 'stroke-width': 1, opacity: 0.5, visibility: 'hidden' });
    const hit = s('rect', { class: 'hit', x: f.m.l, y: f.m.t, width: f.iw, height: f.ih });
    f.svg.append(line, hit);
    hit.addEventListener('pointermove', (ev) => {
      const box = f.svg.getBoundingClientRect(), cyc = Math.round(f.sx.inv(((ev.clientX - box.left) * f.w) / box.width));
      line.setAttribute('x1', f.sx(cyc)); line.setAttribute('x2', f.sx(cyc)); line.setAttribute('visibility', 'visible');
      const rows = BAT.filter((b) => sohAt[b].has(cyc)).map((b) => [b, `${fmt(sohAt[b].get(cyc), 1)}%`, bColor(b)]);
      tipShow(tipRows(`Siklus ${cyc}`, rows.length ? rows : [['Tidak ada data pada siklus ini', '']]), ev.clientX, ev.clientY);
    });
    hit.addEventListener('pointerleave', () => { line.setAttribute('visibility', 'hidden'); tipHide(); });
    api.body.append(h('div', { class: 'legend' }, ...BAT.map((b) => tick3(b, bColor(b))), h('span', null, h('b', null, '▲'), ' siklus setelah jeda 81 jam atau lebih')));
    api.body.append(h('div', { class: 'panel-title', text: 'Siklus setelah jeda terpanjang' }),
      tableEl(['Baterai', 'Siklus', 'Jeda sebelumnya (jam)', 'Perubahan kapasitas dari siklus sebelumnya (Ah)'], D.rests.map((r) => [r.battery, r.cycle, fmt(r.rest, 1), `${r.jump >= 0 ? '+' : ''}${fmt(r.jump, 3)}`]), { num: [1, 2, 3] }));
  },
  caption: () => `SoH = kapasitas terukur ÷ 2 Ah × 100, dengan rentang ${fmt(D.tokens.soh_min, 1)}% hingga ${fmt(D.tokens.soh_max, 1)}%. Segitiga menandai siklus setelah jeda panjang; kapasitas pada setiap siklus itu lebih tinggi daripada siklus sebelumnya (+${fmt(D.tokens.rest_jump_min, 3)} hingga +${fmt(D.tokens.rest_jump_max, 3)} Ah). Ada ${D.tokens.above_100} siklus B0006 di atas 100%: 2 Ah adalah acuan, bukan batas fisik, sehingga data ini tetap disertakan.`,
  table: () => tableEl(['Baterai', 'Siklus', 'Siklus pertama', 'Siklus terakhir', 'Rentang kapasitas (Ah)', 'Rentang SoH (%)'], D.summary.map((r) => [r.battery_id, r.n_cycles, r.first_cycle, r.last_cycle,
    `${fmt(r.capacity_min_ah, 3)} hingga ${fmt(r.capacity_max_ah, 3)}`, `${fmt(r.soh_min_percent, 1)} hingga ${fmt(r.soh_max_percent, 1)}`]), { num: [1, 2, 3] }),
});

/* ---- 7. each feature against health ---- */
figure('scatter', {
  state: { log: false },
  controls(api) {
    api.controls.append(ctlBox('Baterai', batteryChips(true)), ctlCheck('Skala log untuk selang antar-pengosongan', false, (v) => { api.state.log = v; api.redraw(); }));
  },
  render(api) {
    const W = api.width(), cols = W >= 900 ? 3 : W >= 580 ? 2 : 1, pw = Math.floor((W - (cols - 1) * 18) / cols);
    const rows = S.battery === 'ALL' ? cycles : byBat[S.battery], ys = extent(cycles.map((r) => r.soh), 0.05);
    const grid = h('div', { class: cols === 3 ? 'grid-3' : cols === 2 ? 'grid-2' : '' });
    api.body.append(grid);
    for (const k of FEAT) {
      const st = stat(S.battery, k), pairs = rows.filter((r) => finite(r[k]) && finite(r.soh));
      const cell = h('div', { class: 'mini' }, h('h4', { text: FM[k].name }), h('div', { class: 'stat', text: `${k} · n=${pairs.length} · r ${signed(st.pearson_r)} · ρ ${signed(st.spearman_rho)}` }));
      grid.append(cell);
      const log = k === 'rest_time_hours' && api.state.log, tf = log ? Math.log1p : (x) => x, inv = log ? Math.expm1 : (x) => x;
      let [x0, x1] = extent(pairs.map((r) => tf(r[k])), 0.055);
      if (k === 'rest_time_hours') x0 = Math.max(0, x0);
      const f = frame(cell, { w: pw, h: 205, x: [x0, x1], y: ys, xLabel: FM[k].axis + (log ? ' · log(1+x)' : ''), yLabel: 'SoH (%)', m: { l: 46, r: 10, t: 8, b: 40 },
        xTicks: log ? [0, 1, 2, 3].map((j) => x0 + ((x1 - x0) * j) / 3) : undefined, xFmt: log ? (v) => fmtTick(inv(v)) : fmtTick,
        aria: `${FM[k].name} terhadap kesehatan baterai, ${pairs.length} siklus` });
      const pts = pairs.map((r) => ({ x: f.sx(tf(r[k])), y: f.sy(r.soh), r }));
      for (const p of pts) f.layer.append(s('circle', { cx: p.x, cy: p.y, r: 2.6, fill: bColor(p.r.battery_id), opacity: 0.62 }));
      const ring = s('circle', { r: 7, class: 'ring', visibility: 'hidden' });
      f.svg.append(ring);
      nearestHover(f.svg, pts, 26, (p) => tipRows(`${p.r.battery_id} · siklus ${p.r.cycle}`, [[FM[k].name, `${fmtF(k, p.r[k])} ${FM[k].unit}`, bColor(p.r.battery_id)], ['SoH', `${fmt(p.r.soh, 2)}%`]]), ring);
    }
    api.body.append(legendBatteries(S.battery === 'ALL' ? BAT : [S.battery]));
  },
  caption() {
    const omitted = stat(S.battery, 't_cc').omitted_pairs;
    return `<b>${bLabel(S.battery)}.</b> r adalah korelasi Pearson (hubungan garis lurus), sedangkan ρ adalah korelasi Spearman (kecenderungan naik atau turun secara konsisten). ${omitted ? `${omitted} siklus bermasalah tidak disertakan dalam empat panel fitur pengisian, sehingga jumlah datanya (n) lebih kecil.` : ''} Sumbu vertikal sama pada setiap panel.`;
  },
  table() {
    return tableEl(['Fitur', 'Siklus yang dipakai (n)', 'Tidak disertakan', 'Pearson r', 'Spearman ρ'], FEAT.map((k) => { const st = stat(S.battery, k); return [k, st.n_pairs, st.omitted_pairs, signed(st.pearson_r), signed(st.spearman_rho)]; }), { num: [1, 2, 3, 4] });
  },
});
figure('rho', {
  controls: (api) => api.controls.append(ctlBox('Baterai', batteryChips(true))),
  render(api) {
    const cols = ['ALL', ...BAT], t = h('table', { class: 'data heat' });
    t.append(h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Fitur'), cols.map((c) => h('th', { scope: 'col', class: 'n' }, bLabel(c))))));
    t.append(h('tbody', null, FEAT.map((k) => h('tr', null, h('td', null, h('code', null, k), h('br'), FM[k].name),
      cols.map((c) => {
        const st = stat(c, k), rho = st.spearman_rho;
        const td = h('td', { class: `cell n ${rho >= 0 ? 'pos' : 'neg'}${c === S.battery ? ' col-on' : ''}`, style: `--p:${(0.08 + 0.5 * Math.min(1, Math.abs(rho))).toFixed(3)}`, tabindex: '0' }, signed(rho));
        hover(td, () => tipRows(`${k} · ${bLabel(c)}`, [['Spearman ρ', signed(rho)], ['Pearson r', signed(st.pearson_r)], ['Siklus yang dipakai', fmtInt(st.n_pairs)], ['Tidak disertakan', fmtInt(st.omitted_pairs)]]));
        return td;
      })))));
    api.body.append(h('div', { class: 'table-scroll' }, t));
    api.body.append(h('div', { class: 'legend' }, h('span', null, 'Oranye: nilai fitur lebih tinggi terkait SoH lebih rendah'), h('span', null, 'Biru: nilai lebih tinggi terkait SoH lebih tinggi'), h('span', null, 'Lebih pucat: hubungan lebih lemah')));
  },
  caption: () => 'Korelasi Spearman ρ antara setiap fitur dan kesehatan baterai (setara dengan korelasi terhadap kapasitas). Kolom berbingkai mengikuti pilihan baterai. Arahkan penunjuk ke sel untuk melihat Pearson r dan jumlah siklus yang dipakai.',
});

/* ---- 8a. trend against change ---- */
const tdiag = (b, k) => D.temporal.find((r) => r.battery_id === b && r.feature === k);
figure('levels', {
  controls: (api) => api.controls.append(ctlBox('Baterai', batteryChips(true))),
  render(api) {
    panelsFor(api, true, (cell, b, W) => {
      const left = 112, rowH = 30, top = 8, H = top + rowH * FEAT.length + 34;
      const sx = lin(-1, 1, left, W - 14);
      const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Tiga korelasi untuk setiap fitur pada ${b}` });
      for (const v of [-1, -0.5, 0, 0.5, 1]) {
        svg.append(s('line', { class: v === 0 ? 'zero' : 'grid', x1: sx(v), x2: sx(v), y1: top, y2: top + rowH * FEAT.length }));
        svg.append(s('text', { x: sx(v), y: top + rowH * FEAT.length + 15, 'text-anchor': 'middle' }, v === 0 ? '0' : fmt(v, 1)));
      }
      svg.append(s('text', { x: left + (W - 14 - left) / 2, y: H - 3, 'text-anchor': 'middle' }, 'Spearman ρ'));
      FEAT.forEach((k, i) => {
        const y = top + i * rowH + rowH / 2, d = tdiag(b, k);
        const vals = [[stat(b, k).spearman_rho, 'circle', 'var(--s1)', 'Semua siklus: fitur terhadap kapasitas'], [d.cycle_adjusted_rank_correlation, 'diamond', 'var(--s3)', 'Setelah pengaruh linear nomor siklus disisihkan'], [d.consecutive_change_spearman, 'triangle', 'var(--s2)', 'Perubahan antar-siklus']];
        const present = vals.filter((v) => finite(v[0]));
        svg.append(s('text', { x: left - 8, y: y + 4, 'text-anchor': 'end' }, k));
        if (present.length > 1) svg.append(s('line', { x1: sx(Math.min(...present.map((v) => v[0]))), x2: sx(Math.max(...present.map((v) => v[0]))), y1: y, y2: y, stroke: 'var(--border)', 'stroke-width': 3, 'stroke-linecap': 'round' }));
        for (const [v, shape, color] of present) {
          const x = sx(v), mk = shape === 'circle' ? s('circle', { cx: x, cy: y, r: 5.5 }) : shape === 'diamond' ? s('path', { d: `M${x} ${y - 7}l7 7l-7 7l-7 -7z` }) : s('path', { d: `M${x} ${y - 7}l7 12h-14z` });
          mk.setAttribute('fill', color); mk.setAttribute('stroke', 'var(--card)'); mk.setAttribute('stroke-width', 2);
          svg.append(mk);
        }
        const hit = s('rect', { class: 'hit', x: 0, y: y - rowH / 2, width: W, height: rowH, tabindex: '0' });
        hover(hit, () => tipRows(`${k} · ${b}`, [['Semua siklus', signed(vals[0][0]), 'var(--s1)'], ['Tren disisihkan', signed(vals[1][0]), 'var(--s3)'], ['Perubahan', signed(vals[2][0]), 'var(--s2)'], ['Pasangan data', `${d.n_level_pairs} / ${d.n_change_pairs}`]]));
        svg.append(hit);
      });
      cell.append(svg);
    });
    api.body.append(h('div', { class: 'legend' }, tick3('Semua siklus: fitur terhadap kapasitas', 'var(--s1)'), tick3('Setelah pengaruh linear nomor siklus disisihkan', 'var(--s3)'), tick3('Perubahan antar-siklus', 'var(--s2)')));
  },
  caption: () => 'Jika titik jauh dari penanda perubahan, hubungan keseluruhan yang kuat banyak mengikuti tren penuaan bersama. “Tren disisihkan” mengubah kedua besaran menjadi peringkat, menyisihkan bagian yang dijelaskan secara linear oleh nomor siklus, lalu menghitung korelasi sisanya. Ini pemeriksaan pola, bukan pembuktian sebab-akibat. Arahkan penunjuk ke baris untuk melihat nilai dan jumlah pasangan data.',
  table() {
    const list = S.battery === 'ALL' ? BAT : [effective(true)], rows = [];
    for (const b of list) for (const k of FEAT) { const d = tdiag(b, k); rows.push([b, k, signed(stat(b, k).spearman_rho), signed(d.cycle_adjusted_rank_correlation), signed(d.consecutive_change_spearman), d.n_change_pairs]); }
    return tableEl(['Baterai', 'Fitur', 'Semua siklus', 'Tren disisihkan', 'Perubahan', 'Pasangan perubahan'], rows, { num: [2, 3, 4, 5] });
  },
});

/* ---- 8b. autocorrelation ---- */
figure('lag', {
  state: { measure: 'capacity' },
  controls(api) {
    api.controls.append(ctlBox('Baterai', batteryChips(true)),
      ctlSelect('Besaran', [['capacity', 'Kapasitas terukur'], ...FEAT.map((k) => [k, `${FM[k].name} (${k})`])], api.state.measure, (v) => { api.state.measure = v; api.redraw(); }));
  },
  render(api) {
    const rec = D.autocorrelation.records;
    panelsFor(api, true, (cell, b, W) => {
      const pick = (series) => rec.filter((r) => r.battery_id === b && r.feature === api.state.measure && r.series === series).sort((x, y) => x.lag - y.lag);
      const levels = pick('level'), diffs = pick('difference');
      const f = frame(cell, { w: W, h: 250, x: [0.5, 20.5], y: [-1, 1], xTicks: [1, 5, 10, 15, 20], yTicks: [-1, -0.5, 0, 0.5, 1], xLabel: 'lag (jarak dalam siklus tercatat)', yLabel: 'korelasi', m: { l: 46, r: 12, t: 10, b: 40 },
        xFmt: (v) => String(v), yFmt: (v) => (v === 0 ? '0' : fmt(v, 1)), aria: `Korelasi lag untuk ${api.state.measure} pada ${b}` });
      f.layer.append(s('line', { class: 'zero', x1: f.m.l, x2: f.m.l + f.iw, y1: f.sy(0), y2: f.sy(0) }));
      for (const [series, color] of [[levels, 'var(--s1)'], [diffs, 'var(--s2)']]) {
        f.layer.append(lineMark(pathD(series.map((r) => [r.lag, r.value]), f.sx, f.sy), color, 2));
        for (const r of series) if (finite(r.value)) f.layer.append(s('circle', { cx: f.sx(r.lag), cy: f.sy(r.value), r: 3.6, fill: color, stroke: 'var(--card)', 'stroke-width': 2 }));
      }
      const line = s('line', { y1: f.m.t, y2: f.m.t + f.ih, stroke: 'var(--fg)', opacity: 0.5, visibility: 'hidden' }), hit = s('rect', { class: 'hit', x: f.m.l, y: f.m.t, width: f.iw, height: f.ih });
      f.svg.append(line, hit);
      hit.addEventListener('pointermove', (ev) => {
        const box = f.svg.getBoundingClientRect(), lag = Math.min(20, Math.max(1, Math.round(f.sx.inv(((ev.clientX - box.left) * f.w) / box.width))));
        const a = levels.find((r) => r.lag === lag), c = diffs.find((r) => r.lag === lag);
        line.setAttribute('x1', f.sx(lag)); line.setAttribute('x2', f.sx(lag)); line.setAttribute('visibility', 'visible');
        tipShow(tipRows(`Lag ${lag}`, [['Nilai asli', `${signed(a && a.value)} (${a ? a.n_pairs : 0} pasangan)`, 'var(--s1)'], ['Perubahan', `${signed(c && c.value)} (${c ? c.n_pairs : 0} pasangan)`, 'var(--s2)']]), ev.clientX, ev.clientY);
      });
      hit.addEventListener('pointerleave', () => { line.setAttribute('visibility', 'hidden'); tipHide(); });
    });
    api.body.append(h('div', { class: 'legend' }, tick3('Nilai asli: hasil pengukurannya', 'var(--s1)'), tick3('Perubahan: selisih antar-siklus', 'var(--s2)')));
  },
  caption: () => `Lag 1 membandingkan setiap siklus dengan siklus tercatat berikutnya. Pada kapasitas, korelasi nilai asli pada lag 1 di keempat sel berkisar ${fmt(D.tokens.lag1_level_min, 3)} hingga ${fmt(D.tokens.lag1_level_max, 3)}, sedangkan korelasi perubahannya ${signed(D.tokens.lag1_diff_min)} hingga ${signed(D.tokens.lag1_diff_max)}. Lag dihitung dalam siklus, bukan jam.`,
  table(api) {
    const rows = [];
    for (const b of S.battery === 'ALL' ? BAT : [effective(true)]) for (const lag of [1, 2, 3, 5, 10, 20]) {
      const a = D.autocorrelation.records.find((r) => r.battery_id === b && r.feature === api.state.measure && r.series === 'level' && r.lag === lag);
      const c = D.autocorrelation.records.find((r) => r.battery_id === b && r.feature === api.state.measure && r.series === 'difference' && r.lag === lag);
      rows.push([b, lag, signed(a && a.value), a ? a.n_pairs : '', signed(c && c.value), c ? c.n_pairs : '']);
    }
    return tableEl(['Baterai', 'Lag', 'Nilai asli', 'Pasangan data', 'Perubahan', 'Pasangan data'], rows, { num: [1, 2, 3, 4, 5] });
  },
});

/* ---- 9. mutual information ---- */
figure('mi', {
  state: { k: '5' },
  controls(api) {
    api.controls.append(ctlBox('Baterai', batteryChips(false)), ctlBox('Jumlah tetangga untuk estimasi (k)', ctlSeg([['3', '3'], ['5', '5'], ['10', '10']], api.state.k, (v) => { api.state.k = v; api.redraw(); }, 'Tetangga')));
  },
  render(api) {
    const W = api.width(), wide = W > 760, b = effective(false), syn = D.mutual_information.synthetic;
    const row = h('div', { class: wide ? 'grid-2' : '' });
    const left = h('div', { class: 'mini' }, h('h4', null, h('span', { class: 'badge-synth', text: 'Contoh buatan, bukan data baterai' })), h('div', { class: 'stat', text: `y = x² · Spearman ${signed(syn.spearman)} · MI ${fmt(syn.mi, 2)} nat` }));
    const right = h('div', { class: 'mini' }, h('h4', { text: `Data terukur: ${b}, kapasitas terhadap setiap fitur` }));
    row.append(left, right); api.body.append(row);
    const pw = wide ? Math.floor((W - 22) / 2) : W;
    const f = frame(left, { w: pw, h: 250, x: [-1.08, 1.08], y: [-0.08, 1.08], xLabel: 'x', yLabel: 'y', xTicks: [-1, -0.5, 0, 0.5, 1], yTicks: [0, 0.5, 1], aria: 'Contoh buatan berbentuk U' });
    syn.x.forEach((x, i) => f.layer.append(s('circle', { cx: f.sx(x), cy: f.sy(syn.y[i]), r: 2.6, fill: 'var(--muted)', opacity: 0.8 })));
    const recs = FEAT.map((k) => D.mutual_information.records.find((r) => r.battery_id === b && r.feature === k && String(r.neighbors) === api.state.k));
    const lblW = 96, rowH = 28, top = 22, gap = 18, panelW = Math.floor((pw - lblW - gap - 10) / 2), H = top + rowH * FEAT.length + 38;
    const svg = s('svg', { class: 'chart', viewBox: `0 0 ${pw} ${H}`, role: 'img', 'aria-label': `Informasi bersama dan korelasi Spearman untuk setiap fitur pada ${b}` });
    const maxMi = Math.max(...recs.map((r) => (r && finite(r.value) ? r.value : 0)), 1), sxm = lin(0, maxMi * 1.08, lblW, lblW + panelW), sxr = lin(-1, 1, lblW + panelW + gap, pw - 10);
    svg.append(s('text', { x: lblW, y: 12, class: 't-strong' }, 'Informasi bersama (nat)'), s('text', { x: lblW + panelW + gap, y: 12, class: 't-strong' }, 'Spearman ρ'));
    niceTicks(0, maxMi, 3).forEach((v) => { svg.append(s('line', { class: 'grid', x1: sxm(v), x2: sxm(v), y1: top, y2: top + rowH * FEAT.length }), s('text', { x: sxm(v), y: top + rowH * FEAT.length + 14, 'text-anchor': 'middle' }, String(v))); });
    [-1, 0, 1].forEach((v) => { svg.append(s('line', { class: v === 0 ? 'zero' : 'grid', x1: sxr(v), x2: sxr(v), y1: top, y2: top + rowH * FEAT.length }), s('text', { x: sxr(v), y: top + rowH * FEAT.length + 14, 'text-anchor': 'middle' }, String(v))); });
    FEAT.forEach((k, i) => {
      const r = recs[i], y = top + i * rowH + rowH / 2;
      svg.append(s('text', { x: lblW - 8, y: y + 4, 'text-anchor': 'end' }, k));
      if (!r || !finite(r.value)) { svg.append(s('text', { x: lblW + 4, y: y + 4 }, 'tidak diestimasi')); return; }
      const bar = s('rect', { x: lblW, y: y - 9, width: Math.max(1, sxm(r.value) - lblW), height: 18, rx: 4, fill: bColor(b), tabindex: '0' });
      hover(bar, () => tipRows(`${k} · ${b}`, [['Informasi bersama', `${fmt(r.value, 3)} nat`], ['Spearman ρ', signed(r.spearman)], ['Siklus yang dipakai', fmtInt(r.n_pairs)]]));
      svg.append(bar, s('text', { x: sxm(r.value) + 6, y: y + 4, class: 't-strong' }, fmt(r.value, 2)));
      svg.append(s('circle', { cx: sxr(r.spearman), cy: y, r: 6, fill: bColor(b), stroke: 'var(--card)', 'stroke-width': 2 }));
    });
    right.append(svg);
  },
  caption() {
    return `${oneCellNote()} <b>Kiri, contoh buatan:</b> bentuk U tidak memiliki satu arah keseluruhan, sehingga Spearman bernilai 0, tetapi informasi bersama (MI) sebesar ${fmt(D.tokens.mi_synthetic, 2)} nat. <b>Kanan, data terukur:</b> pada k = 5, t_cc memiliki MI terbesar di setiap sel (${fmt(D.tokens.mi_tcc_min, 2)} hingga ${fmt(D.tokens.mi_tcc_max, 2)} nat). Kedua ukuran sama-sama menonjolkan fitur pengisian, meskipun urutannya sedikit berbeda. MI bersatuan nat, bukan persentase, dan tidak memiliki tanda positif atau negatif. Mengubah k menunjukkan kepekaan estimasi; ini bukan interval kepercayaan.`;
  },
  table(api) {
    const b = effective(false);
    return tableEl(['Fitur', 'MI (nat)', 'Spearman ρ', 'Siklus yang dipakai'], FEAT.map((k) => { const r = D.mutual_information.records.find((x) => x.battery_id === b && x.feature === k && String(x.neighbors) === api.state.k); return [k, r && finite(r.value) ? fmt(r.value, 3) : 'tidak tersedia', r ? signed(r.spearman) : 'tidak tersedia', r ? r.n_pairs : '']; }), { num: [1, 2, 3] });
  },
});

/* ---- 10. overlap among features ---- */
const VIF_FEATURES = CHARGE;
const SHORT = { t_cc: 't_cc', t_cv: 't_cv', dq_dv_peak: 'dQ/dV', v_at_peak: 'V puncak', delta_T_max: 'ΔT', delta_V_ohmic: 'ΔV', Re: 'Re', Rct: 'Rct', rest_time_hours: 'jeda' };
figure('vif', {
  controls: (api) => api.controls.append(ctlBox('Baterai', batteryChips(true))),
  render(api) {
    const W = api.width(), scope = S.battery, color = scope === 'ALL' ? 'var(--muted)' : bColor(scope);
    const recs = VIF_FEATURES.map((k) => D.feature_overlap.records.find((r) => r.battery_id === scope && r.feature === k));
    const max = Math.max(...recs.map((r) => r.vif), 2), left = 110, right = 56, rowH = 36, top = 10, H = top + rowH * 4 + 36, sx = lin(0, max * 1.1, left, W - right);
    const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Inflasi varians pada empat fitur pengisian, ${bLabel(scope)}` });
    niceTicks(0, max, 5).forEach((v) => svg.append(s('line', { class: 'grid', x1: sx(v), x2: sx(v), y1: top, y2: top + rowH * 4 }), s('text', { x: sx(v), y: top + rowH * 4 + 16, 'text-anchor': 'middle' }, String(v))));
    svg.append(s('line', { class: 'zero', x1: sx(1), x2: sx(1), y1: top, y2: top + rowH * 4 }), s('text', { x: sx(1) + 4, y: top + rowH * 4 + 30 }, '1 = tidak tumpang tindih'));
    svg.append(s('text', { x: left + (W - right - left) / 2, y: H - 2, 'text-anchor': 'middle' }, 'faktor inflasi varians (VIF)'));
    VIF_FEATURES.forEach((k, i) => {
      const r = recs[i], y = top + i * rowH + rowH / 2;
      svg.append(s('text', { x: left - 10, y: y + 4, 'text-anchor': 'end' }, k));
      const bar = s('rect', { x: left, y: y - 10, width: Math.max(1, sx(r.vif) - left), height: 20, rx: 4, fill: color, tabindex: '0' });
      hover(bar, () => tipRows(`${k} · ${bLabel(scope)}`, [['VIF', fmt(r.vif, 2)], ['R² dari tiga fitur lain', fmt(r.auxiliary_r_squared, 3)], ['Siklus yang dipakai', fmtInt(r.n_rows)]]));
      svg.append(bar, s('text', { x: sx(r.vif) + 7, y: y + 4, class: 't-strong' }, fmt(r.vif, 1)));
    });
    api.body.append(svg);
  },
  caption: () => `VIF mengukur seberapa baik satu fitur dapat direkonstruksi dari tiga fitur lainnya dengan rumus garis lurus: 1 berarti tidak dapat, dan nilai lebih besar berarti lebih banyak tumpang tindih. VIF gabungan berkisar ${fmt(D.tokens.vif_v_at_peak, 1)} hingga ${fmt(D.tokens.vif_t_cc, 1)}; di dalam satu sel nilainya mencapai ${fmt(D.tokens.vif_cell_max, 0)}. Tidak ada ambang penghapusan dan tidak ada fitur yang dihapus otomatis.`,
  table() {
    return tableEl(['Fitur', 'VIF', 'R² dari tiga fitur lain', 'Siklus yang dipakai'], VIF_FEATURES.map((k) => { const r = D.feature_overlap.records.find((x) => x.battery_id === S.battery && x.feature === k); return [k, fmt(r.vif, 2), fmt(r.auxiliary_r_squared, 3), r.n_rows]; }), { num: [1, 2, 3] });
  },
});
figure('featmap', {
  controls: (api) => api.controls.append(ctlBox('Baterai', batteryChips(true))),
  render(api) {
    const scope = S.battery, map = D.clusters.feature_maps[scope], order = map.order, W = api.width(), lbl = 106, cell = Math.max(26, Math.min(46, Math.floor((W - lbl - 10) / 9))), n = order.length;
    const H = 22 + n * cell + 6, cuts = map.cuts['4'];
    const svg = s('svg', { class: 'chart', viewBox: `0 0 ${lbl + n * cell + 10} ${H}`, role: 'img', 'aria-label': `Korelasi Spearman antar-pasangan fitur, ${bLabel(scope)}`, style: `max-width:${lbl + n * cell + 10}px;margin-inline:auto` });
    order.forEach((fi, i) => {
      svg.append(s('text', { x: lbl - 8, y: 22 + i * cell + cell / 2 + 4, 'text-anchor': 'end' }, FEAT[fi]));
      svg.append(s('text', { x: lbl + i * cell + cell / 2, y: 14, 'text-anchor': 'middle' }, SHORT[FEAT[fi]]));
      order.forEach((fj, j) => {
        const rho = map.rho[fi][fj], p = 0.08 + 0.5 * Math.min(1, Math.abs(rho));
        const r = s('rect', { x: lbl + j * cell + 1, y: 22 + i * cell + 1, width: cell - 2, height: cell - 2, rx: 3, tabindex: '0', style: `--p:${p.toFixed(3)};fill:color-mix(in oklab,var(${rho >= 0 ? '--div-pos' : '--div-neg'}) calc(var(--p)*100%),var(--div-mid))` });
        hover(r, () => tipRows(`${FEAT[fi]} × ${FEAT[fj]}`, [['Spearman ρ', signed(rho)]]));
        svg.append(r);
        if (cell >= 34) svg.append(s('text', { x: lbl + j * cell + cell / 2, y: 22 + i * cell + cell / 2 + 4, 'text-anchor': 'middle', class: 't-strong', 'pointer-events': 'none' }, i === j ? '1' : fmt(rho, 2).replace('-0,', '-,').replace(/^0,/, ',')));
      });
    });
    order.forEach((fi, i) => { if (i > 0 && cuts[fi] !== cuts[order[i - 1]]) { svg.append(s('line', { x1: lbl, x2: lbl + n * cell, y1: 22 + i * cell, y2: 22 + i * cell, stroke: 'var(--fg)', 'stroke-width': 1.6 }), s('line', { x1: lbl + i * cell, x2: lbl + i * cell, y1: 22, y2: 22 + n * cell, stroke: 'var(--fg)', 'stroke-width': 1.6 })); } });
    api.body.append(svg);
    api.body.append(h('div', { class: 'legend' }, h('span', null, 'Oranye: bergerak berlawanan arah'), h('span', null, 'Biru: bergerak searah'), h('span', null, 'Garis gelap memisahkan empat kelompok fitur')));
  },
  caption: () => 'Spearman ρ antar-pasangan fitur, dihitung dari siklus dengan sembilan fitur teramati lengkap. Fitur diurutkan berdasarkan kemiripan (pohon average-linkage pada 1 − |ρ|, sehingga pasangan yang sangat berlawanan arah juga dianggap mirip). Garis gelap menandai pembagian bawaan menjadi empat kelompok.',
  table() {
    const map = D.clusters.feature_maps[S.battery];
    return tableEl(['Fitur', ...FEAT], FEAT.map((a, i) => [a, ...FEAT.map((_, j) => fmt(map.rho[i][j], 2))]), { num: FEAT.map((_, i) => i + 1) });
  },
});

/* ---- 11. clusters ---- */
const GROUP_SHAPES = ['circle', 'square', 'triangle', 'diamond'];
function shapeEl(shape, x, y, r, attrs) {
  const el = shape === 'circle' ? s('circle', { cx: x, cy: y, r }) : shape === 'square' ? s('rect', { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: 1.5 })
    : shape === 'triangle' ? s('path', { d: `M${x} ${y - r - 1}l${r + 1} ${2 * r}h${-2 * (r + 1)}z` }) : s('path', { d: `M${x} ${y - r - 1}l${r + 1} ${r + 1}l${-(r + 1)} ${r + 1}l${-(r + 1)} ${-(r + 1)}z` });
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
figure('clusters', {
  state: { k: '3', color: 'group', zoom: false, hidden: 0 },
  controls(api) {
    api.controls.append(ctlBox('Baterai', batteryChips(true)), ctlCheck('Perbesar bagian tengah: 98% siklus', false, (v) => { api.state.zoom = v; api.redraw(); }), ctlBox('Jumlah kelompok', ctlSeg([['2', '2'], ['3', '3'], ['4', '4']], api.state.k, (v) => { api.state.k = v; api.redraw(); }, 'Jumlah kelompok')),
      ctlBox('Warna siklus berdasarkan', ctlSeg([['group', 'Kelompok'], ['battery', 'Baterai'], ['soh', 'SoH']], api.state.color, (v) => { api.state.color = v; api.redraw(); }, 'Warna berdasarkan')));
  },
  render(api) {
    const W = api.width(), k = api.state.k, col = D.clusters.columns, ix = (name) => col.indexOf(name);
    const rows = D.clusters.rows.filter((r) => r[ix('included')]), gi = ix(`cluster_k${k}`);
    const [e1, e2] = D.clusters.explained;
    const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.round(p * (a.length - 1))]; };
    const xs = rows.map((r) => r[ix('pc1')]), ys = rows.map((r) => r[ix('pc2')]);
    const xd = api.state.zoom ? extent([q(xs, 0.01), q(xs, 0.99)], 0.08) : extent(xs, 0.04), yd = api.state.zoom ? extent([q(ys, 0.01), q(ys, 0.99)], 0.12) : extent(ys, 0.05);
    api.state.hidden = api.state.zoom ? rows.filter((r) => r[ix('pc1')] < xd[0] || r[ix('pc1')] > xd[1] || r[ix('pc2')] < yd[0] || r[ix('pc2')] > yd[1]).length : 0;
    const f = frame(api.body, { w: W, h: 360, x: xd, y: yd, xLabel: `PC1 (${fmt(100 * e1, 1)}% varians)`, yLabel: `PC2 (${fmt(100 * e2, 1)}%)`,
      aria: `Peta ${rows.length} siklus, warna berdasarkan ${{group: 'kelompok', battery: 'baterai', soh: 'SoH'}[api.state.color]}`, m: { l: 52, r: 14, t: 10, b: 40 }, xFmt: fmtTick, yFmt: fmtTick });
    const sohs = rows.map((r) => r[ix('soh')]), lo = Math.min(...sohs), hi = Math.max(...sohs), pts = [];
    for (const r of rows) {
      const b = r[ix('battery_id')], g = r[gi] - 1, dim = S.battery !== 'ALL' && S.battery !== b;
      let fill;
      if (api.state.color === 'group') fill = `var(--s${g + 1})`; else if (api.state.color === 'battery') fill = bColor(b); else fill = `color-mix(in oklab,var(--s1) ${(14 + 86 * (r[ix('soh')] - lo) / (hi - lo)).toFixed(0)}%,var(--card))`;
      const x = f.sx(r[ix('pc1')]), y = f.sy(r[ix('pc2')]);
      f.layer.append(shapeEl(api.state.color === 'group' ? GROUP_SHAPES[g] : 'circle', x, y, 3.3, { fill, opacity: dim ? 0.12 : 0.78 }));
      if (!dim) pts.push({ x, y, r });
    }
    const ring = s('circle', { r: 8, class: 'ring', visibility: 'hidden' });
    f.svg.append(ring);
    nearestHover(f.svg, pts, 26, (p) => tipRows(`${p.r[ix('battery_id')]} · siklus ${p.r[ix('cycle')]}`, [['Kelompok', String(p.r[gi])], ['SoH', `${fmt(p.r[ix('soh')], 1)}%`]]), ring);
    const legend = h('div', { class: 'legend' });
    if (api.state.color === 'group') D.clusters.groups[k].forEach((g, i) => legend.append(h('span', null, h('i', { style: `background:var(--s${i + 1});${GROUP_SHAPES[i] === 'square' ? 'border-radius:3px' : ''}` }), `Kelompok ${i + 1}`)));
    else if (api.state.color === 'battery') BAT.forEach((b) => legend.append(tick3(b, bColor(b))));
    else legend.append(h('span', null, `SoH ${fmt(lo, 0)}%`), h('span', { style: 'display:inline-block;width:120px;height:10px;border-radius:5px;background:linear-gradient(90deg,color-mix(in oklab,var(--s1) 14%,var(--card)),var(--s1));border:1px solid var(--border)' }), h('span', null, `${fmt(hi, 0)}%`));
    api.body.append(legend);
    const groups = D.clusters.groups[k];
    api.body.append(h('div', { class: 'panel-title', text: 'Perbedaan kelompok (diukur setelah pengelompokan, bukan dasar pembentukannya)' }),
      tableEl(['Kelompok', 'Siklus', 'Rata-rata SoH', 'Rentang SoH', 'Rentang siklus', 'Baterai'], groups.map((g, i) => [`Kelompok ${i + 1}`, fmtInt(g.n), `${fmt(g.soh_mean, 1)}%`, `${fmt(g.soh_range[0], 1)} hingga ${fmt(g.soh_range[1], 1)}%`, `${g.cycle_range[0]} hingga ${g.cycle_range[1]}`,
        BAT.filter((b) => g.batteries[b]).map((b) => `${b} ${g.batteries[b]}`).join(' · ')]), { num: [1] }));
  },
  caption(api) {
    return `${api.state.zoom ? `${api.state.hidden} siklus berada di luar area pembesaran ini. ` : ''}Pengelompokan gabungan menggunakan ${D.tokens.cluster_included} siklus lengkap. Dua sumbu peta mempertahankan ${fmt(D.tokens.cluster_var2, 1)}% varians; kelompok dibentuk memakai kesembilan fitur yang telah distandardisasi. Jadi, kelompok yang bertumpuk di peta datar ini masih mungkin terpisah dalam ruang sembilan fitur. Untuk tiga kelompok, silhouette (seberapa jelas siklus berada di kelompoknya sendiri, dari -1 hingga +1) bernilai ${fmt(D.tokens.cluster_sil3, 3)}. Nomor kelompok mengikuti posisi pada PC1, bukan kelas kesehatan baterai.`;
  },
  table(api) {
    const col = D.clusters.columns, ix = (name) => col.indexOf(name), k = api.state.k;
    return tableEl(['Baterai', 'Siklus', 'SoH (%)', 'PC1', 'PC2', 'Kelompok'], D.clusters.rows.filter((r) => r[ix('included')]).map((r) => [r[ix('battery_id')], r[ix('cycle')], fmt(r[ix('soh')], 1), fmt(r[ix('pc1')], 2), fmt(r[ix('pc2')], 2), r[ix(`cluster_k${k}`)]]), { num: [1, 2, 3, 4, 5] });
  },
});

/* ---- 12. coverage ---- */
const STAGES = [['all', 'Semua siklus'], ['early', 'Sepertiga awal'], ['middle', 'Sepertiga tengah'], ['late', 'Sepertiga akhir']];
const cov = (b, k, stage) => D.coverage.records.find((r) => r.battery_id === b && r.feature === k && r.stage === stage);
figure('coverage', {
  state: { measure: 'capacity' },
  controls(api) {
    api.controls.append(ctlBox('Baterai', batteryChips(true)), ctlSelect('Besaran', [['capacity', 'Kapasitas terukur'], ...FEAT.map((k) => [k, `${FM[k].name} (${k})`])], api.state.measure, (v) => { api.state.measure = v; api.redraw(); }));
  },
  render(api) {
    const k = api.state.measure, all = D.coverage.records.filter((r) => r.feature === k && finite(r.min));
    const dom = extent([...all.map((r) => r.min), ...all.map((r) => r.max)], 0.05);
    panelsFor(api, true, (cell, b, W) => {
      const sup = D.coverage.support.find((r) => r.battery_id === b && r.feature === k), left = 96, rowH = 40, top = 8, H = top + rowH * 4 + 36, sx = lin(dom[0], dom[1], left, W - 14);
      const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Rentang nilai ${k} pada ${b} menurut tahap penuaan` });
      const ticks = niceTicks(dom[0], dom[1], Math.max(3, Math.floor((W - left) / 90))), tf = tickFmt(ticks);
      ticks.forEach((v) => svg.append(s('line', { class: 'grid', x1: sx(v), x2: sx(v), y1: top, y2: top + rowH * 4 }), s('text', { x: sx(v), y: top + rowH * 4 + 16, 'text-anchor': 'middle' }, tf(v))));
      svg.append(s('text', { x: left + (W - 14 - left) / 2, y: H - 2, 'text-anchor': 'middle' }, FM[k].axis));
      if (sup && finite(sup.reference_min)) svg.append(s('rect', { x: sx(sup.reference_min), y: top, width: Math.max(2, sx(sup.reference_max) - sx(sup.reference_min)), height: rowH * 4, fill: 'var(--muted)', opacity: 0.13 }));
      STAGES.forEach(([stage, label], i) => {
        const r = cov(b, k, stage), y = top + i * rowH + rowH / 2;
        svg.append(s('text', { x: left - 8, y: y + 4, 'text-anchor': 'end' }, label));
        if (!r || !finite(r.min)) return;
        const op = stage === 'early' ? 0.4 : stage === 'middle' ? 0.7 : 1;
        svg.append(s('line', { x1: sx(r.min), x2: sx(r.max), y1: y, y2: y, stroke: bColor(b), 'stroke-width': 1.6, opacity: op }));
        const box = s('rect', { x: sx(r.q10), y: y - 8, width: Math.max(2, sx(r.q90) - sx(r.q10)), height: 16, rx: 4, fill: bColor(b), opacity: stage === 'all' ? 0.3 : op, tabindex: '0' });
        hover(box, () => {
          const rows = [['Terkecil hingga terbesar', `${fmtF(k, r.min)} hingga ${fmtF(k, r.max)}`], ['80% bagian tengah', `${fmtF(k, r.q10)} hingga ${fmtF(k, r.q90)}`], ['Median', fmtF(k, r.median)], ['Siklus yang memiliki nilai', `${r.n_valid} dari ${r.n_total}`]];
          if (stage === 'all' && sup) rows.push(['Di luar rentang sel lain', `${sup.outside_count} dari ${sup.n_valid} (di bawah ${sup.below_count}, di atas ${sup.above_count})`]);
          if (stage === 'late') { const t = D.coverage.temporal_support.find((q) => q.battery_id === b && q.feature === k); if (t) rows.push(['Di luar rentang awal sel ini', `${t.outside_count} dari ${t.n_valid}`]); }
          return tipRows(`${b} · ${label.toLowerCase()}`, rows);
        });
        svg.append(box, s('line', { x1: sx(r.median), x2: sx(r.median), y1: y - 8, y2: y + 8, stroke: 'var(--fg)', 'stroke-width': 2 }));
      });
      cell.append(svg);
    });
    api.body.append(h('div', { class: 'legend' }, h('span', null, 'Garis tipis: terkecil hingga terbesar'), h('span', null, 'Batang: 80% siklus bagian tengah'), h('span', null, 'Garis gelap: median'), h('span', null, 'Pita abu-abu: rentang pada tiga sel lainnya')));
  },
  caption: () => 'Tahap adalah pembagian siklus setiap sel menjadi tiga bagian, bukan tingkat penuaan yang sama. Pita abu-abu menunjukkan rentang terkecil hingga terbesar dari tiga sel lainnya. Bagian batang yang keluar dari pita menunjukkan nilai yang tidak memiliki padanan di sel lain. Arahkan penunjuk ke batang untuk melihat jumlah datanya.',
  table(api) {
    const k = api.state.measure, rows = [];
    for (const b of S.battery === 'ALL' ? BAT : [effective(true)]) { const sup = D.coverage.support.find((r) => r.battery_id === b && r.feature === k), t = D.coverage.temporal_support.find((r) => r.battery_id === b && r.feature === k); rows.push([b, `${sup.outside_count} dari ${sup.n_valid}`, `${t.outside_count} dari ${t.n_valid}`]); }
    return tableEl(['Baterai', 'Nilai di luar rentang sel lain', 'Nilai tahap akhir di luar rentang awal sel ini'], rows);
  },
});

/* ---- 13. uncertainty ---- */
const unc = (b, k, L) => D.uncertainty.records.find((r) => r.battery_id === b && r.feature === k && r.block_length === L);
const REASONS = [
  [/third-window correlation range/, 'Hubungan berubah sepanjang umur sel (beda antar-sepertiga lebih dari 0,6)'],
  [/KPSS|ADF|HAC|trend|SD ratio|stationar/, 'Uji kestasioneran atau tren mendeteksi pergeseran pola'],
  [/fewer than two full blocks/, 'Rangkaian siklus terlalu pendek untuk panjang blok ini'],
];
function uncReasonText(reason) {
  const text = String(reason || '');
  const labels = REASONS.filter(([re]) => re.test(text)).map(([, label]) => label);
  return labels.length ? labels.join('; ') : 'Data belum memenuhi syarat untuk menampilkan interval';
}
figure('unc', {
  state: { L: '5' },
  controls(api) { api.controls.append(ctlBox('Baterai', batteryChips(true)), ctlBox('Panjang blok (siklus)', ctlSeg([['3', '3'], ['5', '5'], ['10', '10']], api.state.L, (v) => { api.state.L = v; api.redraw(); }, 'Panjang blok'))); },
  render(api) {
    const L = Number(api.state.L);
    panelsFor(api, true, (cell, b, W) => {
      const left = 112, rowH = 28, top = 8, H = top + rowH * FEAT.length + 34, sx = lin(-1, 1, left, W - 14);
      const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Korelasi perubahan beserta interval jika memenuhi syarat, ${b}` });
      for (const v of [-1, -0.5, 0, 0.5, 1]) svg.append(s('line', { class: v === 0 ? 'zero' : 'grid', x1: sx(v), x2: sx(v), y1: top, y2: top + rowH * FEAT.length }), s('text', { x: sx(v), y: top + rowH * FEAT.length + 15, 'text-anchor': 'middle' }, v === 0 ? '0' : fmt(v, 1)));
      svg.append(s('text', { x: left + (W - 14 - left) / 2, y: H - 3, 'text-anchor': 'middle' }, 'korelasi perubahan antar-siklus'));
      FEAT.forEach((k, i) => {
        const r = unc(b, k, L), y = top + i * rowH + rowH / 2;
        svg.append(s('text', { x: left - 8, y: y + 4, 'text-anchor': 'end' }, k));
        if (!r || !finite(r.estimate)) return;
        const ok = r.status === 'conditional' && finite(r.ci_low);
        if (ok) svg.append(s('line', { x1: sx(r.ci_low), x2: sx(r.ci_high), y1: y, y2: y, stroke: bColor(b), 'stroke-width': 3, 'stroke-linecap': 'round' }));
        const dot = s('circle', { cx: sx(r.estimate), cy: y, r: 5.5, fill: ok ? bColor(b) : 'var(--card)', stroke: ok ? 'var(--card)' : bColor(b), 'stroke-width': ok ? 2 : 2.5 });
        svg.append(dot);
        const hit = s('rect', { class: 'hit', x: 0, y: y - rowH / 2, width: W, height: rowH, tabindex: '0' });
        hover(hit, () => tipRows(`${k} · ${b} · blok ${L} siklus`, [['Korelasi perubahan', signed(r.estimate)], ['Pasangan data', fmtInt(r.n_pairs)], ok ? ['Interval 95%', `${signed(r.ci_low)} hingga ${signed(r.ci_high)}`] : ['Interval', 'tidak ditampilkan'], ...(ok ? [] : [['Alasan', uncReasonText(r.reason)]])]));
        svg.append(hit);
      });
      cell.append(svg);
    });
    const skipped = D.uncertainty.records.filter((r) => r.block_length === L && r.status === 'skipped' && (S.battery === 'ALL' || r.battery_id === S.battery));
    const counts = REASONS.map(([re, label]) => [label, skipped.filter((r) => re.test(r.reason || '')).length]).sort((a, c) => c[1] - a[1]);
    api.body.append(h('div', { class: 'panel-title', text: `Mengapa interval tidak ditampilkan (${skipped.length} kasus, blok ${L} siklus; satu kasus dapat memiliki beberapa alasan)` }),
      tableEl(['Alasan', 'Kasus'], counts.map(([label, n]) => [label, n]), { num: [1] }));
    api.body.append(h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background:var(--fg)' }), 'Titik penuh dengan garis: estimasi dan interval 95%'), h('span', null, h('i', { style: 'background:var(--card);border:2px solid var(--fg)' }), 'Titik kosong: hanya estimasi, interval tidak ditampilkan')));
  },
  caption: () => `Dari ${D.tokens.unc_records} kombinasi baterai, fitur, dan panjang blok, ${D.tokens.unc_conditional} memiliki interval eksploratif dan ${D.tokens.unc_skipped} tidak ditampilkan. Interval menggambarkan hubungan perubahan di dalam satu sel dengan asumsi pengambilan sampel ulang. Ini bukan interval prediksi dan tidak menjelaskan perilaku sel baru.`,
  table(api) {
    const L = Number(api.state.L), rows = [];
    for (const b of S.battery === 'ALL' ? BAT : [effective(true)]) for (const k of FEAT) { const r = unc(b, k, L); rows.push([b, k, signed(r.estimate), r.status === 'conditional' ? `${signed(r.ci_low)} hingga ${signed(r.ci_high)}` : 'tidak ditampilkan', r.n_pairs]); }
    return tableEl(['Baterai', 'Fitur', 'Korelasi perubahan', 'Interval 95%', 'Pasangan data'], rows, { num: [2, 4] });
  },
});

/* ---- 4b. does the 10 mV grid matter? ---- */
figure('bins', {
  render(api) {
    const W = api.width(), wide = W > 700, pw = wide ? Math.floor((W - 22) / 2) : W, row = h('div', { class: wide ? 'grid-2' : '' });
    api.body.append(row);
    for (const feature of ['dq_dv_peak', 'v_at_peak']) {
      const cell = h('div', { class: 'mini' }, h('h4', { text: `${FM[feature].name} (${feature})` }));
      row.append(cell);
      const left = 60, rowH = 34, top = 8, H = top + rowH * 4 + 34, sx = lin(0.7, 1, left, pw - 14);
      const svg = s('svg', { class: 'chart', viewBox: `0 0 ${pw} ${H}`, role: 'img', 'aria-label': `Kesesuaian peringkat dengan hasil 10 mV untuk ${feature}` });
      [0.7, 0.8, 0.9, 1].forEach((v) => svg.append(s('line', { class: 'grid', x1: sx(v), x2: sx(v), y1: top, y2: top + rowH * 4 }), s('text', { x: sx(v), y: top + rowH * 4 + 15, 'text-anchor': 'middle' }, fmt(v, 1))));
      svg.append(s('text', { x: left + (pw - 14 - left) / 2, y: H - 3, 'text-anchor': 'middle' }, 'kesesuaian peringkat terhadap hasil 10 mV'));
      BAT.forEach((b, i) => {
        const y = top + i * rowH + rowH / 2;
        svg.append(s('text', { x: left - 8, y: y + 4, 'text-anchor': 'end' }, b));
        for (const [mv, shape] of [[5, 'circle'], [20, 'diamond']]) {
          const r = D.bins.find((q) => q.battery_id === b && q.feature === feature && q.bin_width_mv === mv), x = sx(r.rank_agreement_with_10mv);
          const yy = shape === 'circle' ? y - 6 : y + 6;
          const mk = shape === 'circle' ? s('circle', { cx: x, cy: yy, r: 5.5 }) : s('path', { d: `M${x} ${yy - 7}l7 7l-7 7l-7 -7z` });
          mk.setAttribute('fill', bColor(b)); mk.setAttribute('stroke', 'var(--card)'); mk.setAttribute('stroke-width', 2); mk.setAttribute('tabindex', '0');
          hover(mk, () => tipRows(`${b} · grid ${mv} mV`, [['Kesesuaian dengan 10 mV', fmt(r.rank_agreement_with_10mv, 3)], ['Spearman terhadap kapasitas', signed(r.spearman_with_capacity)], ['Siklus yang dipakai', fmtInt(r.n_pairs)]]));
          svg.append(mk);
        }
      });
      cell.append(svg);
    }
    api.body.append(h('div', { class: 'legend' }, h('span', null, h('b', null, '●'), ' grid 5 mV'), h('span', null, h('b', null, '◆'), ' grid 20 mV'), h('span', null, 'Warna mengikuti baterai')));
  },
  caption: () => 'Kesesuaian peringkat mengukur seberapa mirip urutan siklus dari grid berbeda dengan hasil 10 mV (1 berarti sama persis). Tinggi puncak hampir tidak berubah oleh pilihan grid, sedangkan posisi tegangan puncak lebih peka. Korelasi terhadap kapasitas tetap kuat pada kedua pilihan.',
  table: () => tableEl(['Baterai', 'Fitur', 'Grid (mV)', 'Spearman terhadap kapasitas', 'Kesesuaian dengan 10 mV', 'Siklus'], D.bins.map((r) => [r.battery_id, r.feature, r.bin_width_mv, signed(r.spearman_with_capacity), fmt(r.rank_agreement_with_10mv, 3), r.n_pairs]), { num: [2, 3, 4, 5] }),
});
