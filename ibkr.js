// ═══════════════════════════════════════════════════════════
//  ibkr.js — סנכרון עסקאות מ-Interactive Brokers (Flex Web Service)
//  זרימה: פתיחת האתר → משיכת דוח Flex דרך proxy (Supabase Edge Function)
//  → פרסור → הצעות (עסקאות חדשות / סגירות / מימושים) → אישור המשתמש → שמירה.
//  אף פעם לא נשמר כלום בלי תצוגה מקדימה ואישור.
// ═══════════════════════════════════════════════════════════

const IBKR_CFG_KEY   = 'tj_ibkr_cfg_v1';    // {token, queryId, proxyUrl, debug}
const IBKR_SEEN_KEY  = 'tj_ibkr_seen_v1';   // מזהי עסקאות שכבר טופלו (נוספו או נדחו)
const IBKR_LAST_KEY  = 'tj_ibkr_lastsync';  // timestamp של סנכרון אחרון (מצערת)
const IBKR_CASH_KEY  = 'tj_ibkr_cash_v1';   // {byAccount, total, ts} — יתרת מזומן מהדוח האחרון
const IBKR_THROTTLE_MS = 15 * 60 * 1000;    // סנכרון אוטומטי לכל היותר פעם ב-15 דק'
const IBKR_SEEN_CAP  = 3000;

let ibkrProposals    = [];
let ibkrLastExecs    = [];   // הביצועים מהסנכרון האחרון — לבנייה מחדש כשמשנים ניתוב
let ibkrDestOverride = {};   // execId → 'trades'|'port' — עקיפה ידנית מהתצוגה המקדימה
let ibkrLastRaw      = '';
let ibkrLastError    = '';
let ibkrLastCash     = null; // מזומן שחולץ מהדוח האחרון (לפני שמירה)

// ── Config ──────────────────────────────────────────────────
function ibkrGetCfg() {
  try { return JSON.parse(localStorage.getItem(IBKR_CFG_KEY) || 'null') || {}; }
  catch { return {}; }
}
function ibkrSaveCfg(cfg) { sv(IBKR_CFG_KEY, cfg); }
function ibkrIsConfigured() {
  const c = ibkrGetCfg();
  return !!(c.token && c.queryId && ibkrProxyUrl());
}
// כתובת ה-proxy: אם לא הוגדרה ידנית — נגזרת אוטומטית מפרויקט ה-Supabase הקיים
function ibkrProxyUrl() {
  const c = ibkrGetCfg();
  if (c.proxyUrl) return c.proxyUrl.replace(/\/+$/, '');
  const db = (typeof dbGetConfig === 'function') ? dbGetConfig() : null;
  if (db && db.url) return db.url.replace(/\/+$/, '') + '/functions/v1/ibkr-flex';
  return '';
}

function ibkrGetSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(IBKR_SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function ibkrSaveSeen(set) {
  let arr = [...set];
  if (arr.length > IBKR_SEEN_CAP) arr = arr.slice(arr.length - IBKR_SEEN_CAP);
  sv(IBKR_SEEN_KEY, arr);
}

// ── Status chip ─────────────────────────────────────────────
// state: 'syncing' | 'ok' | 'error' | 'off'
function ibkrSetChip(state, txt) {
  const el = document.getElementById('ibkr-chip');
  if (!el) return;
  if (state === 'off') { el.style.display = 'none'; return; }
  el.style.display = '';
  el.className = 'hdr-badge ' + (state === 'ok' ? 'badge-green' : 'badge-off');
  if (state === 'error') el.style.color = 'var(--red-t, #f87171)';
  else el.style.color = '';
  el.innerHTML = (state === 'syncing' ? '<i class="ti ti-refresh ibkr-spin"></i> ' : '<i class="ti ti-building-bank"></i> ') + txt;
}
function ibkrTimeAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1)  return 'עכשיו';
  if (m < 60) return `לפני ${m} דק'`;
  const h = Math.round(m / 60);
  if (h < 24) return `לפני ${h} שע'`;
  const d = Math.round(h / 24);
  return d === 1 ? 'לפני יום' : `לפני ${d} ימים`;
}
function ibkrChipClick() {
  if (ibkrLastError) alert('שגיאת סנכרון IBKR:\n\n' + ibkrLastError);
  else if (ibkrProposals.length) ibkrOpenPreview();
  else toast('IBKR מסונכרן — אין עסקאות חדשות');
}

// ── Auto-sync on open (throttled) ───────────────────────────
function ibkrAutoSync() {
  if (!ibkrIsConfigured()) { ibkrSetChip('off'); return; }
  const last = parseInt(localStorage.getItem(IBKR_LAST_KEY) || '0', 10);
  if (Date.now() - last < IBKR_THROTTLE_MS) {
    ibkrSetChip('ok', 'מסונכרן • ' + ibkrTimeAgo(last));
    return;
  }
  ibkrSync();
}

