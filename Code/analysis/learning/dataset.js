'use strict';
const DATASET_COLUMNS=[
 {key:'battery_id',name:'Battery',role:'Identifier',unit:'',description:'Identifies the cell that produced this observation.'},
 {key:'cycle',name:'Cycle',role:'Identifier',unit:'',description:'Discharge-cycle number within this battery. The source loader excludes the first discharge of each cell.'},
 {key:'charge_quality_flag',name:'Charge quality',role:'Quality flag',unit:'',description:'Flagged means the four charge features were masked under the documented screening policy; capacity and SoH are retained.'},
 {key:'capacity',name:'Capacity',role:'Measured target',unit:'Ah',description:'Discharge capacity supplied by the NASA record.'},
 {key:'soh',name:'SoH',role:'Derived label',unit:'%',description:'Capacity divided by the rated 2 Ah reference, multiplied by 100. Values above 100% are retained.'},
 ...FEATURES.map(key=>({key,name:LABELS[key],role:'Feature',unit:UNITS[key],description:{t_cc:'Time from 3.8 to 4.2 V during charging.',t_cv:'Duration of the constant-voltage charging phase.',dq_dv_peak:'Extracted peak of incremental charge per voltage. Its unit is Ah/V.',v_at_peak:'Voltage at the extracted charge-curve peak.',delta_T_max:'Maximum temperature rise over the complete discharge.',delta_V_ohmic:'Voltage drop at the initial discharge load step.',Re:'Electrolyte-resistance estimate from the source nearest impedance sweep.',Rct:'Charge-transfer-resistance estimate from the source nearest impedance sweep.',rest_time_hours:'Elapsed interval between discharges; includes intervening charging and ends at discharge start.'}[key]}))
];
// The embedded source is the validated internal numeric CSV, not an upload parser.
const datasetLines=DATA.dataset.csv.trimEnd().split(/\r?\n/),datasetHeaders=datasetLines.shift().split(',');
const datasetRows=datasetLines.map(line=>Object.fromEntries(line.split(',').map((value,i)=>[datasetHeaders[i],value])));
const datasetState={battery:'ALL',quality:'all',query:'',size:25,page:1,sort:'battery_id',direction:1};
function isFlagged(row){return row.charge_quality_flag.toLowerCase()==='true';}
function filteredDataset(){
 const tokens=datasetState.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
 return datasetRows.filter(row=>(datasetState.battery==='ALL'||row.battery_id===datasetState.battery)
  &&(datasetState.quality==='all'||isFlagged(row)===(datasetState.quality==='flagged'))
  &&tokens.every(token=>row.battery_id.toLowerCase().includes(token)||row.cycle===token)).sort((a,b)=>{
   const key=datasetState.sort,av=a[key],bv=b[key];
   if(av===''||bv==='')return av===bv?0:av===''?1:-1;
   let order=key==='battery_id'?av.localeCompare(bv):key==='charge_quality_flag'?Number(isFlagged(a))-Number(isFlagged(b)):Number(av)-Number(bv);
   return order*datasetState.direction||a.battery_id.localeCompare(b.battery_id)||Number(a.cycle)-Number(b.cycle);
  });
}
function datasetCell(row,key){
 const value=row[key];if(value==='')return '<span class="dataset-missing">Missing</span>';
 if(key==='charge_quality_flag')return isFlagged(row)?'<span class="dataset-flag">Flagged charge</span>':'Unflagged';
 if(key==='battery_id'||key==='cycle')return esc(value);
 return esc(Number(value).toLocaleString('en-US',{maximumFractionDigits:6,useGrouping:false}));
}
function renderDataset(){
 const focus=focusedControl(),rows=filteredDataset(),pages=Math.ceil(rows.length/datasetState.size);
 datasetState.page=Math.max(1,Math.min(datasetState.page,pages||1));const start=(datasetState.page-1)*datasetState.size,page=rows.slice(start,start+datasetState.size);
 text('dataset-count',rows.length?`Showing ${start+1}–${start+page.length} of ${rows.length} matching cycles · ${rows.filter(isFlagged).length} flagged`:'No matching cycles');
 text('dataset-page',pages?`Page ${datasetState.page} of ${pages}`:'Page 0 of 0');
 $('dataset-empty').hidden=rows.length>0;$('dataset-table').hidden=rows.length===0;
 $('dataset-first').disabled=$('dataset-prev').disabled=!pages||datasetState.page===1;
 $('dataset-next').disabled=$('dataset-last').disabled=!pages||datasetState.page===pages;
 $('dataset-clear').disabled=datasetState.battery==='ALL'&&datasetState.quality==='all'&&!datasetState.query;
 const headings=DATASET_COLUMNS.map(col=>`<th scope="col"${datasetState.sort===col.key?` aria-sort="${datasetState.direction===1?'ascending':'descending'}"`:''}><button id="dataset-sort-${col.key}" type="button" data-sort="${col.key}" aria-label="Sort by ${esc(col.name)}${datasetState.sort===col.key?`, currently ${datasetState.direction===1?'ascending':'descending'}`:''}"><span>${esc(col.name)}${col.unit?` (${esc(col.unit)})`:''}</span><small>${esc(col.role)}</small>${datasetState.sort===col.key?`<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="${datasetState.direction===1?'M3 8 6 4 9 8':'M3 4 6 8 9 4'}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`:''}</button></th>`).join('');
 $('dataset-table').innerHTML=`<table><caption class="visually-hidden">Observed cycle dataset. Missing charge features are explicit; capacity is the measured target and SoH is derived.</caption><thead><tr>${headings}</tr></thead><tbody>${page.map(row=>`<tr data-battery="${esc(row.battery_id)}" data-cycle="${esc(row.cycle)}">${DATASET_COLUMNS.map(col=>`<td data-column="${col.key}">${datasetCell(row,col.key)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 restoreControl(focus);
}
function setupDataset(){
 $('dataset-dictionary').innerHTML=table(['Column','Role / unit','Meaning'],DATASET_COLUMNS.map(col=>[col.key,col.role+(col.unit?' / '+col.unit:''),col.description]));
 for(const[id,key]of [['dataset-battery','battery'],['dataset-quality','quality'],['dataset-size','size']])$(id).addEventListener('change',e=>{datasetState[key]=key==='size'?Number(e.target.value):e.target.value;datasetState.page=1;renderDataset();});
 $('dataset-search').addEventListener('input',e=>{datasetState.query=e.target.value;datasetState.page=1;renderDataset();});
 $('dataset-clear').addEventListener('click',()=>{datasetState.battery='ALL';datasetState.quality='all';datasetState.query='';datasetState.page=1;$('dataset-battery').value='ALL';$('dataset-quality').value='all';$('dataset-search').value='';renderDataset();});
 $('dataset-table').addEventListener('click',e=>{const button=e.target.closest('[data-sort]');if(!button)return;datasetState.direction=datasetState.sort===button.dataset.sort?-datasetState.direction:1;datasetState.sort=button.dataset.sort;datasetState.page=1;renderDataset();});
 for(const[id,action]of [['dataset-first','first'],['dataset-prev','previous'],['dataset-next','next'],['dataset-last','last']])$(id).addEventListener('click',()=>{const pages=Math.ceil(filteredDataset().length/datasetState.size);datasetState.page=action==='first'?1:action==='last'?pages:datasetState.page+(action==='next'?1:-1);renderDataset();});
 $('dataset-download').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([DATA.dataset.csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=DATA.dataset.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
}
