#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

test -f config.yaml
mkdir -p data

corepack enable
pnpm install --frozen-lockfile
pnpm --filter skye-panel build
pnpm run build

if pm2 describe skye-bot >/dev/null 2>&1; then
  pm2 restart ecosystem.config.cjs --only skye-bot --update-env
else
  pm2 start ecosystem.config.cjs --only skye-bot
fi

pm2 save
pm2 status skye-bot