async function ibkrSync(attempt = 0) {
  if (!ibkrIsConfigured()) { toast('⚠ הגדר טוקן ו-Query ID של IBKR בהגדרות'); return; }
  const cfg = ibkrGetCfg();
  ibkrLastError = '';
  ibkrSetChip('syncing', 'מסנכרן...');
  try {
    const url = ibkrProxyUrl() + '?t=' + encodeURIComponent(cfg.token) + '&q=' + encodeURIComponent(cfg.queryId);
    const headers = {};
    const db = (typeof dbGetConfig === 'function') ? dbGetConfig() : null;
    if (db && db.key) { headers['apikey'] = db.key; headers['Authorization'] = 'Bearer ' + db.key; }
    const res = await fetch(url, { headers });
    const text = await res.text();
    ibkrLastRaw = text;
    if (cfg.debug) {
      console.log('[ibkr] raw Flex response ↓↓↓');
      console.log(text);
      ibkrFillDebugPanel();
    }
    if (!res.ok) throw new Error('Proxy HTTP ' + res.status + ': ' + text.slice(0, 300));

    const execs = ibkrParseFlex(text);
    localStorage.setItem(IBKR_LAST_KEY, String(Date.now()));
    ibkrLastExecs = execs;
    ibkrDestOverride = {};
    ibkrRememberAccounts(execs);
    ibkrApplyCash();
    ibkrProposals = ibkrBuildProposals(execs);
    if (ibkrProposals.length) {
      ibkrSetChip('ok', `${ibkrProposals.length} חדשות`);
      ibkrShowBanner();
    } else {
      ibkrSetChip('ok', 'מסונכרן • עכשיו');
      ibkrHideBanner();
    }
  } catch (e) {
    console.warn('[ibkr] sync failed', e);
    const msg = e.message || String(e);

    // שגיאות זמניות של IBKR (עומס/דוח בהפקה) — ניסיון חוזר אוטומטי
    if (/1001|1019|try again shortly|generation in progress/i.test(msg) && attempt < 2) {
      const waitSec = attempt === 0 ? 30 : 90;
      ibkrSetChip('syncing', `IBKR עמוס — ניסיון חוזר בעוד ${waitSec} שנ'`);
      setTimeout(() => ibkrSync(attempt + 1), waitSec * 1000);
      return;
    }

    ibkrLastError = ibkrFriendlyError(msg);
    ibkrSetChip('error', 'שגיאת סנכרון — לחץ לפרטים');
    // גם כשהמשיכה נכשלת — מציגים את שווי התיק לפי הנתון האחרון שנשמר
    if (ibkrGetCash()) ibkrRefreshCashViews();
  }
}

// תרגום שגיאות Flex נפוצות להסבר מעשי
function ibkrFriendlyError(msg) {
  let hint = '';
  if (/1001|try again shortly/i.test(msg))
    hint = 'השרת של IBKR עמוס כרגע. זו תקלה זמנית אצלם — נסה שוב בעוד כמה דקות ("סנכרן עכשיו" בהגדרות).';
  else if (/1012|expired/i.test(msg))
    hint = 'פג תוקף הטוקן. צור טוקן חדש ב-IBKR: Performance & Reports ← Flex Queries ← Flex Web Service.';
  else if (/1015|1020|invalid token|token/i.test(msg))
    hint = 'הטוקן לא תקין — בדוק שהעתקת אותו במלואו, בלי רווחים.';
  else if (/1003|1004|query/i.test(msg))
    hint = 'בעיה ב-Query ID — בדוק שהמספר תואם לשאילתה שיצרת ב-IBKR.';
  else if (/HTTP 404/.test(msg))
    hint = 'פונקציית ה-proxy לא נמצאה ב-Supabase — ודא שפרסת פונקציה בשם ibkr-flex בדיוק.';
  else if (/HTTP 401|HTTP 403|JWT/i.test(msg))
    hint = 'בעיית הרשאה מול Supabase — ודא שסינכרון הענן מוגדר בהגדרות, או פרוס את הפונקציה עם --no-verify-jwt.';
  return hint ? hint + '\n\n— פרטים טכניים —\n' + msg : msg;
}

// ── Flex XML parsing ────────────────────────────────────────
// תומך גם ב-Activity Flex (<Trade>) וגם ב-Trade Confirmation Flex (<TradeConfirm>).
// פרסור הגנתי: שדות חסרים לא מפילים כלום — שורה בלתי-שמישה פשוט מדולגת.
function ibkrParseFlex(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('התשובה מ-IBKR אינה XML תקין (בדוק טוקן/Query ID)');

  const errCode = doc.querySelector('ErrorCode');
  if (errCode) {
    const msg = doc.querySelector('ErrorMessage')?.textContent || '';
    throw new Error(`IBKR Flex שגיאה ${errCode.textContent}: ${msg}`);
  }

  ibkrLastCash = ibkrExtractCash(doc);

  const nodes = [...doc.querySelectorAll('Trade, TradeConfirm')];
  const execs = [];
  nodes.forEach(n => {
    const a = {};
    for (const at of n.attributes) a[at.name] = at.value;

    const symbol = (a.symbol || '').trim().toUpperCase();
    const qtyRaw = parseFloat(a.quantity ?? a.qty ?? 'NaN');
    const price  = parseFloat(a.tradePrice ?? a.price ?? 'NaN');
    if (!symbol || isNaN(qtyRaw) || isNaN(price)) return;

    // רק ביצועים בפועל — מדלגים על הזמנות שבוטלו / לא מולאו / שורות סיכום
    const lod = (a.levelOfDetail || '').toUpperCase();
    if (lod && lod !== 'EXECUTION') return;                    // ORDER / SYMBOL_SUMMARY וכו'
    const codes = String(a.notes ?? a.code ?? a.codes ?? '');
    if (/(^|;)\s*Ca\s*(;|$)/i.test(codes)) return;             // Ca = הזמנה שבוטלה
    if (qtyRaw === 0 || price <= 0) return;                    // לא מולא בפועל

    // buySell מפורש אם קיים, אחרת סימן הכמות (מכירה = כמות שלילית ב-Flex)
    const bs   = (a.buySell || '').toUpperCase();
    const side = bs.includes('SELL') || (!bs && qtyRaw < 0) ? 'SELL' : 'BUY';

    execs.push({
      id:       a.tradeID || a.transactionID || a.execID || a.ibExecID ||
                (symbol + '_' + (a.tradeDate || '') + '_' + qtyRaw + '_' + price),
      account:  a.accountId || a.acctAlias || '',
      ticker:   symbol,
      date:     ibkrFmtDate(a.tradeDate || a.dateTime || a.reportDate || ''),
      time:     a.tradeTime || (a.dateTime || '').split(';')[1] || '',
      side,
      qty:      Math.abs(qtyRaw),
      price,
      fee:      Math.abs(parseFloat(a.ibCommission ?? a.commission ?? '0')) || 0,
      currency: a.currency || 'USD',
      openClose: (a.openCloseIndicator || '').toUpperCase(),
      assetCategory: a.assetCategory || '',
    });
  });

  // כפילויות בתוך אותו דוח (אותו מזהה פעמיים) — משאירים אחת
  const byId = new Map();
  execs.forEach(e => { if (!byId.has(e.id)) byId.set(e.id, e); });
  return [...byId.values()].sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
}

