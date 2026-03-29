/* ═══════════════════════════════════════════════════
   FinNova v5 — app.js
   Gold rates: corsproxy.io + Yahoo Finance (zero config — same as NEXUS)
═══════════════════════════════════════════════════ */

// ── CONFIGURATION ────────────────────────────────────
const PRECONFIGURED_CLIENT_ID = '728990426782-jk6n0e5ospehlcqgbtp81l1p3hc7ghst.apps.googleusercontent.com'; // e.g. '1234-abc.apps.googleusercontent.com'
const PRECONFIGURED_SHEET_ID  = '17KgNA83OabwZM3K8sOp2sFrbhSq-D2MH--JMluIhnVs'; // e.g. '1BxiMVs0XRA5nFM...'

// ─── Gold fetch — corsproxy.io + Yahoo Finance (same as NEXUS, no config needed) ───
const PROXY = 'https://script.google.com/macros/s/AKfycbyOqF2gt0tculAtyKwFbirEHlkO-Sl_fzfFVYgebdWj-C8Vb-YiHnP2K6L1Le7QNow_Mw/exec';

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS = {
  income:'Income', expenses:'Expenses', mf:'MutualFunds',
  chits:'ChitFunds', chitPay:'ChitPayments', inv:'Investments',
  ins:'Insurance', goals:'Goals', assets:'Assets', liab:'Liabilities'
};
const CAT_COLORS = {
  Housing:'#2962ff', Utilities:'#0B7285', Food:'#089981', Transport:'#7c3aed',
  Education:'#f23645', Health:'#0B7285', Insurance:'#f7941d', NPS:'#0B7285',
  'Mutual Funds':'#2962ff', 'Chit Funds':'#c8a84b', Entertainment:'#f23645',
  Shopping:'#6b7685', Other:'#9aa4b2', Salary:'#089981', Business:'#c8a84b',
  Freelance:'#2962ff', 'Chit Payout':'#c8a84b', Dividends:'#089981'
};

// ── STATE ─────────────────────────────────────────────
let gToken = null, sheetId = PRECONFIGURED_SHEET_ID||'', clientId = '';
let selMonth = '', curMonth = '';
let cache = { income:[], expenses:[], mf:[], chits:[], chitPay:[], inv:[], ins:[], goals:[], assets:[], liab:[] };
let goldData = { comex:0, usdinr:0, mcx:0, change:0, changePct:0, mcxChange:0, lastUpdate:null };
let charts = {}, tokenExpiryTimer = null, goldTimer = null, scanTimer = null;
let sidebarCollapsed = false, autoScanIdx = 0;

// ── UTILS ─────────────────────────────────────────────
const INR   = n => '₹' + Math.abs(Math.round(n||0)).toLocaleString('en-IN');
const PCT   = n => (Math.round((n||0)*10)/10) + '%';
const fP    = v => v==null?'—':(v>=0?'+':'')+v.toFixed(2)+'%';
const uid   = () => Date.now().toString(36)+Math.random().toString(36).slice(2,5);
const g     = id => { const e=document.getElementById(id); return e?e.value.trim():''; };
const el    = id => document.getElementById(id);
const today = () => new Date().toISOString().slice(0,10);
const toMonth = d => new Date(d).toLocaleDateString('en-IN',{month:'short',year:'2-digit'}).replace(' ','-');
const getCurMonth = () => new Date().toLocaleDateString('en-IN',{month:'short',year:'2-digit'}).replace(' ','-');

// ── SPARKLINES ────────────────────────────────────────
function drawSpark(canvas, isUp) {
  if (!canvas) return;
  const W = canvas.offsetWidth||220, H = 30;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  let v = H*.5; const pts = [];
  for (let i=0; i<48; i++) { v += (Math.random()-(isUp?.38:.62))*3; v=Math.max(3,Math.min(H-3,v)); pts.push(v); }
  const col = isUp ? '#089981' : '#f23645';
  const gr = ctx.createLinearGradient(0,0,0,H);
  gr.addColorStop(0, isUp?'rgba(8,153,129,.15)':'rgba(242,54,69,.12)');
  gr.addColorStop(1,'rgba(255,255,255,0)');
  ctx.beginPath();
  pts.forEach((p,i)=>{ const x=i/(pts.length-1)*W; i?ctx.lineTo(x,p):ctx.moveTo(x,p); });
  ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath(); ctx.fillStyle=gr; ctx.fill();
  ctx.beginPath();
  pts.forEach((p,i)=>{ const x=i/(pts.length-1)*W; i?ctx.lineTo(x,p):ctx.moveTo(x,p); });
  ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.stroke();
}

// ── INIT ──────────────────────────────────────────────
window.addEventListener('load', () => {
  const sc=localStorage.getItem('fn_cid'), ss=localStorage.getItem('fn_sid');
  if (PRECONFIGURED_CLIENT_ID) { el('clientId').value=PRECONFIGURED_CLIENT_ID; el('clientId').readOnly=true; el('clientId-group').style.display='none'; }
  else if (sc) el('clientId').value=sc;
  if (PRECONFIGURED_SHEET_ID) { el('sheetId').value=PRECONFIGURED_SHEET_ID; el('sheetId').readOnly=true; el('sheetId-group').style.display='none'; }
  else if (ss) el('sheetId').value=ss;
  if (PRECONFIGURED_CLIENT_ID && PRECONFIGURED_SHEET_ID && el('form-instructions')) el('form-instructions').style.display='none';
  curMonth=getCurMonth(); selMonth=curMonth;
  buildMonthTabs(); setDateDefaults();
  document.querySelectorAll('.mov').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('open');}));
});

// ── AUTH ──────────────────────────────────────────────
async function startAuth() {
  const cid=PRECONFIGURED_CLIENT_ID||g('clientId'), sid=PRECONFIGURED_SHEET_ID||g('sheetId');
  if (!cid) { showAlert('Please enter your Google OAuth Client ID'); return; }
  localStorage.setItem('fn_cid',cid); if(sid){localStorage.setItem('fn_sid',sid);sheetId=sid;}
  clientId=cid; showAlert('Opening Google sign-in…','info'); el('connectBtn').disabled=true;
  try { await loadGIS(); buildTokenClient().requestAccessToken({prompt:'consent'}); }
  catch(e) { showAlert('Failed: '+e.message); el('connectBtn').disabled=false; }
}
function loadGIS() {
  return new Promise((res,rej)=>{
    if(window.google?.accounts){res();return;}
    const s=document.createElement('script'); s.src='https://accounts.google.com/gsi/client'; s.onload=res; s.onerror=rej; document.head.appendChild(s);
  });
}
function buildTokenClient(silent=false) {
  return google.accounts.oauth2.initTokenClient({ client_id:clientId, scope:SCOPES, prompt:silent?'':undefined,
    callback: async r => {
      if(r.error){if(!silent){showAlert('Auth error: '+r.error);el('connectBtn').disabled=false;}else showReloginBanner();return;}
      gToken=r.access_token; clearTimeout(tokenExpiryTimer);
      tokenExpiryTimer=setTimeout(silentRefresh,(3600-300)*1000);
      if(!silent) await onAuth();
      else { setSyncStatus('● Synced'); toast('Session refreshed','ok'); }
    }});
}
async function silentRefresh(){try{buildTokenClient(true).requestAccessToken({prompt:''});}catch{showReloginBanner();}}
function showReloginBanner(){
  if(el('relogin-banner'))return;
  const b=document.createElement('div'); b.id='relogin-banner';
  b.innerHTML=`<span>⚠ Session expired — please sign in again</span><button onclick="relogin()" style="background:var(--orange);color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-weight:700;font-size:11px">Sign in again</button>`;
  document.body.appendChild(b); setSyncStatus('! Session expired');
}
function relogin(){const b=el('relogin-banner');if(b)b.remove();silentRefresh();}
async function onAuth(){
  try {
    const u=await(await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+gToken}})).json();
    el('user-name').textContent=(u.name||u.email||'User').split(' ')[0];
    el('user-av').textContent=((u.name||u.email||'U')[0]).toUpperCase();
    if(!sheetId) await createSheet(); else await verifySheet();
    await initHeaders(); showApp(); await syncAll(); startGoldRefresh(); startAutoScan();
  } catch(e){showAlert('Error: '+e.message);el('connectBtn').disabled=false;}
}
async function createSheet(){
  showAlert('Creating your FinNova spreadsheet…','info');
  const r=await api('POST','https://sheets.googleapis.com/v4/spreadsheets',{properties:{title:'FinNova — Personal Finance'},sheets:Object.values(SHEETS).map(t=>({properties:{title:t}}))});
  sheetId=r.spreadsheetId; localStorage.setItem('fn_sid',sheetId);
}
async function verifySheet(){
  const r=await api('GET',`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`);
  const exist=r.sheets.map(s=>s.properties.title);
  const missing=Object.values(SHEETS).filter(s=>!exist.includes(s));
  if(missing.length) await api('POST',`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,{requests:missing.map(t=>({addSheet:{properties:{title:t}}}))});
}
async function initHeaders(){
  const hdrs={[SHEETS.income]:[['ID','Desc','Cat','Amount','Date','Month','Notes']],[SHEETS.expenses]:[['ID','Desc','Cat','Amount','Date','Month','Notes']],[SHEETS.mf]:[['ID','Name','Cat','SIP','Start','Units','NAV','Notes']],[SHEETS.chits]:[['ID','Name','Value','Months','Done','Monthly','StartMo','Comm','Status']],[SHEETS.chitPay]:[['ID','Month','ChitName','Amount','Status','Notes']],[SHEETS.inv]:[['ID','Name','Type','Monthly','Value','Target','Notes']],[SHEETS.ins]:[['ID','Name','Type','Premium','Assured','Renewal','Status']],[SHEETS.goals]:[['ID','Name','Target','Years','Saved','Notes']],[SHEETS.assets]:[['ID','Name','Type','Value','Updated','Notes']],[SHEETS.liab]:[['ID','Name','Type','Amount','Updated','Notes']]};
  const checks=await Promise.all(Object.keys(hdrs).map(s=>getRange(s+'!A1')));
  const tw=[]; Object.keys(hdrs).forEach((s,i)=>{if(!checks[i]?.[0])tw.push({range:s+'!A1',values:hdrs[s]});});
  if(tw.length) await batchSet(tw);
}
function showApp(){el('login-screen').style.display='none';el('app').style.display='block';setDateDefaults();}
function showAlert(msg,type='err'){el('login-alert').innerHTML=`<div class="alert alert-${type}">${msg}</div>`;}
function setSyncStatus(txt){if(el('sb-sync'))el('sb-sync').textContent=txt;}
function signOut(){if(!confirm('Sign out?'))return;gToken=null;clearTimeout(tokenExpiryTimer);clearInterval(goldTimer);clearInterval(scanTimer);Object.values(charts).forEach(c=>c&&c.destroy&&c.destroy());charts={};el('app').style.display='none';el('login-screen').style.display='flex';el('connectBtn').disabled=false;el('login-alert').innerHTML='';}

// ── SHEETS API ────────────────────────────────────────
async function api(method,url,body,retry=true){
  const opts={method,headers:{Authorization:'Bearer '+gToken,'Content-Type':'application/json'}};
  if(body) opts.body=JSON.stringify(body);
  const r=await fetch(url,opts);
  if(r.status===401&&retry){
    await new Promise(res=>{google.accounts.oauth2.initTokenClient({client_id:clientId,scope:SCOPES,prompt:'',callback:r2=>{if(!r2.error)gToken=r2.access_token;res();}}).requestAccessToken({prompt:''});});
    return api(method,url,body,false);
  }
  if(!r.ok){const e=await r.json();throw new Error(e.error?.message||'API '+r.status);}
  return r.json();
}
async function getRange(range){try{const r=await api('GET',`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`);return r.values||[];}catch{return[];}}
async function appendRow(sheet,row){await api('POST',`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheet}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{values:[row]});}
async function batchSet(data){await api('POST',`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,{valueInputOption:'RAW',data});}
let sgMap={};
async function getSheetGid(t){if(sgMap[t])return sgMap[t];const r=await api('GET',`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`);r.sheets.forEach(s=>sgMap[s.properties.title]=s.properties.sheetId);return sgMap[t];}
async function deleteSheetRow(sheet,idx){const gid=await getSheetGid(sheet);await api('POST',`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,{requests:[{deleteDimension:{range:{sheetId:gid,dimension:'ROWS',startIndex:idx,endIndex:idx+1}}}]});}

