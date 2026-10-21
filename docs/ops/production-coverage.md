# Saved lesson figure coverage

Staff can open `/admin/coverage`, beside Fails, for aggregate coverage over a
chosen UTC date window. This reads saved turns, not lab samples or live traces.
It does not call a model, voice provider, Langfuse, or another service.

## Daily report

The page and CLI use the same `loadProductionCoverage` snapshot and reducer.
Supply `DATABASE_URL` through an approved local environment; never paste a URL
or credentials into a report. The CLI does not load an environment file itself.

```bash
pnpm --filter @heytutor/tutor exec tsx scripts/live/production-coverage.ts \
  --from 2026-10-14 --to 2026-10-21
```

Output is JSON containing `window`, `totals`, `subjects`, `chapters`, and
`emptyReasons`. There are no lesson IDs or source excerpts. With no dates, the
window includes the last seven UTC calendar dates, including today. `from` is
inclusive at 00:00 UTC; `to` is exclusive. Both dates are required when either
is supplied, and the maximum span is 366 days.

`GET /api/admin/coverage?from=2026-10-14&to=2026-10-21` returns the same report.
The API and panel inherit the existing staff/admin authorization boundary.
Responses are private and not cached. Invalid windows return 400; query failures
return a generic 500 without exception or row details.

## What the counts mean

Only saved `lesson` turns with status `complete` or `stopped` are included,
selected by their creation time. Live checkpoints, doubt/resume turns and
recorded board continuations are excluded. There is no sampling or row limit.

| Counter | Saved evidence |
| --- | --- |
| `needed` | `turnPlan.visualRequirement` is `required`. This is recorded planner need, not an independent assessment of whether a figure was necessary. |
| `drawn` | Validated visual status and at least one persisted trusted, non-trace structural diagram mark. Labels, work-area writes and planned-but-unsaved figures do not qualify. |
| `neededDrawn` | Required lessons satisfying the drawn definition. |
| `neededEmpty` | Required lessons with a known visual outcome but no saved qualifying figure ink. |
| `neededUnknown` | Required lessons whose visual outcome is unrecorded or unsupported. |
| `empty` | All confirmed empty lessons, including optional and intentionally text-only lessons. |
| `unrecordedNeed` | Missing or unsupported visual requirement; not assumed to require a figure. |
| `unrecordedOutcome` | Missing or unsupported visual outcome; not assumed empty. |

The reconciliations are `needed = neededDrawn + neededEmpty + neededUnknown`
and `savedLessons = drawn + empty + unrecordedOutcome`. All drawn figures are
not necessarily required figures. Saved figure ink is replayable evidence, not
proof that the student watched every mark in the original session. Persistence
can reconstruct a verified scene intro; this report is not view-completion
telemetry or a figure-correctness score.

Subject uses the saved closed `failureTelemetry.subject` enum. Historical
missing subjects are `unknown`; they are never inferred from student words.
**Current saved turns have no chapter binding.** Their chapter is explicitly
`Unrecorded`. No topic, chapter, family or law is guessed from question text.
The reducer can accept explicit checked-in taxonomy chapter IDs when a future
save path supplies them; the current query intentionally supplies no chapter.
Do not present the historical chapter table as chapter-level attribution.

## Empty diagnostics and privacy

Each distinct empty diagnostic tuple has a lesson count, subject, chapter,
recorded requirement, completion status, saved-ink evidence, degradation reason,
failure code, issue codes, unknown issue count, effective diagram strategy and
fallback-suppression evidence. The tuples sum to `empty`; no individual lesson
or student links are exposed.

Only existing content-free failure and issue-code catalogues are allowed out.
Unknown code strings are counted, not displayed. Missing reasons or strategy
remain `unrecorded`; the report does not invent an explanation absent from the
saved evidence. `fallbackSuppressed: yes` means positive stored suppression
evidence. `unrecorded` does **not** mean suppression did not occur: an earlier
degradation can mask a later fallback decision.

The SQL selects scalar enum/code paths and a trusted-ink existence check, never
questions, narration, names, emails, board titles, raw responses, full artifacts,
geometry, audio, or trace links. Untrusted strings are collapsed to known enums
or counts before serialization. Errors log a constant code only. Both readers
start a repeatable-read transaction, set `READ ONLY`, check that PostgreSQL
reports it as `on`, and fail closed otherwise. A 15-second statement timeout and
30-second transaction timeout bound each request. There is no write option.

## Synthetic verification

```bash
pnpm --filter @heytutor/tutor verify:production-coverage
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-admin-routes.ts
```

The first chain covers aggregation/conservation, unknown metadata, private
canaries, date boundaries, the real route with mocked auth/database boundaries,
read-only enforcement, sanitized errors, CLI arguments and rendered UI states.
The second keeps the page/API/nav in the existing admin boundary gate.

An optional real PostgreSQL gate creates synthetic temporary tables only. It
refuses any host other than localhost/127.0.0.1 or database other than
`coverage_test`; never point it at production:

```bash
# First provide COVERAGE_TEST_DATABASE_URL for a disposable local coverage_test DB.
pnpm --filter @heytutor/tutor verify:production-coverage-db
```

It checks the real SQL, inclusive/exclusive dates, complete/stopped lessons,
continuation/doubt/resume/live exclusion, trusted versus untrusted/trace-only
ink, unknowns, diagnostic conservation, suppression and source-text redaction.
No schema migration or new provider configuration is required.
