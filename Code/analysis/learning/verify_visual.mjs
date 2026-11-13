import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '/home/marsel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const out=path.join(root,'verification');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],network=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
await page.goto('file://'+path.resolve(root,'../../../Web/HTML/learning/index.html'));
await page.evaluate(()=>document.fonts.ready);
const font=await page.evaluate(()=>({family:getComputedStyle(document.body).fontFamily,loaded:document.fonts.check('600 14px Manrope')}));
if(!font.loaded||!font.family.startsWith('Manrope'))throw Error('Offline font did not load');
const states=[];
for(const width of [320,390,768,1024,1280,1440]){
 await page.setViewportSize({width,height:1000});await page.waitForTimeout(180);
 for(const view of ['lessons','dataset']){
  await page.getByRole('tab',{name:view==='lessons'?'Lessons':'Dataset',exact:true}).click();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error(`${width}/${view} page overflows`);
  states.push({width,view,overflow:false});
 }
}
await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(180);
const contrast=[];
for(const theme of ['light','dark']){
 await page.evaluate(theme=>document.documentElement.style.colorScheme=theme,theme);
 for(const view of ['lessons','dataset']){
  await page.getByRole('tab',{name:view==='lessons'?'Lessons':'Dataset',exact:true}).click();
  await page.waitForTimeout(190);
  const scan=await page.evaluate(()=>{
   const rgba=s=>{if(!/^rgba?\(/.test(s))return null;const c=s.match(/[\d.]+/g)?.map(Number);return c?.length>=3?[...c.slice(0,3),c[3]??1]:null;};
   const background=e=>{if(!e)return[255,255,255];const under=background(e.parentElement),c=rgba(getComputedStyle(e).backgroundColor);return c?c.slice(0,3).map((v,i)=>v*c[3]+under[i]*(1-c[3])):under;};
   const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
   const records=[];
   for(const e of document.querySelectorAll('body *')){
    if(!e.getClientRects().length||e.matches('script,style,option,:disabled')||e.closest('[hidden],button:disabled,select:disabled'))continue;
    if(![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&!e.matches('input,select'))continue;
    const css=getComputedStyle(e),bg=background(e),color=rgba(e instanceof SVGElement?css.fill:css.color);if(!color)continue;
    const fg=color.slice(0,3).map((v,i)=>v*color[3]+bg[i]*(1-color[3]));
    const a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05),size=parseFloat(css.fontSize),threshold=size>=24||size>=18.66&&parseFloat(css.fontWeight)>=700?3:4.5;
    if(ratio<threshold-.05)records.push({text:e.textContent.trim().slice(0,65),ratio:Number(ratio.toFixed(2)),threshold});
   }
   return records;
  });
  contrast.push({theme,view,low_contrast:scan});
 }
}
if(contrast.some(s=>s.low_contrast.length))throw Error(JSON.stringify(contrast));
await page.evaluate(()=>document.documentElement.style.colorScheme='light');
await page.getByRole('tab',{name:'Lessons',exact:true}).click();
await page.locator('[data-lesson="1"]').click();await page.locator('#feature').selectOption('capacity');
await page.screenshot({path:path.join(out,'refined-desktop.png'),fullPage:true});
await page.getByRole('tab',{name:'Dataset',exact:true}).click();await page.screenshot({path:path.join(out,'refined-dataset.png'),fullPage:true});
await page.setViewportSize({width:390,height:844});await page.waitForTimeout(180);await page.screenshot({path:path.join(out,'refined-dataset-mobile.png'),fullPage:true});
await page.getByRole('tab',{name:'Lessons',exact:true}).click();await page.screenshot({path:path.join(out,'refined-mobile.png'),fullPage:true});
await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(180);await page.evaluate(()=>document.documentElement.style.colorScheme='dark');
await page.waitForTimeout(190);
await page.screenshot({path:path.join(out,'refined-dark.png'),fullPage:true});
if(network.length||errors.length)throw Error(JSON.stringify({network,errors}));
const report={font,states,contrast,network_requests:network,console_errors:errors};
await fs.writeFile(path.join(out,'visual_checks.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
await browser.close();
