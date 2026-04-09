---
id: '012-004'
title: 'Session list tag filter UI'
epic: 'E001'
package: 'dashboard'
priority: 2
points: 3
dependencies: ['012-003']
status: done
assignee: 'frontend-dev'
capability: 'CAP-010'
---

# 012-004: Session list tag filter UI

## Context

With `sessions.tags` now supported by the API (story 012-003), surface it in the dashboard so operators can filter the session list by tag. The New Session modal should also accept tags on create.

## Requirements

1. **Sessions store** — extend `packages/dashboard/app/stores/sessions.ts`:
   - Add `selectedTags: Ref<string[]>` state.
   - Add `allTags` computed — unique tags across `sessions.value`.
   - Add `filteredSessions` computed — if `selectedTags.value.length === 0` return all, else return sessions whose `tags` array includes at least one selected tag.
2. **List view** — `packages/dashboard/app/pages/sessions/index.vue`:
   - Render a row of `v-chip` filter pills, one per tag in `allTags`, using `filter` variant with `v-model` bound to `selectedTags`.
   - Use `filteredSessions` (not `sessions`) as the data table source.
   - Show an "All" reset chip.
3. **New Session modal** — `packages/dashboard/app/components/session/NewSessionModal.vue`:
   - Add a `v-combobox` bound to a local `tags: string[]` ref with `multiple`, `chips`, `closable-chips`, and a `hint="Press enter to add a tag"`.
   - Include tags in the create request payload.
4. **Type import** — use `SessionRecord` from `@chq/shared/browser` so the `tags` field is typed.

## Acceptance Criteria

- [ ] Sessions store exposes `selectedTags`, `allTags`, `filteredSessions`.
- [ ] Sessions list page renders a tag filter bar; clicking a chip filters the table.
- [ ] The "All" chip clears `selectedTags`.
- [ ] Creating a session via the modal with tags persists them (verified against the API).
- [ ] No `any` types introduced; `pnpm --filter @chq/dashboard type-check` passes.
- [ ] `pnpm --filter @chq/dashboard build` succeeds.

## Files

- `packages/dashboard/app/stores/sessions.ts`
- `packages/dashboard/app/pages/sessions/index.vue`
- `packages/dashboard/app/components/session/NewSessionModal.vue`

## Verify

```bash
pnpm --filter @chq/dashboard type-check
pnpm --filter @chq/dashboard build
```

## Done

Sessions can be filtered in the dashboard by tag chip, and new sessions can be created with tags from the modal.
