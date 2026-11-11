// ═══════════════════════════════════════════════════════════
//  LOGO HELPER
// ═══════════════════════════════════════════════════════════
function stockLogoImg(ticker, size = 28, cls = '') {
  return `<img src="https://financialmodelingprep.com/image-stock/${ticker}.png"
    width="${size}" height="${size}"
    class="stock-logo${cls ? ' ' + cls : ''}"
    onerror="this.replaceWith(stockLogoFallback('${ticker}',${size}))"
    alt="${ticker}">`;
}
function stockLogoFallback(ticker, size) {
  const el = document.createElement('div');
  el.className = 'stock-logo-fb';
  el.style.cssText = `width:${size}px;height:${size}px;font-size:${Math.round(size*0.38)}px`;
  el.textContent = ticker.slice(0,2);
  return el;
}

// ═══════════════════════════════════════════════════════════
//  STORAGE
// ═══════════════════════════════════════════════════════════
const SK = {
  trades:     'tj_trades_v4',
  port:       'tj_port_v4',
  key:        'tj_finnhub_key',
  fmpKey:     'tj_fmp_key',
  fee:        'tj_default_fee',
  risk:       'tj_risk_unit',
  draft:      'tj_form_draft',
  watchlist:  'tj_watchlist_v1',
  faData:     'tj_fa_data_v1',
  investCash: 'tj_invest_cash',
  portDad:       'tj_port_dad_v1',
  investCashDad: 'tj_invest_cash_dad',
  portOwner:     'tj_port_owner',
};

const ld    = k => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const ldObj = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const sv    = (k, v) => {
  localStorage.setItem(k, JSON.stringify(v));
  if (typeof dbPush === 'function') dbPush(k, v);
};

