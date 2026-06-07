# ContractScan — MVP

A web app: paste or upload a contract → get a risk score and the specific clauses that put
you at risk, in plain English. Powered by the Claude API.

**Positioning:** don't sell "contract review" to everyone. Sell *"Upload a client contract,
get the 3 things that'll screw you, $20"* to one niche — freelancers/agencies, or small
businesses signing SaaS/vendor agreements. The niche selector in the UI tunes the analysis
to that buyer.

> **Not legal advice.** ContractScan is informational only — not a law firm, no
> attorney–client relationship. This disclaimer is shown in the UI and must stay.

---

## Files

- `ContractScan.html` — the entire app frontend (single file). Includes report export
  (Save-as-PDF via print, Copy-summary to clipboard).
- `landing/index.html` — marketing landing page for the niche pitch; CTAs point at the app
  (edit `APP_URL` at the top to where the app is hosted).
- `backend/worker.js` — Cloudflare Worker: secure API proxy + server-side credits/codes +
  optional unlock-code email delivery + conversion analytics.
- `backend/wrangler.toml` — Worker config.
- `backend/deploy.sh` — one-shot deploy (KV namespace + secrets + deploy).
- `backend/stats.html` — admin dashboard for the conversion funnel (needs `ADMIN_TOKEN`).
- `calibration/` — quality-gate kit: 5 sample contracts, answer keys, and a `run.js` eval
  harness for the "test on 5–10 real contracts" step. See `calibration/README.md`.

## Two modes

| | Dev mode | Production mode |
|---|---|---|
| `CONFIG.PROXY_URL` | `''` (empty) | the Worker URL |
| API key | pasted in the browser (Settings) | a Worker secret, never sent to the browser |
| Credits | `localStorage` (editable in devtools) | metered in Worker KV |
| Unlock codes | the `CONFIG.UNLOCK_CODES` map | validated single-use in KV (`/v1/redeem`) |

Dev mode is for local testing only. **Never deploy a public site in dev mode** — the key is
visible to anyone who opens the page, and credits/codes can be bypassed from the console.

## Quick start (local testing — dev mode)

1. Open `ContractScan.html` in a browser.
2. Click **⚙︎ Settings** and paste an Anthropic API key (`sk-ant-…`).
3. Paste a contract (or upload a PDF) and click **Analyze**.

## Production setup

### 1. Deploy the backend

One shot (creates the KV namespace, prompts for secrets, deploys):

```bash
cd backend
./deploy.sh
```

Or manually:

```bash
cd backend
npx wrangler kv namespace create CS_KV      # paste the printed id into wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY            # your sk-ant-... key
npx wrangler secret put LEMONSQUEEZY_SIGNING_SECRET  # from the LemonSqueezy dashboard
npx wrangler secret put RESEND_API_KEY               # optional — email the unlock code
npx wrangler secret put ADMIN_TOKEN                  # optional — protects /v1/stats
# edit wrangler.toml: ALLOWED_ORIGIN, FREE_TRIAL, VARIANT_CREDITS
npx wrangler deploy
```

The Worker exposes:

| Route | Purpose |
|---|---|
| `GET /v1/balance?token=` | current credit balance for a browser token |
| `POST /v1/analyze` | secure proxy + credit metering (key stays server-side) |
| `POST /v1/redeem` | validate a single-use unlock code, add credits |
| `POST /v1/webhook/lemonsqueezy` | on purchase, mint an unlock code (HMAC-verified) |

### 2. Point the frontend at it

In `ContractScan.html`, edit the `CONFIG` block:

| Field | What to set |
|---|---|
| `MODEL` | `claude-opus-4-8` (default, best accuracy) or `claude-sonnet-4-6` (cheaper/faster) |
| `PROXY_URL` | your deployed Worker URL, e.g. `https://contractscan.you.workers.dev` |
| `PAYMENT_LINKS` | your LemonSqueezy / Stripe Payment Link URLs for $20 / $79 / $49-mo |
| `FREE_TRIAL` | free analyses a new visitor gets (also set `FREE_TRIAL` in `wrangler.toml`) |

`LIMITS` at the top of the script holds the tunables (min contract length, PDF size cap,
request timeout, retry count).

### 3. Payment flow (no accounts in v1)

1. Buyer clicks a price → opens your LemonSqueezy/Stripe link.
2. LemonSqueezy fires `order_created` → the Worker webhook verifies the signature and mints a
   single-use unlock code (mapped to credits via `VARIANT_CREDITS`).
3. Deliver the code to the buyer (LemonSqueezy receipt custom text / redirect, or email — the
   code is also logged by the Worker for the MVP).
4. Buyer enters the code → `/v1/redeem` adds credits to their browser token. Each successful
   analysis spends one credit (charged server-side, only on success).

**Automatic email delivery (optional):** set the `RESEND_API_KEY` secret and `FROM_EMAIL` var
and the webhook emails the code to the buyer's `user_email` automatically. Without them, the
code is logged for manual delivery. Point your LemonSqueezy `order_created` webhook at
`POST /v1/webhook/lemonsqueezy` and map variant IDs → credits in `VARIANT_CREDITS`.

## Conversion analytics

In production the app fires aggregate funnel events to the Worker (`/v1/event`):
`load → analyze → analyze_success → paywall → buy → redeem`, tagged by niche and plan.
**Only counts are stored** — never contract content or anything identifying. Set the
`ADMIN_TOKEN` secret, then open `backend/stats.html`, enter your Worker URL + token, and you'll
see the funnel plus which niches and plans convert best. Analytics are skipped in dev mode.

## Notes

- **No client-side PDF parsing.** PDFs are sent as a base64 `document` block; Claude parses
  them server-side. There's no PDF.js to load.
- **Credit integrity.** In production the browser token only *identifies* a session; the
  authoritative balance and code state live in KV, so editing `localStorage` does nothing.
- **Resilience.** API calls use a 90s timeout and retry 429/5xx with exponential backoff
  (`fetchWithRetry`). Malformed/empty model responses surface a friendly message.

## Publishing (GitHub Pages)

`.github/workflows/pages.yml` auto-publishes on every push to `main`:

- landing page → site root `/`
- app → `/app/`

**One-time:** repo **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.

**Production mode:** set a repo **Variable** `PROXY_URL` (Settings → Secrets and variables →
Actions → Variables) to your deployed Worker URL. The workflow injects it into the published
app so it runs server-side (key protected, credits metered). Without it, the published app is
in dev mode (visitors supply their own key — fine for a demo).

CI (`.github/workflows/ci.yml`) runs `scripts/validate.js` on every PR — syntax-checks all JS,
the HTML inline scripts, and the deploy script, and parses the calibration answer keys. Run it
locally with `node scripts/validate.js`.

## Before charging money — reality checks

- Keep the **"not legal advice"** disclaimer visible (it's in the UI in two places).
- Test against **5–10 real contracts** in your niche and confirm the output is accurate and
  calibrated — not confidently wrong. Tune the system prompt in `buildBody()` as needed.
- Lock `ALLOWED_ORIGIN` to your real domain (not `*`) before launch.
