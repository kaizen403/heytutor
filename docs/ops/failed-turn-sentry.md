# Failed-turn Sentry events

The saved turn is the reporting boundary. The fails list, KPI, historical queue
and Sentry use the same positive failure evidence: a requested visual retry,
an approved failure diagnostic, an explicit teaching failure, or a completed
turn with zero recorded segments. Each confirmed failed turn queues one
content-free event, including failed teaching with a verified diagram.
Live checkpoints wait for a terminal outcome. An idle tab is recovered after
the existing two-minute stopped-turn threshold without changing lesson status,
only for activity since this server started and within the last hour, and only
when a confirmed failure diagnostic exists. An otherwise healthy abandoned tab
is not a failed lesson and does not emit. Older
rows require the explicit backfill; startup does not automatically backfill.
Queueing and delivery require both `NODE_ENV=production` and the explicit
`SENTRY_ENVIRONMENT=production` deployment opt-in. Local development, local
production builds without that marker, tests and lab environments cannot queue,
scan or send failed-turn events even when a production DSN is present.
Expected no-figure lessons and healthy continuations do not emit failed-turn
events. Missing historical evidence remains visible as Unverified in All logs.

## Delivery and privacy

The event uses fingerprint `turn-failure / stage / code / subject`, with tags
`area=turn-failure`, `subject`, `stage`, `code`, `figure_need`, `strict_subjects`,
`provider`, `deployment`, `release`, `environment` and `reporting_origin`.
Live reports carry `reporting_origin=live`; manual backfills carry
`reporting_origin=backfill`, including after refresh, recovery or resume. Taught lessons use warning;
failed teaching or a lesson with no meaningful teaching uses error. Muted
handwriting/code counts as teaching. Extras contain
only bounded counts and approved issue codes.

The turn transaction reserves a random event ID and clean event payload in the
same commit. Repeated saves and checkpoints reuse the reservation. Stopped
outcomes wait two minutes so late checkpoints can finish. Pending events refresh
their severity and counts while preserving ID and timestamp; a verified recovery
cancels the pending delivery. Cancellation keeps only its timestamp and reporting origin so a later
resume/re-abandonment can reuse the same identity and timestamp. Cancelled
reservations have no active admin link. A recovery after an event is accepted cannot retract it.

The EC2 process drains five events every ten seconds; surplus stays in Postgres. A
dedicated Sentry client has no automatic integrations or inherited request
scope. The final privacy hook rebuilds the approved event, dropping user,
request, exception, breadcrumb, context and arbitrary extra data.

Delivery requires a successful HTTP response, not just an SDK flush. Failed or
unacknowledged attempts retain their payload and retry after a one-minute
lease with the same event ID and persisted timestamp. A crash after Sentry
accepts an event can cause a retry. Sentry deduplicates stored rows by project,
event ID and timestamp day, so the timestamp must also survive retries.
Issue counters can count duplicate attempts before that deduplication. This is
one durable event identity per turn, not a distributed exactly-once guarantee.
Reported queue payloads are cleared. Pending rows and content-free cancelled
reservations follow turn deletion and
retention. Workers do not extend the turn's activity timestamp.

The admin row shows the event ID and a **View in Sentry** link only for pending
or reported receipts. A queued event
becomes searchable after delivery. Historical rows need the explicit backfill
below; this PR does not perform a backfill or deploy its application changes.

## Owner settings

The read-only audit on 2026-10-14 found runtime variable names `SENTRY_DSN`,
`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG` and `SENTRY_PROJECT` present. No Sentry
parameter names were returned by SSM `DescribeParameters`. Values were not printed. A later owner-authorized configuration check confirmed both DSN names
have nonempty settings. The missing `SENTRY_RELEASE` was set to the deployed
checkout's full SHA; the idle service was restarted and passed its health check.
No DSN value was copied or printed. `SENTRY_AUTH_TOKEN` remains absent; no token
is needed for event ingestion.

Before the owner deploys an approved commit:

1. Keep the existing `SENTRY_DSN` for server events and
   `NEXT_PUBLIC_SENTRY_DSN` for browser events. If either is actually empty,
   obtain the DSN from project `personal-9bo/heytutor` settings. The browser
   setting must exist before the build. No new DSN is indicated by this audit.
2. Keep **`SENTRY_RELEASE` equal to the exact deployed 40-character git SHA** in
   the server's `.env.production`. This PR stamps it and
   `SENTRY_ENVIRONMENT=production` automatically for the build and service on
   each AWS deployment, preserving other settings and permissions. Ensure
   `NODE_ENV=production`; leave `SENTRY_ENABLED` unset or enabled. Leave
   `SENTRY_ENVIRONMENT` unset locally, or set `development`, `test` or `lab`.
