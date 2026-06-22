/*
  prep.js — הכנה ליום מסחר
  Grid of summary cards → click → full detail overlay
*/

const PREP_KEY = 'tj-prep';

function prepLoad() {
  try { return JSON.parse(localStorage.getItem(PREP_KEY) || '[]'); } catch { return []; }
}
function prepSave(data) {
  localStorage.setItem(PREP_KEY, JSON.stringify(data));
  if (typeof dbPush === 'function') dbPush(PREP_KEY, data);
}
function prepUID()      { return Math.random().toString(36).slice(2, 9); }

/* ── ADD / DELETE ── */
const PREP_CHECKLIST_DEF = [
  { key: 'fundamentals', label: 'ידיעה פונדמנטלית תומכת',  desc: 'חדשות / דוח כספי / אירוע מאקרו שתומכים בכיוון ההיפוך ומעניקים לו רוח גבית', required: true },
  { key: 'reversal',     label: 'נר היפוך ברור',            desc: 'נר שמאותת שינוי כיוון — שובר שפל קודם ונסגר גבוה / קרוב לפתיחה, ועדיף גם נר שבועי תומך', required: true },
  { key: 'riskReward',   label: 'יחס סיכון:סיכוי 1:5',      desc: 'העסקה חייבת להציע יחס של לפחות 1:5 — לא פחות', required: true },
  { key: 'fib',          label: 'רמת פיבונאצ\'י מובהקת',    desc: 'הנר נעצר/דחה רמת פיבו 38.2% / 50% / 61.8% מתוך תנועה משמעותית', required: false },
  { key: 'support',      label: 'רמת תמיכה אופקית',         desc: 'הנר מופיע על רמה שטוחה שנבדקה בעבר מספר פעמים ונבלמה — שפל כפול / "זיכרון" מחיר', required: false },
  { key: 'volume',       label: 'נפח מסחר גבוה',            desc: 'הנר מלווה בנפח חריג לעומת נרות קודמים — נוכחות שחקנים גדולים / סיום לחץ מוכרים', required: false },
  { key: 'marketSync',   label: 'סנכרון עם השוק הכללי',     desc: 'השוק הכללי תומך בכיוון — נמצא בתמיכה או מתחיל תיקון לכיוון הרצוי', required: false },
  { key: 'multiCandle',  label: 'ריבוי נרות באותו אזור',    desc: '3–4 נרות/ימים שמתעקשים להיסגר על אותה תמיכה — סימן מובהק לאיסוף לפני פריצה', required: false },
];

function prepEmptyChecklist() {
  const cl = {};
  PREP_CHECKLIST_DEF.forEach(i => cl[i.key] = false);
  return cl;
}

function prepAddTrade() {
  const data = prepLoad();
  const id = prepUID();
  data.unshift({
    id, ticker: '', grade: '1', gradeNote: '', qty: '', stop: '',
    targets: [{ id: prepUID(), target: '', sellQty: '', newStop: '' }],
    checklist: prepEmptyChecklist(),
    createdAt: Date.now()
  });
  prepSave(data);
  prepRender();
  prepOpenCard(id);
}

function prepDeleteTrade(id, e) {
  if (e) e.stopPropagation();
  if (!confirm('למחוק את התכנון?')) return;
  prepSave(prepLoad().filter(t => t.id !== id));
  prepRender();
}

