// ═══════════════════════════════════════════════════════════
//  ibkr.js — סנכרון עסקאות מ-Interactive Brokers (Flex Web Service)
//  זרימה: פתיחת האתר → משיכת דוח Flex דרך proxy (Supabase Edge Function)
//  → פרסור → הצעות (עסקאות חדשות / סגירות / מימושים) → אישור המשתמש → שמירה.
//  אף פעם לא נשמר כלום בלי תצוגה מקדימה ואישור.
// ═══════════════════════════════════════════════════════════

const IBKR_CFG_KEY   = 'tj_ibkr_cfg_v1';    // {token, queryId, proxyUrl, debug}
const IBKR_SEEN_KEY  = 'tj_ibkr_seen_v1';   // מזהי עסקאות שכבר טופלו (נוספו או נדחו)
const IBKR_LAST_KEY  = 'tj_ibkr_lastsync';  // timestamp של סנכרון אחרון (מצערת)
const IBKR_THROTTLE_MS = 15 * 60 * 1000;    // סנכרון אוטומטי לכל היותר פעם ב-15 דק'
const IBKR_SEEN_CAP  = 3000;

let ibkrProposals = [];
let ibkrLastRaw   = '';
let ibkrLastError = '';

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
  return `לפני ${Math.round(h / 24)} ימים`;
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

async function ibkrSync() {
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
    ibkrLastError = e.message || String(e);
    ibkrSetChip('error', 'שגיאת סנכרון — לחץ לפרטים');
  }
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

// '20260708' / '20260708;093015' / '2026-07-08' → '2026-07-08'
function ibkrFmtDate(s) {
  s = String(s || '').split(';')[0].trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  return s || today();
}

