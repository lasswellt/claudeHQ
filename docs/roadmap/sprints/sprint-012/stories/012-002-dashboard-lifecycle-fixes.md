---
id: '012-002'
title: 'Fix dashboard replay container mount + connection chip binding'
epic: 'E001'
package: 'dashboard'
priority: 1
points: 2
dependencies: []
status: done
assignee: 'frontend-dev'
review_finding: ['HI-04', 'HI-05']
---

# 012-002: Fix dashboard replay container mount + connection chip binding

## Context

Two independent dashboard bugs from the 2026-03-16 review:

- **HI-04** — `packages/dashboard/app/pages/sessions/[id]/replay.vue` lines 50-53: the terminal container `<div ref="containerRef">` is inside a `<v-else>` next to `<v-skeleton-loader v-if="replay.loading.value">`. When the page mounts, `replay.loading.value` is `true`, so `containerRef` is `null` and `useTerminal` fails to attach — once loading flips to `false`, the terminal never initializes because its `onMounted` ran against a null ref.
- **HI-05** — `packages/dashboard/app/layouts/default.vue` lines 60-62: the sidebar connection chip is hardcoded to `color="success"` and text "Connected", regardless of the actual WebSocket state. `useWebSocket()` returns a `state` ref typed `'connecting' | 'connected' | 'disconnected' | 'error'`.

## Requirements

### HI-04 — replay.vue container

1. Render the terminal container unconditionally so `containerRef` is always attached on mount.
2. Use `v-show` (not `v-if` / `v-else`) to hide the container behind the skeleton loader while loading; `v-show` keeps the DOM node mounted.
3. Structure: skeleton overlay **positioned absolutely** over the container card, shown with `v-show="replay.loading.value"`, hidden otherwise.

### HI-05 — connection chip

1. Import `useWebSocket` in `layouts/default.vue`.
2. Compute chip color and label from `state.value`:
   - `connected` → `color="success"`, text `"Connected"`
   - `connecting` → `color="warning"`, text `"Connecting…"`
   - `disconnected` → `color="error"`, text `"Disconnected"`
   - `error` → `color="error"`, text `"Error"`
3. Use a `computed` for `chipColor` and `chipLabel`.

## Acceptance Criteria

- [ ] `replay.vue` terminal container mounts on first render (no reload required). Manual test: navigate to `/sessions/:id/replay`, skeleton appears, then the terminal renders recording playback without refresh.
- [ ] `replay.vue` no longer uses `v-if`/`v-else` to swap skeleton and container; `v-show` drives visibility.
- [ ] `layouts/default.vue` sidebar chip reflects all four `WsState` values (verified by temporarily forcing each state in dev).
- [ ] No TypeScript errors; no new Vue template warnings.
- [ ] `pnpm --filter @chq/dashboard type-check` passes.
- [ ] `pnpm --filter @chq/dashboard build` succeeds.

## Files

- `packages/dashboard/app/pages/sessions/[id]/replay.vue`
- `packages/dashboard/app/layouts/default.vue`

## Verify

```bash
pnpm --filter @chq/dashboard type-check
pnpm --filter @chq/dashboard build
```

## Done

Replay page loads the terminal container without refresh; the nav drawer chip shows live WebSocket state.
