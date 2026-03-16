# Story File Format

Each story file uses this structure with YAML frontmatter and markdown body.

## Frontmatter Schema

```yaml
---
storyId: STORY-XXX-NNN
epicId: EPIC-XXX
title: "Descriptive Story Title"
layer: agent | hub | dashboard | shared | test
agent: agent-dev | hub-dev | dashboard-dev | test-writer
effort: XS | S | M | L
blockedBy: []
capabilities: ["CAP-NNN"]
---
```

## Body Structure

```markdown
# STORY-XXX-NNN: Descriptive Story Title

## Context
Brief description of what this story accomplishes and why.

## Acceptance Criteria
- [ ] AC-1: First testable criterion
- [ ] AC-2: Second testable criterion

## Files to Create/Modify
| Action | Path | Description |
|--------|------|-------------|
| CREATE | `path/to/file.ts` | Description |
| MODIFY | `path/to/other.ts` | Description |

## Implementation Details
### Schema Definition
(Code snippets showing interfaces, schemas, or function signatures)

## Dependencies
- Depends on: (story IDs or "None")
- Blocks: (story IDs or "None")

## Shared References
Read these before implementing:
- `.claude/shared/build-order.md` (if modifying shared packages)
- `.claude/shared/ws-protocol.md` (if modifying WebSocket messages)
- `.claude/shared/test-patterns.md` (if writing tests)

## Testing Notes
What tests should verify for this story.
```
