'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const LS_CONFIG = 'cassieri_config_v1';
const LS_HISTORY = 'cassieri_history_v1';
let defaultConfig = null;
let defaultHistory = [];
let config = null;
let history = [];
let dailyRows = [];
let charts = {atv:null, tem:null};

const fmt = new Intl.NumberFormat('it-IT',{maximumFractionDigits:2});
const money = v => `${fmt.format(Number(v||0))} €`;
const pct = v => `${fmt.format(Number(v||0))}%`;
const safeDiv = (a,b) => b ? a/b : 0;
const clamp1 = v => Math.min(1, Math.max(0, v));
const clean = v => String(v ?? '').replace(/\u00a0/g,' ').trim().replace(/\s+/g,' ');
const low = v => clean(v).toLowerCase();
const matchKw = (text, list=[]) => list.some(k => k && low(text).includes(low(k)));

async function init(){
  const [c,h] = await Promise.all([fetch('config.json').then(r=>r.json()),fetch('storico.json').then(r=>r.json())]);
  defaultConfig = c; defaultHistory = h.righe || [];
  try{config = JSON.parse(localStorage.getItem(LS_CONFIG)) || structuredClone(defaultConfig);}catch{config=structuredClone(defaultConfig)}
  try{history = JSON.parse(localStorage.getItem(LS_HISTORY)) || structuredClone(defaultHistory);}catch{history=structuredClone(defaultHistory)}
  bindUI();
  $('#configEditor').value = JSON.stringify(config,null,2);
  renderWeights(); renderDaily(); renderHistory(); refreshChartOperators(); updateSetupKpis();
  if(!$('#businessDate').value) $('#businessDate').value = new Date().toISOString().slice(0,10);
}

function bindUI(){
  $$('.tab').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
  $('#cashierFile').addEventListener('change',e=>e.target.files[0] && importCashier(e.target.files[0]));
  const dz=$('#dropzone');
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag')}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag')}));
  dz.addEventListener('drop',e=>e.dataTransfer.files[0] && importCashier(e.dataTransfer.files[0]));
  ['presenze','txGiornata','vendutoGiornata'].forEach(id=>$('#'+id).addEventListener('input',updateSetupKpis));
  $('#btnSaveDay').addEventListener('click',saveDay);
  $('#historyBar').addEventListener('change',renderRanking);
  $('#chartOperator').addEventListener('change',renderCharts);
  $('#btnExportHistory').addEventListener('click',()=>downloadJson('storico.json',{version:'1.0.0',righe:history}));
  $('#historyFile').addEventListener('change',importHistoryJson);
  $('#btnExportConfig').addEventListener('click',()=>downloadJson('config.json',config));
  $('#btnSaveConfig').addEventListener('click',saveConfig);
  $('#btnResetConfig').addEventListener('click',resetConfig);
  $('#btnResetHistory').addEventListener('click',resetHistory);
}

