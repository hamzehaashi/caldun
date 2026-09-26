const state = { company:null, assumptions:{ growth:6, margin:20, tax:21, da:5, capex:3, nwc:1, wacc:9, terminal:2.5 } };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmtMoney = (v, compact=true) => { if(v==null||!Number.isFinite(v)) return '—'; const a=Math.abs(v); const sign=v<0?'-':''; if(compact){if(a>=1e9)return `${sign}$${(a/1e9).toFixed(1)}B`;if(a>=1e6)return `${sign}$${(a/1e6).toFixed(1)}M`;} return `${sign}$${a.toLocaleString(undefined,{maximumFractionDigits:0})}` };
const fmtPct = (v) => v==null||!Number.isFinite(v)?'—':`${(v*100).toFixed(1)}%`;
const pct = (v) => `${Number(v).toFixed(1)}%`;
const esc = (s='') => s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

$('#tickerForm').addEventListener('submit', async e => { e.preventDefault(); const ticker=$('#tickerInput').value.trim().toUpperCase(); if(!ticker)return; await loadCompany(ticker); });
$('#newSearch').addEventListener('click',()=>{ $('#workspace').classList.add('hidden'); $('#searchHero').classList.remove('hidden'); $('#tickerInput').focus(); window.scrollTo({top:0,behavior:'smooth'}); });
$$('.tab').forEach(btn=>btn.addEventListener('click',()=>activateTab(btn.dataset.tab)));
$('#copyMemo').addEventListener('click',async()=>{ await navigator.clipboard.writeText($('#memo').innerText); const b=$('#copyMemo'); const old=b.textContent;b.textContent='Copied';setTimeout(()=>b.textContent=old,1200); });

async function loadCompany(ticker){
  const error=$('#heroError'); const button=$('#tickerForm button'); error.classList.add('hidden'); button.disabled=true; button.innerHTML='Loading…';
  try{
    const res=await fetch(`/api/company?ticker=${encodeURIComponent(ticker)}`); const data=await res.json(); if(!res.ok)throw new Error(data.error||'Unable to load company.');
    if(!data.financials?.length)throw new Error('CALDUN found this filer, but usable annual fundamentals were not available in SEC Company Facts.');
    state.company=data; seedAssumptions(); renderAll(); $('#searchHero').classList.add('hidden'); $('#workspace').classList.remove('hidden'); activateTab('overview'); window.scrollTo({top:0,behavior:'smooth'});
  }catch(err){error.textContent=err.message;error.classList.remove('hidden');}
  finally{button.disabled=false;button.innerHTML='Analyze <span>→</span>';}
}

function seedAssumptions(){
  const f=state.company.financials.filter(x=>x.revenue); const latest=f.at(-1); const prev=f.at(-2);
  const growth=latest&&prev&&prev.revenue?((latest.revenue/prev.revenue)-1)*100:6;
  const margin=latest?.operatingMargin!=null?latest.operatingMargin*100:20;
  const da=latest?.depreciationAndAmortization&&latest.revenue?latest.depreciationAndAmortization/latest.revenue*100:5;
  const capex=latest?.capex&&latest.revenue?latest.capex/latest.revenue*100:3;
  state.assumptions={...state.assumptions,growth:clamp(growth,-5,25),margin:clamp(margin,0,45),da:clamp(da,0,20),capex:clamp(capex,0,20)};
}
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));

function activateTab(tab){ $$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab)); $$('.tab-panel').forEach(x=>x.classList.toggle('active',x.id===`tab-${tab}`)); }
function renderAll(){ $('#companyTicker').textContent=state.company.ticker; $('#companyName').textContent=state.company.name; renderOverview(); renderFinancials(); renderAssumptions(); renderModel(); }

function renderOverview(){
  const f=state.company.financials; const latest=f.at(-1); const prev=f.at(-2); const growth=latest?.revenue&&prev?.revenue?latest.revenue/prev.revenue-1:null;
  const cards=[['Revenue',fmtMoney(latest?.revenue),latest?.year||'Latest FY'],['Revenue growth',fmtPct(growth),'YoY'],['Operating margin',fmtPct(latest?.operatingMargin),'Latest FY'],['Free cash flow',fmtMoney(latest?.freeCashFlow),latest?.year||'Latest FY']];
  $('#metricGrid').innerHTML=cards.map(([l,v,s])=>`<div class="metric"><div class="metric-label">${l}</div><div class="metric-value">${v}</div><div class="metric-sub">${s}</div></div>`).join('');
  const revs=f.filter(x=>x.revenue); const max=Math.max(...revs.map(x=>Math.abs(x.revenue||0)),1); $('#revenueChart').innerHTML=revs.map(x=>`<div class="bar-column"><div class="bar-value">${fmtMoney(x.revenue)}</div><div class="bar" style="height:${Math.max(5,Math.abs(x.revenue)/max*82)}%"></div><div class="bar-year">${x.year}</div></div>`).join('');
}

