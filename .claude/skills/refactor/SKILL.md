---
name: refactor
description: |
  Safe, incremental refactoring with verification after each step. Snapshot
  before, analyze dependencies, execute changes, verify types/tests/build.
  Use when: "refactor X", "clean up", "restructure", "extract", "rename"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, WebSearch, WebFetch, ToolSearch
model: opus
---

# Refactor Skill

Safe, incremental code refactoring for the claudeHQ project. Every change is verified before proceeding to the next. Regressions trigger an immediate rollback of the current step.

---

## Phase 0: CONTEXT

Load project context before refactoring.

1. **Read project state files** (skip any that don't exist):
   - `.claude/shared/codebase-inventory.json` — file map, module boundaries, dependency graph
   - `.claude/shared/registry.json` — cross-skill state

2. **Identify package scopes:** agent, hub, dashboard, shared, protocol — all under `packages/`.

3. **Note build/test/check commands:**
   - Type check: `pnpm type-check` or `pnpm --filter @chq/<pkg> type-check`
   - Tests: `npx vitest run` or `pnpm --filter @chq/<pkg> test`
   - Full build: `pnpm turbo build` or `pnpm --filter @chq/<pkg> build`
   - Lint: `pnpm lint` or `pnpm --filter @chq/<pkg> lint`

---

## Step 1: SNAPSHOT

Capture the current state before making any changes.

1. **Record the baseline verification results:**
   ```bash
   pnpm type-check 2>&1 | tail -5
   npx vitest run 2>&1 | tail -10
   pnpm turbo build 2>&1 | tail -5
   ```
   Store pass/fail status and any pre-existing failures. These are the baseline — the refactor must not introduce new failures.

2. **Create a snapshot of the current state:**
   ```bash
   git stash push -m "refactor-snapshot-$(date +%s)" --include-untracked
   git stash pop
   ```
   This creates a recoverable point. If the refactor goes wrong, we can return here.

3. **Document the snapshot:** Note the git SHA, baseline test results, and any pre-existing issues.

---

## Step 2: ANALYZE DEPENDENCIES

Map the dependency graph for the code being refactored.

1. **Identify the refactoring target:** Parse the user's request to determine:
   - Target files, functions, modules, or patterns
   - The type of refactoring: extract, rename, restructure, consolidate, simplify, decompose
   - Which package(s) are affected

2. **Map imports and dependents:**
   - For each target file, find all files that import from it:
     ```
     Grep for: import.*from.*['"].*<target-module>
     Grep for: require.*['"].*<target-module>
     ```
   - For each target function/type/constant, find all usage sites
   - Build a dependency list: files that must change if the target changes

3. **Cross-package dependencies:** Pay special attention to:
   - `packages/shared/` exports used by agent, hub, and dashboard
   - Protocol types used in WebSocket message handlers on both sides
   - Zod schemas used for validation across packages

4. **Assess blast radius:**
   - **Small:** Changes contained to 1-3 files in one package
   - **Medium:** Changes span multiple files or touch shared types
   - **Large:** Changes affect multiple packages or public APIs

---

## Step 3: PLAN STEPS

Break the refactoring into discrete, verifiable steps.

1. **Decompose the refactoring** into the smallest independently-verifiable steps. Each step should:
   - Be completable in one pass
   - Leave the codebase in a compilable, testable state
   - Be reversible if it causes failures

2. **Order steps by dependency:**
   1. Shared types / protocol changes (if any) — always first
   2. Internal restructuring (extract, rename within a file)
   3. Cross-file changes (update imports, move code)
   4. Cleanup (remove dead code, update comments)

3. **For each step, document:**
   - What changes
   - Which files are affected
   - What verification to run (can be package-scoped for speed)
   - Rollback strategy if verification fails

4. **Present the plan to the user** before executing, unless the refactoring is clearly small and safe.

---

## Step 4: EXECUTE INCREMENTALLY

Execute each step from the plan, verifying after each.

### For each step:

1. **Make the changes** using `Edit` for precise modifications.

2. **Verify immediately after each step:**
   ```bash
   # Type check (fast, catches most issues)
   pnpm --filter @chq/<affected-pkg> type-check

   # Run tests for the affected package
   pnpm --filter @chq/<affected-pkg> test

   # If changes touch shared types, check all downstream packages too
   pnpm type-check
   ```

3. **If verification passes:** Proceed to the next step.

4. **If verification fails:**
   - **Analyze the failure.** Is it caused by this step or pre-existing?
   - **If caused by this step:** Fix the issue within this step. Re-verify.
   - **If fix attempt fails after 2 tries:** Revert this step's changes and re-plan.
   - **Never modify tests to make them pass.** If a test fails, either the refactoring is wrong or the test is testing implementation details. Understand which before acting.

5. **After each successful step,** create a checkpoint:
   ```bash
   git add -A && git commit -m "refactor: step N - <description>"
   ```
   This allows reverting individual steps if later steps cause issues.

---

## Step 5: FINAL VERIFICATION

After all steps are complete, run full verification.

1. **Full type check** across all packages:
   ```bash
   pnpm type-check
   ```

2. **Full test suite:**
   ```bash
   npx vitest run
   ```

3. **Full build:**
   ```bash
   pnpm turbo build
   ```

4. **Lint:**
   ```bash
   pnpm lint
   ```

5. **Compare against baseline** from Step 1:
   - No new type errors
   - No new test failures
   - Build still succeeds
   - No new lint errors

6. **If any new failures exist:** Trace them back to the specific step that introduced them. Fix or revert that step.

---

## Step 6: REPORT

Present the refactoring results to the user.

1. **Summary:** What was refactored and why (1-2 sentences).
2. **Changes made:** List of files modified/created/deleted with brief descriptions.
3. **Verification results:**
   - Type check: pass/fail
   - Tests: pass/fail (N tests, N suites)
   - Build: pass/fail
   - Lint: pass/fail
4. **Metrics improvement** (if applicable):
   - Lines of code reduced
   - Cyclomatic complexity reduced
   - Duplicate code eliminated
   - Import graph simplified
5. **Remaining concerns:** Any code smells or further refactoring opportunities discovered.

---

## Safety Rules

These rules are inviolable during refactoring:

1. **Never modify test assertions to make them pass.** If a test fails, the refactoring is wrong or the test is testing an implementation detail. Understand which.
2. **Always verify after each step.** No batching changes without verification.
3. **Abort on regression.** If a step introduces failures that cannot be fixed within 2 attempts, revert the step and re-plan.
4. **Preserve public API contracts.** If external consumers (other packages) depend on an API, maintain backward compatibility or update all consumers in the same step.
5. **Shared types change first.** Any change to `packages/shared/` must be completed and verified before changing consumer packages.
6. **No dead code left behind.** If code is extracted or moved, remove the original. If imports are updated, remove unused imports.

---

## Follow-up Skills

After completing the refactoring:

1. **test-gen** — if the refactored code has insufficient test coverage:
   > "Run `/test-gen` targeting the refactored modules to ensure coverage."

---

## Phase Final: REGISTER

Update tracking files after refactoring.

1. **Update `.claude/shared/codebase-inventory.json`** if the refactoring changed:
   - File locations (moved/renamed files)
   - Module boundaries (extracted/merged modules)
   - Export surfaces (new/removed public APIs)

2. **Log execution** in `.claude/shared/registry.json`:
   - Update `lastExecution`: `{ "skill": "refactor", "target": "<description>", "date": "<YYYY-MM-DD>", "status": "complete", "filesChanged": <count> }`

3. **Squash commits** if requested by the user. Otherwise, leave the per-step commits for traceability:
   ```bash
   git log --oneline -N  # Show the step commits for review
   ```