3. Use `SENTRY_ORG=personal-9bo` and `SENTRY_PROJECT=heytutor` for this project.
   The organization also controls admin links. No auth token is needed to send
   events or open the links. Source-map upload is optional and uses the existing
   token workflow in [the deploy runbook](ci-cd.md).
4. Provider/deployment come from `LLM_PROVIDER` and the existing Azure/Fireworks
   configuration. Strict subjects come from `DIAGRAM_STRICT_SUBJECTS`.
   Never put student data into any of these settings. Historical backfill marks
   provider/deployment/strict configuration and release as unknown when the old
   row lacks them. Environment describes the actual emitting production runtime,
   including an owner-triggered historical backfill. `reporting_origin=backfill`
   distinguishes those events and excludes them from both alerts below.

These settings and the migration are owner deployment work. This Sentry-only
split does not change production, run a backfill, or create alerts.

## Historical rows

After the owner deploys the additive migration, use the existing protected
database environment. The default run issues `SET TRANSACTION READ ONLY` before
its reads and prints only totals and code counts:

```sh
pnpm --filter @heytutor/tutor exec tsx scripts/live/queue-historical-failed-turns.ts
```

Review that summary, then queue at most 25 rows per invocation:

```sh
pnpm --filter @heytutor/tutor exec tsx scripts/live/queue-historical-failed-turns.ts --apply
```

Repeat until `eligible` is zero. `--limit=1` through `--limit=100` changes the
bounded batch size. Active live rows remain excluded; expired live rows use the
same two-minute idle rule as the board reader. The backfill
only queues events; the server worker applies the usual delivery limit. Missing
historical stage/subject/configuration stays unknown, rather than being assigned
the new deployment's settings. Every backfilled event has
`reporting_origin=backfill`; that marker survives refresh, cancellation and
resume. Keep both alert rules restricted to `reporting_origin=live` before
starting a backfill. Never paste row data into Sentry or a public PR.

## Two alert rules

No existing runtime token was available, so no alert was created. The owner can
use the Sentry UI without creating an API token.

**New issue:** In Monitors → Alerts, create an alert for project `heytutor`,
environment `production`. Trigger when a new issue is created, applying the
filter `area:turn-failure environment:production reporting_origin:live`
(tags `area=turn-failure` and `reporting_origin=live`), and notify the owner or the selected engineering team
through an existing notification channel. Use a 60-minute notification throttle.
Each stage/code/subject fingerprint creates one issue. Link this runbook.

**Fails per hour:** Create a metric monitor for the project's error events,
filter `area:turn-failure environment:production reporting_origin:live`, measure **count of events**
across all issues, and use a rolling one-hour window. Start with a critical
threshold **greater than 10**; if a warning threshold is available, use
**greater than 5**. Attach an activity alert to that monitor and the same existing
notification destination. This is an initial operational threshold, to tune
after collecting a clean baseline. A per-issue frequency rule would miss a spike spread across subjects.
Both rules positively select `reporting_origin=live`, so backfills and unknown
origins cannot trigger either rule, even when emitted from production. A
backfill may create an issue before its first live occurrence; the new-issue
rule will then stay quiet for that issue, while the live hourly rule still counts
its live events.

On either alert, inspect stage/code/subject/provider/release first, then follow
the event link from `/admin/fails`. Expected no-figure lessons and healthy
continuations are already excluded by the shared classifier. Escalate live pipeline/deadline/solver
issues to Harness 1; teaching/saving to Harness 2; validation/physics to Harness 3;
planner completeness/optics/examples to Harness 4; chemistry figures to Chemistry.

## Verification and sources

Run `pnpm --filter @heytutor/tutor verify:sentry` and the disposable PG16 gate
`pnpm --filter @heytutor/tutor verify:sentry-db`.
It exercises the save route, duplicate save, real SDK transport with synthetic
data, privacy, grouping, rate limit, retry, absent DSN and the admin event link.
Removing the persistence queue call must fail the gate.

Official references: [SDK options](https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/),
[alert creation](https://docs.sentry.io/product/monitors-and-alerts/alerts/create-alerts/),
[metric monitors](https://docs.sentry.io/product/monitors-and-alerts/monitors/#metric-monitor-settings),
[event ID resolution](https://docs.sentry.io/api/organizations/resolve-an-event-id/),
[ingestion deduplication](https://github.com/getsentry/sentry/blob/master/src/sentry/event_manager.py).
