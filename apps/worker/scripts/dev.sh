#!/usr/bin/env bash
# Runs the worker against the local API with the token from apps/api/.dev.vars.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../.." && pwd)
vars="$repo/apps/api/.dev.vars"
value() { grep "^$1=" "$vars" 2>/dev/null | cut -d= -f2- || true; }
export WORKER_TOKEN="${WORKER_TOKEN:-$(value WORKER_TOKEN)}"
export DEEPINFRA_API_KEY="${DEEPINFRA_API_KEY:-$(value DEEPINFRA_API_KEY)}"
export API_URL="${API_URL:-http://localhost:8787}"
export LOG_DIR="${LOG_DIR:-$repo/apps/worker/target/logs}"
exec cargo run --manifest-path "$repo/apps/worker/Cargo.toml"
