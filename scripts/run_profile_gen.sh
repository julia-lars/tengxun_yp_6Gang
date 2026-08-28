#!/bin/bash
# Wrapper script for profile generation
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source the .env file
set -a
source "$PROJECT_DIR/apps/api/.env" 2>/dev/null || true
set +a

# Convert DEEPSEEK_API_KEYS to DEEPSEEK_API_KEY (take first key)
if [ -n "$DEEPSEEK_API_KEYS" ] && [ -z "$DEEPSEEK_API_KEY" ]; then
    export DEEPSEEK_API_KEY="${DEEPSEEK_API_KEYS%%,*}"
fi

cd "$PROJECT_DIR"
exec python3 scripts/generate_profiles.py "$@"