#!/usr/bin/env bash
# One-shot deploy for the ContractScan Worker.
# Creates the KV namespace (first run), prompts for secrets, and deploys.
# Re-runnable: skips steps that are already done.
#
# Usage:  cd backend && ./deploy.sh
# Needs:  Node 18+, a Cloudflare account (npx wrangler will prompt you to log in).
set -euo pipefail
cd "$(dirname "$0")"

WRANGLER="npx --yes wrangler"

echo "==> ContractScan Worker deploy"
command -v node >/dev/null || { echo "Node.js is required (18+)."; exit 1; }

# 1. KV namespace — create once, patch the id into wrangler.toml.
if grep -q 'REPLACE_WITH_KV_NAMESPACE_ID' wrangler.toml; then
  echo "==> Creating KV namespace CS_KV…"
  OUT="$($WRANGLER kv namespace create CS_KV)"
  echo "$OUT"
  ID="$(printf '%s\n' "$OUT" | grep -oE '[0-9a-f]{32}' | head -n1)"
  if [ -z "${ID:-}" ]; then
    echo "Could not auto-detect the KV id. Paste it from the output above into wrangler.toml (id = \"…\"), then re-run."
    exit 1
  fi
  # Portable in-place edit (macOS + GNU sed).
  sed -i.bak "s/REPLACE_WITH_KV_NAMESPACE_ID/$ID/" wrangler.toml && rm -f wrangler.toml.bak
  echo "==> Wrote KV id $ID into wrangler.toml"
else
  echo "==> KV namespace already configured (skipping)"
fi

# 2. Secrets. Required: ANTHROPIC_API_KEY, LEMONSQUEEZY_SIGNING_SECRET.
#    Optional: RESEND_API_KEY (email delivery), ADMIN_TOKEN (stats page).
put_secret() { # name required?
  local name="$1" required="$2"
  printf '\n==> Secret %s%s\n' "$name" "$([ "$required" = req ] && echo ' (required)' || echo ' (optional — blank to skip)')"
  read -r -s -p "Value: " val; echo
  if [ -z "$val" ]; then
    [ "$required" = req ] && { echo "Required — re-run when you have it."; exit 1; }
    echo "skipped."; return
  fi
  printf '%s' "$val" | $WRANGLER secret put "$name"
}
echo
read -r -p "Set/update secrets now? [Y/n] " ans
if [ "${ans:-Y}" != "n" ] && [ "${ans:-Y}" != "N" ]; then
  put_secret ANTHROPIC_API_KEY req
  put_secret LEMONSQUEEZY_SIGNING_SECRET req
  put_secret RESEND_API_KEY opt
  put_secret ADMIN_TOKEN opt
fi

# 3. Reminders for the plain-text config.
echo
echo "==> Before going live, edit [vars] in wrangler.toml:"
echo "      ALLOWED_ORIGIN  -> your real site origin (not '*')"
echo "      VARIANT_CREDITS -> {\"<lemonsqueezy_variant_id>\": <credits>}"
echo "      FROM_EMAIL      -> your verified Resend sender (if using email)"

# 4. Deploy.
echo
read -r -p "Deploy now? [Y/n] " go
if [ "${go:-Y}" != "n" ] && [ "${go:-Y}" != "N" ]; then
  $WRANGLER deploy
  echo
  echo "==> Done. Set CONFIG.PROXY_URL in ContractScan.html to the URL printed above,"
  echo "    point your LemonSqueezy webhook at <url>/v1/webhook/lemonsqueezy,"
  echo "    and open backend/stats.html with your ADMIN_TOKEN to watch conversions."
fi