// ── Building proposals ──────────────────────────────────────
// BUY  → אם יש שורט פתוח באותו טיקר: כיסוי (סגירה/מימוש). אחרת: עסקת לונג חדשה.
// SELL → אם יש לונג פתוח באותו טיקר: סגירה/מימוש. אחרת: עסקת שורט חדשה.
function ibkrBuildProposals(execs) {
  const seen = ibkrGetSeen();
  const autoSeen = [];
  // עותק עבודה כדי לדמות ביצוע עוקב (מימוש ראשון משפיע על הנותרת של הבא)
  const work = JSON.parse(JSON.stringify(trades));
  const proposals = [];

  execs.forEach(ex => {
    if (seen.has(ex.id)) return;

    const closeDir = ex.side === 'SELL' ? 'Long' : 'Short';
    const openTrade = work.find(t => t.ticker === ex.ticker && t.status === 'open' && t.dir === closeDir);

    if (openTrade) {
      const rem  = openTrade.remainingQty ?? openTrade.qty;
      const qty  = Math.min(ex.qty, rem);
      const gross = closeDir === 'Long' ? (ex.price - openTrade.entry) * qty : (openTrade.entry - ex.price) * qty;
      const pnl  = +(gross - ex.fee).toFixed(2);
      const full = qty >= rem;
      openTrade.remainingQty = rem - qty;
      if (full) openTrade.status = 'closed';
      proposals.push({ kind: full ? 'close' : 'partial', exec: ex, tradeId: openTrade.id, qty, pnl, checked: true });
      return;
    }

    // עסקה חדשה — קודם בדיקה שלא קיימת כבר ידנית ביומן (טיקר+תאריך+כמות+מחיר)
    const dir = ex.side === 'BUY' ? 'Long' : 'Short';
    const dup = trades.find(t => t.ticker === ex.ticker && t.date === ex.date &&
                Math.abs((t.qty || 0) - ex.qty) < 0.001 && Math.abs((t.entry || 0) - ex.price) < 0.01);
    if (dup) { autoSeen.push(ex.id); return; }

    work.unshift({ id: 'ibkr_' + ex.id, ticker: ex.ticker, dir, status: 'open',
                   entry: ex.price, qty: ex.qty, remainingQty: ex.qty });
    proposals.push({ kind: 'new', exec: ex, dir, checked: true });
  });

  if (autoSeen.length) { autoSeen.forEach(id => seen.add(id)); ibkrSaveSeen(seen); }
  return proposals;
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
function ibkrOpenPreview() {
  const box = document.getElementById('ibkr-preview-list');
  if (!box) return;
  const kindLbl = { new: 'עסקה חדשה', close: 'סגירה', partial: 'מימוש חלקי' };
  box.innerHTML = ibkrProposals.map((p, i) => {
    const ex = p.exec;
    const qty = p.qty ?? ex.qty;
    const dirTxt = p.kind === 'new'
      ? (p.dir === 'Long' ? 'קנייה — Long' : 'מכירה בחסר — Short')
      : (ex.side === 'SELL' ? 'מכירה' : 'כיסוי שורט');
    const logo = (typeof stockLogoImg === 'function') ? stockLogoImg(ex.ticker, 30) : '';
    const sideCell = p.kind === 'new'
      ? `<div class="ibkr-prop-qty">${qty} × $${ex.price}</div>
         <div class="ibkr-prop-pnl" style="color:${p.dir === 'Long' ? 'var(--green-t,#4ade80)' : 'var(--red-t,#f87171)'}">${p.dir === 'Long' ? '▲ LONG' : '▼ SHORT'}</div>`
      : `<div class="ibkr-prop-qty">${qty} × $${ex.price}</div>
         <div class="ibkr-prop-pnl" style="color:${p.pnl >= 0 ? 'var(--green-t,#4ade80)' : 'var(--red-t,#f87171)'}">${p.pnl >= 0 ? '+' : '-'}$${Math.abs(p.pnl).toFixed(2)}</div>`;
    return `<div class="ibkr-prop-row" onclick="ibkrRowToggle(event, ${i})">
      <input type="checkbox" id="ibkr-p-${i}" ${p.checked ? 'checked' : ''} onchange="ibkrProposals[${i}].checked=this.checked;ibkrUpdateFoot()">
      ${logo}
      <div class="ibkr-prop-main">
        <div class="ibkr-prop-line1">
          <span class="ibkr-prop-ticker">${ex.ticker}</span>
          <span class="ibkr-prop-kind ibkr-kind-${p.kind}">${kindLbl[p.kind]}</span>
          <span class="ibkr-prop-dirtxt" style="font-size:11px;color:var(--tx2)">${dirTxt}</span>
        </div>
        <div class="ibkr-prop-meta ibkr-meta-desktop">${ex.date}${ex.fee ? ' · fee $' + ex.fee.toFixed(2) : ''}${ex.currency !== 'USD' ? ' · ' + ex.currency : ''}</div>
      </div>
      <div class="ibkr-prop-side">${sideCell}<div class="ibkr-prop-meta ibkr-meta-mobile">${ex.date}</div></div>
    </div>`;
  }).join('');
  ibkrUpdateFoot();
  document.getElementById('ibkr-preview-overlay').classList.add('open');
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
  let added = 0, closed = 0, realized = 0;

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
      added++;
    } else {
      const t = trades.find(x => x.id === p.tradeId);
      if (t) {
        const rem = t.remainingQty ?? t.qty;
        const qty = Math.min(p.qty, rem);
        if (!t.realizations) t.realizations = [];
        t.realizations.push({ date: ex.date, price: ex.price, qty, pnl: p.pnl, source: 'ibkr' });
        t.remainingQty = rem - qty;
        if (t.remainingQty <= 0) {
          t.status = 'closed';
          t.exit   = ex.price;
          t.pnl    = +t.realizations.reduce((s, r) => s + r.pnl, 0).toFixed(2);
          closed++;
        } else realized++;
      }
    }
    seen.add(ex.id);
  });

  // גם מה שלא סומן — נחשב "טופל" ולא יוצע שוב
  ibkrProposals.forEach(p => seen.add(p.exec.id));
  ibkrSaveSeen(seen);
  ibkrProposals = [];

  sv(SK.trades, trades);
  ibkrClosePreview();
  ibkrHideBanner();
  ibkrSetChip('ok', 'מסונכרן • עכשיו');

  const parts = [];
  if (added)    parts.push(`${added} נוספו`);
  if (closed)   parts.push(`${closed} נסגרו`);
  if (realized) parts.push(`${realized} מימושים`);
  toast(parts.length ? '✓ IBKR: ' + parts.join(', ') : 'לא נבחרו עסקאות');

  if (typeof loadLive === 'function') loadLive();
  if (typeof renderClosedTable === 'function') try { renderClosedTable(); } catch {}
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
      if (!execs.length) { toast('⚠ לא נמצאו עסקאות בקובץ'); return; }
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
  ibkrFillDebugPanel();
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

// סנכרון אוטומטי אחרי שה-init של האפליקציה סיים (כולל משיכת ענן)
window.addEventListener('tj-ready', () => setTimeout(ibkrAutoSync, 300));
// fallback אם האירוע לא נורה מסיבה כלשהי
setTimeout(() => { if (!document.getElementById('ibkr-chip')?.innerHTML) ibkrAutoSync(); }, 5000);
