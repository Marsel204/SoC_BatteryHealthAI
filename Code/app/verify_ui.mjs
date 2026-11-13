// Browser checks for the combined Data analysis -> Model app.
//
// Usage (this workstation): node Code/app/verify_ui.mjs
// Starts the app on a spare port with the project's .venv, drives it in headless Chromium,
// and compares what is displayed with what the API and the analysis files say. Set APP_URL
// to test an app that is already running. Screenshots and a JSON summary go to Code/app/verification/.
// PYTHON selects the interpreter; otherwise root .venv/bin/python or python3 is used.
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.join(here, 'verification');
await fs.mkdir(out, {recursive: true});

async function loadPlaywright() {
  const candidates = ['playwright',
    '/home/marsel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'];
  for (const spec of candidates) {
    try { return await import(spec); } catch { /* try the next location */ }
  }
  throw new Error('Playwright is not installed here; see the other verify_*.mjs scripts for the workstation path.');
}
const {chromium} = await loadPlaywright();

// ---- app under test -----------------------------------------------------------------------
let server = null;
let base = process.env.APP_URL;
if (!base) {
  const port = process.env.APP_PORT || '8099';
  base = `http://127.0.0.1:${port}`;
  const python = process.env.PYTHON || (await fs.access(path.join(root, '.venv/bin/python')).then(() => path.join(root, '.venv/bin/python'), () => 'python3'));
  server = spawn(python, [path.join(here, 'run.py'), '--port', port],
    {stdio: ['ignore', 'ignore', 'ignore']});
}
async function waitForApp() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/status`)).ok) return; } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The app did not start at ${base}`);
}

const signed = (v) => (v === null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(3));
const steps = [];
const step = async (name, fn) => {
  await fn();
  steps.push(name);
  console.log(`ok  ${name}`);
};

