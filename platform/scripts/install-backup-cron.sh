#!/usr/bin/env bash

# Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

#
# Install (or repair) the nightly backup schedule.
#
# The schedule lives here rather than only in `crontab -l`, which is the whole
# point: the previous entry pointed at a directory that had been renamed and a
# container that no longer existed, and nothing in any repository recorded what
# it was supposed to say. It failed every night for over a month and the only
# evidence was a log nobody read. A schedule that exists only on the box is as
# lost as a deleted file.
#
# Usage, on the host:
#   sudo bash install-backup-cron.sh         # install/replace, then show it
#   bash install-backup-cron.sh --dry-run    # print the line, change nothing
#   bash install-backup-cron.sh --check      # verify the installed line matches
#
# Invoked with `bash`, because the deploy archive is built on Windows and
# cannot carry a Unix execute bit - these files arrive mode 644.
#
# It is idempotent: the entry is tagged with a marker comment and replaced,
# never appended, so running it twice leaves one schedule.
set -euo pipefail

STACK_DIR="${STACK_DIR:-/home/ubuntu/stack/evo-platform}"
SECRETS_DIR="${SECRETS_DIR:-/home/ubuntu/stack/evo-platform-secrets}"
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/backups/evoplatform}"
DB_CONTAINER="${DB_CONTAINER:-evo-platform-prod-db-1}"
LOG="${LOG:-/var/log/evoplatform-backup.log}"
SCHEDULE="${SCHEDULE:-30 3 * * *}"

MARKER="# evoplatform-backup (managed by platform/scripts/install-backup-cron.sh)"
# Invoked as `bash scripts/backup.sh`, not `./scripts/backup.sh`. The deploy
# archive is built on Windows, which cannot carry a Unix execute bit, so the
# file arrives mode 644 however it is stored in git - and `./script` then fails
# with "Permission denied" on every deploy. Calling bash explicitly does not
# care.
LINE="$SCHEDULE cd $STACK_DIR && BACKUP_DIR=$BACKUP_DIR KEYS_DIR=$SECRETS_DIR/keys DB_CONTAINER=$DB_CONTAINER bash scripts/backup.sh >> $LOG 2>&1"

mode="install"
case "${1:-}" in
  --dry-run) mode="dry-run" ;;
  --check)   mode="check" ;;
  "")        mode="install" ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

if [ "$mode" = "dry-run" ]; then
  printf '%s\n%s\n' "$MARKER" "$LINE"
  exit 0
fi

current="$(crontab -l 2>/dev/null || true)"

if [ "$mode" = "check" ]; then
  if printf '%s\n' "$current" | grep -Fqx "$LINE"; then
    echo "OK: the installed schedule matches this repository."
    exit 0
  fi
  echo "DRIFT: the installed schedule does not match this repository." >&2
  echo "--- installed ---" >&2
  printf '%s\n' "$current" | grep -F 'backup.sh' >&2 || echo "(no backup entry at all)" >&2
  echo "--- expected ---" >&2
  printf '%s\n' "$LINE" >&2
  exit 1
fi

# Drop any previous entry - the marked one and any unmarked legacy line that
# calls this script - then append the current one.
kept="$(printf '%s\n' "$current" \
  | grep -vF "$MARKER" \
  | grep -vF 'scripts/backup.sh' || true)"

printf '%s\n%s\n%s\n' "$kept" "$MARKER" "$LINE" | sed '/^$/d' | crontab -

echo "Installed:"
crontab -l | grep -A1 -F "$MARKER"
echo
echo "Verify it works now, rather than trusting tomorrow night:"
echo "  cd $STACK_DIR && BACKUP_DIR=$BACKUP_DIR KEYS_DIR=$SECRETS_DIR/keys DB_CONTAINER=$DB_CONTAINER bash scripts/backup.sh"