/* ──────────────────────────────────────────
   GRID — summary cards (like watchlist)
────────────────────────────────────────── */
async function prepRender() {
  const data = prepLoad();
  const el = document.getElementById('prep-grid');
  if (!el) return;

  const addCard = `<div class="prep-add-card" onclick="prepAddTrade()">
    <i class="ti ti-plus"></i>
    <span>תכנון חדש</span>
  </div>`;

  if (data.length === 0) {
    el.innerHTML = `<div class="prep-grid-list">${addCard}<div class="empty-state" style="grid-column:1/-1">
        <i class="ti ti-calendar-event"></i>
        <p>אין תכנונים שמורים<br>לחץ "+ תכנון חדש" כדי להתחיל</p>
      </div></div>`;
    return;
  }

  const sorted = [...data].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  // Fetch live prices for all tickers
  const tickers = [...new Set(sorted.map(t => t.ticker).filter(Boolean))];
  let prices = {};
  try { if (typeof fetchPrices === 'function') prices = await fetchPrices(tickers); } catch(e){}
  const riskUnit = (typeof getRiskUnit === 'function') ? getRiskUnit() : 0;

  el.innerHTML = `<div class="prep-grid-list">${addCard}${
    sorted.map(t => {
      const ticker  = t.ticker || '—';
      const grade   = t.grade === '2' ? 'סיווג 2' : 'סיווג 1';
      const gradeClx= t.grade === '2' ? 'bs' : 'bl';
      const dateObj = t.createdAt ? new Date(t.createdAt) : null;
      const date    = dateObj ? dateObj.toLocaleDateString('he-IL', { weekday:'short', day:'numeric', month:'long', year:'numeric' }) : '';
      const targets = (t.targets || []).filter(x => x.target || x.sellQty || x.newStop);

      // Live price
      const q = prices[ticker];
      const priceHTML = q ? (() => {
        const priceFmt = q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `<div class="pc-price-row"><span class="pc-price">$${priceFmt}</span></div>`;
      })() : '';

      // Risk calculation
      const stopVal = parseFloat(t.stop);
      const qtyVal  = parseFloat(t.qty);
      let riskHTML  = '';
      if (stopVal > 0 && qtyVal > 0) {
        const riskDollar = (stopVal / 100) * qtyVal;
        const riskStr    = riskDollar.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const rUnits     = riskUnit > 0 ? (riskDollar / riskUnit).toFixed(1) + 'R' : '';
        riskHTML = `<div class="pc-risk-row">
          <i class="ti ti-alert-triangle" style="font-size:11px;color:var(--amber)"></i>
          <span class="pc-risk-label">סיכון:</span>
          <span class="pc-risk-val">$${riskStr}</span>
          ${rUnits ? `<span class="pc-risk-r">${rUnits}</span>` : ''}
        </div>`;
      }

      // Targets
      const tgtHTML = targets.length ? `
        <div class="pc-section-title"><i class="ti ti-target"></i>יעדי מימוש</div>
        <div class="pc-targets">
          ${targets.map((tgt, i) => `
            <div class="pc-target-row">
              <span class="target-badge ${['t1','t2','t3','t1','t2'][i]||'t1'}" style="font-size:9.5px;min-width:52px">יעד ${i+1}</span>
              ${tgt.target   ? `<span class="pc-stat"><span class="pc-stat-l">מחיר</span><span class="pc-stat-v mono">$${tgt.target}</span></span>` : ''}
              ${tgt.sellQty  ? `<span class="pc-stat"><span class="pc-stat-l">מכירה</span><span class="pc-stat-v mono">${tgt.sellQty}</span></span>` : ''}
              ${tgt.newStop  ? `<span class="pc-stat"><span class="pc-stat-l">SL חדש</span><span class="pc-stat-v mono red">$${tgt.newStop}</span></span>` : ''}
            </div>`).join('')}
        </div>` : '';

      // Checklist score for card
      const cl = t.checklist || {};
      const reqDef = PREP_CHECKLIST_DEF.filter(i => i.required);
      const optDef = PREP_CHECKLIST_DEF.filter(i => !i.required);
      const reqOk  = reqDef.every(i => cl[i.key]);
      const reqCnt = reqDef.filter(i => cl[i.key]).length;
      const optCnt = optDef.filter(i => cl[i.key]).length;
      const anyChecked = reqCnt + optCnt > 0;
      let clHTML = '';
      if (anyChecked) {
        const warnIcon = !reqOk ? `<i class="ti ti-alert-triangle" style="color:var(--red);font-size:11px"></i>` : `<i class="ti ti-circle-check" style="color:var(--green-t);font-size:11px"></i>`;
        clHTML = `<div class="pc-cl-score">
          ${warnIcon}
          <span style="color:${reqOk?'var(--green-t)':'var(--red)'}">חובה ${reqCnt}/3</span>
          <span style="color:var(--tx3)">·</span>
          <span style="color:${optCnt>=3?'var(--green-t)':optCnt>0?'var(--amber)':'var(--tx3)'}">רשות ${optCnt}/5</span>
        </div>`;
      }

      return `
        <div class="prep-card" onclick="prepOpenCard('${t.id}')">
          <button class="wl-card-del" onclick="prepDeleteTrade('${t.id}',event)" title="מחק">
            <i class="ti ti-trash"></i>
          </button>

          <div class="pc-header">
            <div>
              <div class="pc-ticker">${ticker}</div>
              ${date ? `<div class="pc-date"><i class="ti ti-calendar" style="font-size:10px"></i>${date}</div>` : ''}
            </div>
          </div>

          ${priceHTML}
          <span class="dbadge ${gradeClx}" style="margin-bottom:var(--space-3);display:inline-flex">${grade}</span>
          ${t.gradeNote ? `<div class="pc-note">${t.gradeNote}</div>` : ''}

          <div class="pc-stats">
            ${t.stop ? `<span class="pc-stat"><span class="pc-stat-l">סטופ</span><span class="pc-stat-v mono red">¢${t.stop}</span></span>` : ''}
            ${t.qty  ? `<span class="pc-stat"><span class="pc-stat-l">כמות</span><span class="pc-stat-v mono">${t.qty}</span></span>` : ''}
          </div>

          ${riskHTML}
          ${clHTML}
          ${tgtHTML}
        </div>`;
    }).join('')
  }</div>`;
}

