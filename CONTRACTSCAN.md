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
  (Save-as-PDF, Copy-summary, Email-me-the-report in server mode), a per-severity results
  filter, and a pre-analysis size/model-cost estimate.
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
| `POST /v1/redeem` | validate a single-use unlock code, add credits (rate-limited) |
| `POST /v1/email-report` | email a rendered report to the user (needs `RESEND_API_KEY`, rate-limited) |
| `POST /v1/webhook/lemonsqueezy` | on purchase, mint + email an unlock code (HMAC-verified) |
| `POST /v1/event`, `GET /v1/stats` | conversion analytics (counts only; stats is admin-gated) |

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
- **Abuse protection.** `/v1/redeem` is rate-limited to 20 attempts per IP per 10 minutes to
  throttle unlock-code guessing.

## Publishing (GitHub Pages)

`.github/workflows/pages.yml` auto-publishes on every push to `main`:

- landing page → site root `/`
- app → `/app/`

**One-time:** repo **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.

**Production mode:** set a repo **Variable** `PROXY_URL` (Settings → Secrets and variables →
Actions → Variables) to your deployed Worker URL. The workflow injects it into the published
app so it runs server-side (key protected, credits metered). Without it, the published app is
in dev mode (visitors supply their own key — fine for a demo).

CI (`.github/workflows/ci.yml`) runs on every PR: `scripts/validate.js` (syntax-checks all JS,
the HTML inline scripts, and the deploy script; parses the calibration answer keys) plus
`node --test tests/*.test.mjs` — unit tests (`mintCode`/`verifyHmac`/`timingSafeEqual`, recall
matcher) plus integration tests that drive the Worker's request handlers with a mocked KV +
upstream `fetch` (credit metering, charge-only-on-success, 402-when-empty, model allowlist,
redeem single-use, stats auth, bad-signature webhook). Run locally:

```bash
node scripts/validate.js
node --test tests/*.test.mjs
```

## Deploy troubleshooting

The Worker bundles cleanly (`cd backend && npx wrangler@4 deploy --dry-run` to confirm), so
deploy failures are almost always one of these:

| Symptom | Cause | Fix |
|---|---|---|
| `Authentication error` / opens a login loop / `You are not authenticated` | Not logged in | `npx wrangler@4 login` (the script now does this first). For CI, set `CLOUDFLARE_API_TOKEN`. |
| `KV namespace 'REPLACE_WITH_KV_NAMESPACE_ID' is not valid` (code 10009) | Ran `wrangler deploy` directly without creating KV | Use `./deploy.sh`, or `npx wrangler@4 kv namespace create CS_KV` and paste the id into `wrangler.toml`. |
| `namespace already exists` on re-run | KV was created on a previous run | `./deploy.sh` now auto-looks-up the existing id; or copy it from `npx wrangler@4 kv namespace list`. |
| `workers.dev subdomain ... register` | No workers.dev subdomain yet | Register one in the Cloudflare dashboard (Workers & Pages → your subdomain), then re-deploy. |
| `More than one account` / account prompt | Multiple Cloudflare accounts | Add `account_id = "..."` to `wrangler.toml` (find it in the dashboard URL). |
| `kv:namespace` "unknown command" | Old wrangler (v2) | Use v3+/v4: `npx wrangler@4 ...` (the script pins `wrangler@4`). |
| Browser app gets CORS errors after deploy | `ALLOWED_ORIGIN` doesn't match the site | Set `ALLOWED_ORIGIN` in `wrangler.toml` to the exact origin (scheme + host), redeploy. |
| `402 No credits` immediately | Working as designed (free trial used) | Redeem a code, or bump `FREE_TRIAL`. |

If it's none of these, grab the exact error: `cd backend && npx wrangler@4 deploy 2>&1 | tail -30`.

## Before charging money — reality checks

- Keep the **"not legal advice"** disclaimer visible (it's in the UI in two places).
- Test against **5–10 real contracts** in your niche and confirm the output is accurate and
  calibrated — not confidently wrong. Tune the system prompt in `buildBody()` as needed.
- Lock `ALLOWED_ORIGIN` to your real domain (not `*`) before launch.
- Replace `contractscan.example.com` in `landing/index.html` (canonical + Open Graph/Twitter
  tags) with your real domain so social previews and `og.svg` resolve correctly.