// ── Cash balance from the Flex report ───────────────────────
// דורש שהשאילתה ב-IBKR תכלול את סעיף "Cash Report" (מועדף) או
// "Change in NAV / Equity Summary". אם אף אחד מהם לא בדוח — אין מזומן, ולא נוגעים בערך הידני.
function ibkrExtractCash(doc) {
  const byAccount = {};

  // Cash Report: שורת BASE_SUMMARY לכל חשבון (סיכום בכל המטבעות במטבע הבסיס)
  const rows = [...doc.querySelectorAll('CashReportCurrency')];
  const base = rows.filter(r => (r.getAttribute('currency') || '').toUpperCase() === 'BASE_SUMMARY');
  (base.length ? base : rows.filter(r => (r.getAttribute('currency') || '').toUpperCase() === 'USD'))
    .forEach(r => {
      const acc = r.getAttribute('accountId') || r.getAttribute('acctAlias') || '';
      const v   = parseFloat(r.getAttribute('endingCash') ?? r.getAttribute('endingSettledCash') ?? 'NaN');
      if (!isNaN(v)) byAccount[acc] = v;
    });

  // Fallback: Equity Summary — השורה העדכנית ביותר לכל חשבון
  if (!Object.keys(byAccount).length) {
    const latest = {};
    doc.querySelectorAll('EquitySummaryByReportDateInBase').forEach(n => {
      const acc = n.getAttribute('accountId') || '';
      const d   = n.getAttribute('reportDate') || '';
      const v   = parseFloat(n.getAttribute('cash') ?? 'NaN');
      if (isNaN(v)) return;
      if (!latest[acc] || d >= latest[acc].d) latest[acc] = { d, v };
    });
    Object.entries(latest).forEach(([acc, o]) => { byAccount[acc] = o.v; });
  }

  if (!Object.keys(byAccount).length) return null;
  const total = Object.values(byAccount).reduce((s, v) => s + v, 0);
  return { byAccount, total: +total.toFixed(2), ts: Date.now() };
}

function ibkrGetCash() {
  try { return JSON.parse(localStorage.getItem(IBKR_CASH_KEY) || 'null'); }
  catch { return null; }
}

// גיל נתון המזומן האחרון שנמשך בהצלחה — לשקיפות כשסנכרון נכשל
function ibkrCashAgeTxt() {
  const d = ibkrLastCash || ibkrGetCash();
  return d?.ts ? ibkrTimeAgo(d.ts) : '';
}
function ibkrCashIsStale() {
  const d = ibkrLastCash || ibkrGetCash();
  return !!d?.ts && (Date.now() - d.ts > 24 * 3600 * 1000);
}

// המזומן של יעד ('trades' | 'port'), לפי סדר עדיפות:
// בחירה מפורשת בהגדרות → חשבונות שמשויכים ליעד → חשבון יחיד בדוח →
// שני חשבונות שרק אחד מהם משויך (השני שייך ליעד השני מכללא) → null (צריך לבחור)
function ibkrCashFor(dest) {
  const data = ibkrLastCash || ibkrGetCash();
  if (!data || !data.byAccount) return null;
  const cfg = ibkrGetCfg();
  const chosen = (cfg.cashAccounts || {})[dest];
  if (chosen) return chosen in data.byAccount ? +data.byAccount[chosen].toFixed(2) : null;
  const destMap = cfg.accountDest || {};
  const accs = Object.keys(destMap).filter(a => destMap[a] === dest && a in data.byAccount);
  if (accs.length) return +accs.reduce((s, a) => s + data.byAccount[a], 0).toFixed(2);
  const all = Object.keys(data.byAccount);
  if (all.length === 1) return +data.byAccount[all[0]].toFixed(2);
  if (all.length === 2) {
    const other = dest === 'trades' ? 'port' : 'trades';
    const otherAccs = all.filter(a => destMap[a] === other || (cfg.cashAccounts || {})[other] === a);
    if (otherAccs.length === 1) return +data.byAccount[all.find(a => a !== otherAccs[0])].toFixed(2);
  }
  return null;
}

// יש נתוני מזומן מכמה חשבונות אבל אי אפשר להכריע לאיזה תיק — חסר שיוך בהגדרות
function ibkrCashUnmapped(dest) {
  const data = ibkrLastCash || ibkrGetCash();
  if (!data || !data.byAccount || Object.keys(data.byAccount).length < 2) return false;
  return ibkrCashFor(dest) === null;
}

// החשבון שממנו נלקח בפועל המזומן של היעד (לתצוגה בהגדרות) — '' אם לא הוכרע
function ibkrCashAccountOf(dest) {
  const data = ibkrLastCash || ibkrGetCash();
  if (!data || !data.byAccount) return '';
  const cfg = ibkrGetCfg();
  const chosen = (cfg.cashAccounts || {})[dest];
  if (chosen) return chosen in data.byAccount ? chosen : '';
  const destMap = cfg.accountDest || {};
  const accs = Object.keys(destMap).filter(a => destMap[a] === dest && a in data.byAccount);
  if (accs.length) return accs.join(' + ');
  const all = Object.keys(data.byAccount);
  if (all.length === 1) return all[0];
  if (all.length === 2) {
    const other = dest === 'trades' ? 'port' : 'trades';
    const otherAccs = all.filter(a => destMap[a] === other || (cfg.cashAccounts || {})[other] === a);
    if (otherAccs.length === 1) return all.find(a => a !== otherAccs[0]);
  }
  return '';
}

// שמירת המזומן + עדכון התצוגות. מזומן ה"תיק" נשמר גם ב-SK.investCash (לענן).
function ibkrApplyCash() {
  if (ibkrLastCash) sv(IBKR_CASH_KEY, ibkrLastCash);
  const data = ibkrLastCash || ibkrGetCash();
  if (!data) return;

  const portCash = ibkrCashFor('port');
  if (portCash !== null) {
    const current = parseFloat(localStorage.getItem(SK.investCash)) || 0;
    if (Math.abs(current - portCash) > 0.005) _pushSetting(SK.investCash, portCash);
  }

  // כמה חשבונות ואין שיוך — מבקשים מהמשתמש לשייך בהגדרות
  if ((portCash === null || ibkrCashFor('trades') === null) && Object.keys(data.byAccount).length > 1)
    toast('⚠ יש כמה חשבונות IBKR — שייך בהגדרות כל חשבון לתיק (מסחר / השקעות)');

  ibkrRefreshCashViews();
}

