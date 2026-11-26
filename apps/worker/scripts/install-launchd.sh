#!/usr/bin/env bash
# Installs the worker as a launchd agent: starts at login, restarts after a crash.
# Settings live outside the repo in ~/.config/airepetitor/worker.env. Never calls sudo.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../../.." && pwd)
label=io.airepetitor.worker
config_dir="$HOME/.config/airepetitor"
env_file="$config_dir/worker.env"
bin_dir="$HOME/.local/bin"
bin="$bin_dir/airepetitor-worker"
plist="$HOME/Library/LaunchAgents/$label.plist"
log_dir="$HOME/Library/Logs/AiRepetitor"

for tool in ffmpeg ffprobe; do
  if ! command -v "$tool" >/dev/null; then
    echo "$tool is not in PATH; recordings need it. Install it with: brew install ffmpeg" >&2
    exit 1
  fi
done
command -v pandoc >/dev/null || echo "note: pandoc is not in PATH; the fallback for documents needs it (brew install pandoc)"
bash "$repo/apps/worker/scripts/install-pdfium.sh"

echo "building the worker…"
cargo build --release --manifest-path "$repo/apps/worker/Cargo.toml"
mkdir -p "$bin_dir" "$config_dir" "$log_dir" "$(dirname "$plist")"
install -m 755 "$repo/apps/worker/target/release/airepetitor-worker" "$bin"

if [ ! -f "$env_file" ]; then
  umask 077
  cat > "$env_file" <<'ENV'
# AiRepetitor worker settings (read by the launchd agent).
API_URL=http://localhost:8787
# The same value as WORKER_TOKEN in apps/api/.dev.vars
WORKER_TOKEN=
# Optional: without it the worker takes only documents (no photos, PDFs or recordings).
DEEPINFRA_API_KEY=
# Optional: vision model id on the provider and the OpenAI-compatible base URL.
# VISION_MODEL=Qwen/Qwen3-VL-30B-A3B-Instruct
# ASR_MODEL=openai/whisper-large-v3-turbo
# MODEL_BASE_URL=https://api.deepinfra.com/v1/openai
ENV
  echo "created $env_file — fill in WORKER_TOKEN, then run this script again"
  exit 0
fi

cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>set -a; . "$env_file"; set +a; export PATH="/opt/homebrew/bin:/usr/local/bin:\$PATH"; exec "$bin"</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardErrorPath</key><string>$log_dir/worker.stderr.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "installed $label; logs in $log_dir/worker.log"
echo "to keep the laptop awake on power, run yourself: sudo pmset -c sleep 0"
