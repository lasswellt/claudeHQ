---
description: "Sprint implementation phase only"
argument-hint: "--sprint NNN | --stories STORY-XXX-001,STORY-XXX-002"
---
Sprint implementation -- delegates to `sprint-dev` skill.

Arguments: $ARGUMENTS
Supported flags: --sprint NNN, --stories STORY-XXX-001,...

## Pre-Step: Load Context

- Read `docs/_context/registry.json` for activeContext.
- Identify the current or specified sprint and its stories.
- Read the sprint plan document for story details and dependency order.

## Workflow

1. **Parse arguments**
   - `--sprint NNN`: Target a specific sprint number (e.g., `--sprint 001`)
   - `--stories STORY-XXX-001,...`: Implement only specific stories (comma-separated)
   - No flags: implement all stories in the current active sprint

2. **Invoke `sprint-dev` skill with flags**
   - Pass sprint number and/or story IDs
   - The skill handles: code generation, test writing, file organization
   - Each story is implemented in dependency order
   - Progress is tracked in the sprint backlog

3. **Report results**
   - List stories completed vs remaining
   - Report any blocked stories and why
   - Update registry.json with implementation progress
   - Suggest `/review` as next step

## Usage

- `/implement` -- implement current sprint
- `/implement --sprint 001` -- specific sprint
- `/implement --stories STORY-001-001,STORY-001-002` -- specific stories