function ibkrRefreshCashViews() {
  const active = id => document.getElementById(id)?.classList.contains('active');
  try {
    if (active('page-portfolio') && typeof loadPortfolio === 'function') loadPortfolio();
    if (active('page-live')      && typeof loadLive      === 'function') loadLive();
    if (active('page-closed')    && typeof renderStats   === 'function') renderStats();
  } catch {}
}

// '20260708' / '20260708;093015' / '2026-07-08' → '2026-07-08'
function ibkrFmtDate(s) {
  s = String(s || '').split(';')[0].trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  return s || today();
}

// ── Building proposals ──────────────────────────────────────
// כל ביצוע מנותב ליעד: 'trades' (יומן מסחר) או 'port' (תיק השקעות).
// סדר קביעת היעד: עקיפה ידנית מהשורה → מיפוי חשבון מההגדרות → היוריסטיקה
// (מכירה/קנייה בטיקר שמוחזק בתיק ההשקעות ואין לו עסקה פתוחה ביומן → תיק).
// בנוסף: ביצוע שתואם עסקה ידנית קיימת (טיקר+תאריך+כמות) אבל במחיר/עמלה
// שונים → הצעת "עדכון" שמיישרת את הנתונים לברוקר בלי לגעת בשדות ידניים.
function ibkrBuildProposals(execs) {
  const seen = ibkrGetSeen();
  const autoSeen = [];
  // עותקי עבודה כדי לדמות ביצוע עוקב (מימוש ראשון משפיע על הנותרת של הבא)
  const workTrades = JSON.parse(JSON.stringify(trades));
  const workPort   = JSON.parse(JSON.stringify(portfolio));
  const proposals  = [];
  const cfg  = ibkrGetCfg();
  const near = (a, b, tol = 0.005) => Math.abs((a || 0) - (b || 0)) <= tol;
  const isManual = t => !String(t.id).startsWith('ibkr_');

  function closeLogic(ex, t) {
    const rem   = t.remainingQty ?? t.qty;
    const qty   = Math.min(ex.qty, rem);
    const gross = t.dir === 'Long' ? (ex.price - t.entry) * qty : (t.entry - ex.price) * qty;
    const pnl   = +(gross - ex.fee).toFixed(2);
    const full  = qty >= rem;
    t.remainingQty = rem - qty;
    if (full) t.status = 'closed';
    proposals.push({ kind: full ? 'close' : 'partial', dest: 'trades', exec: ex, tradeId: t.id, qty, pnl, checked: true });
  }

  function newTradeProp(ex, dir) {
    workTrades.unshift({ id: 'ibkr_' + ex.id, ticker: ex.ticker, dir, status: 'open',
                         entry: ex.price, qty: ex.qty, remainingQty: ex.qty });
    proposals.push({ kind: 'new', dest: 'trades', dir, exec: ex, checked: true });
  }

  // explicit=true: המשתמש/מיפוי החשבון קבעו יומן — בלי ניתוב אוטומטי לתיק
  function tradesLogic(ex, explicit) {
    if (ex.side === 'BUY') {
      // יישור עסקה ידנית קיימת לנתוני הברוקר (אותם טיקר+תאריך+כמות)
      const m = workTrades.find(t => isManual(t) && t.ticker === ex.ticker && t.dir === 'Long' &&
                                     t.date === ex.date && (t.qty || 0) === ex.qty);
      if (m) {
        if (near(m.entry, ex.price) && near(m.fee, ex.fee)) { autoSeen.push(ex.id); return; }
        proposals.push({ kind: 'update', dest: 'trades', exec: ex, tradeId: m.id, old: m.entry, checked: true });
        m.entry = ex.price; m.fee = ex.fee;
        return;
      }
      const shortT = workTrades.find(t => t.ticker === ex.ticker && t.status === 'open' && t.dir === 'Short');
      if (shortT) return closeLogic(ex, shortT);
      if (!explicit && workPort.some(h => h.ticker === ex.ticker)) return portLogic(ex);
      newTradeProp(ex, 'Long');
    } else {
      const longT = workTrades.find(t => t.ticker === ex.ticker && t.status === 'open' && t.dir === 'Long');
      if (longT) return closeLogic(ex, longT);
      // יישור מחיר יציאה של עסקה סגורה קיימת
      const m = workTrades.find(t => isManual(t) && t.ticker === ex.ticker && t.status === 'closed' &&
                                     (t.qty || 0) === ex.qty && t.exit != null && t.date <= ex.date);
      if (m) {
        if (near(m.exit, ex.price)) { autoSeen.push(ex.id); return; }
        proposals.push({ kind: 'update-exit', dest: 'trades', exec: ex, tradeId: m.id, old: m.exit, checked: true });
        m.exit = ex.price;
        return;
      }
      if (!explicit) {
        const h = workPort.find(x => x.ticker === ex.ticker && (x.remainingQty ?? x.qty) > 0);
        if (h) return portLogic(ex);
      }
      newTradeProp(ex, 'Short');
    }
  }

  function portLogic(ex) {
    if (ex.side === 'BUY') {
      const h = workPort.find(x => x.ticker === ex.ticker);
      if (h) {
        if (h.date === ex.date && (h.qty || 0) === ex.qty && near(h.avgCost, ex.price)) { autoSeen.push(ex.id); return; }
        const oldQty = h.qty || 0;
        const newAvg = +(((h.avgCost * oldQty) + ex.price * ex.qty) / (oldQty + ex.qty)).toFixed(4);
        proposals.push({ kind: 'port-add', dest: 'port', exec: ex, holdingId: h.id, oldAvg: h.avgCost, newAvg, checked: true });
        h.qty = oldQty + ex.qty;
        h.remainingQty = (h.remainingQty ?? oldQty) + ex.qty;
        h.avgCost = newAvg;
      } else {
        workPort.unshift({ id: 'ibkr_' + ex.id, ticker: ex.ticker, qty: ex.qty, avgCost: ex.price, remainingQty: ex.qty });
        proposals.push({ kind: 'port-new', dest: 'port', exec: ex, checked: true });
      }
    } else {
      const h = workPort.find(x => x.ticker === ex.ticker && (x.remainingQty ?? x.qty) > 0);
      if (!h) return newTradeProp(ex, 'Short'); // אין אחזקה למכור ממנה — שורט ביומן
      const rem = h.remainingQty ?? h.qty;
      const qty = Math.min(ex.qty, rem);
      const pnl = +(((ex.price - h.avgCost) * qty)).toFixed(2);
      proposals.push({ kind: 'port-sell', dest: 'port', exec: ex, holdingId: h.id, qty, pnl, full: qty >= rem, checked: true });
      h.remainingQty = rem - qty;
    }
  }

  // ביצוע שכבר יושם בפועל (גם אחרי "הצג מחדש") — לא מציעים שוב
  function alreadyApplied(ex) {
    const key = 'ibkr_' + ex.id;
    return trades.some(t => t.id === key || (t.realizations || []).some(r => r.execId === ex.id)) ||
           portfolio.some(h => h.id === key || (h.sales || []).some(s => s.execId === ex.id));
  }

  execs.forEach(ex => {
    if (seen.has(ex.id)) return;
    if (alreadyApplied(ex)) { autoSeen.push(ex.id); return; }
    const d = ibkrDestOverride[ex.id] || (cfg.accountDest || {})[ex.account] || '';
    if (d === 'port') portLogic(ex);
    else tradesLogic(ex, d === 'trades');
  });

  if (autoSeen.length) { autoSeen.forEach(id => seen.add(id)); ibkrSaveSeen(seen); }
  return proposals;
}

