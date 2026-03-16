---
description: "Sprint review and quality gate"
argument-hint: "--sprint NNN | --auto-fix"
---
Sprint review -- delegates to `sprint-review` skill.

Arguments: $ARGUMENTS
Supported flags: --sprint NNN, --auto-fix

## Pre-Step: Load Context

- Read `docs/_context/registry.json` for sprint state.
- Identify the current or specified sprint.
- Read the sprint plan and implementation records.

## Workflow

1. **Parse arguments**
   - `--sprint NNN`: Review a specific sprint number (e.g., `--sprint 001`)
   - `--auto-fix`: Automatically fix issues found during review (linting, formatting, minor type errors)
   - No flags: review the current active sprint

2. **Invoke `sprint-review` skill with flags**
   - Pass sprint number and auto-fix preference
   - The skill runs quality gates:
     - TypeScript type checking (`tsc --noEmit`)
     - ESLint linting
     - Prettier formatting check
     - Vitest test suite
     - Acceptance criteria validation per story
   - Each story is reviewed against its acceptance criteria
   - Cross-package integration points are validated

3. **Report results**
   - Quality gate pass/fail summary
   - Per-story acceptance criteria status
   - Issues found (with file paths and descriptions)
   - Auto-fixes applied (if `--auto-fix` was used)
   - Sprint velocity metrics
   - Update registry.json with review results
   - Suggest next steps (fix issues, start next sprint, etc.)

## Usage

- `/review` -- review current sprint
- `/review --sprint 001` -- specific sprint
- `/review --auto-fix` -- auto-fix failures