function switchView(view){
  $$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  $$('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${view}`));
  if(view==='storico') renderHistory();
  if(view==='grafici'){refreshChartOperators();renderCharts()}
}

function showMessage(el,text,type='ok'){
  el.textContent=text; el.className=`message ${type}`;
}

function parseNum(v){
  if(typeof v==='number') return Number.isFinite(v)?v:0;
  let s=clean(v).replace(/[^0-9,.-]/g,'');
  if(!s) return 0;
  if(s.includes(',') && s.includes('.')){
    if(s.lastIndexOf(',') > s.lastIndexOf('.')) s=s.replace(/\./g,'').replace(',','.');
    else s=s.replace(/,/g,'');
  } else if(s.includes(',')) s=s.replace(/\./g,'').replace(',','.');
  return Number(s)||0;
}
function numericLike(v){return typeof v==='number' || /^\s*[-+]?\d[\d.,]*\s*$/.test(clean(v).replace(/[€%]/g,''))}
function rowText(row){return clean(row.filter(v=>clean(v)!=='').join(' '))}
function rowContains(row,text){return row.some(v=>low(v).includes(low(text)))}
function hasExactCell(row,text){return row.some(v=>clean(v)===text)}
function getValueAfterLabel(row,label){
  for(let c=0;c<row.length;c++){
    const v=clean(row[c]); const ix=low(v).indexOf(low(label));
    if(ix>=0){
      const after=clean(v.slice(ix+label.length)); if(after) return after;
      for(let k=c+1;k<row.length;k++){
        const n=clean(row[k]); if(!n) continue;
        if(!/workstation:|point of sale|user number:|logon:/i.test(n)) return n;
      }
    }
  } return '';
}
function firstNumberAfterText(row,text){
  for(let c=0;c<row.length;c++) if(clean(row[c])===text){for(let k=c+1;k<row.length;k++) if(numericLike(row[k])) return parseNum(row[k]);}
  return 0;
}
function salesQtyFromRow(row){let n=0;for(const v of row){if(numericLike(v)){n++;if(n===2)return parseNum(v)}}return 0}
function lastNumberInRow(row){for(let i=row.length-1;i>=0;i--)if(numericLike(row[i]))return parseNum(row[i]);return 0}
function isProductCandidate(text){
  const t=low(text); if(!t||t.includes('totale')||t.includes('concession sales'))return false;
  if(t.includes('cards')&&t.length<20)return false; if(t.includes('food')&&t.length<20)return false;
  const k=config.keywords; return matchKw(t,k.rigaProdotto)||matchKw(t,k.tematici)||matchKw(t,k.comboDoppio)||matchKw(t,k.acque75);
}
function validOperator(user,ws){return clean(user) && !matchKw(user,config.keywords.escludiUtente) && !matchKw(ws,config.keywords.escludiWorkstation)}

function detectDate(rows){
  const re=/\b([0-3]\d)\/([0-1]\d)\/([12]\d{3})\b/;
  for(const row of rows.slice(0,80)) for(const cell of row){const m=clean(cell).match(re);if(m)return `${m[3]}-${m[2]}-${m[1]}`}
  return '';
}
function parseSession(rows,start,end){
  let inConcession=false,inTx=false,pending=''; let tx=0,sales=0,tem=0,combo=0,water=0;
  for(let r=start;r<=end;r++){
    const row=rows[r]||[], txt=low(rowText(row));
    if(txt.includes('number of transactions')) inTx=true;
    if(inTx && hasExactCell(row,'Concession')) tx=firstNumberAfterText(row,'Concession');
    if(txt.includes('concession sales')){inConcession=true;pending=''}
    if(inConcession && txt.includes('totale concession')){sales=lastNumberInRow(row);inConcession=false;pending=''}
    if(inConcession){
      let product=''; if(isProductCandidate(txt)){product=txt;pending=product}else product=pending;
      const qty=salesQtyFromRow(row);
      if(qty>0 && product){
        if(matchKw(product,config.keywords.tematici))tem+=qty;
        if(matchKw(product,config.keywords.comboDoppio))combo+=qty;
        if(matchKw(product,config.keywords.acque75))water+=qty;
        pending='';
      }
    }
  }
  return {scontrini:tx,venduto:sales,tematici:tem,comboDoppio:combo,acque75:water};
}

async function importCashier(file){
  $('#fileName').textContent=file.name;
  try{
    if(!window.XLSX) throw new Error('Libreria XLSX non disponibile. Controlla la connessione internet.');
    const ab=await file.arrayBuffer();
    const wb=XLSX.read(ab,{type:'array',cellDates:false});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''});
    const map=new Map();
    for(let r=0;r<rows.length;r++){
      if(!rowContains(rows[r],'User:'))continue;
      const user=clean(getValueAfterLabel(rows[r],'User:'));
      const workstation=clean(getValueAfterLabel(rows[r],'Workstation:'));
      let next=r+1;while(next<rows.length&&!rowContains(rows[next],'User:'))next++;
      const end=next-1;
      if(validOperator(user,workstation)){
        const d=parseSession(rows,r,end);
        if(d.scontrini>0||d.venduto>0){
          const key=`${user}|${workstation}`;
          if(!map.has(key))map.set(key,{operatore:user,workstation,bar:config.workstations[workstation]||'Principale',ore:0,scontrini:0,venduto:0,tematici:0,comboDoppio:0,acque75:0});
          const x=map.get(key);['scontrini','venduto','tematici','comboDoppio','acque75'].forEach(k=>x[k]+=d[k]);
        }
      }
      r=end;
    }
    dailyRows=[...map.values()];
    const date=detectDate(rows); if(date)$('#businessDate').value=date;
    $('#txGiornata').value=dailyRows.reduce((a,x)=>a+x.scontrini,0)||'';
    $('#vendutoGiornata').value=dailyRows.reduce((a,x)=>a+x.venduto,0).toFixed(2)||'';
    updateSetupKpis(); renderDaily();
    showMessage($('#importMessage'),`Import completato: ${dailyRows.length} operatori trovati${date?` • data ${formatDate(date)}`:''}.`,'ok');
  }catch(err){console.error(err);showMessage($('#importMessage'),`Errore import: ${err.message}`,'error')}
}

