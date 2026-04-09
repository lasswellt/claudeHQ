---
id: '012-001'
title: 'Wire approval + workforce message schemas into discriminated unions'
epic: 'E001'
package: 'shared'
priority: 1
points: 3
dependencies: []
status: done
assignee: 'backend-dev'
review_finding: ['HI-01', 'HI-03']
---

# 012-001: Wire approval + workforce message schemas into discriminated unions

## Context

The 2026-03-16 code review (HI-01) found that 5 approval message schemas in `packages/shared/src/approvals.ts` and 13 workforce/container message schemas in `packages/shared/src/workforce.ts` are defined but **never added to the top-level `agentToHubSchema` / `hubToAgentSchema` / `hubToDashboardSchema` discriminated unions** in `packages/shared/src/protocol.ts`. As a result, any call to `agentToHubSchema.parse(msg)` on an approval or workforce message throws. Hub handlers currently bypass the discriminated union via ad-hoc `z.union(...).parse(...)` — that workaround is what every downstream R-phase needs to stop doing.

HI-03: the approval _message_ schemas (`agentApprovalRequestMsg`, `hubApprovalDecisionMsg`, `approvalRequestedMsg`, `approvalResolvedMsg`, `approvalCountMsg`) are also missing from `packages/shared/src/browser.ts`, so the dashboard can't import them.

## Requirements

1. In `packages/shared/src/protocol.ts`:
   - Import all 5 approval message schemas from `./approvals.js` and all 13 workforce/container message schemas from `./workforce.js`.
   - Add the agent→hub approval + workforce schemas (`agentApprovalRequestMsg`, `agentWorkspaceReadyMsg`, `agentWorkspaceErrorMsg`, `agentContainerCreatedMsg`, `agentContainerStartedMsg`, `agentContainerStdoutMsg`, `agentContainerExitedMsg`, `agentContainerStatsMsg`, `agentContainerErrorMsg`) to `agentToHubSchema`.
   - Add the hub→agent workforce + container schemas (`hubApprovalDecisionMsg`, `hubWorkspaceProvisionMsg`, `hubWorkspaceCleanupMsg`, `hubContainerCreateMsg`, `hubContainerStopMsg`, `hubContainerRemoveMsg`) to `hubToAgentSchema`.
   - Add `approvalRequestedMsg`, `approvalResolvedMsg`, `approvalCountMsg` to `hubToDashboardSchema`.
2. In `packages/shared/src/browser.ts`:
   - Re-export all 5 approval message schemas (types + schemas) from `./approvals.js`.
   - Re-export workforce + container message schemas the dashboard consumes (at minimum the ones already published on `hubToDashboardSchema`).
3. In `packages/shared/src/index.ts`: if not already re-exported via `protocol.ts`, add any missing re-exports so hub imports compile.
4. Search `packages/hub/src/` for ad-hoc `z.union(...)` / `z.object({ type: z.literal(...) })` parses of approval or workforce messages and replace with `agentToHubSchema.parse(...)` / `hubToAgentSchema.parse(...)`.
5. Remove or simplify any `// TODO(HI-01)` or `// FIXME` comments introduced as workarounds.

## Acceptance Criteria

- [ ] `packages/shared/src/protocol.ts` exports `agentToHubSchema`, `hubToAgentSchema`, `hubToDashboardSchema` with all approval + workforce message variants included.
- [ ] `agentToHubSchema.parse(agentApprovalRequestFixture)` succeeds (unit test added in `packages/shared/src/__tests__/protocol.test.ts`).
- [ ] `hubToDashboardSchema.parse(approvalRequestedFixture)` succeeds.
- [ ] `packages/shared/src/browser.ts` re-exports all approval message schemas; `import { agentApprovalRequestMsg } from '@chq/shared/browser'` compiles.
- [ ] Hub WebSocket handlers (`packages/hub/src/ws/agent-handler.ts`) parse incoming messages via the top-level discriminated union, not per-handler `z.union(...)`.
- [ ] `pnpm --filter @chq/shared type-check` passes.
- [ ] `pnpm --filter @chq/shared test` passes.
- [ ] `pnpm --filter @chq/hub type-check` passes.

## Files

- `packages/shared/src/protocol.ts`
- `packages/shared/src/browser.ts`
- `packages/shared/src/__tests__/protocol.test.ts` (add fixtures)
- `packages/hub/src/ws/agent-handler.ts` (if ad-hoc parsers exist)

## Verify

```bash
pnpm --filter @chq/shared type-check
pnpm --filter @chq/shared test
pnpm --filter @chq/hub type-check
```

## Done

Every approval and workforce message type round-trips through `agentToHubSchema` / `hubToAgentSchema` / `hubToDashboardSchema` with type inference; no hub handler uses ad-hoc `z.union()`; dashboard can import approval message schemas from `@chq/shared/browser`.
