/*
  analysis.js — ניתוח חברות
  אזור ייעודי לניתוח פונדמנטלי של חברות, בסגנון "דף וורד".
  רשת כרטיסיות (סימבול בלבד) → לחיצה → מסמך מלא לעריכה → ייצוא PDF.
  מבנה השדות נגזר מהניתוח לדוגמה של מיקרוסופט.
*/

const CA_KEY = 'tj_company_analysis_v1';

// ── מבנה השדות של המסמך (לפי ניתוח MSFT) ──
const CA_SECTIONS = [
  { key: 'whoIs',         title: 'מי החברה?',              icon: 'ti-building',         hint: 'תיאור כללי — מה החברה עושה, גודלה (שווי שוק), מיקומה בשוק, לאיזו קבוצה היא שייכת.' },
  { key: 'howEarns',      title: 'איך החברה מרוויחה כסף?', icon: 'ti-coins',            hint: 'תחומי הפעילות העיקריים, מקורות ההכנסה, נתחי הכנסה וצמיחה בכל תחום.' },
  { key: 'businessModel', title: 'מה המודל העסקי?',        icon: 'ti-repeat',           hint: 'מנויים / שימוש / מכירה חד-פעמית, נקודות המינוף וההזדמנויות לצמיחה עתידית.' },
  { key: 'competitors',   title: 'מי המתחרות העיקריות?',   icon: 'ti-swords',           hint: 'המתחרות המרכזיות בכל אחד מתחומי הפעילות.' },
  { key: 'partners',      title: 'מי השותפות הגדולות?',    icon: 'ti-users-group',      hint: 'שיתופי פעולה אסטרטגיים ומשמעותם.' },
];

function caLoad() {
  try { return JSON.parse(localStorage.getItem(CA_KEY) || '[]'); } catch { return []; }
}
function caSave(data) {
  localStorage.setItem(CA_KEY, JSON.stringify(data));
  if (typeof dbPush === 'function') dbPush(CA_KEY, data);
}
function caUID() { return Math.random().toString(36).slice(2, 9); }
function caEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

let caCurrentId = null;
let caSaveTimeout = null;
let caLastEditable = null;

// ═══════════════════════════════════════════════════════════
//  רשת כרטיסיות
// ═══════════════════════════════════════════════════════════
function caRender() {
  const grid = document.getElementById('analysis-grid');
  const docView = document.getElementById('analysis-doc');
  if (!grid) return;
  // כשחוזרים לרשת — מציגים אותה ומסתירים את המסמך
  grid.style.display = '';
  if (docView) docView.style.display = 'none';
  caCurrentId = null;

  const data = caLoad();
  const addCard = `<div class="ca-add-card" onclick="caAddCompany()">
      <i class="ti ti-plus"></i>
      <span>הוסף חברה</span>
    </div>`;

  if (!data.length) {
    grid.innerHTML = `<div class="ca-grid-list">${addCard}
      <div class="empty-state" style="grid-column:1/-1">
        <i class="ti ti-file-analytics"></i>
        <p>עדיין לא ניתחת חברות<br>לחץ "הוסף חברה" כדי להתחיל מסמך ניתוח חדש</p>
      </div></div>`;
    return;
  }

  const sorted = [...data].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  grid.innerHTML = `<div class="ca-grid-list">${addCard}${
    sorted.map(c => {
      const sym  = caEsc(c.symbol || '—');
      const name = caEsc(c.name || '');
      const cap  = caEsc(c.marketCap || '');
      const d    = c.updatedAt || c.createdAt;
      const date = d ? new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      return `<div class="ca-card" onclick="caOpen('${c.id}')">
        <button class="ca-card-del" onclick="caDeleteCompany('${c.id}',event)" title="מחק"><i class="ti ti-trash"></i></button>
        <div class="ca-card-sym">${sym}</div>
        ${name ? `<div class="ca-card-name">${name}</div>` : ''}
        <div class="ca-card-foot">
          ${cap ? `<span class="ca-card-cap"><i class="ti ti-scale"></i>${cap}</span>` : '<span></span>'}
          ${date ? `<span class="ca-card-date">${date}</span>` : ''}
        </div>
      </div>`;
    }).join('')
  }</div>`;
}