/* ──────────────────────────────────────────
   DETAIL OVERLAY — full edit form
────────────────────────────────────────── */
let _prepOpenId = null;

function prepOpenCard(id) {
  const data = prepLoad();
  const t = data.find(t => t.id === id);
  if (!t) return;
  _prepOpenId = id;

  // Update header
  document.getElementById('prep-modal-ticker').textContent = t.ticker || 'תכנון חדש';
  const sub = document.getElementById('prep-modal-sub');
  sub.textContent = t.createdAt
    ? new Date(t.createdAt).toLocaleDateString('he-IL', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
    : '';

  // Render body
  document.getElementById('prep-modal-body').innerHTML = prepFormHTML(t);

  // Render targets
  prepRenderTargets(id, t.targets);

  document.getElementById('prep-overlay').classList.add('open');
}

function prepCloseCard() {
  document.getElementById('prep-overlay').classList.remove('open');
  _prepOpenId = null;
}

function prepFormHTML(t) {
  return `
    <!-- Core fields -->
    <div class="fa-section">
      <div class="fa-section-title"><i class="ti ti-pencil"></i>פרטי התכנון</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">

        <div class="fg">
          <label style="font-size:10px;color:var(--tx3);font-weight:600;letter-spacing:.08em;text-transform:uppercase">טיקר</label>
          <input id="pm-ticker" type="text" placeholder="NVDA"
            value="${esc(t.ticker)}"
            style="font-family:'IBM Plex Mono',monospace;text-transform:uppercase;font-weight:700;font-size:16px;letter-spacing:-.01em"
            oninput="this.value=this.value.toUpperCase();prepModalField('ticker',this.value)">
        </div>

        <div class="fg">
          <label style="font-size:10px;color:var(--tx3);font-weight:600;letter-spacing:.08em;text-transform:uppercase">כמות מניות</label>
          <input id="pm-qty" type="number" step="1" min="1" placeholder="0"
            value="${esc(t.qty)}"
            style="font-family:'IBM Plex Mono',monospace"
            oninput="prepModalField('qty',this.value)">
        </div>

        <div class="fg">
          <label style="font-size:10px;color:var(--tx3);font-weight:600;letter-spacing:.08em;text-transform:uppercase">סיווג</label>
          <select id="pm-grade" onchange="prepModalField('grade',this.value)">
            <option value="1" ${t.grade==='1'?'selected':''}>סיווג 1</option>
            <option value="2" ${t.grade==='2'?'selected':''}>סיווג 2</option>
          </select>
        </div>

        <div class="fg">
          <label style="font-size:10px;color:var(--tx3);font-weight:600;letter-spacing:.08em;text-transform:uppercase">סטופ לוס (¢)</label>
          <input id="pm-stop" type="number" step="0.01" min="0" placeholder="0.00"
            value="${esc(t.stop)}"
            style="font-family:'IBM Plex Mono',monospace;border-color:rgba(239,68,68,0.3)"
            oninput="prepModalField('stop',this.value)">
        </div>

        <div class="fg" style="grid-column:1/-1">
          <label style="font-size:10px;color:var(--tx3);font-weight:600;letter-spacing:.08em;text-transform:uppercase">פירוט / סטראטגיה</label>
          <input id="pm-note" type="text" placeholder="סיבה, סטראטגיה, הערות..."
            value="${esc(t.gradeNote)}"
            oninput="prepModalField('gradeNote',this.value)">
        </div>
      </div>
    </div>

    <!-- Targets -->
    <div class="fa-section">
      <div class="fa-section-title" style="justify-content:space-between">
        <span><i class="ti ti-target"></i>ניהול עסקה</span>
        <button class="add-target-btn" onclick="prepModalAddTarget()">
          <i class="ti ti-plus" style="font-size:11px"></i>הוסף יעד
        </button>
      </div>
      <div id="pm-targets"></div>
    </div>

    <!-- Checklist -->
    <div class="fa-section">
      <div class="fa-section-title"><i class="ti ti-checklist"></i>צ'קליסט כניסה לעסקה</div>
      <div id="pm-checklist">${prepChecklistHTML(t.checklist || {})}</div>
    </div>

    <!-- Save -->
    <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
      <button class="btn-p" onclick="prepModalSave()">
        <i class="ti ti-device-floppy" style="font-size:13px;margin-left:6px"></i>שמור תכנון
      </button>
      <span class="settings-saved" id="pm-saved">
        <i class="ti ti-check" style="font-size:11px"></i>נשמר!
      </span>
    </div>
  `;
}

/* ── MODAL FIELD UPDATE ── */
const _mt = {};
function prepModalField(field, value) {
  clearTimeout(_mt[field]);
  _mt[field] = setTimeout(() => {
    if (!_prepOpenId) return;
    const data = prepLoad();
    const t = data.find(t => t.id === _prepOpenId);
    if (!t) return;
    t[field] = value;
    prepSave(data);
    if (field === 'ticker') {
      document.getElementById('prep-modal-ticker').textContent = value || 'תכנון חדש';
    }
  }, 350);
}

/* ── MODAL SAVE (explicit) ── */
function prepModalSave() {
  if (!_prepOpenId) return;
  const data = prepLoad();
  const t = data.find(t => t.id === _prepOpenId);
  if (!t) return;

  t.ticker    = document.getElementById('pm-ticker')?.value || t.ticker;
  t.qty       = document.getElementById('pm-qty')?.value    || t.qty;
  t.grade     = document.getElementById('pm-grade')?.value  || t.grade;
  t.stop      = document.getElementById('pm-stop')?.value   || t.stop;
  t.gradeNote = document.getElementById('pm-note')?.value   || t.gradeNote;

  prepSave(data);
  prepRender(); // refresh grid card

  // Update header ticker
  document.getElementById('prep-modal-ticker').textContent = t.ticker || 'תכנון חדש';

  const el = document.getElementById('pm-saved');
  if (el) { el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2200); }
}

