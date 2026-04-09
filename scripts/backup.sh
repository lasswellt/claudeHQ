#!/usr/bin/env bash
# CAP-100 / story 019-005: point-in-time SQLite backup.
#
# Creates an atomic snapshot of the hub's SQLite database via
# `sqlite3 .backup` (NOT a raw file copy — `.backup` holds the
# right locks and produces a consistent file even while the hub
# is actively writing).
#
# Usage:
#   ./scripts/backup.sh                 # writes to ./backups/
#   BACKUP_DIR=/mnt/nas/chq ./scripts/backup.sh
#
# Suggested crontab (nightly at 03:17 local time, off the :00 mark
# so a fleet of hosts doesn't all phone home at midnight):
#   17 3 * * * /opt/claudehq/scripts/backup.sh >> /var/log/claudehq-backup.log 2>&1
#
# Retention: the script prunes backups older than
# `BACKUP_RETENTION_DAYS` (default 14). Set to 0 to keep everything.
#
# Restore procedure:
#   1. Stop the hub container:  docker compose stop hub
#   2. Copy the backup over:    cp backups/chq-YYYY-MM-DD.db data/db/chq.db
#   3. Start the hub:           docker compose start hub

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
CONTAINER_NAME="${CONTAINER_NAME:-claudehq-hub}"
DB_PATH_IN_CONTAINER="${DB_PATH_IN_CONTAINER:-/app/data/db/chq.db}"

timestamp=$(date +%Y%m%d-%H%M%S)
outfile="${BACKUP_DIR}/chq-${timestamp}.db"

mkdir -p "${BACKUP_DIR}"

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "error: container '${CONTAINER_NAME}' is not running" >&2
  exit 1
fi

echo "==> Creating backup: ${outfile}"
# Use the in-container sqlite3 .backup command — it's the only
# SQLite-sanctioned way to copy a live database.
docker exec "${CONTAINER_NAME}" sqlite3 "${DB_PATH_IN_CONTAINER}" ".backup '/tmp/chq-backup.db'"
docker cp "${CONTAINER_NAME}:/tmp/chq-backup.db" "${outfile}"
docker exec "${CONTAINER_NAME}" rm -f /tmp/chq-backup.db

# Compress to save space.
gzip -f "${outfile}"
echo "==> Wrote ${outfile}.gz"

# Prune old backups.
if [[ "${BACKUP_RETENTION_DAYS}" -gt 0 ]]; then
  echo "==> Pruning backups older than ${BACKUP_RETENTION_DAYS} days"
  find "${BACKUP_DIR}" -name 'chq-*.db.gz' -type f -mtime "+${BACKUP_RETENTION_DAYS}" -delete -print
fi

echo "==> Done"
