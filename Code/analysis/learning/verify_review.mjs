import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '/home/marsel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const results=[];
async function check(id,fn){try{await fn();results.push({id,status:'pass'});}catch(e){results.push({id,status:'fail',reason:String(e)});}}
function assert(ok,message){if(!ok)throw Error(message);}
await page.goto('file://'+path.resolve(root,'../../../Web/HTML/learning/index.html'));

await check('F1_distinct_coverage_ticks',async()=>{
 await page.locator('[data-lesson="4"]').click();
 for(const mode of ['stages','batteries'])for(const feature of ['capacity','v_at_peak','Re','Rct']){
  await page.locator('#coverage-mode').selectOption(mode);await page.locator('#feature').selectOption(feature);
  const ticks=await page.locator('#plot svg text[y="246"]').allTextContents();
  assert(ticks.length===5&&new Set(ticks).size===5,`${feature}/${mode}: repeated ticks ${ticks}`);
 }
});
await check('F2_mobile_next_scrolls_to_new_lesson',async()=>{
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(160);
 await page.locator('[data-lesson="1"]').click();await page.locator('#next').click();
 const pos=await page.locator('#question').boundingBox();
 assert(pos.y>=0&&pos.y<422,`New lesson question is offscreen: y=${pos.y}`);
 assert(await page.locator('#lesson').evaluate(el=>el===document.activeElement),'New lesson did not receive focus');
});
await check('F3_visible_series_counts',async()=>{
 await page.locator('[data-lesson="1"]').click();await page.locator('#battery').selectOption('B0005');await page.locator('#feature').selectOption('t_cc');
 await page.locator('#lag-mode').selectOption('difference');
 let caption=await page.locator('#sample-count').innerText();assert(caption.includes('162')&&caption.includes('change'),`Wrong change-only count: ${caption}`);
 await page.locator('#lag-mode').selectOption('both');caption=await page.locator('#sample-count').innerText();assert(caption.includes('164')&&caption.includes('162'),`Missing both counts: ${caption}`);
 await page.locator('#details summary').click();assert(await page.locator('#method table').count()>0,'No accessible per-lag counts');
});
await check('F4_keyboard_focus_retained',async()=>{
 await page.locator('[data-lesson="2"]').click();await page.locator('#neighbors').selectOption('3');await page.locator('#neighbors').focus();
 await page.keyboard.press('ArrowDown');assert(await page.locator('#neighbors').evaluate(el=>el===document.activeElement),'Method select lost focus');
 await page.keyboard.press('ArrowDown');assert(await page.locator('#neighbors').evaluate(el=>el===document.activeElement),'Repeated method change lost focus');
 for(const answer of ['0','1']){await page.locator(`[data-answer="${answer}"]`).focus();await page.keyboard.press('Space');assert(await page.locator(`[data-answer="${answer}"]`).evaluate(el=>el===document.activeElement),'Quiz button lost focus');}
});
await check('F5_stage_headline_uses_early_reference',async()=>{
 await page.locator('[data-lesson="4"]').click();await page.locator('#battery').selectOption('B0005');await page.locator('#feature').selectOption('capacity');await page.locator('#coverage-mode').selectOption('stages');
 const text=await page.locator('#interpretation').innerText();assert(text.includes('55 of 55')&&text.includes('early'),`Wrong stage reference: ${text}`);
 await page.locator('#coverage-mode').selectOption('batteries');assert((await page.locator('#interpretation').innerText()).includes('other'), 'Missing other-cell comparison');
});
await check('F6_beginner_definitions_visible',async()=>{
 await page.locator('[data-lesson="1"]').click();assert((await page.locator('#interpretation').innerText()).includes('−1'),'Correlation direction definition missing');
 await page.locator('[data-lesson="2"]').click();assert((await page.locator('#lesson-control').innerText()).includes('measurement values'),'MI value-neighbor definition missing');
 await page.locator('[data-lesson="5"]').click();assert((await page.locator('#interpretation').innerText()).includes('coverage'),'Uncertainty coverage limitation missing');
});
await fs.writeFile(path.join(root,'verification/review_regressions.json'),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results));await browser.close();if(results.some(r=>r.status==='fail'))process.exitCode=1;
