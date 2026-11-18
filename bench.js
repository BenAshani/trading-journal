/*
  bench.js — התיק מול S&P 500
  השוואה הוגנת שמתחשבת בעיתוי: כל קנייה בתיק "נקנית" גם ב-VOO באותו יום
  ובאותו סכום, וכל מכירה "נמכרת" מ-VOO באותו סכום. כך שני התיקים קיבלו
  בדיוק אותו כסף באותם ימים, וההבדל ביניהם הוא רק בחירת המניות.
  מחירים היסטוריים מ-Financial Modeling Prep (אותו מפתח של גרף הנרות),
  עם מטמון יומי מקומי שלא מסונכרן לענן (המפתח לא מתחיל ב-tj_).
*/

const BENCH_SYM = 'VOO';
const BENCH_CACHE = 'bc_px_v1:';
let benchChart = null;
let benchRun = 0;

const benchToday = () => new Date().toISOString().slice(0, 10);
const benchMinus = (d, days) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - days); return t.toISOString().slice(0, 10); };

// היסטוריית סגירות: [[date, close], ...] ממוינת מהישן לחדש
async function benchHistory(sym, from) {
  const key = BENCH_CACHE + sym;
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && c.day === benchToday() && c.from <= from && c.data && c.data.length) return c.data;
  } catch {}
  const k = encodeURIComponent(getFmpKey());
  const s = encodeURIComponent(sym);
  const urls = [
    `https://financialmodelingprep.com/api/v3/historical-price-full/${s}?from=${from}&serietype=line&apikey=${k}`,
    `https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${s}&from=${from}&apikey=${k}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      const rows = Array.isArray(json) ? json : (json && json.historical) || [];
      const data = rows
        .map(r => [r.date, +(r.close ?? r.price)])
        .filter(r => r[0] && r[1] > 0)
        .sort((a, b) => (a[0] < b[0] ? -1 : 1));
      if (!data.length) continue;
      try { localStorage.setItem(key, JSON.stringify({ day: benchToday(), from, data })); } catch {}
      return data;
    } catch {}
  }
  return null;
}

// מחיר סגירה ביום נתון — היום האחרון שלפניו (סופ"ש/חג), או הראשון אחריו
function benchCloseOn(data, d) {
  let lo = 0, hi = data.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (data[m][0] <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans >= 0 ? data[ans][1] : data[0][1];
}

// כל תזרימי הכסף של התיק: קניות (כסף נכנס) ומכירות (כסף יוצא)
function benchFlows(list) {
  const flows = [];
  (list || []).forEach(h => {
    holdingBuys(h).forEach(b => { if (b.date && +b.qty > 0 && +b.price > 0) flows.push({ date: b.date, ticker: h.ticker, qty: +b.qty, amt: +b.price * +b.qty }); });
    (h.sales || []).forEach(sl => { if (sl.date && +sl.qty > 0) flows.push({ date: sl.date, ticker: h.ticker, qty: -sl.qty, amt: -(+sl.price * +sl.qty) }); });
  });
  return flows.sort((a, b) => (a.date < b.date ? -1 : 1));
}

function benchCard(inner) {
  const el = document.getElementById('port-bench');
  if (!el) return;
  el.innerHTML = inner;
  el.style.display = inner ? '' : 'none';
}

async function renderBenchmark() {
  const run = ++benchRun;
  const flows = benchFlows(portfolio);
  if (!flows.length) { benchCard(''); return; }
  const head = `<div class="bench-head"><div><h2>התיק מול S&amp;P 500</h2>
    <p class="bc-muted">אותו כסף, באותם ימים — אילו היה נכנס ל-${BENCH_SYM} במקום</p></div></div>`;
  if (!getFmpKey()) {
    benchCard(`<section class="bench-card">${head}<div class="bench-msg"><i class="ti ti-key"></i>
      <span>כדי להשוות צריך מפתח של Financial Modeling Prep (אותו מפתח של גרף הנרות)</span>
      <button class="btn-s" onclick="openSettings()">פתח הגדרות</button></div></section>`);
    return;
  }
  benchCard(`<section class="bench-card">${head}<div class="bench-msg"><i class="ti ti-loader-2 bench-spin"></i><span>טוען מחירים היסטוריים…</span></div></section>`);

  const from = benchMinus(flows[0].date, 7);
  const tickers = [...new Set(flows.map(f => f.ticker))];
  const [bench, ...hists] = await Promise.all([benchHistory(BENCH_SYM, from), ...tickers.map(t => benchHistory(t, from))]);
  if (run !== benchRun) return;   // נטען תיק אחר בינתיים (שלי / אבא)
  if (!bench) {
    benchCard(`<section class="bench-card">${head}<div class="bench-msg"><i class="ti ti-cloud-off"></i><span>לא ניתן לטעון את מחירי ${BENCH_SYM} — בדוק את מפתח ה-API</span></div></section>`);
    return;
  }
  const px = {};
  tickers.forEach((t, i) => { if (hists[i]) px[t] = hists[i]; });
  const missing = tickers.filter(t => !px[t]);

  // ציר הזמן: ימי המסחר של VOO מהקנייה הראשונה ועד היום
  const days = bench.map(r => r[0]).filter(d => d >= flows[0].date);
  if (!days.length) days.push(bench[bench.length - 1][0]);

  const held = {};
  let vooSh = 0, invested = 0, withdrawn = 0, fi = 0;
  const mine = [], voo = [];
  days.forEach(d => {
    while (fi < flows.length && flows[fi].date <= d) {
      const f = flows[fi++];
      held[f.ticker] = (held[f.ticker] || 0) + f.qty;
      vooSh += f.amt / benchCloseOn(bench, f.date);
      if (f.amt > 0) invested += f.amt; else withdrawn += -f.amt;
    }
    let val = 0, ok = true;
    for (const t in held) {
      if (Math.abs(held[t]) < 1e-9) continue;
      if (!px[t]) { ok = false; break; }
      val += held[t] * benchCloseOn(px[t], d);
    }
    // רווח מצטבר בדולרים: שווי נוכחי + כסף שיצא − כסף שנכנס
    mine.push(ok ? +(val + withdrawn - invested).toFixed(2) : null);
    voo.push(+(vooSh * benchCloseOn(bench, d) + withdrawn - invested).toFixed(2));
  });

  const myPnl = mine[mine.length - 1];
  const vPnl  = voo[voo.length - 1];
  const myPct = invested ? myPnl / invested * 100 : null;
  const vPct  = invested ? vPnl / invested * 100 : null;
  const diff  = myPnl !== null ? myPnl - vPnl : null;
  const beat  = diff !== null && diff >= 0;
  const usd = v => (v >= 0 ? '+' : '−') + '$' + Math.abs(v).toLocaleString('en', { maximumFractionDigits: 0 });
  const pct = v => v === null ? '' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%';

  benchCard(`<section class="bench-card">
    ${head}
    <div class="bench-nums">
      <div class="bench-num"><span class="bc-muted">התיק שלך</span><b dir="ltr" class="${myPnl === null ? '' : myPnl >= 0 ? 'up' : 'down'}">${myPnl === null ? '—' : usd(myPnl)}</b><span class="bc-muted" dir="ltr">${pct(myPct)}</span></div>
      <div class="bench-num"><span class="bc-muted">אילו ב-${BENCH_SYM}</span><b dir="ltr" class="${vPnl >= 0 ? 'up' : 'down'}">${usd(vPnl)}</b><span class="bc-muted" dir="ltr">${pct(vPct)}</span></div>
      <div class="bench-num bench-verdict ${diff === null ? '' : beat ? 'win' : 'lose'}">
        <span>${diff === null ? 'חסרים מחירים' : beat ? 'ניצחת את השוק' : 'השוק ניצח'}</span>
        <b dir="ltr">${diff === null ? '—' : usd(diff)}</b>
        <span dir="ltr">${diff === null ? '' : pct(myPct - vPct) + ' נק׳'}</span>
      </div>
    </div>
    <div class="bench-chart"><canvas id="bench-canvas"></canvas></div>
    <div class="bench-legend"><span><i style="background:var(--color-accent)"></i>התיק שלך</span><span><i style="background:#8E8E93"></i>${BENCH_SYM} באותם תזרימים</span></div>
    <p class="bench-foot">מאז ${flows[0].date} · הושקעו $${Math.round(invested).toLocaleString('en')}${missing.length ? ` · ללא מחירים ל-${missing.join(', ')}` : ''} · מחירי סגירה מ-FMP</p>
  </section>`);

  if (typeof Chart === 'undefined') return;
  if (benchChart) { benchChart.destroy(); benchChart = null; }
  const canvas = document.getElementById('bench-canvas');
  if (!canvas) return;
  canvas.style.direction = 'ltr';   // סימני +/− ו-$ במקום הנכון על הצירים
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const accent = dark ? '#0A84FF' : '#007AFF';
  const ink = chartInk();
  benchChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: days,
      datasets: [
        { label: 'התיק שלך', data: mine, borderColor: accent, backgroundColor: 'rgba(0,122,255,0.08)', fill: true, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.2, spanGaps: true },
        { label: BENCH_SYM, data: voo, borderColor: '#8E8E93', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2, fill: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y === null ? '—' : usd(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 13, family: CHART_FONT }, color: ink.tick, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
        y: { position: 'right', border: { display: false },
             grid: { color: c => c.tick.value === 0 ? ink.zero : ink.grid },
             ticks: { font: { size: 13, family: CHART_FONT }, color: ink.tick, maxTicksLimit: 5, callback: v => (+v < 0 ? '-$' : '$') + Math.abs(+v).toLocaleString('en', { maximumFractionDigits: 0 }) } },
      },
      animation: { duration: 400 },
    },
  });
  if (typeof keepChartFitted === 'function') keepChartFitted(() => benchChart, canvas.parentElement);
}
