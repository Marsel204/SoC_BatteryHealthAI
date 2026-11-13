// Offline interaction and numerical display checks. Run: node Code/analysis/explainer/verify.mjs [--lang id]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../../../Web/HTML');
const language = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : 'en';
assert.ok(['en', 'id'].includes(language), 'Use --lang en or --lang id.');
const locale = language === 'id' ? 'id-ID' : 'en-US';
const out = path.join(here, 'verification', ...(language === 'id' ? ['id'] : []));
const file = language === 'id' ? 'index-id.html' : 'index.html';
await fs.mkdir(out, {recursive: true});
let playwright;
for (const spec of ['playwright', '/home/marsel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs']) {
  try { playwright = await import(spec); break; } catch { /* workstation fallback */ }
}
assert.ok(playwright, 'Install Playwright to run the browser checks.');
const browser = await playwright.chromium.launch({executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
const errors = [], requests = [], checks = [];
const page = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (['warning', 'error'].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) requests.push(r.url()); });
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const view = async name => { await page.locator(`[data-view-tab="${name}"]`).click(); await settle(); };
const reveal = async locator => {
  await locator.evaluate(el => {
    const panel = el.closest('[data-view-panel]');
    if (panel) document.querySelector(`[data-view-tab="${panel.dataset.viewPanel}"]`).click();
    for (let node = el; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
  });
  await settle();
};
const step = async (name, fn) => { await fn(); checks.push(name); console.log(`ok  ${name}`); };
const signed = x => (x >= 0 ? '+' : '-') + Math.abs(x).toLocaleString(locale, {minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: false});
try {
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(path.join(web, file)).href);
  await page.waitForSelector('html[data-ready="1"]');
  await page.evaluate(() => document.fonts.ready);
  await settle();
  const data = await page.evaluate(() => DATA);

  if (language === 'id') await step('Indonesian version preserves the complete English dataset and all traced numerical values', async () => {
    const english = await fs.readFile(path.join(web, 'index.html'), 'utf8');
    const match = english.match(/<script>const DATA=(.*?);<\/script>/);
    assert.ok(match);
    assert.deepEqual(data, JSON.parse(match[1]));
    assert.equal(await page.locator('html').getAttribute('lang'), 'id');
    assert.match(await page.title(), /baterai/i);
    assert.equal(await page.locator('[data-battery-select] option').first().innerText(), 'Semua baterai');
    await reveal(page.locator('#glossary'));
    assert.match(await page.locator('#glossary').innerText(), /Kesehatan|kesehatan/);
    await page.locator('#appendix').evaluate(el => { el.open = false; }); await settle();
    for (const token of await page.locator('[data-t]').evaluateAll(nodes => nodes.map(n => ({key: n.dataset.t, value: n.dataset.v})))) {
      if (typeof data.tokens[token.key] === 'number') assert.equal(Number(token.value), data.tokens[token.key]);
      else assert.equal(token.value, String(data.tokens[token.key]));
    }
  });

  await step('loads directly from disk offline, all 23 figures and 92 traced numbers render', async () => {
    assert.equal(await page.locator('figure.fig').count(), 23);
    assert.deepEqual(await page.locator('figure.fig .fig-body').evaluateAll(nodes => nodes.filter(n => !n.children.length).map(n => n.parentElement.id)), []);
    assert.equal(Object.keys(data.tokens).length, 92);
    assert.equal(data.cycles.rows.length, 632);
    assert.equal(data.examples.length, 32);
    assert.equal(await page.locator('body').innerText().then(t => /\{\{[^}]+\}\}/.test(t)), false);
    assert.deepEqual(await page.locator('a[href^="#"]').evaluateAll(nodes => nodes.map(n => n.getAttribute('href').slice(1)).filter(id => id && !document.getElementById(id))), []);
  });

  await step('three concise primary views include Models, with keyboard and direct-link navigation', async () => {
    assert.equal(await page.locator('[data-view-tab]').count(), 3);
    assert.equal(await page.locator('[data-view-panel]:visible').getAttribute('id'), 'processing');
    assert.equal(await page.locator('details.advanced[open]').count(), 0);
    assert.ok((await page.locator('body').innerText()).split(/\s+/).length < 750, 'Default view is too verbose');
    await view('models');
    assert.equal(await page.locator('#fig-modelcompare').isVisible(), true);
    assert.equal(await page.locator('#fig-modelcurve').isVisible(), true);
    await page.locator('[data-view-tab="models"]').press('ArrowLeft'); await settle();
    assert.equal(await page.locator('[data-view-panel]:visible').getAttribute('id'), 'analysis');
    await page.locator('[data-view-tab="analysis"]').press('Home'); await settle();
    assert.equal(await page.locator('[data-view-panel]:visible').getAttribute('id'), 'processing');
    await page.goto(pathToFileURL(path.join(web, file)).href + '#models');
    await page.waitForSelector('html[data-ready="1"]'); await settle();
    assert.equal(await page.locator('[data-view-panel]:visible').getAttribute('id'), 'models');
  });

  await step('all battery selections display exact point counts and correlation values', async () => {
    await reveal(page.locator('#fig-scatter'));
    for (const battery of ['ALL', ...data.batteries]) {
      await page.locator('.rail [data-battery-select]').selectOption(battery);
      await settle();
      assert.deepEqual(await page.locator('[data-battery-select]').evaluateAll(nodes => nodes.map(n => n.value)), [battery, battery]);
      const panels = page.locator('#fig-scatter .mini');
      assert.equal(await panels.count(), 9);
      for (const [i, feature] of data.features.entries()) {
        const st = data.stats.find(s => s.battery_id === battery && s.feature === feature);
        assert.equal(await panels.nth(i).locator('g[clip-path] circle').count(), st.n_pairs);
        assert.equal(await panels.nth(i).locator('.stat').innerText(), `${feature} · n=${st.n_pairs} · r ${signed(st.pearson_r)} · ρ ${signed(st.spearman_rho)}`);
      }
      const cells = await page.locator('#fig-rho tbody td.cell').allTextContents();
      const expected = data.features.flatMap(feature => ['ALL', ...data.batteries].map(b => signed(data.stats.find(s => s.battery_id === b && s.feature === feature).spearman_rho)));
      assert.deepEqual(cells, expected);
    }
  });

  await step('all 32 worked cycles and three extraction steps work, including flagged empty states', async () => {
    await reveal(page.locator('#fig-explorer'));
    for (const battery of data.batteries) {
      await page.locator('.rail [data-battery-select]').selectOption(battery);
      await settle();
      for (const example of data.examples.filter(e => e.battery === battery)) {
        await page.locator('#fig-explorer [data-example]').selectOption(`${battery}|${example.cycle}`);
        await settle();
        assert.equal(await page.locator('#fig-timeline [data-example]').inputValue(), `${battery}|${example.cycle}`);
        for (const tab of ['charge', 'peak', 'discharge']) {
          await page.locator(`#fig-explorer button[data-v="${tab}"]`).click();
          await settle();
          assert.ok((await page.locator('#fig-explorer .rule-box').innerText()).length > 30);
          assert.equal(await page.locator('#fig-explorer table tbody tr').count(), 9);
          assert.equal(await page.locator('#fig-explorer .flagnote').count(), example.flagged ? 1 : 0);
          if (example.flagged && tab === 'peak') assert.equal(await page.locator('#fig-explorer .empty').count(), 1);
        }
      }
    }
  });

  await step('all five models and twenty held-out curves match independently validated saved results', async () => {
    const saved = JSON.parse(await fs.readFile(path.resolve(web, '../../Reports/model_results.json'), 'utf8'));
    const format = x => x.toLocaleString(locale, {minimumFractionDigits: 3, maximumFractionDigits: 3});
    const order = Object.keys(saved.models).sort((a, b) => saved.models[a].mean_rmse - saved.models[b].mean_rmse);
    await view('models');
    assert.deepEqual(await page.locator('#fig-modelcompare rect[data-model]').evaluateAll(nodes => nodes.map(n => n.dataset.model)), order);
    for (const battery of data.batteries) {
      await page.locator('.rail [data-battery-select]').selectOption(battery); await settle();
      for (const name of order) {
        await page.locator('#fig-modelcurve .fig-controls select').selectOption(name); await settle();
        const fold = saved.models[name].folds.find(f => f.test_battery === battery);
        for (const [metric, label] of [['rmse', 'RMSE'], ['mae', 'MAE'], ['r2', 'R²']]) {
          assert.equal(await page.locator(`#fig-modelcurve [data-metric="${metric}"]`).innerText(), `${label} ${format(fold.metrics[metric])}${metric === 'r2' ? '' : ' pp'}`);
        }
        for (const series of ['actual', 'predicted']) {
          const d = await page.locator(`#fig-modelcurve path[data-series="${series}"]`).getAttribute('d');
          assert.equal(d.match(/[ML]/g).length, fold.n_test);
        }
        await page.locator('#fig-modelcurve details.twin').evaluate(el => { el.open = true; }); await settle();
        assert.equal(await page.locator('#fig-modelcurve .twin-body tbody tr').count(), fold.n_test);
      }
    }
  });

  await step('every table twin populates and every figure control responds without errors', async () => {
    await page.locator('.rail [data-battery-select]').selectOption('ALL');
    await settle();
    await page.locator('details.twin').evaluateAll(nodes => nodes.forEach(n => { n.open = true; }));
    await settle();
    assert.deepEqual(await page.locator('details.twin').evaluateAll(nodes => nodes.filter(n => !n.querySelector('tbody tr')).map(n => n.parentElement.id)), []);
    // Controls live outside the redrawn chart bodies, so these locators remain stable.
    for (const button of await page.locator('figure .fig-controls .seg:not([data-battery]) button').all()) {
      await reveal(button);
      await button.click(); await settle();
    }
    for (const select of await page.locator('figure .fig-controls select:not([data-example])').all()) {
      await reveal(select);
      const values = await select.locator('option').evaluateAll(nodes => nodes.map(n => n.value));
      for (const value of values) { await select.selectOption(value); await settle(); }
    }
    for (const checkbox of await page.locator('figure .fig-controls input[type="checkbox"]').all()) {
      await reveal(checkbox);
      await checkbox.check(); await settle(); await checkbox.uncheck(); await settle();
    }
    await page.locator('details.twin').evaluateAll(nodes => nodes.forEach(n => { n.open = false; }));
    await settle();
  });

  await step('CSV download preserves all rows and missing observations', async () => {
    await reveal(page.locator('#dl-csv'));
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#dl-csv').click();
    const download = await downloadPromise;
    const text = await fs.readFile(await download.path(), 'utf8');
    const lines = text.trimEnd().split('\n');
    assert.equal(lines.length, 633);
    assert.equal(lines[0], data.cycles.columns.join(','));
    assert.deepEqual(lines.slice(1), data.cycles.rows.map(row => row.map(v => v === null ? '' : v).join(',')));
  });

  await step('phone, tablet and desktop layouts fit in both themes, with contained wide tables', async () => {
    for (const width of (language === 'id' ? [360, 390, 768, 1440] : [390, 768, 1440])) {
      await page.setViewportSize({width, height: 1000});
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { localStorage.setItem('explainer-theme', theme); }, theme);
        await page.reload(); await page.waitForSelector('html[data-ready="1"]'); await settle();
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        for (const name of ['processing', 'analysis', 'models']) {
          await view(name);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow at ${width}px ${theme} ${name}`);
        }
        await page.locator('details.twin').evaluateAll(nodes => nodes.forEach(n => { n.open = true; }));
        await settle();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `expanded table overflow at ${width}px ${theme}`);
        await page.locator('details.twin').evaluateAll(nodes => nodes.forEach(n => { n.open = false; }));
        if (width === 390) {
          await view('processing');
          assert.ok(await page.locator('#fig-explorer table.wide').evaluate(t => t.scrollWidth > t.parentElement.clientWidth));
          await page.locator('.topbar details summary').click();
          assert.equal(await page.locator('.topbar details nav a').count(), await page.locator('.rail nav a').count());
          await page.locator('.topbar details nav a[href="#models"]').click();
          assert.equal(await page.locator('.topbar details').getAttribute('open'), null);
          const before = await page.locator('.topbar [data-theme-btn]').innerText();
          await page.locator('.topbar [data-theme-btn]').click(); await settle();
          assert.notEqual(await page.locator('.topbar [data-theme-btn]').innerText(), before);
          await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        }
        if ((width === 390 && theme === 'light') || (width === 1440 && theme === 'dark')) {
          await view('processing');
          await page.evaluate(() => scrollTo(0, 0)); await settle();
          await page.screenshot({path: path.join(out, `${theme}-${width}-hero.png`)});
          await page.locator('#fig-explorer').screenshot({path: path.join(out, `${theme}-${width}-explorer.png`)});
          await view('models');
          await page.locator('#models').screenshot({path: path.join(out, `${theme}-${width}-models.png`)});
        }
      }
    }
  });
  await step('no console errors, warnings, or external requests', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  });
  await fs.writeFile(path.join(out, 'browser_checks.json'), JSON.stringify({passed: true, checks, errors, externalRequests: requests}, null, 2) + '\n');
} finally {
  await browser.close();
}
