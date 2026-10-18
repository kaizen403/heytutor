ALTER TABLE turns
  ADD COLUMN sentry_event_id VARCHAR(32),
  ADD COLUMN sentry_failure_event JSONB,
  ADD COLUMN sentry_reported_at TIMESTAMPTZ(6),
  ADD COLUMN sentry_next_attempt_at TIMESTAMPTZ(6);

CREATE INDEX turns_sentry_pending_idx ON turns (sentry_next_attempt_at, id)
  WHERE sentry_failure_event IS NOT NULL AND sentry_reported_at IS NULL;

CREATE INDEX turns_sentry_abandoned_idx ON turns (updated_at)
  WHERE status = 'live' AND sentry_event_id IS NULL;
