/*
  analysis.js — ניתוח חברות
  אזור ייעודי לניתוח פונדמנטלי של חברות, בסגנון "דף וורד".
  רשת כרטיסיות (סימבול בלבד) → לחיצה → מסמך מלא לעריכה → ייצוא PDF.
  מבנה השדות נגזר מהניתוח לדוגמה של מיקרוסופט.
*/

const CA_KEY = 'tj_company_analysis_v1';

// ── מבנה השדות של המסמך (לפי ניתוח MSFT) ──
// "איך מרוויחה" ו"מודל עסקי" היו שני שדות נפרדים — מוזגו לאחד כדי שהמודל
// העסקי ומקורות ההכנסה ייכתבו במקום אחד. ראו caMigrateFields למיזוג נתונים ישנים.
const CA_SECTIONS = [
  { key: 'whoIs',         title: 'מי החברה?',              icon: 'ti-building',         hint: 'תיאור כללי — מה החברה עושה, גודלה (שווי שוק), מיקומה בשוק, לאיזו קבוצה היא שייכת.' },
  { key: 'businessModel', title: 'מודל עסקי ואיך מרוויחים', icon: 'ti-coins',            hint: 'תחומי הפעילות העיקריים, מקורות ההכנסה ואיך בדיוק מרוויחים מהם, נתחי הכנסה וצמיחה בכל תחום, מנויים/שימוש/מכירה חד-פעמית, נקודות המינוף וההזדמנויות לצמיחה עתידית.' },
  { key: 'competitors',   title: 'מי המתחרות העיקריות?',   icon: 'ti-swords',           hint: 'המתחרות המרכזיות בכל אחד מתחומי הפעילות.' },
  { key: 'partners',      title: 'מי השותפות הגדולות?',    icon: 'ti-users-group',      hint: 'שיתופי פעולה אסטרטגיים ומשמעותם.' },
];

// ── מחזור החיים העסקי (7 שלבים) — לפי "מטמורפוזה עסקית: מחזור חיי החברה" ──
const CA_STAGES = [
  { id: 1, name: 'שלב החלום',   focus: 'פיתוח ומחקר', criteria: [
    { label: 'קצב שריפת מזומנים',      desc: 'כמה כסף נשאר בקופה וזמן החמצן שנותר.' },
    { label: 'אבני דרך טכנולוגיות',    desc: 'הוכחות להתקדמות (אבטיפוס, פטנטים).' },
    { label: 'התעלמות מהרווח',         desc: 'שורת ההכנסות היא אפס; המיקוד הוא בנכסים.' },
  ] },
  { id: 2, name: 'שלב ההוכחה',  focus: 'מכירות ראשונות', criteria: [
    { label: 'הסכמים ופיילוטים',       desc: 'האם גופים גדולים מוכנים לנסות את המוצר?' },
    { label: 'תיקוף השוק',             desc: 'הוכחה מעשית שמישהו מוכן לשלם עבור הפתרון.' },
    { label: 'צמיחה מעל יעילות',       desc: 'לקוח משלם ראשון חשוב יותר מחיסכון.' },
  ] },
  { id: 3, name: 'שלב הזינוק',  focus: 'צמיחה בהכנסות', criteria: [
    { label: 'השורה העליונה',          desc: 'המדד הקריטי ביותר; זינוק אגרסיבי במכירות.' },
    { label: 'תפיסת קרקע',             desc: 'הגעה לכמות לקוחות מקסימלית לפני המתחרים.' },
    { label: 'סלחנות להפסדים',         desc: 'השקעה מסיבית בשיווק כדי לכבוש את השוק.' },
  ] },
  { id: 4, name: 'שלב הבריאות', focus: 'הכלכלה של היחידה', criteria: [
    { label: 'רווח גולמי',             desc: 'בדיקה שעלויות הייצור לא עולות בקצב המכירות.' },
    { label: 'יתרון לגודל',            desc: 'מצפים לראות שיפור באחוז הרווח הגולמי.' },
    { label: 'מודל עסקי הגיוני',       desc: 'האם המוצר רווחי ברמת היחידה הבודדת?' },
  ] },
  { id: 5, name: 'שלב המהפך',   focus: 'איזון תפעולי', criteria: [
    { label: 'מינוף תפעולי',           desc: 'הוצאות ההנהלה והשיווק יורדות כאחוז מההכנסות.' },
    { label: 'רווח ראשון',             desc: 'הרגע המכונן בו החברה הופכת לרווחית לראשונה.' },
    { label: 'עמידה בזכות עצמה',       desc: 'החברה אינה זקוקה יותר לכספי משקיעים.' },
  ] },
  { id: 6, name: 'תור הזהב',    focus: 'מכונת המזומנים', criteria: [
    { label: 'רווח נקי ומזומן חופשי',  desc: 'דגש על תוצאות בהווה ולא הבטחות לעתיד.' },
    { label: 'שימוש במזומן',           desc: 'חלוקת דיבידנדים או רכישה עצמית של מניות.' },
    { label: 'יציבות עקבית',           desc: 'יכולת לייצר מזומנים באופן קבוע ללא דרמות.' },
  ] },
  { id: 7, name: 'המצאה מחדש',  focus: 'הקצאת הון וחדשנות', criteria: [
    { label: 'רכישות ומיזוגים',        desc: 'שימוש בכסף לקניית חברות צעירות וחדשניות.' },
    { label: 'מנועי צמיחה חדשים',      desc: 'פיתוח מוצרים חדשים לחלוטין כדי למנוע דעיכה.' },
    { label: 'צמיחה במגזרים חדשים',    desc: 'האם החברה מצליחה להמציא את עצמה?' },
  ] },
];
function caStageById(id) { return CA_STAGES.find(s => s.id === id) || null; }

