#!/usr/bin/env bash
# Start the ASR sidecar (word-level speech recognition for ad-reference).
# Usage: scripts/start-asr.sh [model]   (default: base)
set -euo pipefail
cd "$(dirname "$0")/../services/asr-sidecar"

if [ ! -d .venv ]; then
  python3 -m venv .venv
  ./.venv/bin/pip install --quiet --upgrade pip
fi
if ! ./.venv/bin/python -c "import faster_whisper" 2>/dev/null; then
  ./.venv/bin/pip install --quiet -r requirements.txt
fi

# Regional network fallback: pull model weights from a mirror unless configured.
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
export ASR_PORT="${ASR_PORT:-8792}"
export ASR_MODEL="${1:-${ASR_MODEL:-base}}"
exec ./.venv/bin/python server.py
