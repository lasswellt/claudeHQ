#!/bin/bash
# Post-edit formatting: run Prettier on edited files
# Receives tool input via CLAUDE_TOOL_INPUT env var

TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"
FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only format supported file types
case "$FILE_PATH" in
  *.ts|*.tsx|*.vue|*.json|*.css|*.html)
    npx prettier --write "$FILE_PATH" 2>/dev/null || true
    ;;
esac

exit 0
