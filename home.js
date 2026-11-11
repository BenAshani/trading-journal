/*
  home.js — עמוד הבית של Bloomfield Capital
  ההחזקות (מפת אריחים + רשימה), המסקנה של היום, המשימות ותכנון החלוקה.
  התוכן של ה-AI (מסקנה, שאלות, תוכנית) נטען מ-ai-analysis.json, שמתעדכן כל יום מסחר.
  התשובות, המשימות שסומנו והיעדים נשמרים ב-tj_home_v1 (מסונכרן לענן דרך sv).
*/

(function () {
  const HOME_KEY = 'tj_home_v1';
  const FAMILY = {
    index:   { label: 'מדד',          shades: ['#248A3D', '#67C17A', '#A8DDB5'] },
    bigtech: { label: 'טק גדול',      shades: ['#5856D6', '#B9A6F5', '#8E8CE8'] },
    spec:    { label: 'ספקולטיבית',   shades: ['#C93400', '#F2662E', '#F7A38A', '#E04E39'] },
    other:   { label: 'אחר',          shades: ['#30B0C7', '#7FD3E0', '#0F7C8F'] },
    cash:    { label: 'מזומן',        shades: ['#AEAEB2'] },
  };
  const LIGHT_TEXT_ON = ['#248A3D', '#5856D6', '#C93400', '#0F7C8F'];

  let ai = null;           // ai-analysis.json
  let loadingAI = false;
  let view = 'overview';   // overview | tasks | builder
  let tmMode = 'family';   // family | loss
  let owner = (() => { try { return localStorage.getItem('tj_port_owner') === 'dad' ? 'dad' : 'me'; } catch { return 'me'; } })();

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v, sign) => {
    const a = Math.abs(Math.round(v)).toLocaleString('en-US');
    if (!sign) return '$' + a;
    return (v > 0.5 ? '+$' : v < -0.5 ? '−$' : '$') + a;
  };
  const pct = (v, sign) => {
    const s = Math.abs(v).toFixed(1) + '%';
    if (!sign) return s;
    return (v > 0.05 ? '+' : v < -0.05 ? '−' : '') + s;
  };

  function state() {
    try { return JSON.parse(localStorage.getItem(HOME_KEY) || '{}') || {}; } catch { return {}; }
  }
  function saveState(s) {
    if (typeof sv === 'function') sv(HOME_KEY, s);
    else localStorage.setItem(HOME_KEY, JSON.stringify(s));
  }
  function patch(path, value) {
    const s = state();
    s[owner] = s[owner] || {};
    s[owner][path] = Object.assign({}, s[owner][path] || {}, value);
    saveState(s);
  }

  async function loadAI() {
    if (ai || loadingAI) return;
    loadingAI = true;
    try {
      const r = await fetch('ai-analysis.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) ai = await r.json();
    } catch (e) { console.warn('[home] ai-analysis.json', e); }
    loadingAI = false;
    if (!ai) ai = { groups: {}, owners: {} };
    renderHome();
  }

  // ── נתוני התיק ──
  function holdingsFor(who) {
    const key = who === 'dad' ? 'tj_port_dad_v1' : 'tj_port_v4';
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}
    return list.filter(h => (h.remainingQty ?? h.qty) > 0);
  }
  function cashFor(who) {
    return parseFloat(localStorage.getItem(who === 'dad' ? 'tj_invest_cash_dad' : 'tj_invest_cash')) || 0;
  }
  function familyOf(h) {
    const g = ai && ai.groups && ai.groups[h.ticker];
    if (g && FAMILY[g]) return g;
    if (h.sector && /מדד|ETF/i.test(h.sector)) return 'index';
    return 'other';
  }
  function quote(t) { return (typeof priceCache !== 'undefined' && priceCache[t]) || null; }

  function buildRows() {
    const hs = holdingsFor(owner);
    const cash = cashFor(owner);
    const used = {};
    let cost = 0, value = 0, today = 0, prevValue = 0, priced = 0;
    const rows = hs.map(h => {
      const qty = h.remainingQty ?? h.qty;
      const q = quote(h.ticker);
      const price = q && q.price ? q.price : h.avgCost;
      if (q && q.price) priced++;
      const v = qty * price, c = qty * h.avgCost;
      const prev = q && q.prevClose ? qty * q.prevClose : v;
      cost += c; value += v; today += v - prev; prevValue += prev;
      const fam = familyOf(h);
      const i = used[fam] = (used[fam] ?? -1) + 1;
      const shades = FAMILY[fam].shades;
      return { t: h.ticker, fam, color: shades[i % shades.length], value: v, pl: v - c, plPct: c ? (v / c - 1) * 100 : 0, qty };
    });
    const total = value + cash;
    if (cash > 0) rows.push({ t: 'מזומן', fam: 'cash', color: FAMILY.cash.shades[0], value: cash, pl: null, plPct: null, isCash: true });
    rows.forEach(r => { r.w = total ? r.value / total * 100 : 0; });
    rows.sort((a, b) => b.value - a.value);
    return {
      rows, total, cost, stockValue: value, cash,
      pl: value - cost, plPct: cost ? (value / cost - 1) * 100 : 0,
      today, todayPct: (prevValue + cash) ? today / (prevValue + cash) * 100 : 0,
      allPriced: priced === hs.length,
    };
  }

  // ── עזרי עיצוב ──
  const lossColor = p => p == null ? '#E5F0FF' : p > -10 ? '#FADBD2' : p > -20 ? '#F29A80' : '#C93400';
  const textOn = bg => LIGHT_TEXT_ON.indexOf(bg) >= 0 ? '#FFFFFF' : '#1C1C1E';
  const tileBg = r => tmMode === 'loss' ? lossColor(r.plPct) : r.color;

  function tile(r, big) {
    const bg = tileBg(r), fg = textOn(bg);
    const sub = r.w.toFixed(1) + '% · ' + money(r.value) + (r.isCash ? '' : ' · ' + pct(r.plPct, true));
    const showSub = big || r.w >= 6;
    return `<div class="bc-tile${big ? ' big' : ''}" style="flex:${r.w.toFixed(2)} 1 0;background:${bg};color:${fg}">
      <span class="bc-tile-name" dir="ltr">${esc(r.t)}</span>
      ${big ? `<span class="bc-tile-pct" dir="ltr">${r.w.toFixed(1)}%</span>` : ''}
      ${showSub ? `<span class="bc-tile-sub" dir="ltr">${esc(big ? money(r.value) + (r.isCash ? '' : ' · ' + pct(r.plPct, true)) : sub)}</span>` : ''}
    </div>`;
  }

  function treemap(d) {
    if (!d.rows.length) return '<div class="bc-empty">אין עדיין החזקות בתיק הזה</div>';
    const [first, ...rest] = d.rows;
    const restW = rest.reduce((a, r) => a + r.w, 0);
    let rowsHtml = '';
    for (let i = 0; i < rest.length; i += 2) {
      const pair = rest.slice(i, i + 2);
      const rw = pair.reduce((a, r) => a + r.w, 0);
      rowsHtml += `<div class="bc-tm-row" style="flex:${rw.toFixed(2)} 1 0">${pair.map(r => tile(r)).join('')}</div>`;
    }
    const label = 'מפת הרכב התיק: ' + d.rows.map(r => r.t + ' ' + r.w.toFixed(1) + '%').join(', ');
    return `<div class="bc-tm" role="img" aria-label="${esc(label)}">
      ${tile(first, true)}
      ${rest.length ? `<div class="bc-tm-rest" style="flex:${restW.toFixed(2)} 1 0">${rowsHtml}</div>` : ''}
    </div>`;
  }

  function legend() {
    const sw = c => `<span class="bc-sw" style="background:${c}"></span>`;
    if (tmMode === 'loss') {
      return [['מזומן', '#E5F0FF'], ['עד −10%', '#FADBD2'], ['−10% עד −20%', '#F29A80'], ['מעל −20%', '#C93400']]
        .map(([l, c]) => `<span>${sw(c)}${l}</span>`).join('');
    }
    return ['index', 'bigtech', 'spec', 'other', 'cash'].map(k => `<span>${sw(FAMILY[k].shades[0])}${FAMILY[k].label}</span>`).join('');
  }

  function holdingsList(d) {
    return d.rows.map(r => `
      <button type="button" class="bc-hrow" onclick="${r.isCash ? '' : "nav('portfolio',document.querySelector('[data-page=portfolio]'))"}">
        <span class="bc-dot" style="background:${r.color}"></span>
        <span class="bc-hrow-main"><span class="bc-hrow-t" dir="ltr">${esc(r.t)}</span><span class="bc-hrow-s">${FAMILY[r.fam].label} · ${r.w.toFixed(1)}%</span></span>
        <span class="bc-hrow-end"><span class="bc-hrow-v" dir="ltr">${money(r.value)}</span>${r.isCash ? '' : `<span class="bc-hrow-p ${r.pl >= 0 ? 'up' : 'down'}" dir="ltr">${pct(r.plPct, true)}</span>`}</span>
        <i class="ti ti-chevron-left" aria-hidden="true"></i>
      </button>`).join('');
  }

  function ownerData() { return (ai && ai.owners && ai.owners[owner]) || null; }

  function verdictsHtml(od) {
    const st = (state()[owner] || {}).added || {};
    const tone = { warn: '#F2662E', info: '#64A8FF', calm: '#8DB3EA' };
    return (od.verdicts || []).map((v, i) => {
      const on = !!st[i];
      return `<div class="bc-verdict"><span class="bc-vdot" style="background:${tone[v.tone] || '#8DB3EA'}"></span>
        <span class="bc-vtext">${esc(v.text)}</span>
        <button type="button" class="bc-pill ${on ? 'on' : ''}" aria-pressed="${on}" onclick="bcHome.addVerdict(${i})">${on ? 'נוסף למשימות' : '+ למשימה'}</button></div>`;
    }).join('');
  }

  function counts(od) {
    const s = state()[owner] || {};
    const ans = s.answers || {}, done = s.done || {}, added = s.added || {};
    const qOpen = (od.questions || []).filter(q => ans[q.id] == null).length;
    let total = 0, doneN = 0;
    (od.plan || []).forEach((step, si) => step.items.forEach((_, ii) => { total++; if (done[si + ':' + ii]) doneN++; }));
    (od.verdicts || []).forEach((v, i) => { if (added[i]) { total++; if (done['v:' + i]) doneN++; } });
    return { qOpen, total, doneN, pending: qOpen + total - doneN };
  }

  function tasksHtml(od) {
    const s = state()[owner] || {};
    const ans = s.answers || {}, done = s.done || {}, added = s.added || {};
    const c = counts(od);
    const qs = (od.questions || []).map(q => {
      const a = ans[q.id];
      const isNew = a == null;
      return `<div class="bc-q ${isNew ? 'new' : ''}">
        <div class="bc-q-head"><span class="bc-qdot"></span><span class="bc-q-tag" dir="ltr">${esc(q.tag)}</span><span class="bc-q-meta">${isNew ? 'חדש' : 'נענתה'}</span></div>
        <p class="bc-q-text">${esc(q.text)}</p>
        <p class="bc-q-ctx">${esc(q.context)}</p>
        <div class="bc-q-opts">${q.opts.map((o, i) => `<button type="button" class="bc-pill ${a === i ? 'on' : ''}" aria-pressed="${a === i}" onclick="bcHome.answer('${esc(q.id)}',${i})">${esc(o)}</button>`).join('')}</div>
        ${isNew ? '' : `<p class="bc-q-next">${esc(q.next[a])}</p>`}
      </div>`;
    }).join('');
    const check = (key, text) => {
      const d = !!done[key];
      return `<button type="button" class="bc-check ${d ? 'done' : ''}" aria-pressed="${d}" onclick="bcHome.toggle('${key}')"><span class="bc-box">${d ? '<i class="ti ti-check"></i>' : ''}</span><span>${esc(text)}</span></button>`;
    };
    const addedItems = (od.verdicts || []).map((v, i) => added[i] ? check('v:' + i, v.text) : '').join('');
    const steps = (od.plan || []).map((step, si) => {
      const n = step.items.filter((_, ii) => done[si + ':' + ii]).length;
      return `<div class="bc-step"><div class="bc-step-head"><span class="bc-chip">${esc(step.when)}</span><span class="bc-muted">${n} מתוך ${step.items.length}</span></div>
        ${step.items.map((t, ii) => check(si + ':' + ii, t)).join('')}</div>`;
    }).join('');
    const prog = c.total ? Math.round(c.doneN / c.total * 100) : 0;
    return `<section class="bc-card bc-tasks">
      <div class="bc-tasks-head">
        <div class="bc-bell"><span class="bc-bell-ic"><i class="ti ti-bell"></i></span>${c.pending ? `<span class="bc-badge">${c.pending}</span>` : ''}</div>
        <div><h2>המשימות שלך</h2><span class="bc-muted">${c.qOpen} החלטות חדשות · ${c.total - c.doneN} משימות פתוחות</span></div>
        <div class="bc-progress"><span>${c.doneN} מתוך ${c.total} הושלמו</span><div class="bc-bar"><div style="width:${prog}%"></div></div></div>
      </div>
      <div class="bc-qs">${qs}</div>
      <div class="bc-steps">${addedItems ? `<div class="bc-step"><div class="bc-step-head"><span class="bc-chip">שהוספת</span></div>${addedItems}</div>` : ''}${steps}</div>
    </section>`;
  }

  function builderHtml(d) {
    const s = state()[owner] || {};
    const tg = s.targets || {};
    const buckets = d.rows.map(r => ({ id: r.t, name: r.isCash ? 'מזומן' : r.t, desc: FAMILY[r.fam].label, now: +r.w.toFixed(1), color: r.color }));
    if (!buckets.find(b => b.id === 'broad')) buckets.splice(1, 0, { id: 'broad', name: 'מדד רחב', desc: 'מדד · למשל S&P 500 או מדד עולמי', now: 0, color: FAMILY.index.shades[1] });
    if (owner === 'dad' && !buckets.find(b => b.id === 'bonds')) buckets.push({ id: 'bonds', name: 'אג״ח', desc: 'תנודתיות נמוכה, תשואה צפויה נמוכה', now: 0, color: '#30B0C7' });
    let sum = 0;
    const rows = buckets.map(b => {
      const t = tg[b.id] != null ? tg[b.id] : b.now;
      sum += t;
      const diff = Math.round((t - b.now) / 100 * d.total);
      return `<div class="bc-brow">
        <div class="bc-brow-main"><span class="bc-brow-n" dir="auto">${esc(b.name)}</span><span class="bc-muted">${esc(b.desc)}</span></div>
        <div class="bc-brow-bar"><div class="bc-track"><div class="bc-fill" style="width:${Math.min(100, t)}%;background:${b.color}"></div><div class="bc-mark" style="right:calc(${Math.min(100, b.now)}% - 1px)"></div></div><span class="bc-muted">היום ${b.now}%</span></div>
        <div class="bc-stepper"><button type="button" aria-label="להפחית את ${esc(b.name)} ב-5%" onclick="bcHome.target('${esc(b.id)}',${t - 5})">−</button><span dir="ltr">${(+t.toFixed(1))}%</span><button type="button" aria-label="להגדיל את ${esc(b.name)} ב-5%" onclick="bcHome.target('${esc(b.id)}',${t + 5})">+</button></div>
        <span class="bc-move ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}" dir="ltr">${diff === 0 ? 'ללא שינוי' : money(diff, true)}</span>
      </div>`;
    }).join('');
    sum = Math.round(sum * 10) / 10;
    return `<section class="bc-card">
      <h2>${owner === 'me' ? 'לתכנן את חלוקת התיק' : 'לבנות גרסה פחות אגרסיבית'}</h2>
      <p class="bc-muted" style="margin:4px 0 18px">משחקים עם החלוקה ורואים כמה כסף צריך להעביר בין ההחזקות. שום דבר לא מתבצע בחשבון.</p>
      <div class="bc-brows">${rows}</div>
      <div class="bc-bfoot"><span class="${Math.abs(sum - 100) < 0.05 ? 'ok' : 'bad'}">סה״כ ${sum}%${Math.abs(sum - 100) < 0.05 ? ', החלוקה תקינה' : ', צריך להגיע ל-100%'}</span>
        <button type="button" class="bc-link" onclick="bcHome.resetTargets()">לאפס למצב הנוכחי</button></div>
    </section>`;
  }

  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב';
  }

  function renderHome() {
    const root = document.getElementById('home-root');
    if (!root) return;
    if (!ai) { loadAI(); root.innerHTML = '<div class="bc-empty">טוען…</div>'; return; }
    const d = buildRows();
    const od = ownerData();
    const c = od ? counts(od) : { pending: 0 };
    const upd = ai.updatedAt ? new Date(ai.updatedAt) : null;
    const updTxt = upd && !isNaN(upd) ? 'הניתוח עודכן ב-' + upd.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' }) + ', ' + upd.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';
    const tab = (id, label, badge) => `<button type="button" role="tab" class="bc-tab ${view === id ? 'on' : ''}" aria-selected="${view === id}" onclick="bcHome.view('${id}')">${label}${badge ? `<span class="bc-badge sm">${badge}</span>` : ''}</button>`;

    let body = '';
    if (view === 'overview') {
      body = `<section class="bc-hold">
        <div class="bc-card bc-tm-card">
          <div class="bc-row-between"><h2>הרכב התיק</h2>
            <div class="bc-seg sm" role="group" aria-label="צבע לפי"><span class="bc-muted">צבע לפי</span>
              <button type="button" class="${tmMode === 'family' ? 'on' : ''}" aria-pressed="${tmMode === 'family'}" onclick="bcHome.tm('family')">סוג</button>
              <button type="button" class="${tmMode === 'loss' ? 'on' : ''}" aria-pressed="${tmMode === 'loss'}" onclick="bcHome.tm('loss')">הפסד</button></div>
          </div>
          ${treemap(d)}
          <div class="bc-legend">${legend()}</div>
        </div>
        <div class="bc-card bc-list-card">
          <span class="bc-muted">שווי התיק</span>
          <span class="bc-total" dir="ltr">${money(d.total)}</span>
          <div class="bc-perf">
            <span class="bc-tag ${d.pl >= 0 ? 'up' : 'down'}" dir="ltr">${money(d.pl, true)} · ${pct(d.plPct, true)}</span><span class="bc-muted">מאז הקנייה</span>
            <span class="bc-tag ${d.today >= 0 ? 'up' : 'down'}" dir="ltr">${money(d.today, true)} · ${pct(d.todayPct, true)}</span><span class="bc-muted">היום</span>
          </div>
          ${d.allPriced ? '' : '<span class="bc-muted bc-note">חלק מהמחירים עוד נטענים, בינתיים מוצג מחיר הקנייה</span>'}
          <div class="bc-hlist">${holdingsList(d)}</div>
        </div>
      </section>
      ${od ? `<section class="bc-card bc-concl"><p class="bc-headline">${esc(od.headline)}</p><div class="bc-verdicts">${verdictsHtml(od)}</div></section>` : ''}`;
    } else if (view === 'tasks') {
      body = od ? tasksHtml(od) : '<div class="bc-empty">אין עדיין משימות לתיק הזה</div>';
    } else {
      body = builderHtml(d);
    }

    root.innerHTML = `
      <header class="bc-head">
        <div><h1>${greeting()}, בן</h1><p class="bc-muted">${esc(updTxt)}</p></div>
        <div class="bc-seg" role="group" aria-label="בחירת תיק">
          <button type="button" class="${owner === 'me' ? 'on' : ''}" aria-pressed="${owner === 'me'}" onclick="bcHome.owner('me')">התיק שלי</button>
          <button type="button" class="${owner === 'dad' ? 'on' : ''}" aria-pressed="${owner === 'dad'}" onclick="bcHome.owner('dad')">התיק של אבא</button>
        </div>
      </header>
      <div class="bc-tabs" role="tablist" aria-label="חלקי עמוד הבית">
        ${tab('overview', 'סקירה')}${tab('tasks', 'משימות', c.pending)}${tab('builder', 'תכנון חלוקה')}
      </div>
      ${body}
      <p class="bc-foot">הניתוח נכתב על ידי AI לצורכי לימוד. הוא לא ייעוץ השקעות, וההחלטות שלך.</p>`;

    document.querySelectorAll('[data-home-badge]').forEach(el => { el.textContent = c.pending || ''; el.style.display = c.pending ? '' : 'none'; });
  }

  async function refreshPrices() {
    if (typeof fetchPrices !== 'function') return;
    const tickers = holdingsFor('me').concat(holdingsFor('dad')).map(h => h.ticker);
    try { await fetchPrices(tickers); } catch (e) { console.warn('[home] prices', e); }
    renderHome();
  }

  window.bcHome = {
    render: () => { renderHome(); refreshPrices(); },
    view: v => { view = v; renderHome(); },
    tm: m => { tmMode = m; renderHome(); },
    owner: o => { owner = o; renderHome(); },
    answer: (id, i) => { const cur = ((state()[owner] || {}).answers || {})[id]; patch('answers', { [id]: cur === i ? null : i }); renderHome(); },
    toggle: key => { const cur = ((state()[owner] || {}).done || {})[key]; patch('done', { [key]: !cur }); renderHome(); },
    addVerdict: i => { const cur = ((state()[owner] || {}).added || {})[i]; patch('added', { [i]: !cur }); renderHome(); },
    target: (id, v) => { patch('targets', { [id]: Math.max(0, Math.min(100, Math.round(v * 10) / 10)) }); renderHome(); },
    resetTargets: () => { const s = state(); if (s[owner]) delete s[owner].targets; saveState(s); renderHome(); },
  };

  function boot() { bcHome.render(); }
  if (window.tjReady) boot(); else window.addEventListener('tj-ready', boot, { once: true });
})();