function renderDaily(){
  const tb=$('#dailyTable tbody');
  if(!dailyRows.length){tb.innerHTML='<tr><td colspan="14" class="empty">Importa un file Cashier per iniziare.</td></tr>';return}
  tb.innerHTML=dailyRows.map((x,i)=>{
    const atv=safeDiv(x.venduto,x.scontrini),tem100=safeDiv(x.tematici,x.scontrini)*100,com100=safeDiv(x.comboDoppio,x.scontrini)*100;
    return `<tr data-i="${i}"><td>${esc(x.operatore)}</td><td>${esc(x.workstation)}</td><td><select class="bar"><option ${x.bar==='Principale'?'selected':''}>Principale</option><option ${x.bar==='Secondario'?'selected':''}>Secondario</option></select></td><td><input class="ore" type="number" min="0" step="0.25" value="${x.ore||''}"></td><td>${fmt.format(x.scontrini)}</td><td>${money(x.venduto)}</td><td>${money(atv)}</td><td>${fmt.format(x.tematici)}</td><td>${fmt.format(tem100)}</td><td>${fmt.format(x.comboDoppio)}</td><td>${fmt.format(com100)}</td><td>${fmt.format(x.acque75)}</td><td class="vendh">${x.ore?money(safeDiv(x.venduto,x.ore)):'—'}</td><td class="txh">${x.ore?fmt.format(safeDiv(x.scontrini,x.ore)):'—'}</td></tr>`;
  }).join('');
  $$('#dailyTable tbody tr').forEach(tr=>{
    const i=Number(tr.dataset.i);
    tr.querySelector('.ore').addEventListener('input',e=>{dailyRows[i].ore=parseNum(e.target.value);tr.querySelector('.vendh').textContent=dailyRows[i].ore?money(safeDiv(dailyRows[i].venduto,dailyRows[i].ore)):'—';tr.querySelector('.txh').textContent=dailyRows[i].ore?fmt.format(safeDiv(dailyRows[i].scontrini,dailyRows[i].ore)):'—'});
    tr.querySelector('.bar').addEventListener('change',e=>dailyRows[i].bar=e.target.value);
  });
}

function updateSetupKpis(){
  const p=parseNum($('#presenze').value),t=parseNum($('#txGiornata').value),v=parseNum($('#vendutoGiornata').value);
  $('#kpiATV').textContent=t?money(v/t):'—'; $('#kpiHR').textContent=p?pct(t/p*100):'—'; $('#kpiSPP').textContent=p?money(v/p):'—';
}

function saveDay(){
  const date=$('#businessDate').value;
  if(!date){alert('Inserisci la data della giornata.');return}
  if(!dailyRows.length){alert('Prima importa un file Cashier.');return}
  const missing=dailyRows.filter(x=>!x.ore).length;
  if(missing && !confirm(`Ci sono ${missing} operatori senza ore. Vuoi salvare comunque?`))return;
  history=history.filter(x=>x.data!==date);
  for(const x of dailyRows){
    history.push({data:date,operatore:x.operatore,workstation:x.workstation,bar:x.bar,ore:Number(x.ore||0),scontrini:Number(x.scontrini||0),venduto:Number(x.venduto||0),atv:safeDiv(x.venduto,x.scontrini),tematici:Number(x.tematici||0),comboDoppio:Number(x.comboDoppio||0),acque75:Number(x.acque75||0)});
  }
  persistHistory(); renderHistory(); refreshChartOperators();
  alert(`Giornata ${formatDate(date)} salvata/aggiornata nello storico locale.`);
}

