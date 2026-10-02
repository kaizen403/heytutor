#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${HEYTUTOR_ENV_FILE:-/opt/heytutor/apps/tutor/.env.production}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

BUCKET="${S3_BUCKET:-${R2_BUCKET:-}}"
if [ -z "$BUCKET" ]; then
  echo "S3_BUCKET is required for backups" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
KEY="backups/postgres-${STAMP}.sql.gz"

umask 077
BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/heytutor-db-backup.XXXXXX")"
trap 'rm -f -- "${BACKUP_DIR}/postgres.sql.gz"; rmdir -- "$BACKUP_DIR"' EXIT
pg_dump "$DATABASE_URL" --no-owner --no-acl | gzip > "${BACKUP_DIR}/postgres.sql.gz"
# The instance may create backups, but cannot read, delete or overwrite one.
# PutObject is intentionally used instead of the unconditional s3 cp uploader.
aws s3api put-object --bucket "$BUCKET" --key "$KEY" \
  --body "${BACKUP_DIR}/postgres.sql.gz" --if-none-match '*' >/dev/null
echo "wrote s3://${BUCKET}/${KEY}"
