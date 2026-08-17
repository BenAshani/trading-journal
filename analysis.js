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

// סדר ברירת המחדל של הבלוקים הקבועים במסמך — לפני שנוספו תמונות/גרפים.
const CA_FIXED_BLOCKS = ['whoIs', 'businessModel', 'competitors', 'partners', 'stage', 'quarters'];

// מיזוג חד-פעמי: מוסיף blockOrder/images/charts לניתוחים ישנים בלי לגעת
// בתוכן הקיים. blockOrder קובע את סדר ההצגה של כל הבלוקים (כולל תמונות/גרפים
// שהמשתמש מוסיף), ומאפשר להזיז תמונה/גרף מעל או מתחת לכל בלוק קבוע אחר.
function caMigrateBlockOrder(c) {
  if (!Array.isArray(c.blockOrder)) c.blockOrder = [...CA_FIXED_BLOCKS];
  if (!Array.isArray(c.images)) c.images = [];
  if (!Array.isArray(c.charts)) c.charts = [];
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

// מחפש ניתוח חברה קיים לפי סימבול — לשימוש בכפתור "ניתוח" מעסקאות פתוחות ומתיק ההשקעות
function caFindBySymbol(symbol) {
  const sym = (symbol || '').trim().toUpperCase();
  if (!sym) return null;
  return caLoad().find(c => (c.symbol || '').trim().toUpperCase() === sym) || null;
}

function caOpenBySymbol(symbol) {
  const c = caFindBySymbol(symbol);
  if (!c) return;
  if (typeof nav === 'function') nav('analysis', null);
  if (typeof mbnSet === 'function') mbnSet('analysis');
  caOpen(c.id);
}

function caOpen(id) {
  const c = caGet(id);
  if (!c) return;
  const migrated = caMigrateFields(id);
  if (migrated) c.fields = migrated.fields;
  caMigrateBlockOrder(c);
  caCurrentId = id;
  document.getElementById('analysis-grid').style.display = 'none';
  const docView = document.getElementById('analysis-doc');
  docView.style.display = '';

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

        <div id="doc-blocks">${caBlocksHTML(c)}</div>

        <div class="doc-add-block-row">
          <button class="doc-add-block-btn" onclick="caAddImageBlock()"><i class="ti ti-photo-plus"></i>הוסף תמונה</button>
          <button class="doc-add-block-btn" onclick="caAddChartBlock()"><i class="ti ti-chart-candle"></i>הוסף גרף נרות יפני</button>
          <input type="file" id="ca-image-input" accept="image/*" style="display:none" onchange="caHandleImageFile(this)">
        </div>
      </article>
    </div>`;

  docView.querySelector('.doc-scroll').scrollTop = 0;

  // מילוי אוטומטי של שדות ריקים (סקטור/שם/שווי שוק) מ-Finnhub — גם לניתוחים ותיקים
  caAutoProfile(id);
  // טעינת נתונים לכל בלוקי הגרפים הקיימים במסמך
  (c.charts || []).forEach(chart => caLoadChart('chart:' + chart.id));
}

// ═══════════════════════════════════════════════════════════
//  בלוקים ניתנים לסידור (סעיפים קבועים + תמונות + גרפים)
// ═══════════════════════════════════════════════════════════
function caBlocksHTML(c) {
  return (c.blockOrder || []).map(entry => caBlockHTML(c, entry)).join('');
}

function caBlockHTML(c, entry) {
  if (entry === 'stage') return caStageBlockHTML(c);
  if (entry === 'quarters') return caQuartersBlockHTML(c);
  const section = CA_SECTIONS.find(s => s.key === entry);
  if (section) return caSectionBlockHTML(c, section);
  if (entry.startsWith('image:')) {
    const img = (c.images || []).find(x => x.id === entry.slice(6));
    return img ? caImageBlockHTML(c, entry, img) : '';
  }
  if (entry.startsWith('chart:')) {
    const chart = (c.charts || []).find(x => x.id === entry.slice(6));
    return chart ? caChartBlockHTML(c, entry) : '';
  }
  return '';
}

function caSectionBlockHTML(c, s) {
  return `
    <section class="doc-section">
      <h2 class="doc-h2"><i class="ti ${s.icon}"></i>${s.title}</h2>
      <div class="doc-editable" contenteditable="true" data-field="${s.key}" data-ph="${caEsc(s.hint)}"
        onfocus="caLastEditable=this" oninput="caFieldInput(this)">${c.fields?.[s.key] || ''}</div>
    </section>`;
}

function caStageBlockHTML(c) {
  return `
    <section class="doc-section doc-stage-section">
      <h2 class="doc-h2"><i class="ti ti-stairs-up"></i>שלב במחזור החיים העסקי</h2>
      <div class="doc-stage-grid" id="doc-stage-grid">${caStageGridHTML(c)}</div>
      <div class="doc-editable doc-stage-note" contenteditable="true" data-field="stageNote"
        data-ph="הסיבות שלך לשיוך החברה לשלב שנבחר..."
        onfocus="caLastEditable=this" oninput="caFieldInput(this)">${c.fields?.stageNote || ''}</div>
    </section>`;
}

function caQuartersBlockHTML(c) {
  return `
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
    </section>`;
}

// חצי הזזה למעלה/למטה — מוצגים רק על תמונות/גרפים, לא על הסעיפים הקבועים,
// כדי לא לבלגן את התצוגה של מה שכבר עובד. הבלוק עצמו יכול לזוז מעל/מתחת
// לכל בלוק אחר במסמך, כולל סעיפים קבועים.
function caBlockMoveCtrlsHTML(c, entryId) {
  const order = c.blockOrder || [];
  const idx = order.indexOf(entryId);
  return `<div class="doc-blk-move">
      <button class="doc-blk-move-btn" onclick="caMoveBlock('${entryId}',-1)" ${idx <= 0 ? 'disabled' : ''} title="הזז למעלה"><i class="ti ti-chevron-up"></i></button>
      <button class="doc-blk-move-btn" onclick="caMoveBlock('${entryId}',1)" ${idx === -1 || idx >= order.length - 1 ? 'disabled' : ''} title="הזז למטה"><i class="ti ti-chevron-down"></i></button>
    </div>`;
}

function caRerenderBlocks() {
  const c = caGet(caCurrentId);
  if (!c) return;
  document.getElementById('doc-blocks').innerHTML = caBlocksHTML(c);
  (c.charts || []).forEach(chart => caLoadChart('chart:' + chart.id));
}

// הזזת בלוק (תמונה/גרף) למעלה (-1) או למטה (+1) בסדר ההצגה — יכול לעקוף גם סעיפים קבועים
function caMoveBlock(entryId, dir) {
  caTouch(c => {
    caMigrateBlockOrder(c);
    const order = c.blockOrder;
    const idx = order.indexOf(entryId);
    const newIdx = idx + dir;
    if (idx === -1 || newIdx < 0 || newIdx >= order.length) return;
    [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
  });
  caRerenderBlocks();
}

function caDeleteBlock(entryId) {
  const isImage = entryId.startsWith('image:');
  if (!confirm(isImage ? 'למחוק את התמונה?' : 'למחוק את הגרף?')) return;
  caTouch(c => {
    caMigrateBlockOrder(c);
    c.blockOrder = c.blockOrder.filter(x => x !== entryId);
    if (isImage) c.images = c.images.filter(x => 'image:' + x.id !== entryId);
    else c.charts = c.charts.filter(x => 'chart:' + x.id !== entryId);
  });
  caRerenderBlocks();
}

// ── תמונות ──
function caAddImageBlock() {
  document.getElementById('ca-image-input').click();
}

function caHandleImageFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('יש לבחור קובץ תמונה'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    const src = new Image();
    src.onload = () => {
      // הקטנה/דחיסה לפני שמירה ב-localStorage — כדי לא לחרוג ממכסת האחסון
      // עם כמה תמונות גדולות בכמה ניתוחים.
      const maxW = 1000;
      const scale = Math.min(1, maxW / src.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(src.width * scale);
      canvas.height = Math.round(src.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const imgId = caUID();
      caTouch(c => {
        caMigrateBlockOrder(c);
        c.images.push({ id: imgId, dataUrl, caption: '', addedAt: Date.now() });
        c.blockOrder.push('image:' + imgId);
      });
      caRerenderBlocks();
      const el = document.querySelector(`.doc-img-block[data-block-id="image:${imgId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    src.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function caImageBlockHTML(c, entryId, img) {
  return `
    <section class="doc-section doc-block doc-img-block" data-block-id="${entryId}">
      <div class="doc-blk-head">
        ${caBlockMoveCtrlsHTML(c, entryId)}
        <i class="ti ti-photo doc-blk-icon"></i>
        <span class="doc-blk-title">תמונה</span>
        <button class="doc-blk-del" onclick="caDeleteBlock('${entryId}')" title="מחק תמונה"><i class="ti ti-x"></i></button>
      </div>
      <img class="doc-img-block-img" src="${img.dataUrl}" alt="">
      <input class="doc-img-caption" value="${caEsc(img.caption || '')}" placeholder="כיתוב לתמונה (אופציונלי)"
        oninput="caImageCaptionInput('${img.id}',this.value)">
    </section>`;
}

function caImageCaptionInput(imgId, value) {
  caTouch(c => { const img = (c.images || []).find(x => x.id === imgId); if (img) img.caption = value; });
}

// ── גרף נרות יפני חי (FMP) ──
// שולף פעם אחת טווח רחב (280 ימי מסחר) ושומר בזיכרון לפי entryId — מעבר בין
// טווחי התצוגה (1M/3M/6M/1Y) הוא רק פרוסה מהמטמון הקיים, בלי בקשה חוזרת ל-API.
const _caChartCache = {};

function caAddChartBlock() {
  const chartId = caUID();
  caTouch(c => {
    caMigrateBlockOrder(c);
    c.charts.push({ id: chartId, range: '3M', addedAt: Date.now() });
    c.blockOrder.push('chart:' + chartId);
  });
  caRerenderBlocks();
  const el = document.querySelector(`.doc-chart-block[data-block-id="chart:${chartId}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function caChartBlockHTML(c, entryId) {
  const chart = (c.charts || []).find(x => x.id === entryId.slice(6));
  const range = (chart && chart.range) || '3M';
  const cid = 'ca-chart-' + entryId.slice(6);
  return `
    <section class="doc-section doc-block doc-chart-block" data-block-id="${entryId}">
      <div class="doc-blk-head">
        ${caBlockMoveCtrlsHTML(c, entryId)}
        <i class="ti ti-chart-candle doc-blk-icon"></i>
        <span class="doc-blk-title">גרף נרות יפני · ${caEsc(c.symbol || '—')}</span>
        <div class="doc-chart-range">
          ${['1M', '3M', '6M', '1Y'].map(r => `<button type="button" class="doc-chart-range-btn${r === range ? ' sel' : ''}" onclick="caSetChartRange('${entryId}','${r}')">${r}</button>`).join('')}
        </div>
        <button class="doc-blk-refresh" onclick="caLoadChart('${entryId}', true)" title="רענן"><i class="ti ti-refresh"></i></button>
        <button class="doc-blk-del" onclick="caDeleteBlock('${entryId}')" title="מחק גרף"><i class="ti ti-x"></i></button>
      </div>
      <div class="doc-chart-body" id="${cid}"><div class="doc-chart-msg">טוען נתונים…</div></div>
      <div class="doc-chart-foot" id="${cid}-foot"></div>
    </section>`;
}

function caSetChartRange(entryId, range) {
  caTouch(c => { const chart = (c.charts || []).find(x => x.id === entryId.slice(6)); if (chart) chart.range = range; });
  const head = document.querySelector(`.doc-chart-block[data-block-id="${entryId}"] .doc-chart-range`);
  if (head) head.querySelectorAll('.doc-chart-range-btn').forEach(btn => btn.classList.toggle('sel', btn.textContent === range));
  const cached = _caChartCache[entryId];
  if (cached) caDrawChart(entryId, cached, range);
  else caLoadChart(entryId);
}

async function caLoadChart(entryId, force) {
  const c = caGet(caCurrentId);
  if (!c) return;
  const chart = (c.charts || []).find(x => x.id === entryId.slice(6));
  const symbol = (c.symbol || '').trim().toUpperCase();
  const cid = 'ca-chart-' + entryId.slice(6);
  const body = document.getElementById(cid);
  if (!symbol) { if (body) body.innerHTML = '<div class="doc-chart-msg">הזן סימבול כדי לטעון גרף</div>'; return; }
  const key = (typeof getFmpKey === 'function') ? getFmpKey() : '';
  if (!key) {
    if (body) body.innerHTML = `<div class="doc-chart-msg">נדרש מפתח API של FMP<button type="button" class="doc-chart-msg-btn" onclick="openSettings()">פתח הגדרות</button></div>`;
    return;
  }
  const range = (chart && chart.range) || '3M';
  const cached = _caChartCache[entryId];
  if (!force && cached && cached.symbol === symbol && (Date.now() - cached.fetchedAt) < 5 * 60 * 1000) {
    caDrawChart(entryId, cached, range);
    return;
  }
  if (body) body.innerHTML = '<div class="doc-chart-msg">טוען נתונים…</div>';
  try {
    const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(symbol)}?timeseries=280&apikey=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('http ' + res.status);
    const json = await res.json();
    const hist = (json && json.historical) || [];
    if (!hist.length) throw new Error('no data');
    const data = hist.map(d => ({ date: d.date, o: d.open, h: d.high, l: d.low, c: d.close })).sort((a, b) => a.date < b.date ? -1 : 1);
    const entry = { symbol, data, fetchedAt: Date.now() };
    _caChartCache[entryId] = entry;
    if (caCurrentId === c.id) caDrawChart(entryId, entry, range);
  } catch {
    if (body && caCurrentId === c.id) body.innerHTML = '<div class="doc-chart-msg">לא ניתן לטעון נתונים — בדוק את הסימבול ואת מפתח ה-API</div>';
  }
}

function caDrawChart(entryId, entry, range) {
  const cid = 'ca-chart-' + entryId.slice(6);
  const body = document.getElementById(cid);
  const foot = document.getElementById(cid + '-foot');
  if (!body) return;
  const days = { '1M': 22, '3M': 66, '6M': 132, '1Y': 260 }[range] || 66;
  const data = entry.data.slice(-days);
  if (!data.length) { body.innerHTML = '<div class="doc-chart-msg">אין נתונים</div>'; return; }
  body.innerHTML = '';
  body.appendChild(caBuildCandleSVG(data));
  if (foot) {
    const time = new Date(entry.fetchedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    foot.textContent = `נתונים חיים · Financial Modeling Prep · עודכן ${time}`;
  }
}

// צבעים לגרף — ערכים קבועים (לא משתני ערכת נושא), באותו סגנון כמו שאר
// דף הניתוח (doc-page): ה"נייר" תמיד בהיר, גם במצב כהה של שאר האפליקציה.
function caChartInk() {
  return { up: '#15803D', down: '#B91C1C', text: '#8a8a97', grid: 'rgba(26,26,46,.08)', last: '#6366F1' };
}

function caBuildCandleSVG(data) {
  const NS = 'http://www.w3.org/2000/svg';
  const ink = caChartInk();
  const W = 640, H = 220, padT = 10, padB = 22, padL = 4, padR = 46;
  let hi = Math.max(...data.map(d => d.h));
  let lo = Math.min(...data.map(d => d.l));
  const pad = (hi - lo) * 0.06 || 1;
  hi += pad; lo -= pad;
  const innerH = H - padT - padB, innerW = W - padL - padR;
  const n = data.length, step = innerW / n, cw = Math.max(1.5, step * 0.55);
  const y = v => padT + (hi - v) / (hi - lo) * innerH;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', H);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `גרף נרות יפני, ${n} ימי מסחר, סגירה אחרונה ${data[n - 1].c}`);
  [hi - pad, (hi + lo) / 2, lo + pad].forEach(v => {
    const ly = y(v);
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', padL); line.setAttribute('x2', W - padR);
    line.setAttribute('y1', ly); line.setAttribute('y2', ly);
    line.setAttribute('stroke', ink.grid); line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', W - padR + 6); t.setAttribute('y', ly + 3);
    t.setAttribute('font-size', '9'); t.setAttribute('font-family', 'IBM Plex Mono, monospace');
    t.setAttribute('fill', ink.text); t.textContent = v.toFixed(v < 10 ? 2 : 0);
    svg.appendChild(t);
  });
  data.forEach((d, i) => {
    const cx = padL + step * i + step / 2;
    const color = d.c >= d.o ? ink.up : ink.down;
    const wick = document.createElementNS(NS, 'line');
    wick.setAttribute('x1', cx); wick.setAttribute('x2', cx);
    wick.setAttribute('y1', y(d.h)); wick.setAttribute('y2', y(d.l));
    wick.setAttribute('stroke', color); wick.setAttribute('stroke-width', '1.2');
    svg.appendChild(wick);
    const bodyTop = y(Math.max(d.o, d.c));
    const bodyH = Math.max(1.2, Math.abs(y(d.o) - y(d.c)));
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', cx - cw / 2); rect.setAttribute('y', bodyTop);
    rect.setAttribute('width', cw); rect.setAttribute('height', bodyH);
    rect.setAttribute('fill', color); rect.setAttribute('rx', '1');
    svg.appendChild(rect);
    if (i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0) {
      const lbl = document.createElementNS(NS, 'text');
      lbl.setAttribute('x', cx); lbl.setAttribute('y', H - 6);
      lbl.setAttribute('font-size', '9'); lbl.setAttribute('font-family', 'IBM Plex Mono, monospace');
      lbl.setAttribute('fill', ink.text); lbl.setAttribute('text-anchor', 'middle');
      lbl.textContent = d.date.slice(5).replace('-', '/');
      svg.appendChild(lbl);
    }
  });
  const lastY = y(data[n - 1].c);
  const dash = document.createElementNS(NS, 'line');
  dash.setAttribute('x1', padL); dash.setAttribute('x2', W - padR);
  dash.setAttribute('y1', lastY); dash.setAttribute('y2', lastY);
  dash.setAttribute('stroke', ink.last); dash.setAttribute('stroke-width', '1');
  dash.setAttribute('stroke-dasharray', '2,3');
  svg.appendChild(dash);
  return svg;
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
        <input class="doc-fin-inp" type="text" inputmode="decimal" placeholder="—" value="${caEsc(q.revCurr||'')}" oninput="caQFin('${q.id}','revCurr',this.value)" onkeydown="caFinKeydown(event,'${q.id}','revCurr')" onblur="caFinBlur(event,'${q.id}','revCurr')">
        ${caFinEffTagHTML(`ca-eff-curr-${q.id}`, q.opCurr, q.revCurr)}
      </div>
      <div>
        <input class="doc-fin-inp" type="text" inputmode="decimal" placeholder="—" value="${caEsc(q.revPrev||'')}" oninput="caQFin('${q.id}','revPrev',this.value)" onkeydown="caFinKeydown(event,'${q.id}','revPrev')" onblur="caFinBlur(event,'${q.id}','revPrev')">
        ${caFinEffTagHTML(`ca-eff-prev-${q.id}`, q.opPrev, q.revPrev)}
      </div>
      <div class="doc-fin-badge ${revPct.cls}" id="ca-pct-rev-${q.id}">${revPct.text}</div>
    </div>
    <div class="doc-fin-row">
      <div class="doc-fin-lbl">הוצאות תפעוליות</div>
      <div class="doc-fin-cell">
        <input class="doc-fin-inp" id="ca-fin-opCurr-${q.id}" type="text" inputmode="decimal" placeholder="—" value="${caEsc(q.opCurr||'')}" ${(q.opCurrParts||[]).length ? 'readonly' : ''} oninput="caQFin('${q.id}','opCurr',this.value)" onkeydown="caFinKeydown(event,'${q.id}','opCurr')" onblur="caFinBlur(event,'${q.id}','opCurr')">
        <button type="button" class="doc-calc-toggle" onclick="caCalcToggle('${q.id}','opCurr')" title="חשב מכמה סעיפי הוצאה"><i class="ti ti-calculator"></i></button>
      </div>
      <div class="doc-fin-cell">
        <input class="doc-fin-inp" id="ca-fin-opPrev-${q.id}" type="text" inputmode="decimal" placeholder="—" value="${caEsc(q.opPrev||'')}" ${(q.opPrevParts||[]).length ? 'readonly' : ''} oninput="caQFin('${q.id}','opPrev',this.value)" onkeydown="caFinKeydown(event,'${q.id}','opPrev')" onblur="caFinBlur(event,'${q.id}','opPrev')">
        <button type="button" class="doc-calc-toggle" onclick="caCalcToggle('${q.id}','opPrev')" title="חשב מכמה סעיפי הוצאה"><i class="ti ti-calculator"></i></button>
      </div>
      <div class="doc-fin-badge ${opPct.cls}" id="ca-pct-op-${q.id}">${opPct.text}</div>
    </div>
    <div class="doc-calc-panel" id="ca-calc-opCurr-${q.id}" style="display:${(q.opCurrParts||[]).length ? 'block' : 'none'}">${caCalcRowsHTML(q.id, 'opCurr', q.opCurrParts || [])}</div>
    <div class="doc-calc-panel" id="ca-calc-opPrev-${q.id}" style="display:${(q.opPrevParts||[]).length ? 'block' : 'none'}">${caCalcRowsHTML(q.id, 'opPrev', q.opPrevParts || [])}</div>
    <div class="doc-fin-footer">
      <span>יחס הוצ׳/הכנ׳ (התייעלות)</span>
      <span class="doc-fin-badge ${effD.cls}" id="ca-eff-delta-${q.id}">${effD.text}</span>
    </div>
    <div class="doc-fin-row">
      <div class="doc-fin-lbl">רווח נקי</div>
      <input class="doc-fin-inp" type="text" inputmode="decimal" placeholder="—" value="${caEsc(q.niCurr||'')}" oninput="caQFin('${q.id}','niCurr',this.value)" onkeydown="caFinKeydown(event,'${q.id}','niCurr')" onblur="caFinBlur(event,'${q.id}','niCurr')">
      <input class="doc-fin-inp" type="text" inputmode="decimal" placeholder="—" value="${caEsc(q.niPrev||'')}" oninput="caQFin('${q.id}','niPrev',this.value)" onkeydown="caFinKeydown(event,'${q.id}','niPrev')" onblur="caFinBlur(event,'${q.id}','niPrev')">
      <div class="doc-fin-badge ${niRes.cls}" id="ca-ni-diff-${q.id}">${niRes.text}</div>
    </div>
    <div class="doc-fin-pe">
      <span>מכפיל רווח עתידי (Forward P/E)</span>
      <input class="doc-fin-inp doc-fin-pe-inp" type="text" placeholder="לדוגמה 24x" value="${caEsc(q.forwardPE||'')}" oninput="caQuarterInput('${q.id}','forwardPE',this.value)">
    </div>
  </div>`;
}

// ── מחשבון פירוט הוצאות — כשבדוח אין שורת "סה״כ הוצאות" אחת אלא כמה סעיפים
// (מו"פ, שיווק, הנהלה...), אפשר לפרק ולסכום אותם כאן ותקופה נוכחית/מקבילה
// מסתנכרנת אוטומטית לשדה "הוצאות תפעוליות" הראשי (שהופך לקריאה בלבד כל עוד
// יש פירוט פעיל) ולתגי האחוזים/ההתייעלות שתלויים בו ──
function caCalcRowsHTML(qid, field, parts) {
  const sum = parts.reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const label = field === 'opCurr' ? 'פירוט הוצאות — תקופה נוכחית' : 'פירוט הוצאות — תקופה מקבילה';
  return `
    <div class="doc-calc-hd">
      <span>${label}</span>
      <button type="button" onclick="caCalcClear('${qid}','${field}')" title="נקה פירוט וחזור להזנה ידנית"><i class="ti ti-trash"></i></button>
    </div>
    <div class="doc-calc-rows">
      ${parts.map((v, i) => `
        <div class="doc-calc-row">
          <button type="button" class="doc-calc-rm" onclick="caCalcRemoveRow('${qid}','${field}',${i})"><i class="ti ti-x"></i></button>
          <input class="doc-calc-inp" type="number" step="0.01" placeholder="סכום סעיף" value="${caEsc(v)}" oninput="caCalcRowInput('${qid}','${field}',${i},this.value)">
        </div>`).join('')}
    </div>
    <div class="doc-calc-foot">
      <button type="button" class="doc-calc-add" onclick="caCalcAddRow('${qid}','${field}')"><i class="ti ti-plus"></i>הוסף סעיף</button>
      <span class="doc-calc-total" id="ca-calc-total-${field}-${qid}">סה״כ: $${sum.toLocaleString('en', { maximumFractionDigits: 2 })}</span>
    </div>`;
}

function caCalcToggle(qid, field) {
  const panel = document.getElementById(`ca-calc-${field}-${qid}`);
  if (!panel) return;
  const willShow = panel.style.display === 'none' || !panel.style.display;
  if (willShow) {
    const c = caGet(caCurrentId);
    const q = c && (c.quarters || []).find(x => x.id === qid);
    if (q && !(q[field + 'Parts'] || []).length) caCalcAddRow(qid, field);
    panel.style.display = 'block';
  } else {
    panel.style.display = 'none';
  }
}

function caCalcRerenderRows(qid, field) {
  const c = caGet(caCurrentId);
  const q = c && (c.quarters || []).find(x => x.id === qid);
  const panel = document.getElementById(`ca-calc-${field}-${qid}`);
  if (panel && q) panel.innerHTML = caCalcRowsHTML(qid, field, q[field + 'Parts'] || []);
}

// מסנכרן את סכום הסעיפים לשדה הראשי (opCurr/opPrev) + לתגי האחוזים/ההתייעלות.
// כשאין סעיפים כלל — משחרר את השדה בחזרה לעריכה ידנית בלי לשנות את הערך שבו.
function caCalcSyncTotals(qid, field) {
  const c = caGet(caCurrentId);
  const q = c && (c.quarters || []).find(x => x.id === qid);
  if (!q) return;
  const parts = q[field + 'Parts'] || [];
  const inp = document.getElementById(`ca-fin-${field}-${qid}`);
  if (!parts.length) {
    if (inp) inp.removeAttribute('readonly');
    return;
  }
  const sum = parts.reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const totalEl = document.getElementById(`ca-calc-total-${field}-${qid}`);
  if (totalEl) totalEl.textContent = 'סה״כ: $' + sum.toLocaleString('en', { maximumFractionDigits: 2 });
  if (inp) { inp.value = sum; inp.setAttribute('readonly', 'readonly'); }
  caQFin(qid, field, sum);
}

function caCalcRowInput(qid, field, idx, value) {
  caTouch(c => { const q = (c.quarters || []).find(x => x.id === qid); if (q) { q[field + 'Parts'] = q[field + 'Parts'] || []; q[field + 'Parts'][idx] = value; } });
  caCalcSyncTotals(qid, field);
}

function caCalcAddRow(qid, field) {
  caTouch(c => { const q = (c.quarters || []).find(x => x.id === qid); if (q) { q[field + 'Parts'] = q[field + 'Parts'] || []; q[field + 'Parts'].push(''); } });
  caCalcRerenderRows(qid, field);
  caCalcSyncTotals(qid, field);
  const panel = document.getElementById(`ca-calc-${field}-${qid}`);
  const inputs = panel ? panel.querySelectorAll('.doc-calc-inp') : [];
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function caCalcRemoveRow(qid, field, idx) {
  caTouch(c => { const q = (c.quarters || []).find(x => x.id === qid); if (q && q[field + 'Parts']) q[field + 'Parts'].splice(idx, 1); });
  caCalcRerenderRows(qid, field);
  caCalcSyncTotals(qid, field);
}

function caCalcClear(qid, field) {
  caTouch(c => { const q = (c.quarters || []).find(x => x.id === qid); if (q) q[field + 'Parts'] = []; });
  const panel = document.getElementById(`ca-calc-${field}-${qid}`);
  if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
  const inp = document.getElementById(`ca-fin-${field}-${qid}`);
  if (inp) inp.removeAttribute('readonly');
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

// מחשב סכום מביטוי כמו "120+35.5+8" — מאפשר להקליד כמה מספרים ברצף ישר
// בתוך שדה הכנסות/הוצאות/רווח נקי בטבלה הכספית, בלי לפתוח מחשבון נפרד.
// מחזיר null אם הביטוי ריק/לא תקין, כדי שלא נדרוס שדה בטעות.
function caSumExpr(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  // "-" לפני מספר = מינוס (גם כשהוא מחובר לרצף "+", למשל "100-50" או "-50+20") —
  // הופכים כל "-" ל-"+-" לפני הפיצול, כך שהמספר השלילי נשאר צמוד לסימן שלו כאיבר נפרד.
  const parts = s.replace(/-/g, '+-').split('+').map(p => p.trim()).filter(p => p !== '');
  if (!parts.length) return null;
  let sum = 0;
  for (const p of parts) {
    const n = parseFloat(p.replace(/,/g, ''));
    if (isNaN(n)) return null;
    sum += n;
  }
  return Math.round(sum * 100) / 100;
}

// פותר ביטוי "+" בשדה בפועל: כותב את הסכום חזרה לשדה, שומר ומרענן תגים.
// אם הביטוי לא תקין (או ריק) — לא נוגע בשדה, כדי לא לדרוס בטעות.
function caFinResolve(el, qid, field) {
  const sum = caSumExpr(el.value);
  if (sum === null) return;
  el.value = sum;
  caQFin(qid, field, sum);
}
// Enter בשדה כספי בטבלה — פותר מיד ומוריד פוקוס לאישור ויזואלי.
function caFinKeydown(e, qid, field) {
  if (e.key !== 'Enter' && e.keyCode !== 13) return;
  e.preventDefault();
  caFinResolve(e.target, qid, field);
  e.target.blur();
}
// יציאה מהשדה (קליק במקום אחר וכו') — פותר גם אם המשתמש לא לחץ אנטר,
// כדי שלא יישאר ביטוי לא פתור ("100+50") שמור בטעות.
function caFinBlur(e, qid, field) {
  caFinResolve(e.target, qid, field);
}

function caQuartersHTML(c) {
  const qs = c.quarters || [];
  if (!qs.length) {
    return `<div class="doc-q-empty">אין דיווחים עדיין. לחץ "הוסף דיווח" כדי לתעד דוח רבעוני.</div>`;
  }
  return qs.map((q, i) => `
    <div class="doc-quarter${q.collapsed ? ' collapsed' : ''}" data-qid="${q.id}">
      <div class="doc-q-head">
        <button class="doc-q-collapse" onclick="caToggleCollapse('${q.id}')" title="קפל/הרחב דיווח"><i class="ti ti-chevron-down"></i></button>
        <input class="doc-q-label" value="${caEsc(q.label)}" placeholder="Q1 2026 · שווי שוק"
          oninput="caQuarterInput('${q.id}','label',this.value)">
        <div class="doc-q-move">
          <button class="doc-q-move-btn" onclick="caMoveQuarter('${q.id}',-1)" ${i === 0 ? 'disabled' : ''} title="הזז למעלה"><i class="ti ti-chevron-up"></i></button>
          <button class="doc-q-move-btn" onclick="caMoveQuarter('${q.id}',1)" ${i === qs.length - 1 ? 'disabled' : ''} title="הזז למטה"><i class="ti ti-chevron-down"></i></button>
        </div>
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
    id: qid, label: '', text: '', concl: '', collapsed: false,
    revCurr: '', revPrev: '', opCurr: '', opPrev: '', niCurr: '', niPrev: '', forwardPE: '',
    opCurrParts: [], opPrevParts: [],
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

// קיפול/פתיחה של כרטיס דיווח — רק מחליף מחלקת CSS (בלי רינדור מחדש) כדי לא
// לאבד פוקוס/מצב בשאר הכרטיסים, ונשמר כדי שהמצב יישאר גם אחרי רענון.
function caToggleCollapse(qid) {
  caTouch(c => { const q = (c.quarters || []).find(x => x.id === qid); if (q) q.collapsed = !q.collapsed; });
  const card = document.querySelector(`.doc-quarter[data-qid="${qid}"]`);
  if (card) card.classList.toggle('collapsed');
}

// הזזת דיווח למעלה (-1) או למטה (+1) בסדר ההצגה
function caMoveQuarter(qid, dir) {
  caTouch(c => {
    const qs = c.quarters || [];
    const idx = qs.findIndex(x => x.id === qid);
    const newIdx = idx + dir;
    if (idx === -1 || newIdx < 0 || newIdx >= qs.length) return;
    [qs[idx], qs[newIdx]] = [qs[newIdx], qs[idx]];
  });
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