function renderFinancials(){
  const f=state.company.financials; const rows=[['Revenue','revenue',fmtMoney],['Operating income','operatingIncome',fmtMoney],['Operating margin','operatingMargin',fmtPct],['Net income','netIncome',fmtMoney],['Operating cash flow','operatingCashFlow',fmtMoney],['Capital expenditures','capex',v=>v==null?'—':fmtMoney(-Math.abs(v))],['Free cash flow','freeCashFlow',fmtMoney],['D&A','depreciationAndAmortization',fmtMoney]];
  $('#financialTable').innerHTML=`<thead><tr><th>USD</th>${f.map(x=>`<th>${x.year}</th>`).join('')}</tr></thead><tbody>${rows.map(([label,key,formatter])=>`<tr><td>${label}</td>${f.map(x=>`<td>${formatter(x[key])}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

const defs=[
  ['growth','Revenue growth',-5,25,.5],['margin','EBIT margin',0,45,.5],['tax','Tax rate',0,40,.5],['da','D&A / revenue',0,20,.25],['capex','CapEx / revenue',0,20,.25],['nwc','ΔNWC / revenue',-5,10,.25],['wacc','WACC',4,18,.25],['terminal','Terminal growth',0,6,.25]
];
function renderAssumptions(){
  $('#assumptions').innerHTML=defs.map(([key,label,min,max,step])=>`<div class="assumption"><label for="a-${key}">${label}<span id="v-${key}">${pct(state.assumptions[key])}</span></label><input id="a-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${state.assumptions[key]}"></div>`).join('');
  defs.forEach(([key])=>$('#a-'+key).addEventListener('input',e=>{state.assumptions[key]=Number(e.target.value);$('#v-'+key).textContent=pct(e.target.value);renderModel();}));
}

function buildForecast(overrides={}){
  const a={...state.assumptions,...overrides}; const hist=state.company.financials.filter(x=>x.revenue); const latest=hist.at(-1); if(!latest)return [];
  let revenue=latest.revenue; const out=[];
  for(let i=1;i<=5;i++){ revenue*=1+a.growth/100; const ebit=revenue*a.margin/100; const nopat=ebit*(1-a.tax/100); const da=revenue*a.da/100; const capex=revenue*a.capex/100; const nwc=revenue*a.nwc/100; const ufcf=nopat+da-capex-nwc; out.push({year:latest.year+i,revenue,ebit,nopat,da,capex,nwc,ufcf}); }
  return out;
}
function dcf(overrides={}){
  const a={...state.assumptions,...overrides}; const fc=buildForecast(overrides); if(!fc.length)return null; const wacc=a.wacc/100,g=a.terminal/100; if(wacc<=g)return null; let pv=0;fc.forEach((x,i)=>pv+=x.ufcf/Math.pow(1+wacc,i+1)); const tv=fc.at(-1).ufcf*(1+g)/(wacc-g); const pvTv=tv/Math.pow(1+wacc,fc.length); const ev=pv+pvTv; const bs=state.company.balanceSheet||{}; const equity=ev-(bs.debt||0)+(bs.cash||0); const shares=bs.sharesOutstanding||null; return {fc,pv,pvTv,ev,equity,shares,perShare:shares?equity/shares:null}; }

function renderModel(){
  const result=dcf(); if(!result)return;
  $('#forecastTable').innerHTML=`<thead><tr><th>USD</th>${result.fc.map(x=>`<th>${x.year}E</th>`).join('')}</tr></thead><tbody>${[
    ['Revenue','revenue',fmtMoney],['EBIT','ebit',fmtMoney],['NOPAT','nopat',fmtMoney],['D&A','da',fmtMoney],['CapEx','capex',v=>fmtMoney(-Math.abs(v))],['ΔNWC','nwc',v=>fmtMoney(-v)],['UFCF','ufcf',fmtMoney]
  ].map(([l,k,f])=>`<tr><td>${l}</td>${result.fc.map(x=>`<td>${f(x[k])}</td>`).join('')}</tr>`).join('')}</tbody>`;
  const bs=state.company.balanceSheet||{};
  $('#valuationSummary').innerHTML=`<div class="valuation-hero"><div class="eyebrow-small">IMPLIED VALUE / SHARE</div><strong>${result.perShare==null?'N/A':fmtMoney(result.perShare,false)}</strong></div><div class="valuation-lines"><div class="valuation-line"><span>Enterprise value</span><span>${fmtMoney(result.ev)}</span></div><div class="valuation-line"><span>PV forecast FCF</span><span>${fmtMoney(result.pv)}</span></div><div class="valuation-line"><span>PV terminal value</span><span>${fmtMoney(result.pvTv)}</span></div><div class="valuation-line"><span>Cash</span><span>${fmtMoney(bs.cash)}</span></div><div class="valuation-line"><span>Debt</span><span>${fmtMoney(bs.debt)}</span></div><div class="valuation-line"><span>Equity value</span><span>${fmtMoney(result.equity)}</span></div><div class="valuation-line"><span>Shares outstanding</span><span>${bs.sharesOutstanding?`${(bs.sharesOutstanding/1e6).toFixed(1)}M`:'Unavailable'}</span></div></div>`;
  renderSensitivity(); renderMemo(result);
}

function renderSensitivity(){
  const centerW=state.assumptions.wacc,centerG=state.assumptions.terminal; const ws=[-1,-.5,0,.5,1].map(d=>centerW+d); const gs=[-1,-.5,0,.5,1].map(d=>Math.max(0,centerG+d));
  $('#sensitivityTable').innerHTML=`<table class="sensitivity"><thead><tr><th>WACC ↓ / g →</th>${gs.map(g=>`<th>${g.toFixed(1)}%</th>`).join('')}</tr></thead><tbody>${ws.map((w,wi)=>`<tr><th>${w.toFixed(1)}%</th>${gs.map((g,gi)=>{const r=dcf({wacc:w,terminal:g});return `<td class="${wi===2&&gi===2?'center':''}">${r?.perShare?fmtMoney(r.perShare,false):'—'}</td>`}).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderMemo(result){
  const c=state.company,a=state.assumptions,h=c.financials.filter(x=>x.revenue),first=h[0],last=h.at(-1); const histGrowth=first&&last&&first.revenue?Math.pow(last.revenue/first.revenue,1/Math.max(1,last.year-first.year))-1:null;
  $('#memo').innerHTML=`<h4>${esc(c.name)}</h4><div class="memo-meta">${esc(c.ticker)} · CALDUN MODEL DRAFT · ${new Date().toLocaleDateString()}</div><h5>Executive summary</h5><p>CALDUN's current base case uses ${pct(a.growth)} annual revenue growth, a ${pct(a.margin)} EBIT margin, a ${pct(a.wacc)} WACC, and ${pct(a.terminal)} terminal growth. The model implies ${result.perShare?`approximately <strong>${fmtMoney(result.perShare,false)}</strong> per share`:'an equity value of <strong>'+fmtMoney(result.equity)+'</strong>; a per-share value is unavailable because share-count data was not found'}.</p><h5>Historical performance</h5><p>${esc(c.name)} reported ${fmtMoney(last?.revenue)} of revenue in FY${last?.year}. ${histGrowth!=null?`Across the available history, revenue compounded at roughly ${fmtPct(histGrowth)} per year.`:''} Latest operating margin was ${fmtPct(last?.operatingMargin)} and filing-derived free cash flow was ${fmtMoney(last?.freeCashFlow)}.</p><h5>Base-case assumptions</h5><ul><li>Revenue growth: ${pct(a.growth)}</li><li>EBIT margin: ${pct(a.margin)}</li><li>Tax rate: ${pct(a.tax)}</li><li>CapEx / revenue: ${pct(a.capex)}</li><li>WACC: ${pct(a.wacc)}</li><li>Terminal growth: ${pct(a.terminal)}</li></ul><h5>Investment thesis</h5><p class="editable" contenteditable="true">Write the analyst's thesis here. CALDUN should structure the work; the investment judgment remains yours.</p><h5>Catalysts</h5><p class="editable" contenteditable="true">Add catalysts supported by company filings, earnings materials, or your research.</p><h5>Risks</h5><p class="editable" contenteditable="true">Add the risks that could invalidate the thesis or the forecast assumptions.</p><h5>Valuation</h5><p>The base-case DCF produces enterprise value of ${fmtMoney(result.ev)} and equity value of ${fmtMoney(result.equity)}. Review the WACC/terminal-growth sensitivity before using the output in an investment conclusion.</p>`;
}
