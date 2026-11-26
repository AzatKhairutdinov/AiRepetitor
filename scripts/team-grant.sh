#!/usr/bin/env bash
# Grants the "team" role to an account in the local D1: scripts/team-grant.sh <email> [--remote]
set -euo pipefail
email="${1:?usage: mise run team:grant <email> [--remote]}"
where="${2:---local}"
if [[ ! "$email" =~ ^[^\'[:space:]]+@[^\'[:space:]]+$ ]]; then
  echo "not an email: $email" >&2
  exit 1
fi
cd apps/api
pnpm exec wrangler d1 execute DB "$where" --command "UPDATE user SET role = 'team' WHERE email = '$email'; SELECT email, role FROM user WHERE email = '$email';"