function aggregateRanking(bar){
  const d=new Map();
  history.filter(x=>low(x.bar)===low(bar)).forEach(x=>{
    if(!d.has(x.operatore))d.set(x.operatore,{operatore:x.operatore,giorni:0,ore:0,scontrini:0,venduto:0,tematici:0,comboDoppio:0,acque75:0});
    const a=d.get(x.operatore);a.giorni++;a.ore+=Number(x.ore||0);a.scontrini+=Number(x.scontrini||0);a.venduto+=Number(x.venduto||0);a.tematici+=Number(x.tematici||0);a.comboDoppio+=Number(x.comboDoppio||0);a.acque75+=Number(x.acque75||0);
  });
  const rows=[...d.values()]; const s=config.soglie, p=config.pesiStorico;
  rows.forEach(a=>{
    a.vendOra=safeDiv(a.venduto,a.ore);a.txOra=safeDiv(a.scontrini,a.ore);a.atv=safeDiv(a.venduto,a.scontrini);a.tem100=safeDiv(a.tematici,a.scontrini)*100;a.combo100=safeDiv(a.comboDoppio,a.scontrini)*100;
    a.temRateMetric=a.tem100*clamp1(safeDiv(a.scontrini,s.scontriniTarget));a.comboMetric=a.combo100*clamp1(safeDiv(a.scontrini,s.scontriniTarget));a.temTotalMetric=a.tematici;a.volumeMetric=a.scontrini;
    a.continuitaMetric=clamp1(safeDiv(a.giorni,s.giorniTarget))*.6+clamp1(safeDiv(a.ore,s.oreTarget))*.4;
    a.ritmoMetric=a.vendOra*.5+(a.txOra*10)*.5;
    a.affidabilita=clamp1(safeDiv(a.giorni,s.giorniTarget))*40+clamp1(safeDiv(a.ore,s.oreTarget))*25+clamp1(safeDiv(a.scontrini,s.scontriniMinValido))*35;
    a.stato=(a.giorni>=s.giorniMinValido&&a.ore>=s.oreMinValido&&a.scontrini>=s.scontriniMinValido)?'VALIDO':'PROVVISORIO';
  });
  const max=k=>Math.max(0,...rows.map(x=>x[k]||0));
  const m={atv:max('atv'),tr:max('temRateMetric'),tt:max('temTotalMetric'),vol:max('volumeMetric'),com:max('comboMetric'),cont:max('continuitaMetric'),rit:max('ritmoMetric')};
  rows.forEach(a=>a.score=safeDiv(a.atv,m.atv)*p.atv+safeDiv(a.temRateMetric,m.tr)*p.tematici100Pesati+safeDiv(a.temTotalMetric,m.tt)*p.tematiciTotali+safeDiv(a.volumeMetric,m.vol)*p.volumeScontrini+safeDiv(a.comboMetric,m.com)*p.combo100Pesati+safeDiv(a.continuitaMetric,m.cont)*p.continuita+safeDiv(a.ritmoMetric,m.rit)*p.ritmo);
  rows.sort((a,b)=>(b.stato==='VALIDO')-(a.stato==='VALIDO') || b.score-a.score || b.affidabilita-a.affidabilita || b.tematici-a.tematici);
  return rows;
}

function renderHistory(){
  const dates=[...new Set(history.map(x=>x.data))].sort(); const ops=[...new Set(history.map(x=>x.operatore))];
  $('#historyRows').textContent=fmt.format(history.length);$('#historyDays').textContent=fmt.format(dates.length);$('#historyOperators').textContent=fmt.format(ops.length);$('#historyLastDay').textContent=dates.length?formatDate(dates.at(-1)):'—';renderRanking();
}
function renderRanking(){
  const rows=aggregateRanking($('#historyBar').value);const tb=$('#rankingTable tbody');
  tb.innerHTML=rows.map((x,i)=>`<tr><td class="${i<3?'rank'+(i+1):''}">${i+1}</td><td>${esc(x.operatore)}</td><td><span class="badge ${x.stato==='VALIDO'?'valid':'provisional'}">${x.stato}</span></td><td><strong>${fmt.format(x.score)}</strong></td><td>${pct(x.affidabilita)}</td><td>${fmt.format(x.giorni)}</td><td>${fmt.format(x.ore)}</td><td>${fmt.format(x.scontrini)}</td><td>${money(x.venduto)}</td><td>${money(x.atv)}</td><td>${fmt.format(x.tematici)}</td><td>${fmt.format(x.tem100)}</td><td>${fmt.format(x.comboDoppio)}</td><td>${fmt.format(x.combo100)}</td><td>${fmt.format(x.acque75)}</td><td>${money(x.vendOra)}</td><td>${fmt.format(x.txOra)}</td></tr>`).join('');
}

