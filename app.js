/* ═══════════════════════════════════════════════════
   FinNova — app.js
   Google Sheets API + Gold Rates + All UI Logic
═══════════════════════════════════════════════════ */

// ── CONFIGURATION ────────────────────────────────────
// Paste your values here — safe to include in code.
// Google OAuth is the real security layer.
const PRECONFIGURED_CLIENT_ID = '728990426782-jk6n0e5ospehlcqgbtp81l1p3hc7ghst.apps.googleusercontent.com'; // e.g. '1234-abc.apps.googleusercontent.com'
const PRECONFIGURED_SHEET_ID  = '17KgNA83OabwZM3K8sOp2sFrbhSq-D2MH--JMluIhnVs'; // e.g. '1BxiMVs0XRA5nFM...'

// Google Apps Script proxy URL (fixes CORS for gold rates)
// Deploy your proxy script from script.google.com and paste URL here
const GOLD_PROXY_URL = 'https://script.google.com/macros/s/AKfycbyOqF2gt0tculAtyKwFbirEHlkO-Sl_fzfFVYgebdWj-C8Vb-YiHnP2K6L1Le7QNow_Mw/exec';

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS = {
  income:'Income', expenses:'Expenses', mf:'MutualFunds',
  chits:'ChitFunds', chitPay:'ChitPayments', inv:'Investments',
  ins:'Insurance', goals:'Goals', assets:'Assets', liab:'Liabilities'
};
const CAT_COLORS = {
  Housing:'#1A5CB5', Utilities:'#0B7285', Food:'#0E7C4E',
  Transport:'#1A5CB5', Education:'#8B3A3A', Health:'#0B7285',
  Insurance:'#B8680A', NPS:'#0B7285', 'Mutual Funds':'#1A5CB5',
  'Chit Funds':'#C8A84B', Entertainment:'#8B3A3A', Shopping:'#5A6A7A',
  Other:'#7A8FA6', Salary:'#0E7C4E', Business:'#C8A84B',
  Freelance:'#1A5CB5', 'Chit Payout':'#C8A84B', Dividends:'#0E7C4E'
};

// ── STATE ─────────────────────────────────────────────
let gToken = null, sheetId = PRECONFIGURED_SHEET_ID || '', clientId = '';
let selMonth = '', curMonth = '';
let cache = { income:[], expenses:[], mf:[], chits:[], chitPay:[], inv:[], ins:[], goals:[], assets:[], liab:[] };
let goldData = { comex:0, usdinr:0, mcx:0, change:0, changePct:0, mcxChange:0, lastUpdate:null };
let charts = {};
let tokenExpiryTimer = null, goldTimer = null;
let sidebarCollapsed = false;

// ── UTILS ─────────────────────────────────────────────
const INR  = n => '₹' + Math.abs(Math.round(n || 0)).toLocaleString('en-IN');
const PCT  = n => (Math.round((n || 0) * 10) / 10) + '%';
const uid  = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const g    = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
const q    = sel => document.querySelector(sel);
const qa   = sel => document.querySelectorAll(sel);
const el   = id => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);

function toMonth(d) {
  return new Date(d).toLocaleDateString('en-IN', { month:'short', year:'2-digit' }).replace(' ', '-');
}
function getCurMonth() {
  return new Date().toLocaleDateString('en-IN', { month:'short', year:'2-digit' }).replace(' ', '-');
}

// ── INIT ──────────────────────────────────────────────
window.addEventListener('load', () => {
  const sc = localStorage.getItem('fn_cid');
  const ss = localStorage.getItem('fn_sid');

  // Auto-fill Client ID
  const cidEl = el('clientId');
  const sidEl = el('sheetId');

  if (PRECONFIGURED_CLIENT_ID) {
    if (cidEl) { cidEl.value = PRECONFIGURED_CLIENT_ID; cidEl.readOnly = true; cidEl.style.display = 'none'; }
    if (el('clientId-group')) el('clientId-group').style.display = 'none';
  } else if (sc && cidEl) {
    cidEl.value = sc;
  }

  if (PRECONFIGURED_SHEET_ID) {
    if (sidEl) { sidEl.value = PRECONFIGURED_SHEET_ID; sidEl.readOnly = true; sidEl.style.display = 'none'; }
    if (el('sheetId-group')) el('sheetId-group').style.display = 'none';
  } else if (ss && sidEl) {
    sidEl.value = ss;
  }

  // If both pre-configured, hide extra form text
  if (PRECONFIGURED_CLIENT_ID && PRECONFIGURED_SHEET_ID) {
    if (el('form-instructions')) el('form-instructions').style.display = 'none';
  }

  curMonth = getCurMonth();
  selMonth = curMonth;
  buildMonthTabs();
  setDateDefaults();

  // Modal backdrop close
  qa('.mov').forEach(m => m.addEventListener('click', e => {
    if (e.target === m) m.classList.remove('open');
  }));
});

// ── AUTH ──────────────────────────────────────────────
async function startAuth() {
  const cid = PRECONFIGURED_CLIENT_ID || g('clientId');
  const sid = PRECONFIGURED_SHEET_ID  || g('sheetId');
  if (!cid) { showAlert('Please enter your Google OAuth Client ID'); return; }
  localStorage.setItem('fn_cid', cid);
  if (sid) { localStorage.setItem('fn_sid', sid); sheetId = sid; }
  clientId = cid;
  showAlert('Opening Google sign-in…', 'info');
  el('connectBtn').disabled = true;
  try {
    await loadGIS();
    buildTokenClient().requestAccessToken({ prompt: 'consent' });
  } catch(e) {
    showAlert('Failed: ' + e.message);
    el('connectBtn').disabled = false;
  }
}

function loadGIS() {
  return new Promise((res, rej) => {
    if (window.google?.accounts) { res(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

function buildTokenClient(silent = false) {
  return google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    prompt: silent ? '' : undefined,
    callback: async r => {
      if (r.error) {
        if (!silent) { showAlert('Auth error: ' + r.error); el('connectBtn').disabled = false; }
        else showReloginBanner();
        return;
      }
      gToken = r.access_token;
      clearTimeout(tokenExpiryTimer);
      tokenExpiryTimer = setTimeout(silentRefresh, (3600 - 300) * 1000);
      if (!silent) await onAuth();
      else { el('sb-sync').textContent = '● Synced'; toast('Session refreshed', 'ok'); }
    }
  });
}

async function silentRefresh() {
  if (!clientId) return;
  try { buildTokenClient(true).requestAccessToken({ prompt: '' }); }
  catch(e) { showReloginBanner(); }
}

function showReloginBanner() {
  if (el('relogin-banner')) return;
  const b = document.createElement('div');
  b.id = 'relogin-banner';
  b.innerHTML = `
    <span>⚠ Your session expired. Please sign in again to continue.</span>
    <button onclick="relogin()" style="background:var(--amber);color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;font-family:var(--fh);letter-spacing:.5px;">Sign in again</button>
  `;
  document.body.appendChild(b);
  el('sb-sync').textContent = '! Session expired';
}

function relogin() {
  const b = el('relogin-banner');
  if (b) b.remove();
  silentRefresh();
}

async function onAuth() {
  try {
    const u = await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + gToken }
    })).json();
    el('user-name').textContent = (u.name || u.email || 'User').split(' ')[0];
    el('user-av').textContent = ((u.name || u.email || 'U')[0]).toUpperCase();
    if (!sheetId) await createSheet();
    else await verifySheet();
    await initHeaders();
    showApp();
    await syncAll();
    startGoldRefresh();
  } catch(e) {
    showAlert('Error: ' + e.message);
    el('connectBtn').disabled = false;
  }
}