// שמירת רשימת החשבונות שהתגלו בדוח (עסקאות + מזומן) — למיפוי בהגדרות
function ibkrRememberAccounts(execs) {
  const cfg = ibkrGetCfg();
  const found = [...new Set(execs.map(e => e.account).filter(Boolean))];
  if (ibkrLastCash) found.push(...Object.keys(ibkrLastCash.byAccount));
  const known = new Set(cfg.accounts || []);
  const merged = [...new Set([...known, ...found])];
  if (merged.length !== known.size) { cfg.accounts = merged; ibkrSaveCfg(cfg); }
}

// ── Banner ──────────────────────────────────────────────────
function ibkrShowBanner() {
  const el = document.getElementById('ibkr-banner');
  if (!el) return;
  document.getElementById('ibkr-banner-txt').textContent =
    ibkrProposals.length === 1 ? 'נמצאה עסקה חדשה מ-IBKR' : `נמצאו ${ibkrProposals.length} עסקאות חדשות מ-IBKR`;
  el.classList.add('show');
}
function ibkrHideBanner() { document.getElementById('ibkr-banner')?.classList.remove('show'); }

function ibkrIgnoreAll() {
  const seen = ibkrGetSeen();
  ibkrProposals.forEach(p => seen.add(p.exec.id));
  ibkrSaveSeen(seen);
  ibkrProposals = [];
  ibkrHideBanner();
  ibkrSetChip('ok', 'מסונכרן • עכשיו');
  toast('העסקאות סומנו כ"התעלם" — לא יוצעו שוב');
}

// ── Preview modal ───────────────────────────────────────────
const IBKR_KIND_LBL = {
  'new':         'עסקה חדשה',
  'close':       'סגירה',
  'partial':     'מימוש חלקי',
  'update':      'עדכון כניסה',
  'update-exit': 'עדכון יציאה',
  'port-new':    'אחזקה חדשה',
  'port-add':    'הוספה לאחזקה',
  'port-sell':   'מימוש מאחזקה',
};

function ibkrOpenPreview() {
  const box = document.getElementById('ibkr-preview-list');
  if (!box) return;
  box.innerHTML = ibkrProposals.map((p, i) => {
    const ex = p.exec;
    const qty = p.qty ?? ex.qty;
    const green = 'var(--green-t,#4ade80)', red = 'var(--red-t,#f87171)';
    const logo = (typeof stockLogoImg === 'function') ? stockLogoImg(ex.ticker, 30) : '';

    let dirTxt, sideCell;
    if (p.kind === 'new') {
      dirTxt = p.dir === 'Long' ? 'קנייה — Long' : 'מכירה בחסר — Short';
      sideCell = `<div class="ibkr-prop-qty">${qty} × $${ex.price}</div>
        <div class="ibkr-prop-pnl" style="color:${p.dir === 'Long' ? green : red}">${p.dir === 'Long' ? '▲ LONG' : '▼ SHORT'}</div>`;
    } else if (p.kind === 'update' || p.kind === 'update-exit') {
      dirTxt = 'יישור לנתוני הברוקר';
      sideCell = `<div class="ibkr-prop-qty">$${p.old} ← $${ex.price}</div>
        <div class="ibkr-prop-pnl" style="color:var(--tx3)">${qty} יח'</div>`;
    } else if (p.kind === 'port-new') {
      dirTxt = 'קנייה לתיק ההשקעות';
      sideCell = `<div class="ibkr-prop-qty">${qty} × $${ex.price}</div>
        <div class="ibkr-prop-pnl" style="color:${green}">▲ LONG</div>`;
    } else if (p.kind === 'port-add') {
      dirTxt = 'הגדלת פוזיציה';
      sideCell = `<div class="ibkr-prop-qty">${qty} × $${ex.price}</div>
        <div class="ibkr-prop-pnl" style="color:var(--tx3)">ממוצע: $${(+p.newAvg).toFixed(2)}</div>`;
    } else {   // close / partial / port-sell
      dirTxt = ex.side === 'SELL' ? 'מכירה' : 'כיסוי שורט';
      sideCell = `<div class="ibkr-prop-qty">${qty} × $${ex.price}</div>
        <div class="ibkr-prop-pnl" style="color:${p.pnl >= 0 ? green : red}">${p.pnl >= 0 ? '+' : '-'}$${Math.abs(p.pnl).toFixed(2)}</div>`;
    }

    const acct = ex.account ? `<span class="ibkr-prop-acct">${ex.account}</span>` : '';
    const destToggle = `<span class="ibkr-dest-toggle" onclick="event.stopPropagation()">
        <button class="${p.dest === 'trades' ? 'on' : ''}" onclick="ibkrSetDest('${ex.id}','trades')">יומן</button>
        <button class="${p.dest === 'port' ? 'on' : ''}" onclick="ibkrSetDest('${ex.id}','port')">תיק</button>
      </span>`;

    return `<div class="ibkr-prop-row" onclick="ibkrRowToggle(event, ${i})">
      <input type="checkbox" id="ibkr-p-${i}" ${p.checked ? 'checked' : ''} onchange="ibkrProposals[${i}].checked=this.checked;ibkrUpdateFoot()">
      ${logo}
      <div class="ibkr-prop-main">
        <div class="ibkr-prop-line1">
          <span class="ibkr-prop-ticker">${ex.ticker}</span>
          <span class="ibkr-prop-kind ibkr-kind-${p.kind}">${IBKR_KIND_LBL[p.kind]}</span>
          <span class="ibkr-prop-dirtxt" style="font-size:11px;color:var(--tx2)">${dirTxt}</span>
        </div>
        <div class="ibkr-prop-meta ibkr-meta-desktop">${ex.account ? ex.account + ' · ' : ''}${ex.date}${ex.fee ? ' · fee $' + ex.fee.toFixed(2) : ''}${ex.currency !== 'USD' ? ' · ' + ex.currency : ''}</div>
      </div>
      ${destToggle}
      <div class="ibkr-prop-side">${sideCell}<div class="ibkr-prop-meta ibkr-meta-mobile">${ex.date}</div></div>
    </div>`;
  }).join('');
  ibkrUpdateFoot();
  document.getElementById('ibkr-preview-overlay').classList.add('open');
}

