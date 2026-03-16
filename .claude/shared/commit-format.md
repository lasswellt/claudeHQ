# Commit Format

MUST use conventional commits with package scope and story reference.

## Format

```
feat(scope): STORY-XXX-NNN - description
fix(scope): description (fixes #N)
```

## Valid Scopes

| Scope | When |
|-------|------|
| `agent` | Changes to `packages/agent/` |
| `hub` | Changes to `packages/hub/` |
| `dashboard` | Changes to `packages/dashboard/` |
| `shared` | Changes to `packages/shared/` |
| `protocol` | WebSocket protocol changes (in shared) |
| `ci` | CI/CD changes |
| `docs` | Documentation only |
| `sprint` | Sprint registry/planning updates |

## Valid Prefixes

| Prefix | Usage |
|--------|-------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructuring |
| `chore` | Maintenance tasks |
| `docs` | Documentation only |
| `test` | Adding or fixing tests |

## Examples

```
feat(shared): STORY-001-001 - add WebSocket protocol Zod schemas
feat(agent): STORY-001-003 - implement PTY pool with session lifecycle
fix(hub): fix WebSocket relay dropping chunks under load (fixes #12)
feat(dashboard): STORY-002-001 - add xterm.js terminal view component
chore(sprint): review sprint 001 - PASS
```
