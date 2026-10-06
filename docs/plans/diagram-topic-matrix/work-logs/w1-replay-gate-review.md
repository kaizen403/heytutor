# Independent replay race gate assertion review, 6 October 2026

**PASS** for the frozen test-only diff in
`apps/tutor/scripts/verify/verify-replay-work-column-origin.ts` at handoff HEAD
`9cd7da240c54f67f8ac385165afae3771953b127`.
Reviewed working-file SHA-256:
`bc9dcce8efeafc9fad6fd31836697a6f29c424bd345315ad686899c4a921a22c`.
Git showed a single unstaged working diff; the exact reviewed bytes were frozen
independently of whether the parent subsequently stages or commits them.

Canonical runtime-owned WRITE rows now all use x90. Inferring replay race
corruption from `row.x > 90` is therefore obsolete. The parent replaces this
one negative-control heuristic with an assertion that the unsettled pass has
more rows than the recorded lesson. The earlier late-write and positive-offset
negative controls remain unchanged. All fixed-pass exact-text, x90, no-late-write
and y-tolerance assertions also remain unchanged. The scenario prefix before
`main`, including all timer/barrier code, is byte-identical in old/new versions.

The reviewer ran frozen HEAD and changed scripts against the same actual handoff
production modules and real Whiteboard harness, from isolated own scratch. Only
source-location metadata was relocated to preserve original fixture/module reads.
An initial harness-location setup error was corrected in the reviewer bundler;
it was not treated as the expected old assertion failure. No target source,
production hook, timing, fixture or candidate test was edited by the reviewer.

| Run | Exit | Evidence |
| --- | --- | --- |
| Frozen HEAD test | 1 | Fails precisely at obsolete x-indent continuation assertion |
| Frozen changed test | 0 | Without settlement: 7 late restore writes, 8 extra rows, positive offsets 63/66px. With settlement: 9 exact rows, no late writes, all x90, y offsets 0 or −3px |
| Changed test with settlement disabled only in the fixed-pass invocation | 1 | Retained exact-row-text assertion fails on interleaved/extra rows |

The independent safety-removal control changes only
`const fixed = await raceScenario(true)` to `raceScenario(false)` in scratch.
It changes no assertion, timer or production source. Thus the gate remains
substantive when the safety being tested is absent. Complete offset arrays and
failure messages are retained, including the unsettled −396px paged-row offset;
the comparison is not based only on process exits.

Own reproducible probe:
`apps/tutor/scripts/verify/probes/w1-live-review/replay-gate-review.ts`.
From private `apps/tutor`, run
`pnpm exec tsx scripts/verify/probes/w1-live-review/replay-gate-review.ts` after
providing its frozen inputs under the recorded coordination log directory.
The probe completed with PASS and removes its temporary bundles in `finally`.

Evidence under
`/Users/kaizen/heytutor-claude-coord/reviews/w1-replay-gate-review-logs/`:
`frozen-review.json`, `frozen-before.ts`, `frozen-after.ts`, `before.log`,
`after.log`, `settle-disabled-control.log`, `independent-review.log` and
`verified-results.json`. Handoff HEAD, full working status and candidate hash
were identical before and after execution. Coordination report is
`reviews/w1-replay-gate-review.md`; role status is `status/w1-live-review.md`.

Only reviewer probe and evidence were written in released private
`w1-writing-review`. No handoff/main/author tree writes, source authoring, agents,
other suites, remote action or ledger/READY changes. Parent may commit exactly
the reviewed test bytes. This assertion review makes no new runtime acceptance
claim. Slot released after the clean user-only evidence commit.
