#!/usr/bin/env bash
# CAP-059 / story 017-004: Tailscale Funnel provisioning.
#
# Exposes the hub's HTTP port (default 7700) publicly via Tailscale
# Funnel so GitHub can reach the webhook endpoint. Requires:
#   - tailscale CLI installed and authenticated
#   - The host's tailnet has Funnel enabled (Admin → DNS → Funnel)
#   - HTTPS cert on the Funnel hostname
#
# Usage:
#   ./tailscale-funnel.sh enable [port]
#   ./tailscale-funnel.sh disable
#   ./tailscale-funnel.sh status
#   ./tailscale-funnel.sh url

set -euo pipefail

PORT="${2:-7700}"
ACTION="${1:-status}"

require_tailscale() {
  if ! command -v tailscale >/dev/null 2>&1; then
    echo "error: tailscale CLI not found on PATH" >&2
    exit 2
  fi
}

cmd_enable() {
  require_tailscale
  echo "==> Enabling Funnel on port ${PORT}..."
  tailscale funnel --bg "${PORT}"
  echo "==> Funnel URL:"
  cmd_url
}

cmd_disable() {
  require_tailscale
  echo "==> Disabling Funnel..."
  tailscale funnel reset
}

cmd_status() {
  require_tailscale
  tailscale funnel status
}

cmd_url() {
  require_tailscale
  # tailscale status --json reports the DNS name of this machine;
  # the Funnel URL is https://<dnsname> by convention.
  local dns
  dns="$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName":[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 | sed 's/\.$//')"
  if [[ -z "${dns}" ]]; then
    echo "error: could not determine Tailscale DNS name" >&2
    exit 2
  fi
  printf "https://%s\n" "${dns}"
}

case "${ACTION}" in
  enable) cmd_enable ;;
  disable) cmd_disable ;;
  status) cmd_status ;;
  url) cmd_url ;;
  *)
    echo "usage: $0 {enable|disable|status|url} [port]" >&2
    exit 1
    ;;
esac