/* ── TARGETS IN MODAL ── */
const T_LABELS  = ['יעד רווח ①', 'יעד רווח ②', 'יעד רווח ③', 'יעד רווח ④', 'יעד רווח ⑤'];
const T_CLASSES = ['t1', 't2', 't3', 't1', 't2'];

function prepRenderTargets(tradeId, targets) {
  const el = document.getElementById('pm-targets');
  if (!el) return;
  if (!targets || targets.length === 0) {
    el.innerHTML = `<div style="font-size:11px;color:var(--tx3);padding:8px 0;text-align:center">לחץ "+ הוסף יעד" כדי להוסיף יעד מימוש</div>`;
    return;
  }
  el.innerHTML = targets.map((tgt, i) => `
    <div class="target-item" style="flex-wrap:wrap;gap:8px;padding:10px 8px" id="pm-tgt-${tgt.id}">
      <div style="display:flex;align-items:center;gap:8px;width:100%;margin-bottom:2px">
        <span class="target-badge ${T_CLASSES[i]||'t1'}" style="font-size:10.5px">${T_LABELS[i]||('יעד '+(i+1))}</span>
        ${targets.length > 1
          ? `<button class="remove-target" onclick="prepModalRemoveTarget('${tgt.id}')" title="הסר"><i class="ti ti-x"></i></button>`
          : ''}
      </div>
      <div style="display:flex;gap:8px;flex:1;flex-wrap:wrap">
        <div class="ti-input-wrap" style="min-width:110px;flex:1">
          <div class="ti-label">מחיר יעד ($)</div>
          <input class="ti-input" type="number" step="0.01" placeholder="0.00"
            value="${esc(tgt.target)}" style="font-family:'IBM Plex Mono',monospace"
            oninput="prepModalTargetField('${tgt.id}','target',this.value)">
        </div>
        <div class="ti-input-wrap" style="min-width:90px;flex:1">
          <div class="ti-label">כמות למכירה</div>
          <input class="ti-input" type="number" step="1" min="1" placeholder="0"
            value="${esc(tgt.sellQty)}" style="font-family:'IBM Plex Mono',monospace"
            oninput="prepModalTargetField('${tgt.id}','sellQty',this.value)">
        </div>
        <div class="ti-input-wrap" style="min-width:110px;flex:1">
          <div class="ti-label">סטופ לוס חדש ($)</div>
          <input class="ti-input" type="number" step="0.01" placeholder="0.00"
            value="${esc(tgt.newStop)}" style="font-family:'IBM Plex Mono',monospace;border-color:rgba(239,68,68,0.28)"
            oninput="prepModalTargetField('${tgt.id}','newStop',this.value)">
        </div>
      </div>
    </div>
  `).join('');
}

