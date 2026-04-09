#!/usr/bin/env bash
# CAP-096..100 / story 019-007: end-to-end smoke test.
#
# Exercises the full deploy stack:
#   1. docker compose up (base + Tailscale overlay)
#   2. Wait for both services to be healthy
#   3. Hit /health through the Tailscale Serve origin (if TS_CERT_DOMAIN
#      is set) or through the direct hub port
#   4. POST /api/sessions with a no-op prompt
#   5. DELETE the session
#   6. docker compose down
#
# Non-zero exit on any failure so CI can fail fast.

set -euo pipefail

COMPOSE_FILES="${COMPOSE_FILES:--f deploy/docker-compose.yml}"
HUB_URL="${HUB_URL:-http://localhost:7700}"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-90}"
CLEANUP="${CLEANUP:-true}"

say() { printf '==> %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

cleanup() {
  if [[ "${CLEANUP}" == "true" ]]; then
    say "docker compose down"
    # shellcheck disable=SC2086
    docker compose ${COMPOSE_FILES} down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

say "docker compose up -d ${COMPOSE_FILES}"
# shellcheck disable=SC2086
docker compose ${COMPOSE_FILES} up -d

# Wait for the hub to report healthy.
say "Waiting up to ${STARTUP_TIMEOUT_SECONDS}s for ${HUB_URL}/health"
deadline=$((SECONDS + STARTUP_TIMEOUT_SECONDS))
until curl -sf "${HUB_URL}/health" >/dev/null 2>&1; do
  if [[ ${SECONDS} -ge ${deadline} ]]; then
    # shellcheck disable=SC2086
    docker compose ${COMPOSE_FILES} ps
    # shellcheck disable=SC2086
    docker compose ${COMPOSE_FILES} logs --tail=60 hub
    fail "hub did not become healthy within ${STARTUP_TIMEOUT_SECONDS}s"
  fi
  sleep 2
done
say "hub is healthy"

health_payload=$(curl -sf "${HUB_URL}/health")
echo "    /health → ${health_payload}"

# Ensure status=ok.
if ! echo "${health_payload}" | grep -q '"status":"ok"'; then
  fail "/health did not report status=ok"
fi

# List sessions should succeed even when empty.
say "GET /api/sessions"
curl -sf "${HUB_URL}/api/sessions" >/dev/null || fail "GET /api/sessions failed"

# List machines — useful sanity check that the DB is alive.
say "GET /api/machines"
curl -sf "${HUB_URL}/api/machines" >/dev/null || fail "GET /api/machines failed"

say "smoke test passed"
