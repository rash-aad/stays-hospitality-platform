#!/usr/bin/env bash
# Nightly backup: a compressed logical dump of the database plus the uploads folder.
# Usage: DATABASE_URL=postgres://… UPLOAD_DIR=/data/uploads BACKUP_DIR=/backups ./scripts/backup.sh
# Keeps KEEP_DAYS (default 30) days locally; copy BACKUP_DIR off-site (e.g. rclone/aws s3 sync) after it runs.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required (owner role)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
UPLOAD_DIR="${UPLOAD_DIR:-./uploads}"
KEEP_DAYS="${KEEP_DAYS:-30}"
stamp="$(date -u +%Y-%m-%dT%H%MZ)"
mkdir -p "$BACKUP_DIR"

db="$BACKUP_DIR/stays-$stamp.dump"
pg_dump --format=custom --no-owner --compress=9 --file="$db.partial" "$DATABASE_URL"
pg_restore --list "$db.partial" > /dev/null   # fail loudly if the dump is unreadable
mv "$db.partial" "$db"

if [ -d "$UPLOAD_DIR" ]; then
  tar -czf "$BACKUP_DIR/uploads-$stamp.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'stays-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
echo "backup ok: $db ($(du -h "$db" | cut -f1))"