// מיזוג חד-פעמי לניתוחים ישנים: מעביר תוכן שנכתב תחת "howEarns" (השדה
// הנפרד הישן) לתוך "businessModel" הממוזג, ודוחף את השינוי לאחסון.
// לא הרסני — c.fields.howEarns נשאר במבנה הנתונים, פשוט לא מוצג יותר.
function caMigrateFields(id) {
  const data = caLoad();
  const c = data.find(x => x.id === id);
  if (!c || !c.fields?.howEarns || c._mergedHowEarns) return null;
  const a = c.fields.businessModel || '', b = c.fields.howEarns || '';
  c.fields.businessModel = a && b ? `${a}<br><br>${b}` : (a || b);
  c._mergedHowEarns = true;
  localStorage.setItem(CA_KEY, JSON.stringify(data));
  if (typeof dbPush === 'function') { try { dbPush(CA_KEY, data); } catch { /* silent */ } }
  return c;
}

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
let caSaveTimeout = null;     // טיימר לתווית "נשמר" (ויזואלי בלבד)
let caPersistTimer = null;    // debounce לדחיפה לענן
let caLastEditable = null;

// ═══════════════════════════════════════════════════════════
//  רשת כרטיסיות
// ═══════════════════════════════════════════════════════════
function caRender() {
  const grid = document.getElementById('analysis-grid');
  const docView = document.getElementById('analysis-doc');
  if (!grid) return;
  if (caPersistTimer) caFlushCloud();   // דחיפה ממתינה לא תלך לאיבוד ביציאה מהמסמך
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
      const stage = caStageById(c.stage);
      const d    = c.updatedAt || c.createdAt;
      const date = d ? new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      return `<div class="ca-card" onclick="caOpen('${c.id}')">
        <button class="ca-card-del" onclick="caDeleteCompany('${c.id}',event)" title="מחק"><i class="ti ti-trash"></i></button>
        <div class="ca-card-sym-row">
          ${c.symbol && typeof stockLogoImg === 'function' ? stockLogoImg(c.symbol, 28, 'ca-card-logo') : ''}
          <div class="ca-card-sym">${sym}</div>
        </div>
        ${name ? `<div class="ca-card-name">${name}</div>` : ''}
        ${stage ? `<div class="ca-card-stage"><i class="ti ti-stairs-up"></i>שלב ${stage.id} · ${caEsc(stage.name)}</div>` : ''}
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
  // מניעת כפילות — אם החברה כבר קיימת, פותחים אותה במקום ליצור כפולה
  const existing = data.find(c => (c.symbol || '').trim().toUpperCase() === symbol);
  if (existing) {
    alert(`כבר קיים ניתוח עבור ${symbol} — פותח אותו.`);
    caOpen(existing.id);
    return;
  }
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
  const migrated = caMigrateFields(id);
  if (migrated) c.fields = migrated.fields;
  caCurrentId = id;
  document.getElementById('analysis-grid').style.display = 'none';
  const docView = document.getElementById('analysis-doc');
  docView.style.display = '';

  const sectionsHTML = CA_SECTIONS.map(s => `
    <section class="doc-section">
      <h2 class="doc-h2"><i class="ti ${s.icon}"></i>${s.title}</h2>
      <div class="doc-editable" contenteditable="true" data-field="${s.key}" data-ph="${caEsc(s.hint)}"
        onfocus="caLastEditable=this" oninput="caFieldInput(this)">${c.fields?.[s.key] || ''}</div>
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
            <span id="doc-logo-slot">${c.symbol && typeof stockLogoImg === 'function' ? stockLogoImg(c.symbol, 40, 'doc-symbol-logo') : ''}</span>
            <input class="doc-symbol" value="${caEsc(c.symbol)}" placeholder="SYMBOL"
              oninput="caMetaInput('symbol',this.value)" onchange="caSymbolChanged(this.value)">
            <span class="doc-badge">ניתוח חברה</span>
          </div>
          <input id="doc-name" class="doc-company" value="${caEsc(c.name)}" placeholder="שם החברה"
            oninput="caMetaInput('name',this.value)">
          <div class="doc-meta-row">
            <label class="doc-meta"><i class="ti ti-scale"></i>
              <input id="doc-mktcap" value="${caEsc(c.marketCap)}" placeholder="שווי שוק (למשל 2.86T)" oninput="caMetaInput('marketCap',this.value)"></label>
            <label class="doc-meta"><i class="ti ti-category"></i>
              <input id="doc-sector" value="${caEsc(c.sector)}" placeholder="סקטור / תחום" oninput="caMetaInput('sector',this.value)"></label>
          </div>
        </header>

        <section class="doc-section doc-stage-section">
          <h2 class="doc-h2"><i class="ti ti-stairs-up"></i>שלב במחזור החיים העסקי</h2>
          <div class="doc-stage-grid" id="doc-stage-grid">${caStageGridHTML(c)}</div>
          <div class="doc-editable doc-stage-note" contenteditable="true" data-field="stageNote"
            data-ph="הסיבות שלך לשיוך החברה לשלב שנבחר..."
            onfocus="caLastEditable=this" oninput="caFieldInput(this)">${c.fields?.stageNote || ''}</div>
        </section>

        ${sectionsHTML}

        <section class="doc-section">
          <div class="doc-h2-row">
            <h2 class="doc-h2"><i class="ti ti-timeline-event"></i>מעקב רבעוני (דיווחים)</h2>
            <div class="doc-h2-actions">
              <button class="doc-ir-btn" onclick="caOpenIR()" title="חיפוש דף Investor Relations של החברה">
                <i class="ti ti-building-bank"></i>Investor Relations<i class="ti ti-external-link doc-ir-ext"></i>
              </button>
              <button class="doc-add-q" onclick="caAddQuarter()"><i class="ti ti-plus"></i>הוסף דיווח</button>
            </div>
          </div>
          <div id="doc-quarters">${caQuartersHTML(c)}</div>
        </section>
      </article>
    </div>`;

  docView.querySelector('.doc-scroll').scrollTop = 0;

  // מילוי אוטומטי של שדות ריקים (סקטור/שם/שווי שוק) מ-Finnhub — גם לניתוחים ותיקים
  caAutoProfile(id);
}

// רשת 7 כרטיסי השלבים — מציגה את כל השלבים והמאפיינים שלהם תמיד (לא רק
// הנבחר), כדי שיהיה קל להשוות ולזכור מה מייחד כל שלב לפני שבוחרים.
function caStageGridHTML(c) {
  return CA_STAGES.map(s => `
    <button type="button" class="doc-stage-card${c.stage === s.id ? ' sel' : ''}" data-stage="${s.id}" onclick="caSetStage(${s.id})">
      <div class="doc-stage-card-head">
        <span class="doc-stage-num">${s.id}</span>
        <span class="doc-stage-name">${s.name}</span>
      </div>
      <div class="doc-stage-focus">מיקוד: ${s.focus}</div>
      <ul class="doc-stage-crit">${s.criteria.map(cr => `<li><b>${cr.label}:</b> ${cr.desc}</li>`).join('')}</ul>
    </button>`).join('');
}

// בחירת/ביטול שלב — קליק חוזר על שלב שכבר נבחר מבטל אותו
function caSetStage(id) {
  const c = caGet(caCurrentId);
  if (!c) return;
  const next = c.stage === id ? null : id;
  caTouch(cc => { cc.stage = next; });
  document.querySelectorAll('#doc-stage-grid .doc-stage-card').forEach(el => {
    el.classList.toggle('sel', next !== null && +el.dataset.stage === next);
  });
}

// ── טבלת נתונים כספיים לכל דיווח — משכפלת בדיוק את תבנית האקסל של המשתמש
// לחישוב רווחים והתייעלות: הכנסות/הוצאות/רווח נקי מול תקופה מקבילה,
// יחס הוצ׳/הכנ׳ (עלות כאחוז מהכנסה) ומכפיל רווח עתידי ──
function caFinRatio(op, rev) {
  const o = parseFloat(op), r = parseFloat(rev);
  if (isNaN(o) || isNaN(r) || r === 0) return null;
  return o / r * 100;
}
function caFinPct(curr, prev, invert) {
  const c = parseFloat(curr), p = parseFloat(prev);
  if (isNaN(c) || isNaN(p) || p === 0) return { text: '—', cls: '' };
  const pct = ((c - p) / Math.abs(p) * 100).toFixed(1);
  return { text: (pct > 0 ? '+' : '') + pct + '%', cls: (pct > 0 !== invert) ? 'pos' : 'neg' };
}
// הפרש רווח נקי בדולרים (curr-prev) — כמו E18=C17-D17 / H18=F17-G17 באקסל
function caNiDiff(curr, prev) {
  const c = parseFloat(curr), p = parseFloat(prev);
  if (isNaN(c) || isNaN(p)) return { text: '—', cls: '' };
  const d = +(c - p).toFixed(2);
  const cls = d > 0 ? 'pos' : d < 0 ? 'neg' : '';
  return { text: (d > 0 ? '+' : d < 0 ? '-' : '') + '$' + Math.round(Math.abs(d)).toLocaleString('en'), cls };
}
function caFinEffDelta(cO, cR, pO, pR) {
  const curr = caFinRatio(cO, cR), prev = caFinRatio(pO, pR);
  if (curr === null || prev === null) return { text: '—', cls: '' };
  const d = curr - prev;
  return { text: (d > 0 ? '+' : '') + d.toFixed(1) + ' נ"א', cls: d < 0 ? 'pos' : d > 0 ? 'neg' : '' };
}
function caFinEffTagHTML(id, op, rev) {
  const r = caFinRatio(op, rev);
  return `<div class="doc-fin-eff" id="${id}">${r !== null ? r.toFixed(1) + '%' : '—'}</div>`;
}

function caQFinHTML(q) {
  const revPct = caFinPct(q.revCurr, q.revPrev, false);
  const opPct  = caFinPct(q.opCurr,  q.opPrev,  true);
  const niRes  = caNiDiff(q.niCurr, q.niPrev);
  const effD   = caFinEffDelta(q.opCurr, q.revCurr, q.opPrev, q.revPrev);
  return `<div class="doc-fin-table">
    <div class="doc-fin-header">
      <div></div><div>תקופה נוכחית</div><div>תקופה מקבילה</div><div>שינוי</div>
    </div>
    <div class="doc-fin-row">
      <div class="doc-fin-lbl">הכנסות</div>
      <div>
        <input class="doc-fin-inp" type="number" step="0.01" placeholder="—" value="${caEsc(q.revCurr||'')}" oninput="caQFin('${q.id}','revCurr',this.value)">
        ${caFinEffTagHTML(`ca-eff-curr-${q.id}`, q.opCurr, q.revCurr)}
      </div>
      <div>
        <input class="doc-fin-inp" type="number" step="0.01" placeholder="—" value="${caEsc(q.revPrev||'')}" oninput="caQFin('${q.id}','revPrev',this.value)">
        ${caFinEffTagHTML(`ca-eff-prev-${q.id}`, q.opPrev, q.revPrev)}
      </div>
      <div class="doc-fin-badge ${revPct.cls}" id="ca-pct-rev-${q.id}">${revPct.text}</div>
    </div>
    <div class="doc-fin-row">
      <div class="doc-fin-lbl">הוצאות תפעוליות</div>
      <input class="doc-fin-inp" type="number" step="0.01" placeholder="—" value="${caEsc(q.opCurr||'')}" oninput="caQFin('${q.id}','opCurr',this.value)">
      <input class="doc-fin-inp" type="number" step="0.01" placeholder="—" value="${caEsc(q.opPrev||'')}" oninput="caQFin('${q.id}','opPrev',this.value)">
      <div class="doc-fin-badge ${opPct.cls}" id="ca-pct-op-${q.id}">${opPct.text}</div>
    </div>
    <div class="doc-fin-footer">
      <span>יחס הוצ׳/הכנ׳ (התייעלות)</span>
      <span class="doc-fin-badge ${effD.cls}" id="ca-eff-delta-${q.id}">${effD.text}</span>
    </div>
    <div class="doc-fin-row">
      <div class="doc-fin-lbl">רווח נקי</div>
      <input class="doc-fin-inp" type="number" step="0.01" placeholder="—" value="${caEsc(q.niCurr||'')}" oninput="caQFin('${q.id}','niCurr',this.value)">
      <input class="doc-fin-inp" type="number" step="0.01" placeholder="—" value="${caEsc(q.niPrev||'')}" oninput="caQFin('${q.id}','niPrev',this.value)">
      <div class="doc-fin-badge ${niRes.cls}" id="ca-ni-diff-${q.id}">${niRes.text}</div>
    </div>
    <div class="doc-fin-pe">
      <span>מכפיל רווח עתידי (Forward P/E)</span>
      <input class="doc-fin-inp doc-fin-pe-inp" type="text" placeholder="לדוגמה 24x" value="${caEsc(q.forwardPE||'')}" oninput="caQuarterInput('${q.id}','forwardPE',this.value)">
    </div>
  </div>`;
}

// עדכון חי של התגים בטבלה הכספית (אחוזים/הפרשים) בלי לרנדר את כל הכרטיס מחדש
function caQFin(qid, field, value) {
  caTouch(c => { const q = (c.quarters || []).find(x => x.id === qid); if (q) q[field] = value; });
  const c = caGet(caCurrentId);
  const q = c && (c.quarters || []).find(x => x.id === qid);
  if (!q) return;
  const setBadge = (id, res) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = res.text; el.className = 'doc-fin-badge ' + res.cls; }
  };
  setBadge(`ca-pct-rev-${qid}`,   caFinPct(q.revCurr, q.revPrev, false));
  setBadge(`ca-pct-op-${qid}`,    caFinPct(q.opCurr,  q.opPrev,  true));
  setBadge(`ca-ni-diff-${qid}`,   caNiDiff(q.niCurr, q.niPrev));
  setBadge(`ca-eff-delta-${qid}`, caFinEffDelta(q.opCurr, q.revCurr, q.opPrev, q.revPrev));
  const fmtEff = v => v !== null ? v.toFixed(1) + '%' : '—';
  const effCurrEl = document.getElementById(`ca-eff-curr-${qid}`);
  if (effCurrEl) effCurrEl.textContent = fmtEff(caFinRatio(q.opCurr, q.revCurr));
  const effPrevEl = document.getElementById(`ca-eff-prev-${qid}`);
  if (effPrevEl) effPrevEl.textContent = fmtEff(caFinRatio(q.opPrev, q.revPrev));
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
      ${caQFinHTML(q)}
      <div class="doc-editable doc-q-body" contenteditable="true" data-ph="היילייטס, שינויים..."
        onfocus="caLastEditable=this" oninput="caQuarterBodyInput('${q.id}',this)">${q.text || ''}</div>
      <div class="doc-q-concl-wrap">
        <div class="doc-q-concl-lbl"><i class="ti ti-bulb"></i>המסקנה שלי</div>
        <div class="doc-editable doc-q-concl" contenteditable="true" data-ph="מה אני מסיק מהדוח הזה..."
          onfocus="caLastEditable=this" oninput="caQuarterConclInput('${q.id}',this)">${q.concl || ''}</div>
      </div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════
//  שמירה
// ═══════════════════════════════════════════════════════════
// שמירה: כתיבה מקומית מיידית (בטיחות מול רענון) + דחיפה לענן מדובאונסת
// כדי לא להציף את Supabase בכתיבה על כל הקשה.
function caTouch(mutate) {
  const data = caLoad();
  const c = data.find(x => x.id === caCurrentId);
  if (!c) return;
  mutate(c);
  c.updatedAt = Date.now();
  localStorage.setItem(CA_KEY, JSON.stringify(data));   // מקומי — מיידי
  caSetSaveLbl('saving');
  clearTimeout(caPersistTimer);
  caPersistTimer = setTimeout(caFlushCloud, 600);        // ענן — מדובאונס
}

// דוחף לענן את המצב העדכני ומעדכן תווית ל"נשמר"
function caFlushCloud() {
  clearTimeout(caPersistTimer);
  caPersistTimer = null;
  if (typeof dbPush === 'function') { try { dbPush(CA_KEY, caLoad()); } catch (e) { /* silent */ } }
  caSetSaveLbl('saved');
}

function caSetSaveLbl(state) {
  const lbl = document.getElementById('doc-save-lbl');
  if (!lbl) return;
  clearTimeout(caSaveTimeout);
  if (state === 'saving') {
    lbl.innerHTML = '<i class="ti ti-loader-2"></i>שומר…';
  } else {  // 'saved'
    lbl.innerHTML = '<i class="ti ti-check"></i>נשמר';
    caSaveTimeout = setTimeout(() => {
      lbl.innerHTML = '<i class="ti ti-device-floppy"></i>נשמר אוטומטית';
    }, 1600);
  }
}

function caMetaInput(field, value) {
  caTouch(c => { c[field] = value; });
}

// שווי שוק ממיליוני דולר (כפי ש-Finnhub מחזיר) למחרוזת קריאה: 2.86T / 850B / 120M
function caFmtCap(millions) {
  const v = (+millions || 0) * 1e6;
  if (!isFinite(v) || v <= 0) return '';
  const trim = s => s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (v >= 1e12) return trim((v / 1e12).toFixed(2)) + 'T';
  if (v >= 1e9)  return trim((v / 1e9).toFixed(2)) + 'B';
  if (v >= 1e6)  return Math.round(v / 1e6) + 'M';
  return String(Math.round(v));
}

// משיכה אוטומטית של פרופיל החברה מ-Finnhub (סקטור/תחום, שם, שווי שוק) —
// ממלא רק שדות ריקים כדי לא לדרוס מה שהמשתמש הזין. שקט אם אין מפתח או שהמשיכה נכשלה.
async function caAutoProfile(id, force = false) {
  const key = (typeof getKey === 'function') ? getKey() : '';
  const c = caGet(id);
  if (!key || !c || !c.symbol) return;
  if (!force && c.sector && c.name && c.marketCap) return;   // כבר מלא — אין מה למשוך
  try {
    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(c.symbol.trim().toUpperCase())}&token=${key}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const p = await res.json();
    if (!p || (!p.finnhubIndustry && !p.name && !p.marketCapitalization)) return;
    let changed = false;
    if (!c.name && p.name)                    { c.name = p.name; changed = true; }
    if (!c.sector && p.finnhubIndustry)       { c.sector = p.finnhubIndustry; changed = true; }
    if (!c.marketCap && p.marketCapitalization) { const cap = caFmtCap(p.marketCapitalization); if (cap) { c.marketCap = cap; changed = true; } }
    if (!changed) return;
    // שמירה דרך caTouch (מקומי + ענן) — פועל על החברה הפתוחה כעת
    if (caCurrentId === id) {
      caTouch(cc => { cc.name = c.name; cc.sector = c.sector; cc.marketCap = c.marketCap; });
      const nameEl = document.getElementById('doc-name');
      const secEl  = document.getElementById('doc-sector');
      const capEl  = document.getElementById('doc-mktcap');
      if (nameEl && !nameEl.value) nameEl.value = c.name || '';
      if (secEl  && !secEl.value)  secEl.value  = c.sector || '';
      if (capEl  && !capEl.value)  capEl.value  = c.marketCap || '';
    } else {
      const data = caLoad();
      const t = data.find(x => x.id === id);
      if (t) { t.name = c.name; t.sector = c.sector; t.marketCap = c.marketCap; t.updatedAt = Date.now();
               localStorage.setItem(CA_KEY, JSON.stringify(data));
               if (typeof dbPush === 'function') { try { dbPush(CA_KEY, data); } catch {} } }
    }
  } catch { /* silent */ }
}

// שינוי הסימבול במסמך פתוח — מרענן את הלוגו ומושך פרופיל מחדש לשדות הריקים
function caSymbolChanged(val) {
  const slot = document.getElementById('doc-logo-slot');
  const sym  = (val || '').trim().toUpperCase();
  if (slot) slot.innerHTML = (sym && typeof stockLogoImg === 'function') ? stockLogoImg(sym, 40, 'doc-symbol-logo') : '';
  if (caCurrentId) caAutoProfile(caCurrentId);
}

// פותח חיפוש לדף ה-Investor Relations של החברה בכרטיסייה חדשה —
// אין API אמין למיפוי סימבול→URL של IR, אז נעזרים בחיפוש "{סימבול} ir"
// שבד"כ מעלה את דף ה-IR הרשמי כתוצאה הראשונה.
function caOpenIR() {
  const c = caGet(caCurrentId);
  const q = ((c && (c.symbol || c.name)) || '').trim();
  if (!q) { alert('הזן קודם סימבול או שם חברה'); return; }
  window.open(`https://www.google.com/search?q=${encodeURIComponent(q + ' ir')}`, '_blank', 'noopener');
}

