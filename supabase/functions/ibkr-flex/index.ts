// ═══════════════════════════════════════════════════════════
//  ibkr-flex — Supabase Edge Function
//  Proxy ל-Flex Web Service של IBKR (הדפדפן לא יכול לקרוא ישירות בגלל CORS).
//  זרימה דו-שלבית של IBKR: SendRequest → ReferenceCode → GetStatement (עם retry).
//  פריסה: supabase functions deploy ibkr-flex --no-verify-jwt
//  או הדבקה ידנית ב-Dashboard → Edge Functions → New Function בשם ibkr-flex.
// ═══════════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const BASE = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService';
const UA = { 'User-Agent': 'trading-journal/1.0' };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const t = url.searchParams.get('t');
  const q = url.searchParams.get('q');
  if (!t || !q) {
    return new Response(JSON.stringify({ error: 'missing t (token) or q (queryId)' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    // שלב 1: בקשת הפקת דוח
    const sendRes = await fetch(`${BASE}.SendRequest?t=${encodeURIComponent(t)}&q=${encodeURIComponent(q)}&v=3`, { headers: UA });
    const sendXml = await sendRes.text();
    const refCode = sendXml.match(/<ReferenceCode>([^<]+)<\/ReferenceCode>/)?.[1];
    const stmtUrl = sendXml.match(/<Url>([^<]+)<\/Url>/)?.[1] || `${BASE}.GetStatement`;
    if (!refCode) {
      // שגיאה מ-IBKR (טוקן שגוי, query לא קיים וכו') — מחזירים כמו שהיא לפרסור בצד הלקוח
      return new Response(sendXml, { status: 502, headers: { ...CORS, 'Content-Type': 'text/xml; charset=utf-8' } });
    }

    // שלב 2: משיכת הדוח — IBKR לפעמים צריך כמה שניות להפיק אותו
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 1000 : 2000));
      const stRes = await fetch(`${stmtUrl}?t=${encodeURIComponent(t)}&q=${encodeURIComponent(refCode)}&v=3`, { headers: UA });
      const xml = await stRes.text();
      const inProgress = xml.includes('<ErrorCode>1019</ErrorCode>') || xml.includes('generation in progress');
      if (!inProgress) {
        return new Response(xml, { headers: { ...CORS, 'Content-Type': 'text/xml; charset=utf-8' } });
      }
    }
    return new Response(JSON.stringify({ error: 'IBKR statement generation timed out' }),
      { status: 504, headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
