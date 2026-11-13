import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '/home/marsel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const out=path.join(root,'verification');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));let interactions=0;
await page.goto('file://'+path.resolve(root,'../../../Web/HTML/learning/index.html'));
await page.waitForSelector('#plot svg');
await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
await page.setViewportSize({width:390,height:844});await page.waitForTimeout(180);
await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))throw Error('Mobile page overflows horizontally');
await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(180);
for(let lesson=0;lesson<6;lesson++){
 await page.locator(`[data-lesson="${lesson}"]`).click();
 if(!await page.locator('#question').innerText())throw Error('Missing lesson heading');
 const count=await page.evaluate(()=>{
  let checked=0;const battery=document.getElementById('battery'),feature=document.getElementById('feature');
  const bs=[...battery.options].map(o=>o.value),fs=[...feature.options].map(o=>o.value);
  for(const b of bs){for(const f of fs){
   const bv=document.getElementById('battery');if(!bv.disabled){bv.value=b;bv.dispatchEvent(new Event('change',{bubbles:true}));}
   const fv=document.getElementById('feature');fv.value=f;fv.dispatchEvent(new Event('change',{bubbles:true}));
   const controls=[...document.querySelectorAll('#lesson-control select')];
   const options=controls.length?[...controls[0].options].map(o=>o.value):[null];
   for(const option of options){
    if(option!==null){const control=document.querySelector('#lesson-control select');control.value=option;control.dispatchEvent(new Event('change',{bubbles:true}));}
    if(!document.getElementById('plot').children.length)throw Error('Blank plot');
    if(!document.getElementById('interpretation').innerText.trim())throw Error('Missing interpretation');
    if(document.getElementById('lesson').innerText.includes('undefined'))throw Error('Undefined UI text');
    const numeric=[...document.querySelectorAll('#plot [cx],#plot [cy],#plot [x1],#plot [x2],#plot [y1],#plot [y2]')];
    for(const node of numeric)for(const attr of ['cx','cy','x1','x2','y1','y2'])if(node.hasAttribute(attr)&&!Number.isFinite(Number(node.getAttribute(attr))))throw Error('Nonfinite SVG '+attr);
    checked++;
   }
  }}return checked;
 });interactions+=count;
 await page.locator('[data-answer="0"]').click();await page.locator('[data-answer="1"]').click();
 if(!await page.locator('#quiz-feedback').innerText())throw Error('Quiz gives no feedback');
}
await page.locator('[data-lesson="2"]').click();await page.locator('#synthetic').click();
if(!await page.locator('#feature').isDisabled())throw Error('Synthetic mode did not disable battery feature input');
if(!(await page.locator('#chart-title').innerText()).includes('curved'))throw Error('Synthetic chart label wrong');
await page.locator('#theme').click();await page.locator('#theme').click();
await page.screenshot({path:path.join(out,'synthetic-dark.png'),fullPage:true});
await page.locator('#synthetic').click();
await page.locator('[data-lesson="5"]').click();await page.locator('#battery').selectOption('B0006');await page.locator('#feature').selectOption('t_cc');await page.locator('#block').selectOption('5');
await page.screenshot({path:path.join(out,'uncertainty.png'),fullPage:true});
await page.locator('#details summary').click();
if(!(await page.locator('#method').innerText()).includes('Longest contiguous run'))throw Error('Missing uncertainty diagnostic scope');
await page.locator('#details summary').click();
await page.locator('[data-lesson="1"]').click();await page.locator('#feature').selectOption('capacity');await page.locator('#theme').click();
const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;
if(!download.suggestedFilename().includes('autocorrelation'))throw Error('Wrong lesson export');
await page.keyboard.press('Tab');
if(errors.length)throw Error(errors.join('\n'));
const result={interactions_checked:interactions,lessons:6,quiz_answers_checked:12,synthetic_mode:true,theme_switch:true,lesson_download:true,mobile_overflow:false,console_errors:errors};
await fs.writeFile(path.join(out,'ui_checks.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
await browser.close();