// el מגיע ישירות מ-oninput (this) — לא מסתמכים על משתנה גלובלי
function caFieldInput(el) {
  el = el || caLastEditable;
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
function caQuarterConclInput(qid, el) {
  const html = el.innerHTML;
  caTouch(c => { const q = (c.quarters || []).find(x => x.id === qid); if (q) q.concl = html; });
}

function caAddQuarter() {
  const qid = caUID();
  caTouch(c => { c.quarters = c.quarters || []; c.quarters.push({
    id: qid, label: '', text: '', concl: '',
    revCurr: '', revPrev: '', opCurr: '', opPrev: '', niCurr: '', niPrev: '', forwardPE: '',
  }); });
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
    if (caLastEditable.dataset.field) caFieldInput(caLastEditable);
    else {
      const q = caLastEditable.closest('.doc-quarter');
      if (q) {
        if (caLastEditable.classList.contains('doc-q-concl')) caQuarterConclInput(q.dataset.qid, caLastEditable);
        else caQuarterBodyInput(q.dataset.qid, caLastEditable);
      }
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

// מכניס טקסט רגיל במיקום הסמן, כשמעברי שורה הופכים ל-<br>. אם אין סמן
// בתוך האלמנט (למשל הדבקה בלי מיקוד) — מוסיף בסופו.
function caInsertPlainText(el, text) {
  const sel = window.getSelection();
  const frag = document.createDocumentFragment();
  text.split(/\r\n|\r|\n/).forEach((line, i) => {
    if (i > 0) frag.appendChild(document.createElement('br'));
    frag.appendChild(document.createTextNode(line));
  });
  const last = frag.lastChild;
  let range;
  if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
    range = sel.getRangeAt(0);
    range.deleteContents();
  } else {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  }
  range.insertNode(frag);
  if (last && sel) {                 // מזיז את הסמן לסוף הטקסט שהודבק
    range.setStartAfter(last);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// ═══════════════════════════════════════════════════════════
//  מאזינים גלובליים (נרשמים פעם אחת)
// ═══════════════════════════════════════════════════════════
if (!window._caBound) {
  window._caBound = true;

  // ניקוי הדבקה: מדביקים טקסט בלבד, בלי HTML/עיצוב מוורד או מהאינטרנט
  // ששוברים את מראה ה"נייר". מכניסים דרך Range (לא execCommand) כדי שיהיה
  // אמין בכל דפדפן, ומפעילים ידנית אירוע input כדי שהשמירה האוטומטית תרוץ.
  document.addEventListener('paste', function (e) {
    const node = e.target && e.target.nodeType === 3 ? e.target.parentElement : e.target;
    const el = node && node.closest && node.closest('.doc-editable');
    if (!el) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
    caInsertPlainText(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, true);

  // דחיפה ממתינה לענן — לא לאבד אותה בסגירת/רענון הדף
  window.addEventListener('beforeunload', function () {
    if (caPersistTimer) caFlushCloud();
  });
}
