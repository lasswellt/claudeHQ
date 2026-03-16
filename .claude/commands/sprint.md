---
description: "Full sprint cycle: plan, implement, review"
argument-hint: "--epics EP-001,EP-002 | --plan-only | --skip-review"
---
Sprint cycle orchestrator: plan, implement, review.

Arguments: $ARGUMENTS
Supported flags: --plan-only, --skip-review, --epics EPIC-NNN

## Pre-Step: Load Context

- Read `docs/_context/registry.json` for activeContext.

## Workflow

1. **Parse arguments** -- extract flags
   - `--plan-only`: Stop after planning phase
   - `--skip-review`: Skip the review phase
   - `--epics EPIC-NNN,EPIC-NNN`: Target specific epics (comma-separated)
   - No flags: auto-select next epics from the epic registry based on dependency order and priority

2. **Plan phase** -- invoke `sprint-plan` skill
   - Pass `--epics` if specified
   - Sprint plan will break epics into stories, estimate effort, create sprint backlog
   - Review the generated sprint plan before proceeding

3. **Implement phase** (unless --plan-only) -- invoke `sprint-dev` skill
   - Implements all stories in the sprint backlog
   - Follows dependency order within the sprint
   - Creates branches, writes code, runs tests

4. **Review phase** (unless --skip-review) -- invoke `sprint-review` skill
   - Runs quality gates (type checking, linting, tests)
   - Validates acceptance criteria for each story
   - Generates sprint review report

5. **Report** -- summary, quality gates, update registry.json
   - Update epic statuses in registry
   - Record sprint completion metrics
   - Suggest next sprint if applicable

## Usage

- `/sprint` -- full cycle, auto-select next epics
- `/sprint --plan-only` -- plan only
- `/sprint --epics EPIC-001,EPIC-002` -- specific epics
- `/sprint --skip-review` -- skip review phase