// שינוי יעד לשורה — בנייה מחדש של כל ההצעות (כדי שהרצף יישאר עקבי)
function ibkrSetDest(execId, dest) {
  ibkrDestOverride[execId] = dest;
  const checkedState = {};
  ibkrProposals.forEach(p => checkedState[p.exec.id] = p.checked);
  ibkrProposals = ibkrBuildProposals(ibkrLastExecs);
  ibkrProposals.forEach(p => { if (p.exec.id in checkedState && p.exec.id !== execId) p.checked = checkedState[p.exec.id]; });
  ibkrOpenPreview();
}
function ibkrClosePreview() { document.getElementById('ibkr-preview-overlay').classList.remove('open'); }

function ibkrRowToggle(e, i) {
  if (e.target.tagName === 'INPUT') return; // הקליק היה על הצ'קבוקס עצמו
  const cb = document.getElementById('ibkr-p-' + i);
  if (!cb) return;
  cb.checked = !cb.checked;
  ibkrProposals[i].checked = cb.checked;
  ibkrUpdateFoot();
}
function ibkrToggleAll() {
  const allChecked = ibkrProposals.every(p => p.checked);
  ibkrProposals.forEach((p, i) => {
    p.checked = !allChecked;
    const cb = document.getElementById('ibkr-p-' + i);
    if (cb) cb.checked = !allChecked;
  });
  ibkrUpdateFoot();
}
function ibkrUpdateFoot() {
  const n = ibkrProposals.filter(p => p.checked).length;
  const count = document.getElementById('ibkr-preview-count');
  if (count) count.textContent = ibkrProposals.length + ' עסקאות';
  const btn = document.getElementById('ibkr-apply-btn');
  if (btn) {
    btn.innerHTML = `<i class="ti ti-check" style="font-size:12px"></i> הוסף ליומן${n ? ' (' + n + ')' : ''}`;
    btn.disabled = n === 0;
    btn.style.opacity = n === 0 ? '0.5' : '';
  }
  const sa = document.getElementById('ibkr-select-all');
  if (sa) sa.textContent = ibkrProposals.every(p => p.checked) ? 'בטל בחירת הכל' : 'בחר הכל';
}

