#!/usr/bin/env bash
# Generated-code gate: regenerate, then fail if the output changed.
# Compares before/after content, so it works for committed and uncommitted files.
set -euo pipefail
hash_tree() { find libs/contract/src libs/contract/openapi apps/api/src/playbook.generated.ts -type f -print0 2>/dev/null | sort -z | xargs -0 shasum | shasum; }
before=$(hash_tree)
pnpm nx run contract:generate >/dev/null
node scripts/gen-playbook.ts
pnpm exec oxfmt apps/api/src/playbook.generated.ts >/dev/null
after=$(hash_tree)
if [ "$before" != "$after" ]; then
  echo "libs/contract or the embedded Playbook was out of date and has been regenerated. Review and commit it." >&2
  exit 1
fi
