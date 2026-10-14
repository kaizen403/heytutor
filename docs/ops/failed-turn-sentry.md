# Failed-turn Sentry events

The saved turn is the reporting boundary: a terminal `text_only`,
`retry_required`, legacy or null visual status queues one content-free event.
A failed teaching checkpoint also queues an error even if its diagram verified.
Live checkpoints wait for a terminal outcome; an idle tab is recovered after
the existing two-minute stopped-turn threshold without changing lesson status.
The existing admin fails filter
includes nonvisual lessons and continuations; these keep distinct codes so
their counts can be separated from actual missing diagrams.

## Delivery and privacy

The event uses fingerprint `turn-failure / stage / code / subject`, with tags
`area=turn-failure`, `subject`, `stage`, `code`, `figure_need`, `strict_subjects`,
`provider`, `deployment`, `release` and `environment`. Taught lessons use warning;
failed teaching or a lesson with no narrated segments uses error. Extras contain
only bounded counts and approved issue codes.

The turn transaction reserves a random event ID and clean event payload in the
same commit. Repeated saves and checkpoints reuse the reservation. Stopped
outcomes wait two minutes so late checkpoints can finish. Pending events refresh
their severity and counts while preserving ID and timestamp; a verified recovery
cancels the pending payload. A recovery after an event is accepted cannot retract it.

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
Reported queue payloads are cleared. Pending rows follow turn deletion and
retention. Workers do not extend the turn's activity timestamp.

The admin row shows the event ID and a **View in Sentry** link. A queued event
becomes searchable after delivery. Historical rows need the explicit backfill
below; this PR does not perform it or change production.

## Owner settings

The read-only audit on 2026-10-14 found runtime variable names `SENTRY_DSN`,
`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG` and `SENTRY_PROJECT` present. No Sentry
parameter names were returned by SSM `DescribeParameters`. Values were neither
printed nor validated, so this confirms configuration names, not ingestion.
`SENTRY_RELEASE` and `SENTRY_AUTH_TOKEN` names were absent from the running process.

Before the owner deploys an approved commit:

1. Keep the existing `SENTRY_DSN` for server events and
   `NEXT_PUBLIC_SENTRY_DSN` for browser events. If either is actually empty,
   obtain the DSN from project `personal-9bo/heytutor` settings. The browser
   setting must exist before the build. No new DSN is indicated by this audit.
2. Set **`SENTRY_RELEASE` to the exact deployed 40-character git SHA** in the
   server's `.env.production`. Update it for each deployment. Ensure
   `NODE_ENV=production`; leave `SENTRY_ENABLED` unset or enabled.
3. Use `SENTRY_ORG=personal-9bo` and `SENTRY_PROJECT=heytutor` for this project.
   The organization also controls admin links. No auth token is needed to send
   events or open the links. Source-map upload is optional and uses the existing
   token workflow in [the deploy runbook](ci-cd.md).
4. Provider/deployment come from `LLM_PROVIDER` and the existing Azure/Fireworks
   configuration. Strict subjects come from `DIAGRAM_STRICT_SUBJECTS`.
   Never put student data into any of these settings. Historical backfill marks
   these values, release and environment as unknown when the old row lacks them.

These settings and the migration are owner deployment work. No environment edit,
restart, migration, Sentry event or alert was sent to production during this task.

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
the new deployment's settings. Never paste row data into Sentry or a public PR.

## Two alert rules

No existing runtime token was available, so no alert was created. The owner can
use the Sentry UI without creating an API token.

**New issue:** In Monitors → Alerts, create an alert for project `heytutor`,
environment `production`. Trigger when a new issue is created, filter tag
`area` to `turn-failure`, and notify the owner or the selected engineering team
through an existing notification channel. Use a 60-minute notification throttle.
Each stage/code/subject fingerprint creates one issue. Link this runbook.

**Fails per hour:** Create a metric monitor for the project's error events,
filter `area:turn-failure environment:production`, measure **count of events**
across all issues, and use a rolling one-hour window. Start with a critical
threshold **greater than 10**; if a warning threshold is available, use
**greater than 5**. Attach an activity alert to that monitor and the same existing
notification destination. This is an initial operational threshold, to tune
after collecting a clean baseline; historical counts include expected nonvisual
lessons. A per-issue frequency rule would miss a spike spread across subjects.
Historical events tagged environment unknown do not enter this production alert.

On either alert, inspect stage/code/subject/provider/release first, then follow
the event link from `/admin/fails`. Separate `not_needed` and continuation events
before estimating actual diagram failures. Escalate live pipeline/deadline/solver
issues to Harness 1; teaching/saving to Harness 2; validation/physics to Harness 3;
planner completeness/optics/examples to Harness 4; chemistry figures to Chemistry.

## Verification and sources

Run `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-sentry.ts`.
It exercises the save route, duplicate save, real SDK transport with synthetic
data, privacy, grouping, rate limit, retry, absent DSN and the admin event link.
Removing the persistence queue call must fail the gate.

Official references: [SDK options](https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/),
[alert creation](https://docs.sentry.io/product/monitors-and-alerts/alerts/create-alerts/),
[metric monitors](https://docs.sentry.io/product/monitors-and-alerts/monitors/#metric-monitor-settings),
[event ID resolution](https://docs.sentry.io/api/organizations/resolve-an-event-id/),
[ingestion deduplication](https://github.com/getsentry/sentry/blob/master/src/sentry/event_manager.py).