// ── Apply approved proposals ────────────────────────────────
// ממלא שדות אובייקטיביים בלבד. הערות/סיבה/תרחיש/יעדים לא נגעים לעולם.
function ibkrApply() {
  const seen = ibkrGetSeen();
  let added = 0, closed = 0, realized = 0, updated = 0, portChanged = 0;
  let tradesDirty = false, portDirty = false;

  ibkrProposals.forEach(p => {
    if (!p.checked) return;
    const ex = p.exec;

    if (p.kind === 'new') {
      trades.unshift({
        id: 'ibkr_' + ex.id, ticker: ex.ticker, date: ex.date, dir: p.dir, status: 'open',
        entry: ex.price, exit: null, qty: ex.qty, fee: ex.fee, pnl: null,
        grade: '1', reason: '', scenario: '', sl: null,
        targets: [], realizations: [], remainingQty: ex.qty, source: 'ibkr',
      });
      added++; tradesDirty = true;

    } else if (p.kind === 'close' || p.kind === 'partial') {
      const t = trades.find(x => x.id === p.tradeId);
      if (t) {
        const rem = t.remainingQty ?? t.qty;
        const qty = Math.min(p.qty, rem);
        if (!t.realizations) t.realizations = [];
        t.realizations.push({ date: ex.date, price: ex.price, qty, pnl: p.pnl, source: 'ibkr', execId: ex.id });
        t.remainingQty = rem - qty;
        if (t.remainingQty <= 0) {
          t.status = 'closed';
          t.exit   = ex.price;
          t.pnl    = +t.realizations.reduce((s, r) => s + r.pnl, 0).toFixed(2);
          closed++;
        } else realized++;
        tradesDirty = true;
      }

    } else if (p.kind === 'update') {
      // יישור כניסה: מחיר ועמלה בלבד — שדות ידניים לא נגעים
      const t = trades.find(x => x.id === p.tradeId);
      if (t) {
        t.entry = ex.price;
        t.fee   = ex.fee;
        if (t.status === 'closed' && t.exit != null)
          t.pnl = +((t.dir === 'Long' ? (t.exit - t.entry) : (t.entry - t.exit)) * t.qty - t.fee).toFixed(2);
        updated++; tradesDirty = true;
      }

    } else if (p.kind === 'update-exit') {
      const t = trades.find(x => x.id === p.tradeId);
      if (t) {
        t.exit = ex.price;
        t.fee  = +(((t.fee || 0) + ex.fee)).toFixed(2);
        t.pnl  = +((t.dir === 'Long' ? (t.exit - t.entry) : (t.entry - t.exit)) * t.qty - t.fee).toFixed(2);
        updated++; tradesDirty = true;
      }

    } else if (p.kind === 'port-new') {
      portfolio.unshift({
        id: 'ibkr_' + ex.id, ticker: ex.ticker, qty: ex.qty, avgCost: ex.price,
        date: ex.date, sector: '', notes: '', sales: [], remainingQty: ex.qty, source: 'ibkr',
      });
      portChanged++; portDirty = true;

    } else if (p.kind === 'port-add') {
      const h = portfolio.find(x => x.id === p.holdingId);
      if (h) {
        const oldQty = h.qty || 0;
        h.avgCost = +(((h.avgCost * oldQty) + ex.price * ex.qty) / (oldQty + ex.qty)).toFixed(4);
        h.qty = oldQty + ex.qty;
        h.remainingQty = (h.remainingQty ?? oldQty) + ex.qty;
        portChanged++; portDirty = true;
      }

    } else if (p.kind === 'port-sell') {
      const idx = portfolio.findIndex(x => x.id === p.holdingId);
      if (idx !== -1) {
        const h = portfolio[idx];
        const rem = h.remainingQty ?? h.qty;
        const qty = Math.min(p.qty, rem);
        if (!h.sales) h.sales = [];
        h.sales.push({ date: ex.date, price: ex.price, qty, pnl: p.pnl, source: 'ibkr', execId: ex.id });
        h.remainingQty = rem - qty;
        if (h.remainingQty <= 0) portfolio.splice(idx, 1);   // כמו מכירה ידנית מלאה
        portChanged++; portDirty = true;
      }
    }
    seen.add(ex.id);
  });

  // גם מה שלא סומן — נחשב "טופל" ולא יוצע שוב
  ibkrProposals.forEach(p => seen.add(p.exec.id));
  ibkrSaveSeen(seen);
  ibkrProposals = [];
  ibkrDestOverride = {};

  if (tradesDirty) sv(SK.trades, trades);
  if (portDirty)   sv(SK.port, portfolio);
  ibkrClosePreview();
  ibkrHideBanner();
  ibkrSetChip('ok', 'מסונכרן • עכשיו');

  const parts = [];
  if (added)       parts.push(`${added} נוספו`);
  if (closed)      parts.push(`${closed} נסגרו`);
  if (realized)    parts.push(`${realized} מימושים`);
  if (updated)     parts.push(`${updated} עודכנו`);
  if (portChanged) parts.push(`${portChanged} בתיק`);
  toast(parts.length ? '✓ IBKR: ' + parts.join(', ') : 'לא נבחרו עסקאות');

  if (typeof loadLive === 'function') loadLive();
  if (typeof renderClosedTable === 'function') try { renderClosedTable(); } catch {}
  if (portDirty && typeof loadPortfolio === 'function') try { loadPortfolio(); } catch {}
}

// ── Manual file import (Flex XML שהורד ידנית מהפורטל) ──────
function ibkrHandleFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text = String(e.target.result || '');
      ibkrLastRaw = text;
      if (ibkrGetCfg().debug) { console.log('[ibkr] raw file ↓↓↓'); console.log(text); ibkrFillDebugPanel(); }
      const execs = ibkrParseFlex(text);
      ibkrApplyCash();
      if (!execs.length) { toast(ibkrLastCash ? '✓ המזומן עודכן — אין עסקאות בקובץ' : '⚠ לא נמצאו עסקאות בקובץ'); return; }
      ibkrLastExecs = execs;
      ibkrDestOverride = {};
      ibkrRememberAccounts(execs);
      ibkrProposals = ibkrBuildProposals(execs);
      if (!ibkrProposals.length) { toast('אין עסקאות חדשות — הכל כבר ביומן'); return; }
      closeSettings();
      ibkrOpenPreview();
    } catch (err) {
      console.warn('[ibkr] file import failed', err);
      alert('שגיאה בקריאת הקובץ:\n' + (err.message || err));
    }
  };
  reader.readAsText(file);
  input.value = '';
}

// ── Settings UI ─────────────────────────────────────────────
function ibkrFillSettings() {
  const c = ibkrGetCfg();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('ibkr-token', c.token);
  set('ibkr-query', c.queryId);
  set('ibkr-proxy', c.proxyUrl);
  const dbg = document.getElementById('ibkr-debug');
  if (dbg) dbg.checked = !!c.debug;
  const proxyEl = document.getElementById('ibkr-proxy');
  if (proxyEl && !c.proxyUrl) proxyEl.placeholder = ibkrProxyUrl() || 'https://xxxx.supabase.co/functions/v1/ibkr-flex';
  ibkrRenderAccountMap();
  ibkrFillDebugPanel();
}

