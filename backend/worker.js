/**
 * ContractScan backend — Cloudflare Worker
 * ------------------------------------------------------------------
 * Closes the two gaps the front-end MVP can't solve on its own:
 *   1. The Anthropic API key never reaches the browser (kept as a Worker secret).
 *   2. Credits are metered server-side in KV, so they can't be edited in devtools.
 *
 * Routes (all under the Worker's base URL — that base URL is CONFIG.PROXY_URL
 * in ContractScan.html):
 *   GET  /v1/balance?token=...        -> { credits }
 *   POST /v1/analyze   (X-CS-Token)   -> Anthropic response + X-CS-Credits header
 *   POST /v1/redeem    { token, code }-> { credits }
 *   POST /v1/webhook/lemonsqueezy     -> mints a single-use unlock code on purchase
 *
 * Setup: see CONTRACTSCAN.md "Production backend".
 */

const MAX_BODY_BYTES = 6_000_000;          // ~6 MB cap (bounds base64 PDFs)
const ALLOWED_MODELS = new Set(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), env, origin);

    try {
      if (url.pathname === '/v1/balance' && request.method === 'GET')
        return cors(await handleBalance(url, env), env, origin);
      if (url.pathname === '/v1/analyze' && request.method === 'POST')
        return cors(await handleAnalyze(request, env), env, origin);
      if (url.pathname === '/v1/redeem' && request.method === 'POST')
        return cors(await handleRedeem(request, env), env, origin);
      if (url.pathname === '/v1/event' && request.method === 'POST')
        return cors(await handleEvent(request, env), env, origin);
      if (url.pathname === '/v1/stats' && request.method === 'GET')
        return cors(await handleStats(request, env), env, origin);
      if (url.pathname === '/v1/webhook/lemonsqueezy' && request.method === 'POST')
        return cors(await handleWebhook(request, env), env, origin); // signature-verified, not CORS-gated
      return cors(json({ error: 'Not found' }, 404), env, origin);
    } catch (err) {
      return cors(json({ error: err.message || 'Server error' }, err.status || 500), env, origin);
    }
  }
};

/* ---------------- credits (KV) ---------------- */
const freeTrial = (env) => parseInt(env.FREE_TRIAL ?? '1', 10) || 0;

async function getCredits(env, token, { initIfNew = false } = {}) {
  if (!token) throw httpError('Missing token', 400);
  const key = 'credits:' + token;
  const raw = await env.CS_KV.get(key);
  if (raw === null) {
    if (!initIfNew) return 0;
    await env.CS_KV.put(key, String(freeTrial(env)));
    return freeTrial(env);
  }
  return parseInt(raw, 10) || 0;
}
async function setCredits(env, token, n) {
  await env.CS_KV.put('credits:' + token, String(Math.max(0, n)));
}

async function handleBalance(url, env) {
  const token = url.searchParams.get('token');
  const credits = await getCredits(env, token, { initIfNew: true });
  return json({ credits });
}

/* ---------------- analyze (secure proxy + metering) ---------------- */
async function handleAnalyze(request, env) {
  const token = request.headers.get('X-CS-Token');
  if (!token) throw httpError('Missing X-CS-Token', 400);

  const len = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (len > MAX_BODY_BYTES) throw httpError('Contract too large', 413);

  const credits = await getCredits(env, token, { initIfNew: true });
  if (credits <= 0) return json({ error: 'No credits', credits: 0 }, 402);

  const body = await request.json();
  if (!ALLOWED_MODELS.has(body.model)) throw httpError('Model not allowed', 400);
  // Pin server-side limits so a tampered client can't request runaway output.
  body.max_tokens = Math.min(body.max_tokens || 8000, 8000);

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    // Upstream failure: do NOT spend a credit.
    return new Response(text, { status: upstream.status, headers: { 'content-type': 'application/json' } });
  }

  const remaining = credits - 1;
  await setCredits(env, token, remaining); // charge only on success
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'application/json', 'X-CS-Credits': String(remaining) }
  });
}

/* ---------------- redeem unlock code ---------------- */
async function handleRedeem(request, env) {
  // Throttle code-guessing: 20 attempts per IP per 10 minutes.
  const ip = request.headers.get('CF-Connecting-IP') || 'anon';
  const window = Math.floor(Date.now() / 600000);
  if (!(await rateLimit(env, 'rl:redeem:' + ip + ':' + window, 20, 600)))
    throw httpError('Too many attempts. Try again in a few minutes.', 429);

  const { token, code } = await request.json();
  if (!token) throw httpError('Missing token', 400);
  const norm = String(code || '').trim().toUpperCase();
  if (!norm) throw httpError('Missing code', 400);

  const key = 'code:' + norm;
  const raw = await env.CS_KV.get(key);
  if (raw === null) throw httpError('Code not recognized', 404);

  const rec = JSON.parse(raw);
  if (rec.used) throw httpError('Code already used', 409);

  rec.used = true;
  rec.used_by = token;
  rec.used_at = new Date().toISOString();
  await env.CS_KV.put(key, JSON.stringify(rec));

  const current = await getCredits(env, token, { initIfNew: true });
  const updated = current + (rec.credits || 0);
  await setCredits(env, token, updated);
  return json({ credits: updated, added: rec.credits });
}

