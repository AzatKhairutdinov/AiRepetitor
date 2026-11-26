#!/usr/bin/env bash
# Idempotent local dev setup: env file with fresh secrets, then local D1 migrations.
set -euo pipefail
vars=apps/api/.dev.vars
if [ ! -f "$vars" ]; then
  secret=$(openssl rand -base64 32)
  sed "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${secret}|" apps/api/.dev.vars.example | grep -v '^#' | grep -v '^WORKER_TOKEN=' > "$vars"
  echo "created $vars"
fi
# Added later than the file itself, so older .dev.vars files get it too.
if ! grep -q '^WORKER_TOKEN=' "$vars"; then
  echo "WORKER_TOKEN=$(openssl rand -hex 32)" >> "$vars"
  echo "added WORKER_TOKEN to $vars"
fi
mise run db:migrate
