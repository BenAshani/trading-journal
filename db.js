// ═══════════════════════════════════════════════════════════
//  db.js — Cloud sync layer (Supabase + localStorage)
//  All writes go to localStorage immediately and Supabase async.
//  On startup, pulls latest data from cloud before rendering.
// ═══════════════════════════════════════════════════════════

const DB_CFG_KEY = 'tj_cloud_cfg_v1';
let _sbClient = null;

// ── Config ──────────────────────────────────────────────────
function dbGetConfig() {
  try { return JSON.parse(localStorage.getItem(DB_CFG_KEY) || 'null'); }
  catch { return null; }
}

function dbSaveConfig(cfg) {
  localStorage.setItem(DB_CFG_KEY, JSON.stringify(cfg));
  _sbClient = null;
}

function dbGetUserId() {
  return dbGetConfig()?.uid || '';
}

function dbIsReady() {
  const c = dbGetConfig();
  return !!(c && c.url && c.key && c.uid);
}

// ── Supabase client ─────────────────────────────────────────
function _getClient() {
  if (_sbClient) return _sbClient;
  const c = dbGetConfig();
  if (!c || !c.url || !c.key) return null;
  try {
    _sbClient = window.supabase.createClient(c.url, c.key);
    return _sbClient;
  } catch(e) { console.warn('[db] Supabase init failed', e); return null; }
}

// ── Write ────────────────────────────────────────────────────
// Fire-and-forget — caller doesn't need to await
function dbPush(key, value) {
  const sb = _getClient();
  const uid = dbGetUserId();
  if (!sb || !uid) return;
  sb.from('journal_data').upsert(
    { user_id: uid, data_key: key, value: value, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,data_key' }
  ).then(({ error }) => {
    if (error) console.warn('[db] push error', key, error.message);
  });
}

// ── Read all from cloud → localStorage ──────────────────────
async function dbPullAll() {
  const sb = _getClient();
  const uid = dbGetUserId();
  if (!sb || !uid) return false;
  try {
    const { data, error } = await sb
      .from('journal_data')
      .select('data_key, value, updated_at')
      .eq('user_id', uid);
    if (error) throw error;
    if (data && data.length) {
      data.forEach(row => {
        // ערכים סקלריים (API key וכו') נשמרים ב-localStorage כמחרוזת גולמית —
        // JSON.stringify עליהם מוסיף גרשיים והורס את הערך (מפתח Finnhub שבור = אין מחירים)
        if (row.value === null || row.value === undefined) { localStorage.removeItem(row.data_key); return; }
        localStorage.setItem(row.data_key,
          typeof row.value === 'string' ? row.value : JSON.stringify(row.value));
      });
      console.log(`[db] Pulled ${data.length} keys from cloud`);
    }
    return true;
  } catch(e) {
    console.warn('[db] pullAll failed', e.message);
    return false;
  }
}

// ── Setup code (for sharing config between devices) ─────────
function dbGenSetupCode() {
  const cfg = dbGetConfig();
  if (!cfg) return '';
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(cfg)))); }
  catch { return ''; }
}

function dbApplySetupCode(code) {
  try {
    const cfg = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    if (!cfg.url || !cfg.key || !cfg.uid) return false;
    dbSaveConfig(cfg);
    return true;
  } catch { return false; }
}

// ── Push ALL current localStorage data to cloud (one-time migrate) ──
async function dbPushAll(keys) {
  const sb = _getClient();
  const uid = dbGetUserId();
  if (!sb || !uid) return false;
  const rows = [];
  keys.forEach(k => {
    const raw = localStorage.getItem(k);
    if (raw === null) return;
    try { rows.push({ user_id: uid, data_key: k, value: JSON.parse(raw), updated_at: new Date().toISOString() }); }
    catch {}
  });
  if (!rows.length) return true;
  try {
    const { error } = await sb.from('journal_data').upsert(rows, { onConflict: 'user_id,data_key' });
    if (error) throw error;
    console.log(`[db] Pushed ${rows.length} keys to cloud`);
    return true;
  } catch(e) {
    console.warn('[db] pushAll failed', e.message);
    return false;
  }
}

