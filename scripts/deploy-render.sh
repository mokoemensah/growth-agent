#!/usr/bin/env bash
# Deploy growth-agent API to Render (after: render login OR export RENDER_API_KEY=...)
set -euo pipefail

cd "$(dirname "$0")/.."
RENDER="${RENDER_CLI:-/opt/homebrew/Cellar/render/2.21.0/bin/render}"

if ! command -v "$RENDER" >/dev/null 2>&1; then
  RENDER="$(command -v render || true)"
fi

if [[ -z "$RENDER" ]]; then
  echo "Install Render CLI: brew install render"
  exit 1
fi

if [[ -z "${RENDER_API_KEY:-}" ]] && [[ ! -f "$HOME/.render/cli.yaml" ]]; then
  echo "Run: render login"
  echo "Or: export RENDER_API_KEY=rnd_... from dashboard.render.com → Account Settings → API Keys"
  exit 1
fi

# Load local secrets (never committed)
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL required in .env}"

SERVICE_NAME="growth-agent-crm"
REPO="https://github.com/Eddiebm/growth-agent"

echo "==> Checking for existing service..."
EXISTING=$("$RENDER" services -o json 2>/dev/null | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
const s=(Array.isArray(d)?d:d.services||[]).find(x=>(x.name||x.service?.name)==='${SERVICE_NAME}');
console.log(s?.id||s?.service?.id||'');
" 2>/dev/null || echo "")

if [[ -z "$EXISTING" ]]; then
  echo "==> Creating web service ${SERVICE_NAME}..."
  "$RENDER" services create \
    --name "$SERVICE_NAME" \
    --type web \
    --repo "$REPO" \
    --branch main \
    --runtime node \
    --plan free \
    --region oregon \
    --build-command "npm install" \
    --start-command "npx tsx apps/api/src/server.ts" \
    -o json
else
  echo "==> Service exists: $EXISTING"
fi

echo "==> Setting environment variables..."
ENV_ARGS=()
add_env() { [[ -n "${2:-}" ]] && ENV_ARGS+=("--env-var" "$1=$2"); }

add_env DATABASE_URL "$DATABASE_URL"
add_env MOCK_INTEGRATIONS "${MOCK_INTEGRATIONS:-true}"
add_env HERO_PRODUCT_SLUG "${HERO_PRODUCT_SLUG:-hvac-receptionist-agent}"
add_env HERO_MODE "${HERO_MODE:-true}"
add_env CRON_ENABLED "${CRON_ENABLED:-true}"
add_env NODE_ENV production
add_env DEFAULT_CAMPAIGN_ID "${DEFAULT_CAMPAIGN_ID:-11111111-1111-1111-1111-111111111111}"
add_env OPENROUTER_API_KEY "${OPENROUTER_API_KEY:-}"
add_env SERPER_API_KEY "${SERPER_API_KEY:-}"
add_env RESEND_API_KEY "${RESEND_API_KEY:-}"
add_env RESEND_FROM_EMAIL "${RESEND_FROM_EMAIL:-}"
add_env RESEND_REPLY_TO "${RESEND_REPLY_TO:-}"

"$RENDER" services env set "$SERVICE_NAME" "${ENV_ARGS[@]}"

echo "==> Triggering deploy..."
"$RENDER" deploys create "$SERVICE_NAME" --wait

echo "==> Done. Health check:"
curl -s "https://${SERVICE_NAME}.onrender.com/health" || true
echo ""
