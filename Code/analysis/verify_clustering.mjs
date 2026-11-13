// Numerical display and behavior checks for the offline clustering report.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from '/home/marsel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const out=path.join(root,'verification','clustering');
const web=path.resolve(root,'../../Web/HTML');
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:'light'});
const errors=[],external=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
try{
 await page.goto('file://'+path.join(web,'clustering.html'));
 await page.waitForSelector('#map circle.point');
 assert.equal(await page.locator('#map circle.point').count(),627);
 assert.match(await page.locator('#coverage').innerText(),/627 of 632/);
 const display=await page.evaluate(()=>{
  const set=(id,value)=>{document.getElementById(id).value=value;document.getElementById(id).dispatchEvent(new Event('change',{bubbles:true}));};
  const finite=()=>{for(const node of document.querySelectorAll('svg [cx],svg [cy],svg rect'))for(const key of ['cx','cy','x','y','width','height'])if(node.hasAttribute(key)&&!Number.isFinite(Number(node.getAttribute(key))))throw Error('Nonfinite SVG '+key);};
  let cycleFits=0,featureFits=0;
  for(const battery of ['ALL',...D.batteries]){
   set('battery',battery);
   for(const variant of ['all','without_interval']){
    const toggle=document.getElementById('interval');toggle.checked=variant==='all';toggle.dispatchEvent(new Event('change',{bubbles:true}));
    for(let k=2;k<=6;k++){
     set('k',String(k));const f=D.scopes[battery][variant],c=f.cuts[String(k)];
     if(document.querySelectorAll('#map circle.point').length!==f.indices.length)throw Error('Wrong point count');
     if(document.querySelectorAll('#summary tr').length!==k)throw Error('Wrong group count');
     for(const [i,row]of [...document.querySelectorAll('#summary tr')].entries()){
      const cells=row.querySelectorAll('td');if(Number(cells[1].textContent)!==c.groups[i].n)throw Error('Wrong displayed cluster size');
      if(!cells[2].textContent.startsWith(c.groups[i].soh_mean.toFixed(1)+'%'))throw Error('Wrong displayed mean SoH');
     }
     if(document.querySelectorAll('#profiles rect[role=button]').length!==k*f.features.length)throw Error('Missing profile values');
     finite();cycleFits++;
    }
   }
  }
  document.getElementById('features-tab').click();
  for(const battery of ['ALL',...D.batteries]){
   set('battery',battery);
   for(const variant of ['all','without_interval']){
    const toggle=document.getElementById('interval');toggle.checked=variant==='all';toggle.dispatchEvent(new Event('change',{bubbles:true}));
    for(let k=2;k<=5;k++){
     set('feature-k',String(k));const f=D.scopes[battery][variant];
     if(document.querySelectorAll('#feature-map rect[role=button]').length!==f.features.length**2)throw Error('Missing correlation cells');
     if(document.querySelectorAll('#feature-groups p').length!==k)throw Error('Wrong feature group count');
     const expected=[...new Set(f.feature_order.map(i=>f.feature_cuts[String(k)][i]))];
     if(expected.some((v,i)=>v!==i))throw Error('Feature download labels differ from displayed order');
     finite();featureFits++;
    }
   }
  }
  return{cycleFits,featureFits};
 });
 await page.locator('#battery').selectOption('ALL');await page.locator('#interval').check();
 await page.locator('#feature-k').selectOption('4');
 const inverse=page.locator('#feature-map rect[role=button]').filter({has:page.locator('title')});
 await inverse.first().focus();await page.keyboard.press('Enter');
 assert.ok((await page.locator('#pair-detail').innerText()).length>40);
 await page.locator('#features-tab').focus();await page.keyboard.press('ArrowLeft');
 assert.equal(await page.locator('#cycles-tab').getAttribute('aria-selected'),'true');
 await page.locator('#k').selectOption('3');
 for(const color of ['battery','soh','cluster']){await page.locator('#color').selectOption(color);assert.ok(await page.locator('#legend').innerText());}
 await page.locator('#range').selectOption('central');
 assert.match(await page.locator('#variance').innerText(),/cycles lie outside this cropped view/);
 assert.equal(await page.locator('#map circle.point').count(),627);
 await page.locator('#range').selectOption('all');
 await page.locator('#inspect').selectOption('0');
 assert.match(await page.locator('#cycle-detail').innerText(),/B0005 · cycle 2/);
 await page.locator('#summary [data-group="0"]').click();
 assert.equal(await page.locator('#summary [data-group="0"]').getAttribute('aria-pressed'),'true');
 assert.ok(await page.evaluate(()=>document.activeElement.matches('#summary [data-group="0"]')));
 await page.locator('#summary [data-group="0"]').click();
 await page.locator('#scores [data-k="4"]').click();
 assert.equal(await page.locator('#k').inputValue(),'4');
 await page.locator('#k').selectOption('3');
 let waiting=page.waitForEvent('download');await page.locator('#download').click();let download=await waiting;
 let saved=path.join(out,'cycle-download.csv');await download.saveAs(saved);
 let csv=(await fs.readFile(saved,'utf8')).trimEnd().split(/\r?\n/);
 assert.equal(csv.length,633);assert.equal(csv.filter(line=>line.includes('missing observed charge features')).length,5);
 assert.equal(csv.filter(line=>line.includes('"true"')).length,627);
 await page.locator('#features-tab').click();
 waiting=page.waitForEvent('download');await page.locator('#download').click();download=await waiting;
 saved=path.join(out,'feature-download.csv');await download.saveAs(saved);
 csv=(await fs.readFile(saved,'utf8')).trimEnd().split(/\r?\n/);assert.equal(csv.length,10);
 await page.screenshot({path:path.join(out,'features-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:path.join(out,'features-mobile.png'),fullPage:true});
 await page.locator('#cycles-tab').click();
 for(const width of [320,390,728,1440]){
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(130);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow at ${width}px`);
  if(width!==320)await page.screenshot({path:path.join(out,`cycles-${width}.png`),fullPage:true});
 }
 await page.emulateMedia({colorScheme:'dark'});await page.setViewportSize({width:728,height:1000});await page.waitForTimeout(130);
 await page.screenshot({path:path.join(out,'cycles-dark.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const result={...display,source_rows_retained:632,default_complete_cycles:627,current_downloads_checked:true,keyboard_tabs_and_cells:true,group_highlighting:true,cropped_map_retains_all_assignments:true,viewports_checked:[320,390,728,1440],external_requests:external,console_errors:errors};
 await fs.writeFile(path.join(out,'browser_checks.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}finally{await browser.close();}
