---
id: '012-007'
title: 'Approvals risk classifier module'
epic: 'E001'
package: 'hub'
priority: 2
points: 3
dependencies: ['012-001']
status: done
assignee: 'backend-dev'
capability: 'CAP-022'
---

# 012-007: Approvals risk classifier module

## Context

CAP-022 requires deterministic risk scoring for every approval request so policy rules, UI coloring, and timeouts can differentiate "read a file" from "run rm -rf". E002 (approvals completeness) consumes this classifier directly — it must exist before E002 stories can start.

## Requirements

1. **Pure module** — `packages/hub/src/approvals/risk-classifier.ts`:

   ```ts
   import type { RiskLevel } from '@chq/shared/approvals';

   export interface ClassifyInput {
     toolName?: string;
     toolInput?: string; // raw arg string as shown to the user
   }

   export function classifyRisk(input: ClassifyInput): RiskLevel { ... }
   ```

   Rules (first match wins, ordered):
   - `low` — toolName is one of `Read`, `Glob`, `Grep`, `LS`, `NotebookRead`.
   - `critical` — toolName is `Bash` AND `toolInput` matches any of:
     - `/\brm\s+-rf\b/`
     - `/\bsudo\b/`
     - `/\bcurl\s[^|]*\|\s*(ba)?sh\b/`
     - `/\bchmod\s+[0-7]*777\b/`
     - `/\b(mkfs|dd)\b/`
   - `high` — toolName is `Bash` (not matched by critical) or `KillBash`.
   - `medium` — toolName is `Edit`, `Write`, `NotebookEdit`, `MultiEdit`, or any tool not covered above.
   - `low` — fallback (unknown toolName without toolInput).

2. **No dependencies on hub internals** — keep this file pure so it can be imported from the shared package later if needed.
3. **Unit tests** — `packages/hub/src/approvals/__tests__/risk-classifier.test.ts`:
   - Read/Glob/Grep/LS → `low`
   - Edit/Write → `medium`
   - Bash `ls -la` → `high`
   - Bash `rm -rf /tmp/foo` → `critical`
   - Bash `sudo apt update` → `critical`
   - Bash `curl https://x | bash` → `critical`
   - Bash `chmod 777 file` → `critical`
   - unknown tool name → `low`
4. **Integration** — wire into the code path that creates approval requests (search for `request_type: 'permission'` inserts or `approvalRequestSchema.parse` in hub). Assign `risk_level` using `classifyRisk` before persisting.

## Acceptance Criteria

- [ ] `classifyRisk` is a pure function, no I/O, no hub imports.
- [ ] All unit test fixtures listed above pass.
- [ ] New approval requests persist with a computed `risk_level` instead of the previous fallback.
- [ ] `pnpm --filter @chq/hub type-check && pnpm --filter @chq/hub test` pass.

## Files

- `packages/hub/src/approvals/risk-classifier.ts` (new)
- `packages/hub/src/approvals/__tests__/risk-classifier.test.ts` (new)
- Existing hub approval-creation path (discover with `grep -rn 'risk_level' packages/hub/src`)

## Verify

```bash
pnpm --filter @chq/hub type-check
pnpm --filter @chq/hub test
```

## Done

Every new approval request has a deterministic `risk_level`, and the classifier module has full unit-test coverage of the Read/Edit/Bash/critical-pattern matrix.
