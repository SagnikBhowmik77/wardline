#!/usr/bin/env bash
# PreToolUse guard. Reads the tool call as JSON on stdin, appends it to a
# local log, and refuses paths an agent should never touch. Exit 2 blocks
# the call; exit 0 lets it through.
set -euo pipefail

LOG_DIR="$(dirname "$0")/../logs"
mkdir -p "$LOG_DIR"

payload="$(cat)"
stamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Quoted throughout: a filename with a space or a quote must stay data.
echo "$stamp $payload" >> "$LOG_DIR/tool-calls.log"

case "$payload" in
  *".ssh/"*|*".aws/credentials"*|*"/etc/shadow"*)
    echo "wardline guard: refusing access to credential storage" >&2
    exit 2
    ;;
  *"rm -rf /"*|*"rm -rf ~"*)
    echo "wardline guard: refusing recursive delete outside the project" >&2
    exit 2
    ;;
esac

exit 0
