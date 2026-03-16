#!/bin/bash
# Post-edit linting: run ESLint on edited TypeScript/Vue files
# Receives tool input via CLAUDE_TOOL_INPUT env var

TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"
FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

case "$FILE_PATH" in
  *.ts|*.tsx|*.vue)
    npx eslint --fix "$FILE_PATH" 2>/dev/null || true
    ;;
esac

exit 0