// ── Sync status indicator ────────────────────────────────────
function dbSetSyncStatus(state) {
  const el = document.getElementById('db-sync-status');
  if (!el) return;
  const map = {
    ok:      { icon: 'ti-cloud-check', color: 'var(--green)',  text: 'מסונכרן' },
    error:   { icon: 'ti-cloud-off',   color: 'var(--amber-t)', text: 'שגיאת סינכרון' },
    local:   { icon: 'ti-database',    color: 'var(--tx3)',    text: 'מקומי בלבד' },
    syncing: { icon: 'ti-loader-2',    color: 'var(--blue-t)', text: 'מסנכרן...' },
  };
  const s = map[state] || map.local;
  el.innerHTML = `<i class="ti ${s.icon}" style="font-size:11px;${state==='syncing'?'animation:spin 1s linear infinite':''}"></i>${s.text}`;
  el.style.color = s.color;
}

// ── Settings UI helpers ──────────────────────────────────────
function dbOpenSetup() {
  const cfg = dbGetConfig() || {};
  const urlEl  = document.getElementById('db-url');
  const keyEl  = document.getElementById('db-anon-key');
  const uidEl  = document.getElementById('db-user-id');
  const codeEl = document.getElementById('db-setup-code');
  if (urlEl)  urlEl.value  = cfg.url  || '';
  if (keyEl)  keyEl.value  = cfg.key  || '';
  if (uidEl)  uidEl.value  = cfg.uid  || '';
  if (codeEl) codeEl.value = '';
  document.getElementById('db-save-feedback')?.classList.remove('show');
}

async function dbSaveSettings() {
  const url = document.getElementById('db-url')?.value.trim().replace(/\/$/, '');
  const key = document.getElementById('db-anon-key')?.value.trim();
  const uid = document.getElementById('db-user-id')?.value.trim().toLowerCase();
  if (!url || !key || !uid) { toast('⚠ מלא את כל שדות הסינכרון'); return; }
  dbSaveConfig({ url, key, uid });

  // Try to pull + then push existing data up
  dbSetSyncStatus('syncing');
  const ok = await dbPullAll();
  if (ok) {
    // First time: push local data to cloud so it's there
    const allKeys = Object.keys(localStorage).filter(k => k.startsWith('tj_') || k === 'tj-prep');
    await dbPushAll(allKeys);
    dbSetSyncStatus('ok');
    toast('✓ סינכרון ענן הופעל בהצלחה!');
    document.getElementById('db-save-feedback')?.classList.add('show');
    // Update setup code display
    const codeDisplay = document.getElementById('db-code-display');
    const code = dbGenSetupCode();
    if (codeDisplay && code) {
      codeDisplay.textContent = code;
      document.getElementById('db-code-section')?.style.removeProperty('display');
    }
  } else {
    dbSetSyncStatus('error');
    toast('⚠ לא ניתן להתחבר ל-Supabase — בדוק URL ו-Key');
  }
}

async function dbApplyCode() {
  const code = document.getElementById('db-setup-code')?.value.trim();
  if (!code) { toast('⚠ הדבק קוד הגדרה'); return; }
  if (!dbApplySetupCode(code)) { toast('⚠ קוד לא תקין'); return; }
  dbSetSyncStatus('syncing');
  const ok = await dbPullAll();
  if (ok) {
    dbSetSyncStatus('ok');
    toast('✓ הגדרות הוחלו — מרענן...');
    setTimeout(() => location.reload(), 1200);
  } else {
    dbSetSyncStatus('error');
    toast('⚠ לא ניתן להתחבר — בדוק את הקוד');
  }
}

function dbCopyCode() {
  const code = dbGenSetupCode();
  if (!code) { toast('⚠ הגדר סינכרון תחילה'); return; }
  navigator.clipboard.writeText(code).then(() => toast('✓ קוד הגדרה הועתק!'));
}
