# ContractScan

[![CI](https://github.com/Full-Stack-Assets/I/actions/workflows/ci.yml/badge.svg)](https://github.com/Full-Stack-Assets/I/actions/workflows/ci.yml)

**Upload a client contract or vendor agreement → get the specific clauses that put you at risk,
in plain English.** AI contract red-flag check for freelancers, agencies, and small businesses.

> Informational only — **not legal advice**, not a law firm, no attorney–client relationship.

## What's here

| Path | What it is |
|---|---|
| `ContractScan.html` | The whole app — one screen: paste/upload → analyze → risk report. |
| `landing/` | Marketing landing page (+ social `og.svg`). |
| `backend/` | Cloudflare Worker: secure Claude proxy, KV-metered credits, unlock codes, LemonSqueezy webhook, analytics. Plus `deploy.sh` and an admin `stats.html`. |
| `calibration/` | Quality-gate kit: sample contracts, answer keys, and `run.js` to score the analysis before launch. |
| `tests/` | Unit + Worker integration tests (`node --test`). |
| `scripts/validate.js` | Static checks run in CI. |
| `marketing/` | Reusable marketing-asset templates and generated packs. |

Full setup, deployment, payments, and pre-launch checklist: **[CONTRACTSCAN.md](CONTRACTSCAN.md)**.

## Quick start

```bash
npm run dev        # serve locally (open /ContractScan.html or /landing/)
npm run validate   # syntax/JSON checks
npm test           # unit + integration tests
npm run check      # validate + test (what CI runs)
npm run calibrate  # ANTHROPIC_API_KEY=sk-ant-... npm run calibrate
```

Open `ContractScan.html`, add an API key in **Settings** (dev mode), and analyze a contract.
For production, deploy `backend/` and set `CONFIG.PROXY_URL` — see CONTRACTSCAN.md.

## Publishing

Merging to `main` auto-publishes via GitHub Pages: landing at `/`, app at `/app/`
(enable Pages → Source = GitHub Actions; optionally set a `PROXY_URL` repo Variable).