// ניקוי מפתח API: מסיר כל מה ש"נדבק" למפתח — גרשיים (מסנכרון ענן ישן שהרס
// אותו), רווחים/טאבים/שורות חדשות מהעתקה-הדבקה, ותווים נסתרים (zero-width / BOM
// / רווח קשיח). מפתח Finnhub הוא אלפאנומרי בלבד, אז חיתוך התווים האלה תמיד בטוח.
const _cleanKey = s => String(s || '')
  .replace(/[​-‍﻿ ]/g, '')  // zero-width / BOM / non-breaking space
  .replace(/["'`\s]/g, '')                       // גרשיים + כל תו רווח (כולל \n \t)
  .trim();
const getKey        = ()  => _cleanKey(localStorage.getItem(SK.key) || (window.APP_CONFIG && window.APP_CONFIG.finnhubApiKey) || '');
const setKey        = k   => _pushSetting(SK.key, k);
const getFmpKey     = ()  => _cleanKey(localStorage.getItem(SK.fmpKey) || (window.APP_CONFIG && window.APP_CONFIG.fmpApiKey) || '');
const setFmpKey     = k   => _pushSetting(SK.fmpKey, k);
// ריפוי מקור: אם המפתח השמור (מקומי/ענן) מלוכלך, כותבים חזרה גרסה נקייה —
// גם ל-localStorage וגם ל-Supabase — כדי שהגרשיים לא יימשכו שוב בכל רענון.
function normalizeStoredKey() {
  const raw = localStorage.getItem(SK.key);
  if (raw === null) return;
  const clean = _cleanKey(raw);
  if (clean && clean !== raw) setKey(clean);        // מעדכן מקומי + דוחף נקי לענן
  else if (!clean) localStorage.removeItem(SK.key); // ערך ריק/זבל בלבד
}
const getDefaultFee = ()  => { const v = parseFloat(localStorage.getItem(SK.fee)); return isNaN(v) ? 2.50 : v; };
const setDefaultFee = v   => _pushSetting(SK.fee, v);
const getRiskUnit   = ()  => { const v = parseFloat(localStorage.getItem(SK.risk)); return isNaN(v) ? 0 : v; };
const setRiskUnit   = v   => _pushSetting(SK.risk, v);
const getInvestCash = ()  => parseFloat(localStorage.getItem(isDadPort() ? SK.investCashDad : SK.investCash)) || 0;

// ── בעלי תיק ההשקעות: 'me' (התיק שלי — מסונכרן מ-IBKR) / 'dad' (התיק של אבא — ידני) ──
// כל הפונקציות של התיק עובדות על המשתנה portfolio; המעבר רק מחליף את הנתונים שבו.
let portOwner = (() => { try { return localStorage.getItem(SK.portOwner) === 'dad' ? 'dad' : 'me'; } catch { return 'me'; } })();
const isDadPort = () => portOwner === 'dad';
const portKey   = () => isDadPort() ? SK.portDad : SK.port;
// IBKR תמיד עובד מול התיק שלי, גם כשמוצג התיק של אבא
const getMyPortfolio  = () => isDadPort() ? ld(SK.port) : portfolio;
function saveMyPortfolio(list) {
  sv(SK.port, list);
  if (!isDadPort()) portfolio = list;
}

// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════
let trades = [], portfolio = [], watchlist = [];
let journalRU = 'all';   // יומן המסחר המוצג: 'all' = הכל, או ערך יחידת סיכון מספרי
let priceCache = {}, prevPrices = {};
let editTradeId = null, editHoldingId = null;
let activePMId = null, activeSLId = null, activeSellId = null, activeAddId = null, activeAddMode = 'portfolio';
let targetItems = [];
// כשממירים תכנון עסקה → עסקה: מחזיק את מזהה התכנון ומרחק הסטופ (בסנט)
// כדי למלא אוטומטית את הסטופ לפי מחיר הכניסה, ולסמן את התכנון כ"הומר" בשמירה.
let pendingPlan = null;   // { id, stopCents, dir } | null
let autoIv = 60, cdRemaining = 60, cdTimer = null, refreshTimer = null;
let equityChart = null;
let equityMode = 'value';   // 'value' = שווי תיק ($) · 'pct' = ביצועים באחוזים
let equityRange = '1w';     // 1w | mtd | 1m | 3m | ytd | 1y | all
let dashDate = new Date();
let autosaveTimeout = null;

// ═══════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════
const PORT_COLORS = ['#007AFF','#248A3D','#5856D6','#C93400','#30B0C7','#F2662E','#67C17A','#B9A6F5','#AF52DE','#AEAEB2'];
const TARGET_CFG  = [
  { badge: 't1', label: 'יעד 1', pct: 50 },
  { badge: 't2', label: 'יעד 2', pct: 25 },
  { badge: 't3', label: 'יעד 3', pct: 25 },
];
const QUARTERS    = ['Q1', 'Q2', 'Q3', 'Q4', 'שנתי'];
const HL_LABEL    = { pos: 'חיובי', neg: 'שלילי', neu: 'נייטרלי' };

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════
// תאריך מקומי (לא UTC) — toISOString עלול להחזיר יום קודם/הבא בערב
const today   = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const escHtml = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const pnlCol  = v  => v >= 0 ? 'var(--green)' : 'var(--red)';
const signStr = v  => v >= 0 ? '+' : '';

const fmtM = n => {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  return (n >= 0 ? '+$' : '-$') + (a >= 1000 ? (a / 1000).toFixed(1) + 'K' : a.toFixed(2));
};
const fmtD = n => n === null || n === undefined ? '—' : (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(0);

// פורמט לצירי גרפים: $18.4K / $950 / -$1.2K
const fmtAxisUSD = v => {
  const a = Math.abs(v);
  return (v < 0 ? '-$' : '$') + (a >= 1000 ? (a / 1000).toFixed(1) + 'K' : a.toFixed(0));
};

// צבעים לגרפי Chart.js — הקנבס לא יודע לפענח var(--...) של CSS, ולכן
// חייבים ערכי צבע אמיתיים לפי מצב התצוגה (בהיר/כהה), אחרת הטקסט נופל
// לברירת המחדל הכהה של Chart.js ולא נקרא במצב כהה.
function chartInk() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return dark
    ? { tick: '#A6A6B2', grid: 'rgba(255,255,255,0.08)', zero: 'rgba(255,255,255,0.32)' }
    : { tick: '#6B6B76', grid: 'rgba(0,0,0,0.08)',       zero: 'rgba(0,0,0,0.30)' };
}

// ברירות מחדל גלובליות (טולטיפ/מקרא/טקסט) — מתעדכן גם בהחלפת מצב תצוגה
function applyChartTheme() {
  if (typeof Chart === 'undefined') return;
  const ink = chartInk();
  Chart.defaults.color = ink.tick;
  Chart.defaults.borderColor = ink.grid;
}

const toast = msg => {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
};

const showSaved = id => {
  const el = document.getElementById(id);
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
};

// ═══════════════════════════════════════════════════════════
//  FINNHUB API
// ═══════════════════════════════════════════════════════════
async function fetchSinglePrice(symbol, token) {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    if (!d || d.c === 0) return null;
    return { price: d.c, change: +(d.d || 0), changesPercentage: +(d.dp || 0), prevClose: d.pc, high: d.h, low: d.l, open: d.o };
  } catch (e) { console.warn('fetchSinglePrice', symbol, e); return null; }
}

async function fetchPrices(tickers) {
  const key = getKey();
  if (!key || !tickers.length) return {};
  const unique = [...new Set(tickers)];
  const result = {};
  for (const sym of unique) {
    if (priceCache[sym]) { result[sym] = priceCache[sym]; continue; }
    const q = await fetchSinglePrice(sym, key);
    if (q) { result[sym] = q; priceCache[sym] = q; }
    if (unique.length > 1) await new Promise(r => setTimeout(r, 120));
  }
  return result;
}

// ═══════════════════════════════════════════════════════════
//  AUTO REFRESH
// ═══════════════════════════════════════════════════════════
function setIv(s) {
  autoIv = s;
  ['30','60','300','0'].forEach(v => document.getElementById('iv-' + v)?.classList.remove('on'));
  document.getElementById('iv-' + s)?.classList.add('on');
  clearInterval(refreshTimer);
  clearInterval(cdTimer);
  if (s > 0) {
    cdRemaining = s;
    startCd(s);
    refreshTimer = setInterval(() => { fullRefresh(); cdRemaining = s; }, s * 1000);
  } else {
    document.getElementById('cd-num').textContent = '—';
    document.getElementById('cd-ring').style.strokeDashoffset = 0;
  }
}

function startCd(total) {
  clearInterval(cdTimer);
  const circ = 37.7;
  cdTimer = setInterval(() => {
    cdRemaining = Math.max(0, cdRemaining - 1);
    document.getElementById('cd-num').textContent = cdRemaining || total;
    document.getElementById('cd-ring').style.strokeDashoffset = circ * (1 - cdRemaining / total);
    if (cdRemaining === 0) cdRemaining = total;
  }, 1000);
}

async function fullRefresh() {
  priceCache = {};
  await loadLive();
}

function flash(el, newP, key) {
  if (!el) return;
  const prev = prevPrices[key];
  if (prev !== undefined && newP !== prev) {
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(newP > prev ? 'flash-up' : 'flash-down');
  }
  prevPrices[key] = newP;
}

// ═══════════════════════════════════════════════════════════
function setGrade(g) {
  document.getElementById('f-grade-1')?.classList.toggle('active', g === '1');
  document.getElementById('f-grade-2')?.classList.toggle('active', g === '2');
  if (document.getElementById('f-ticker')) draftSave();
}

//  AUTOSAVE (DRAFT)
// ═══════════════════════════════════════════════════════════
function draftSave() {
  setAutosaveBar('saving', 'שומר...');
  clearTimeout(autosaveTimeout);
  autosaveTimeout = setTimeout(() => {
    const draft = {
      ticker:   document.getElementById('f-ticker').value,
      date:     document.getElementById('f-date').value,
      dir:      document.getElementById('f-dir').value,
      entry:    document.getElementById('f-entry').value,
      qty:      document.getElementById('f-qty').value,
      fee:      document.getElementById('f-fee').value,
      sl:       document.getElementById('f-sl').value,
      exit:     document.getElementById('f-exit').value,
      status:   document.getElementById('f-status').value,
      grade:    document.getElementById('f-grade-1')?.classList.contains('active') ? '1' : '2',
      reason:   document.getElementById('f-reason').value,
      scenario: document.getElementById('f-scenario').value,
      targets:  JSON.parse(JSON.stringify(targetItems)),
      editTradeId,
      pendingPlan,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(SK.draft, JSON.stringify(draft));
    setAutosaveBar('saved', 'נשמר ✓');
    setTimeout(() => setAutosaveBar('idle', 'שמירה אוטומטית פעילה'), 2000);
  }, 600);
}

function setAutosaveBar(state, txt) {
  const bar  = document.getElementById('autosave-bar');
  const span = document.getElementById('autosave-txt');
  if (!bar || !span) return;
  bar.className    = 'autosave-bar ' + state;
  span.textContent = txt;
}

function loadDraft() {
  try {
    const d = ldObj(SK.draft);
    if (!d || d.editTradeId) return false;
    const fields = { 'f-ticker': 'ticker', 'f-date': 'date', 'f-dir': 'dir', 'f-entry': 'entry',
                     'f-qty': 'qty', 'f-sl': 'sl', 'f-exit': 'exit', 'f-status': 'status',
                     'f-reason': 'reason', 'f-scenario': 'scenario' };
    Object.entries(fields).forEach(([id, key]) => { if (d[key]) document.getElementById(id).value = d[key]; });
    if (d.grade) setGrade(d.grade);
    if (d.fee !== undefined && d.fee !== '') document.getElementById('f-fee').value = d.fee;
    if (d.targets?.length) { targetItems = d.targets; renderTargets(); }
    pendingPlan = d.pendingPlan || null;   // שחזור קישור להמרה מתכנון
    if (d.ticker || d.entry) {
      const t = d.savedAt ? new Date(d.savedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';
      setAutosaveBar('saved', 'טיוטה שוחזרה' + (t ? ` (${t})` : ''));
      setTimeout(() => setAutosaveBar('idle', 'שמירה אוטומטית פעילה'), 3000);
      calcFormPnl();
      return true;
    }
    return false;
  } catch { return false; }
}

function clearDraft() { localStorage.removeItem(SK.draft); }

// ── Individual settings cloud push ───────────────────────────
function _pushSetting(key, value) {
  localStorage.setItem(key, value);
  if (typeof dbPush === 'function') dbPush(key, value);
}

// ═══════════════════════════════════════════════════════════
//  EXPORT / IMPORT
// ═══════════════════════════════════════════════════════════
function exportData() {
  // Export every app key — anything prefixed tj_/tj- plus the legacy prep key.
  // Using a dynamic scan (instead of a fixed list) so newly added data types
  // are never silently left out of the backup.
  const exportKeys = Object.keys(localStorage).filter(k =>
    (k.startsWith('tj_') || k.startsWith('tj-')) && k !== SK.draft && k !== DB_CFG_KEY
  );
  const data = { _version: 1, _exported: new Date().toISOString() };
  exportKeys.forEach(k => { const v = localStorage.getItem(k); if (v !== null) data[k] = v; });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `trading-journal-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('✓ גיבוי יוצא בהצלחה');
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data._version) throw new Error('קובץ לא תקין');
        const skip = new Set(['_version', '_exported']);
        const importedKeys = [];
        Object.entries(data).forEach(([k, v]) => {
          if (!skip.has(k)) { localStorage.setItem(k, v); importedKeys.push(k); }
        });
        // Push imported data to cloud BEFORE reload, so the cloud pull-on-init
        // doesn't overwrite what we just imported with stale cloud data.
        if (typeof dbIsReady === 'function' && dbIsReady() && typeof dbPushAll === 'function') {
          toast(`✓ יובאו ${importedKeys.length} פריטים — מסנכרן לענן...`);
          await dbPushAll(importedKeys);
        } else {
          toast(`✓ יובאו ${importedKeys.length} פריטים — מרענן...`);
        }
        setTimeout(() => location.reload(), 1000);
      } catch { toast('⚠ שגיאה בייבוא הקובץ'); }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ═══════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════
function openSettings() {
  document.getElementById('settings-fee').value         = getDefaultFee().toFixed(2);
  document.getElementById('settings-key').value         = getKey();
  document.getElementById('settings-fmp-key').value     = getFmpKey();
  document.getElementById('settings-risk').value        = getRiskUnit() > 0 ? getRiskUnit() : '';
  ['settings-saved','risk-saved'].forEach(id => document.getElementById(id).classList.remove('show'));
  if (typeof dbOpenSetup === 'function') dbOpenSetup();
  if (typeof dbIsReady === 'function' && dbIsReady()) {
    const code = typeof dbGenSetupCode === 'function' ? dbGenSetupCode() : '';
    const codeDisplay = document.getElementById('db-code-display');
    if (codeDisplay && code) { codeDisplay.textContent = code; document.getElementById('db-code-section')?.style.removeProperty('display'); }
  }
  document.getElementById('settings-overlay').classList.add('open');
}

function closeSettings() { document.getElementById('settings-overlay').classList.remove('open'); }

function saveSettings() {
  const v = parseFloat(document.getElementById('settings-fee').value);
  if (!isNaN(v) && v >= 0) {
    setDefaultFee(v);
    showSaved('settings-saved');
    updateFeeHint();
    toast(`✓ עמלת ברירת מחדל: $${v.toFixed(2)}`);
  } else { toast('⚠ הכנס ערך תקין'); }
}

function saveApiKey() {
  const k = _cleanKey(document.getElementById('settings-key').value);
  if (k) { setKey(k); document.getElementById('settings-key').value = k; toast('✓ Finnhub API Key עודכן'); closeSettings(); fullRefresh(); }
  else   { toast('⚠ הכנס API Key תחילה'); }
}

function saveFmpApiKey() {
  const k = _cleanKey(document.getElementById('settings-fmp-key').value);
  if (k) { setFmpKey(k); document.getElementById('settings-fmp-key').value = k; toast('✓ FMP API Key עודכן'); }
  else   { toast('⚠ הכנס API Key תחילה'); }
}

function saveRiskUnit() {
  const v = parseFloat(document.getElementById('settings-risk').value);
  if (!isNaN(v) && v > 0) {
    setRiskUnit(v);
    showSaved('risk-saved');
    toast(`✓ יחידת סיכון: $${v.toFixed(0)}`);
  } else {
    localStorage.removeItem(SK.risk);
    if (typeof dbPush === 'function') dbPush(SK.risk, null);
    toast('✓ יחידת סיכון נמחקה');
  }
  renderStats();
}

function updateFeeHint() {
  const fee   = getDefaultFee();
  const hint  = document.getElementById('fee-hint');
  const txt   = document.getElementById('fee-hint-txt');
  const badge = document.getElementById('fee-default-badge');
  if (fee > 0) {
    hint.style.display = 'flex';
    txt.textContent    = `ברירת מחדל: $${fee.toFixed(2)} (שנה בהגדרות)`;
    if (badge) badge.textContent = `(ברירת מחדל: $${fee.toFixed(2)})`;
  } else {
    hint.style.display = 'none';
    if (badge) badge.textContent = '';
  }
}

// ═══════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════

// Chart.js לא תמיד מרענן את גודל הקנבס כשחלון הדפדפן משתנה (או כשחוצים
// את שבירת המובייל), אז הגרפים "נתקעים" ברוחב ישן וזולגים לצד אחד.
// מאזין אחד, עם השהיה, שמצייר מחדש את הגרפים של העמוד הפעיל.
let _resizeT = null;
function handleViewportResize() {
  clearTimeout(_resizeT);
  _resizeT = setTimeout(() => {
    const active = document.querySelector('.page.active');
    if (!active) return;
    try {
      if (active.id === 'page-live')            renderEquityChart();
    } catch (e) { /* אל תפיל את העמוד בגלל ריענון גרף */ }
  }, 180);
}
// Chart.js לפעמים ננעל על גודל קנבס ברירת-מחדל (≈300px) כשהמכל לא היה
// בגודלו הסופי ברגע היצירה — טעינה ראשונה (בעיקר ב-Safari), טעינת פונטים,
// או מעבר בין טאבים. הפונקציה מכריחה מדידה מחדש אחרי שהפריסה מתייצבת,
// ומחברת ResizeObserver פעם אחת לכל מכל גרף כך שכל שינוי רוחב אמיתי
// (כולל הופעת העמוד מ-display:none) מצייר את הגרף מחדש לרוחב המלא.
const _chartWrapObs = new WeakMap();
function keepChartFitted(getChart, wrap) {
  if (!wrap) return;
  const fit = () => {
    const ch = getChart();
    if (!ch || !ch.canvas) return;
    try {
      if (Math.abs(ch.width - wrap.clientWidth) > 1 || Math.abs(ch.height - wrap.clientHeight) > 1) ch.resize();
    } catch (e) { /* אל תפיל את העמוד בגלל ריענון גרף */ }
  };
  requestAnimationFrame(fit);
  setTimeout(fit, 250);
  if (typeof ResizeObserver !== 'undefined' && !_chartWrapObs.has(wrap)) {
    const obs = new ResizeObserver(fit);
    obs.observe(wrap);
    _chartWrapObs.set(wrap, obs);
  }
}

// ── ניווט ──
// שלושה אזורים: בית (סקירה · משימות · ניתוח חברות · תכנון חלוקה),
// עסקאות (פתוחות · ביצועים · תכנון) ותיק השקעות. "עסקה חדשה" שייכת לעסקאות.
const NAV_GROUP   = { home: 'home', live: 'trades', dashboard: 'trades', prep: 'trades', add: 'trades', portfolio: 'portfolio' };
const TRADES_TABS = [
  ['live',      'פתוחות',  'הפוזיציות הפתוחות ושווי חשבון המסחר'],
  ['dashboard', 'ביצועים', 'סטטיסטיקה, רווח לפי יום והעסקאות שנסגרו'],
  ['prep',      'תכנון',   'עסקאות שאתה מכין לפני שנכנסים'],
];
let lastTradesPage = 'live';

function nav(page, btn) {
  let homeView = null;
  if (page === 'trades')   page = lastTradesPage;
  if (page === 'closed')   page = 'dashboard';                 // הדף אוחד לתוך "ביצועים"
  if (page === 'analysis') { page = 'home'; homeView = 'companies'; }   // ניתוח חברות עבר לבית
  if (page === 'tasks')    { page = 'home'; homeView = 'tasks'; }
  const el = document.getElementById('page-' + page);
  if (!el) return;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p === el));
  navHighlight(NAV_GROUP[page] || page, page === 'home' && homeView === 'tasks' ? 'tasks' : null);
  if (TRADES_TABS.some(t => t[0] === page)) { lastTradesPage = page; renderSecHeads(page); }
  const main = document.querySelector('.main');
  if (main) main.scrollTop = 0;
  const actions = {
    home:      () => { if (window.bcHome) homeView ? window.bcHome.view(homeView) : window.bcHome.render(); },
    dashboard: () => { loadDashboard(); renderClosedTable(); },
    live:      loadLive,
    portfolio: loadPortfolio,
    prep:      () => { if (typeof prepRender === 'function') prepRender(); },
    add:       () => { if (!editTradeId) { resetForm(); loadDraft(); } },
  };
  actions[page]?.();
}

// מסמן את האזור הפעיל בתפריט הצד ובסרגל התחתון בטלפון
function navHighlight(group, mobileGroup) {
  document.querySelectorAll('.nav-item[data-group]').forEach(n => n.classList.toggle('active', n.dataset.group === group));
  const mg = mobileGroup || group;
  document.querySelectorAll('.mbn-item[data-group]').forEach(n => n.classList.toggle('active', n.dataset.group === mg));
}

// כפתורי מצב כהה והגדרות — בטלפון אין תפריט צד, אז הם יושבים בכותרת
function mobActionsHtml() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return `<button type="button" class="sh-icon" onclick="toggleTheme()" aria-label="${dark ? 'מעבר למצב בהיר' : 'מעבר למצב כהה'}"><i class="ti ti-${dark ? 'moon' : 'sun'}"></i></button>` +
         `<button type="button" class="sh-icon" onclick="openSettings()" aria-label="הגדרות"><i class="ti ti-settings"></i></button>`;
}
function syncThemeButtons() {
  document.querySelectorAll('[data-mob-actions]').forEach(el => { el.innerHTML = mobActionsHtml(); });
}

// הכותרת המשותפת של אזור העסקאות: כותרת גדולה + לשוניות
function renderSecHeads(active) {
  const cur = TRADES_TABS.find(t => t[0] === active) || TRADES_TABS[0];
  const tabs = TRADES_TABS.map(([id, label]) =>
    `<button type="button" role="tab" class="bc-tab ${id === cur[0] ? 'on' : ''}" aria-selected="${id === cur[0]}" onclick="nav('${id}')">${label}</button>`).join('');
  document.querySelectorAll('.sec-head[data-sec="trades"]').forEach(el => {
    el.innerHTML = `<header class="bc-head sh">
        <div><h1>עסקאות</h1><p class="bc-muted">${cur[2]}</p></div>
        <div class="sh-end"><span class="sh-mob" data-mob-actions>${mobActionsHtml()}</span></div>
      </header>
      <div class="bc-tabs" role="tablist" aria-label="חלקי העסקאות">${tabs}</div>`;
  });
}

// ═══════════════════════════════════════════════════════════
//  STATUS DOT
// ═══════════════════════════════════════════════════════════
function setDot(which, state, lbl) {
  const dot   = document.getElementById(which + '-dot');
  const lblEl = document.getElementById(which + '-lbl');
  const styles = {
    green: { bg: 'var(--green)', anim: 'pulse 2s infinite', cls: 'badge-green' },
    amber: { bg: 'var(--amber)', anim: 'pulse 2s infinite', cls: 'badge-amber' },
    off:   { bg: 'var(--tx3)',   anim: 'none',              cls: 'badge-off'   },
  };
  const s = styles[state] || styles.off;
  dot.style.background = s.bg;
  dot.style.animation  = s.anim;
  lblEl.className      = 'hdr-badge ' + s.cls;
  lblEl.textContent    = lbl;
}

// ═══════════════════════════════════════════════════════════
//  TRADING ACCOUNT CARD  (shared: live page + stats panel)
// ═══════════════════════════════════════════════════════════
// מזומן בחשבון המסחר. מתחילים מהיתרה שנמשכה מ-IBKR ומקזזים ממנה את עלות
// הפוזיציות שנפתחו ידנית *אחרי* תצלום המזומן האחרון — כי IBKR עדיין לא "יודע"
// עליהן, אז בלי הקיזוז המזומן הפנוי היה מוצג גבוה מדי עד הסנכרון הבא.
// null אם אין נתון מ-IBKR כלל.
function getTradesCash() {
  const raw = (typeof ibkrCashFor === 'function') ? ibkrCashFor('trades') : null;
  if (raw === null) return null;
  return +(raw - unreflectedTradesCost()).toFixed(2);
}

// עלות הפוזיציות הפתוחות ביומן — "מזומן שתפוס בעסקאות"
function openTradesCost() {
  return trades.filter(t => t.status === 'open')
    .reduce((s, t) => s + (t.entry || 0) * (t.remainingQty ?? t.qty ?? 0), 0);
}

// עלות הפוזיציות הפתוחות שנפתחו ידנית אחרי תצלום המזומן האחרון של IBKR —
// אלה שעדיין לא מקוזזות ביתרת המזומן שנמשכה. מזוהות לפי מזהה העסקה (חותמת
// זמן היצירה במ"ש) שגדול מחותמת התצלום. עסקאות שיובאו מ-IBKR כבר מקוזזות ולכן מדולגות.
function unreflectedTradesCost() {
  const ts = (typeof ibkrCashTs === 'function') ? ibkrCashTs() : null;
  if (!ts) return 0;
  return trades
    .filter(t => t.status === 'open' && t.source !== 'ibkr' && +t.id > ts)
    .reduce((s, t) => s + (t.entry || 0) * (t.remainingQty ?? t.qty ?? 0), 0);
}

// טקסט מקור המזומן: "IBKR • לפני X" — בכתום כשהנתון בן יותר מיממה (סנכרון כנראה נכשל)
function cashSourceNote() {
  const age   = (typeof ibkrCashAgeTxt === 'function') ? ibkrCashAgeTxt() : '';
  const stale = (typeof ibkrCashIsStale === 'function') && ibkrCashIsStale();
  return { txt: age ? `IBKR • ${age}` : 'נמשך מ-IBKR', stale };
}

// המזומן נמשך מכמה חשבונות אבל אף אחד לא שויך לתיק הזה — צריך לבחור בהגדרות
function cashNeedsMapping(dest) {
  return (typeof ibkrCashUnmapped === 'function') && ibkrCashUnmapped(dest);
}
const CASH_MAP_CTA = '<span onclick="openSettings()" style="color:var(--amber-t);cursor:pointer;text-decoration:underline">שייך חשבון לתיק בהגדרות ←</span>';

// כרטיס "מזומן פנוי — מסחר" בעמוד העסקאות החיות
function updateLiveCashCard(openCost) {
  const cash = getTradesCash();
  const cashCard = document.getElementById('sum-cash-card');
  const bar = document.getElementById('trading-summary-bar');
  if (cash !== null) {
    const acctSize = cash + openCost;
    const src = cashSourceNote();
    document.getElementById('sum-cash').textContent = '$' + Math.round(cash).toLocaleString();
    document.getElementById('sum-cash').style.color = cash >= 0 ? 'var(--tx)' : 'var(--red)';
    const sub = document.getElementById('sum-cash-sub');
    sub.textContent = (acctSize > 0 ? (cash / acctSize * 100).toFixed(1) + '% מהחשבון · ' : '') + src.txt;
    sub.style.color = src.stale ? 'var(--amber-t)' : '';
    cashCard.style.display = '';
    bar.style.gridTemplateColumns = 'repeat(4,1fr)';
  } else if (cashNeedsMapping('trades')) {
    // המזומן נמשך אבל לא ברור מאיזה חשבון — מציגים הנחיה במקום להסתיר
    document.getElementById('sum-cash').textContent = '—';
    document.getElementById('sum-cash').style.color = '';
    const sub = document.getElementById('sum-cash-sub');
    sub.innerHTML = CASH_MAP_CTA;
    sub.style.color = '';
    cashCard.style.display = '';
    bar.style.gridTemplateColumns = 'repeat(4,1fr)';
  } else {
    cashCard.style.display = 'none';
    bar.style.gridTemplateColumns = 'repeat(3,1fr)';
  }
}

// ═══════════════════════════════════════════════════════════
//  ACCOUNT STATS
// ═══════════════════════════════════════════════════════════
function renderStats() {
  // כל תצוגת הכרטיס (מספר גדול, תת-כותרת וגרף) נגזרת מהמצב והטווח הנבחרים
  renderEquityChart();
}

// טווחי הזמן של גרף הסטטוס — תווית + מספר ימים אחורה (או mtd/ytd)
const EQ_RANGES = {
  '1w':  { lbl: 'השבוע האחרון',   span: 7 },
  'mtd': { lbl: 'מתחילת החודש',   span: 'mtd' },
  '1m':  { lbl: 'החודש האחרון',   span: 30 },
  '3m':  { lbl: 'שלושת החודשים',  span: 91 },
  'ytd': { lbl: 'מתחילת השנה',    span: 'ytd' },
  '1y':  { lbl: 'השנה האחרונה',   span: 365 },
  'all': { lbl: 'כל התקופה',      span: Infinity },
};

function eqRangeCutoff(key) {
  const span = (EQ_RANGES[key] || EQ_RANGES.all).span;
  if (span === Infinity) return null;
  const now = new Date(today() + 'T00:00:00');
  if (span === 'mtd') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  if (span === 'ytd') return new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
  const c = new Date(now); c.setDate(c.getDate() - span);
  return c.toISOString().split('T')[0];
}

function setEquityMode(mode) {
  equityMode = mode;
  document.getElementById('eq-tab-value')?.classList.toggle('on', mode === 'value');
  document.getElementById('eq-tab-pct')?.classList.toggle('on', mode === 'pct');
  renderEquityChart();
}

function setEquityRange(range) {
  equityRange = range;
  document.querySelectorAll('#eq-range-seg .eq-range-btn').forEach(b =>
    b.classList.toggle('on', b.getAttribute('onclick').includes(`'${range}'`)));
  renderEquityChart();
}

// סדרת שווי יומית רציפה (forward-fill) — כדי שאפשר לחתוך לפי טווח זמן אמיתי
function accountDailyPoints() {
  const s        = accountValueSeries();
  const eventPts = s.pts.filter(p => p.x !== 'התחלה');   // נקודות עם תאריך אמיתי
  if (!eventPts.length) return { days: [], baseKnown: s.baseKnown };
  const valByDate = {};
  eventPts.forEach(p => { valByDate[p.x] = p.y; });
  // מתחילים יום לפני האירוע הראשון ברמת הבסיס, ואז ממלאים קדימה עד היום
  const start = new Date(eventPts[0].x + 'T00:00:00');
  start.setDate(start.getDate() - 1);
  const end   = new Date(today() + 'T00:00:00');
  const days  = [];
  let cur = s.base;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().split('T')[0];
    if (valByDate[key] !== undefined) cur = valByDate[key];
    days.push({ date: key, val: cur });
  }
  return { days, baseKnown: s.baseKnown };
}

function renderEquityChart() {
  const canvas = document.getElementById('equity-chart');
  const bigEl  = document.getElementById('eq-big');
  const subEl  = document.getElementById('eq-sub');
  if (!canvas) return;
  if (equityChart) { equityChart.destroy(); equityChart = null; }

  const pct = equityMode === 'pct';
  const { days } = accountDailyPoints();
  if (!days.length) {
    if (bigEl) { bigEl.textContent = '—'; bigEl.style.color = ''; }
    if (subEl) subEl.textContent = '';
    return;
  }

  // חיתוך לפי הטווח הנבחר (לפחות שתי נקודות כדי לצייר קו)
  const cutKey = eqRangeCutoff(equityRange);
  let view = cutKey ? days.filter(p => p.date >= cutKey) : days;
  if (view.length < 2) view = days.slice(-Math.max(2, view.length));

  const startVal  = view[0].val;
  const lastVal   = view[view.length - 1].val;
  const changeAbs = lastVal - startVal;
  const changePct = startVal !== 0 ? (changeAbs / Math.abs(startVal)) * 100 : 0;
  const rangeLbl  = (EQ_RANGES[equityRange] || {}).lbl || '';

  // עוזרי פורמט עם סימן +/- מלא (כמו במסכי הייחוס)
  const fMoney = v => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toLocaleString('en', { maximumFractionDigits: 0 });
  const fPct   = v => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(2) + '%';

  // מספר גדול + תת-כותרת לפי המצב
  if (pct) {
    if (bigEl) { bigEl.textContent = fPct(changePct); bigEl.style.color = pnlCol(changeAbs); }
    if (subEl) subEl.textContent = 'תשואה כוללת · ' + rangeLbl;
  } else {
    if (bigEl) { bigEl.textContent = '$' + lastVal.toLocaleString('en', { maximumFractionDigits: 0 }); bigEl.style.color = ''; }
    if (subEl) subEl.innerHTML = `<span style="color:${pnlCol(changeAbs)}">${fMoney(changeAbs)} (${fPct(changePct)})</span> · ${rangeLbl}`;
  }

  // ערכי ציר Y: שווי דולרי, או תשואה באחוזים מתחילת הטווח
  const data = view.map(p => pct
    ? (startVal !== 0 ? +(((p.val - startVal) / Math.abs(startVal)) * 100).toFixed(3) : 0)
    : +p.val.toFixed(2));

  const ink = chartInk();
  const axisCol = ink.tick;
  const GREEN = '#22C55E', RED = '#EF4444', BLUE = '#3B82F6';

  const dataset = pct
    ? {  // ביצועים: קו ושטח ירוקים מעל האפס, אדומים מתחתיו, עם קו בסיס באפס
        data, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25,
        borderColor: changeAbs >= 0 ? GREEN : RED,
        segment: { borderColor: ctx => (ctx.p1.parsed.y < 0 ? RED : GREEN) },
        fill: { target: { value: 0 }, above: 'rgba(34,197,94,0.14)', below: 'rgba(239,68,68,0.14)' },
      }
    : {  // ערך תיק: קו כחול עם שטח עדין
        data, borderColor: BLUE, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25,
        fill: true, backgroundColor: 'rgba(59,130,246,0.10)',
      };

  equityChart = new Chart(canvas, {
    type: 'line',
    data: { labels: view.map(p => p.date), datasets: [dataset] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            label: c => pct ? fPct(c.parsed.y) : '$' + c.parsed.y.toLocaleString('en', { maximumFractionDigits: 0 }),
          },
        },
      },
      scales: {
        x: {
          display: true,
          grid: { display: false },
          ticks: { font: { size: 10, family: "'IBM Plex Mono'" }, color: axisCol, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 },
        },
        y: {
          display: true,
          position: 'right',
          grid: { color: ctx => (pct && ctx.tick.value === 0) ? ink.zero : ink.grid },
          border: { display: false },
          ticks: { font: { size: 10, family: "'IBM Plex Mono'" }, color: axisCol, maxTicksLimit: 5, callback: v => pct ? (+v).toFixed(Math.abs(+v) < 10 ? 1 : 0) + '%' : fmtAxisUSD(+v) },
        },
      },
      animation: { duration: 400 },
    },
  });
  keepChartFitted(() => equityChart, canvas.parentElement);
}

// ═══════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════
// סדרת שווי התיק לאורך זמן: הון הבסיס (שווי נוכחי פחות P&L מצטבר)
// ועליו כל עסקה סגורה מוסיפה/גורעת. אם אין נתון מזומן מ-IBKR —
// הבסיס 0 והגרף מציג שינוי מצטבר בלבד (אותה צורה, ללא רמת שווי אמיתית).
// pnlOnly = מציג רווח מצטבר מ-0 (ליומן בודד), בלי בסיס שווי החשבון הכולל
function accountValueSeries(src = trades, pnlOnly = false) {
  // נבנה מאותם אירועי מימוש יומיים כמו לוח השנה — כולל מימושים חלקיים
  // של עסקאות פתוחות — כך שכל המסכים מציגים את אותו רווח ממומש
  const map      = dailyPnlMap(src);
  const dates    = Object.keys(map).sort();
  const totalPnl = dates.reduce((s, d) => s + map[d].pnl, 0);
  const cash     = pnlOnly ? null : getTradesCash();
  const acctVal  = cash !== null ? cash + openTradesCost() : null;
  const base     = acctVal !== null ? acctVal - totalPnl : 0;
  let cum = base;
  const pts = [{ x: 'התחלה', y: +base.toFixed(2) }];
  dates.forEach(d => { cum += map[d].pnl; pts.push({ x: d, y: +cum.toFixed(2) }); });
  return { pts, baseKnown: acctVal !== null, base, acctVal, totalPnl, n: dates.length };
}

// ── יומני מסחר לפי יחידת סיכון ──────────────────────────────
// כל עסקה נושאת את יחידת הסיכון שהייתה פעילה בעת פתיחתה (trade.riskUnit).
// journalRU קובע איזה יומן מוצג — כך שהחלפת יחידת הסיכון בהגדרות פותחת
// יומן ודאשבורד חדש, ואפשר לעבור בין היומן של $100, $200 וכן הלאה.
function tradeRU(t) { const r = +t.riskUnit; return r > 0 ? r : 0; }

// כל ערכי יחידת הסיכון שמופיעים בעסקאות + ההגדרה הנוכחית, ממוינים
function journalUnits() {
  const set = new Set();
  trades.forEach(t => { const r = tradeRU(t); if (r > 0) set.add(r); });
  const cur = getRiskUnit(); if (cur > 0) set.add(cur);
  return [...set].sort((a, b) => a - b);
}

// העסקאות של היומן המוצג בלבד
function journalTrades() {
  if (journalRU === 'all') return trades;
  const ru = +journalRU;
  return trades.filter(t => tradeRU(t) === ru);
}

// יחידת הסיכון של היומן המוצג — לחישוב R
function journalRiskUnit() {
  return journalRU === 'all' ? getRiskUnit() : +journalRU;
}

function setJournal(val) {
  journalRU = val;
  loadDashboard();
  renderClosedTable();
}

// ממלא את שני בוררי היומן (דאשבורד + עסקאות שנסגרו) באותן אפשרויות
function renderJournalSelectors() {
  const units = journalUnits();
  if (journalRU !== 'all' && !units.includes(+journalRU)) journalRU = 'all';   // היומן נמחק → חזרה להכל
  const opts = ['<option value="all">כל היומנים</option>']
    .concat(units.map(u => `<option value="${u}">יחידת סיכון $${u.toLocaleString('en')}</option>`))
    .join('');
  ['dash-journal', 'closed-journal'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = opts;
    el.value = journalRU;
    const wrap = el.closest('.journal-select-wrap');
    if (wrap) wrap.style.display = units.length > 1 ? '' : 'none';   // בורר מוצג רק כשיש יותר מיומן אחד
  });
}

function loadDashboard() {
  renderJournalSelectors();
  renderDashStats();
  renderDashCalendar();
}

function renderDashStats() {
  const jt       = journalTrades();
  const closed   = jt.filter(t => t.status === 'closed' && t.pnl !== null);
  const totalPnl = totalRealizedPnl(jt);
  const winners  = closed.filter(t => t.pnl > 0);
  const losers   = closed.filter(t => t.pnl < 0);
  const wr       = closed.length ? winners.length / closed.length * 100 : null;
  const longs    = jt.filter(t => t.dir === 'Long').length;
  const shorts   = jt.filter(t => t.dir === 'Short').length;
  const avgWin   = winners.length ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length : null;
  const avgLoss  = losers.length ? Math.abs(losers.reduce((s, t) => s + t.pnl, 0) / losers.length) : null;
  const rr       = avgWin !== null && avgLoss ? avgWin / avgLoss : null;
  const wrColor  = wr === null ? 'var(--tx)' : wr >= 55 ? 'var(--green)' : wr >= 45 ? 'var(--amber)' : 'var(--red)';

  // תשואה על החשבון — הון הבסיס תמיד ברמת החשבון המלא (IBKR); ביומן בודד
  // מוצגת התרומה של אותו יומן לתשואת החשבון
  const series   = accountValueSeries(trades);
  const base     = series.baseKnown && series.base > 0 ? series.base : null;
  const ret      = base !== null ? totalPnl / base * 100 : null;

  // P&L ביחידות סיכון — לפי יחידת הסיכון של היומן המוצג
  const hasPnl   = jt.some(t => (t.status === 'closed' && t.pnl !== null) || (t.realizations || []).length);
  const riskUnit = journalRiskUnit();
  const pnlSub   = riskUnit > 0 && hasPnl
    ? `<span style="color:${totalPnl >= 0 ? 'var(--amber-t)' : 'var(--red-t)'}">${signStr(totalPnl / riskUnit)}${(totalPnl / riskUnit).toFixed(1)}R</span>`
    : 'P&L ממומש';

  document.getElementById('dash-stats').innerHTML = `
    <div class="dash-stat">
      <div class="dash-stat-lbl"><i class="ti ti-trending-up"></i>סך רווח/הפסד</div>
      <div class="dash-stat-val" style="color:${hasPnl ? pnlCol(totalPnl) : 'var(--tx)'}">${hasPnl ? signStr(totalPnl) + '$' + Math.abs(totalPnl).toLocaleString('en', { maximumFractionDigits: 0 }) : '—'}</div>
      <div class="dash-stat-sub">${pnlSub}</div>
    </div>
    <div class="dash-stat">
      <div class="dash-stat-lbl"><i class="ti ti-chart-bar"></i>סה"כ עסקאות</div>
      <div class="dash-stat-val">${jt.length}</div>
      <div class="dash-stat-sub">${longs} לונגים / ${shorts} שורטים</div>
    </div>
    <div class="dash-stat">
      <div class="dash-stat-lbl"><i class="ti ti-percentage"></i>אחוז הצלחה</div>
      <div class="dash-stat-val" style="color:${wrColor}">${wr !== null ? wr.toFixed(1) + '%' : '—'}</div>
      ${wr !== null
        ? `<div class="dash-wr-bar"><div class="dash-wr-win" style="width:${wr.toFixed(1)}%"></div><div class="dash-wr-loss" style="width:${(100 - wr).toFixed(1)}%"></div></div>`
        : '<div class="dash-stat-sub">אין עסקאות סגורות</div>'}
    </div>
    <div class="dash-stat">
      <div class="dash-stat-lbl"><i class="ti ti-scale"></i>יחס סיכוי/סיכון</div>
      <div class="dash-stat-val" style="color:${rr === null ? 'var(--tx)' : rr >= 1 ? 'var(--green)' : 'var(--red)'}">${rr !== null ? rr.toFixed(2) : '—'}</div>
      <div class="dash-stat-sub">${avgWin !== null && avgLoss ? `רווח ממוצע $${avgWin.toFixed(0)} / הפסד ממוצע $${avgLoss.toFixed(0)}` : 'דרושים רווחים והפסדים'}</div>
    </div>
    <div class="dash-stat">
      <div class="dash-stat-lbl"><i class="ti ti-percentage"></i>תשואה על החשבון</div>
      <div class="dash-stat-val" style="color:${ret !== null ? pnlCol(totalPnl) : 'var(--tx)'}">${ret !== null ? signStr(ret) + ret.toFixed(2) + '%' : '—'}</div>
      <div class="dash-stat-sub">${base !== null ? 'הון בסיס $' + Math.round(base).toLocaleString('en') : 'דרוש נתון מזומן מ-IBKR'}</div>
    </div>`;
}

// רווח ממומש של עסקה: עסקה סגורה — לפי ה-P&L הסופי שלה (כולל עמלה);
// עסקה פתוחה עם מימושים חלקיים — סך המימושים שבוצעו עד כה
function realizedPnlOf(t) {
  if (t.status === 'closed' && t.pnl !== null && t.pnl !== undefined) return t.pnl;
  return (t.realizations || []).reduce((s, r) => s + (r.pnl || 0), 0);
}
function totalRealizedPnl(src = trades) {
  return src.reduce((s, t) => s + realizedPnlOf(t), 0);
}

// P&L יומי: כל מימוש נזקף ליום שבו בוצע; עסקה סגורה בלי מימושים — ליום הכניסה
function dailyPnlMap(src = trades) {
  const map = {};
  const add = (date, pnl, id) => {
    if (!date) return;
    const d = map[date] || (map[date] = { pnl: 0, ids: new Set() });
    d.pnl += pnl;
    d.ids.add(id);
  };
  src.forEach(t => {
    const reals = t.realizations || [];
    if (reals.length) {
      reals.forEach(r => add(r.date, r.pnl || 0, t.id));
      // בעסקה סגורה ה-P&L הסופי כולל עמלה שאינה בשורות המימוש —
      // ההפרש נזקף ליום המימוש האחרון כדי שסך הלוח יתאים ל-P&L הממומש
      if (t.status === 'closed' && t.pnl !== null && t.pnl !== undefined) {
        const resid = t.pnl - reals.reduce((s, r) => s + (r.pnl || 0), 0);
        if (Math.abs(resid) > 0.005) add(reals[reals.length - 1].date, resid, t.id);
      }
    }
    else if (t.status === 'closed' && t.pnl !== null && t.pnl !== undefined) add(t.date, t.pnl, t.id);
  });
  return map;
}

function dashShiftMonth(d) {
  dashDate = new Date(dashDate.getFullYear(), dashDate.getMonth() + d, 1);
  renderDashCalendar();
}

function renderDashCalendar() {
  const y = dashDate.getFullYear(), m = dashDate.getMonth();
  document.getElementById('dash-cal-title').textContent = dashDate.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });

  const map         = dailyPnlMap();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const startDow    = new Date(y, m, 1).getDay();
  const todayKey    = today();
  const key         = d => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  let html = DOW.map(d => `<div class="dash-cal-hdr">${d}</div>`).join('') + '<div class="dash-cal-hdr">סיכום שבועי</div>';

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  for (let w = 0; w < cells.length; w += 7) {
    let wkPnl = 0, wkN = 0, wkHas = false, rowHtml = '';
    for (let i = w; i < w + 7; i++) {
      const d = cells[i];
      if (d === null) { rowHtml += '<div class="dash-cal-day empty"></div>'; continue; }
      const data = map[key(d)];
      const n    = data ? data.ids.size : 0;
      if (data) { wkPnl += data.pnl; wkN += n; wkHas = true; }
      const cls = data ? (data.pnl > 0 ? ' win' : data.pnl < 0 ? ' loss' : '') : '';
      rowHtml += `<div class="dash-cal-day${cls}${key(d) === todayKey ? ' today' : ''}">
        <div class="dash-cal-num">${d}</div>
        ${data ? `<div class="dash-cal-cnt">${n} עסקאות</div><div class="dash-cal-pnl" style="color:${pnlCol(data.pnl)}">${fmtD(data.pnl)}</div>` : ''}
      </div>`;
    }
    html += rowHtml + (wkHas
      ? `<div class="dash-cal-week"><div class="dash-cal-wk-pnl" style="color:${pnlCol(wkPnl)}">${fmtD(wkPnl)}</div><div class="dash-cal-cnt">${wkN} עסקאות</div></div>`
      : '<div class="dash-cal-week"><div class="dash-cal-wk-pnl" style="color:var(--tx3)">—</div></div>');
  }
  document.getElementById('dash-cal-grid').innerHTML = html;

  // ── סיכום חודשי + רבעוני עבור החודש/הרבעון המוצג ──
  const mm      = String(m + 1).padStart(2, '0');
  const q       = Math.floor(m / 3);                          // 0..3
  const qMonths = [q * 3, q * 3 + 1, q * 3 + 2].map(x => String(x + 1).padStart(2, '0'));
  let moPnl = 0, moIds = new Set(), qPnl = 0, qIds = new Set();
  Object.keys(map).forEach(k => {
    const [ky, km] = k.split('-');
    if (+ky !== y) return;
    const d = map[k];
    if (km === mm)              { moPnl += d.pnl; d.ids.forEach(id => moIds.add(id)); }
    if (qMonths.includes(km))   { qPnl  += d.pnl; d.ids.forEach(id => qIds.add(id)); }
  });
  const monthName = dashDate.toLocaleDateString('he-IL', { month: 'long' });
  const qLabels   = ['רבעון 1 · ינו–מרץ', 'רבעון 2 · אפר–יונ', 'רבעון 3 · יול–ספט', 'רבעון 4 · אוק–דצמ'];
  const tile = (lbl, pnl, n) => `
    <div class="dash-sum-tile">
      <div class="dash-sum-lbl">${lbl}</div>
      <div class="dash-sum-val" style="color:${n ? pnlCol(pnl) : 'var(--tx3)'}">${n ? fmtD(pnl) : '—'}</div>
      <div class="dash-sum-sub">${n} עסקאות</div>
    </div>`;
  document.getElementById('dash-cal-summary').innerHTML =
    tile(`סיכום חודשי · ${monthName}`, moPnl, moIds.size) +
    tile(`סיכום רבעוני · ${qLabels[q]} ${y}`, qPnl, qIds.size);
}


// ═══════════════════════════════════════════════════════════
//  LIVE PAGE
// ═══════════════════════════════════════════════════════════
function buildPositionCard(t, prices) {
  const q   = prices[t.ticker] || priceCache[t.ticker] || null;
  const cp  = q ? q.price : null;
  const rem = t.remainingQty || t.qty;
  const rawPnl    = cp !== null ? (t.dir === 'Long' ? (cp - t.entry) * rem : (t.entry - cp) * rem) : null;
  const unrealPnl = rawPnl !== null ? rawPnl - (t.fee || 0) : null;
  const pnlPct    = cp && unrealPnl !== null ? (unrealPnl / (t.entry * rem) * 100) : null;
  const pnlC      = unrealPnl === null ? 'var(--tx3)' : pnlCol(unrealPnl);
  const dayC      = q && q.change >= 0 ? 'var(--green)' : 'var(--red)';

  let prog = 50, progC = 'var(--amber)';
  if (t.sl && t.targets?.length && t.targets[0].price && cp) {
    const range = Math.abs(t.targets[0].price - t.sl);
    const moved = t.dir === 'Long' ? cp - t.sl : t.sl - cp;
    prog  = Math.max(0, Math.min(100, Math.round((moved / range) * 100)));
    progC = prog > 60 ? 'var(--green)' : prog < 30 ? 'var(--red)' : 'var(--amber)';
  }

  const reals   = t.realizations || [];
  const realLog = reals.length
    ? `<div class="real-log">${reals.map(r => `<div class="real-row"><span>${r.date}${r.isSl ? ' 🛑' : ''}</span><span>${r.qty}×$${r.price}</span><span style="color:${pnlCol(r.pnl)}">$${r.pnl.toFixed(0)}</span></div>`).join('')}</div>`
    : '';

  // יומן רכישות — מוצג רק כשהפוזיציה חוזקה (יותר מרכישה אחת), כמו בתיק ההשקעות
  const buys    = t.buys || [];
  const buysLog = buys.length > 1
    ? `<div class="targets-section">
        <div class="targets-hdr"><span class="targets-title">רכישות</span></div>
        <div class="real-log">${buys.map(b => `<div class="real-row"><span>${b.date}</span><span>${b.qty}×$${(+b.price).toFixed(2)}</span><span style="color:var(--tx2)">$${Math.round(b.price * b.qty).toLocaleString()}</span></div>`).join('')}</div>
      </div>`
    : '';

  const tgts    = t.targets || [];
  const tgtHtml = tgts.length
    ? `<div class="targets-section">
        <div class="targets-hdr"><span class="targets-title">יעדי מימוש</span><span style="font-size:9.5px;color:var(--tx3)">${rem} מניות נותרו</span></div>` +
      tgts.map((tg, ti) => {
        const shares  = Math.round(t.qty * (tg.pct / 100));
        const tpnl    = tg.price && cp ? (t.dir === 'Long' ? (tg.price - t.entry) * shares : (t.entry - tg.price) * shares) : null;
        const reached = tg.price && cp && (t.dir === 'Long' ? cp >= tg.price : cp <= tg.price);
        return `<div class="target-row">
          <span class="target-badge ${['t1','t2','t3'][ti] || 't1'}">${tg.label}</span>
          <span class="target-price">${tg.price ? '$' + Number(tg.price).toFixed(2) : '—'}</span>
          <span class="target-qty">${tg.pct}%·${shares}</span>
          ${tpnl !== null ? `<span class="target-pnl" style="color:${pnlCol(tpnl)}">$${tpnl.toFixed(0)}</span>` : ''}
          ${reached ? '<span style="font-size:9.5px;color:var(--green)">✓</span>' : ''}
          ${tg.done ? '' : `<button class="action-btn success" style="font-size:9.5px;padding:1px 5px" onclick="openPM('${t.id}',${tg.pct})"><i class="ti ti-check" style="font-size:9.5px"></i>מש</button>`}
        </div>`;
      }).join('') + realLog + '</div>'
    : (reals.length ? `<div class="targets-section"><div class="targets-hdr"><span class="targets-title">מימושים</span></div>${realLog}</div>` : '');

  return `<div class="pos-card" id="card-${t.id}">
    <div class="pos-top">
      <div class="pos-hdr">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            ${stockLogoImg(t.ticker, 30)}
            <div>
              <div style="display:flex;align-items:center;gap:6px">
                <span class="pos-tkr">${t.ticker}</span>
                <span class="dbadge ${t.dir === 'Long' ? 'bl' : 'bs'}">${t.dir}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="price-blk" id="pblk-${t.id}">
          <div class="cur-p" id="cprice-${t.id}">${cp ? '$' + cp.toFixed(2) : '<span style="color:var(--tx3)">—</span>'}</div>
          ${q ? `<div class="day-c" style="color:${dayC}">${signStr(q.change)}${q.change.toFixed(2)} (${signStr(q.changesPercentage)}${q.changesPercentage.toFixed(2)}%)</div>` : '<div class="day-c" style="color:var(--tx3)">אין מחיר</div>'}
        </div>
      </div>
      <div class="pnl-row">
        <div>
          <div style="font-size:11.5px;color:var(--tx2)">P&L לא ממומש <span style="color:var(--tx3)">(${rem} מניות)</span></div>
          <div class="pnl-pct" style="color:${pnlC}">${pnlPct !== null ? signStr(pnlPct) + pnlPct.toFixed(2) + '%' : ''}</div>
        </div>
        <div class="pnl-val" style="color:${pnlC}" id="ppnl-${t.id}">${fmtM(unrealPnl)}</div>
      </div>
      ${t.sl && tgts.length && tgts[0].price
        ? `<div class="prog-wrap"><div class="prog-lbls"><span>SL $${t.sl}</span><span>${prog}%</span><span>T1 $${tgts[0].price}</span></div><div class="prog-track"><div class="prog-fill" style="width:${prog}%;background:${progC}"></div></div></div>`
        : ''}
    </div>
    <div class="pos-bot">
      <div class="d-row"><span class="d-lbl">כניסה</span><span class="d-val">$${Number(t.entry).toFixed(2)}</span></div>
      <div class="d-row"><span class="d-lbl">כמות</span><span class="d-val">${t.qty}${rem < t.qty ? ` · <span style="color:var(--amber)">${rem} נותרו</span>` : ''}</span></div>
      <div class="d-row"><span class="d-lbl">עלות כניסה</span><span class="d-val">$${(t.entry * t.qty).toLocaleString('en', { maximumFractionDigits: 0 })}</span></div>
      ${cp ? `<div class="d-row"><span class="d-lbl">שווי נוכחי</span><span class="d-val">$${(cp * rem).toLocaleString('en', { maximumFractionDigits: 0 })}</span></div>` : ''}
      <div class="d-row"><span class="d-lbl">Stop Loss</span><span class="d-val" style="color:var(--red)">${t.sl ? '$' + t.sl : '—'}</span></div>
      <div class="d-row"><span class="d-lbl">תאריך</span><span class="d-val">${t.date}</span></div>
      ${t.grade ? `<div class="d-row"><span class="d-lbl">סיווג</span><span class="d-val">סיווג ${t.grade}</span></div>` : ''}
      ${t.reason ? `<div class="d-row-text"><span class="d-lbl">סיבה לכניסה</span><span class="d-val">${t.reason}</span></div>` : ''}
      ${t.scenario ? `<div class="d-row-text"><span class="d-lbl">תרחיש</span><span class="d-val">${t.scenario}</span></div>` : ''}
    </div>
    ${tgtHtml}
    ${buysLog}
    <div class="pos-actions">
      <button class="action-btn primary" onclick="openAdd('${t.id}','trade')"><i class="ti ti-arrow-up-right" style="font-size:11px"></i>חזק</button>
      <button class="action-btn danger"  onclick="openSL('${t.id}')"><i class="ti ti-shield-x" style="font-size:11px"></i>סגור SL</button>
      <button class="action-btn success" onclick="openPM('${t.id}',null)"><i class="ti ti-percentage" style="font-size:11px"></i>מימוש חלקי</button>
      <button class="action-btn neutral" onclick="editTrade('${t.id}')"><i class="ti ti-edit" style="font-size:11px"></i>ערוך</button>
      ${(typeof caFindBySymbol === 'function' && caFindBySymbol(t.ticker)) ? `<button class="action-btn info" onclick="caOpenBySymbol('${t.ticker}')"><i class="ti ti-file-analytics" style="font-size:11px"></i>ניתוח</button>` : ''}
    </div>
  </div>`;
}

async function loadLive() {
  const btn = document.getElementById('ref-btn');
  btn.classList.add('spinning');
  setDot('live', 'amber', 'טוען...');
  renderStats();

  const open = trades.filter(t => t.status === 'open');
  document.getElementById('sum-cnt').textContent = open.length;

  if (!open.length) {
    document.getElementById('live-content').innerHTML = '<div class="empty-state"><i class="ti ti-trending-up"></i><p>אין פוזיציות פתוחות</p><button class="add-btn" style="display:inline-flex;margin-top:0.65rem" onclick="nav(\'add\',null)"><i class="ti ti-plus"></i>הוסף עסקה</button></div>';
    updateLiveCashCard(0);
    setDot('live', 'off', 'ממתין');
    btn.classList.remove('spinning');
    return;
  }

  const tickers = [...new Set(open.map(t => t.ticker))];
  document.getElementById('api-status').textContent = '⏳ טוען ' + tickers.length + ' מניות...';
  const prices = await fetchPrices(tickers);
  const validN = Object.keys(prices).length;
  let totalPnl = 0, totalVal = 0, totalCost = 0;

  const cards = open.map(t => {
    const q   = prices[t.ticker] || priceCache[t.ticker] || null;
    const cp  = q ? q.price : null;
    const rem = t.remainingQty || t.qty;
    const raw = cp !== null ? (t.dir === 'Long' ? (cp - t.entry) * rem : (t.entry - cp) * rem) : null;
    const unreal = raw !== null ? raw - (t.fee || 0) : null;
    if (unreal !== null) totalPnl += unreal;
    if (cp) totalVal += cp * rem;
    totalCost += t.entry * rem;
    return buildPositionCard(t, prices);
  });

  document.getElementById('live-content').innerHTML =
    `<div class="sec-title">פוזיציות פתוחות · ${open.length}</div><div class="positions-grid">${cards.join('')}</div>` +
    '<div style="font-size:10.5px;color:var(--tx3);padding:4px 1.4rem 1rem;display:flex;align-items:center;gap:4px"><i class="ti ti-circle-check" style="color:var(--green-t);font-size:12px"></i>מחירים חיים דרך Finnhub API</div>';

  open.forEach(t => {
    const cp = (prices[t.ticker] || priceCache[t.ticker])?.price;
    if (cp) flash(document.getElementById('cprice-' + t.id), cp, t.ticker);
  });

  const sp = document.getElementById('sum-pnl');
  sp.textContent = validN ? fmtM(totalPnl) : '—';
  sp.style.color  = pnlCol(totalPnl);
  document.getElementById('sum-val').textContent = totalVal ? '$' + Math.round(totalVal).toLocaleString() : '—';
  const avgPct = totalCost ? (totalPnl / totalCost * 100) : null;
  const ae = document.getElementById('sum-avg');
  ae.textContent = avgPct !== null ? signStr(avgPct) + avgPct.toFixed(2) + '%' : '—';
  ae.style.color  = avgPct !== null ? pnlCol(avgPct) : 'var(--tx)';

  updateLiveCashCard(totalCost);

  document.getElementById('last-upd').textContent  = 'עודכן ' + new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('api-status').textContent = validN ? `✓ ${validN} מחירים חיים (Finnhub)` : '⚠ לא נטענו מחירים';
  setDot('live', validN ? 'green' : 'amber', validN ? 'חי' : 'ללא נתונים');
  btn.classList.remove('spinning');
}

// ═══════════════════════════════════════════════════════════
//  TRADES CRUD
// ═══════════════════════════════════════════════════════════
function saveTrade() {
  const ticker = document.getElementById('f-ticker').value.trim().toUpperCase();
  const date   = document.getElementById('f-date').value;
  const entry  = parseFloat(document.getElementById('f-entry').value);
  const qty    = parseFloat(document.getElementById('f-qty').value);
  if (!ticker || !date || !entry || !qty) { toast('⚠ מלא שדות חובה'); return; }

  const exit   = parseFloat(document.getElementById('f-exit').value) || null;
  const fee    = parseFloat(document.getElementById('f-fee').value) || 0;
  const dir    = document.getElementById('f-dir').value;
  const status = document.getElementById('f-status').value;
  const existing = editTradeId ? trades.find(t => t.id === editTradeId) : null;

  // מימושים קיימים הם מקור האמת לרווח הממומש — עריכה דרך הטופס לא דורסת אותם.
  // הכמות הנותרת נגזרת מהכמות פחות מה שכבר מומש; בסגירה היתרה יוצאת במחיר היציאה.
  const reals        = existing?.realizations || [];
  const realizedQty  = reals.reduce((s, r) => s + (r.qty || 0), 0);
  const realizedPnl  = reals.reduce((s, r) => s + (r.pnl || 0), 0);
  let   remainingQty = Math.max(0, qty - realizedQty);
  let   pnl          = null;
  if (status === 'closed') {
    if (exit || reals.length) {
      const closePart = exit && remainingQty > 0
        ? (dir === 'Long' ? (exit - entry) * remainingQty : (entry - exit) * remainingQty)
        : 0;
      pnl = +(realizedPnl + closePart - fee).toFixed(2);
    }
    remainingQty = 0;
  }

  const trade = {
    id: editTradeId || Date.now().toString(), ticker, date, dir, status, entry, exit, qty, fee, pnl,
    // יחידת הסיכון "ננעלת" על העסקה בעת הפתיחה — עריכה משמרת אותה — כדי
    // שכל עסקה תשתייך ליומן הנכון גם אחרי שמחליפים יחידת סיכון בהגדרות
    riskUnit:     existing ? (existing.riskUnit ?? getRiskUnit()) : getRiskUnit(),
    grade:        document.getElementById('f-grade-1')?.classList.contains('active') ? '1' : '2',
    reason:       document.getElementById('f-reason').value,
    scenario:     document.getElementById('f-scenario').value,
    sl:           parseFloat(document.getElementById('f-sl').value) || null,
    targets:      JSON.parse(JSON.stringify(targetItems)),
    realizations: reals,
    remainingQty,
  };

  // המרה מתכנון: לקשר את העסקה לתכנון ולסמן את התכנון כ"הומר" — בלי למחוק אותו.
  if (!editTradeId && pendingPlan && typeof prepLoad === 'function') {
    trade.planId = pendingPlan.id;
    try {
      const plans = prepLoad();
      const pl = plans.find(x => x.id === pendingPlan.id);
      if (pl) { pl.convertedTo = trade.id; pl.convertedAt = Date.now(); prepSave(plans); }
    } catch (e) {}
  }

  if (editTradeId) { trades = trades.map(t => t.id === editTradeId ? trade : t); toast('✓ עסקה עודכנה'); }
  else             { trades.unshift(trade); toast('✓ עסקה נשמרה!'); }
  sv(SK.trades, trades);

  // המזומן הפנוי מתעדכן מיד: getTradesCash() מקזז את עלות הפוזיציה החדשה.
  // אם אין בכלל נתון מזומן מ-IBKR — מפעילים משיכה אוטומטית ברקע כדי לקבל בסיס.
  if (!editTradeId && status === 'open' && typeof getTradesCash === 'function' && getTradesCash() === null
      && typeof ibkrIsConfigured === 'function' && ibkrIsConfigured() && typeof ibkrSync === 'function') {
    ibkrSync();
  }

  clearDraft();
  editTradeId = null;
  resetForm();
  nav('live', document.querySelector('[data-page=live]'));
}

function deleteTrade(id) {
  if (!confirm('למחוק?')) return;
  trades = trades.filter(t => t.id !== id);
  sv(SK.trades, trades);
  renderClosedTable();
  toast('נמחק');
}

function editTrade(id) {
  const t = trades.find(x => x.id === id);
  if (!t) return;
  editTradeId = id;
  targetItems = t.targets ? JSON.parse(JSON.stringify(t.targets)) : [];

  document.getElementById('form-title').textContent = 'עריכת עסקה';
  const map = { 'f-ticker': t.ticker, 'f-date': t.date, 'f-dir': t.dir, 'f-status': t.status,
                'f-entry': t.entry, 'f-exit': t.exit || '', 'f-qty': t.qty, 'f-fee': t.fee || 0,
                'f-reason': t.reason || '', 'f-scenario': t.scenario || '', 'f-sl': t.sl || '' };
  setGrade(t.grade || '1');
  Object.entries(map).forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.value = val; });

  nav('add', null);
  renderTargets();
  calcFormPnl();
}

function resetForm() {
  editTradeId = null;
  pendingPlan = null;
  targetItems = [];
  document.getElementById('form-title').textContent = 'עסקה חדשה';
  ['f-ticker','f-entry','f-exit','f-qty','f-reason','f-scenario','f-sl'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-fee').value    = getDefaultFee().toFixed(2);
  document.getElementById('f-dir').value    = 'Long';
  document.getElementById('f-status').value = 'open';
  setGrade('1');
  document.getElementById('f-date').value   = today();
  document.getElementById('pnl-val').textContent = '—';
  document.getElementById('pnl-val').style.color = '';
  document.getElementById('pnl-det').textContent = 'הכנס מחירים לחישוב';
  document.getElementById('sl-risk').textContent = '—';
  updateFeeHint();
  renderTargets();
  setAutosaveBar('idle', 'שמירה אוטומטית פעילה');
}

function calcFormPnl() {
  const en  = parseFloat(document.getElementById('f-entry').value);
  const ex  = parseFloat(document.getElementById('f-exit').value);
  const qty = parseFloat(document.getElementById('f-qty').value);
  const fee = parseFloat(document.getElementById('f-fee').value) || 0;
  const dir = document.getElementById('f-dir').value;

  // מילוי אוטומטי של הסטופ בהמרה מתכנון: מחיר כניסה ± מרחק הסטופ מהתכנון.
  // רק כשהשדה ריק — עריכה ידנית של המשתמש גוברת.
  const slEl = document.getElementById('f-sl');
  if (pendingPlan && pendingPlan.stopCents && en > 0 && slEl && !slEl.value) {
    const slAuto = pendingPlan.dir === 'Long'
      ? en - pendingPlan.stopCents / 100
      : en + pendingPlan.stopCents / 100;
    if (slAuto > 0) slEl.value = slAuto.toFixed(2);
  }
  const sl = parseFloat(slEl.value);
  const el  = document.getElementById('pnl-val');
  const det = document.getElementById('pnl-det');

  document.getElementById('sl-risk').textContent = (en && qty && sl)
    ? 'סיכון: -$' + Math.abs((dir === 'Long' ? en - sl : sl - en) * qty).toFixed(0)
    : '—';

  updateAllTargetCalcs();

  if (!en || !qty) { el.textContent = '—'; el.style.color = ''; det.textContent = 'הכנס מחירים לחישוב'; return; }
  const cost = en * qty + fee;
  if (!ex)  { det.textContent = 'עלות: $' + cost.toFixed(2); el.textContent = '$' + cost.toFixed(2); el.style.color = 'var(--tx)'; return; }
  const p = (dir === 'Long' ? (ex - en) * qty : (en - ex) * qty) - fee;
  el.textContent = (p >= 0 ? '+' : '') + ' $' + p.toFixed(2);
  el.style.color  = pnlCol(p);
  det.textContent = ((p / (en * qty)) * 100).toFixed(1) + '%';
}

// ═══════════════════════════════════════════════════════════
//  TARGETS
// ═══════════════════════════════════════════════════════════
function addTarget() {
  if (targetItems.length >= 3) { toast('מקסימום 3 יעדים'); return; }
  const cfg = TARGET_CFG[targetItems.length];
  targetItems.push({ id: Date.now(), pct: cfg.pct, price: '', label: cfg.label, badge: cfg.badge, done: false });
  renderTargets();
  draftSave();
}

function removeTarget(id) { targetItems = targetItems.filter(t => t.id !== id); renderTargets(); draftSave(); }

function renderTargets() {
  const list = document.getElementById('targets-list');
  document.getElementById('add-tgt-btn').style.display = targetItems.length >= 3 ? 'none' : '';
  if (!targetItems.length) {
    list.innerHTML = '<div style="font-size:11.5px;color:var(--tx3);text-align:center;padding:0.45rem">לחץ "הוסף יעד"</div>';
    updateTargetSummary();
    return;
  }
  list.innerHTML = targetItems.map((t, i) =>
    `<div class="target-item" id="ti-${t.id}">
      <span class="ti-badge ${t.badge}">${TARGET_CFG[i]?.label}</span>
      <div class="ti-inputs">
        <div class="ti-input-wrap"><span class="ti-label">מחיר ($)</span><input type="number" class="ti-input" placeholder="0.00" step="0.01" value="${t.price}" oninput="updateTC(${t.id});draftSave()"></div>
        <div class="ti-input-wrap" style="max-width:90px"><span class="ti-label">אחוז</span><input type="number" class="ti-input" placeholder="%" min="1" max="100" step="1" value="${t.pct}" oninput="updateTC(${t.id});draftSave()"></div>
        <div class="ti-input-wrap" style="max-width:70px"><span class="ti-label">כמות</span><div class="ti-input" id="ti-qty-${t.id}" style="background:var(--bg3);color:var(--tx3);cursor:default">—</div></div>
        <div class="ti-input-wrap" style="max-width:80px"><span class="ti-label">P&L</span><div class="ti-input" id="ti-pnl-${t.id}" style="background:var(--bg3);color:var(--tx3);cursor:default">—</div></div>
      </div>
      <button class="remove-target" onclick="removeTarget(${t.id})"><i class="ti ti-x"></i></button>
    </div>`
  ).join('');
  updateAllTargetCalcs();
  updateTargetSummary();
}

function updateTC(id) {
  const t  = targetItems.find(x => x.id === id);
  const el = document.getElementById('ti-' + id);
  if (!t || !el) return;
  const inputs = el.querySelectorAll('input[type="number"]');
  if (inputs[0]) t.price = parseFloat(inputs[0].value) || '';
  if (inputs[1]) t.pct   = parseInt(inputs[1].value) || 0;
  updateAllTargetCalcs();
  updateTargetSummary();
}

function updateAllTargetCalcs() {
  const qty   = parseFloat(document.getElementById('f-qty').value) || 0;
  const entry = parseFloat(document.getElementById('f-entry').value) || 0;
  const dir   = document.getElementById('f-dir').value;
  targetItems.forEach(t => {
    const qEl = document.getElementById('ti-qty-' + t.id);
    const pEl = document.getElementById('ti-pnl-' + t.id);
    if (!qEl || !pEl) return;
    const shares = Math.round(qty * (t.pct / 100));
    qEl.textContent = shares || '—';
    if (t.price && entry && shares) {
      const p = dir === 'Long' ? (t.price - entry) * shares : (entry - t.price) * shares;
      pEl.textContent = (p >= 0 ? '+$' : '-$') + Math.abs(p).toFixed(0);
      pEl.style.color = pnlCol(p);
    } else { pEl.textContent = '—'; pEl.style.color = 'var(--tx3)'; }
  });
}

function updateTargetSummary() {
  const el = document.getElementById('targets-summary');
  if (!targetItems.length) { el.textContent = ''; return; }
  const total = targetItems.reduce((s, t) => s + t.pct, 0);
  const col   = total === 100 ? 'var(--green)' : total > 100 ? 'var(--red)' : 'var(--amber)';
  el.innerHTML = `<span style="color:${col}">סה"כ: ${total}% ${total === 100 ? '✓' : total > 100 ? '⚠ חורג' : ''}</span>`;
}

// ═══════════════════════════════════════════════════════════
//  תכנון עסקה → עסקה
// ═══════════════════════════════════════════════════════════
// יעדי התכנון ({target,sellQty,newStop}) → יעדי הטופס ({pct,price,...}).
// האחוז נגזר מכמות המכירה חלקי כמות הפוזיציה; אם חסר — ברירת המחדל של היעד.
function planTargetsToForm(plan) {
  const qty = parseFloat(plan && plan.qty) || 0;
  return (plan && plan.targets || [])
    .filter(t => t.target || t.sellQty)
    .slice(0, 3)
    .map((t, i) => {
      const cfg = TARGET_CFG[i] || TARGET_CFG[TARGET_CFG.length - 1];
      const sq  = parseFloat(t.sellQty);
      const pct = (qty > 0 && sq > 0) ? Math.max(1, Math.min(100, Math.round((sq / qty) * 100))) : cfg.pct;
      return { id: Date.now() + i, pct, price: parseFloat(t.target) || '', label: cfg.label, badge: cfg.badge, done: false };
    });
}

// טקסט "תרחיש" נגזר מהתכנון: צ'קליסט שסומן + העברות סטופ מתוכננות.
function planScenarioText(plan) {
  if (!plan) return '';
  const parts = [];
  const cl = plan.checklist || {};
  const def = (typeof PREP_CHECKLIST_DEF !== 'undefined') ? PREP_CHECKLIST_DEF : [];
  const checked = def.filter(i => cl[i.key]).map(i => i.label);
  if (checked.length) parts.push('צ׳קליסט: ' + checked.join(' · '));
  const moves = (plan.targets || [])
    .map((t, i) => t.newStop ? `אחרי יעד ${i + 1} → סטופ $${t.newStop}` : null)
    .filter(Boolean);
  if (moves.length) parts.push('העברת סטופ מתוכננת: ' + moves.join(' · '));
  return parts.join('\n');
}

// פותח את טופס העסקה ממולא מראש מתוך תכנון. המשתמש מזין מחיר כניסה
// ומאשר — הסטופ מתמלא אוטומטית ממחיר הכניסה + מרחק הסטופ מהתכנון.
function tradeFromPlan(plan) {
  if (!plan) return;
  editTradeId = null;
  clearDraft();
  nav('add', null);                 // מאפס את הטופס וטוען טיוטה (ריקה — נמחקה)

  const dir = plan.dir === 'Short' ? 'Short' : 'Long';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('f-ticker', (plan.ticker || '').toUpperCase());
  set('f-qty',    plan.qty || '');
  set('f-dir',    dir);
  if (plan.entryDate) set('f-date', plan.entryDate);
  set('f-entry',  '');
  set('f-sl',     '');
  set('f-exit',   '');
  document.getElementById('f-status').value = 'open';
  set('f-reason',   plan.gradeNote || '');
  set('f-scenario', planScenarioText(plan));
  setGrade(plan.grade === '2' ? '2' : '1');

  targetItems = planTargetsToForm(plan);
  renderTargets();

  const stopCents = parseFloat(plan.stop);
  pendingPlan = { id: plan.id, stopCents: stopCents > 0 ? stopCents : null, dir };

  document.getElementById('form-title').textContent = 'עסקה מתכנון · ' + (plan.ticker || '');
  calcFormPnl();
  const en = document.getElementById('f-entry');
  if (en) en.focus();
  toast('מולא מהתכנון — הזן מחיר כניסה בפועל');
}

// ═══════════════════════════════════════════════════════════
//  PARTIAL REALIZATION MODAL
// ═══════════════════════════════════════════════════════════
function openPM(id, pct) {
  activePMId = id;
  const t = trades.find(x => x.id === id);
  if (!t) return;
  const rem = t.remainingQty || t.qty;
  document.getElementById('pm-title').innerHTML = `<i class="ti ti-percentage"></i>מימוש — ${t.ticker} <span style="font-size:12px;color:var(--tx3);font-weight:400">(${rem} נותרו)</span>`;
  document.getElementById('pm-price').value = '';
  document.getElementById('pm-qty').value   = '';
  document.getElementById('pm-pnl').textContent = '—';
  document.getElementById('pm-det').textContent  = '—';
  document.getElementById('pm-qbtns').innerHTML = [25,33,50,75,100].map(p => {
    const s = Math.round(rem * (p / 100));
    return `<button class="quick-btn" onclick="setPMQty(${s},this)">${p}% (${s})</button>`;
  }).join('');
  if (pct) { document.getElementById('pm-qty').value = Math.round(rem * (pct / 100)); calcPM(); }
  document.getElementById('pm-overlay').classList.add('open');
}

function setPMQty(qty, btn) {
  document.getElementById('pm-qty').value = qty;
  document.getElementById('pm-qbtns').querySelectorAll('.quick-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  calcPM();
}

function calcPM() {
  const price = parseFloat(document.getElementById('pm-price').value);
  const qty   = parseFloat(document.getElementById('pm-qty').value);
  const t     = activePMId ? trades.find(x => x.id === activePMId) : null;
  if (!t || !price || !qty) { document.getElementById('pm-pnl').textContent = '—'; return; }
  const p = t.dir === 'Long' ? (price - t.entry) * qty : (t.entry - price) * qty;
  document.getElementById('pm-pnl').textContent = (p >= 0 ? '+' : '') + ' $' + p.toFixed(2);
  document.getElementById('pm-pnl').style.color  = pnlCol(p);
  document.getElementById('pm-det').textContent  = ((p / (t.entry * qty)) * 100).toFixed(2) + '%';
}

function confirmPM() {
  const price = parseFloat(document.getElementById('pm-price').value);
  const qty   = parseFloat(document.getElementById('pm-qty').value);
  if (!price || !qty) { toast('⚠ הכנס מחיר וכמות'); return; }
  const idx = trades.findIndex(t => t.id === activePMId);
  if (idx === -1) return;
  const t   = trades[idx];
  const rem = t.remainingQty || t.qty;
  if (qty > rem) { toast('⚠ כמות גדולה מהנותרת'); return; }
  const p = t.dir === 'Long' ? (price - t.entry) * qty : (t.entry - price) * qty;
  if (!t.realizations) t.realizations = [];
  t.realizations.push({ date: today(), price, qty, pnl: +p.toFixed(2) });
  t.remainingQty = rem - qty;
  if (t.remainingQty <= 0) {
    t.status = 'closed';
    // P&L סופי = סך המימושים פחות העמלה (כמו בסגירה ידנית דרך הטופס)
    t.pnl    = +(t.realizations.reduce((s, r) => s + r.pnl, 0) - (t.fee || 0)).toFixed(2);
    t.exit   = price;
    toast('✓ עסקה נסגרה!');
  } else { toast(`✓ מימוש: ${qty} × $${price}`); }
  trades[idx] = t;
  sv(SK.trades, trades);
  closePM();
  loadLive();
  renderClosedTable();   // המימוש מופיע מיד ב"עסקאות שנסגרו"
}

function closePM() { document.getElementById('pm-overlay').classList.remove('open'); }

// ═══════════════════════════════════════════════════════════
//  STOP LOSS MODAL
// ═══════════════════════════════════════════════════════════
function useSLPreset(v) { document.getElementById('sl-price').value = v; calcSL(); }

function openSL(id) {
  activeSLId = id;
  const t = trades.find(x => x.id === id);
  if (!t) return;
  document.getElementById('sl-price').value = t.sl || '';
  document.getElementById('sl-preset').innerHTML = t.sl
    ? `<div style="font-size:11px;color:var(--tx3);margin-bottom:7px">SL: <span style="font-family:monospace;color:var(--red-t)">$${t.sl}</span> <button class="quick-btn" onclick="useSLPreset(${t.sl})">השתמש</button></div>`
    : '';
  calcSL();
  document.getElementById('sl-overlay').classList.add('open');
}

function calcSL() {
  const price = parseFloat(document.getElementById('sl-price').value);
  const t     = activeSLId ? trades.find(x => x.id === activeSLId) : null;
  if (!t || !price) { document.getElementById('sl-pnl').textContent = '—'; return; }
  const rem = t.remainingQty || t.qty;
  const p   = t.dir === 'Long' ? (price - t.entry) * rem : (t.entry - price) * rem;
  document.getElementById('sl-pnl').textContent = (p >= 0 ? '+' : '') + ' $' + Math.abs(p).toFixed(2);
  document.getElementById('sl-det').textContent  = `${rem} מניות · ${((p / (t.entry * rem)) * 100).toFixed(2)}%`;
}

function confirmSL() {
  const price = parseFloat(document.getElementById('sl-price').value);
  if (!price) { toast('⚠ הכנס מחיר'); return; }
  const idx = trades.findIndex(t => t.id === activeSLId);
  if (idx === -1) return;
  const t   = trades[idx];
  const rem = t.remainingQty || t.qty;
  const p   = t.dir === 'Long' ? (price - t.entry) * rem : (t.entry - price) * rem;
  if (!t.realizations) t.realizations = [];
  t.realizations.push({ date: today(), price, qty: rem, pnl: +p.toFixed(2), isSl: true });
  t.status       = 'closed';
  t.pnl          = +(t.realizations.reduce((s, r) => s + r.pnl, 0) - (t.fee || 0)).toFixed(2);
  t.exit         = price;
  t.remainingQty = 0;
  trades[idx]    = t;
  sv(SK.trades, trades);
  closeSL();
  toast('✗ Stop Loss — עסקה נסגרה');
  loadLive();
  renderClosedTable();
}

function closeSL() { document.getElementById('sl-overlay').classList.remove('open'); }

// ═══════════════════════════════════════════════════════════
//  CLOSED TRADES TABLE / CARDS
// ═══════════════════════════════════════════════════════════
// במובייל טבלת עסקאות סגורות דורשת גלילה אופקית לראות P&L — ברירת מחדל לתצוגת כרטיסיות שם
let closedViewMode = (typeof window !== 'undefined' && window.innerWidth <= 640) ? 'cards' : 'table';

function setClosedView(mode) {
  closedViewMode = mode;
  ['table', 'cards'].forEach(m => {
    const b = document.getElementById('vtb-' + m);
    if (b) { b.classList.toggle('active', mode === m); b.classList.toggle('on', mode === m); }
  });
  renderClosedTable();
}

// "שקופיות סגירה": כל מימוש חלקי וכל סגירה = שורה נפרדת ב"עסקאות שנסגרו".
// כך שברגע שמממשים חלק מפוזיציה הוא מופיע כאן מיד, וסגירת היתרה מוסיפה שורה
// נוספת לאותו מקום. סך ה-P&L של כל השקופיות שווה בדיוק ל-totalRealizedPnl().
function closedSlices(src = trades) {
  const out = [];
  src.forEach(t => {
    const reals = t.realizations || [];
    let accQty = 0, accPnl = 0;
    reals.forEach((r, i) => {
      out.push({
        parentId: t.id, kind: 'real', realIndex: i,
        ticker: t.ticker, dir: t.dir, entry: t.entry,
        date: r.date, exit: r.price, qty: r.qty || 0, pnl: r.pnl || 0, isSl: !!r.isSl,
        parentOpen: t.status !== 'closed', parentRemaining: t.remainingQty ?? 0,
        grade: t.grade, reason: t.reason, scenario: t.scenario,
      });
      accQty += r.qty || 0;
      accPnl += r.pnl || 0;
    });
    if (t.status === 'closed' && t.pnl !== null && t.pnl !== undefined) {
      if (!reals.length) {
        // סגירה ישירה דרך הטופס — שורה אחת לכל העסקה
        out.push({
          parentId: t.id, kind: 'close',
          ticker: t.ticker, dir: t.dir, entry: t.entry,
          date: t.date, exit: t.exit, qty: t.qty || 0, pnl: t.pnl, isSl: false,
          parentOpen: false, parentRemaining: 0,
          grade: t.grade, reason: t.reason, scenario: t.scenario,
        });
      } else {
        const residQty = +(((t.qty || 0) - accQty)).toFixed(6);
        const residPnl = +((t.pnl - accPnl)).toFixed(2);
        if (residQty > 0.0001) {
          // יתרה שנסגרה דרך הטופס (חלק אחרון שאינו רשום כשורת מימוש)
          out.push({
            parentId: t.id, kind: 'close',
            ticker: t.ticker, dir: t.dir, entry: t.entry,
            date: reals[reals.length - 1].date || t.date, exit: t.exit, qty: residQty, pnl: residPnl, isSl: false,
            parentOpen: false, parentRemaining: 0,
            grade: t.grade, reason: t.reason, scenario: t.scenario,
          });
        } else if (Math.abs(residPnl) > 0.005 && out.length) {
          // אין כמות שיורית — רק הפרש עמלה: מצרפים לשורה האחרונה כדי שהסכום יתאים
          out[out.length - 1].pnl = +(out[out.length - 1].pnl + residPnl).toFixed(2);
        }
      }
    }
  });
  out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return out;
}

// קיבוץ כל המימושים של אותה עסקה לכרטיס אחד — כך שמימוש חלקי וסגירת
// היתרה מופיעים יחד תחת אותה שקופית, במקום כרטיס נפרד לכל מימוש.
function closedGroups(src = trades) {
  const map = new Map();
  closedSlices(src).forEach(s => {
    let g = map.get(s.parentId);
    if (!g) {
      g = {
        parentId: s.parentId, ticker: s.ticker, dir: s.dir, entry: s.entry,
        grade: s.grade, reason: s.reason, scenario: s.scenario,
        slices: [], qty: 0, pnl: 0, isSl: false,
        parentOpen: s.parentOpen, parentRemaining: s.parentRemaining,
      };
      map.set(s.parentId, g);
    }
    g.slices.push(s);
    g.qty += s.qty || 0;
    g.pnl += s.pnl || 0;
    if (s.isSl) g.isSl = true;
    g.parentOpen = s.parentOpen;
    g.parentRemaining = s.parentRemaining;
  });
  const groups = [...map.values()];
  groups.forEach(g => {
    g.pnl = +g.pnl.toFixed(2);
    const totQ = g.slices.reduce((a, s) => a + (s.qty || 0), 0);
    g.exit = totQ ? +(g.slices.reduce((a, s) => a + (s.exit || 0) * (s.qty || 0), 0) / totQ).toFixed(2) : null;
    g.slices.sort((a, b) => (a.date || '').localeCompare(b.date || ''));  // מוקדם→מאוחר בתוך הכרטיס
    g.firstDate = g.slices[0]?.date;
    g.lastDate  = g.slices[g.slices.length - 1]?.date;
    g.date = g.lastDate;
  });
  groups.sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
  return groups;
}

// מחיקת מימוש חלקי בודד — הכמות חוזרת לפוזיציה והעסקה נפתחת מחדש אם נסגרה
function deleteRealization(id, idx) {
  const t = trades.find(x => x.id === id);
  if (!t || !t.realizations || idx < 0 || idx >= t.realizations.length) return;
  if (!confirm('למחוק את המימוש החלקי? הכמות תוחזר לפוזיציה הפתוחה.')) return;
  const r = t.realizations[idx];
  t.realizations.splice(idx, 1);
  t.remainingQty = (t.remainingQty ?? 0) + (r.qty || 0);
  t.status = 'open';
  t.exit   = null;
  t.pnl    = null;
  sv(SK.trades, trades);
  renderClosedTable();
  toast('המימוש נמחק — הכמות הוחזרה לפוזיציה');
}

function renderClosedTable() {
  renderJournalSelectors();
  const fD = document.getElementById('fc-dir').value;
  const fR = document.getElementById('fc-res').value;
  const fT = document.getElementById('fc-ticker').value.toLowerCase();
  const f  = closedGroups(journalTrades()).filter(s => {
    if (fD && s.dir !== fD)                           return false;
    if (fR === 'win'  && !(s.pnl > 0))               return false;
    if (fR === 'loss' && !(s.pnl < 0))               return false;
    if (fT && !s.ticker.toLowerCase().includes(fT))  return false;
    return true;
  });

  // תגית "חלקי" לשקופית של פוזיציה שעדיין פתוחה, ופעולת המחיקה המתאימה
  const partialTag = s => s.parentOpen
    ? ` <span class="badge-amber" style="font-size:9px;padding:1px 5px;border-radius:5px">חלקי · נותרו ${s.parentRemaining}</span>` : '';
  const delAction  = s => `deleteTrade('${s.parentId}')`;
  // פירוט המימושים בתוך הכרטיס — מוצג כשיש יותר ממימוש אחד לאותה עסקה
  const realLog = t => t.slices.length > 1
    ? `<div class="closed-real-log">
        <div class="crl-title">מימושים · ${t.slices.length}</div>
        ${t.slices.map(s => `<div class="real-row">
          <span>${s.date}${s.isSl ? ' 🛑' : ''}</span>
          <span>${s.qty}×$${Number(s.exit).toFixed(2)}</span>
          <span style="color:${pnlCol(s.pnl)}">${signStr(s.pnl)}$${Math.abs(s.pnl).toFixed(0)}</span>
          ${s.kind === 'real'
            ? `<button class="crl-del" title="מחק מימוש" onclick="deleteRealization('${t.parentId}',${s.realIndex})"><i class="ti ti-x"></i></button>`
            : '<span class="crl-del-ph"></span>'}
        </div>`).join('')}
      </div>`
    : '';

  const el = document.getElementById('closed-ct');
  if (!f.length) {
    el.innerHTML = '<div class="empty-state" style="padding:2.5rem"><i class="ti ti-checks"></i><p>אין עסקאות סגורות</p></div>';
    return;
  }

  if (closedViewMode === 'cards') {
    el.parentElement.style.overflow = 'visible';
    el.parentElement.style.background = 'transparent';
    el.parentElement.style.border = 'none';
    el.innerHTML = `<div class="positions-grid" style="padding:0">` +
      f.map(t => {
        const pct  = t.pnl && t.entry && t.qty ? ((t.pnl / (t.entry * t.qty)) * 100).toFixed(1) : null;
        const pnlC = pnlCol(t.pnl);
        const pctC = pct === null ? 'var(--tx3)' : pnlCol(parseFloat(pct));
        const resCls = t.pnl >= 0 ? ' closed-win' : ' closed-loss';
        return `<div class="pos-card${resCls}">
          <div class="pos-top">
            <div class="pos-hdr">
              <div style="display:flex;align-items:center;gap:8px">
                ${stockLogoImg(t.ticker, 30)}
                <div>
                  <div style="display:flex;align-items:center;gap:6px">
                    <span class="pos-tkr">${t.ticker}${t.isSl ? ' 🛑' : ''}</span>
                    <span class="dbadge ${t.dir === 'Long' ? 'bl' : 'bs'}">${t.dir}</span>
                    ${partialTag(t)}
                  </div>
                  <div class="pos-nm">${t.date}</div>
                </div>
              </div>
              <div style="text-align:left">
                <div class="pnl-val" style="color:${pnlC};font-size:18px">${(t.pnl >= 0 ? '+' : '') + '$' + Math.abs(t.pnl).toFixed(2)}</div>
                ${pct !== null ? `<div class="day-c" style="color:${pctC}">${parseFloat(pct) >= 0 ? '+' : ''}${pct}%</div>` : ''}
              </div>
            </div>
          </div>
          <div class="pos-bot">
            <div class="d-row"><span class="d-lbl">כניסה</span><span class="d-val">$${Number(t.entry).toFixed(2)}</span></div>
            <div class="d-row"><span class="d-lbl">${t.slices.length > 1 ? 'יציאה ממוצעת' : 'יציאה'}</span><span class="d-val">${t.exit != null ? '$' + Number(t.exit).toFixed(2) : '—'}</span></div>
            <div class="d-row"><span class="d-lbl">כמות שמומשה</span><span class="d-val">${t.qty}</span></div>
            ${t.grade ? `<div class="d-row"><span class="d-lbl">סיווג</span><span class="d-val">סיווג ${t.grade}</span></div>` : ''}
            ${t.reason ? `<div class="d-row-text"><span class="d-lbl">סיבה לכניסה</span><span class="d-val">${t.reason}</span></div>` : ''}
            ${t.scenario ? `<div class="d-row-text"><span class="d-lbl">תרחיש</span><span class="d-val">${t.scenario}</span></div>` : ''}
          </div>
          ${realLog(t)}
          <div class="pos-actions">
            <button class="action-btn neutral" onclick="editTrade('${t.parentId}')"><i class="ti ti-edit" style="font-size:11px"></i>ערוך</button>
            <button class="action-btn danger"  onclick="${delAction(t)}"><i class="ti ti-trash" style="font-size:11px"></i>מחק</button>
          </div>
        </div>`;
      }).join('') + `</div>`;
    return;
  }

  el.parentElement.style.overflow = '';
  el.parentElement.style.background = '';
  el.parentElement.style.border = '';
  el.innerHTML = `<table><thead><tr>
    <th>תאריך</th><th>טיקר</th><th>כיוון</th><th>כניסה</th><th>יציאה</th><th>כמות</th><th>P&L</th><th>%</th><th></th>
  </tr></thead><tbody>` +
    f.map(t => {
      const pct    = t.pnl && t.entry && t.qty ? ((t.pnl / (t.entry * t.qty)) * 100).toFixed(1) : null;
      const pnlC   = pnlCol(t.pnl);
      const pctC   = pct === null ? 'var(--tx3)' : pnlCol(parseFloat(pct));
      const rowCls = t.pnl >= 0 ? 'row-win' : 'row-loss';
      return `<tr class="${rowCls}">
        <td style="color:var(--tx2)">${t.date}</td>
        <td class="mono" style="font-weight:600">${t.ticker}${t.isSl ? ' 🛑' : ''}${t.slices.length > 1 ? ` <span class="crl-count">×${t.slices.length}</span>` : ''}${partialTag(t)}</td>
        <td><span class="badge ${t.dir === 'Long' ? 'bl' : 'bs'}">${t.dir}</span></td>
        <td class="mono">$${Number(t.entry).toFixed(2)}</td>
        <td class="mono">${t.exit != null ? '$' + Number(t.exit).toFixed(2) : '—'}</td>
        <td>${t.qty}</td>
        <td class="mono" style="font-weight:600;color:${pnlC}">${(t.pnl >= 0 ? '+' : '') + ' $' + Math.abs(t.pnl).toFixed(2)}</td>
        <td class="mono" style="color:${pctC}">${pct !== null ? (parseFloat(pct) >= 0 ? '+' : '') + pct + '%' : '—'}</td>
        <td style="display:flex;gap:2px">
          <button class="icon-btn edit" onclick="editTrade('${t.parentId}')"><i class="ti ti-edit"></i></button>
          <button class="icon-btn"      onclick="${delAction(t)}"><i class="ti ti-trash"></i></button>
        </td>
      </tr>`;
    }).join('') + '</tbody></table>';
}

// ═══════════════════════════════════════════════════════════
//  PORTFOLIO
// ═══════════════════════════════════════════════════════════
function openHM(id) {
  editHoldingId = id || null;
  const h = id ? portfolio.find(x => x.id === id) : null;
  document.getElementById('hm-title').textContent = h ? 'עריכת החזקה' : 'הוסף החזקה';
  document.getElementById('hm-ticker').value = h ? h.ticker        : '';
  document.getElementById('hm-qty').value    = h ? h.qty           : '';
  document.getElementById('hm-cost').value   = h ? h.avgCost       : '';
  document.getElementById('hm-date').value   = h ? (h.date || today()) : today();
  document.getElementById('hm-sector').value = h ? (h.sector || '') : '';
  document.getElementById('hm-notes').value  = h ? (h.notes  || '') : '';
  calcHC();
  document.getElementById('hm-overlay').classList.add('open');
}

function closeHM() { document.getElementById('hm-overlay').classList.remove('open'); editHoldingId = null; }

function calcHC() {
  const qty   = parseFloat(document.getElementById('hm-qty').value) || 0;
  const cost  = parseFloat(document.getElementById('hm-cost').value) || 0;
  const total = qty * cost;
  if (total > 0) {
    document.getElementById('hm-cost-val').textContent = '$' + total.toLocaleString('en', { maximumFractionDigits: 0 });
    document.getElementById('hm-cost-det').textContent = `${qty} × $${cost.toFixed(2)}`;
    document.getElementById('hm-cost-preview').style.display = 'flex';
  } else { document.getElementById('hm-cost-preview').style.display = 'none'; }
}

function saveHolding() {
  const ticker  = document.getElementById('hm-ticker').value.trim().toUpperCase();
  const qty     = parseFloat(document.getElementById('hm-qty').value);
  const avgCost = parseFloat(document.getElementById('hm-cost').value);
  if (!ticker || !qty || !avgCost) { toast('⚠ מלא: טיקר, כמות, מחיר'); return; }
  const existing = editHoldingId ? portfolio.find(h => h.id === editHoldingId) : null;
  const date = document.getElementById('hm-date').value || today();
  // רשומת הרכישות: פוזיציה שחוזקה (יותר מלוט אחד) נשמרת כמו שהיא;
  // פוזיציה עם רכישה אחת מסונכרנת מחדש לפי הערכים שנערכו.
  const buys = (existing?.buys && existing.buys.length > 1)
    ? existing.buys
    : [{ date, price: avgCost, qty }];
  const h = {
    id: editHoldingId || Date.now().toString(), ticker, qty, avgCost, date,
    sector:       document.getElementById('hm-sector').value,
    notes:        document.getElementById('hm-notes').value,
    sales:        existing?.sales || [],
    buys,
    remainingQty: existing?.remainingQty || qty,
  };
  if (editHoldingId) { portfolio = portfolio.map(p => p.id === editHoldingId ? h : p); toast('✓ עודכן'); }
  else               { portfolio.unshift(h); toast('✓ נשמר!'); }
  sv(portKey(), portfolio);
  closeHM();
  loadPortfolio();
}

function deleteHolding(id) {
  if (!confirm('למחוק?')) return;
  portfolio = portfolio.filter(h => h.id !== id);
  sv(portKey(), portfolio);
  loadPortfolio();
  toast('נמחק');
}

function openSell(id) {
  activeSellId = id;
  const h = portfolio.find(x => x.id === id);
  if (!h) return;
  const rem = h.remainingQty || h.qty;
  document.getElementById('sell-tkr-lbl').textContent  = h.ticker;
  document.getElementById('sell-info-txt').textContent = `${rem} מניות · עלות $${h.avgCost.toFixed(2)}`;
  document.getElementById('sell-price').value = '';
  document.getElementById('sell-qty').value   = '';
  document.getElementById('sell-pnl').textContent = '—';
  document.getElementById('sell-det').textContent  = '—';
  document.getElementById('sell-qbtns').innerHTML = [25,50,75,100].map(p => {
    const s = Math.round(rem * (p / 100));
    return `<button class="quick-btn" onclick="setSellQ(${s},this)">${p}% (${s})</button>`;
  }).join('');
  calcSellPnl();
  document.getElementById('sell-overlay').classList.add('open');
}

function setSellQ(qty, btn) {
  document.getElementById('sell-qty').value = qty;
  document.getElementById('sell-qbtns').querySelectorAll('.quick-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  calcSellPnl();
}

function calcSellPnl() {
  const price = parseFloat(document.getElementById('sell-price').value);
  const qty   = parseFloat(document.getElementById('sell-qty').value);
  const h     = activeSellId ? portfolio.find(x => x.id === activeSellId) : null;
  if (!h || !price || !qty) { document.getElementById('sell-pnl').textContent = '—'; return; }
  const p = (price - h.avgCost) * qty;
  document.getElementById('sell-pnl').textContent = (p >= 0 ? '+' : '') + ' $' + p.toFixed(2);
  document.getElementById('sell-pnl').style.color  = pnlCol(p);
  document.getElementById('sell-det').textContent  = `${((p / (h.avgCost * qty)) * 100).toFixed(2)}% · ${qty} מניות`;
}

function confirmSell() {
  const price = parseFloat(document.getElementById('sell-price').value);
  const qty   = parseFloat(document.getElementById('sell-qty').value);
  if (!price || !qty) { toast('⚠ הכנס מחיר וכמות'); return; }
  const idx = portfolio.findIndex(h => h.id === activeSellId);
  if (idx === -1) return;
  const h   = portfolio[idx];
  const rem = h.remainingQty || h.qty;
  if (qty > rem) { toast('⚠ כמות גדולה מהנותרת'); return; }
  const p = (price - h.avgCost) * qty;
  if (!h.sales) h.sales = [];
  h.sales.push({ date: today(), price, qty, pnl: +p.toFixed(2) });
  h.remainingQty = rem - qty;
  if (h.remainingQty <= 0) {
    // הפוזיציה נסגרה — לא מוחקים אותה, אלא שומרים לארכיון כדי שהרווח הממומש
    // יישאר בסיכום התיק וברשימת הפוזיציות הסגורות
    h.remainingQty = 0;
    h.closedDate = today();
    portfolio[idx] = h;
    toast(`✓ נסגרה! P&L: ${signStr(p)}$${Math.abs(p).toFixed(0)}`);
  } else {
    portfolio[idx] = h;
    toast(`✓ מכירה: ${qty} × $${price}`);
  }
  sv(portKey(), portfolio);
  closeSell();
  loadPortfolio();
}

function closeSell() { document.getElementById('sell-overlay').classList.remove('open'); activeSellId = null; }

// ═══════════════════════════════════════════════════════════
//  עריכה / מחיקה של מכירה (מימוש) בהחזקת תיק
// ═══════════════════════════════════════════════════════════
let activeSaleHoldingId = null, activeSaleIdx = null;

// יתרת הפוזיציה = כמות שנקנתה − סך המכירות. פוזיציה שכולה מומשה מקבלת
// תאריך סגירה; אם עריכה/מחיקה החזירו לה מניות — התאריך יורד והיא חוזרת לרשימה.
function recalcHoldingAfterSalesChange(h) {
  const soldQty = (h.sales || []).reduce((s, x) => s + (x.qty || 0), 0);
  h.remainingQty = Math.max(0, (h.qty || 0) - soldQty);
  if (h.remainingQty <= 0) {
    h.remainingQty = 0;
    if (!h.closedDate) {
      const last = (h.sales || [])[h.sales.length - 1];
      h.closedDate = (last && last.date) || today();
    }
  } else {
    delete h.closedDate;
  }
}

function openSaleEdit(holdingId, idx) {
  const h = portfolio.find(x => x.id === holdingId);
  if (!h || !h.sales || !h.sales[idx]) return;
  activeSaleHoldingId = holdingId;
  activeSaleIdx = idx;
  const s = h.sales[idx];
  const otherQty = h.sales.reduce((sum, x, i) => sum + (i === idx ? 0 : (x.qty || 0)), 0);
  const maxQty = Math.max(0, (h.qty || 0) - otherQty);
  document.getElementById('sm-tkr-lbl').textContent  = h.ticker;
  document.getElementById('sm-info-txt').textContent = `עלות ממוצעת $${h.avgCost.toFixed(2)} · עד ${maxQty} מניות במכירה זו`;
  document.getElementById('sm-price').value = s.price;
  document.getElementById('sm-qty').value   = s.qty;
  document.getElementById('sm-date').value  = s.date || today();
  calcSM();
  document.getElementById('sm-overlay').classList.add('open');
}

function calcSM() {
  const h = portfolio.find(x => x.id === activeSaleHoldingId);
  const price = parseFloat(document.getElementById('sm-price').value);
  const qty   = parseFloat(document.getElementById('sm-qty').value);
  const pnlEl = document.getElementById('sm-pnl'), detEl = document.getElementById('sm-det');
  if (!h || !price || !qty) { pnlEl.textContent = '—'; detEl.textContent = '—'; return; }
  const p = (price - h.avgCost) * qty;
  pnlEl.textContent = signStr(p) + '$' + Math.abs(p).toFixed(2);
  pnlEl.style.color = pnlCol(p);
  detEl.textContent = `${((p / (h.avgCost * qty)) * 100).toFixed(2)}% · ${qty} מניות`;
}

function confirmSM() {
  const idx = portfolio.findIndex(x => x.id === activeSaleHoldingId);
  if (idx === -1 || activeSaleIdx === null) return;
  const h = portfolio[idx];
  const price = parseFloat(document.getElementById('sm-price').value);
  const qty   = parseFloat(document.getElementById('sm-qty').value);
  const date  = document.getElementById('sm-date').value || today();
  if (!price || !qty || qty <= 0) { toast('⚠ הכנס מחיר וכמות'); return; }
  const otherQty = h.sales.reduce((s, x, i) => s + (i === activeSaleIdx ? 0 : (x.qty || 0)), 0);
  if (qty + otherQty > (h.qty || 0)) { toast('⚠ סך המכירות גדול מהכמות שנקנתה'); return; }
  h.sales[activeSaleIdx] = {
    ...h.sales[activeSaleIdx],
    date, price, qty, pnl: +((price - h.avgCost) * qty).toFixed(2),
  };
  recalcHoldingAfterSalesChange(h);
  portfolio[idx] = h;
  sv(portKey(), portfolio);
  closeSM();
  loadPortfolio();
  toast('✓ המכירה עודכנה');
}

function deleteSale() {
  const idx = portfolio.findIndex(x => x.id === activeSaleHoldingId);
  if (idx === -1 || activeSaleIdx === null) return;
  if (!confirm('למחוק את המכירה? הכמות תוחזר לפוזיציה.')) return;
  const h = portfolio[idx];
  h.sales.splice(activeSaleIdx, 1);
  recalcHoldingAfterSalesChange(h);
  portfolio[idx] = h;
  sv(portKey(), portfolio);
  closeSM();
  loadPortfolio();
  toast('המכירה נמחקה — הכמות הוחזרה לפוזיציה');
}

function closeSM() { document.getElementById('sm-overlay').classList.remove('open'); activeSaleHoldingId = null; activeSaleIdx = null; }

// רשימת הרכישות של החזקה — כולל תמיכה לאחור בהחזקות ישנות ללא שדה buys
function holdingBuys(h) {
  return (h.buys && h.buys.length) ? h.buys : [{ date: h.date, price: h.avgCost, qty: h.qty }];
}

// ── חיזוק פוזיציה: קניית עוד מאותה מניה — עובד גם על תיק ההשקעות (portfolio)
// וגם על עסקאות פתוחות ביומן המסחר (trades), לפי mode ──
function openAdd(id, mode) {
  activeAddId = id;
  activeAddMode = mode === 'trade' ? 'trade' : 'portfolio';
  const arr = activeAddMode === 'trade' ? trades : portfolio;
  const h = arr.find(x => x.id === id);
  if (!h) return;
  const rem  = h.remainingQty || h.qty;
  const cost = activeAddMode === 'trade' ? h.entry : h.avgCost;
  document.getElementById('add-tkr-lbl').textContent  = h.ticker;
  document.getElementById('add-info-txt').textContent = `${rem} מניות · עלות ממוצעת $${cost.toFixed(2)}`;
  document.getElementById('add-price').value = '';
  document.getElementById('add-qty').value   = '';
  document.getElementById('add-date').value  = today();
  document.getElementById('add-avg').textContent = '—';
  document.getElementById('add-det').textContent = '—';
  document.getElementById('add-overlay').classList.add('open');
}

function calcAdd() {
  const price = parseFloat(document.getElementById('add-price').value);
  const qty   = parseFloat(document.getElementById('add-qty').value);
  const arr   = activeAddMode === 'trade' ? trades : portfolio;
  const h     = activeAddId ? arr.find(x => x.id === activeAddId) : null;
  if (!h || !price || !qty) { document.getElementById('add-avg').textContent = '—'; document.getElementById('add-det').textContent = '—'; return; }
  const rem    = h.remainingQty || h.qty;
  const cost   = activeAddMode === 'trade' ? h.entry : h.avgCost;
  const newAvg = (cost * rem + price * qty) / (rem + qty);
  document.getElementById('add-avg').textContent = '$' + newAvg.toFixed(2);
  document.getElementById('add-det').textContent = `${rem + qty} מניות · תוספת $${(price * qty).toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

function confirmAdd() {
  const price = parseFloat(document.getElementById('add-price').value);
  const qty   = parseFloat(document.getElementById('add-qty').value);
  const date  = document.getElementById('add-date').value || today();
  if (!price || !qty) { toast('⚠ הכנס מחיר וכמות'); return; }

  if (activeAddMode === 'trade') {
    const idx = trades.findIndex(t => t.id === activeAddId);
    if (idx === -1) return;
    const t      = trades[idx];
    const rem    = t.remainingQty || t.qty;
    const oldAvg = t.entry;
    if (!t.buys || !t.buys.length) t.buys = [{ date: t.date, price: oldAvg, qty: rem }];
    t.buys.push({ date, price, qty });
    // מחיר כניסה משוקלל מחדש על פני היתרה הקיימת + הקנייה החדשה
    t.entry        = +(((oldAvg * rem) + (price * qty)) / (rem + qty)).toFixed(4);
    t.remainingQty = rem + qty;
    t.qty          = (t.qty || rem) + qty;   // סך הכל שנקנה אי־פעם
    trades[idx] = t;
    sv(SK.trades, trades);
    closeAdd();
    loadLive();
    toast(`✓ חוזקה פוזיציה: ${qty} × $${price} · ממוצע $${t.entry.toFixed(2)}`);
    return;
  }

  const idx = portfolio.findIndex(h => h.id === activeAddId);
  if (idx === -1) return;
  const h      = portfolio[idx];
  const rem    = h.remainingQty || h.qty;
  const oldAvg = h.avgCost;
  // רשומת הרכישה המקורית — נגזרת מהעלות הישנה לפני השקלול מחדש
  if (!h.buys || !h.buys.length) h.buys = [{ date: h.date, price: oldAvg, qty: rem }];
  h.buys.push({ date, price, qty });
  // עלות ממוצעת משוקללת מחדש על פני היתרה הקיימת + הרכישה החדשה
  h.avgCost      = +(((oldAvg * rem) + (price * qty)) / (rem + qty)).toFixed(4);
  h.remainingQty = rem + qty;
  h.qty          = (h.qty || rem) + qty;   // סך הכל שנקנה אי־פעם
  portfolio[idx] = h;
  sv(portKey(), portfolio);
  closeAdd();
  loadPortfolio();
  toast(`✓ חוזקה פוזיציה: ${qty} × $${price} · ממוצע $${h.avgCost.toFixed(2)}`);
}

function closeAdd() { document.getElementById('add-overlay').classList.remove('open'); activeAddId = null; activeAddMode = 'portfolio'; }

function buildHoldingCard(h, i, allocData, allocTotal) {
  const pnlC    = h.pnl === null ? 'var(--tx3)' : pnlCol(h.pnl);
  const dayC    = h.q && h.q.change >= 0 ? 'var(--green)' : 'var(--red)';
  const allocPct = allocTotal ? ((allocData[i] / allocTotal) * 100).toFixed(1) : 0;
  const color    = PORT_COLORS[i % PORT_COLORS.length];
  const sales    = h.sales || [];
  const realPnl  = sales.reduce((s, x) => s + (+x.pnl || 0), 0);
  const realCost = sales.reduce((s, x) => s + (x.price * x.qty - (+x.pnl || 0)), 0);
  const realPct  = realCost > 0 ? (realPnl / realCost) * 100 : null;
  const salesLog = sales.length
    ? `<div style="border-top:0.5px solid var(--br);padding:0.55rem 0.9rem">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">
          <span style="font-size:9.5px;color:var(--tx3);text-transform:uppercase;letter-spacing:0.7px">מכירות · ${sales.length}</span>
          <span style="font-size:11px;font-weight:600;font-family:var(--font-mono);color:${pnlCol(realPnl)}">רווח ממומש ${fmtD(realPnl)}${realPct !== null ? ' · ' + signStr(realPct) + realPct.toFixed(1) + '%' : ''}</span>
        </div>
        <div class="real-log">${sales.map((s, si) => `<div class="real-row real-row-edit" onclick="openSaleEdit('${h.id}',${si})">
          <span>${s.date}</span>
          <span>${s.qty}×$${(+s.price).toFixed(2)}</span>
          <span style="display:flex;align-items:center;gap:6px;color:${pnlCol(s.pnl)}">${signStr(s.pnl)}$${Math.abs(s.pnl).toFixed(0)}<i class="ti ti-pencil real-row-pencil"></i></span>
        </div>`).join('')}</div>
      </div>`
    : '';
  // יומן רכישות — מוצג רק כשהפוזיציה חוזקה (יותר מרכישה אחת)
  const buys    = holdingBuys(h);
  const buysLog = buys.length > 1
    ? `<div style="border-top:0.5px solid var(--br);padding:0.55rem 0.9rem">
        <div style="font-size:9.5px;color:var(--tx3);text-transform:uppercase;letter-spacing:0.7px;margin-bottom:4px">רכישות</div>
        <div class="real-log">${buys.map(b => `<div class="real-row"><span>${b.date}</span><span>${b.qty}×$${(+b.price).toFixed(2)}</span><span style="color:var(--tx2)">$${Math.round(b.price * b.qty).toLocaleString()}</span></div>`).join('')}</div>
      </div>`
    : '';

  return `<div class="ph-card">
    <div class="ph-top">
      <div style="min-width:75px;display:flex;align-items:center;gap:8px">
        ${stockLogoImg(h.ticker, 32)}
        <div>
          <div style="display:flex;align-items:center;gap:5px">
            <span class="ph-tkr">${h.ticker}</span>
          </div>
          ${h.sector ? `<span class="ph-sector">${h.sector}</span>` : ''}
        </div>
      </div>
      <div class="ph-alloc">
        <div class="ph-alloc-bar"><div class="ph-alloc-fill" style="width:${allocPct}%;background:${color}"></div></div>
        <div class="ph-alloc-txt">${allocPct}% מהתיק · ${h.rem} מניות</div>
      </div>
      <div class="ph-price-blk" id="phprice-${h.id}">
        <div class="ph-price">${h.cp ? '$' + h.cp.toFixed(2) : '<span style="color:var(--tx3)">—</span>'}</div>
        ${h.q ? `<div class="ph-day" style="color:${dayC}">${signStr(h.q.change)}${h.q.change.toFixed(2)} (${signStr(h.q.changesPercentage)}${h.q.changesPercentage.toFixed(2)}%)</div>` : ''}
      </div>
      <div class="ph-pnl-blk">
        <div class="ph-pnl" style="color:${pnlC}">${h.pnl !== null ? fmtD(h.pnl) : '—'}</div>
        <div class="ph-pnlpct" style="color:${pnlC}">${h.pnlPct !== null ? signStr(h.pnlPct) + h.pnlPct.toFixed(2) + '%' : ''}</div>
      </div>
    </div>
    <div class="ph-bot">
      <div class="ph-stat"><div class="ph-stat-lbl">עלות ממוצעת</div><div class="ph-stat-val">$${h.avgCost.toFixed(2)}</div></div>
      <div class="ph-stat"><div class="ph-stat-lbl">עלות בסיס</div><div class="ph-stat-val">$${Math.round(h.cost).toLocaleString()}</div></div>
      <div class="ph-stat"><div class="ph-stat-lbl">שווי נוכחי</div><div class="ph-stat-val">${h.val ? '$' + Math.round(h.val).toLocaleString() : '—'}</div></div>
      ${sales.length ? `<div class="ph-stat"><div class="ph-stat-lbl">רווח ממומש</div><div class="ph-stat-val" style="color:${pnlCol(realPnl)}">${fmtD(realPnl)}${realPct !== null ? ` <span style="font-size:10px;font-weight:500">${signStr(realPct)}${realPct.toFixed(1)}%</span>` : ''}</div></div>` : ''}
      ${h.date ? `<div class="ph-stat"><div class="ph-stat-lbl">תאריך קנייה</div><div class="ph-stat-val">${h.date}</div></div>` : ''}
      <div class="ph-actions">
        <button class="action-btn primary" onclick="openAdd('${h.id}')"><i class="ti ti-arrow-up-right" style="font-size:11px"></i>חזק</button>
        <button class="action-btn success" onclick="openSell('${h.id}')"><i class="ti ti-coin" style="font-size:11px"></i>מכור</button>
        <button class="action-btn neutral" onclick="openHM('${h.id}')"><i class="ti ti-edit" style="font-size:11px"></i>ערוך</button>
        ${(typeof caFindBySymbol === 'function' && caFindBySymbol(h.ticker)) ? `<button class="action-btn info" onclick="caOpenBySymbol('${h.ticker}')"><i class="ti ti-file-analytics" style="font-size:11px"></i>ניתוח</button>` : ''}
        <button class="action-btn danger"  onclick="deleteHolding('${h.id}')"><i class="ti ti-trash" style="font-size:11px"></i></button>
      </div>
    </div>
    ${buysLog}
    ${salesLog}
    ${h.notes ? `<div style="padding:0 0.9rem 0.65rem;font-size:11.5px;color:var(--tx3)"><i class="ti ti-notes" style="font-size:11px;margin-left:3px"></i>${h.notes}</div>` : ''}
  </div>`;
}

function setPsValSub(txt) {
  const el = document.getElementById('ps-val-sub');
  if (el) el.textContent = txt;
}

// שורת המשנה של כרטיס בסיכום התיק: טקסט + צבע אופציונלי לפי רווח/הפסד
function setPsSub(id, txt, colorVal) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = txt || '';
  el.style.color = (colorVal === undefined || colorVal === null) ? 'var(--tx3)' : pnlCol(colorVal);
}

// ── רווח ממומש: סכום כל המכירות (sales) על פני כל ההחזקות — פתוחות וסגורות.
// עלות הבסיס של החלק שמומש נגזרת מכל מכירה: price·qty − pnl = avgCost·qty,
// כך שהאחוז מדויק גם אחרי חיזוק/שקלול מחדש של הפוזיציה.
function portfolioRealized() {
  let pnl = 0, cost = 0, sales = 0;
  const closed = [];
  (portfolio || []).forEach(h => {
    const hs = h.sales || [];
    if (!hs.length) return;
    let hPnl = 0, hCost = 0, hQty = 0;
    hs.forEach(s => {
      const p = +s.pnl || 0;
      hPnl += p;
      hCost += (s.price * s.qty) - p;
      hQty += (s.qty || 0);
      sales++;
    });
    pnl  += hPnl;
    cost += hCost;
    if ((h.remainingQty ?? h.qty) <= 0) {
      closed.push({ ...h, realizedPnl: hPnl, realizedCost: hCost, realizedQty: hQty });
    }
  });
  return { pnl, cost, sales, pct: cost > 0 ? (pnl / cost) * 100 : null, closed };
}

// ── רשימת פוזיציות סגורות (מומשו ב-100%) — מכווצת, עם סך הרווח הממומש ──
function renderClosedPositions(closed) {
  const el = document.getElementById('port-closed');
  if (!el) return;
  if (!closed.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = 'block';
  const totPnl  = closed.reduce((s, h) => s + h.realizedPnl, 0);
  const totCost = closed.reduce((s, h) => s + h.realizedCost, 0);
  const totPct  = totCost > 0 ? (totPnl / totCost) * 100 : null;
  const wasOpen = el.classList.contains('open');
  const expanded = new Set([...el.querySelectorAll('.pclosed-item.exp')].map(x => x.dataset.hid));
  const rows = closed.slice()
    .sort((a, b) => String(b.closedDate || '').localeCompare(String(a.closedDate || '')))
    .map(h => {
      const pct  = h.realizedCost > 0 ? (h.realizedPnl / h.realizedCost) * 100 : null;
      const last = (h.sales || [])[(h.sales || []).length - 1] || {};
      const saleRows = (h.sales || []).map((s, si) => `<div class="real-row real-row-edit" onclick="event.stopPropagation();openSaleEdit('${h.id}',${si})">
        <span>${s.date}</span>
        <span>${s.qty}×$${(+s.price).toFixed(2)}</span>
        <span style="display:flex;align-items:center;gap:6px;color:${pnlCol(s.pnl)}">${signStr(s.pnl)}$${Math.abs(s.pnl).toFixed(0)}<i class="ti ti-pencil real-row-pencil"></i></span>
      </div>`).join('');
      return `<div class="pclosed-item${expanded.has(h.id) ? ' exp' : ''}" data-hid="${h.id}">
        <div class="pclosed-row" onclick="this.parentElement.classList.toggle('exp')">
          <span class="pclosed-tkr"><i class="ti ti-chevron-left pclosed-rowcaret"></i>${(typeof stockLogoImg === 'function') ? stockLogoImg(h.ticker, 18) : ''}${h.ticker}</span>
          <span class="pclosed-meta">${h.realizedQty} מניות · ${(h.sales || []).length} מכירות · נסגרה ${h.closedDate || last.date || '—'}</span>
          <span class="pclosed-pnl" style="color:${pnlCol(h.realizedPnl)}">${fmtD(h.realizedPnl)}${pct !== null ? ' · ' + signStr(pct) + pct.toFixed(1) + '%' : ''}</span>
          <button class="pclosed-del" title="מחק לצמיתות" onclick="event.stopPropagation();deleteHolding('${h.id}')"><i class="ti ti-trash"></i></button>
        </div>
        <div class="pclosed-sales"><div class="real-log">${saleRows}</div></div>
      </div>`;
    }).join('');
  el.className = 'pclosed' + (wasOpen ? ' open' : '');
  el.innerHTML = `
    <div class="pclosed-head" onclick="this.parentElement.classList.toggle('open')">
      <i class="ti ti-chevron-left pclosed-caret"></i>
      <span class="pclosed-title">פוזיציות סגורות · ${closed.length}</span>
      <span class="pclosed-total" style="color:${pnlCol(totPnl)}">${fmtD(totPnl)}${totPct !== null ? ' · ' + signStr(totPct) + totPct.toFixed(1) + '%' : ''}</span>
    </div>
    <div class="pclosed-body">${rows}</div>`;
}

// סנכרון כרטיס "מזומן בתיק": ערך + מקור (נמשך מ-IBKR)
function syncCashCard(investCash) {
  const valEl = document.getElementById('ps-cash-val');
  if (valEl) {
    valEl.textContent = investCash ? '$' + Math.round(investCash).toLocaleString() : '—';
    valEl.style.color = investCash < 0 ? 'var(--red)' : '';
  }
  const src = document.getElementById('ps-cash-src');
  if (src && isDadPort()) {
    // התיק של אבא לא מחובר ל-IBKR — המזומן מוזן ידנית (לחיצה על הכרטיס)
    src.innerHTML = '<i class="ti ti-pencil" style="font-size:9px"></i> ' + (investCash ? 'הוזן ידנית • לחץ לעדכון' : 'לחץ להזנת מזומן');
    src.style.color = '';
  } else if (src) {
    const ic = (typeof ibkrGetCash === 'function') ? ibkrGetCash() : null;
    const stale = (typeof ibkrCashIsStale === 'function') && ibkrCashIsStale();
    if (!investCash && cashNeedsMapping('port')) {
      src.innerHTML = CASH_MAP_CTA;
      src.style.color = '';
    } else {
      src.innerHTML = ic
        ? '<i class="ti ti-building-bank" style="font-size:9px"></i> נמשך מ-IBKR • ' + ibkrTimeAgo(ic.ts)
        : 'יתרת מזומן בחשבון';
      src.style.color = ic && stale ? 'var(--amber-t)' : '';
    }
  }
}

// ── מעבר בין התיק שלי לתיק של אבא ──
function setPortOwner(owner) {
  owner = owner === 'dad' ? 'dad' : 'me';
  if (owner === portOwner) return;
  // סוגרים חלונות עריכה פתוחים — הם מצביעים על החזקות של התיק הקודם
  ['hm-overlay','sell-overlay','sm-overlay','add-overlay'].forEach(id => document.getElementById(id)?.classList.remove('open'));
  editHoldingId = null; activeSellId = null; activeSaleHoldingId = null; activeSaleIdx = null;
  if (activeAddMode === 'portfolio') activeAddId = null;
  portOwner = owner;
  try { localStorage.setItem(SK.portOwner, owner); } catch {}
  portfolio = ld(portKey());
  applyPortOwnerUI();
  loadPortfolio();
}

function applyPortOwnerUI() {
  const dad = isDadPort();
  document.getElementById('port-owner-me')?.classList.toggle('on', !dad);
  document.getElementById('port-owner-dad')?.classList.toggle('on', dad);
  const t = document.getElementById('port-title');
  const card = document.getElementById('ps-cash-card');
  if (card) {
    card.classList.toggle('ps-cash-editable', dad);
    card.title = dad ? 'לחץ לעדכון יתרת המזומן' : '';
  }
}

// מזומן בתיק של אבא — הזנה ידנית
function editPortCash() {
  if (!isDadPort()) return;
  const cur = getInvestCash();
  const v = prompt('יתרת מזומן בתיק של אבא ($):', cur ? String(cur) : '');
  if (v === null) return;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  if (String(v).trim() !== '' && isNaN(n)) { toast('⚠ ערך לא תקין'); return; }
  _pushSetting(SK.investCashDad, isNaN(n) ? 0 : n);
  loadPortfolio();
  toast('✓ המזומן עודכן');
}

async function loadPortfolio() {
  const btn = document.getElementById('port-ref-btn');
  btn.classList.add('spinning');
  setDot('port', 'amber', 'טוען...');

  const realized = portfolioRealized();
  const holdings = portfolio.filter(h => (h.remainingQty ?? h.qty) > 0);
  document.getElementById('ps-cnt').textContent = holdings.length;
  setPsSub('ps-cnt-sub', realized.closed.length ? realized.closed.length + ' סגורות' : '');

  const investCash = getInvestCash();
  syncCashCard(investCash);
  renderClosedPositions(realized.closed);

  // ── רווח ממומש (מוצג תמיד, גם ללא החזקות פתוחות) ──
  const psReal = document.getElementById('ps-realized');
  if (realized.sales) {
    psReal.textContent = fmtD(realized.pnl);
    psReal.style.color = pnlCol(realized.pnl);
    setPsSub('ps-realized-sub',
      realized.pct !== null ? signStr(realized.pct) + realized.pct.toFixed(2) + '% על עלות שמומשה' : `${realized.sales} מכירות`,
      realized.pct !== null ? realized.pnl : null);
  } else {
    psReal.textContent = '—'; psReal.style.color = '';
    setPsSub('ps-realized-sub', 'אין מכירות עדיין');
  }

  if (!holdings.length) {
    document.getElementById('port-holdings').innerHTML = '<div class="empty-state"><i class="ti ti-briefcase"></i><p style="margin-bottom:0.65rem">' + (realized.closed.length ? 'כל הפוזיציות נסגרו' : 'אין החזקות עדיין') + '</p><button class="add-btn" style="display:inline-flex" onclick="openHM()"><i class="ti ti-plus"></i>הוסף החזקה' + (realized.closed.length ? '' : ' ראשונה') + '</button></div>';
    ['ps-cost','ps-pnl'].forEach(id => { document.getElementById(id).textContent = '—'; document.getElementById(id).style.color = ''; });
    setPsSub('ps-cost-sub', ''); setPsSub('ps-pnl-sub', 'אין החזקות פתוחות');
    document.getElementById('ps-val').textContent = investCash ? '$' + Math.round(investCash).toLocaleString() : '—';
    document.getElementById('ps-val').style.color = '';
    setPsValSub(investCash ? 'מזומן בלבד' : '');
    // רווח כולל = רווח ממומש בלבד
    const psTotE = document.getElementById('ps-total');
    if (realized.sales) {
      psTotE.textContent = fmtD(realized.pnl);
      psTotE.style.color = pnlCol(realized.pnl);
      const acctPctE = investCash > 0 ? (realized.pnl / investCash) * 100 : null;
      setPsSub('ps-total-sub',
        [realized.pct !== null ? 'תשואה ' + signStr(realized.pct) + realized.pct.toFixed(2) + '%' : '',
         acctPctE !== null ? 'מהחשבון ' + signStr(acctPctE) + acctPctE.toFixed(1) + '%' : ''].filter(Boolean).join(' · '),
        realized.pnl);
    } else {
      psTotE.textContent = '—'; psTotE.style.color = '';
      setPsSub('ps-total-sub', '');
    }
    setDot('port', realized.closed.length ? 'green' : 'off', realized.closed.length ? 'סגור' : 'ממתין');
    btn.classList.remove('spinning');
    return;
  }

  const prices = await fetchPrices([...new Set(holdings.map(h => h.ticker))]);
  let totalVal = 0, totalCost = 0, validN = 0;

  const enriched = holdings.map(h => {
    const q    = prices[h.ticker] || priceCache[h.ticker] || null;
    const cp   = q ? q.price : null;
    const rem  = h.remainingQty || h.qty;
    const cost = h.avgCost * rem;
    const val  = cp ? cp * rem : null;
    const p    = val !== null ? val - cost : null;
    const pPct = p !== null ? (p / cost) * 100 : null;
    totalCost += cost;
    if (val !== null) { totalVal += val; validN++; }
    return { ...h, rem, cp, q, cost, val, pnl: p, pnlPct: pPct };
  });

  const unrealPnl = validN ? totalVal - totalCost : null;
  const unrealPct = unrealPnl !== null && totalCost > 0 ? (unrealPnl / totalCost) * 100 : null;

  // שווי תיק = שווי שוק של ההחזקות + מזומן (המזומן נמשך מ-IBKR או מוזן ידנית).
  // החזקה שאין לה מחיר חי נספרת לפי עלות הבסיס שלה.
  const holdingsDispVal = enriched.reduce((s, h) => s + (h.val ?? h.cost), 0);
  document.getElementById('ps-val').textContent  = '$' + Math.round(holdingsDispVal + investCash).toLocaleString();
  document.getElementById('ps-val').style.color  = '';
  setPsValSub(investCash
    ? `החזקות $${Math.round(holdingsDispVal).toLocaleString()} + מזומן $${Math.round(investCash).toLocaleString()}`
    : '');
  document.getElementById('ps-cost').textContent = '$' + Math.round(totalCost).toLocaleString();
  setPsSub('ps-cost-sub', enriched.length + ' פוזיציות פתוחות');

  // ── רווח לא ממומש (על ההחזקות הפתוחות) ──
  const psPnl = document.getElementById('ps-pnl');
  psPnl.textContent = unrealPnl !== null ? fmtD(unrealPnl) : '—';
  psPnl.style.color = unrealPnl !== null ? pnlCol(unrealPnl) : '';
  setPsSub('ps-pnl-sub',
    unrealPct !== null ? signStr(unrealPct) + unrealPct.toFixed(2) + '% על החזקות פתוחות'
                       : (validN < enriched.length ? 'חסר מחיר חי' : ''),
    unrealPct !== null ? unrealPnl : null);

  // ── רווח כולל = ממומש + לא ממומש ──
  const hasUnreal = unrealPnl !== null;
  const totalPnl  = (realized.pnl || 0) + (hasUnreal ? unrealPnl : 0);
  const hasTotal  = realized.sales > 0 || hasUnreal;
  const capital   = realized.cost + totalCost;              // כל ההון שהושקע: פוזיציות סגורות + פתוחות
  const acctVal   = holdingsDispVal + investCash;           // שווי החשבון הנוכחי
  const totRetPct = capital > 0 ? (totalPnl / capital) * 100 : null;
  const acctPct   = acctVal  > 0 ? (totalPnl / acctVal)  * 100 : null;
  const psTot = document.getElementById('ps-total');
  psTot.textContent = hasTotal ? fmtD(totalPnl) : '—';
  psTot.style.color = hasTotal ? pnlCol(totalPnl) : '';
  setPsSub('ps-total-sub',
    [totRetPct !== null ? 'תשואה על ההון ' + signStr(totRetPct) + totRetPct.toFixed(2) + '%' : '',
     acctPct   !== null ? 'מהחשבון ' + signStr(acctPct) + acctPct.toFixed(1) + '%' : ''].filter(Boolean).join(' · '),
    hasTotal ? totalPnl : null);

  const allocData  = enriched.map(h => h.val || h.cost);
  const allocTotal = allocData.reduce((a, b) => a + b, 0);

  document.getElementById('port-holdings').innerHTML =
    `<div class="sec-title">ההחזקות · ${enriched.length}${validN < enriched.length ? ' <span class="bc-muted">(' + (enriched.length - validN) + ' ללא מחיר)</span>' : ''}</div>` +
    enriched.map((h, i) => buildHoldingCard(h, i, allocData, allocTotal)).join('');

  enriched.forEach(h => { if (h.cp) flash(document.getElementById('phprice-' + h.id), h.cp, h.ticker + '_p'); });
  document.getElementById('port-upd').textContent = 'עודכן ' + new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  setDot('port', validN ? 'green' : 'amber', validN ? 'חי' : 'ללא נתונים');
  btn.classList.remove('spinning');
}


// ═══════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
  }
});

// ═══════════════════════════════════════════════════════════
//  SEED TRADES (runs once, idempotent by seed key)
// ═══════════════════════════════════════════════════════════
function seedTrades() {
  if (localStorage.getItem('seed_trades_v1')) return;
  const seed = [
    {
      id: 'seed_nvdl_may27', ticker: 'NVDL', date: '2026-05-27', dir: 'Long', status: 'closed',
      entry: 103.22, exit: 110.36, qty: 30, fee: 0, sl: 101.35,
      realizations: [
        { date: '2026-06-02', price: 118.61, qty: 15, pnl: 230.85 },
        { date: '2026-06-03', price: 110.36, qty: 15, pnl: 107.10 },
      ],
      remainingQty: 0,
      pnl: 337.95,
      strategy: '', mood: '',
      notes: 'בנק הערות:\nעבדתי לפי יומן מסחר מסודר\nהמנייה הייתה מהרשימה שלי\nעסקה שהייתי עושה שוב',
      targets: [],
    },
    {
      id: 'seed_mstr_jun1', ticker: 'MSTR', date: '2026-06-01', dir: 'Long', status: 'closed',
      entry: 149.70, exit: 141.76, qty: 22, fee: 0, sl: 146,
      realizations: [
        { date: '2026-06-04', price: 141.76, qty: 22, pnl: -174.68 },
      ],
      remainingQty: 0,
      pnl: -174.68,
      strategy: '', mood: '',
      notes: 'בנק הערות:\nעבדתי לפי יומן מסחר מסודר\nהמנייה הייתה מהרשימה שלי\nעסקת FOMO\n\nנקודות לשיפור:\nהיה לי סטופ שלא עבד בזמן שעות המסחר הלא רציפות. יצאתי מהעסקה מפי 2 מהסיכון בגלל שלא ידעתי איך להתנהל במצב שבו המנייה ירדת מתחת לסטופ בפרי מרקט',
      targets: [],
    },
    {
      id: 'seed_ugl_jun3', ticker: 'UGL', date: '2026-06-03', dir: 'Long', status: 'closed',
      entry: 54.50, exit: 54.08, qty: 120, fee: 0, sl: 54.08,
      realizations: [
        { date: '2026-06-03', price: 54.08, qty: 120, pnl: -50.40 },
      ],
      remainingQty: 0,
      pnl: -50.40,
      strategy: '', mood: '', notes: '', targets: [],
    },
    {
      id: 'seed_nvdl_jun4', ticker: 'NVDL', date: '2026-06-04', dir: 'Long', status: 'closed',
      entry: 106.53, exit: 104.07, qty: 45, fee: 0, sl: 104.08,
      realizations: [
        { date: '2026-06-05', price: 104.07, qty: 45, pnl: -110.70 },
      ],
      remainingQty: 0,
      pnl: -110.70,
      strategy: '', mood: '',
      notes: 'בנק הערות:\nהמנייה הייתה מהרשימה שלי\nלא עבדתי לפי יומן מסחר מסודר\nעסקת FOMO',
      targets: [],
    },
  ];
  seed.forEach(t => { if (!trades.find(x => x.id === t.id)) trades.unshift(t); });
  sv(SK.trades, trades);
  localStorage.setItem('seed_trades_v1', '1');
}

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
// תיקון נתונים היסטוריים: סטטוסים בעברית ('סגורה'/'פתוחה') שלא זוהו ע"י
// המסננים (t.status === 'closed'), ו-P&L שגוי בעסקאות שמומשו במלואן
// (עריכה דרך הטופס דרסה בעבר את סכום המימושים)
function migrateTrades() {
  let changed = false;
  trades.forEach(t => {
    if (t.status === 'סגורה') { t.status = 'closed'; changed = true; }
    if (t.status === 'פתוחה') { t.status = 'open';   changed = true; }
    const reals = t.realizations || [];
    if (t.status === 'closed' && reals.length) {
      const realizedQty = reals.reduce((s, r) => s + (r.qty || 0), 0);
      if (realizedQty >= (t.qty || 0)) {
        const correct = +(reals.reduce((s, r) => s + (r.pnl || 0), 0) - (t.fee || 0)).toFixed(2);
        if (t.pnl !== correct)     { t.pnl = correct;  changed = true; }
        if (t.remainingQty !== 0)  { t.remainingQty = 0; changed = true; }
      }
    }
  });
  if (changed) sv(SK.trades, trades);
}

// עסקאות ותיקות שנוצרו לפני שהיו יומנים לפי יחידת סיכון — משייכים אותן
// ליחידת הסיכון המוגדרת כרגע, כך שהיומן הקיים ממשיך תחת היחידה הנוכחית
// והחלפה עתידית של היחידה פותחת יומן חדש. עסקה שכבר נושאת ערך לא נוגעים בה.
function migrateRiskUnits() {
  const cur = getRiskUnit();
  if (cur <= 0) return;
  let changed = false;
  trades.forEach(t => {
    if (t.riskUnit === undefined || t.riskUnit === null) { t.riskUnit = cur; changed = true; }
  });
  if (changed) sv(SK.trades, trades);
}


async function init() {
  // Sync from cloud before loading (if configured)
  if (typeof dbIsReady === 'function' && dbIsReady()) {
    if (typeof dbSetSyncStatus === 'function') dbSetSyncStatus('syncing');
    const ok = await dbPullAll();
    if (typeof dbSetSyncStatus === 'function') dbSetSyncStatus(ok ? 'ok' : 'error');
  } else {
    if (typeof dbSetSyncStatus === 'function') dbSetSyncStatus('local');
  }

  applyChartTheme();      // צבעי טקסט/רשת לגרפים לפי מצב התצוגה הנוכחי
  normalizeStoredKey();   // מנקה מפתח מלוכלך שנמשך מהענן, פעם אחת, ומרפא את המקור

  trades      = ld(SK.trades);
  portfolio   = ld(portKey());
  applyPortOwnerUI();
  watchlist   = ld(SK.watchlist);
  seedTrades();
  migrateTrades();
  migrateRiskUnits();
  document.getElementById('f-date').value = today();
  document.getElementById('f-fee').value  = getDefaultFee().toFixed(2);
  updateFeeHint();
  renderTargets();
  document.getElementById('vtb-table').classList.toggle('active', closedViewMode === 'table');
  document.getElementById('vtb-cards').classList.toggle('active', closedViewMode === 'cards');
  fullRefresh();
  setIv(60);

  // Close modals on backdrop click
  ['pm-overlay','sl-overlay','hm-overlay','sell-overlay','settings-overlay','ibkr-preview-overlay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });
  });

  // ריענון גרפים בשינוי גודל חלון / סיבוב מכשיר
  window.addEventListener('resize', handleViewportResize);

  // ניקוי מיידי של שדה מפתח ה-API — כשמדביקים מפתח, גרשיים/רווחים/תווים נסתרים
  // נחתכים על המקום כדי שהמשתמש יראה שהמפתח נשאר נקי ולא "נוספים לו דברים".
  const keyInput = document.getElementById('settings-key');
  if (keyInput) keyInput.addEventListener('input', () => {
    const cleaned = _cleanKey(keyInput.value);
    if (cleaned !== keyInput.value) keyInput.value = cleaned;
  });

  if (!getKey()) setTimeout(() => { openSettings(); toast('⚠ הגדר API Key של Finnhub בהגדרות'); }, 400);

  // Signal add-ons (ibkr.js) that data is loaded, including cloud pull.
  // הדגל נחוץ כי ibkr.js נטען אחרי app.js — אם init סיים לפני שהוא נטען,
  // האירוע כבר נורה והמאזין שלו לא יתפוס אותו.
  window.tjReady = true;
  window.dispatchEvent(new Event('tj-ready'));
}

init();