async function createSheet() {
  showAlert('Creating your FinNova spreadsheet…', 'info');
  const r = await api('POST', 'https://sheets.googleapis.com/v4/spreadsheets', {
    properties: { title: 'FinNova — Personal Finance' },
    sheets: Object.values(SHEETS).map(t => ({ properties: { title: t } }))
  });
  sheetId = r.spreadsheetId;
  localStorage.setItem('fn_sid', sheetId);
}

async function verifySheet() {
  const r = await api('GET', `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`);
  const exist = r.sheets.map(s => s.properties.title);
  const missing = Object.values(SHEETS).filter(s => !exist.includes(s));
  if (missing.length) {
    await api('POST', `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      requests: missing.map(t => ({ addSheet: { properties: { title: t } } }))
    });
  }
}

async function initHeaders() {
  const hdrs = {
    [SHEETS.income]:  [['ID','Desc','Cat','Amount','Date','Month','Notes']],
    [SHEETS.expenses]:[['ID','Desc','Cat','Amount','Date','Month','Notes']],
    [SHEETS.mf]:      [['ID','Name','Cat','SIP','Start','Units','NAV','Notes']],
    [SHEETS.chits]:   [['ID','Name','Value','Months','Done','Monthly','StartMo','Comm','Status']],
    [SHEETS.chitPay]: [['ID','Month','ChitName','Amount','Status','Notes']],
    [SHEETS.inv]:     [['ID','Name','Type','Monthly','Value','Target','Notes']],
    [SHEETS.ins]:     [['ID','Name','Type','Premium','Assured','Renewal','Status']],
    [SHEETS.goals]:   [['ID','Name','Target','Years','Saved','Notes']],
    [SHEETS.assets]:  [['ID','Name','Type','Value','Updated','Notes']],
    [SHEETS.liab]:    [['ID','Name','Type','Amount','Updated','Notes']],
  };
  const checks = await Promise.all(Object.keys(hdrs).map(s => getRange(s + '!A1')));
  const toWrite = [];
  Object.keys(hdrs).forEach((s, i) => {
    if (!checks[i]?.[0]) toWrite.push({ range: s + '!A1', values: hdrs[s] });
  });
  if (toWrite.length) await batchSet(toWrite);
}

function showApp() {
  el('login-screen').style.display = 'none';
  el('app').style.display = 'block';
  setDateDefaults();
}

function showAlert(msg, type = 'err') {
  el('login-alert').innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

function signOut() {
  if (!confirm('Sign out?')) return;
  gToken = null;
  clearTimeout(tokenExpiryTimer);
  clearInterval(goldTimer);
  Object.values(charts).forEach(c => c && c.destroy && c.destroy());
  charts = {};
  el('app').style.display = 'none';
  el('login-screen').style.display = 'flex';
  el('connectBtn').disabled = false;
  el('login-alert').innerHTML = '';
}

// ── SHEETS API ────────────────────────────────────────
async function api(method, url, body, retry = true) {
  const opts = {
    method,
    headers: { Authorization: 'Bearer ' + gToken, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);

  if (r.status === 401 && retry) {
    await new Promise(res => {
      google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPES, prompt: '',
        callback: res2 => { if (!res2.error) gToken = res2.access_token; res(); }
      }).requestAccessToken({ prompt: '' });
    });
    return api(method, url, body, false);
  }

  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'API ' + r.status); }
  return r.json();
}

async function getRange(range) {
  try {
    const r = await api('GET', `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`);
    return r.values || [];
  } catch { return []; }
}

async function appendRow(sheet, row) {
  await api('POST', `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheet}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values: [row] });
}

async function batchSet(data) {
  await api('POST', `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, { valueInputOption: 'RAW', data });
}

let sheetGidMap = {};
async function getSheetGid(title) {
  if (sheetGidMap[title]) return sheetGidMap[title];
  const r = await api('GET', `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`);
  r.sheets.forEach(s => sheetGidMap[s.properties.title] = s.properties.sheetId);
  return sheetGidMap[title];
}

async function deleteSheetRow(sheet, rowIdx) {
  const gid = await getSheetGid(sheet);
  await api('POST', `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    requests: [{ deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 } } }]
  });
}

// ── SYNC ──────────────────────────────────────────────
async function syncAll() {
  el('sb-sync').textContent = '⏳ Syncing…';
  showSkeletons();
  try {
    await Promise.all(Object.keys(cache).map(k => loadCache(k)));
    renderCurrentPage();
    updateGoldSidebar();
    const now = new Date().toLocaleTimeString();
    el('last-sync').textContent = 'Synced ' + now;
    el('sb-sync').textContent = '● Synced';
    toast('Synced with Google Sheets', 'ok');
  } catch(e) {
    el('sb-sync').textContent = '! Error';
    toast('Sync failed: ' + e.message, 'err');
  }
}

async function loadCache(key) {
  const sheet = SHEETS[key];
  if (!sheet) return;
  const rows = await getRange(sheet + '!A2:Z500');
  cache[key] = rows.filter(r => r[0]);
}

function showSkeletons() {
  const skHtml = `
    <div class="sk-card mb">
      ${[1,2,3].map(() => `<div class="sk-row"><div class="skeleton sk-circle"></div><div style="flex:1"><div class="skeleton sk-line w70"></div><div class="skeleton sk-line w40"></div></div><div class="skeleton sk-line w30" style="width:80px"></div></div>`).join('')}
    </div>`;
  ['d-recent-wrap', 'd-cats-wrap'].forEach(id => { const e = el(id); if (e) e.innerHTML = skHtml; });
}

// ── GOLD RATES ────────────────────────────────────────
async function fetchGold() {
  try {
    let gcData, fxData;
    if (GOLD_PROXY_URL) {
      const [gcRes, fxRes] = await Promise.all([
        fetch(`${GOLD_PROXY_URL}?symbol=GC=F`),
        fetch(`${GOLD_PROXY_URL}?symbol=USDINR=X`)
      ]);
      [gcData, fxData] = await Promise.all([gcRes.json(), fxRes.json()]);
    } else {
      el('sb-gold-price').textContent = 'Add proxy URL';
      el('sb-gold-sub').textContent = 'See setup guide';
      return;
    }

    const gcChart  = gcData.chart.result[0];
    const fxChart  = fxData.chart.result[0];
    const comex    = gcChart.meta.regularMarketPrice || gcChart.meta.previousClose;
    const prevC    = gcChart.meta.previousClose || comex;
    const usdInr   = fxChart.meta.regularMarketPrice || fxChart.meta.previousClose;
    const base     = (comex * usdInr) / 31.1035 * 10;
    const mcx      = base * 1.15 * 1.03;
    const prevBase = (prevC * usdInr) / 31.1035 * 10;
    const prevMcx  = prevBase * 1.15 * 1.03;

    goldData = {
      comex, usdinr: usdInr, mcx,
      change: comex - prevC,
      changePct: ((comex - prevC) / prevC) * 100,
      mcxChange: mcx - prevMcx,
      lastUpdate: new Date()
    };
    updateGoldSidebar();
    const pageId = q('.page.active')?.id?.replace('page-', '');
    if (pageId === 'dashboard') renderDashboard();
    if (pageId === 'gold')      renderGoldFull();
    calcGoldImpact();
  } catch(e) {
    el('sb-gold-price').textContent = 'Unavailable';
    console.warn('Gold fetch error:', e.message);
  }
}

