import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '/home/marsel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),out=path.join(root,'verification');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));
const url='file://'+path.resolve(root,'../../../Web/HTML/learning/index.html');
const assert=(ok,message)=>{if(!ok)throw Error(message);};
async function open(hash){await page.goto('about:blank');await page.goto(url+'#'+hash);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(160);assert(await page.locator('[aria-current="step"]').getAttribute('data-lesson')===String(['contracts','autocorrelation','mutual_information','feature_overlap','coverage','uncertainty'].indexOf(hash)),'Requested lesson did not load');}
async function check(id,fn){try{checks.push({id,status:'pass',evidence:await fn()});}catch(e){checks.push({id,status:'fail',reason:String(e)});}}
async function selectedVisible(){return page.evaluate(()=>{const n=document.getElementById('lessons'),a=n.querySelector('[aria-current="step"]'),nr=n.getBoundingClientRect(),ar=a.getBoundingClientRect();return{visible:ar.left>=nr.left-1&&ar.right<=nr.right+1,scroll:n.scrollLeft,vertical:scrollY,focused:document.activeElement.id};});}

await check('M1_selected_mobile_lesson_visible',async()=>{
 await open('uncertainty');let pos=await selectedVisible();assert(pos.visible,'Lesson 6 is outside the mobile strip');
 await open('autocorrelation');await page.locator('#next').click();await page.locator('#next').click();pos=await selectedVisible();assert(pos.visible,'Next progression hides the selected lesson');assert(pos.focused==='lesson','Lesson focus was lost');
 const before=pos;await page.locator('#feature').selectOption('dq_dv_peak');pos=await selectedVisible();assert(pos.visible&&Math.abs(pos.scroll-before.scroll)<2,'An unrelated filter resets the strip');assert(Math.abs(pos.vertical-before.vertical)<2,'An unrelated filter moved the document');
 await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(160);await open('uncertainty');await page.setViewportSize({width:390,height:844});await page.waitForTimeout(180);pos=await selectedVisible();assert(pos.visible,'Entering mobile layout hides the selected lesson');
 return{deep_link:true,next_progression:true,filter_position_retained:true,resize:true};
});
await check('M2_scale_annotation_fits',async()=>{
 const evidence=[];
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});await open('coverage');await page.locator('#feature').selectOption('rest_time_hours');
  const bounds=await page.evaluate(()=>{const svg=document.querySelector('#plot svg'),s=svg.getBoundingClientRect();return[...svg.querySelectorAll('text')].filter(t=>/Interval between discharges|log\(1\+x\)/.test(t.textContent)).map(t=>{const r=t.getBoundingClientRect();return{text:t.textContent,left:r.left-s.left,right:s.right-r.right,top:r.top-s.top,bottom:s.bottom-r.bottom};});});
  assert(bounds.some(b=>b.text.includes('Interval between discharges (h)')),'Measurement name/hours unit is missing');assert(bounds.some(b=>b.text.includes('log(1+x)')),'Scale transformation is missing');
  assert(bounds.every(b=>b.left>=0&&b.right>=0&&b.top>=0&&b.bottom>=0),`${width}px annotation is clipped: ${JSON.stringify(bounds)}`);
  evidence.push({width,bounds});
 }
 return evidence;
});
await check('M3_scatter_mark_contrast',async()=>{
 await page.setViewportSize({width:1440,height:1000});await open('mutual_information');
 await page.mouse.move(0,0);
 const evidence=[];
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.style.colorScheme=theme,theme);await page.waitForTimeout(180);
  const result=await page.evaluate(()=>{const dot=document.querySelector('#plot circle'),rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),style=getComputedStyle(dot),fg=rgb(style.fill),bg=rgb(getComputedStyle(document.querySelector('.chart-section')).backgroundColor),alpha=Number(style.opacity),mixed=fg.map((v,i)=>v*alpha+bg[i]*(1-alpha)),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0),a=lum(mixed),b=lum(bg);return{opacity:alpha,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
  assert(result.ratio>=3,`${theme} scatter contrast is ${result.ratio.toFixed(2)}:1`);evidence.push({theme,...result});
 }
 return evidence;
});
if(!checks.some(c=>c.status==='fail')){
 await page.setViewportSize({width:390,height:844});await open('uncertainty');await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'refined-selected-mobile.png'),fullPage:true});
 await page.setViewportSize({width:320,height:844});await open('coverage');await page.locator('#feature').selectOption('rest_time_hours');await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'refined-scale-320.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await open('mutual_information');await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'refined-scatter.png'),fullPage:true});
 await open('autocorrelation');await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'refined-desktop.png'),fullPage:true});
}
const report={checks,console_errors:errors};await fs.writeFile(path.join(out,'visual_review_regressions.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await browser.close();if(checks.some(c=>c.status==='fail')||errors.length)process.exitCode=1;
