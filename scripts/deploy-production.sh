#!/usr/bin/env bash
# One-shot production deploy after `vercel login` and Render blueprint applied.
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

DASHBOARD_SECRET="${DASHBOARD_SECRET:-$(openssl rand -hex 24)}"
echo "Using DASHBOARD_SECRET (save this): $DASHBOARD_SECRET"

echo "==> Deploying dashboard to Vercel..."
cd apps/dashboard
vercel link --yes --project growth-agent-dashboard 2>/dev/null || vercel link --yes
vercel env add DATABASE_URL production --value "$DATABASE_URL" --sensitive --yes --force
vercel env add DASHBOARD_SECRET production --value "$DASHBOARD_SECRET" --sensitive --yes --force
DEPLOY_URL=$(vercel deploy --prod --yes 2>&1 | tail -1)
echo "Dashboard: $DEPLOY_URL"

echo ""
echo "==> Render API (manual once if not done):"
echo "https://dashboard.render.com/blueprint/new?repo=https://github.com/Eddiebm/growth-agent"
echo "Service name: growth-agent-crm"
echo "Set DATABASE_URL in Render environment, then verify:"
echo "https://growth-agent-crm.onrender.com/health"
