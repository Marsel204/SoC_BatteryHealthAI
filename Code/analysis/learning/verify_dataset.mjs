import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from '/home/marsel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),out=path.join(root,'verification');
const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];
p.on('pageerror',e=>errors.push(String(e)));
function assert(value,message){if(!value)throw Error(message);}
const rows=()=>p.locator('#dataset-table tbody tr');
await p.goto('file://'+path.resolve(root,'../../../Web/HTML/learning/index.html'));
await p.getByRole('tab',{name:'Dataset',exact:true}).click();
assert(await p.locator('#dataset-view').isVisible(),'Dataset pane missing');
assert(await p.locator('#learning-view').isHidden(),'Lessons should be hidden');
assert(await rows().count()===25,'Default page size incorrect');
assert((await p.locator('#dataset-count').innerText()).includes('632'),'Total rows incorrect');
assert(await p.locator('#dataset-table thead th').count()===14,'Missing dataset columns');
checks.push('Dataset tab displays 14 columns and 25 of 632 rows.');
await p.screenshot({path:path.join(out,'dataset-desktop.png'),fullPage:true});

for(const [battery,total,flagged]of [['B0005',167,1],['B0006',167,1],['B0007',167,1],['B0018',131,2]]){
 await p.locator('#dataset-battery').selectOption(battery);await p.locator('#dataset-quality').selectOption('all');
 assert((await p.locator('#dataset-count').innerText()).includes(`of ${total} matching`),'Battery count incorrect');
 await p.locator('#dataset-quality').selectOption('flagged');assert(await rows().count()===flagged,'Flagged count incorrect');
 for(const row of await rows().all())assert(await row.locator('.dataset-missing').count()===4,'Flagged charge cells not explicitly missing');
}
checks.push('All four battery counts and five flagged cycles match the source; each flagged cycle has four Missing cells.');
await p.locator('#dataset-clear').click();await p.locator('#dataset-search').fill('B0005 31');
assert(await rows().count()===1,'Combined search should return one row');
assert(await rows().first().getAttribute('data-cycle')==='31','Search found wrong cycle');
assert(await p.locator('#dataset-search').evaluate(el=>el===document.activeElement),'Search lost focus');
await p.locator('#dataset-search').fill('not-a-battery');
assert(await p.locator('#dataset-empty').isVisible(),'No-results explanation missing');
assert((await p.locator('#dataset-page').innerText())==='Page 0 of 0','Empty pagination incorrect');
await p.locator('#dataset-clear').click();
checks.push('Exact battery/cycle search, typing focus and empty-state recovery work.');

await p.locator('#dataset-size').selectOption('50');assert(await rows().count()===50,'Page-size selection incorrect');
await p.locator('#dataset-next').click();assert(await rows().first().getAttribute('data-cycle')==='52','Next page repeats or skips rows');
await p.locator('#dataset-last').click();assert(await rows().count()===32,'Last page incorrect');
assert(await p.locator('#dataset-next').isDisabled(),'Last page Next should be disabled');
await p.locator('#dataset-first').click();assert(await p.locator('#dataset-prev').isDisabled(),'First page Previous should be disabled');
checks.push('Page size, first/last and previous/next boundaries work.');

await p.locator('#dataset-sort-capacity').click();
let values=(await p.locator('#dataset-table [data-column="capacity"]').allTextContents()).map(Number);
assert(values.every((v,i)=>!i||v>=values[i-1]),'Capacity not sorted numerically ascending');
await p.locator('#dataset-sort-capacity').click();
values=(await p.locator('#dataset-table [data-column="capacity"]').allTextContents()).map(Number);
assert(values.every((v,i)=>!i||v<=values[i-1]),'Capacity not sorted numerically descending');
await p.locator('#dataset-sort-t_cc').focus();await p.keyboard.press('Space');
assert(await p.locator('#dataset-sort-t_cc').evaluate(el=>el===document.activeElement),'Sort button lost keyboard focus');
await p.locator('#dataset-sort-t_cc').click();await p.locator('#dataset-last').click();
assert((await p.locator('#dataset-table [data-column="t_cc"]').allTextContents()).slice(-5).every(v=>v==='Missing'),'Missing values must stay last in descending sort');
checks.push('Numeric sorting, missing-last behavior and sort-button keyboard focus work.');

const promise=p.waitForEvent('download');await p.locator('#dataset-download').click();const download=await promise;
const bytes=await fs.readFile(await download.path()),source=await fs.readFile(path.resolve(root,'../../../Reports/cycles_observed_flagged.csv'));
assert(bytes.equals(source),'Downloaded CSV differs from the full-precision source');
checks.push('Downloaded CSV is byte-identical to all 632 full-precision source rows.');
await p.locator('#dataset-tab').focus();await p.keyboard.press('ArrowLeft');
assert(await p.locator('#learning-view').isVisible(),'Keyboard tab switching to lessons failed');
assert(await p.locator('#lessons-tab').evaluate(el=>el===document.activeElement),'Keyboard tab focus incorrect');
await p.keyboard.press('ArrowRight');assert(await p.locator('#dataset-view').isVisible(),'Keyboard tab switching to dataset failed');
checks.push('Tablist keyboard navigation and lesson return work.');

await p.goto('file://'+path.resolve(root,'../../../Web/HTML/learning/index.html')+'#dataset');
assert(await p.locator('#dataset-view').isVisible(),'Dataset deep link failed');
await p.setViewportSize({width:390,height:844});await p.waitForTimeout(180);
assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile page overflows');
assert(await p.locator('#dataset-table').evaluate(el=>el.scrollWidth>el.clientWidth),'Wide table should scroll inside its region');
await p.locator('#dataset-quality').selectOption('flagged');
await p.screenshot({path:path.join(out,'dataset-mobile.png'),fullPage:true});
checks.push('Dataset deep link and mobile layout work; table scrolling stays within its region.');
assert(errors.length===0,errors.join('\n'));
const report={checks,console_errors:errors,csv_sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
await fs.writeFile(path.join(out,'dataset_checks.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await b.close();
