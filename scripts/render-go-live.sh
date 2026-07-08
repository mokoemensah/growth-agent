#!/usr/bin/env bash
# Set Render env for makola go-live. Requires: RENDER_API_KEY=rnd_...
set -euo pipefail
cd "$(dirname "$0")/.."
source .env 2>/dev/null || true

: "${RENDER_API_KEY:?Set RENDER_API_KEY=rnd_... from dashboard.render.com/u/settings#api-keys}"
: "${RESEND_API_KEY:?RESEND_API_KEY missing from .env}"

SERVICE_ID="${RENDER_SERVICE_ID:-srv-d9699mpkh4rs73df1ufg}"
API="https://api.render.com/v1"

set_var() {
  curl -sf -X PUT "$API/services/$SERVICE_ID/env-vars/$1" \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"value\":\"$2\"}" > /dev/null
  echo "✅ $1"
}

echo "Updating Render service $SERVICE_ID..."
set_var RESEND_API_KEY "$RESEND_API_KEY"
set_var RESEND_FROM_EMAIL "${RESEND_FROM_EMAIL:-Alex <outreach@makola.org>}"
set_var RESEND_REPLY_TO "${RESEND_REPLY_TO:-alex@makola.org}"
set_var RESEND_WEBHOOK_SECRET "${RESEND_WEBHOOK_SECRET:-}"
set_var MOCK_INTEGRATIONS "false"

curl -sf -X POST "$API/services/$SERVICE_ID/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' > /dev/null
echo "✅ Deploy triggered"
echo "Wait ~2 min, then: curl https://growth-agent-yrll.onrender.com/health"
