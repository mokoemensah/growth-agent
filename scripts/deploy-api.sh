#!/usr/bin/env bash
# Deploy growth-agent API to Vercel (serverless + cron).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env with DATABASE_URL"
  exit 1
fi

# shellcheck disable=SC1091
set -a && source .env && set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL not set in .env"
  exit 1
fi

CRON_SECRET="${CRON_SECRET:-$(openssl rand -hex 24)}"
echo "CRON_SECRET (save this): $CRON_SECRET"

unset VERCEL_TOKEN
cd apps/api
vercel link --yes --project growth-agent-api 2>/dev/null || vercel link --yes
vercel env add DATABASE_URL production --value "$DATABASE_URL" --sensitive --yes --force
vercel env add MOCK_INTEGRATIONS production --value "${MOCK_INTEGRATIONS:-true}" --yes --force
vercel env add CRON_ENABLED production --value "true" --yes --force
vercel env add CRON_SECRET production --value "$CRON_SECRET" --sensitive --yes --force
vercel env add DEFAULT_CAMPAIGN_ID production --value "${DEFAULT_CAMPAIGN_ID:-11111111-1111-1111-1111-111111111111}" --yes --force
if [[ -n "${OWNER_TELEGRAM_ID:-}" ]]; then
  vercel env add OWNER_TELEGRAM_ID production --value "$OWNER_TELEGRAM_ID" --yes --force
fi

cd "$ROOT"
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/Library/Application Support/com.vercel.cli/auth.json','utf8')).token)")
PROJECT_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('apps/api/.vercel/project.json','utf8')).projectId)")
curl -sS -X PATCH "https://api.vercel.com/v9/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rootDirectory":"apps/api"}' >/dev/null

vercel deploy --prod --yes
echo "Verify: curl https://YOUR-API-URL/health"