// ── SYNC ──────────────────────────────────────────────
async function syncAll(){
  setSyncStatus('⏳ Syncing…');
  try {
    await Promise.all(Object.keys(cache).map(k=>loadCache(k)));
    renderCurrentPage(); renderTickerBar(); renderFinanceStrip(); updateGoldSidebar();
    el('last-sync').textContent='Synced '+new Date().toLocaleTimeString();
    setSyncStatus('● Synced');
    toast('Synced with Google Sheets','ok');
  } catch(e){setSyncStatus('! Error');toast('Sync failed: '+e.message,'err');}
}
async function loadCache(key){const sh=SHEETS[key];if(!sh)return;const rows=await getRange(sh+'!A2:Z500');cache[key]=rows.filter(r=>r[0]);}

// ══════════════════════════════════════════════════════
//  LIVE GOLD — corsproxy.io + Yahoo Finance (like NEXUS)
//  Fetches: GC=F (Comex gold futures) + USDINR=X
//  Formula: (Comex × USD/INR) ÷ 31.1035 × 10 × 1.15 × 1.03
//  This gives MCX India equivalent (base exchange price).
//  Note: Indian retail prices include additional local premiums.
// ══════════════════════════════════════════════════════
async function fetchOne(sym) {
  try {
    const r = await fetch(`${PROXY}?symbol=${encodeURIComponent(sym)}`);
    if (!r.ok) return null;
    const j = await r.json();
    const m = j?.chart?.result?.[0]?.meta;
    if (!m?.regularMarketPrice) return null;
    const prev = m.chartPreviousClose || m.regularMarketPreviousClose || m.regularMarketPrice;
    return { sym, price:m.regularMarketPrice, prev, chg:m.regularMarketPrice-prev, pct:(m.regularMarketPrice-prev)/prev*100 };
  } catch { return null; }
}

async function fetchGold() {
  try {
    const [gcRes, fxRes] = await Promise.all([fetchOne('GC=F'), fetchOne('USDINR=X')]);

    if (!gcRes || !fxRes) {
      el('sb-gold-price').textContent = 'Retrying…';
      setTimeout(fetchGold, 10000);
      return;
    }

    const comex  = gcRes.price;
    const prevC  = gcRes.prev;
    const usdInr = fxRes.price;

    // MCX India formula
    const base   = (comex * usdInr) / 31.1035 * 10;
    const mcx    = base * 1.15 * 1.03;
    const prevBase = (prevC * usdInr) / 31.1035 * 10;
    const prevMcx  = prevBase * 1.15 * 1.03;

    goldData = {
      comex, usdinr:usdInr, mcx,
      change:     comex - prevC,
      changePct:  (comex - prevC) / prevC * 100,
      mcxChange:  mcx - prevMcx,
      lastUpdate: new Date()
    };

    updateGoldSidebar();
    renderTickerBar();
    const pid = document.querySelector('.page.active')?.id?.replace('page-','');
    if (pid === 'dashboard') { renderDashGold(); }
    if (pid === 'gold')      { renderGoldFull(); }
    calcGoldImpact();
  } catch(e) {
    console.warn('Gold fetch error:', e.message);
    el('sb-gold-price').textContent = 'Unavailable';
  }
}

function startGoldRefresh() { fetchGold(); goldTimer = setInterval(fetchGold, 5*60*1000); }

function updateGoldSidebar() {
  const {comex, changePct, mcx} = goldData; if (!comex) return;
  const sign = changePct>=0?'+':'';
  el('sb-gold-price').textContent = `$${comex.toFixed(2)} (${sign}${changePct.toFixed(2)}%)`;
  el('sb-gold-sub').textContent   = `MCX: ${INR(mcx)}/10g`;
}

// ── GOLD WIDGET HTML ──────────────────────────────────
function buildGoldWidget() {
  const {comex,usdinr,mcx,change,changePct,mcxChange,lastUpdate} = goldData;
  if (!comex) return `<div class="gold-loading">Fetching live Comex + USD/INR via Yahoo Finance…<br><span style="font-size:10px;color:var(--muted);margin-top:4px;display:block">Uses corsproxy.io · Updates every 5 min</span></div>`;
  const up=change>=0, sign=up?'+':'', cls=up?'grc-up':'grc-dn';
  const g24=mcx/10, g22=g24*(22/24), g18=g24*(18/24);
  const time=lastUpdate?lastUpdate.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'—';
  const per1=(usdinr/31.1035)*10*1.15*1.03;
  return `
  <div class="gold-head">
    <div><div class="gold-head-title">Live Gold Rates · Comex + MCX India</div>
    <div class="gold-head-sub">Yahoo Finance via corsproxy · Updated ${time} · Refreshes every 5 min · MCX = (Comex × USD/INR) ÷ 31.1035 × 10 × 1.15 × 1.03</div></div>
    <button class="gold-refresh-btn" onclick="fetchGold()">↻ Refresh</button>
  </div>
  <div class="gold-rates">
    <div class="gold-rate-cell"><div class="grc-label">Comex Gold</div><div class="grc-val">$${comex.toFixed(2)}</div><div class="grc-unit">USD / Troy oz · NY Futures</div><div class="grc-change ${cls}">${sign}$${change.toFixed(2)} (${sign}${changePct.toFixed(2)}%)</div></div>
    <div class="gold-rate-cell"><div class="grc-label">USD / INR</div><div class="grc-val">₹${usdinr.toFixed(2)}</div><div class="grc-unit">Live exchange rate</div><div class="grc-change grc-neu">Live</div></div>
    <div class="gold-rate-cell"><div class="grc-label">MCX India (24K)</div><div class="grc-val">${INR(mcx)}</div><div class="grc-unit">Per 10g · Base price excl. retail premium</div><div class="grc-change ${cls}">${sign}${INR(mcxChange)}/10g</div></div>
    <div class="gold-rate-cell"><div class="grc-label">24K Per Gram</div><div class="grc-val">${INR(g24)}</div><div class="grc-unit">Base · Jeweller adds ₹300-600/g making</div><div class="grc-change grc-neu">Base price</div></div>
  </div>
  <div class="gold-purity-row">
    <div class="gold-purity-cell"><div class="gpc-purity">24K · 999</div><div class="gpc-price">${INR(g24)}/g</div><div class="gpc-sub">${INR(mcx)}/10g</div></div>
    <div class="gold-purity-cell"><div class="gpc-purity">22K · 916</div><div class="gpc-price">${INR(g22)}/g</div><div class="gpc-sub">${INR(g22*10)}/10g</div></div>
    <div class="gold-purity-cell"><div class="gpc-purity">18K · 750</div><div class="gpc-price">${INR(g18)}/g</div><div class="gpc-sub">${INR(g18*10)}/10g</div></div>
    <div class="gold-purity-cell"><div class="gpc-purity">14K · 585</div><div class="gpc-price">${INR(g24*.585)}/g</div><div class="gpc-sub">${INR(g24*.585*10)}/10g</div></div>
  </div>
  <div class="gold-impact-band">
    <span class="gib-label">Comex $1 move →</span>
    <span class="gib-val">MCX +${INR(per1)}/10g</span>
    <span class="gib-val">Per gram +${INR(per1/10)}</span>
    <span class="gib-val" style="font-size:10px;color:var(--muted)">Note: Retail jeweller price will be 20-35% higher than MCX base shown above</span>
  </div>`;
}

