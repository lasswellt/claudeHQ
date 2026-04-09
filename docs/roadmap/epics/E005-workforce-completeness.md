---
id: E005
title: 'Workforce Completeness'
phase: R5
domain: 'workforce, github-integration, workforce-dashboard'
capabilities: ['CAP-050', 'CAP-053', 'CAP-055', 'CAP-056', 'CAP-062', 'CAP-066']
status: planned
depends_on: ['E001']
estimated_stories: 9
---

# Workforce Completeness

## Description

Close the gaps in the workforce platform: workspace TTL cleanup, pre/post-flight checks, multi-repo batch launcher (backend + UI), workspace/git WebSocket message wiring end-to-end, and the GitHub Checks API lifecycle (in_progress → completed).

## Capabilities Addressed

| ID      | Coverage                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------- |
| CAP-050 | Workspace state machine completion (stale → cleanup) + TTL sweeper + max workspaces per machine |
| CAP-053 | pre_flight_commands and post_flight_commands honored end-to-end with pass/fail capture          |
| CAP-055 | `POST /api/jobs/batch` with repoIds/tags filter, maxConcurrency, cancel-all                     |
| CAP-056 | Workspace + git status WS messages wired to hub + dashboard live updates                        |
| CAP-062 | Checks API: in_progress on branch push → completed with conclusion + output + annotations       |
| CAP-066 | Batch launcher dashboard page (multi-select/tag filter, concurrency slider, batch detail)       |

## Acceptance Criteria

1. Workspaces idle longer than the configured TTL transition `ready → stale → cleanup → deleted` automatically. Max-workspaces-per-machine limit enforced at provisioning time.
2. Repo config `pre_flight_commands` run after setup; any failure transitions the job to `failed` with the pre-flight output captured. `post_flight_commands` run after the Claude session ends; output and pass/fail status appear in job detail.
3. `POST /api/jobs/batch` accepts `{ repoIds[] | tags, prompt, branchPrefix?, maxConcurrency?, autoPr? }` and creates a child job per repo, respecting the concurrency cap. Cancel-all cascades to child jobs.
4. Workspace/git WS messages (`agent:workspace:cloning|preparing|ready|error|cleaned`, `agent:git:status|committed|pushed`) surface live in the dashboard workspace view and in the activity feed. (Requires E001 HI-01 fix.)
5. When an agent creates a PR, a GitHub check run is created with name `Claude HQ Agent`, status `in_progress`. On job completion the check updates to `completed` with conclusion (success/failure), output (summary, test_passed), and annotations if errors occurred.
6. Batch launcher page supports multi-select of repos OR tag filter, concurrency slider (1-10, default 3), prompt textarea, advanced options (branch-prefix, auto-pr, max-cost). Batch detail page renders a status table with per-repo progress and a batch cancel button.

## Technical Approach

- TTL sweeper reuses the same cron infrastructure as CAP-024 (approvals timeout sweeper). Runs hourly.
- Pre/post-flight runners stream output via existing WS protocol and persist to job metadata.
- Batch launcher: child jobs are tracked via a `batch_id` column; cancellation is fan-out.
- Checks API uses `@octokit/rest` — already integrated. Implementation is a lifecycle wrapper around `octokit.checks.create` and `octokit.checks.update`.
- Workspace/git WS messages are ALREADY defined in the shared protocol (as noted in the codebase review) but absent from the discriminated unions — E001 adds them, this epic exercises them end-to-end.

## Stories (Outline)

1. **Workspace TTL sweeper + max-per-machine cap.** (Points: 3)
2. **Pre-flight runner + streaming output.** (Points: 3)
3. **Post-flight runner + pass/fail capture.** (Points: 3)
4. **Batch jobs API + schema + cascade cancel.** (Points: 5)
5. **Batch launcher Nuxt page + concurrency slider.** (Points: 5)
6. **Batch detail page with per-repo status table.** (Points: 3)
7. **Checks API lifecycle wrapper + integration.** (Points: 3)
8. **Workspace/git WS end-to-end wiring + dashboard view.** (Points: 5)
9. **E2E test: batch of 3 repos → 3 jobs → 3 PRs → 3 checks.** (Points: 3)

## Dependencies

- **Requires**: E001 (HI-01 protocol cleanup unblocks workforce WS wiring)
- **Enables**: E006 (GitHub wizard leverages lifecycle completeness)

## Risk Factors

- Cascading batch cancel has distributed failure modes — ensure partial cancellation leaves consistent state.
- Pre-flight failure UX must clearly distinguish "pre-flight failed" from "Claude job failed" so users can diagnose.
- GitHub Checks API has rate limits on large batches; throttle check creation per-repo with a delay on large batches.
