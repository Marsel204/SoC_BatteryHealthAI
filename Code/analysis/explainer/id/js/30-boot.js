/* ===== part 3: page chrome ===== */
const GLOSS = {
  soh: ['Kesehatan baterai (SoH)', 'Kapasitas terukur dibagi kapasitas acuan 2 Ah, lalu dikalikan 100. Nilai lebih rendah berarti sel memasok lebih sedikit muatan dibandingkan acuan.'],
  capacity: ['Kapasitas', 'Muatan listrik dalam ampere-jam (Ah) yang dapat diberikan sel selama pengosongan penuh. Kapasitas menjadi nilai acuan untuk membandingkan kesembilan fitur.'],
  cycle: ['Siklus (dalam analisis ini)', 'Satu pengosongan, dipasangkan dengan pengisian tepat sebelumnya dan pengukuran impedansi yang waktunya paling dekat.'],
  impedance: ['Pengukuran impedansi', 'Pengujian listrik singkat untuk mengukur hambatan sel terhadap arus. Hasilnya berupa Re dan Rct.'],
  ccv: ['Arus konstan, tegangan konstan', 'Dua tahap pengisian: mula-mula arus tetap saat tegangan naik, lalu tegangan tetap saat arus menurun.'],
  dqdv: ['Kapasitas inkremental (dQ/dV)', 'Tambahan muatan untuk setiap kenaikan satu volt. Puncak tertingginya menghasilkan dua dari sembilan fitur.'],
  spearman: ['Spearman ρ', 'Nilai dari -1 hingga +1 yang dihitung dari peringkat. Positif: kedua besaran cenderung naik bersama. Negatif: yang satu cenderung turun saat yang lain naik. Mendekati 0: tidak ada kecenderungan naik atau turun yang konsisten.'],
  pearson: ['Pearson r', 'Seperti Spearman, tetapi hanya mengukur hubungan berbentuk garis lurus.'],
  vif: ['Faktor inflasi varians (VIF)', 'Seberapa baik satu fitur dapat direkonstruksi dari fitur lainnya dengan rumus garis lurus. Nilai 1 berarti tidak dapat; semakin besar berarti semakin banyak informasi yang tumpang tindih.'],
  mi: ['Informasi bersama (MI)', 'Seberapa banyak informasi tentang satu besaran membantu mempersempit kemungkinan nilai besaran lain, termasuk pola melengkung. Satuannya nat, bukan persentase, dan tidak memiliki tanda positif atau negatif.'],
  autocorr: ['Autokorelasi dan lag', 'Seberapa mirip suatu deret dengan dirinya sendiri beberapa siklus kemudian. Jarak dalam siklus tersebut disebut lag.'],
  pca: ['Analisis komponen utama (PCA)', 'Cara menampilkan siklus dengan banyak fitur pada peta datar, sambil mempertahankan arah perbedaan terbesar antarsiklus.'],
  silhouette: ['Silhouette', 'Skor dari -1 hingga +1 yang menunjukkan seberapa jelas siklus berada di kelompoknya sendiri dibandingkan kelompok lain yang paling dekat.'],
  bootstrap: ['Bootstrap blok', 'Mengambil ulang potongan pendek siklus yang berdekatan berkali-kali untuk melihat variasi estimasi, sambil menjaga urutan di dalam setiap potongan.'],
  flagged: ['Siklus bermasalah', 'Siklus yang catatan pengisiannya tidak lolos penyaringan pada kode sumber (t_cc di bawah 100 detik atau puncak di bawah 0,1 Ah/V).'],
  masked: ['Dibiarkan kosong (masking)', 'Nilai sengaja dikosongkan agar pengukuran yang hilang tidak dianggap sebagai hasil pengukuran nyata.'],
  interpolation: ['Interpolasi', 'Mengisi nilai yang hilang dengan perkiraan berdasarkan nilai di sekitarnya.'],
  contract: ['Kontrak data', 'Daftar tertulis aturan yang harus dipenuhi kumpulan data, diperiksa oleh program yang melaporkan setiap pengecualian.'],
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
  $$('[data-theme-btn]').forEach((b) => { b.textContent = `Tema: ${{auto: 'otomatis', light: 'terang', dark: 'gelap'}[theme]}`; });
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

/* ---- three primary views, with keyboard and deep-link navigation ---- */
const viewButtons = $$('[data-view-tab]');
const viewPanels = $$('[data-view-panel]');
function activateView(view, updateHash = false) {
  if (!viewPanels.some((panel) => panel.dataset.viewPanel === view)) view = 'processing';
  viewPanels.forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  viewButtons.forEach((button) => {
    const active = button.dataset.viewTab === view;
    button.id ||= `tab-${button.dataset.viewTab}`;
    button.setAttribute('aria-selected', String(active));
    button.setAttribute('tabindex', active ? '0' : '-1');
    button.setAttribute('aria-controls', button.dataset.viewTab);
    const panel = document.getElementById(button.dataset.viewTab);
    if (panel) panel.setAttribute('aria-labelledby', button.id);
  });
  $$('[data-view-link]').forEach((link) => {
    if (link.dataset.viewLink === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  figs.forEach((fig) => fig.redraw());
  if (updateHash) {
    try { history.replaceState(null, '', `#${view}`); } catch { location.hash = view; }
    $('.view-tabs').scrollIntoView({block: 'start', behavior: 'instant'});
  }
}
viewButtons.forEach((button, i) => {
  button.addEventListener('click', () => activateView(button.dataset.viewTab, true));
  button.addEventListener('keydown', (event) => {
    const next = event.key === 'ArrowRight' ? (i + 1) % viewButtons.length
      : event.key === 'ArrowLeft' ? (i + viewButtons.length - 1) % viewButtons.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? viewButtons.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); viewButtons[next].focus(); activateView(viewButtons[next].dataset.viewTab, true);
  });
});
$$('[data-view-link]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault(); activateView(link.dataset.viewLink, true);
}));
function followHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const target = document.getElementById(id);
  const panel = target && target.closest('[data-view-panel]');
  activateView(panel ? panel.dataset.viewPanel : 'processing');
  if (target) {
    for (let node = target; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
  }
}
window.addEventListener('hashchange', followHash);
followHash();

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
  versions.append(h('li', null, 'Commit repositori sumber ', h('code', { text: D.meta.commit })),
    h('li', null, 'SHA-256 tabel teramati ', h('code', { text: D.meta.observed_sha256 })),
    h('li', { text: `Lingkungan analisis: numpy ${env.numpy}, pandas ${env.pandas}, scipy ${env.scipy}, matplotlib ${env.matplotlib}` }));
}
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '1'; }));