// ═══════════════════════════════════════════════════════════
//  הוספה / מחיקה
// ═══════════════════════════════════════════════════════════
function caAddCompany() {
  const symbol = (prompt('סימבול החברה (למשל MSFT):') || '').trim().toUpperCase();
  if (!symbol) return;
  const data = caLoad();
  const id = caUID();
  data.unshift({
    id, symbol,
    name: '', marketCap: '', sector: '',
    fields: {}, quarters: [],
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  caSave(data);
  caOpen(id);
}

function caDeleteCompany(id, e) {
  if (e) e.stopPropagation();
  const c = caLoad().find(x => x.id === id);
  if (!confirm(`למחוק את הניתוח של ${c ? (c.symbol || 'החברה') : 'החברה'}?`)) return;
  caSave(caLoad().filter(x => x.id !== id));
  caRender();
}

// ═══════════════════════════════════════════════════════════
//  מסמך הניתוח (תצוגת וורד)
// ═══════════════════════════════════════════════════════════
function caGet(id) { return caLoad().find(c => c.id === id) || null; }

function caOpen(id) {
  const c = caGet(id);
  if (!c) return;
  caCurrentId = id;
  document.getElementById('analysis-grid').style.display = 'none';
  const docView = document.getElementById('analysis-doc');
  docView.style.display = '';

  const sectionsHTML = CA_SECTIONS.map(s => `
    <section class="doc-section">
      <h2 class="doc-h2"><i class="ti ${s.icon}"></i>${s.title}</h2>
      <div class="doc-editable" contenteditable="true" data-field="${s.key}" data-ph="${caEsc(s.hint)}"
        onfocus="caLastEditable=this" oninput="caFieldInput()">${c.fields?.[s.key] || ''}</div>
    </section>`).join('');

  docView.innerHTML = `
    <div class="doc-toolbar" id="doc-toolbar">
      <button class="doc-tb-back" onclick="caRender()"><i class="ti ti-arrow-right"></i>חזרה לרשימה</button>
      <div class="doc-tb-fmt">
        <button onclick="caFmt('bold')" title="מודגש"><i class="ti ti-bold"></i></button>
        <button onclick="caFmt('italic')" title="נטוי"><i class="ti ti-italic"></i></button>
        <button onclick="caFmt('insertUnorderedList')" title="רשימת נקודות"><i class="ti ti-list"></i></button>
        <button onclick="caFmt('removeFormat')" title="נקה עיצוב"><i class="ti ti-clear-formatting"></i></button>
      </div>
      <div class="doc-tb-spacer"></div>
      <span class="doc-tb-save" id="doc-save-lbl"><i class="ti ti-device-floppy"></i>נשמר אוטומטית</span>
      <button class="doc-tb-pdf" onclick="caExportPDF()"><i class="ti ti-file-download"></i>ייצוא PDF</button>
    </div>

    <div class="doc-scroll">
      <article class="doc-page" id="doc-page">
        <header class="doc-titleblock">
          <div class="doc-symbol-row">
            <input class="doc-symbol" value="${caEsc(c.symbol)}" placeholder="SYMBOL"
              oninput="caMetaInput('symbol',this.value)">
            <span class="doc-badge">ניתוח חברה</span>
          </div>
          <input class="doc-company" value="${caEsc(c.name)}" placeholder="שם החברה"
            oninput="caMetaInput('name',this.value)">
          <div class="doc-meta-row">
            <label class="doc-meta"><i class="ti ti-scale"></i>
              <input value="${caEsc(c.marketCap)}" placeholder="שווי שוק (למשל 2.86T)" oninput="caMetaInput('marketCap',this.value)"></label>
            <label class="doc-meta"><i class="ti ti-category"></i>
              <input value="${caEsc(c.sector)}" placeholder="סקטור / תחום" oninput="caMetaInput('sector',this.value)"></label>
          </div>
        </header>

        ${sectionsHTML}

        <section class="doc-section">
          <div class="doc-h2-row">
            <h2 class="doc-h2"><i class="ti ti-timeline-event"></i>מעקב רבעוני (דיווחים)</h2>
            <button class="doc-add-q" onclick="caAddQuarter()"><i class="ti ti-plus"></i>הוסף דיווח</button>
          </div>
          <div id="doc-quarters">${caQuartersHTML(c)}</div>
        </section>
      </article>
    </div>`;

  docView.querySelector('.doc-scroll').scrollTop = 0;
}

function caQuartersHTML(c) {
  const qs = c.quarters || [];
  if (!qs.length) {
    return `<div class="doc-q-empty">אין דיווחים עדיין. לחץ "הוסף דיווח" כדי לתעד דוח רבעוני.</div>`;
  }
  return qs.map(q => `
    <div class="doc-quarter" data-qid="${q.id}">
      <div class="doc-q-head">
        <input class="doc-q-label" value="${caEsc(q.label)}" placeholder="Q1 2026 · שווי שוק"
          oninput="caQuarterInput('${q.id}','label',this.value)">
        <button class="doc-q-del" onclick="caDeleteQuarter('${q.id}')" title="מחק דיווח"><i class="ti ti-x"></i></button>
      </div>
      <div class="doc-editable doc-q-body" contenteditable="true" data-ph="הכנסות, צמיחה, שינויים, מסקנה על הדוח..."
        onfocus="caLastEditable=this" oninput="caQuarterBodyInput('${q.id}',this)">${q.text || ''}</div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════
//  שמירה
// ═══════════════════════════════════════════════════════════
function caTouch(mutate) {
  const data = caLoad();
  const c = data.find(x => x.id === caCurrentId);
  if (!c) return;
  mutate(c);
  c.updatedAt = Date.now();
  caSave(data);
  caFlashSaved();
}

function caFlashSaved() {
  const lbl = document.getElementById('doc-save-lbl');
  if (!lbl) return;
  lbl.innerHTML = '<i class="ti ti-check"></i>נשמר';
  clearTimeout(caSaveTimeout);
  caSaveTimeout = setTimeout(() => {
    lbl.innerHTML = '<i class="ti ti-device-floppy"></i>נשמר אוטומטית';
  }, 1400);
}

function caMetaInput(field, value) {
  caTouch(c => { c[field] = value; });
}

function caFieldInput() {
  const el = caLastEditable;
  if (!el || !el.dataset.field) return;
  const field = el.dataset.field;
  const html = el.innerHTML;
  caTouch(c => { c.fields = c.fields || {}; c.fields[field] = html; });
}

function caQuarterInput(qid, field, value) {
  caTouch(c => { const q = (c.quarters || []).find(x => x.id === qid); if (q) q[field] = value; });
}
function caQuarterBodyInput(qid, el) {
  const html = el.innerHTML;
  caTouch(c => { const q = (c.quarters || []).find(x => x.id === qid); if (q) q.text = html; });
}

function caAddQuarter() {
  const qid = caUID();
  caTouch(c => { c.quarters = c.quarters || []; c.quarters.push({ id: qid, label: '', text: '' }); });
  const c = caGet(caCurrentId);
  document.getElementById('doc-quarters').innerHTML = caQuartersHTML(c);
  const el = document.querySelector(`.doc-quarter[data-qid="${qid}"] .doc-q-label`);
  if (el) el.focus();
}

function caDeleteQuarter(qid) {
  if (!confirm('למחוק את הדיווח?')) return;
  caTouch(c => { c.quarters = (c.quarters || []).filter(q => q.id !== qid); });
  document.getElementById('doc-quarters').innerHTML = caQuartersHTML(caGet(caCurrentId));
}

// ── עיצוב טקסט ── (execCommand — עובד בכל הדפדפנים, מספיק לצרכים כאן)
function caFmt(cmd) {
  if (caLastEditable) caLastEditable.focus();
  document.execCommand(cmd, false, null);
  // שמירה מחדש אחרי שינוי עיצוב
  if (caLastEditable) {
    if (caLastEditable.dataset.field) caFieldInput();
    else {
      const q = caLastEditable.closest('.doc-quarter');
      if (q) caQuarterBodyInput(q.dataset.qid, caLastEditable);
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  ייצוא PDF (הדפסה → שמירה כ-PDF)
// ═══════════════════════════════════════════════════════════
function caExportPDF() {
  const c = caGet(caCurrentId);
  document.body.classList.add('ca-printing');
  const prevTitle = document.title;
  if (c && c.symbol) document.title = `${c.symbol} — ניתוח חברה`;
  const cleanup = () => {
    document.body.classList.remove('ca-printing');
    document.title = prevTitle;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 60);
}