function startGoldRefresh() { fetchGold(); goldTimer = setInterval(fetchGold, 5 * 60 * 1000); }

function updateGoldSidebar() {
  const { comex, usdinr, mcx, change, changePct } = goldData;
  if (!comex) return;
  const sign = change >= 0 ? '+' : '';
  el('sb-gold-price').textContent = `$${comex.toFixed(2)} (${sign}${changePct.toFixed(2)}%)`;
  el('sb-gold-sub').textContent = `MCX: ${INR(mcx)}/10g`;
}

function buildGoldWidget(mini = false) {
  const { comex, usdinr, mcx, change, changePct, mcxChange, lastUpdate } = goldData;
  if (!comex) return `<div class="gold-loading"><div class="skeleton sk-line w50" style="margin:0 auto 8px"></div><div class="skeleton sk-line w30" style="margin:0 auto"></div></div>`;

  const up   = change >= 0;
  const sign = up ? '+' : '';
  const cls  = up ? 'grc-up' : 'grc-dn';
  const g24  = mcx / 10, g22 = g24 * (22/24), g18 = g24 * (18/24);
  const time = lastUpdate ? lastUpdate.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) : '—';
  const per1 = (usdinr / 31.1035) * 10 * 1.15 * 1.03;

  return `
    <div class="gold-head">
      <div>
        <div class="gold-head-title">Live Gold Rates</div>
        <div class="gold-head-sub">Updated ${time} · Auto-refreshes every 5 min</div>
      </div>
      <button class="gold-refresh-btn" onclick="fetchGold()">↻ Refresh</button>
    </div>
    <div class="gold-rates">
      <div class="gold-rate-cell">
        <div class="grc-label">Comex Gold</div>
        <div class="grc-val">$${comex.toFixed(2)}</div>
        <div class="grc-unit">USD / Troy oz · NY Futures</div>
        <div class="grc-change ${cls}">${sign}$${change.toFixed(2)} (${sign}${changePct.toFixed(2)}%)</div>
      </div>
      <div class="gold-rate-cell">
        <div class="grc-label">USD / INR</div>
        <div class="grc-val">₹${usdinr.toFixed(2)}</div>
        <div class="grc-unit">Live exchange rate</div>
        <div class="grc-change grc-neu">Live</div>
      </div>
      <div class="gold-rate-cell">
        <div class="grc-label">MCX India (24K)</div>
        <div class="grc-val">${INR(mcx)}</div>
        <div class="grc-unit">Per 10g · incl. duty + GST</div>
        <div class="grc-change ${cls}">${sign}${INR(mcxChange)}/10g</div>
      </div>
      <div class="gold-rate-cell">
        <div class="grc-label">24K Per Gram</div>
        <div class="grc-val">${INR(g24)}</div>
        <div class="grc-unit">Indicative (MCX ÷ 10)</div>
        <div class="grc-change grc-neu">Excl. making charges</div>
      </div>
    </div>
    <div class="gold-purity-row">
      <div class="gold-purity-cell"><div class="gpc-purity">24K · 999</div><div class="gpc-price">${INR(g24)}/g</div><div class="gpc-sub">${INR(mcx)}/10g</div></div>
      <div class="gold-purity-cell"><div class="gpc-purity">22K · 916</div><div class="gpc-price">${INR(g22)}/g</div><div class="gpc-sub">${INR(g22*10)}/10g</div></div>
      <div class="gold-purity-cell"><div class="gpc-purity">18K · 750</div><div class="gpc-price">${INR(g18)}/g</div><div class="gpc-sub">${INR(g18*10)}/10g</div></div>
      <div class="gold-purity-cell"><div class="gpc-purity">14K · 585</div><div class="gpc-price">${INR(g24*0.585)}/g</div><div class="gpc-sub">${INR(g24*0.585*10)}/10g</div></div>
    </div>
    <div class="gold-impact-band">
      <span class="gib-label">Comex $1 move →</span>
      <span class="gib-val">24K +${INR(per1)}/10g</span>
      <span class="gib-val">Per gram +${INR(per1/10)}</span>
      <span class="gib-val">USD/INR effect: $1 = ₹${Math.round(per1)}/10g</span>
    </div>`;
}

function calcGoldImpact() {
  const { mcx, usdinr, change, changePct } = goldData;
  if (!mcx) return;
  const grams  = parseFloat(el('gold-grams')?.value || 100);
  const purity = parseFloat(el('gold-purity')?.value || 1);
  const g24    = mcx / 10;
  const perG   = g24 * purity;
  const total  = perG * grams;
  const per1   = (usdinr / 31.1035) * 10 * 1.15 * 1.03 / 10 * purity * grams;
  const todayChg = (change / goldData.comex) * total;
  const out = el('gold-impact-out');
  if (!out) return;
  out.innerHTML = [
    { l:'Current Value', v:INR(total), c:'navy' },
    { l:'Today\'s Change', v:(todayChg >= 0 ? '+' : '') + INR(todayChg), c: todayChg >= 0 ? 'green' : 'red' },
    { l:'If Comex +$1', v:'+' + INR(per1), c:'green' },
    { l:'If Comex +$50', v:'+' + INR(per1*50), c:'green' },
    { l:'If Comex +$100', v:'+' + INR(per1*100), c:'green' },
    { l:'If Comex −$100', v:'−' + INR(per1*100), c:'red' },
  ].map(s => `<div class="stat"><div class="stat-label">${s.l}</div><div class="stat-val" style="color:var(--${s.c})">${s.v}</div></div>`).join('');
}

function renderGoldSensitivity() {
  const { usdinr } = goldData;
  if (!usdinr) return;
  const perOz = (usdinr / 31.1035) * 1.15 * 1.03;
  const rows = [['$1',1],['$10',10],['$25',25],['$50',50],['$100',100],['$200',200]];
  const senEl = el('gold-sensitivity');
  if (!senEl) return;
  senEl.innerHTML = `<table><thead><tr><th>Comex move</th><th>24K / 10g</th><th>24K / g</th><th>22K / g</th><th>18K / g</th><th>100g (24K)</th></tr></thead><tbody>
    ${rows.map(([lbl,m]) => `<tr>
      <td><strong>${lbl} move</strong></td>
      <td class="up" style="font-family:var(--fm)">+${INR(perOz*10*m)}</td>
      <td style="font-family:var(--fm)">+${INR(perOz*m)}</td>
      <td style="font-family:var(--fm)">+${INR(perOz*m*0.9167)}</td>
      <td style="font-family:var(--fm)">+${INR(perOz*m*0.75)}</td>
      <td style="font-family:var(--fm);font-weight:600;color:var(--green)">+${INR(perOz*m*100)}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

// ── CHARTS (Chart.js) ─────────────────────────────────
function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

function initCashflowChart() {
  destroyChart('cashflow');
  const canvas = el('cashflow-chart');
  if (!canvas) return;
  const months = getLast6Months();
  const incData = months.map(m => cache.income.filter(r => r[5] === m).reduce((s, r) => s + +r[3], 0));
  const expData = months.map(m => cache.expenses.filter(r => r[5] === m).reduce((s, r) => s + +r[3], 0));
  charts['cashflow'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        { label: 'Income',   data: incData, backgroundColor: '#0E7C4E', borderRadius: 4, borderSkipped: false },
        { label: 'Expenses', data: expData, backgroundColor: '#C0392B', borderRadius: 4, borderSkipped: false }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: "'DM Mono'" } } },
        y: { grid: { color: '#E5EAF2' }, ticks: { callback: v => '₹' + (v/1000) + 'k', font: { family: "'DM Mono'" } } }
      },
      animation: { duration: 600, easing: 'easeOutQuart' }
    }
  });
}

