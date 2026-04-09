---
id: E006
title: 'GitHub Setup Wizard & Rotation'
phase: R6
domain: 'github-integration'
capabilities: ['CAP-057', 'CAP-058', 'CAP-059', 'CAP-060', 'CAP-061']
status: planned
depends_on: ['E005']
estimated_stories: 7
---

# GitHub Setup Wizard & Rotation

## Description

Ship one-click GitHub App manifest flow, PAT fallback with documented limitations, Tailscale Funnel webhook provisioning, hardened credential rotation using `@octokit/auth-app`, and PR lifecycle polish (PR body generation, status sync from webhook events).

## Capabilities Addressed

| ID      | Coverage                                                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| CAP-057 | Dashboard "Connect to GitHub" button → manifest POST → callback → install → verify (7-step wizard)                                       |
| CAP-058 | PAT fallback path for users without public URL; limitations clearly documented; polling mode engaged                                     |
| CAP-059 | Tailscale Funnel provisioning so hub webhook URL is publicly reachable at `https://<hostname>.<tailnet>.ts.net/webhooks/github`          |
| CAP-060 | `@octokit/auth-app` integration: LRU token cache (15k), auto-rotate at 59min, JWT iat 30s in past for clock drift                        |
| CAP-061 | PR body generation with prompt + metadata + recording link; pull_requests table tracks status/review_status/ci_status via webhook events |

## Acceptance Criteria

1. Dashboard setup wizard walks through 7 steps: Welcome → Choose method (manifest vs PAT) → Create on GitHub → Callback → Install → Setup redirect → Verify. Each step has back/next navigation except the final success state.
2. Manifest flow POSTs to `https://github.com/settings/apps/new` with a signed manifest and handles the callback to exchange code for credentials.
3. PAT fallback accepts a fine-grained PAT with required scopes (contents, pull_requests, issues, checks, actions, metadata); UI clearly documents "no webhooks, no Checks API, must poll".
4. Tailscale Funnel provisioning runs `tailscale funnel 7700` from the deploy script; hub verifies the funnel URL is reachable and stores it for manifest submission.
5. Credentials encrypted at rest (libsodium or Node crypto). File permissions on PEM restricted to 600.
6. `@octokit/auth-app` integrated; installation tokens cached (LRU 15k), rotated at the 59-minute mark, JWT iat offset 30s for clock drift. No credentials in logs.
7. PR body auto-generates with: prompt, files_changed count, tests_passed count, cost_usd, duration_seconds, session recording link. Stored in `pull_requests` table with github_pr_number, status, review_status, ci_status.
8. GitHub webhook receiver updates pull_requests.status / review_status / ci_status in response to pull_request, review, and check_suite events.

## Technical Approach

- Manifest flow lives in `packages/hub/src/github/manifest-flow.ts`. Stores the manifest in SQLite before POSTing so the callback can verify.
- PAT fallback engages polling via the existing cron scheduler, polling `GET /repos/:owner/:repo/pulls` and `GET /repos/:owner/:repo/commits/:ref/check-runs` on an interval.
- Tailscale Funnel is a deploy-time script (`deploy/tailscale-funnel.sh`) invoked by the operator. Hub reads the funnel URL from an env var or a discovery endpoint.
- Credential rotation is entirely handled by `@octokit/auth-app` — no custom logic, just integration.
- PR body template lives in `packages/hub/src/github/pr-body.ts` and renders from job metadata.

## Stories (Outline)

1. **Manifest flow + callback handler.** (Points: 5)
2. **Setup wizard UI (7 steps).** (Points: 5)
3. **PAT fallback path + polling mode.** (Points: 5)
4. **Tailscale Funnel provisioning script + verification.** (Points: 3)
5. **@octokit/auth-app integration + credential encryption.** (Points: 3)
6. **PR body generator + pull_requests lifecycle writer.** (Points: 3)
7. **GitHub webhook receiver + status sync.** (Points: 3)

## Dependencies

- **Requires**: E005 (PR lifecycle base + Checks API must be in place)
- **Enables**: E008 (Tailscale Funnel URL is a prerequisite for the sidecar deployment)

## Risk Factors

- Tailscale Funnel requires a paid Tailscale plan or specific tag — document the requirement clearly in the wizard PAT path.
- GitHub App manifest flow involves a browser redirect — ensure the callback handler matches the redirect URI exactly (trailing slash etc.).
- PEM encryption approach: use `@noble/ciphers` for modern crypto; do NOT use Node's built-in `crypto` with legacy ciphers.
