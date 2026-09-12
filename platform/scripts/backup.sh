#!/usr/bin/env bash

# Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

#
# EvoPlatform backup — dumps the platform Postgres database AND the RSA signing
# keys. Both matter: losing the DB loses tenants/users/billing state; losing the
# keys (KEYS_DIR) invalidates every outstanding access/refresh token, forcing all
# users to re-authenticate. The keys dump contains a PRIVATE KEY — keep the
# backup directory locked down (this script chmods it 700).
#
# Usage (on the host running the docker compose stack):
#   ./backup.sh                      # uses defaults below
#   BACKUP_DIR=/mnt/backups ./backup.sh
#
# Restore: see restore notes printed at the end, or scripts/restore.sh.
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-evoplatform_db}"
DB_USER="${DB_USER:-evoplatform}"
DB_NAME="${DB_NAME:-evoplatform}"
KEYS_DIR="${KEYS_DIR:-./keys}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN="${RETAIN:-14}"        # keep this many of each artifact

ts="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "==> Dumping database $DB_NAME from container $DB_CONTAINER"
docker exec -t "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" \
  | gzip > "$BACKUP_DIR/db-$ts.sql.gz"
echo "    -> $BACKUP_DIR/db-$ts.sql.gz ($(du -h "$BACKUP_DIR/db-$ts.sql.gz" | cut -f1))"

if [ -d "$KEYS_DIR" ]; then
  echo "==> Archiving signing keys from $KEYS_DIR"
  tar czf "$BACKUP_DIR/keys-$ts.tgz" -C "$(dirname "$KEYS_DIR")" "$(basename "$KEYS_DIR")"
  chmod 600 "$BACKUP_DIR/keys-$ts.tgz"
  echo "    -> $BACKUP_DIR/keys-$ts.tgz"
else
  echo "!!  KEYS_DIR ($KEYS_DIR) not found — skipping key backup. Tokens rely on"
  echo "!!  these keys; make sure they are backed up from wherever they live."
fi

echo "==> Pruning to the newest $RETAIN of each artifact"
ls -1t "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null | tail -n +$((RETAIN + 1)) | xargs -r rm -f
ls -1t "$BACKUP_DIR"/keys-*.tgz   2>/dev/null | tail -n +$((RETAIN + 1)) | xargs -r rm -f

echo
echo "Backup complete. To restore:"
echo "  DB:   gunzip -c $BACKUP_DIR/db-$ts.sql.gz | docker exec -i $DB_CONTAINER psql -U $DB_USER -d $DB_NAME"
echo "  Keys: tar xzf $BACKUP_DIR/keys-$ts.tgz -C <target-parent-of-keys-dir>"
echo
echo "Ship these off-box (e.g. to S3 or another host) — a backup on the same"
echo "machine does not survive losing the machine."