function prepModalAddTarget() {
  if (!_prepOpenId) return;
  const data = prepLoad();
  const t = data.find(t => t.id === _prepOpenId);
  if (!t) return;
  t.targets.push({ id: prepUID(), target: '', sellQty: '', newStop: '' });
  prepSave(data);
  prepRenderTargets(_prepOpenId, t.targets);
}

function prepModalRemoveTarget(targetId) {
  if (!_prepOpenId) return;
  const data = prepLoad();
  const t = data.find(t => t.id === _prepOpenId);
  if (!t) return;
  t.targets = t.targets.filter(x => x.id !== targetId);
  prepSave(data);
  prepRenderTargets(_prepOpenId, t.targets);
}

function prepModalTargetField(targetId, field, value) {
  const key = targetId + field;
  clearTimeout(_mt[key]);
  _mt[key] = setTimeout(() => {
    if (!_prepOpenId) return;
    const data = prepLoad();
    const t = data.find(t => t.id === _prepOpenId);
    if (!t) return;
    const tgt = t.targets.find(x => x.id === targetId);
    if (tgt) { tgt[field] = value; prepSave(data); }
  }, 350);
}

function esc(s) {
  return (s == null ? '' : String(s)).replace(/"/g, '&quot;');
}

/* ── CHECKLIST ── */
function prepChecklistHTML(cl) {
  const required = PREP_CHECKLIST_DEF.filter(i => i.required);
  const optional = PREP_CHECKLIST_DEF.filter(i => !i.required);
  const checkedOptional = optional.filter(i => cl[i.key]).length;

  let scoreHint = '';
  if (checkedOptional >= 4) {
    scoreHint = `<div class="pcl-score strong"><i class="ti ti-flame"></i>שיחרת חזק — ${checkedOptional}/5 קריטריוני רשות מתקיימים</div>`;
  } else if (checkedOptional >= 3) {
    scoreHint = `<div class="pcl-score ok"><i class="ti ti-thumb-up"></i>${checkedOptional}/5 קריטריוני רשות — ניתן לשקול כניסה</div>`;
  } else if (checkedOptional > 0) {
    scoreHint = `<div class="pcl-score weak"><i class="ti ti-info-circle"></i>${checkedOptional}/5 קריטריוני רשות — שקול להמתין לאישוש נוסף</div>`;
  }

  const requiredHTML = required.map(item => {
    const checked = !!cl[item.key];
    return `<label class="pcl-item${checked ? ' checked' : ''}">
      <input type="checkbox" ${checked ? 'checked' : ''} onchange="prepToggleCheck('${item.key}',this.checked)">
      <div class="pcl-item-body">
        <div class="pcl-item-top">
          <span class="pcl-badge required">חובה</span>
          <span class="pcl-label">${item.label}</span>
        </div>
        <div class="pcl-desc">${item.desc}</div>
      </div>
    </label>`;
  }).join('');

  const optionalHTML = optional.map(item => {
    const checked = !!cl[item.key];
    return `<label class="pcl-item${checked ? ' checked' : ''}">
      <input type="checkbox" ${checked ? 'checked' : ''} onchange="prepToggleCheck('${item.key}',this.checked)">
      <div class="pcl-item-body">
        <div class="pcl-item-top">
          <span class="pcl-badge optional">רשות</span>
          <span class="pcl-label">${item.label}</span>
        </div>
        <div class="pcl-desc">${item.desc}</div>
      </div>
    </label>`;
  }).join('');

  return `
    <div class="pcl-group-title">חובה — כל 3 חייבים להיות מסומנים</div>
    <div class="pcl-group required-group" id="pcl-required">${requiredHTML}</div>
    <div id="pcl-warning" style="display:none" class="pcl-warning">
      <i class="ti ti-alert-triangle"></i> חסרים תנאי חובה — לא מומלץ להיכנס לעסקה
    </div>
    <div class="pcl-group-title" style="margin-top:14px">רשות — לפחות 3 מתוך 5 להצדקת כניסה</div>
    <div class="pcl-group" id="pcl-optional">${optionalHTML}</div>
    ${checkedOptional > 0 && checkedOptional < 3
      ? `<div class="pcl-warning" style="margin-top:6px"><i class="ti ti-alert-triangle"></i> רק ${checkedOptional}/5 תנאי רשות — שקול להמתין לאישוש נוסף</div>`
      : scoreHint}
  `;
}

function prepToggleCheck(key, value) {
  if (!_prepOpenId) return;
  const data = prepLoad();
  const t = data.find(t => t.id === _prepOpenId);
  if (!t) return;
  if (!t.checklist) t.checklist = prepEmptyChecklist();
  t.checklist[key] = value;
  prepSave(data);
  // Re-render only the checklist section to preserve focus
  const el = document.getElementById('pm-checklist');
  if (el) el.innerHTML = prepChecklistHTML(t.checklist);
  // Update warning
  updatePclWarning(t.checklist);
}

function updatePclWarning(cl) {
  const required = PREP_CHECKLIST_DEF.filter(i => i.required);
  const allRequired = required.every(i => cl[i.key]);
  const warnEl = document.getElementById('pcl-warning');
  if (warnEl) warnEl.style.display = allRequired ? 'none' : 'flex';
}
