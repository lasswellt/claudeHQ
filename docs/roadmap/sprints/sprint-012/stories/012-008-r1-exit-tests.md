---
id: '012-008'
title: 'R1 exit quality sweep'
epic: 'E001'
package: 'all'
priority: 3
points: 2
dependencies: ['012-001', '012-002', '012-003', '012-004', '012-005', '012-006', '012-007']
status: done
assignee: 'test-writer'
---

# 012-008: R1 exit quality sweep

## Context

Before E001 is marked complete (which unblocks R2..R9), run the full workspace quality sweep: type-check, lint, test, and production build across every package. Record results in `docs/roadmap/sprints/sprint-012/REVIEW.md`.

## Requirements

1. Run in order, halt on first failure:
   ```bash
   pnpm -r type-check
   pnpm -r lint
   pnpm -r test
   pnpm -r build
   ```
2. For any failure, open the relevant story, mark it `status: incomplete`, and file a follow-up task with the error log excerpt.
3. On success, write `docs/roadmap/sprints/sprint-012/REVIEW.md` with:
   - Command, duration, outcome (✓/✗) per step
   - Story completion checklist (8/8)
   - Review findings resolved: HI-01, HI-03, HI-04, HI-05
   - New migrations applied: 011, 012, 013
   - Capability progress: CAP-010, CAP-015, CAP-022, CAP-075 → complete
4. Update `docs/_context/registry.json`:
   - `activeContext.currentPhase = "R1"`
   - `activeContext.activeSprint = "sprint-012"`
   - Append sprint-012 to `completedSprints` once all stories are done.
5. Update `docs/roadmap/_EPIC_REGISTRY.json`:
   - `epics[0].status = "done"` for E001.
6. Update `docs/roadmap/tracker.md` with completion timestamp.

## Acceptance Criteria

- [ ] All four `pnpm -r` commands pass.
- [ ] `REVIEW.md` written.
- [ ] Registry files updated.
- [ ] E001 status is `done`.

## Files

- `docs/roadmap/sprints/sprint-012/REVIEW.md` (new)
- `docs/_context/registry.json`
- `docs/roadmap/_EPIC_REGISTRY.json`
- `docs/roadmap/tracker.md`

## Verify

```bash
pnpm -r type-check
pnpm -r lint
pnpm -r test
pnpm -r build
```

## Done

Full workspace is green; E001 is marked done; sprint-012 is marked complete; R2 is unblocked.
