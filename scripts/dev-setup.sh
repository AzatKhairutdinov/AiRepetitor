#!/usr/bin/env bash
# Idempotent local dev setup: env file with a fresh secret, then local D1 migrations.
set -euo pipefail
vars=apps/api/.dev.vars
if [ ! -f "$vars" ]; then
  secret=$(openssl rand -base64 32)
  sed "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${secret}|" apps/api/.dev.vars.example | grep -v '^#' > "$vars"
  echo "created $vars"
fi
mise run db:migrate