// ══════════════════════════════════════════════════════
//   TICKER BAR
// ══════════════════════════════════════════════════════
function renderTickerBar(){
  const {comex,usdinr,mcx,changePct} = goldData;
  const m=curMonth;
  const ti=cache.income.filter(r=>r[5]===m).reduce((s,r)=>s+(+r[3]||0),0);
  const te=cache.expenses.filter(r=>r[5]===m).reduce((s,r)=>s+(+r[3]||0),0);
  const sur=ti-te, nwa=cache.assets.reduce((s,r)=>s+(+r[3]||0),0), nwl=cache.liab.reduce((s,r)=>s+(+r[3]||0),0);
  const mfv=cache.mf.reduce((s,r)=>s+(+r[5]||0)*(+r[6]||0),0);
  const set=(vi,ci,val,pctStr,cls_)=>{ const v=el(vi),c=el(ci); if(v)v.textContent=val; if(c){c.textContent=pctStr||'live';c.className='tp-chg '+(cls_==='up'?'up-chip':cls_==='dn'?'dn-chip':'neu-chip');} };
  if(comex) {
    set('tp-comex','tp-comex-c','$'+comex.toFixed(2),fP(changePct),changePct>=0?'up':'dn');
    set('tp-mcx','tp-mcx-c',INR(mcx),null,'neu');
    if(el('tp-inr'))el('tp-inr').textContent='₹'+usdinr.toFixed(2);
  }
  if(el('tp-surplus')){el('tp-surplus').textContent=INR(sur);el('tp-surplus').className='tp-val '+(sur>=0?'up':'dn');}
  if(el('tp-nw')){el('tp-nw').textContent=INR(nwa-nwl);el('tp-nw').className='tp-val '+((nwa-nwl)>=0?'up':'dn');}
  if(el('tp-mf'))el('tp-mf').textContent=INR(mfv);
  const scrollHtml=(cache.chits.map(r=>`<span class="tp" style="display:inline-flex"><span class="tp-sym">${r[1]||'CHIT'}</span><span class="tp-val">${INR(r[5]||0)}/mo</span><span class="tp-chg neu-chip">${r[8]||'Active'}</span></span>`).join('')+`<span class="tp" style="display:inline-flex"><span class="tp-sym">CHIT PAID</span><span class="tp-val">${INR(cache.chitPay.reduce((s,r)=>s+(+r[3]||0),0))}</span></span><span class="tp" style="display:inline-flex"><span class="tp-sym">NPS</span><span class="tp-val">${INR(cache.inv.filter(r=>r[2]==='NPS').reduce((s,r)=>s+(+r[4]||0),0))}</span></span>`||'<span class="tp" style="display:inline-flex"><span class="tp-sym">Add data to see live stats</span></span>').repeat(2);
  if(el('tp-scroll-inner'))el('tp-scroll-inner').innerHTML=scrollHtml;
}

// ── FINANCE STRIP ─────────────────────────────────────
function renderFinanceStrip(){
  const m=curMonth;
  const ti=cache.income.filter(r=>r[5]===m).reduce((s,r)=>s+(+r[3]||0),0);
  const te=cache.expenses.filter(r=>r[5]===m).reduce((s,r)=>s+(+r[3]||0),0);
  const rate=ti>0?(ti-te)/ti*100:0;
  if(el('fs-income'))el('fs-income').textContent=INR(ti);
  if(el('fs-expenses'))el('fs-expenses').textContent=INR(te);
  if(el('fs-rate'))el('fs-rate').textContent=PCT(rate);
  const html=(cache.mf.slice(0,4).map(r=>`<span class="fsi"><span class="fsi-sym">${(r[1]||'FUND').substring(0,12).toUpperCase()}</span><span>${INR((+r[5]||0)*(+r[6]||0))}</span></span>`).join('')+cache.goals.slice(0,3).map(r=>`<span class="fsi"><span class="fsi-sym">${(r[1]||'GOAL').substring(0,10).toUpperCase()}</span><span>${INR(r[4]||0)} saved</span></span>`).join('')+(cache.ins.length?`<span class="fsi"><span class="fsi-sym">INSURANCE</span><span>${INR(cache.ins.reduce((s,r)=>s+(+r[3]||0),0))}/yr</span></span>`:'')||'<span class="fsi"><span class="fsi-sym">Portfolio</span><span>Add entries to see live data</span></span>').repeat(2);
  if(el('fs-scroll-inner'))el('fs-scroll-inner').innerHTML=html;
}

// ── EXPENSE HEATMAP ───────────────────────────────────
function renderExpHeatmap(){
  const hmEl=el('exp-heatmap'); if(!hmEl)return;
  const cats={};
  cache.expenses.filter(r=>r[5]===curMonth).forEach(r=>{const c=r[2]||'Other';cats[c]=(cats[c]||0)+(+r[3]||0);});
  if(!Object.keys(cats).length){hmEl.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:18px;color:var(--muted);font-size:11px">No expenses this month — add entries to see heatmap</div>';return;}
  const maxV=Math.max(...Object.values(cats),1);
  hmEl.innerHTML=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([c,v])=>{
    const pct=v/maxV;
    const bg=pct>.5?`rgba(242,54,69,${.1+pct*.55})`:`rgba(8,153,129,${.07+pct*.55})`;
    const txtCol=pct>.5?'#c42030':'#058068';
    return `<div class="hm-cell" style="background:${bg}" title="${c}: ${INR(v)}"><div class="hm-name">${c}</div><div class="hm-val" style="color:${txtCol}">${INR(v)}</div></div>`;
  }).join('');
}

// ── AUTO-SCAN ─────────────────────────────────────────
const AUTO_SCANS=[
  ()=>{const ti=cache.income.filter(r=>r[5]===curMonth).reduce((s,r)=>s+(+r[3]||0),0);const te=cache.expenses.filter(r=>r[5]===curMonth).reduce((s,r)=>s+(+r[3]||0),0);const rt=ti>0?(ti-te)/ti*100:0;return{who:'⚡ Budget Scan',col:rt>=20?'var(--green)':'var(--orange)',body:`${curMonth}: Income <strong>${INR(ti)}</strong> · Expenses <strong>${INR(te)}</strong> · Savings rate <strong>${PCT(rt)}</strong> ${rt>=20?'✓ On target':'⚠ Below 20% target'}`};},
  ()=>{const{comex,usdinr,mcx,changePct}=goldData;if(!comex)return{who:'🪙 Gold Scan',col:'var(--gold)',body:'Fetching live gold data…'};const sign=changePct>=0?'+':'';return{who:'🪙 Gold Scan',col:changePct>=0?'var(--green)':'var(--red)',body:`Comex <strong>$${comex.toFixed(2)}</strong> (${sign}${changePct.toFixed(2)}%) · MCX India <strong>${INR(mcx)}/10g</strong> · 24K base <strong>${INR(mcx/10)}/g</strong> · USD/INR ${usdinr.toFixed(2)}`};},
  ()=>{const mfv=cache.mf.reduce((s,r)=>s+(+r[5]||0)*(+r[6]||0),0);const sip=cache.mf.reduce((s,r)=>s+(+r[3]||0),0);return{who:'📊 Portfolio Scan',col:'var(--blue)',body:`MF Portfolio: <strong>${INR(mfv)}</strong> total · <strong>${INR(sip)}/mo</strong> SIP · ${cache.mf.length} funds · ${sip===0?'⚠ Start a Nifty 50 SIP today':'✓ Compounding in progress'}`};},
  ()=>{const chitTot=cache.chits.reduce((s,r)=>s+(+r[5]||0),0);const paid=cache.chitPay.reduce((s,r)=>s+(+r[3]||0),0);return{who:'🏦 Chit Scan',col:'var(--orange)',body:`${cache.chits.length} active chit groups · Monthly: <strong>${INR(chitTot)}</strong> · Total paid: <strong>${INR(paid)}</strong> · When complete, redirect to equity MFs`};},
  ()=>{const npsV=cache.inv.filter(r=>r[2]==='NPS').reduce((s,r)=>s+(+r[4]||0),0);const npsM=cache.inv.filter(r=>r[2]==='NPS').reduce((s,r)=>s+(+r[3]||0),0);return{who:'📈 NPS Scan',col:'var(--violet)',body:`NPS corpus: <strong>${INR(npsV)}</strong> · Monthly: <strong>${INR(npsM)}</strong> · ${npsM>=5000?'✓ 80CCD(1B) benefit active':'⚠ Increase NPS to claim extra ₹50K deduction'}`};},
];
function startAutoScan(){setTimeout(runAutoScan,4000);scanTimer=setInterval(runAutoScan,3*60*1000);}
function runAutoScan(){
  const feed=el('scan-feed'); if(!feed)return;
  const scan=AUTO_SCANS[autoScanIdx%AUTO_SCANS.length](); autoScanIdx++;
  if(!scan)return;
  const tid='sc'+Date.now();
  const th=document.createElement('div'); th.id=tid; th.className='scan-item auto';
  th.innerHTML=`<div class="scan-head"><span class="scan-who" style="color:${scan.col}">${scan.who}</span></div><div class="thinking"><div class="tdot"></div><div class="tdot"></div><div class="tdot"></div></div>`;
  feed.insertBefore(th,feed.firstChild);
  while(feed.children.length>4)feed.removeChild(feed.lastChild);
  setTimeout(()=>{const item=el(tid);if(!item)return;item.innerHTML=`<div class="scan-head"><span class="scan-who" style="color:${scan.col}">${scan.who}</span><span class="scan-time">${new Date().toLocaleTimeString()}</span></div><div class="scan-body">${scan.body}</div>`;},1200);
}