function refreshChartOperators(){
  const names=[...new Set(history.map(x=>x.operatore))].sort((a,b)=>a.localeCompare(b,'it'));const sel=$('#chartOperator');const old=sel.value;sel.innerHTML=names.map(n=>`<option>${esc(n)}</option>`).join('');if(names.includes(old))sel.value=old;
}
function renderCharts(){
  if(!window.Chart)return;const name=$('#chartOperator').value;if(!name)return;
  const rows=history.filter(x=>x.operatore===name).sort((a,b)=>a.data.localeCompare(b.data));
  const labels=rows.map(x=>formatDate(x.data));const atv=rows.map(x=>safeDiv(x.venduto,x.scontrini));const tem=rows.map(x=>safeDiv(x.tematici,x.scontrini)*100);
  if(charts.atv)charts.atv.destroy();if(charts.tem)charts.tem.destroy();
  const opts={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#9aa8c3',maxRotation:55,minRotation:0},grid:{color:'rgba(38,52,81,.35)'}},y:{ticks:{color:'#9aa8c3'},grid:{color:'rgba(38,52,81,.35)'}}}};
  charts.atv=new Chart($('#atvChart'),{type:'line',data:{labels,datasets:[{data:atv,borderWidth:2,tension:.25,pointRadius:3}]},options:opts});
  charts.tem=new Chart($('#temChart'),{type:'line',data:{labels,datasets:[{data:tem,borderWidth:2,tension:.25,pointRadius:3}]},options:opts});
}

function renderWeights(){
  const labels={atv:'ATV medio',tematici100Pesati:'Tematici /100 pesati sui volumi',tematiciTotali:'Tematici totali',volumeScontrini:'Volume scontrini',combo100Pesati:'Combo /100 pesate',continuita:'Continuità',ritmo:'Ritmo / venduto per ora'};
  $('#weightsPanel').innerHTML=Object.entries(config.pesiStorico).map(([k,v])=>`<div class="weight-row"><span>${labels[k]||k}</span><b>${v}</b></div>`).join('');
}
function saveConfig(){
  try{const obj=JSON.parse($('#configEditor').value);config=obj;localStorage.setItem(LS_CONFIG,JSON.stringify(config));renderWeights();renderHistory();showMessage($('#configMessage'),'Configurazione salvata nel browser.','ok')}catch(e){showMessage($('#configMessage'),`JSON non valido: ${e.message}`,'error')}
}
function resetConfig(){config=structuredClone(defaultConfig);localStorage.removeItem(LS_CONFIG);$('#configEditor').value=JSON.stringify(config,null,2);renderWeights();renderHistory();showMessage($('#configMessage'),'Configurazione GitHub ripristinata.','ok')}
function resetHistory(){if(!confirm('Ripristinare lo storico originale contenuto nel repository? Le modifiche locali verranno perse.'))return;history=structuredClone(defaultHistory);localStorage.removeItem(LS_HISTORY);renderHistory();refreshChartOperators();alert('Storico originale ripristinato.')}
function persistHistory(){localStorage.setItem(LS_HISTORY,JSON.stringify(history))}
function importHistoryJson(e){
  const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const j=JSON.parse(r.result);history=Array.isArray(j)?j:(j.righe||[]);persistHistory();renderHistory();refreshChartOperators();alert(`Importate ${history.length} righe di storico.`)}catch(err){alert('JSON storico non valido: '+err.message)}};r.readAsText(f);e.target.value='';
}
function downloadJson(name,obj){const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function formatDate(s){if(!s)return'—';const [y,m,d]=s.split('-');return `${d}/${m}/${y}`}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

document.addEventListener('DOMContentLoaded',()=>init().catch(err=>{console.error(err);document.body.innerHTML=`<main><div class="card"><h2>Errore inizializzazione</h2><p>${esc(err.message)}</p><p>Apri il progetto tramite GitHub Pages o un piccolo server HTTP: non direttamente come file locale.</p></div></main>`}));
