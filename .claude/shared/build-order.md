# Build Order for claudeHQ Monorepo

claudeHQ uses pnpm workspaces with Turbo for build orchestration. The shared
package must build first since all other packages depend on it.

## Dependency Graph

```
packages/shared → packages/agent
packages/shared → packages/hub
packages/shared → packages/dashboard
```

No cross-package dependencies except through `packages/shared`.

## Build Sequence

```bash
# Full build (Turbo handles ordering automatically)
pnpm turbo build

# Manual order (if Turbo is unavailable)
pnpm --filter @chq/shared build
pnpm --filter @chq/agent build
pnpm --filter @chq/hub build
pnpm --filter @chq/dashboard build
```

## When to Rebuild

- After modifying `packages/shared/` — Rebuild all (shared types changed)
- After modifying `packages/agent/` — Rebuild agent only
- After modifying `packages/hub/` — Rebuild hub only
- After modifying `packages/dashboard/` — Rebuild dashboard only
- After `pnpm install` — Full rebuild

## What Happens If You Skip

- Agent/Hub use stale protocol types → runtime message parsing failures
- Dashboard uses wrong event types → WebSocket message handling errors
- Zod schemas out of sync → validation passes on sender, fails on receiver