const ALLOWED_EXTERNAL = new Set(['cdn.jsdelivr.net']); // Chart.js and KaTeX, as in the upstream app
const errors = [], external = new Set();
let browser;
try {
  await waitForApp();
  const rel = await (await fetch(`${base}/api/analysis/relationships`)).json();
  const bridge = await (await fetch(`${base}/api/analysis/bridge`)).json();
  const stat = (battery, feature) => rel.stats.find((s) => s.battery_id === battery && s.feature === feature);

  browser = await chromium.launch({executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/.test(m.text() + (m.location().url || ''))) errors.push(m.text());
  });
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== new URL(base).origin) external.add(url.hostname);
  });

  await page.goto(base);
  await page.waitForSelector('#relPlots circle');

  await step('lands on Data analysis > Feature relationships', async () => {
    assert.equal(await page.locator('.view-section.active').getAttribute('id'), 'tab-relationships');
    assert.equal(await page.locator('.primary-btn[aria-pressed="true"]').getAttribute('data-group'), 'analysis');
    const visible = await page.$$eval('.segment-btn:not([hidden])', (b) => b.map((x) => x.dataset.tab));
    assert.deepEqual(visible, ['tab-relationships', 'tab-clusters', 'tab-dataset', 'tab-cycles', 'tab-report']);
    assert.equal(await page.locator('#carryover').isVisible(), false);
  });

  await step('every scatter panel and table cell matches the API, for all five battery selections', async () => {
    const batteries = ['ALL', ...rel.batteries];
    for (const battery of batteries) {
      await page.selectOption('#relBattery', battery);
      const rows = rel.rows.filter((r) => battery === 'ALL' || r[0] === battery).length;
      assert.match(await page.locator('#relCoverage').innerText(), new RegExp(`^${rows} cycles`));
      assert.equal(await page.locator('#relLegend span').count(), battery === 'ALL' ? 4 : 1);
      assert.equal(await page.locator('#rhoTable th.col-selected').innerText(), battery === 'ALL' ? 'All batteries' : battery);
      for (const [i, feature] of rel.features.entries()) {
        const s = stat(battery, feature.key);
        assert.equal(await page.locator(`#relStat-${i}`).innerText(),
          `${feature.key} · n=${s.n_pairs} · r ${signed(s.pearson_r)} · ρ ${signed(s.spearman_rho)}`);
        assert.equal(await page.locator(`#relPlot-${i} circle`).count(), s.n_pairs);
      }
    }
    const header = await page.$$eval('#rhoTable thead th', (h) => h.length);
    assert.equal(header, 6);
    for (const [r, feature] of rel.features.entries()) {
      for (const [c, column] of batteries.entries()) {
        const cell = await page.locator(`#rhoTable tbody tr:nth-child(${r + 1}) td:nth-child(${c + 2})`).innerText();
        assert.equal(cell, signed(stat(column, feature.key).spearman_rho));
      }
    }
  });

  await step('log scale changes only the discharge-interval axis', async () => {
    await page.selectOption('#relBattery', 'ALL');
    const last = rel.features.length - 1;
    // SVG elements have textContent but no innerText.
    assert.doesNotMatch(await page.locator(`#relPlot-${last}`).textContent(), /log\(1\+x\)/);
    await page.check('#relLog');
    assert.match(await page.locator(`#relPlot-${last}`).textContent(), /log\(1\+x\)/);
    assert.doesNotMatch(await page.locator('#relPlot-0').textContent(), /log\(1\+x\)/);
    await page.uncheck('#relLog');
  });
  await page.screenshot({path: path.join(out, 'data-analysis-relationships.png'), fullPage: false});

  await step('Clusters and Audit report load, follow the dark theme, and keep their own content', async () => {
    await page.click('.segment-btn[data-tab="tab-clusters"]');
    const clusters = page.frameLocator('#frameClusters');
    await clusters.locator('#coverage').waitFor();
    assert.match(await clusters.locator('#coverage').innerText(), /627 of 632/);
    await page.click('.segment-btn[data-tab="tab-report"]');
    const report = page.frameLocator('#frameReport');
    await report.locator('h1').waitFor();
    for (const id of ['frameClusters', 'frameReport']) {
      const scheme = await page.$eval(`#${id}`, (f) => f.contentDocument.documentElement.style.colorScheme);
      assert.equal(scheme, 'dark');
    }
  });

  await step('Dataset Explorer and Cycle Telemetry still work inside the Data analysis step', async () => {
    await page.click('.segment-btn[data-tab="tab-dataset"]');
    await page.waitForFunction(() => document.querySelectorAll('#tab-dataset tbody tr').length === 50);
    await page.click('.segment-btn[data-tab="tab-cycles"]');
    assert.ok((await page.locator('#tab-cycles canvas').first().boundingBox()).width > 200);
  });

  await step('"Go to Model" hands over to the Model step with the notes from the analysis', async () => {
    await page.click('.segment-btn[data-tab="tab-relationships"]');
    await page.locator('.next-step button').click();
    assert.equal(await page.locator('.view-section.active').getAttribute('id'), 'tab-simulator');
    assert.equal(await page.locator('.primary-btn[aria-pressed="true"]').getAttribute('data-group'), 'model');
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    assert.equal(await page.locator('.next-step').isVisible(), false);
    await page.waitForFunction(() => document.getElementById('carryoverCount').textContent === '4 notes');
    await page.click('#carryover summary');
    assert.equal(await page.locator('#carryoverList li').count(), 4);
    assert.equal(await page.locator('#bridgeTable tbody tr').count(), rel.features.length);
    assert.equal(await page.locator('#bridgeTable td.dir-opposite').count(), bridge.opposite.length);
    const weights = await page.locator('#carryoverList li').nth(3).innerText();
    for (const key of bridge.opposite) assert.ok(weights.includes(key), key);
    await page.screenshot({path: path.join(out, 'model-from-the-data-analysis.png'), fullPage: false});
    await page.click('#carryover summary');
  });

  await step('the simulator shows what /api/predict returns', async () => {
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/predict') && r.request().method() === 'POST'),
      page.click('.preset-pill[data-preset="near_eol"]'),
    ]);
    const body = await response.json();
    await page.waitForFunction((gpr) => document.getElementById('pred-GPR').textContent === `${gpr.toFixed(2)}%`,
      body.predictions.GPR);
    for (const model of ['Ridge', 'ElasticNet', 'SVR', 'GPR', 'XGBoost']) {
      assert.equal(await page.locator(`#pred-${model}`).innerText(), `${body.predictions[model].toFixed(2)}%`);
    }
    assert.ok((await page.locator('#jacobianChart').boundingBox()).width > 300);
  });

  await step('Validation and Methodology views render their tables and charts', async () => {
    await page.click('.segment-btn[data-tab="tab-benchmark"]');
    assert.equal(await page.locator('#tab-benchmark table tbody tr').count(), 5);
    await page.click('.segment-btn[data-tab="tab-methodology"]');
    await page.waitForTimeout(500);
    const widths = await page.$$eval('#tab-methodology canvas', (c) => c.map((x) => x.getBoundingClientRect().width));
    assert.ok(widths.length >= 4 && widths.every((w) => w > 200), JSON.stringify(widths));
  });

  await step('the URL hash selects a view, and the Back link returns to the analysis', async () => {
    await page.goto(`${base}/#tab-benchmark`);
    await page.waitForSelector('#tab-benchmark.active');
    assert.equal(await page.locator('.primary-btn[aria-pressed="true"]').getAttribute('data-group'), 'model');
    await page.evaluate(() => { location.hash = '#tab-relationships'; });
    await page.waitForSelector('#tab-relationships.active');
    assert.equal(await page.locator('.primary-btn[aria-pressed="true"]').getAttribute('data-group'), 'analysis');
  });

  await step('no page overflows horizontally at phone width', async () => {
    const phone = await browser.newPage({viewport: {width: 390, height: 844}});
    phone.on('pageerror', (e) => errors.push(String(e)));
    await phone.goto(base);
    await phone.waitForSelector('#relPlots circle');
    for (const tab of ['tab-relationships', 'tab-clusters', 'tab-dataset', 'tab-cycles', 'tab-report',
      'tab-simulator', 'tab-benchmark', 'tab-methodology']) {
      await phone.evaluate((t) => window.AppNav.activate(t), tab);
      await phone.waitForTimeout(tab === 'tab-clusters' || tab === 'tab-report' ? 1200 : 400);
      const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(overflow, 0, `${tab} overflows by ${overflow}px`);
    }
    await phone.evaluate(() => window.AppNav.activate('tab-relationships'));
    await phone.screenshot({path: path.join(out, 'data-analysis-phone.png')});
    await phone.close();
  });

  await step('only the upstream CDN is contacted, and nothing logs an error', async () => {
    const unexpected = [...external].filter((host) => !ALLOWED_EXTERNAL.has(host));
    assert.deepEqual(unexpected, []);
    assert.deepEqual(errors, []);
  });

  await fs.writeFile(path.join(out, 'ui_verification.json'), JSON.stringify({
    app: base, checked: steps, external_hosts: [...external], console_errors: errors,
  }, null, 2) + '\n');
  console.log(`\n${steps.length} checks passed. Screenshots and summary: ${path.relative(root, out)}/`);
} catch (error) {
  console.error(`\nFAILED after ${steps.length} passing checks:\n${error.stack || error}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
}
