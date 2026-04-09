---
id: '012-003'
title: 'Add sessions.tags column + API support'
epic: 'E001'
package: 'hub+shared'
priority: 1
points: 3
dependencies: ['012-001']
status: done
assignee: 'backend-dev'
capability: 'CAP-010'
---

# 012-003: Add sessions.tags column + API support

## Context

CAP-010 requires session tagging for filtering, policy matching (approval policy rules already reference `match_session_tags`), and bulk operations. The schema and API currently have no tags support.

## Requirements

1. **Migration** — ~~new file~~ the `sessions.tags` column was already added in `005_enhanced_schema.sql` during the prior phase. No new migration file needed. The DAL / schema / route layers simply never wired it up.
2. **Shared type** — in `packages/shared/src/types.ts`, add `tags: z.array(z.string()).optional()` to `sessionRecordSchema` (before `created_at`).
3. **Hub DAL** — update the sessions DAL so:
   - INSERT serializes `tags` via `JSON.stringify(tags)` when present, writes `NULL` otherwise.
   - SELECT rows parse `tags` via `JSON.parse(row.tags)` when non-null; return `undefined` when null.
   - Find-by-id and list queries include the tags column.
4. **Create-session route** — accept an optional `tags: string[]` field in the request body, persist on insert.
5. **List-sessions route** — accept `?tag=<value>` query param (single value). If set, filter rows where the JSON array includes that tag (use SQL `json_each` or post-filter in JS for simplicity).
6. **Unit test** — add a hub test that creates a session with `tags: ['foo', 'bar']`, reads it back, and asserts the tags round-trip.

## Acceptance Criteria

- [ ] `011_session_tags.sql` exists and is applied by the migration runner on hub startup.
- [ ] `sessionRecordSchema` has an optional `tags` field.
- [ ] Creating a session with tags persists them; reading the session returns them.
- [ ] `GET /api/sessions?tag=foo` returns only sessions whose tags include "foo".
- [ ] Round-trip test passes: `pnpm --filter @chq/hub test`.
- [ ] `pnpm --filter @chq/shared type-check`, `pnpm --filter @chq/hub type-check` pass.

## Files

- `packages/hub/src/migrations/011_session_tags.sql` (new)
- `packages/shared/src/types.ts`
- `packages/hub/src/db/sessions.ts` (or equivalent DAL location; discover with `grep -rn 'INSERT INTO sessions' packages/hub/src`)
- `packages/hub/src/routes/sessions.ts` (create + list endpoints)
- `packages/hub/src/__tests__/sessions.test.ts` (add test) — or create if missing

## Verify

```bash
pnpm --filter @chq/shared type-check
pnpm --filter @chq/hub type-check
pnpm --filter @chq/hub test
```

## Done

Sessions support a `tags: string[]` field end-to-end (schema → DAL → route → shared type); filter query param works; round-trip test passes.
