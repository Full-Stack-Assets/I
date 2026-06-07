# ContractScan — MVP

A single-file web app: paste or upload a contract → get a risk score and the specific
clauses that put you at risk, in plain English. Powered by the Claude API.

**Positioning:** don't sell "contract review" to everyone. Sell *"Upload a client contract,
get the 3 things that'll screw you, $20"* to one niche — freelancers/agencies, or small
businesses signing SaaS/vendor agreements. The niche selector in the UI tunes the analysis
to that buyer.

> **Not legal advice.** ContractScan is informational only — not a law firm, no
> attorney–client relationship. This disclaimer is shown in the UI and must stay.

---

## Files

- `ContractScan.html` — the entire frontend. Open it in a browser to run it.

## Quick start (local testing — "dev mode")

1. Open `ContractScan.html` in a browser.
2. Click **⚙︎ Settings** and paste an Anthropic API key (`sk-ant-…`).
3. Paste a contract (or upload a PDF) and click **Analyze**.

⚠️ Dev mode calls the Anthropic API directly from the browser, so the key is visible to
anyone who opens the page. **Never deploy a public site in dev mode.** Use a proxy (below).

## Production setup

Edit the `CONFIG` block at the top of the `<script>` in `ContractScan.html`:

| Field | What to set |
|---|---|
| `MODEL` | `claude-opus-4-8` (default, best accuracy) or `claude-sonnet-4-6` (cheaper/faster) |
| `PROXY_URL` | URL of your serverless function (see below) — keeps the API key server-side |
| `PAYMENT_LINKS` | Your LemonSqueezy / Stripe Payment Link URLs for $20 / $79 / $49-mo |
| `UNLOCK_CODES` | Codes you hand buyers after purchase, mapped to credits |
| `FREE_TRIAL` | Free analyses a new visitor gets before the paywall (default 1) |

### Serverless proxy (protects your key)

Deploy this as a Cloudflare Worker / Vercel / Netlify function and point `PROXY_URL` at it.
It forwards the request body to Anthropic with the key added server-side.

```js
// Cloudflare Worker example. Set ANTHROPIC_API_KEY as a secret.
export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return cors(new Response(null));
    if (req.method !== 'POST') return cors(new Response('Method not allowed', { status: 405 }));
    const body = await req.text();
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body
    });
    return cors(new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } }));
  }
};
function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*'); // lock to your domain in production
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'content-type');
  return res;
}
```

For real anti-fraud, also validate unlock codes and meter credits in the proxy/store
rather than trusting the client-side `localStorage` + `UNLOCK_CODES` map (fine for MVP).

## Payment flow (no accounts in v1)

1. Buyer clicks a price in the paywall → opens your LemonSqueezy/Stripe link.
2. After payment, give them an unlock code (store post-purchase redirect, or emailed).
3. Buyer enters the code → credits are added. Each successful analysis spends one credit.

## Before charging money — reality checks

- Keep the **"not legal advice"** disclaimer visible (it's in the UI in two places).
- Test against **5–10 real contracts** in your niche and confirm the output is accurate and
  calibrated — not confidently wrong. Tune the system prompt in `buildBody()` as needed.
