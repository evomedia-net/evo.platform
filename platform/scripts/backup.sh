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
#
# ── Why this script is paranoid about failure ────────────────────────────────
#
# It used to write `docker exec … | gzip > out.gz` directly. When the container
# name was wrong the redirect still created out.gz, gzip still wrote its 20-byte
# empty-stream header, and `set -e` then aborted before anything printed a
# summary. The backup directory filled with 20-byte files that looked like
# backups for over a month while containing zero rows, and nightly cron mailed
# nobody. A backup that fails loudly is worth more than one that appears to
# succeed, so every artifact here is written to a temp file, verified, and only
# then moved into place — and a failed run leaves nothing behind to mistake for
# a backup.
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-evo-platform-prod-db-1}"
DB_USER="${DB_USER:-evoplatform}"
DB_NAME="${DB_NAME:-evoplatform}"
KEYS_DIR="${KEYS_DIR:-./keys}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN="${RETAIN:-14}"        # keep this many of each artifact
# The keys cannot be regenerated: losing them logs out every user and makes
# every stored SMTP password undecryptable. Missing keys is therefore a
# failure, not a warning. Set REQUIRE_KEYS=0 only for a DB-only run you have
# thought about.
REQUIRE_KEYS="${REQUIRE_KEYS:-1}"

fail() { echo "!!  $*" >&2; exit 1; }

ts="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

work="$(mktemp -d "${TMPDIR:-/tmp}/evoplatform-backup-XXXXXX")"
# Any exit removes the scratch directory, so a half-written dump never lands
# in BACKUP_DIR where a later restore might trust it.
trap 'rm -rf "$work"' EXIT

# ── Preflight ───────────────────────────────────────────────────────────────
# Check the things that were wrong for a month, before writing anything.
echo "==> Preflight"
command -v docker >/dev/null 2>&1 || fail "docker is not on PATH"

if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "!!  No such container: $DB_CONTAINER" >&2
  echo "!!  Running database containers:" >&2
  docker ps --format '      {{.Names}}' 2>/dev/null | grep -iE 'db|postgres' >&2 || echo "      (none)" >&2
  fail "Set DB_CONTAINER to the right one and re-run."
fi

docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1 \
  || fail "Postgres in $DB_CONTAINER is not ready for user=$DB_USER db=$DB_NAME"

if [ ! -d "$KEYS_DIR" ]; then
  if [ "$REQUIRE_KEYS" = "1" ]; then
    fail "KEYS_DIR ($KEYS_DIR) not found. These keys cannot be regenerated — losing them logs out every user and makes stored SMTP passwords undecryptable. Point KEYS_DIR at the real directory, or set REQUIRE_KEYS=0 if you genuinely want a database-only backup."
  fi
  echo "    keys: skipped (REQUIRE_KEYS=0)"
fi
echo "    container=$DB_CONTAINER db=$DB_NAME keys=$KEYS_DIR"

# ── Database ────────────────────────────────────────────────────────────────
echo "==> Dumping database $DB_NAME from container $DB_CONTAINER"
# No -t. The original used it, which allocates a TTY and corrupts a dump piped
# to a file with carriage returns. -T is NOT the fix - that is a docker compose
# flag and `docker exec` rejects it outright ("unknown shorthand flag: 'T'").
# Plain `docker exec` writes clean bytes to stdout, which is all this needs.
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$work/db.sql.gz"

gzip -t "$work/db.sql.gz" 2>/dev/null || fail "the dump is not valid gzip — refusing to keep it"
# An empty stream gzips to about 20 bytes; a real schema is far larger. The
# marker check is the one that actually proves pg_dump ran.
gunzip -c "$work/db.sql.gz" | head -c 4096 | grep -q 'PostgreSQL database dump' \
  || fail "the dump has no PostgreSQL header — pg_dump produced nothing usable"
rows="$(gunzip -c "$work/db.sql.gz" | wc -l)"
[ "$rows" -gt 20 ] || fail "the dump is only $rows lines — refusing to keep it"

mv "$work/db.sql.gz" "$BACKUP_DIR/db-$ts.sql.gz"
chmod 600 "$BACKUP_DIR/db-$ts.sql.gz"
echo "    -> $BACKUP_DIR/db-$ts.sql.gz ($(du -h "$BACKUP_DIR/db-$ts.sql.gz" | cut -f1), $rows lines)"

# ── Signing keys ────────────────────────────────────────────────────────────
if [ -d "$KEYS_DIR" ]; then
  echo "==> Archiving signing keys from $KEYS_DIR"
  tar czf "$work/keys.tgz" -C "$(dirname "$KEYS_DIR")" "$(basename "$KEYS_DIR")"
  tar tzf "$work/keys.tgz" >/dev/null 2>&1 || fail "the key archive is unreadable — refusing to keep it"
  tar tzf "$work/keys.tgz" | grep -q 'private' \
    || fail "the key archive contains no private key — check KEYS_DIR ($KEYS_DIR)"
  mv "$work/keys.tgz" "$BACKUP_DIR/keys-$ts.tgz"
  chmod 600 "$BACKUP_DIR/keys-$ts.tgz"
  echo "    -> $BACKUP_DIR/keys-$ts.tgz"
fi

# ── Prune ───────────────────────────────────────────────────────────────────
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
