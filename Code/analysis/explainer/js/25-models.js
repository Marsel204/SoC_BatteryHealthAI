/* Cached, genuine leave-one-battery-out predictions; no fitting or network in the browser. */
const MODEL_RESULTS = D.model_results.models;
const MODEL_NAMES = Object.keys(MODEL_RESULTS).sort((a, b) => MODEL_RESULTS[a].mean_rmse - MODEL_RESULTS[b].mean_rmse);
const modelID = document.documentElement.lang === 'id';
const modelText = (en, id) => modelID ? id : en;
const modelFold = (name) => MODEL_RESULTS[name].folds.find((f) => f.test_battery === effective(false));

figure('modelcompare', {
  render(api) {
    const W = api.width(), H = 240, left = 83, right = 88, top = 12, row = 36;
    const max = Math.max(...MODEL_NAMES.map((name) => MODEL_RESULTS[name].mean_rmse));
    const sx = lin(0, max * 1.05, left, W - right);
    const svg = s('svg', {class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': modelText('Five models ranked by mean held-out RMSE; lower is better', 'Lima model menurut rata-rata RMSE pada sel uji; lebih kecil lebih baik')});
    for (const v of niceTicks(0, max * 1.05, 4)) {
      svg.append(s('line', {class: 'grid', x1: sx(v), x2: sx(v), y1: top, y2: top + row * 5}),
        s('text', {x: sx(v), y: top + row * 5 + 18, 'text-anchor': 'middle'}, fmt(v, 0)));
    }
    MODEL_NAMES.forEach((name, i) => {
      const result = MODEL_RESULTS[name], y = top + i * row + 8;
      const bar = s('rect', {x: left, y, width: sx(result.mean_rmse) - left, height: 20, rx: 3,
        fill: i === 0 ? 'var(--primary)' : 'var(--muted)', opacity: i === 0 ? 1 : 0.55, tabindex: '0', 'data-model': name});
      hover(bar, () => tipRows(name, [['RMSE', `${fmt(result.mean_rmse, 3)} ± ${fmt(result.std_rmse, 3)} pp`],
        ['MAE', `${fmt(result.mean_mae, 3)} pp`], ['R²', fmt(result.mean_r2, 3)]]));
      svg.append(s('text', {x: left - 9, y: y + 14, 'text-anchor': 'end', class: 't-strong'}, name), bar,
        s('text', {x: sx(result.mean_rmse) + 7, y: y + 14, class: 't-strong'}, `${fmt(result.mean_rmse, 2)} pp`));
    });
    svg.append(s('text', {x: left + (W - right - left) / 2, y: H - 4, 'text-anchor': 'middle'}, modelText('Mean LOBO RMSE (SoH percentage points)', 'Rata-rata RMSE LOBO (poin persentase SoH)')));
    api.body.append(svg);
  },
  caption: () => modelText('Scores average four held-out cells.', 'Skor dirata-ratakan dari empat sel uji.'),
  table: () => tableEl(['Model', 'RMSE ± SD (pp)', 'MAE (pp)', 'R²'], MODEL_NAMES.map((name) => {
    const r = MODEL_RESULTS[name];
    return [name, `${fmt(r.mean_rmse, 3)} ± ${fmt(r.std_rmse, 3)}`, fmt(r.mean_mae, 3), fmt(r.mean_r2, 3)];
  }), {num: [1, 2, 3], caption: modelText('Four-fold model comparison', 'Perbandingan model empat lipatan')}),
});

figure('modelcurve', {
  state: {model: MODEL_NAMES[0]},
  controls(api) {
    api.controls.append(ctlSelect('Model', MODEL_NAMES.map((name) => [name, name]), api.state.model,
      (name) => { api.state.model = name; api.redraw(); }), ctlBox(modelText('Held-out battery', 'Baterai uji'), batteryChips(false)));
  },
  render(api) {
    const fold = modelFold(api.state.model), W = api.width();
    const f = frame(api.body, {w: W, h: 280, x: extent(fold.cycles, 0.01), y: extent([...fold.y_true, ...fold.y_pred], 0.06),
      xLabel: modelText('Cycle', 'Siklus'), yLabel: 'SoH (%)', xFmt: fmtInt,
      aria: modelText(`${api.state.model}: measured and predicted SoH for held-out ${fold.test_battery}`, `${api.state.model}: SoH terukur dan prediksi untuk sel uji ${fold.test_battery}`)});
    const actual = lineMark(pathD(fold.cycles.map((c, i) => [c, fold.y_true[i]]), f.sx, f.sy), 'var(--fg)', 2);
    const predicted = lineMark(pathD(fold.cycles.map((c, i) => [c, fold.y_pred[i]]), f.sx, f.sy), 'var(--primary)', 2);
    actual.dataset.series = 'actual'; predicted.dataset.series = 'predicted';
    predicted.setAttribute('stroke-dasharray', '6 4');
    f.layer.append(actual, predicted);
    crosshair(f, fold.cycles, fold.y_true, (i) => tipRows(`${fold.test_battery} · ${modelText('cycle', 'siklus')} ${fold.cycles[i]}`,
      [[modelText('Measured', 'Terukur'), `${fmt(fold.y_true[i], 2)}%`], [modelText('Predicted', 'Prediksi'), `${fmt(fold.y_pred[i], 2)}%`],
        [modelText('Error', 'Galat'), `${signed(fold.y_pred[i] - fold.y_true[i], 2)} pp`]]));
    api.body.append(h('div', {class: 'model-legend'}, h('span', {class: 'actual'}, modelText('Measured', 'Terukur')),
      h('span', {class: 'predicted'}, modelText('Predicted', 'Prediksi'))),
    h('div', {class: 'model-metrics'}, h('span', {'data-metric': 'rmse', text: `RMSE ${fmt(fold.metrics.rmse, 3)} pp`}),
      h('span', {'data-metric': 'mae', text: `MAE ${fmt(fold.metrics.mae, 3)} pp`}),
      h('span', {'data-metric': 'r2', text: `R² ${fmt(fold.metrics.r2, 3)}`}), h('span', {text: `n=${fold.n_test}`})));
  },
  caption(api) {
    const fold = modelFold(api.state.model);
    return modelText(`${fold.test_battery} was held out; the model learned from the other three cells.`, `${fold.test_battery} menjadi sel uji; model dilatih memakai tiga sel lainnya.`);
  },
  table(api) {
    const fold = modelFold(api.state.model);
    return tableEl([modelText('Cycle', 'Siklus'), modelText('Measured SoH (%)', 'SoH terukur (%)'),
      modelText('Predicted SoH (%)', 'Prediksi SoH (%)'), modelText('Error (pp)', 'Galat (pp)')],
    fold.cycles.map((c, i) => [c, fmt(fold.y_true[i], 3), fmt(fold.y_pred[i], 3), signed(fold.y_pred[i] - fold.y_true[i])]), {num: [0, 1, 2, 3]});
  },
});
