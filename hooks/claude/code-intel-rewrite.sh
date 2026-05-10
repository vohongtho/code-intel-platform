#!/usr/bin/env bash
# code-intel-hook-version: 1
# Code-Intel Claude Code hook — thin shell delegate.
#
# NOTE: This script is a reference/backup implementation.
# The default installation uses `code-intel hook claude` (binary subcommand)
# which is installed into ~/.claude/settings.json by `code-intel setup`.
# Use this script only if you prefer a shell-based hook.
#
# This is a thin delegating hook: all rewrite logic lives in `code-intel rewrite`.
# To add or change rewrite rules, edit hook-rewriter.ts — not this file.
#
# Exit code protocol for `code-intel rewrite`:
#   0 + stdout  Rewrite found → auto-allow the rewritten command
#   1           No match → pass through unchanged
#
# Non-blocking guarantee: all error paths exit 0.
# A hook that exits non-zero prevents the agent's command from executing.

if ! command -v jq &>/dev/null; then
  echo "[code-intel] WARNING: jq not installed. Hook inactive. Install: https://jqlang.github.io/jq/download/" >&2
  exit 0
fi

if ! command -v code-intel &>/dev/null; then
  echo "[code-intel] WARNING: code-intel not found in PATH. Hook inactive." >&2
  exit 0
fi

INPUT=$(cat)
CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT")

if [ -z "$CMD" ]; then
  exit 0
fi

# Delegate all rewrite logic to the binary.
REWRITTEN=$(code-intel rewrite "$CMD" 2>/dev/null)
EXIT_CODE=$?

case $EXIT_CODE in
  0)
    # Rewrite found — if identical, already using code-intel
    [ "$CMD" = "$REWRITTEN" ] && exit 0
    ;;
  1)
    # No code-intel equivalent — pass through unchanged
    exit 0
    ;;
  *)
    # Any unexpected exit code — pass through (non-blocking)
    exit 0
    ;;
esac

# Auto-allow the rewritten command
jq -c --arg cmd "$REWRITTEN" \
  '.tool_input.command = $cmd | {
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "allow",
      "permissionDecisionReason": "code-intel: semantic search replaces grep/cat",
      "updatedInput": .tool_input
    }
  }' <<<"$INPUT"
