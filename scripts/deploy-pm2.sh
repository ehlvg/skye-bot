#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

app_name="${SKYE_PM2_NAME:-skye-bot}"

test -f config.yaml
mkdir -p data

corepack enable
pnpm install --frozen-lockfile
pnpm --filter skye-panel build
pnpm run build

if pm2 describe "$app_name" >/dev/null 2>&1; then
  pm2 restart ecosystem.config.cjs --only "$app_name" --update-env
else
  pm2 start ecosystem.config.cjs
fi

pm2 save
pm2 status "$app_name"
