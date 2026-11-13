/* ===== part 3: page chrome ===== */
const GLOSS = {
  soh: ['State of health (SoH)', 'Measured capacity divided by the 2 Ah reference, times 100. Lower means the cell delivers less charge than a reference cell should.'],
  capacity: ['Capacity', 'The charge, in ampere-hours (Ah), a cell delivers during a full discharge. It is the label that the nine features are compared against.'],
  cycle: ['Cycle (in this analysis)', 'One discharge, together with the charge just before it and the impedance sweep nearest in time.'],
  impedance: ['Impedance sweep', 'A short electrical test that measures how strongly a cell resists current. Its results are Re and Rct.'],
  ccv: ['Constant current, constant voltage', 'The two stages of charging: first a steady current while the voltage climbs, then a steady voltage while the current tapers off.'],
  dqdv: ['Incremental capacity (dQ/dV)', 'Charge gained per volt of voltage rise. Its tallest bump gives two of the nine features.'],
  spearman: ['Spearman ρ', 'A number from -1 to +1 built from ranks. Positive: the two quantities tend to rise together. Negative: one tends to fall as the other rises. Near 0: no consistent rise or fall.'],
  pearson: ['Pearson r', 'Like Spearman, but it measures only straight-line relationships.'],
  vif: ['Variance inflation factor (VIF)', 'How well one feature can be rebuilt from the other features by a straight-line formula. 1 means not at all; larger means more overlap.'],
  mi: ['Mutual information (MI)', 'How much knowing one quantity narrows down another, including curved patterns. It is measured in nats, is not a percentage, and has no sign.'],
  autocorr: ['Autocorrelation and lag', 'How strongly a series resembles itself some number of cycles later. That number of cycles is the lag.'],
  pca: ['Principal component analysis (PCA)', 'A way to draw many-number cycles on a flat map, keeping the directions along which they differ most.'],
  silhouette: ['Silhouette', 'A score from -1 to +1 for how cleanly cycles sit with their own group rather than with the nearest other group.'],
  bootstrap: ['Block bootstrap', 'Re-drawing short runs of neighbouring cycles many times to see how much an estimate would vary, while keeping their order inside each run.'],
  flagged: ['Flagged cycle', 'A cycle whose charge record fails the source pipeline’s screening (t_cc under 100 s or a peak under 0.1 Ah/V).'],
  masked: ['Left blank (masked)', 'Left empty on purpose instead of being filled in, so a missing measurement is never mistaken for a real one.'],
  interpolation: ['Interpolation', 'Filling a missing number with a value estimated from its neighbours.'],
  contract: ['Data contract', 'A written list of rules a dataset must follow, checked by a program that reports every exception.'],
};
$$('.term').forEach((el) => {
  const g = GLOSS[el.dataset.term];
  if (!g) return;
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'note');
  el.setAttribute('aria-label', `${el.textContent}: ${g[1]}`);
  hover(el, () => h('div', null, h('b', { text: g[0] }), h('div', { text: g[1] })));
});
const glossHost = document.getElementById('glossary');
if (glossHost) glossHost.append(h('dl', { class: 'gloss' }, Object.values(GLOSS).flatMap(([t, d]) => [h('dt', { text: t }), h('dd', { text: d })])));

/* ---- theme ---- */
const THEMES = ['auto', 'light', 'dark'];
let theme = 'auto';
try { theme = THEMES.includes(localStorage.getItem('explainer-theme')) ? localStorage.getItem('explainer-theme') : 'auto'; } catch (error) { /* storage can be blocked */ }
function applyTheme() {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = theme;
  $$('[data-theme-btn]').forEach((b) => { b.textContent = `Theme: ${theme}`; });
}
$$('[data-theme-btn]').forEach((b) => b.addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try { localStorage.setItem('explainer-theme', theme); } catch (error) { /* ignore */ }
  applyTheme();
}));
applyTheme();

/* ---- battery selectors (the one page-wide choice) ---- */
$$('select[data-battery-select]').forEach((sel) => {
  sel.replaceChildren(...['ALL', ...BAT].map((b) => h('option', { value: b, text: bLabel(b) })));
  sel.value = S.battery;
  sel.addEventListener('change', () => setBattery(sel.value));
});

/* ---- mobile navigation mirrors the rail ---- */
const railList = $('.rail nav ol'), mobileNav = $('.topbar details nav');
if (railList && mobileNav) {
  for (const li of $$('li', railList)) {
    const a = $('a', li);
    if (a) { const copy = a.cloneNode(true); copy.addEventListener('click', () => { const d = $('.topbar details'); if (d) d.open = false; }); mobileNav.append(copy); }
    else mobileNav.append(h('div', { class: 'part-label', text: li.textContent }));
  }
}

/* ---- table of contents follows the reader ---- */
const spyLinks = new Map($$('.rail nav a').map((a) => [a.getAttribute('href').slice(1), a]));
const spy = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    spyLinks.forEach((a) => a.removeAttribute('aria-current'));
    const link = spyLinks.get(entry.target.id);
    if (link) link.setAttribute('aria-current', 'true');
  }
}, { rootMargin: '-25% 0px -65% 0px' });
$$('main section[id]').forEach((sec) => spy.observe(sec));

/* ---- downloads ---- */
const dl = document.getElementById('dl-csv');
if (dl) dl.addEventListener('click', () => {
  const lines = [D.cycles.columns.join(',')].concat(D.cycles.rows.map((r) => r.map((v) => (v === null ? '' : v)).join(',')));
  const a = h('a', { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: 'battery-observed-cycles.csv' });
  document.body.append(a); a.click(); a.remove();
});

const versions = document.getElementById('versions');
if (versions) {
  const env = D.meta.environment;
  versions.append(h('li', null, 'Source repository commit ', h('code', { text: D.meta.commit })),
    h('li', null, 'Observed table SHA-256 ', h('code', { text: D.meta.observed_sha256 })),
    h('li', { text: `Analysis environment: numpy ${env.numpy}, pandas ${env.pandas}, scipy ${env.scipy}, matplotlib ${env.matplotlib}` }));
}
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '1'; }));
