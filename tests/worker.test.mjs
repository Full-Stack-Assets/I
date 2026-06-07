import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../backend/worker.js';

/* In-memory KV stub matching the subset of the Workers KV API the worker uses. */
function makeKV(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, String(v)); },
    list: async ({ prefix = '', cursor } = {}) => ({
      keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })),
      list_complete: true
    }),
    _map: m
  };
}
function baseEnv(over = {}) {
  return {
    CS_KV: makeKV(over.kv || {}),
    ANTHROPIC_API_KEY: 'sk-ant-test',
    ALLOWED_ORIGIN: '*',
    FREE_TRIAL: '1',
    ADMIN_TOKEN: 'admin-secret',
    VARIANT_CREDITS: '{}',
    ...over.vars
  };
}
function req(path, { method = 'GET', body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['content-type'] = init.headers['content-type'] || 'application/json';
  }
  return new Request('https://worker.test' + path, init);
}

const ANALYZE_BODY = {
  model: 'claude-opus-4-8', max_tokens: 8000,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'analyze this' }] }]
};
const CANNED = {
  content: [{ type: 'text', text: JSON.stringify({ risk_score: 50, risk_level: 'Moderate', summary: 's', flagged_clauses: [] }) }]
};

/* Stub global fetch (the worker's upstream Anthropic call). Returns a counter. */
function stubFetch({ status = 200, body = CANNED } = {}) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test('analyze: new token spends its free trial and proxies upstream', async () => {
  const env = baseEnv();
  const f = stubFetch();
  try {
    const res = await worker.fetch(req('/v1/analyze', { method: 'POST', body: ANALYZE_BODY, headers: { 'X-CS-Token': 'tok1' } }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-CS-Credits'), '0');         // 1 free trial -> 0 left
    assert.equal(f.calls.length, 1);                            // upstream called once
    assert.match(f.calls[0].url, /api\.anthropic\.com/);
    assert.equal(f.calls[0].opts.headers['x-api-key'], 'sk-ant-test'); // key injected server-side
  } finally { f.restore(); }
});

test('analyze: out of credits returns 402 and does not call upstream', async () => {
  const env = baseEnv({ kv: { 'credits:tok1': '0' } });
  const f = stubFetch();
  try {
    const res = await worker.fetch(req('/v1/analyze', { method: 'POST', body: ANALYZE_BODY, headers: { 'X-CS-Token': 'tok1' } }), env);
    assert.equal(res.status, 402);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});

test('analyze: upstream failure does NOT spend a credit', async () => {
  const env = baseEnv({ kv: { 'credits:tok1': '2' } });
  const f = stubFetch({ status: 500, body: { error: { message: 'boom' } } });
  try {
    const res = await worker.fetch(req('/v1/analyze', { method: 'POST', body: ANALYZE_BODY, headers: { 'X-CS-Token': 'tok1' } }), env);
    assert.equal(res.status, 500);
    assert.equal(await env.CS_KV.get('credits:tok1'), '2');     // unchanged
  } finally { f.restore(); }
});

test('analyze: disallowed model is rejected (400)', async () => {
  const env = baseEnv({ kv: { 'credits:tok1': '5' } });
  const f = stubFetch();
  try {
    const res = await worker.fetch(req('/v1/analyze', {
      method: 'POST', headers: { 'X-CS-Token': 'tok1' },
      body: { ...ANALYZE_BODY, model: 'gpt-4o' }
    }), env);
    assert.equal(res.status, 400);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});

test('analyze: missing token is rejected (400)', async () => {
  const env = baseEnv();
  const res = await worker.fetch(req('/v1/analyze', { method: 'POST', body: ANALYZE_BODY }), env);
  assert.equal(res.status, 400);
});

test('balance: new token initializes to the free trial', async () => {
  const env = baseEnv();
  const res = await worker.fetch(req('/v1/balance?token=fresh'), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { credits: 1 });
});

test('redeem: valid code adds credits, reuse is rejected', async () => {
  const env = baseEnv({ kv: { 'code:CS-AAAA-BBBB': JSON.stringify({ credits: 5, used: false }) } });
  const ok = await worker.fetch(req('/v1/redeem', { method: 'POST', body: { token: 't', code: 'CS-AAAA-BBBB' } }), env);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { credits: 6, added: 5 });   // 1 trial + 5

  const again = await worker.fetch(req('/v1/redeem', { method: 'POST', body: { token: 't', code: 'CS-AAAA-BBBB' } }), env);
  assert.equal(again.status, 409);                                // already used
});

test('redeem: unknown code returns 404', async () => {
  const env = baseEnv();
  const res = await worker.fetch(req('/v1/redeem', { method: 'POST', body: { token: 't', code: 'CS-NOPE-NOPE' } }), env);
  assert.equal(res.status, 404);
});

test('email-report: 503 when email is not configured', async () => {
  const env = baseEnv(); // no RESEND_API_KEY
  const res = await worker.fetch(req('/v1/email-report', {
    method: 'POST', body: { to: 'a@b.com', analysis: { risk_score: 1, flagged_clauses: [] } }
  }), env);
  assert.equal(res.status, 503);
});

test('email-report: invalid address is rejected (400)', async () => {
  const env = baseEnv({ vars: { RESEND_API_KEY: 're_test' } });
  const res = await worker.fetch(req('/v1/email-report', {
    method: 'POST', body: { to: 'not-an-email', analysis: { risk_score: 1, flagged_clauses: [] } }
  }), env);
  assert.equal(res.status, 400);
});

test('email-report: sends when configured', async () => {
  const env = baseEnv({ vars: { RESEND_API_KEY: 're_test', FROM_EMAIL: 'CS <x@y.com>' } });
  const f = stubFetch({ status: 200, body: { id: 'email_1' } });
  try {
    const res = await worker.fetch(req('/v1/email-report', {
      method: 'POST',
      body: { to: 'user@example.com', analysis: { risk_score: 80, risk_level: 'High', summary: 's', flagged_clauses: [{ severity: 'critical', title: 'x', section_reference: '1', explanation: 'e', recommendation: 'r' }] } }
    }), env);
    assert.equal(res.status, 200);
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0].url, /api\.resend\.com/);
  } finally { f.restore(); }
});

test('stats: requires the admin token', async () => {
  const env = baseEnv({ kv: { 'stat:load': '7', 'stat:buy:plan:pack': '2' } });
  const no = await worker.fetch(req('/v1/stats'), env);
  assert.equal(no.status, 401);

  const yes = await worker.fetch(req('/v1/stats', { headers: { 'X-Admin-Token': 'admin-secret' } }), env);
  assert.equal(yes.status, 200);
  const { stats } = await yes.json();
  assert.equal(stats['load'], 7);
  assert.equal(stats['buy:plan:pack'], 2);
});

test('event: increments aggregate counters', async () => {
  const env = baseEnv();
  await worker.fetch(req('/v1/event', { method: 'POST', body: { name: 'analyze_success', niche: 'freelance' } }), env);
  await worker.fetch(req('/v1/event', { method: 'POST', body: { name: 'analyze_success', niche: 'freelance' } }), env);
  assert.equal(await env.CS_KV.get('stat:analyze_success'), '2');
  assert.equal(await env.CS_KV.get('stat:analyze_success:niche:freelance'), '2');
});

test('event: rejects unknown event names (400)', async () => {
  const env = baseEnv();
  const res = await worker.fetch(req('/v1/event', { method: 'POST', body: { name: 'evil' } }), env);
  assert.equal(res.status, 400);
});

test('webhook: bad signature is rejected (401)', async () => {
  const env = baseEnv({ vars: { LEMONSQUEEZY_SIGNING_SECRET: 'whsec' } });
  const res = await worker.fetch(req('/v1/webhook/lemonsqueezy', {
    method: 'POST', headers: { 'X-Signature': 'deadbeef' },
    body: { meta: { event_name: 'order_created' }, data: { id: 'o1' } }
  }), env);
  assert.equal(res.status, 401);
});

test('unknown route returns 404', async () => {
  const env = baseEnv();
  const res = await worker.fetch(req('/nope'), env);
  assert.equal(res.status, 404);
});
