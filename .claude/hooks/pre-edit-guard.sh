#!/bin/bash
# Pre-edit guard: block modifications to protected files
# Receives tool input via CLAUDE_TOOL_INPUT env var

TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"
FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

PROTECTED_FILES=(
  "pnpm-lock.yaml"
  "pnpm-workspace.yaml"
  "turbo.json"
  ".claude/settings.json"
)

BASENAME=$(basename "$FILE_PATH")

for protected in "${PROTECTED_FILES[@]}"; do
  if [ "$BASENAME" = "$protected" ]; then
    echo "BLOCKED: $BASENAME is a protected file. Modify manually if needed."
    exit 2
  fi
  # Support path-suffix matching for entries with directory components
  if [[ "$protected" == */* ]] && [[ "$FILE_PATH" == *"$protected" ]]; then
    echo "BLOCKED: $protected is a protected file. Modify manually if needed."
    exit 2
  fi
done

exit 0