// שיוך חשבונות: כל חשבון IBKR משויך לתיק — מסחר או השקעות.
// השיוך קובע גם לאן מנותבות עסקאות וגם מאיזה חשבון נלקח המזומן של כל תיק.
function ibkrRenderAccountMap() {
  const wrap = document.getElementById('ibkr-accounts');
  if (!wrap) return;
  const cfg = ibkrGetCfg();
  const accounts = cfg.accounts || [];
  if (!accounts.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  const dest = cfg.accountDest || {};

  // שורת סטטוס: מאיפה נלקח בפועל המזומן של כל תיק כרגע
  const cashData = ibkrLastCash || ibkrGetCash();
  const fmtUsd = v => '$' + Math.round(v).toLocaleString('en');
  const statusLine = d => {
    const cash = ibkrCashFor(d);
    const acc  = ibkrCashAccountOf(d);
    const lbl  = d === 'trades' ? 'מזומן תיק מסחר' : 'מזומן תיק השקעות';
    if (cash !== null) return `<span style="color:var(--tx2)">${lbl}: <b>${fmtUsd(cash)}</b>${acc ? ` <span style="font-family:var(--font-mono);direction:ltr;unicode-bidi:embed">(${acc})</span>` : ''}</span>`;
    return `<span style="color:var(--amber-t)">${lbl}: לא משויך — בחר חשבון למעלה</span>`;
  };

  wrap.innerHTML =
    '<div style="font-size:10.5px;color:var(--tx3);margin-bottom:5px">שיוך חשבונות — איזה חשבון שייך לכל תיק (קובע ניתוב עסקאות ומזומן):</div>' +
    accounts.map(acc => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
        <span style="font-size:11px;font-family:var(--font-mono);direction:ltr;flex:1">${acc}</span>
        <select class="settings-input" style="width:150px;font-size:11px;padding:4px 8px" onchange="ibkrSetAccountDest('${acc}', this.value)">
          <option value=""       ${!dest[acc] ? 'selected' : ''}>זיהוי אוטומטי</option>
          <option value="trades" ${dest[acc] === 'trades' ? 'selected' : ''}>תיק מסחר (יומן)</option>
          <option value="port"   ${dest[acc] === 'port' ? 'selected' : ''}>תיק השקעות</option>
        </select>
      </div>`).join('') +
    (cashData ? `<div style="font-size:10.5px;display:flex;flex-direction:column;gap:3px;margin-top:8px;padding-top:7px;border-top:0.5px solid var(--br)">${statusLine('trades')}${statusLine('port')}</div>` : '');
}
function ibkrSetAccountDest(acc, dest) {
  const cfg = ibkrGetCfg();
  if (!cfg.accountDest) cfg.accountDest = {};
  if (dest) cfg.accountDest[acc] = dest; else delete cfg.accountDest[acc];
  delete cfg.cashAccounts;   // השיוך הידני החדש הוא מקור האמת — מבטל עקיפות מזומן ישנות
  ibkrSaveCfg(cfg);
  toast('✓ שיוך חשבון ' + acc + ' נשמר');
  ibkrApplyCash();           // עדכון מיידי של שווי התיקים לפי השיוך
  ibkrRenderAccountMap();    // רענון שורת הסטטוס בהגדרות
}
function ibkrSaveSettings() {
  const val = id => (document.getElementById(id)?.value || '').trim();
  const cfg = ibkrGetCfg();
  cfg.token    = val('ibkr-token');
  cfg.queryId  = val('ibkr-query');
  cfg.proxyUrl = val('ibkr-proxy');
  cfg.debug    = !!document.getElementById('ibkr-debug')?.checked;
  ibkrSaveCfg(cfg);
  const fb = document.getElementById('ibkr-saved');
  if (fb) { fb.classList.add('show'); setTimeout(() => fb.classList.remove('show'), 1800); }
  toast('✓ הגדרות IBKR נשמרו');
}
function ibkrSyncNow() {
  localStorage.removeItem(IBKR_LAST_KEY); // עוקף מצערת בסנכרון ידני
  closeSettings();
  ibkrSync();
}

// "הצג עסקאות מחדש" — מאפס את רשימת ה"טופלו" כך שעסקאות שנדחו/לא סומנו יוצעו שוב.
// עסקאות שכבר נוספו בפועל מזוהות לפי execId ולא משוכפלות.
async function ibkrResetSeen() {
  if (!confirm('להציג מחדש את העסקאות מ-IBKR?\n\nעסקאות שנדחו או לא סומנו יוצעו שוב לאישור. עסקאות שכבר נוספו ליומן או לתיק לא ישוכפלו.')) return;
  localStorage.removeItem(IBKR_SEEN_KEY);
  localStorage.removeItem(IBKR_LAST_KEY);
  closeSettings();
  ibkrDestOverride = {};
  if (ibkrLastExecs.length) {
    ibkrProposals = ibkrBuildProposals(ibkrLastExecs);
  } else {
    await ibkrSync();          // אין דוח בזיכרון — מושכים מחדש (ibkrSync כבר בונה הצעות)
  }
  if (ibkrProposals.length) {
    ibkrSetChip('ok', `${ibkrProposals.length} חדשות`);
    ibkrShowBanner();
    ibkrOpenPreview();
  } else if (!ibkrLastError) {
    toast('אין עסקאות להצגה מחדש — הכל כבר ביומן');
  }
}
function ibkrFillDebugPanel() {
  const wrap = document.getElementById('ibkr-debug-wrap');
  const ta   = document.getElementById('ibkr-debug-raw');
  if (!wrap || !ta) return;
  const on = !!ibkrGetCfg().debug && !!ibkrLastRaw;
  wrap.style.display = on ? '' : 'none';
  if (on) ta.value = ibkrLastRaw;
}

// ── Startup wiring ──────────────────────────────────────────
// מילוי שדות ההגדרות בכל פתיחת מודל ההגדרות (עטיפה, בלי לגעת ב-app.js)
(function () {
  if (typeof openSettings === 'function') {
    const orig = openSettings;
    openSettings = function () { orig(); ibkrFillSettings(); };
  }
})();

// אחרי שה-init של האפליקציה סיים (כולל משיכת ענן): קודם מרעננים את התצוגות
// עם המזומן השמור מהמשיכה המוצלחת האחרונה — הרינדור הראשוני של app.js רץ
// לפני שהקובץ הזה נטען, בלי נתוני מזומן — ואז מסנכרנים.
// אם init כבר סיים (window.tjReady) האירוע כבר נורה — מריצים מיד.
function ibkrOnAppReady() {
  if (ibkrGetCash()) ibkrRefreshCashViews();
  setTimeout(ibkrAutoSync, 300);
}
if (window.tjReady) ibkrOnAppReady();
else window.addEventListener('tj-ready', ibkrOnAppReady);
// fallback אם האירוע לא נורה מסיבה כלשהי
setTimeout(() => { if (!document.getElementById('ibkr-chip')?.innerHTML) ibkrAutoSync(); }, 5000);
