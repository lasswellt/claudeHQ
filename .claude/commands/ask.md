---
description: "Task intake: refine a vague request and dispatch to the right skill(s)"
argument-hint: "<describe what you want to do>"
model: opus
---

# Ask: Task Intake and Routing

Given a vague or open-ended task description, clarify scope, identify the right
skill(s), and dispatch them in sequence.

## Pre-Step: Load Context

- Read `docs/_context/registry.json` for activeContext (current sprint, phase).
- Read `.claude/shared/skill-graph.md` for the routing table and chain definitions.

## Phase 1: Classify the Request

The user's request is: $ARGUMENTS

Classify against the routing table in `skill-graph.md`.

If the request clearly maps to a single skill with all needed arguments, skip
Phase 2 and go directly to Phase 3.

## Phase 2: Clarify (1-3 questions maximum)

Ask only what is needed to route correctly:

For bugs: "Is there a GitHub issue number?" / "Which component is affected?"
For UI: "Which dashboard view?" / "New page or polish existing?"
For features: "Small addition or full feature with backend?" / "Does this have an epic?"
For refactoring: "Goal -- performance, readability, splitting?"
For protocol: "Adding new message types or modifying existing?"

## Phase 3: Construct the Plan

Determine skill(s) to invoke, arguments, prerequisites.

Present:
```
Here's what I'll do:
1. /skill-name [args] -- [purpose]
2. /skill-name [args] -- [purpose] (after #1)

Proceed? (yes / adjust / cancel)
```

## Phase 4: Dispatch

Invoke each skill sequentially using the Skill tool.

## Usage Examples

- `/ask fix the WebSocket relay bug` -> asks for issue # -> `/fix-issue 42`
- `/ask build the session view page` -> `/dashboard-build` -> `/dashboard-qa`
- `/ask add queue management` -> scopes -> `/sprint-plan` -> `/sprint-dev`
- `/ask refactor the PTY pool` -> confirms goal -> `/refactor` -> `/test-gen`
- `/ask research xterm.js addons` -> `/research` -> presents findings
- `/ask generate protocol types` -> directly maps -> `/protocol-gen`
- `/ask check dashboard for errors` -> `/dashboard-qa smoke`