/* ---------------- analytics (aggregate counts only) ---------------- */
// Counts funnel events to measure which niches/plans convert. Stores only
// aggregate counters in KV — never contract content or anything identifying.
const EVENTS = new Set(['load', 'analyze', 'analyze_success', 'paywall', 'buy', 'redeem']);

async function incr(env, key) {
  const n = parseInt((await env.CS_KV.get(key)) || '0', 10) || 0;
  await env.CS_KV.put(key, String(n + 1));
}
// Fixed-window per-key limiter. Returns true if still under `limit`.
async function rateLimit(env, key, limit, ttlSec) {
  const n = (parseInt((await env.CS_KV.get(key)) || '0', 10) || 0) + 1;
  await env.CS_KV.put(key, String(n), { expirationTtl: ttlSec });
  return n <= limit;
}
async function handleEvent(request, env) {
  const { name, niche, plan } = await request.json().catch(() => ({}));
  if (!EVENTS.has(name)) return json({ ok: false }, 400);
  const safe = (s) => String(s || '').replace(/[^a-z0-9_]/gi, '').slice(0, 32);
  await incr(env, 'stat:' + name);
  if (niche) await incr(env, 'stat:' + name + ':niche:' + safe(niche));
  if (plan) await incr(env, 'stat:' + name + ':plan:' + safe(plan));
  return json({ ok: true });
}
async function handleStats(request, env) {
  if (!env.ADMIN_TOKEN || request.headers.get('X-Admin-Token') !== env.ADMIN_TOKEN)
    throw httpError('Unauthorized', 401);
  const out = {};
  let cursor;
  do {
    const page = await env.CS_KV.list({ prefix: 'stat:', cursor });
    for (const k of page.keys) out[k.name.slice(5)] = parseInt((await env.CS_KV.get(k.name)) || '0', 10);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return json({ stats: out });
}

/* ---------------- LemonSqueezy purchase webhook ---------------- */
// Verifies the HMAC signature, then mints a single-use code. Hand the code to
// the buyer via the LemonSqueezy receipt/redirect or a confirmation email.
async function handleWebhook(request, env) {
  const sig = request.headers.get('X-Signature') || '';
  const raw = await request.text();
  const ok = await verifyHmac(env.LEMONSQUEEZY_SIGNING_SECRET, raw, sig);
  if (!ok) throw httpError('Invalid signature', 401);

  const event = JSON.parse(raw);
  const name = event?.meta?.event_name;
  if (name !== 'order_created') return json({ ignored: name || 'unknown' });

  // Map the purchased variant -> credit count via the VARIANT_CREDITS env JSON,
  // e.g. {"123456":1,"123457":5}. Subscriptions ("sub") grant a large block.
  const variantId = String(event?.data?.attributes?.first_order_item?.variant_id ?? '');
  const map = JSON.parse(env.VARIANT_CREDITS || '{}');
  const credits = map[variantId] ?? 1;

  const code = mintCode();
  await env.CS_KV.put('code:' + code, JSON.stringify({
    credits, used: false, order: event?.data?.id, created_at: new Date().toISOString()
  }));

  // Deliver the code to the buyer. If email isn't configured, fall back to logs.
  const email = event?.data?.attributes?.user_email;
  const sent = await sendCodeEmail(env, email, code, credits);
  if (!sent) console.log('Minted unlock code', code, 'for', credits, 'credits (order', event?.data?.id, ') — email not sent, deliver manually');

  return json({ ok: true, credits, emailed: sent });
}

// Sends the unlock code via Resend (https://resend.com). Set RESEND_API_KEY +
// FROM_EMAIL to enable; otherwise returns false and the webhook logs the code.
async function sendCodeEmail(env, to, code, credits) {
  if (!env.RESEND_API_KEY || !to) return false;
  const html =
    '<p>Thanks for your purchase! Your ContractScan unlock code is:</p>'
    + '<p style="font-size:22px;font-weight:bold;letter-spacing:1px">' + code + '</p>'
    + '<p>It adds <strong>' + credits + ' credit' + (credits > 1 ? 's' : '') + '</strong>. '
    + 'Open ContractScan, hit "Already paid? Enter your unlock code", and paste it in.</p>'
    + '<p style="color:#888;font-size:12px">ContractScan is informational only and not legal advice.</p>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.FROM_EMAIL || 'ContractScan <onboarding@resend.dev>',
        to, subject: 'Your ContractScan unlock code', html
      })
    });
    if (!r.ok) { console.log('Resend error', r.status, await r.text()); return false; }
    return true;
  } catch (e) { console.log('Email send failed:', e.message); return false; }
}

/* ---------------- helpers ---------------- */
export function mintCode() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return 'CS-' + s.slice(0, 4) + '-' + s.slice(4);
}

export async function verifyHmac(secret, payload, signatureHex) {
  if (!secret || !signatureHex) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, signatureHex.toLowerCase());
}
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
function httpError(message, status) { const e = new Error(message); e.status = status; return e; }

function cors(res, env, origin) {
  const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim());
  const allow = allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0] || '*');
  res.headers.set('Access-Control-Allow-Origin', allow);
  res.headers.set('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'content-type, X-CS-Token, X-Admin-Token');
  res.headers.set('Access-Control-Expose-Headers', 'X-CS-Credits');
  return res;
}
