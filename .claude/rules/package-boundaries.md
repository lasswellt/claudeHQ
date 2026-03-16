---
globs: "packages/**"
---
# Monorepo Import Boundaries

## Allowed Imports

```
packages/agent     → packages/shared   ✓
packages/hub       → packages/shared   ✓
packages/dashboard → packages/shared   ✓
```

## Forbidden Imports

```
packages/agent     → packages/hub         ✗
packages/agent     → packages/dashboard   ✗
packages/hub       → packages/agent       ✗
packages/hub       → packages/dashboard   ✗
packages/dashboard → packages/agent       ✗
packages/dashboard → packages/hub         ✗
packages/shared    → packages/*           ✗
```

- No circular dependencies between packages
- All shared types, schemas, and protocol definitions go in `packages/shared`
- If hub and agent need the same type, it belongs in shared
- Dashboard must never import backend types directly — use shared protocol types