function initExpDonut(canvasId, legendId) {
  destroyChart(canvasId);
  const canvas = el(canvasId);
  if (!canvas) return;
  const cats = {};
  cache.expenses.filter(r => r[5] === curMonth).forEach(r => {
    cats[r[2] || 'Other'] = (cats[r[2] || 'Other'] || 0) + +r[3];
  });
  const labels = Object.keys(cats);
  const values = Object.values(cats);
  const colors = labels.map(l => CAT_COLORS[l] || '#7A8FA6');
  charts[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${INR(c.raw)}` } } },
      animation: { animateRotate: true, duration: 700 }
    }
  });
  if (legendId && el(legendId)) {
    el(legendId).innerHTML = labels.map((l, i) =>
      `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdr);font-size:12px">
        <span style="display:flex;align-items:center;gap:7px;color:var(--t2)"><span style="width:8px;height:8px;border-radius:2px;background:${colors[i]};display:inline-block"></span>${l}</span>
        <span style="font-family:var(--fm);font-weight:500">${INR(values[i])}</span>
      </div>`).join('');
  }
}

function initMFChart() {
  destroyChart('mf-pie');
  const canvas = el('mf-pie');
  if (!canvas || !cache.mf.length) return;
  const cats = {};
  cache.mf.forEach(r => { cats[r[2]||'Other'] = (cats[r[2]||'Other']||0) + +r[5] * +r[6]; });
  const labels = Object.keys(cats), values = Object.values(cats);
  const cols = ['#0B1929','#1A5CB5','#0B7285','#C8A84B','#0E7C4E'];
  charts['mf-pie'] = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: cols.slice(0, labels.length), borderWidth: 0, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } }, animation: { duration: 700 } }
  });
}

function initSurplusLine() {
  destroyChart('surplus-line');
  const canvas = el('surplus-line');
  if (!canvas) return;
  const months = getLast6Months();
  const data = months.map(m => {
    const i = cache.income.filter(r => r[5] === m).reduce((s, r) => s + +r[3], 0);
    const e = cache.expenses.filter(r => r[5] === m).reduce((s, r) => s + +r[3], 0);
    return i - e;
  });
  charts['surplus-line'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: months,
      datasets: [{
        label: 'Surplus', data,
        borderColor: '#C8A84B',
        backgroundColor: 'rgba(200,168,75,.08)',
        fill: true, tension: .4, pointRadius: 5,
        pointBackgroundColor: '#C8A84B', pointBorderColor: '#fff', pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${INR(c.raw)}` } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: "'DM Mono'" } } },
        y: { grid: { color: '#E5EAF2' }, ticks: { callback: v => '₹' + (v/1000) + 'k', font: { family: "'DM Mono'" } } }
      },
      animation: { duration: 700 }
    }
  });
}

function getLast6Months() {
  const now = new Date(), months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toLocaleDateString('en-IN', { month:'short', year:'2-digit' }).replace(' ', '-'));
  }
  return months;
}

// ── SIDEBAR ───────────────────────────────────────────
function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  const sb = el('sidebar');
  const main = el('main-content');
  const banner = el('relogin-banner');
  sb.classList.toggle('collapsed', sidebarCollapsed);
  main.classList.toggle('expanded', sidebarCollapsed);
  el('collapse-btn').textContent = sidebarCollapsed ? '›' : '‹';
  if (banner) banner.style.left = sidebarCollapsed ? 'var(--sb-w-col)' : 'var(--sb-w)';
  setTimeout(() => Object.values(charts).forEach(c => c && c.resize && c.resize()), 350);
}

// ── NAVIGATION ────────────────────────────────────────
const PAGE_META = {
  dashboard: ['Dashboard', 'Your complete financial overview'],
  ie:        ['Income & Expenses', 'Track every rupee'],
  mf:        ['Mutual Funds', 'Portfolio & SIP tracker'],
  gold:      ['Gold Rates', 'Live Comex + MCX India analysis'],
  chits:     ['Chit Funds', 'Payment log & tracker'],
  inv:       ['Investments', 'NPS · Gold · Stocks · PPF'],
  ins:       ['Insurance', 'Policy management'],
  tax:       ['Tax Planning', '80C · 80D · NPS 80CCD(1B)'],
  goals:     ['Goals & Emergency', 'Financial goal planner'],
  health:    ['Financial Health', 'Scores & action plan'],
  monthly:   ['Monthly Tracker', 'Month-by-month view'],
  nw:        ['Net Worth', 'Assets minus liabilities'],
};

function showPage(id, navEl) {
  qa('.page').forEach(p => p.classList.remove('active'));
  qa('.ni').forEach(n => n.classList.remove('active'));
  const pg = el('page-' + id);
  if (pg) pg.classList.add('active');
  if (navEl) navEl.classList.add('active');
  const [t, s] = PAGE_META[id] || [id, ''];
  el('tb-title').textContent = t;
  el('tb-sub').textContent   = s;
  renderPage(id);
}

function renderCurrentPage() {
  const a = q('.page.active');
  if (a) renderPage(a.id.replace('page-', ''));
}

function renderPage(id) {
  const fn = {
    dashboard: renderDashboard, ie: renderIE, mf: renderMF,
    gold: renderGoldFull, chits: renderChits, inv: renderInv,
    ins: renderIns, tax: renderTax, goals: renderGoals,
    health: renderHealth, monthly: renderMonthly, nw: renderNW
  };
  if (fn[id]) fn[id]();
}

// ── PAGE RENDERS ──────────────────────────────────────

