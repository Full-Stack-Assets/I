# Changelog

All notable changes to ContractScan. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased] — PR #2: launch-readiness

### Added
- **Backend** (`backend/`): Cloudflare Worker with a secure `/v1/analyze` proxy (API key
  server-side), KV-metered credits, single-use unlock codes (`/v1/redeem`), HMAC-verified
  LemonSqueezy webhook that mints and **emails** codes (Resend), conversion analytics
  (`/v1/event` + `/v1/stats`), `deploy.sh`, and an admin `stats.html` dashboard.
- **Landing page** (`landing/`) with SEO/Open Graph/Twitter tags, `og.svg`, and a favicon.
- **Calibration kit** (`calibration/`): 5 sample contracts with planted red flags + answer
  keys and a `run.js` recall/precision harness.
- **Report export**: Save-as-PDF (print) and Copy-summary; **per-severity results filter**.
- **NDA niche** option (app + harness) in addition to freelance / SaaS-vendor / general.
- **CI** (`ci.yml`) running `scripts/validate.js` + unit and Worker-integration tests
  (`tests/`); **GitHub Pages** auto-publish (`pages.yml`); root `package.json` scripts.

### Changed / hardened
- Client: server/dev modes via `CONFIG.PROXY_URL`, fetch timeout + retry/backoff, input and
  API-key validation, accessibility (dialog roles, Esc, focus trap), tunables in `LIMITS`.
- Security: `/v1/redeem` rate-limited (20/IP/10 min) against code guessing.

## [0.1.0] — PR #1 (merged): functional MVP

### Added
- Single-file `ContractScan.html`: one-screen paste/upload → analyze → risk cards, backed by a
  real Claude API call returning structured JSON; client-side credit/paywall gate;
  "not legal advice" disclaimer.
- `CONTRACTSCAN.md` setup guide.