// ── PRESET CHIPS ──────────────────────────────────────
const PRESETS={
  '📊 Monthly Briefing':()=>{runAutoScan();toast('Budget scan running…','ok');},
  '🪙 Gold Analysis':   ()=>showPage('gold',null),
  '💰 Budget Check':    ()=>runAutoScan(),
  '📈 Investment Review':()=>showPage('mf',null),
  '🏦 Chit Status':     ()=>showPage('chits',null),
  '🧾 Tax Summary':     ()=>showPage('tax',null),
};
function doPreset(btnEl){const fn=PRESETS[btnEl.textContent.trim()];if(fn)fn();}

// ── CHARTS ────────────────────────────────────────────
function dChart(k){if(charts[k]){charts[k].destroy();delete charts[k];}}
function getLast6(){const now=new Date(),m=[];for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);m.push(d.toLocaleDateString('en-IN',{month:'short',year:'2-digit'}).replace(' ','-'));}return m;}

function initCashflow(){
  dChart('cf'); const c=el('cashflow-chart'); if(!c)return;
  const mo=getLast6();
  const id=mo.map(m=>cache.income.filter(r=>r[5]===m).reduce((s,r)=>s+(+r[3]||0),0));
  const ed=mo.map(m=>cache.expenses.filter(r=>r[5]===m).reduce((s,r)=>s+(+r[3]||0),0));
  charts['cf']=new Chart(c,{type:'bar',data:{labels:mo,datasets:[{label:'Income',data:id,backgroundColor:'#089981',borderRadius:3,borderSkipped:false},{label:'Expenses',data:ed,backgroundColor:'#f23645',borderRadius:3,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{family:"'DM Mono'"}}},y:{grid:{color:'#e2e6ed'},ticks:{callback:v=>'₹'+(v/1000)+'k',font:{family:"'DM Mono'"}}}},animation:{duration:500}}});
}
function initExpDonut(cid,lid){
  dChart(cid); const c=el(cid); if(!c)return;
  const cats={}; cache.expenses.filter(r=>r[5]===curMonth).forEach(r=>{const ct=r[2]||'Other';cats[ct]=(cats[ct]||0)+(+r[3]||0);});
  const labels=Object.keys(cats),vals=Object.values(cats),cols=labels.map(l=>CAT_COLORS[l]||'#9aa4b2');
  charts[cid]=new Chart(c,{type:'doughnut',data:{labels,datasets:[{data:vals,backgroundColor:cols,borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ${INR(c.raw)}`}}},animation:{duration:500}}});
  if(lid&&el(lid))el(lid).innerHTML=labels.map((l,i)=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:11px"><span style="display:flex;align-items:center;gap:5px;color:var(--sub)"><span style="width:7px;height:7px;border-radius:2px;background:${cols[i]};display:inline-block"></span>${l}</span><span style="font-family:'DM Mono',monospace;font-size:11px">${INR(vals[i])}</span></div>`).join('');
}
function initSurplusLine(){
  dChart('sl'); const c=el('surplus-line'); if(!c)return;
  const mo=getLast6();
  const d=mo.map(m=>{const i=cache.income.filter(r=>r[5]===m).reduce((s,r)=>s+(+r[3]||0),0);const e=cache.expenses.filter(r=>r[5]===m).reduce((s,r)=>s+(+r[3]||0),0);return i-e;});
  charts['sl']=new Chart(c,{type:'line',data:{labels:mo,datasets:[{label:'Surplus',data:d,borderColor:'#c8a84b',backgroundColor:'rgba(200,168,75,.08)',fill:true,tension:.4,pointRadius:4,pointBackgroundColor:'#c8a84b',pointBorderColor:'#fff',pointBorderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ${INR(c.raw)}`}}},scales:{x:{grid:{display:false},ticks:{font:{family:"'DM Mono'"}}},y:{grid:{color:'#e2e6ed'},ticks:{callback:v=>'₹'+(v/1000)+'k',font:{family:"'DM Mono'"}}}},animation:{duration:500}}});
}
function initMFPie(){
  dChart('mfp'); const c=el('mf-pie'); if(!c||!cache.mf.length)return;
  const cats={}; cache.mf.forEach(r=>{cats[r[2]||'Other']=(cats[r[2]||'Other']||0)+(+r[5]||0)*(+r[6]||0);});
  const labels=Object.keys(cats),vals=Object.values(cats);
  charts['mfp']=new Chart(c,{type:'doughnut',data:{labels,datasets:[{data:vals,backgroundColor:['#1a2436','#2962ff','#0B7285','#c8a84b','#089981'].slice(0,labels.length),borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:'58%',plugins:{legend:{position:'bottom',labels:{font:{size:10}}}},animation:{duration:500}}});
}

// ── NAVIGATION ────────────────────────────────────────
const PAGE_META={dashboard:['Dashboard','Your complete financial overview'],ie:['Income & Expenses','Track every rupee'],mf:['Mutual Funds','Portfolio & SIP tracker'],gold:['Gold Rates','Live Comex + MCX India · Yahoo Finance'],chits:['Chit Funds','Payment log & tracker'],inv:['Investments','NPS · Gold · Stocks · PPF'],ins:['Insurance','Policy management'],tax:['Tax Planning','80C · 80D · 80CCD(1B)'],goals:['Goals & Emergency','Financial goal planner'],health:['Financial Health','Signal scanner & action plan'],monthly:['Monthly Tracker','Month-by-month view'],nw:['Net Worth','Assets minus liabilities']};

function showPage(id,navEl){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));
  const pg=el('page-'+id); if(pg)pg.classList.add('active');
  if(navEl)navEl.classList.add('active');
  else { document.querySelectorAll('.ni').forEach(n=>{ if(n.dataset.page===id)n.classList.add('active'); }); }
  const[t,s]=PAGE_META[id]||[id,''];
  el('tb-title').textContent=t; el('tb-sub').textContent=s;
  renderPage(id);
}
function renderCurrentPage(){const a=document.querySelector('.page.active');if(a)renderPage(a.id.replace('page-',''));}
function renderPage(id){({dashboard:renderDashboard,ie:renderIE,mf:renderMF,gold:renderGoldFull,chits:renderChits,inv:renderInv,ins:renderIns,tax:renderTax,goals:renderGoals,health:renderHealth,monthly:renderMonthly,nw:renderNW}[id]||Function)();}

// ── DASHBOARD ─────────────────────────────────────────
function renderDashboard(){
  const m=curMonth;
  const ti=cache.income.filter(r=>r[5]===m).reduce((s,r)=>s+(+r[3]||0),0);
  const te=cache.expenses.filter(r=>r[5]===m).reduce((s,r)=>s+(+r[3]||0),0);
  const sur=ti-te, mfv=cache.mf.reduce((s,r)=>s+(+r[5]||0)*(+r[6]||0),0), inv=cache.inv.reduce((s,r)=>s+(+r[4]||0),0);
  const nwa=cache.assets.reduce((s,r)=>s+(+r[3]||0),0), nwl=cache.liab.reduce((s,r)=>s+(+r[3]||0),0);
  el('d-inc').textContent=INR(ti); el('d-exp').textContent=INR(te);
  el('d-sur').textContent=INR(sur); el('d-sur').className='kpi-val '+(sur>=0?'up':'dn');
  el('d-sur-pct').textContent=ti>0?PCT(sur/ti*100)+' savings rate':'—';
  el('d-inv').textContent=INR(mfv+inv); el('d-nw').textContent=INR(nwa-nwl);
  el('d-nw').className='kpi-val '+((nwa-nwl)>=0?'up':'dn');
  renderDashGold();
  const all=[...cache.income.filter(r=>r[5]===m).map(r=>({...r,_t:'i'})),...cache.expenses.filter(r=>r[5]===m).map(r=>({...r,_t:'e'}))].sort((a,b)=>new Date(b[4])-new Date(a[4])).slice(0,8);
  el('d-recent').innerHTML=all.map(r=>`<tr><td style="font-weight:600">${r[1]||'—'}</td><td><span class="badge badge-${r._t==='i'?'green':'orange'}">${r[2]||'—'}</span></td><td style="font-family:'DM Mono',monospace;color:var(--${r._t==='i'?'green':'red'})">${r._t==='i'?'+':'-'}${INR(r[3])}</td><td style="font-size:10px;color:var(--muted)">${r[4]||'—'}</td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:18px">No transactions this month</td></tr>';
  renderExpHeatmap();
  setTimeout(()=>{initCashflow();initExpDonut('exp-donut-dash','exp-donut-legend');initSurplusLine();},50);
}

function renderDashGold(){
  if(el('dash-gold-mini'))el('dash-gold-mini').innerHTML=buildGoldWidget();
  if(el('d-gold-val'))el('d-gold-val').textContent=goldData.mcx?INR(goldData.mcx/10)+'/g':'Fetching…';
  if(el('d-gold-sub'))el('d-gold-sub').textContent=goldData.comex?`$${goldData.comex.toFixed(2)} · ${fP(goldData.changePct)}`:'Loading…';
}

// ── IE ────────────────────────────────────────────────
function renderIE(){
  const m=selMonth;
  const inc=cache.income.filter(r=>r[5]===m), exp=cache.expenses.filter(r=>r[5]===m);
  const ti=inc.reduce((s,r)=>s+(+r[3]||0),0), te=exp.reduce((s,r)=>s+(+r[3]||0),0), sur=ti-te;
  el('ie-inc').textContent=INR(ti); el('ie-exp').textContent=INR(te);
  el('ie-sur').textContent=INR(sur); el('ie-sur').className='kpi-val '+(sur>=0?'up':'dn');
  el('ie-rate').textContent=ti>0?PCT(sur/ti*100):'0%';
  el('ie-inc-tot').textContent=INR(ti); el('ie-exp-tot').textContent=INR(te);
  el('ie-ic').textContent=inc.length+' entries'; el('ie-ec').textContent=exp.length+' entries';
  const mkList=(items,type,elId)=>{el(elId).innerHTML=items.length?items.map((r,i)=>`<div class="entry-row" style="grid-template-columns:7px 1fr auto auto auto auto"><div class="entry-dot" style="background:${CAT_COLORS[r[2]]||'#9aa4b2'}"></div><div><div class="entry-name">${r[1]||'—'}</div><div class="entry-note">${r[2]||''}${r[6]?' · '+r[6]:''}</div></div><span class="badge badge-${type==='i'?'green':'orange'}" style="font-size:9px">${r[2]||''}</span><div class="${type==='i'?'entry-inc':'entry-exp'}">${type==='i'?'+':'-'}${INR(r[3])}</div><div class="entry-date">${r[4]||''}</div><button class="del-btn" onclick="delEntry('${type==='i'?SHEETS.income:SHEETS.expenses}','${type==='i'?'income':'expenses'}',${i+1})">✕</button></div>`).join(''):`<div class="empty"><div class="empty-icon">📭</div><div class="empty-title">No ${type==='i'?'income':'expenses'} for ${m}</div></div>`;};
  mkList(inc,'i','ie-inc-list'); mkList(exp,'e','ie-exp-list');
}

// ── MF ────────────────────────────────────────────────
function renderMF(){
  const total=cache.mf.reduce((s,r)=>s+(+r[5]||0)*(+r[6]||0),0), sip=cache.mf.reduce((s,r)=>s+(+r[3]||0),0);
  const idx=cache.mf.filter(r=>r[2]==='India Index').reduce((s,r)=>s+(+r[5]||0)*(+r[6]||0),0);
  const us=cache.mf.filter(r=>r[2]==='US/International').reduce((s,r)=>s+(+r[5]||0)*(+r[6]||0),0);
  el('mf-val').textContent=INR(total); el('mf-sip').textContent=INR(sip)+'/mo'; el('mf-idx').textContent=INR(idx); el('mf-us').textContent=INR(us);
  el('mf-tbl').innerHTML=cache.mf.map((r,i)=>{const v=(+r[5]||0)*(+r[6]||0);return`<tr><td><div style="font-weight:600">${r[1]||'—'}</div><div style="font-size:10px;color:var(--muted)">${r[7]||''}</div></td><td><span class="badge badge-blue">${r[2]||'—'}</span></td><td style="font-family:'DM Mono',monospace">${INR(r[3]||0)}</td><td style="font-family:'DM Mono',monospace">${(+r[5]||0).toFixed(3)}</td><td style="font-family:'DM Mono',monospace">${INR(r[6]||0)}</td><td style="font-family:'DM Mono',monospace;font-weight:700;color:var(--gold)">${INR(v)}</td><td><button class="del-btn" onclick="delEntry('${SHEETS.mf}','mf',${i+1})">✕</button></td></tr>`;}).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:18px">No funds added yet</td></tr>';
  setTimeout(()=>initMFPie(),50); updateProj();
}
function updateProj(){const sip=+(el('proj-sip')?.value||5000);el('proj-out').innerHTML=[1,3,5,10,15,20].map(yr=>{const mo=yr*12,r2=0.12/12,v=sip*(((1+r2)**mo-1)/r2)*(1+r2);return`<div class="stat"><div class="stat-label">${yr} Yr${yr>1?'s':''}</div><div class="stat-val" style="font-size:12px;color:var(--gold)">${INR(v)}</div></div>`;}).join('');}

// ── GOLD FULL PAGE ────────────────────────────────────
function renderGoldFull(){
  ['gold-full-widget','dash-gold-mini'].forEach(id=>{if(el(id))el(id).innerHTML=buildGoldWidget();});
  calcGoldImpact(); renderGoldSensitivity();
  const{comex,usdinr,mcx,changePct}=goldData;
  if(el('g-comex'))el('g-comex').textContent=comex?'$'+comex.toFixed(2):'—';
  if(el('g-comex'))el('g-comex').className='kpi-val '+(changePct>=0?'up':'dn');
  if(el('g-fx'))el('g-fx').textContent=usdinr?'₹'+usdinr.toFixed(2):'—';
  if(el('g-mcx'))el('g-mcx').textContent=mcx?INR(mcx):'—';
  if(el('g-gram'))el('g-gram').textContent=mcx?INR(mcx/10):'—';
  if(el('gold-formula-live')&&comex)el('gold-formula-live').textContent=`(${comex.toFixed(2)} × ${usdinr.toFixed(2)}) ÷ 31.1035 × 10 × 1.15 × 1.03 = ${INR(mcx)}/10g`;
}
function calcGoldImpact(){
  const{mcx,usdinr,change}=goldData; if(!mcx)return;
  const grams=+(el('gold-grams')?.value||100), purity=+(el('gold-purity')?.value||1);
  const g24=mcx/10, perG=g24*purity, total=perG*grams;
  const per1=(usdinr/31.1035)*10*1.15*1.03/10*purity*grams;
  const todayChg=(change/goldData.comex)*total;
  const out=el('gold-impact-out'); if(!out)return;
  out.innerHTML=[{l:'Current Value',v:INR(total),c:'var(--gold)'},{l:"Today's Change",v:(todayChg>=0?'+':'')+INR(todayChg),c:todayChg>=0?'var(--green)':'var(--red)'},{l:'If Comex +$1',v:'+'+INR(per1),c:'var(--green)'},{l:'If Comex +$50',v:'+'+INR(per1*50),c:'var(--green)'},{l:'If Comex +$100',v:'+'+INR(per1*100),c:'var(--green)'},{l:'If Comex −$100',v:'−'+INR(per1*100),c:'var(--red)'}].map(s=>`<div class="stat"><div class="stat-label">${s.l}</div><div class="stat-val" style="font-size:12px;color:${s.c}">${s.v}</div></div>`).join('');
}
function renderGoldSensitivity(){
  const{usdinr}=goldData; const gs=el('gold-sensitivity'); if(!usdinr||!gs)return;
  const p=(usdinr/31.1035)*1.15*1.03;
  gs.innerHTML=`<table><thead><tr><th>Comex Move</th><th>24K /10g</th><th>24K /g</th><th>22K /g</th><th>18K /g</th><th>100g (24K)</th></tr></thead><tbody>${[['$1',1],['$10',10],['$25',25],['$50',50],['$100',100],['$200',200]].map(([l,m])=>`<tr><td style="font-weight:700">${l}</td><td class="up" style="font-family:'DM Mono',monospace">+${INR(p*10*m)}</td><td style="font-family:'DM Mono',monospace">+${INR(p*m)}</td><td style="font-family:'DM Mono',monospace">+${INR(p*m*.9167)}</td><td style="font-family:'DM Mono',monospace">+${INR(p*m*.75)}</td><td style="font-family:'DM Mono',monospace;font-weight:700;color:var(--green)">+${INR(p*m*100)}</td></tr>`).join('')}</tbody></table>`;
}

// ── REMAINING PAGE RENDERS ────────────────────────────
function renderChits(){
  const total=cache.chits.reduce((s,r)=>s+(+r[5]||0),0),paid=cache.chitPay.reduce((s,r)=>s+(+r[3]||0),0),payout=cache.chits.reduce((s,r)=>s+(+r[2]||0)*.95,0);
  el('cf-n').textContent=cache.chits.length;el('cf-mo').textContent=INR(total)+'/mo';el('cf-paid').textContent=INR(paid);el('cf-exp').textContent=INR(payout);
  const cols=['#c8a84b','#089981','#2962ff','#f23645','#0B7285'];
  el('chit-cards').innerHTML=cache.chits.map((r,i)=>{const done=+r[4]||0,tot=+r[3]||0,pct=tot>0?Math.round(done/tot*100):0,color=cols[i%cols.length],thisPaid=cache.chitPay.filter(p=>p[2]===r[1]).reduce((s,p)=>s+(+p[3]||0),0);
    return`<div class="chit-card"><div class="chit-accent" style="background:${color}"></div><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px"><div><div style="font-weight:700;font-size:13px;color:var(--head)">${r[1]||'Chit'}</div><div style="font-size:10px;color:var(--muted)">${r[6]||''} · ${INR(r[5]||0)}/mo</div></div><span class="badge badge-${r[8]==='Active'?'green':r[8]==='Planned'?'orange':'sub'}">${r[8]||'Active'}</span></div><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span style="color:var(--muted)">Value</span><span style="font-family:'DM Mono',monospace;font-weight:600">${INR(r[2]||0)}</span></div><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span style="color:var(--muted)">Progress</span><span style="font-family:'DM Mono',monospace;font-weight:600">${done}/${tot} months</span></div><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:9px"><span style="color:var(--muted)">Paid</span><span style="font-family:'DM Mono',monospace;font-weight:700;color:${color}">${INR(thisPaid)}</span></div><div class="progress"><div class="progress-fill" style="background:${color};width:${pct}%"></div></div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:3px"><span>${pct}% done</span><span>${tot-done} months left</span></div></div>`;}).join('')||`<div style="grid-column:1/-1"><div class="empty"><div class="empty-icon">🏦</div><div class="empty-title">No Chit Funds</div></div></div>`;
  const cumMap={};
  el('chit-log').innerHTML=cache.chitPay.map((r,i)=>{cumMap[r[2]]=(cumMap[r[2]]||0)+(+r[3]||0);return`<tr><td style="font-family:'DM Mono',monospace;font-weight:600">${r[1]||'—'}</td><td>${r[2]||'—'}</td><td style="font-family:'DM Mono',monospace">${INR(r[3]||0)}</td><td style="font-family:'DM Mono',monospace;color:var(--muted)">${INR(cumMap[r[2]])}</td><td><span class="badge badge-${r[4]==='Paid'?'green':r[4]==='Pending'?'orange':'red'}">${r[4]||'—'}</span></td><td><button class="del-btn" onclick="delEntry('${SHEETS.chitPay}','chitPay',${i+1})">✕</button></td></tr>`;}).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:18px">No payments logged</td></tr>';
  const sel=el('cp-chit'); if(sel)sel.innerHTML=cache.chits.map(r=>`<option>${r[1]}</option>`).join('');
}
function renderInv(){
  const nps=cache.inv.filter(r=>r[2]==='NPS').reduce((s,r)=>s+(+r[4]||0),0),gold=cache.inv.filter(r=>r[2]?.includes('Gold')).reduce((s,r)=>s+(+r[4]||0),0),stk=cache.inv.filter(r=>r[2]?.includes('Stocks')).reduce((s,r)=>s+(+r[4]||0),0),oth=cache.inv.filter(r=>r[2]==='PPF'||r[2]==='FD').reduce((s,r)=>s+(+r[4]||0),0);
  el('inv-nps').textContent=INR(nps);el('inv-gold').textContent=INR(gold);el('inv-stk').textContent=INR(stk);el('inv-oth').textContent=INR(oth);
  el('inv-tbl').innerHTML=cache.inv.map((r,i)=>`<tr><td style="font-weight:600">${r[1]||'—'}</td><td><span class="badge badge-teal">${r[2]||'—'}</span></td><td style="font-family:'DM Mono',monospace">${INR(r[3]||0)}/mo</td><td style="font-family:'DM Mono',monospace;font-weight:700;color:var(--gold)">${INR(r[4]||0)}</td><td style="font-family:'DM Mono',monospace;color:var(--muted)">${INR(r[5]||0)}</td><td style="font-size:11px;color:var(--muted)">${r[6]||''}</td><td><button class="del-btn" onclick="delEntry('${SHEETS.inv}','inv',${i+1})">✕</button></td></tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:18px">No investments added</td></tr>';
}
function renderIns(){
  const annual=cache.ins.reduce((s,r)=>s+(+r[3]||0),0),health=cache.ins.filter(r=>r[2]==='Health').reduce((s,r)=>s+(+r[3]||0),0);
  el('ins-ann').textContent=INR(annual);el('ins-mo').textContent=INR(annual/12)+'/mo';el('ins-n').textContent=cache.ins.length;el('ins-80d').textContent=INR(Math.min(health,25000));
  el('ins-tbl').innerHTML=cache.ins.map((r,i)=>`<tr><td style="font-weight:600">${r[1]||'—'}</td><td><span class="badge badge-orange">${r[2]||'—'}</span></td><td style="font-family:'DM Mono',monospace">${INR(r[3]||0)}/yr</td><td style="font-family:'DM Mono',monospace">${r[4]?INR(r[4]):'—'}</td><td style="font-size:11px;color:var(--muted)">${r[5]||'—'}</td><td><span class="badge badge-${r[6]==='Active'?'green':'red'}">${r[6]||'Active'}</span></td><td><button class="del-btn" onclick="delEntry('${SHEETS.ins}','ins',${i+1})">✕</button></td></tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:18px">No policies added</td></tr>';
}
function renderTax(){
  const npsAnn=cache.inv.filter(r=>r[2]==='NPS').reduce((s,r)=>s+(+r[3]||0),0)*12,lifeIns=cache.ins.filter(r=>r[2]==='Life/Endowment'||r[2]==='Term Life').reduce((s,r)=>s+(+r[3]||0),0),health=cache.ins.filter(r=>r[2]==='Health').reduce((s,r)=>s+(+r[3]||0),0);
  const t80c=Math.min(npsAnn+lifeIns,150000),tnps=Math.min(npsAnn,50000),t80d=Math.min(health,25000);
  el('tx-80c').textContent=INR(t80c);el('tx-nps').textContent=INR(tnps);el('tx-80d').textContent=INR(t80d);el('tx-saved').textContent=INR((t80c+tnps+t80d)*.05);
  el('tx-80c-list').innerHTML=[['NPS Personal Tier 1',npsAnn,'80C + 80CCD(1)'],['Life Insurance',lifeIns,'80C'],['ELSS Mutual Funds',0,'80C · Best returns'],['PPF Contribution',0,'80C · 7.1% tax-free'],['Term Insurance',cache.ins.filter(r=>r[2]==='Term Life').reduce((s,r)=>s+(+r[3]||0),0),'80C']].map(([n,v,t])=>`<div class="entry-row" style="grid-template-columns:1fr auto auto"><div><div class="entry-name">${n}</div><div class="entry-note">${t}</div></div><div style="font-family:'DM Mono',monospace;font-weight:600;color:var(--gold)">${INR(v)}</div><span class="badge badge-green">Eligible</span></div>`).join('');
  el('tx-other-list').innerHTML=[['Health Ins (80D)',t80d,'Max ₹25,000'],['NPS Extra (80CCD1B)',tnps,'Extra ₹50K over 80C'],['Parents Health',0,'₹50K if parents > 60']].map(([n,v,t])=>`<div class="entry-row" style="grid-template-columns:1fr auto"><div><div class="entry-name">${n}</div><div class="entry-note">${t}</div></div><div style="font-family:'DM Mono',monospace;font-weight:600;color:var(--teal)">${INR(v)}</div></div>`).join('');
}
function renderGoals(){
  const mo2=selMonth||curMonth,moExp=cache.expenses.filter(r=>r[5]===mo2).reduce((s,r)=>s+(+r[3]||0),0),tgt=moExp*6;
  el('ef-mo').textContent=INR(moExp);el('ef-tgt').textContent=INR(tgt);updateEF(tgt);
  const r2=0.12/12;
  el('goals-tbl').innerHTML=cache.goals.map((row,i)=>{const t=+row[2]||0,y=+row[3]||0,s=+row[4]||0,m3=y*12,sip=m3>0&&t>0?t/((((1+r2)**m3-1)/r2)*(1+r2)):0,pct=t>0?Math.min(100,s/t*100):0;return`<tr><td style="font-weight:600">${row[1]||'—'}</td><td style="font-family:'DM Mono',monospace">${INR(t)}</td><td>${y} yrs</td><td style="font-family:'DM Mono',monospace;font-weight:700;color:var(--gold)">${INR(sip)}/mo</td><td style="font-family:'DM Mono',monospace">${INR(s)}</td><td style="min-width:100px"><div class="progress" style="height:3px;margin-bottom:2px"><div class="progress-fill" style="background:var(--blue);width:${pct.toFixed(0)}%"></div></div><span style="font-size:10px;color:var(--muted)">${pct.toFixed(0)}%</span></td><td><button class="del-btn" onclick="delEntry('${SHEETS.goals}','goals',${i+1})">✕</button></td></tr>`;}).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:18px">No goals added yet</td></tr>';
}
function updateEF(tgtOv){const moExp=cache.expenses.filter(r=>r[5]===(selMonth||curMonth)).reduce((s,r)=>s+(+r[3]||0),0)||1;const tgt=tgtOv||moExp*6,bal=+(el('ef-bal')?.value||0),pct=Math.min(100,bal/tgt*100);if(el('ef-prog'))el('ef-prog').style.width=pct+'%';if(el('ef-pct'))el('ef-pct').textContent=Math.round(pct)+'% funded';if(el('ef-gap'))el('ef-gap').textContent='Shortfall: '+INR(Math.max(0,tgt-bal));}
function renderHealth(){
  const inc=cache.income.filter(r=>r[5]===curMonth).reduce((s,r)=>s+(+r[3]||0),0)||22000;
  const exp=cache.expenses.filter(r=>r[5]===curMonth).reduce((s,r)=>s+(+r[3]||0),0);
  const mfSip=cache.mf.reduce((s,r)=>s+(+r[3]||0),0),chitTot=cache.chits.reduce((s,r)=>s+(+r[5]||0),0);
  const svRate=inc>0?(inc-exp)/inc*100:0,invRate=inc>0?mfSip/inc*100:0,chitR=inc>0?chitTot/inc*100:0;
  const hasNPS=cache.inv.some(r=>r[2]==='NPS'),hasHealth=cache.ins.some(r=>r[2]==='Health');
  const pts=[svRate>=20?2:svRate>=10?1:0,2,invRate>=15?2:invRate>=5?1:0,chitR<=100?2:1,hasNPS?2:0,hasHealth?2:0];
  const score=Math.round(pts.reduce((a,b)=>a+b,0)/12*100);
  const scoreLbl=score>=75?'EXCELLENT':score>=55?'GOOD':score>=35?'REVIEW':'CRITICAL';
  const scoreCol=score>=75?'var(--green)':score>=55?'var(--blue)':score>=35?'var(--orange)':'var(--red)';
  if(el('health-score-num')){el('health-score-num').textContent=score;el('health-score-num').style.color=scoreCol;}
  if(el('health-score-lbl')){el('health-score-lbl').textContent=scoreLbl;el('health-score-lbl').style.color=scoreCol;}
  if(el('health-bars'))el('health-bars').innerHTML=[['Savings Rate',svRate,100,'var(--green)'],['Investment Rate',invRate,100,'var(--blue)'],['Health Cover',hasHealth?80:0,100,'var(--orange)'],['NPS Active',hasNPS?90:0,100,'#0B7285'],['Chit vs Income',Math.min(chitR,200),200,chitR<=100?'var(--green)':'var(--red)']].map(([l,v,mx,c])=>`<div class="bar-r"><span class="bar-lbl">${l}</span><span class="bar-pct" style="color:${c}">${v.toFixed(0)}%</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.min(v/mx*100,100)}%;background:${c}"></div></div>`).join('');
  const signals=[{sym:'SAVINGS',name:'Monthly Savings Rate',val:PCT(svRate),tgt:'≥ 20%',cls:svRate>=20?'c-good':svRate>=10?'c-review':'c-critical',badge:svRate>=20?'sb-good':svRate>=10?'sb-review':'sb-critical',sig:svRate>=20?'ON TARGET':svRate>=10?'IMPROVE':'CRITICAL',tags:svRate>=20?[{l:'On Track',c:'good'}]:[{l:'Below Target',c:'bad'}],r:svRate>=20?'Savings rate healthy. Build emergency fund next.':'Review fixed expenses — rent, chits, insurance. Target 20% savings before increasing investments.',up:svRate>=0},{sym:'MF SIP',name:'Investment Rate',val:PCT(invRate),tgt:'≥ 15%',cls:invRate>=15?'c-good':invRate>=5?'c-review':'c-critical',badge:invRate>=15?'sb-good':invRate>=5?'sb-review':'sb-critical',sig:invRate>=15?'ON TARGET':invRate>=5?'LOW':'START NOW',tags:invRate>=15?[{l:'Compounding',c:'good'}]:[{l:'Start SIP',c:'bad'},{l:'Nifty 50 Index',c:'warn'}],r:invRate>=15?'MF investment rate healthy. Mix: 60% India Index + 20% US + 20% Debt.':'Start ₹2,000/month Nifty 50 Index Fund SIP. Direct plan only. 12% CAGR long-term.',up:invRate>0},{sym:'CHIT RISK',name:'Chit Commitment vs Income',val:PCT(chitR),tgt:'< 100%',cls:chitR<=100?'c-good':chitR<=150?'c-review':'c-critical',badge:chitR<=100?'sb-good':chitR<=150?'sb-review':'sb-critical',sig:chitR<=100?'MANAGEABLE':'HIGH RISK',tags:chitR<=100?[{l:'Within Limits',c:'good'}]:[{l:'Exceeds Income',c:'bad'}],r:chitR<=100?'Chit commitment within income — healthy.':'Chit payments exceed salary. Document your funding source. Redirect to MFs after chits complete.',up:chitR<=100},{sym:'NPS',name:'Retirement via NPS',val:hasNPS?'ACTIVE':'MISSING',tgt:'Contributing',cls:hasNPS?'c-good':'c-review',badge:hasNPS?'sb-good':'sb-review',sig:hasNPS?'GOOD':'ADD NOW',tags:hasNPS?[{l:'80C',c:'good'},{l:'80CCD(1B)',c:'good'}]:[{l:'Missing Deduction',c:'bad'}],r:hasNPS?'NPS active. Ensure ₹50,000 above 80C limit for 80CCD(1B) extra deduction.':'Add NPS immediately. 80C + extra ₹50K 80CCD(1B) deduction + best retirement corpus.',up:hasNPS},{sym:'HEALTH INS',name:'Health Insurance',val:hasHealth?'ACTIVE':'MISSING',tgt:'Family floater ≥ ₹5L',cls:hasHealth?'c-good':'c-critical',badge:hasHealth?'sb-good':'sb-critical',sig:hasHealth?'COVERED':'CRITICAL GAP',tags:hasHealth?[{l:'80D Benefit',c:'good'}]:[{l:'No Cover',c:'bad'},{l:'Add Now',c:'bad'}],r:hasHealth?'Active. Add super top-up ₹50L cover for just ₹3-5k/year.':'No health insurance. One hospitalisation can wipe out savings. Add immediately.',up:hasHealth}];
  if(el('health-signals'))el('health-signals').innerHTML=signals.map((s,i)=>`<div class="sig-card ${s.cls}" style="animation-delay:${i*.05}s"><div class="sc-head"><div><div class="sc-sym">${s.sym}</div><div class="sc-name">${s.name}</div></div><div class="sig-badge ${s.badge}">${s.sig}</div></div><div class="sc-body"><div class="sc-val-row"><span class="sc-val">${s.val}</span><span class="sc-target">Target: ${s.tgt}</span></div><canvas class="sparkline" id="spH${i}"></canvas><div class="sc-tags">${s.tags.map(t=>`<span class="sc-tag ${t.c}">${t.l}</span>`).join('')}</div><div class="sc-reason">${s.r}</div></div></div>`).join('');
  setTimeout(()=>signals.forEach((_,i)=>drawSpark(el('spH'+i),signals[i].up)),80);
  const actions=[{cls:'nc-risk',cat:'URGENT',body:'Build Emergency Fund — ₹3–4L in liquid MF before investing elsewhere.',chips:['Priority 1'],ss:'Critical'},{cls:'nc-risk',cat:'CASH FLOW',body:'Chit payments may exceed salary. Document your funding source.',chips:['Verify'],ss:'High Risk'},{cls:'nc-warn',cat:'INSURANCE REVIEW',body:'Life insurance ₹1L/year — endowment gives 4–6%. Compare surrender value vs index fund after 5 years.',chips:['LIC'],ss:'Review'},{cls:'nc-info',cat:'SIP SIGNAL',body:'Start Nifty 50 Index Fund SIP — even ₹2,000/month. Direct Plan. 12% CAGR historical.',chips:['Nifty 50'],ss:'Bullish'},{cls:'nc-info',cat:'GOLD STRATEGY',body:'Sovereign Gold Bonds (SGB): 2.5% interest + price gain + zero capital gains tax at 8yr maturity.',chips:['SGB'],ss:'Positive'},{cls:'nc-gold',cat:'TAX ACTION',body:'Maximise 80CCD(1B) — ₹50,000 extra NPS contribution above 80C. Saves ₹2,500-10,000 in tax.',chips:['80CCD(1B)'],ss:'Act Now'}];
  if(el('health-actions'))el('health-actions').innerHTML=actions.map(a=>`<div class="news-card ${a.cls}"><div class="nc-cat">${a.cat}</div><div class="nc-body">${a.body}</div><div class="nc-foot"><span class="nc-time">FinNova Intelligence</span><span class="nc-sent" style="color:${a.cls==='nc-risk'?'var(--red)':a.cls==='nc-warn'?'var(--orange)':a.cls==='nc-gold'?'var(--gold-dk)':'var(--blue)'}">${a.ss}</span></div><div class="nc-chips">${a.chips.map(c=>`<span class="nc-chip${a.cls==='nc-gold'?' gold':''}">${c}</span>`).join('')}</div></div>`).join('');
}
function renderMonthly(){
  const m=selMonth||curMonth;
  const inc=cache.income.filter(r=>r[5]===m).reduce((s,r)=>s+(+r[3]||0),0),exp=cache.expenses.filter(r=>r[5]===m).reduce((s,r)=>s+(+r[3]||0),0),sur=inc-exp;
  el('mo-inc').textContent=INR(inc);el('mo-exp').textContent=INR(exp);el('mo-sur').textContent=INR(sur);el('mo-sur').className='kpi-val '+(sur>=0?'up':'dn');el('mo-rate').textContent=inc>0?PCT(sur/inc*100):'0%';
  const cats={};cache.expenses.filter(r=>r[5]===m).forEach(r=>{const c=r[2]||'Other';cats[c]=(cats[c]||0)+(+r[3]||0);});
  const maxC=Math.max(...Object.values(cats),1);
  el('mo-cats').innerHTML=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([c,v])=>`<div style="display:grid;grid-template-columns:120px 1fr 80px;align-items:center;gap:12px;margin-bottom:7px"><span style="font-size:11px;font-weight:600;color:var(--body)">${c}</span><div class="progress"><div class="progress-fill" style="background:${CAT_COLORS[c]||'#9aa4b2'};width:${(v/maxC*100).toFixed(0)}%"></div></div><span style="font-family:'DM Mono',monospace;font-size:11px;text-align:right">${INR(v)}</span></div>`).join('')||'<div class="empty"><div class="empty-icon">📊</div><div class="empty-title">No expenses for '+m+'</div></div>';
}
function renderNW(){
  const a=cache.assets.reduce((s,r)=>s+(+r[3]||0),0),l=cache.liab.reduce((s,r)=>s+(+r[3]||0),0),nw=a-l;
  el('nw-a').textContent=INR(a);el('nw-l').textContent=INR(l);el('nw-t').textContent=INR(nw);el('nw-t').className='kpi-val '+(nw>=0?'up':'dn');el('nw-ch').textContent='—';
  el('assets-tbl').innerHTML=cache.assets.map((r,i)=>`<tr><td style="font-weight:600">${r[1]||'—'}</td><td><span class="badge badge-green">${r[2]||'—'}</span></td><td style="font-family:'DM Mono',monospace;font-weight:700;color:var(--green)">${INR(r[3]||0)}</td><td style="font-size:10px;color:var(--muted)">${new Date().toLocaleDateString()}</td><td><button class="del-btn" onclick="delEntry('${SHEETS.assets}','assets',${i+1})">✕</button></td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">No assets yet</td></tr>';
  el('liab-tbl').innerHTML=cache.liab.map((r,i)=>`<tr><td style="font-weight:600">${r[1]||'—'}</td><td><span class="badge badge-red">${r[2]||'—'}</span></td><td style="font-family:'DM Mono',monospace;font-weight:700;color:var(--red)">${INR(r[3]||0)}</td><td style="font-size:10px;color:var(--muted)">${new Date().toLocaleDateString()}</td><td><button class="del-btn" onclick="delEntry('${SHEETS.liab}','liab',${i+1})">✕</button></td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">No liabilities yet</td></tr>';
}

// ── CRUD ──────────────────────────────────────────────
async function saveRow(sh,key,row,mid){try{await appendRow(sh,row);cache[key].push(row);closeModal(mid);renderCurrentPage();renderTickerBar();renderFinanceStrip();toast('Saved ✓','ok');}catch(e){toast('Error: '+e.message,'err');}}
async function delEntry(sh,key,idx){if(!confirm('Delete?'))return;try{await deleteSheetRow(sh,idx);cache[key].splice(idx-1,1);renderCurrentPage();renderTickerBar();renderFinanceStrip();toast('Deleted','ok');}catch(e){toast('Error: '+e.message,'err');}}
async function addIncome(){const d=g('ii-date')||today(),m=toMonth(d);if(!g('ii-desc')||!g('ii-amt')){toast('Enter description and amount','err');return;}await saveRow(SHEETS.income,'income',[uid(),g('ii-desc'),g('ii-cat'),g('ii-amt'),d,m,g('ii-note')],'add-inc-modal');}
async function addExpense(){const d=g('ei-date')||today(),m=toMonth(d);if(!g('ei-desc')||!g('ei-amt')){toast('Enter description and amount','err');return;}await saveRow(SHEETS.expenses,'expenses',[uid(),g('ei-desc'),g('ei-cat'),g('ei-amt'),d,m,g('ei-note')],'add-exp-modal');}
async function addMF(){await saveRow(SHEETS.mf,'mf',[uid(),g('mfi-name'),g('mfi-cat'),g('mfi-sip')||0,g('mfi-start')||'—',g('mfi-units')||0,g('mfi-nav')||0,''],'add-mf-modal');}
async function addChit(){await saveRow(SHEETS.chits,'chits',[uid(),g('ci-name'),g('ci-val')||0,g('ci-mo')||20,g('ci-done')||0,g('ci-pm')||0,g('ci-start')||'—',g('ci-comm')||5,g('ci-status')||'Active'],'add-chit-modal');}
async function addChitPay(){await saveRow(SHEETS.chitPay,'chitPay',[uid(),g('cp-mo'),g('cp-chit'),g('cp-amt')||0,g('cp-st')||'Paid',g('cp-note')],'add-cpay-modal');}
async function addInv(){await saveRow(SHEETS.inv,'inv',[uid(),g('ivi-name'),g('ivi-type'),g('ivi-mo')||0,g('ivi-val')||0,g('ivi-tgt')||0,g('ivi-note')],'add-inv-modal');}
async function addIns(){await saveRow(SHEETS.ins,'ins',[uid(),g('ini-name'),g('ini-type'),g('ini-prem')||0,g('ini-cov')||0,g('ini-ren')||'',g('ini-st')||'Active'],'add-ins-modal');}
async function addGoal(){await saveRow(SHEETS.goals,'goals',[uid(),g('gi-name'),g('gi-tgt')||0,g('gi-yr')||5,g('gi-saved')||0,''],'add-goal-modal');}
async function addAsset(){await saveRow(SHEETS.assets,'assets',[uid(),g('ai-name'),g('ai-type'),g('ai-val')||0,today(),g('ai-note')],'add-asset-modal');}
async function addLiab(){await saveRow(SHEETS.liab,'liab',[uid(),g('li-name'),g('li-type'),g('li-amt')||0,today(),g('li-note')],'add-liab-modal');}

// ── UI HELPERS ────────────────────────────────────────
function toggleSidebar(){
  sidebarCollapsed=!sidebarCollapsed;
  el('sidebar').classList.toggle('collapsed',sidebarCollapsed);
  el('main-content').classList.toggle('expanded',sidebarCollapsed);
  el('collapse-btn').textContent=sidebarCollapsed?'›':'‹';
  const b=el('relogin-banner');if(b)b.style.left=sidebarCollapsed?'var(--sb-col)':'var(--sb-w)';
  setTimeout(()=>Object.values(charts).forEach(c=>c&&c.resize&&c.resize()),280);
}
function buildMonthTabs(){
  const now=new Date(),mo=[];
  for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);mo.push(d.toLocaleDateString('en-IN',{month:'short',year:'2-digit'}).replace(' ','-'));}
  ['ie-tabs','mo-tabs'].forEach(tid=>{const t=el(tid);if(!t)return;t.innerHTML=mo.map(m=>`<button class="month-tab ${m===selMonth?'active':''}" onclick="selMo('${m}',this,'${tid}')">${m}</button>`).join('');});
}
function selMo(m,btn,cid){selMonth=m;document.querySelectorAll(`#${cid} .month-tab`).forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderCurrentPage();}
function setDateDefaults(){['ii-date','ei-date','ini-ren'].forEach(id=>{const e=el(id);if(e&&e.type==='date')e.value=today();});}
function openModal(id){el(id).classList.add('open');setDateDefaults();}
function closeModal(id){el(id).classList.remove('open');}
function toast(msg,type='ok'){const t=el('toast');const item=document.createElement('div');item.className='toast-item toast-'+type;item.innerHTML=`<span>${type==='ok'?'✓':'✕'}</span><span>${msg}</span>`;t.appendChild(item);setTimeout(()=>item.remove(),3000);}