function renderDashboard() {
  const m  = curMonth;
  const inc = cache.income.filter(r => r[5] === m);
  const exp = cache.expenses.filter(r => r[5] === m);
  const ti  = inc.reduce((s, r) => s + +r[3], 0);
  const te  = exp.reduce((s, r) => s + +r[3], 0);
  const sur = ti - te;
  const mfv = cache.mf.reduce((s, r) => s + +r[5] * +r[6], 0);
  const inv = cache.inv.reduce((s, r) => s + +r[4], 0);
  const nwa = cache.assets.reduce((s, r) => s + +r[3], 0);
  const nwl = cache.liab.reduce((s, r) => s + +r[3], 0);

  el('d-inc').textContent = INR(ti);
  el('d-exp').textContent = INR(te);
  el('d-sur').textContent = INR(sur);
  el('d-sur').className   = 'kpi-val ' + (sur >= 0 ? 'up' : 'dn');
  el('d-sur-pct').textContent = ti > 0 ? PCT(sur / ti * 100) + ' savings rate' : '—';
  el('d-inv').textContent = INR(mfv + inv);
  el('d-nw').textContent  = INR(nwa - nwl);
  el('d-nw').className    = 'kpi-val ' + ((nwa - nwl) >= 0 ? 'up' : 'dn');

  // Gold mini widget
  const gw = el('dash-gold-mini');
  if (gw) gw.innerHTML = buildGoldWidget(true);

  // Recent transactions
  const all = [
    ...inc.map(r => ({ ...r, _t: 'i' })),
    ...exp.map(r => ({ ...r, _t: 'e' }))
  ].sort((a, b) => new Date(b[4]) - new Date(a[4])).slice(0, 8);

  el('d-recent').innerHTML = all.map(r => `<tr>
    <td><span style="font-weight:600">${r[1] || '—'}</span></td>
    <td><span class="badge badge-${r._t === 'i' ? 'green' : 'gold'}">${r[2] || '—'}</span></td>
    <td style="font-family:var(--fm);color:var(--${r._t === 'i' ? 'green' : 'red'})">${r._t === 'i' ? '+' : '-'}${INR(r[3])}</td>
    <td style="font-size:11px;color:var(--t3)">${r[4] || '—'}</td>
  </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--t3);padding:28px">No transactions this month</td></tr>';

  // Charts
  setTimeout(() => {
    initCashflowChart();
    initExpDonut('exp-donut-dash', 'exp-donut-legend');
    initSurplusLine();
  }, 50);
}

function renderIE() {
  const m  = selMonth;
  const inc = cache.income.filter(r => r[5] === m);
  const exp = cache.expenses.filter(r => r[5] === m);
  const ti  = inc.reduce((s, r) => s + +r[3], 0);
  const te  = exp.reduce((s, r) => s + +r[3], 0);
  const sur = ti - te;

  el('ie-inc').textContent  = INR(ti);
  el('ie-exp').textContent  = INR(te);
  el('ie-sur').textContent  = INR(sur);
  el('ie-sur').className    = 'kpi-val ' + (sur >= 0 ? 'up' : 'dn');
  el('ie-rate').textContent = ti > 0 ? PCT(sur / ti * 100) : '0%';
  el('ie-inc-tot').textContent = INR(ti);
  el('ie-exp-tot').textContent = INR(te);
  el('ie-ic').textContent  = inc.length + ' entries';
  el('ie-ec').textContent  = exp.length + ' entries';

  const mkList = (items, type, listId) => {
    el(listId).innerHTML = items.length ? items.map((r, i) => `
      <div class="entry-row" style="grid-template-columns:8px 1fr auto auto auto auto">
        <div class="entry-dot" style="background:${CAT_COLORS[r[2]] || '#7A8FA6'}"></div>
        <div><div class="entry-name">${r[1] || '—'}</div><div class="entry-note">${r[2] || ''}${r[6] ? ' · ' + r[6] : ''}</div></div>
        <span class="badge badge-${type === 'i' ? 'green' : 'amber'}" style="font-size:10px">${r[2] || ''}</span>
        <div class="${type === 'i' ? 'entry-inc' : 'entry-exp'}">${type === 'i' ? '+' : '-'}${INR(r[3])}</div>
        <div class="entry-date">${r[4] || ''}</div>
        <button class="del-btn" onclick="delEntry('${type === 'i' ? SHEETS.income : SHEETS.expenses}','${type === 'i' ? 'income' : 'expenses'}',${i + 1})">✕</button>
      </div>`).join('')
      : `<div class="empty"><div class="empty-icon">${type === 'i' ? '💰' : '💸'}</div><div class="empty-title">No ${type === 'i' ? 'income' : 'expenses'} for ${m}</div></div>`;
  };
  mkList(inc, 'i', 'ie-inc-list');
  mkList(exp, 'e', 'ie-exp-list');
}

function renderMF() {
  const total = cache.mf.reduce((s, r) => s + +r[5] * +r[6], 0);
  const sip   = cache.mf.reduce((s, r) => s + +r[3], 0);
  const idx   = cache.mf.filter(r => r[2] === 'India Index').reduce((s, r) => s + +r[5] * +r[6], 0);
  const us    = cache.mf.filter(r => r[2] === 'US/International').reduce((s, r) => s + +r[5] * +r[6], 0);
  el('mf-val').textContent = INR(total);
  el('mf-sip').textContent = INR(sip) + '/mo';
  el('mf-idx').textContent = INR(idx);
  el('mf-us').textContent  = INR(us);

  el('mf-tbl').innerHTML = cache.mf.map((r, i) => {
    const v = +r[5] * +r[6];
    return `<tr>
      <td><div style="font-weight:600">${r[1] || '—'}</div><div style="font-size:11px;color:var(--t3)">${r[7] || ''}</div></td>
      <td><span class="badge badge-blue">${r[2] || '—'}</span></td>
      <td style="font-family:var(--fm)">${INR(r[3] || 0)}</td>
      <td style="font-family:var(--fm)">${(+r[5] || 0).toFixed(3)}</td>
      <td style="font-family:var(--fm)">${INR(r[6] || 0)}</td>
      <td style="font-family:var(--fm);font-weight:700;color:var(--gold4)">${INR(v)}</td>
      <td><button class="del-btn" onclick="delEntry('${SHEETS.mf}','mf',${i + 1})">✕</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:28px">No funds added yet</td></tr>';

  setTimeout(initMFChart, 50);
  updateProj();
}

function updateProj() {
  const sip = +(el('proj-sip')?.value || 5000);
  el('proj-out').innerHTML = [1, 3, 5, 10, 15, 20].map(yr => {
    const mo = yr * 12, r = 0.12 / 12;
    const v  = sip * (((1 + r) ** mo - 1) / r) * (1 + r);
    return `<div class="stat"><div class="stat-label">${yr} Yr${yr > 1 ? 's' : ''}</div><div class="stat-val" style="font-size:14px;color:var(--gold4)">${INR(v)}</div></div>`;
  }).join('');
}

function renderGoldFull() {
  const gw = el('gold-full-widget');
  if (gw) gw.innerHTML = buildGoldWidget(false);
  calcGoldImpact();
  renderGoldSensitivity();
  const fl = el('gold-formula-live');
  if (fl && goldData.comex) {
    fl.textContent = `(${goldData.comex.toFixed(2)} × ${goldData.usdinr.toFixed(2)}) ÷ 31.1035 × 10 × 1.15 × 1.03 = ${INR(goldData.mcx)}/10g`;
  }
}

function renderChits() {
  const total  = cache.chits.reduce((s, r) => s + +r[5], 0);
  const paid   = cache.chitPay.reduce((s, r) => s + +r[3], 0);
  const payout = cache.chits.reduce((s, r) => s + +r[2] * 0.95, 0);
  el('cf-n').textContent    = cache.chits.length;
  el('cf-mo').textContent   = INR(total) + '/mo';
  el('cf-paid').textContent = INR(paid);
  el('cf-exp').textContent  = INR(payout);

  const cols = ['#C8A84B','#0E7C4E','#1A5CB5','#8B3A3A','#0B7285','#5A6A7A'];
  el('chit-cards').innerHTML = cache.chits.map((r, i) => {
    const done = +r[4] || 0, tot = +r[3] || 0, pct = tot > 0 ? Math.round(done / tot * 100) : 0;
    const color = cols[i % cols.length];
    const thisPaid = cache.chitPay.filter(p => p[2] === r[1]).reduce((s, p) => s + +p[3], 0);
    return `<div class="chit-card">
      <div class="chit-accent" style="background:${color}"></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div><div class="chit-name">${r[1] || 'Chit'}</div><div class="chit-meta">${r[6] || ''} · ${INR(r[5] || 0)}/mo</div></div>
        <span class="badge badge-${r[8] === 'Active' ? 'green' : r[8] === 'Planned' ? 'amber' : 'navy'}">${r[8] || 'Active'}</span>
      </div>
      <div class="chit-row"><span class="chit-row-label">Value</span><span class="chit-row-val">${INR(r[2] || 0)}</span></div>
      <div class="chit-row"><span class="chit-row-label">Progress</span><span class="chit-row-val">${done}/${tot} months</span></div>
      <div class="chit-row" style="margin-bottom:12px"><span class="chit-row-label">Total paid</span><span class="chit-row-val" style="color:${color}">${INR(thisPaid)}</span></div>
      <div class="progress"><div class="progress-fill" style="background:${color};width:${pct}%"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-top:5px"><span>${pct}% done</span><span>${tot - done} months left</span></div>
    </div>`;
  }).join('') || `<div style="grid-column:1/-1"><div class="empty"><div class="empty-icon">🏦</div><div class="empty-title">No Chit Funds Added</div></div></div>`;

  const cumMap = {};
  el('chit-log').innerHTML = cache.chitPay.map((r, i) => {
    cumMap[r[2]] = (cumMap[r[2]] || 0) + +r[3];
    return `<tr>
      <td style="font-family:var(--fm);font-weight:600">${r[1] || '—'}</td>
      <td style="color:var(--gold4)">${r[2] || '—'}</td>
      <td style="font-family:var(--fm)">${INR(r[3] || 0)}</td>
      <td style="font-family:var(--fm);color:var(--t3)">${INR(cumMap[r[2]])}</td>
      <td><span class="badge badge-${r[4] === 'Paid' ? 'green' : r[4] === 'Pending' ? 'amber' : 'red'}">${r[4] || '—'}</span></td>
      <td><button class="del-btn" onclick="delEntry('${SHEETS.chitPay}','chitPay',${i + 1})">✕</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:28px">No payments logged</td></tr>';

  const sel = el('cp-chit');
  if (sel) sel.innerHTML = cache.chits.map(r => `<option>${r[1]}</option>`).join('');
}

function renderInv() {
  const nps  = cache.inv.filter(r => r[2] === 'NPS').reduce((s, r) => s + +r[4], 0);
  const gold = cache.inv.filter(r => r[2]?.includes('Gold')).reduce((s, r) => s + +r[4], 0);
  const stk  = cache.inv.filter(r => r[2]?.includes('Stocks')).reduce((s, r) => s + +r[4], 0);
  const oth  = cache.inv.filter(r => r[2] === 'PPF' || r[2] === 'FD').reduce((s, r) => s + +r[4], 0);
  el('inv-nps').textContent  = INR(nps);
  el('inv-gold').textContent = INR(gold);
  el('inv-stk').textContent  = INR(stk);
  el('inv-oth').textContent  = INR(oth);

  el('inv-tbl').innerHTML = cache.inv.map((r, i) => `<tr>
    <td style="font-weight:600">${r[1] || '—'}</td>
    <td><span class="badge badge-teal">${r[2] || '—'}</span></td>
    <td style="font-family:var(--fm)">${INR(r[3] || 0)}/mo</td>
    <td style="font-family:var(--fm);font-weight:700;color:var(--gold4)">${INR(r[4] || 0)}</td>
    <td style="font-family:var(--fm);color:var(--t3)">${INR(r[5] || 0)}</td>
    <td style="font-size:12px;color:var(--t3)">${r[6] || ''}</td>
    <td><button class="del-btn" onclick="delEntry('${SHEETS.inv}','inv',${i + 1})">✕</button></td>
  </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:28px">No investments added</td></tr>';
}

function renderIns() {
  const annual = cache.ins.reduce((s, r) => s + +r[3], 0);
  const health = cache.ins.filter(r => r[2] === 'Health').reduce((s, r) => s + +r[3], 0);
  el('ins-ann').textContent = INR(annual);
  el('ins-mo').textContent  = INR(annual / 12) + '/mo';
  el('ins-n').textContent   = cache.ins.length;
  el('ins-80d').textContent = INR(Math.min(health, 25000));

  el('ins-tbl').innerHTML = cache.ins.map((r, i) => `<tr>
    <td style="font-weight:600">${r[1] || '—'}</td>
    <td><span class="badge badge-amber">${r[2] || '—'}</span></td>
    <td style="font-family:var(--fm)">${INR(r[3] || 0)}/yr</td>
    <td style="font-family:var(--fm)">${r[4] ? INR(r[4]) : '—'}</td>
    <td style="font-size:12px;color:var(--t3)">${r[5] || '—'}</td>
    <td><span class="badge badge-${r[6] === 'Active' ? 'green' : 'red'}">${r[6] || 'Active'}</span></td>
    <td><button class="del-btn" onclick="delEntry('${SHEETS.ins}','ins',${i + 1})">✕</button></td>
  </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:28px">No policies added</td></tr>';
}

function renderTax() {
  const npsAnn  = cache.inv.filter(r => r[2] === 'NPS').reduce((s, r) => s + +r[3], 0) * 12;
  const lifeIns = cache.ins.filter(r => r[2] === 'Life/Endowment' || r[2] === 'Term Life').reduce((s, r) => s + +r[3], 0);
  const health  = cache.ins.filter(r => r[2] === 'Health').reduce((s, r) => s + +r[3], 0);
  const t80c    = Math.min(npsAnn + lifeIns, 150000);
  const tnps    = Math.min(npsAnn, 50000);
  const t80d    = Math.min(health, 25000);
  el('tx-80c').textContent   = INR(t80c);
  el('tx-nps').textContent   = INR(tnps);
  el('tx-80d').textContent   = INR(t80d);
  el('tx-saved').textContent = INR((t80c + tnps + t80d) * 0.05);

  el('tx-80c-list').innerHTML = [
    ['NPS Personal Tier 1', npsAnn, '80C + 80CCD(1)'],
    ['Life Insurance', lifeIns, '80C'],
    ['ELSS Mutual Funds', 0, '80C · 3yr lock · Best returns'],
    ['PPF Contribution', 0, '80C · 7.1% tax-free'],
    ['Term Insurance', cache.ins.filter(r => r[2] === 'Term Life').reduce((s, r) => s + +r[3], 0), '80C'],
  ].map(([n, v, t]) => `<div class="entry-row" style="grid-template-columns:1fr auto auto">
    <div><div class="entry-name">${n}</div><div class="entry-note">${t}</div></div>
    <div style="font-family:var(--fm);font-weight:600;color:var(--gold4)">${INR(v)}</div>
    <span class="badge badge-green">Eligible</span>
  </div>`).join('');

  el('tx-other-list').innerHTML = [
    ['Health Insurance (80D)', t80d, 'Max ₹25,000'],
    ['NPS Extra (80CCD1B)',    tnps, 'Extra ₹50K over 80C'],
    ['Parents Health Ins',     0,    '₹50K if parents > 60'],
  ].map(([n, v, t]) => `<div class="entry-row" style="grid-template-columns:1fr auto">
    <div><div class="entry-name">${n}</div><div class="entry-note">${t}</div></div>
    <div style="font-family:var(--fm);font-weight:600;color:var(--teal)">${INR(v)}</div>
  </div>`).join('');
}

function renderGoals() {
  const moExp = cache.expenses.filter(r => r[5] === (selMonth || curMonth)).reduce((s, r) => s + +r[3], 0);
  const tgt   = moExp * 6;
  el('ef-mo').textContent  = INR(moExp);
  el('ef-tgt').textContent = INR(tgt);
  updateEF(tgt);

  const r = 0.12 / 12;
  el('goals-tbl').innerHTML = cache.goals.map((row, i) => {
    const t   = +row[2] || 0, y = +row[3] || 0, s = +row[4] || 0;
    const mo2 = y * 12;
    const sip = mo2 > 0 && t > 0 ? t / ((((1 + r) ** mo2 - 1) / r) * (1 + r)) : 0;
    const pct = t > 0 ? Math.min(100, s / t * 100) : 0;
    return `<tr>
      <td style="font-weight:600">${row[1] || '—'}</td>
      <td style="font-family:var(--fm)">${INR(t)}</td>
      <td>${y} yrs</td>
      <td style="font-family:var(--fm);font-weight:700;color:var(--gold4)">${INR(sip)}/mo</td>
      <td style="font-family:var(--fm)">${INR(s)}</td>
      <td style="min-width:110px">
        <div class="progress" style="height:5px;margin-bottom:3px"><div class="progress-fill" style="background:var(--navy);width:${pct.toFixed(0)}%"></div></div>
        <span style="font-size:10px;color:var(--t3)">${pct.toFixed(0)}%</span>
      </td>
      <td><button class="del-btn" onclick="delEntry('${SHEETS.goals}','goals',${i + 1})">✕</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:28px">No goals added yet</td></tr>';
}

function updateEF(tgtOverride) {
  const moExp = cache.expenses.filter(r => r[5] === (selMonth || curMonth)).reduce((s, r) => s + +r[3], 0) || 1;
  const tgt = tgtOverride || moExp * 6;
  const bal = +el('ef-bal')?.value || 0;
  const pct = Math.min(100, bal / tgt * 100);
  if (el('ef-prog')) el('ef-prog').style.width = pct + '%';
  if (el('ef-pct'))  el('ef-pct').textContent  = Math.round(pct) + '% funded';
  if (el('ef-gap'))  el('ef-gap').textContent  = 'Shortfall: ' + INR(Math.max(0, tgt - bal));
}

function renderHealth() {
  const inc    = cache.income.filter(r => r[5] === curMonth).reduce((s, r) => s + +r[3], 0) || 22000;
  const exp    = cache.expenses.filter(r => r[5] === curMonth).reduce((s, r) => s + +r[3], 0);
  const mfSip  = cache.mf.reduce((s, r) => s + +r[3], 0);
  const chitTot= cache.chits.reduce((s, r) => s + +r[5], 0);
  const svRate = inc > 0 ? (inc - exp) / inc * 100 : 0;
  const invRate= inc > 0 ? mfSip / inc * 100 : 0;
  const chitR  = inc > 0 ? chitTot / inc * 100 : 0;

  const metrics = [
    { l:'Savings Rate', v:PCT(svRate), t:'≥ 20%', ok:svRate>=20, w:svRate>=10, a:'Save 20%+ of income monthly before investing' },
    { l:'Emergency Fund', v:'See Goals tab', t:'≥ 6 months', ok:false, w:true, a:'Build 6 months expenses in liquid fund first' },
    { l:'MF Investment Rate', v:PCT(invRate), t:'≥ 15%', ok:invRate>=15, w:invRate>=5, a:'Start Nifty 50 Index Fund — Direct plan, ₹2k/mo' },
    { l:'Chit Commitment vs Income', v:PCT(chitR), t:'< 100%', ok:chitR<=100, w:chitR<=150, a:'Chit payments should not exceed monthly income' },
    { l:'NPS Active', v:cache.inv.some(r=>r[2]==='NPS')?'Yes':'Not added', t:'Yes', ok:cache.inv.some(r=>r[2]==='NPS'), w:false, a:'NPS gives 80C + extra ₹50K 80CCD(1B) deduction' },
    { l:'Health Insurance', v:cache.ins.some(r=>r[2]==='Health')?'Active':'None', t:'Active', ok:cache.ins.some(r=>r[2]==='Health'), w:false, a:'Ensure ₹5L+ family floater policy' },
  ];

  el('health-metrics').innerHTML = metrics.map(m => `<div class="health-row">
    <div class="health-metric">${m.l}</div>
    <div class="health-val">${m.v}</div>
    <div class="health-target">${m.t}</div>
    <span class="badge badge-${m.ok ? 'green' : m.w ? 'amber' : 'red'}">${m.ok ? '✓ Good' : m.w ? '⚠ Improve' : '✗ Critical'}</span>
    <div class="health-action">${m.a}</div>
  </div>`).join('');

  const actions = [
    { p:'🔴 Urgent',      c:'red',   t:'Build Emergency Fund — ₹3–4L in liquid MF before investing elsewhere' },
    { p:'🔴 Urgent',      c:'red',   t:'Clarify how chit payments (₹72k+) are funded vs ₹22k salary' },
    { p:'🟡 Important',   c:'amber', t:'Review Life Insurance ₹1L/year — likely endowment with 4–6% returns only' },
    { p:'🟡 Important',   c:'amber', t:'Start Nifty 50 Index Fund SIP — even ₹2,000/month, Direct plan only' },
    { p:'🟢 Medium Term', c:'green', t:'Add US equity exposure via S&P 500 / NASDAQ fund (₹500–1k/mo)' },
    { p:'🟢 Medium Term', c:'green', t:'Invest in Sovereign Gold Bonds — 2.5% interest + gold price gain, tax-free at 8yr' },
    { p:'🔵 Long Term',   c:'blue',  t:'Maximise NPS 80CCD(1B) — ₹50,000 extra deduction saving ₹2,500–15,000 tax' },
  ];

  el('health-actions').innerHTML = actions.map(a => `
    <div style="display:flex;gap:12px;padding:11px 16px;border-radius:var(--r-sm);background:var(--bg);border:1px solid var(--bdr);border-left:3px solid var(--${a.c});align-items:center">
      <span style="font-family:var(--fh);font-size:11px;font-weight:700;color:var(--${a.c});white-space:nowrap;letter-spacing:.3px;min-width:95px">${a.p}</span>
      <span style="font-size:13px;color:var(--t1)">${a.t}</span>
    </div>`).join('');
}

function renderMonthly() {
  const m   = selMonth || curMonth;
  const inc = cache.income.filter(r => r[5] === m).reduce((s, r) => s + +r[3], 0);
  const exp = cache.expenses.filter(r => r[5] === m).reduce((s, r) => s + +r[3], 0);
  const sur = inc - exp;
  el('mo-inc').textContent  = INR(inc);
  el('mo-exp').textContent  = INR(exp);
  el('mo-sur').textContent  = INR(sur);
  el('mo-sur').className    = 'kpi-val ' + (sur >= 0 ? 'up' : 'dn');
  el('mo-rate').textContent = inc > 0 ? PCT(sur / inc * 100) : '0%';

  const cats = {};
  cache.expenses.filter(r => r[5] === m).forEach(r => { const c = r[2] || 'Other'; cats[c] = (cats[c] || 0) + +r[3]; });
  const maxC = Math.max(...Object.values(cats), 1);
  el('mo-cats').innerHTML = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => `
    <div style="display:grid;grid-template-columns:140px 1fr 90px;align-items:center;gap:14px;margin-bottom:10px">
      <span style="font-size:12px;font-weight:600;color:var(--t2)">${c}</span>
      <div class="progress"><div class="progress-fill" style="background:${CAT_COLORS[c] || '#7A8FA6'};width:${(v / maxC * 100).toFixed(0)}%"></div></div>
      <span style="font-family:var(--fm);font-size:12px;text-align:right">${INR(v)}</span>
    </div>`).join('') || '<div class="empty"><div class="empty-icon">📊</div><div class="empty-title">No Expenses for ' + m + '</div></div>';
}

function renderNW() {
  const a  = cache.assets.reduce((s, r) => s + +r[3], 0);
  const l  = cache.liab.reduce((s, r) => s + +r[3], 0);
  const nw = a - l;
  el('nw-a').textContent  = INR(a);
  el('nw-l').textContent  = INR(l);
  el('nw-t').textContent  = INR(nw);
  el('nw-t').className    = 'kpi-val ' + (nw >= 0 ? 'up' : 'dn');
  el('nw-ch').textContent = '—';

  el('assets-tbl').innerHTML = cache.assets.map((r, i) => `<tr>
    <td style="font-weight:600">${r[1] || '—'}</td>
    <td><span class="badge badge-green">${r[2] || '—'}</span></td>
    <td style="font-family:var(--fm);font-weight:700;color:var(--green)">${INR(r[3] || 0)}</td>
    <td style="font-size:11px;color:var(--t3)">${new Date().toLocaleDateString()}</td>
    <td><button class="del-btn" onclick="delEntry('${SHEETS.assets}','assets',${i + 1})">✕</button></td>
  </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:28px">No assets yet</td></tr>';

  el('liab-tbl').innerHTML = cache.liab.map((r, i) => `<tr>
    <td style="font-weight:600">${r[1] || '—'}</td>
    <td><span class="badge badge-red">${r[2] || '—'}</span></td>
    <td style="font-family:var(--fm);font-weight:700;color:var(--red)">${INR(r[3] || 0)}</td>
    <td style="font-size:11px;color:var(--t3)">${new Date().toLocaleDateString()}</td>
    <td><button class="del-btn" onclick="delEntry('${SHEETS.liab}','liab',${i + 1})">✕</button></td>
  </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:28px">No liabilities yet</td></tr>';
}

// ── DATA CRUD ─────────────────────────────────────────
async function saveRow(sheet, key, row, modalId) {
  try {
    await appendRow(sheet, row);
    cache[key].push(row);
    closeModal(modalId);
    renderCurrentPage();
    toast('Saved to Google Sheets ✓', 'ok');
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

async function delEntry(sheet, key, idx) {
  if (!confirm('Delete this entry?')) return;
  try {
    await deleteSheetRow(sheet, idx);
    cache[key].splice(idx - 1, 1);
    renderCurrentPage();
    toast('Deleted', 'ok');
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

async function addIncome() {
  const d = g('ii-date') || today(), m = toMonth(d);
  if (!g('ii-desc') || !g('ii-amt')) { toast('Enter description and amount', 'err'); return; }
  await saveRow(SHEETS.income, 'income', [uid(), g('ii-desc'), g('ii-cat'), g('ii-amt'), d, m, g('ii-note')], 'add-inc-modal');
}
async function addExpense() {
  const d = g('ei-date') || today(), m = toMonth(d);
  if (!g('ei-desc') || !g('ei-amt')) { toast('Enter description and amount', 'err'); return; }
  await saveRow(SHEETS.expenses, 'expenses', [uid(), g('ei-desc'), g('ei-cat'), g('ei-amt'), d, m, g('ei-note')], 'add-exp-modal');
}
async function addMF()    { await saveRow(SHEETS.mf,      'mf',      [uid(),g('mfi-name'),g('mfi-cat'),g('mfi-sip')||0,g('mfi-start')||'—',g('mfi-units')||0,g('mfi-nav')||0,''],             'add-mf-modal'); }
async function addChit()  { await saveRow(SHEETS.chits,   'chits',   [uid(),g('ci-name'),g('ci-val')||0,g('ci-mo')||20,g('ci-done')||0,g('ci-pm')||0,g('ci-start')||'—',g('ci-comm')||5,g('ci-status')||'Active'], 'add-chit-modal'); }
async function addChitPay(){ await saveRow(SHEETS.chitPay,'chitPay', [uid(),g('cp-mo'),g('cp-chit'),g('cp-amt')||0,g('cp-st')||'Paid',g('cp-note')],                                          'add-cpay-modal'); }
async function addInv()   { await saveRow(SHEETS.inv,     'inv',     [uid(),g('ivi-name'),g('ivi-type'),g('ivi-mo')||0,g('ivi-val')||0,g('ivi-tgt')||0,g('ivi-note')],                        'add-inv-modal'); }
async function addIns()   { await saveRow(SHEETS.ins,     'ins',     [uid(),g('ini-name'),g('ini-type'),g('ini-prem')||0,g('ini-cov')||0,g('ini-ren')||'',g('ini-st')||'Active'],              'add-ins-modal'); }
async function addGoal()  { await saveRow(SHEETS.goals,   'goals',   [uid(),g('gi-name'),g('gi-tgt')||0,g('gi-yr')||5,g('gi-saved')||0,''],                                                   'add-goal-modal'); }
async function addAsset() { await saveRow(SHEETS.assets,  'assets',  [uid(),g('ai-name'),g('ai-type'),g('ai-val')||0,today(),g('ai-note')],                                                    'add-asset-modal'); }
async function addLiab()  { await saveRow(SHEETS.liab,    'liab',    [uid(),g('li-name'),g('li-type'),g('li-amt')||0,today(),g('li-note')],                                                    'add-liab-modal'); }

// ── UI HELPERS ────────────────────────────────────────
function buildMonthTabs() {
  const now = new Date(), months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toLocaleDateString('en-IN', { month:'short', year:'2-digit' }).replace(' ', '-'));
  }
  ['ie-tabs','mo-tabs'].forEach(tid => {
    const tabEl = el(tid);
    if (!tabEl) return;
    tabEl.innerHTML = months.map(m =>
      `<button class="month-tab ${m === selMonth ? 'active' : ''}" onclick="selMo('${m}',this,'${tid}')">${m}</button>`
    ).join('');
  });
}

function selMo(m, btn, cid) {
  selMonth = m;
  qa(`#${cid} .month-tab`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderCurrentPage();
}

function setDateDefaults() {
  ['ii-date','ei-date','ini-ren'].forEach(id => {
    const e = el(id);
    if (e && e.type === 'date') e.value = today();
  });
}

function openModal(id)  { el(id).classList.add('open'); setDateDefaults(); }
function closeModal(id) { el(id).classList.remove('open'); }

function toast(msg, type = 'ok') {
  const t = el('toast');
  const item = document.createElement('div');
  item.className = 'toast-item toast-' + type;
  item.innerHTML = `<span>${type === 'ok' ? '✓' : '✕'}</span><span>${msg}</span>`;
  t.appendChild(item);
  setTimeout(() => item.remove(), 3200);
}