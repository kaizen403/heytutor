# Socrates independent WRAP and focus review, 6 October 2026

Verdicts: **WRAP 755f0dd BLOCK. Focus 9a1376ec PASS.** These are bounded
source and offline functional verdicts. No real student run or READY claim.

## Isolation, mapping and ownership

Private checkout `/Users/kaizen/heytutor-cov-wt/w1-writing-review`, branch
`cov/w1-writing-review-20261006`, starts at actual handoff
`9031aac1f4a992822c823793c93393fbd9e4d43b`. The older private branch remains
at `cfc34f69756942c6f1d437e4552aaf4ac5593e67`; its blocked circle and optics
layers were not carried into this checkout. No agents were created.

| Original candidate | Private staged commit | Verdict |
| --- | --- | --- |
| `755f0dd44b134c73408c9cef9a33ab7fc9422c3c` | `2267e8e88477dc30565f28f7840104af1bed3252` | BLOCK |
| `9a1376ecf5418cf34a2a0c7763edf066dfdc82de` | `aedd33d647811ff36fc41cfae818a0f9c4404d05` | PASS |

Both cherry-picks were exact and conflict-free. Before editing, coordination
status declared these candidate paths: `lib/turn/segmentInk.ts`,
`lib/board/boardLayout.ts`, `lib/scene/verifiedScenePresentation.ts` under
`apps/tutor/features/tutor-session`; author gates `verify-w1-wrap-order.ts`
and `verify-w1-focus-labels.ts`; their author work-logs. Reviewer writes are
`apps/tutor/scripts/verify/probes/w1-live-review/writing-review.ts` and this log,
plus owned coordination status/review/logs. No implementation fix was made.

Initial and post-probe snapshots were clean at the exact requested SHAs.
Their HEADs, statuses and SHA-256 values of all three implementation files are
identical in `source-before.json` and `source-after.json`. Private staged source
also matches those author bytes. The parent, author and main trees were not
mutated. No publication, accepted-ledger or readiness edits were performed.
At release, the parent advanced the WRAP author checkout to clean
`6d0b5314085064eeeabbe4d5e9ca32fb58b8d7c2` on
`cov/w1-wrap-guard-20261006`, changing only the guard source among the sampled
implementation paths. That new candidate is not reviewed here. Focus remains
clean at the exact original pin. `source-at-release.json` records the transition;
the reviewer source and controls remain unchanged on their staged candidate.

## Required WRAP finding

`segmentInk.ts:133` treats equal source position and narration as WRAP identity
when either position is positive **or** narration is nonempty. It permits
incomplete/default identity combinations and has no row context check.
Independent reverse-cued rows then lose their genuine spoken order.

All four controls use narration
`v equals sixty centimetres, then u equals negative twenty centimetres.`
Rows are `u = -20 cm` at `[90,274,32]`, then `v = 60 cm` at `[90,340,32]`.
The clock uses no TTS alignment and the normal estimated speech duration.

| Shared metadata on both rows | Additional row context | Baseline order | Candidate order |
| --- | --- | --- | --- |
| `charPosition=90`, `narrationBefore=""` | increasing y | v, u | u, v |
| `charPosition=90`, `narrationBefore=" "` | increasing y | v, u | u, v |
| `charPosition=0`, `narrationBefore="a shared synthetic prefix"` | increasing y | v, u | u, v |
| `charPosition=90`, same synthetic prefix | descending y 340, 274 | v, u | u, v |

The author gate covers missing both fields and zero/empty together, but misses
these combinations. Parent acknowledged the four counterexamples and owns a
separate bounded guard fix. Reviewer controls remain immutable for its follow-up.
Require stronger source identity and WRAP row context before freezing an anchor;
independent rows must keep their own cues. The reviewer did not implement this.

The actual captured matrix head/tail repair **passes**, and baseline reproduces
tail-before-head from `batch-6e26b848/protocol-and-wrap-audit.json`.
Candidate also passes canonical runtime/saved x90 for wrapped punctuation-heavy
notes and matrices across requested font sizes 18, 27, 32 and 40. The existing
parser-indent assertions remain unchanged. Missing metadata, zero/empty defaults,
distinct positions, fractional/NaN positions, different narration, normal parsed
independent rows, cancellation, resume order and entity-bound FOCUS controls pass.
Captured header y/font drift 142/27 versus saved 145/32 remains unresolved.

## Focus PASS and unchanged transport

The independent probe compiles source-grounded AB/BA, 3x4 order and transpose
matrix programs, then checks normal, reversed and rotated primitive orders.
Visible whole-entity names replace first-cell names, and focus targets carry
their engine roles. Generic compound C behaves the same way. Metadata-only names
absent from compiled ink are never advertised; an unlabeled anchor remains
unlabeled. Commands, reveals and anchors are exactly equal to baseline for every
compiled program and permutation. There is no new diagram ink or numeric value.

Actual evidence is `batch-f459df7b/ab-ba-narration-blocker.json`: cells were
spoken as array names and result arrays R1/R2 as A's rows. The candidate supplies
visible A/B/AB/BA names and result roles. It does not certify arbitrary future
LLM narration. A real AB/BA student rerender remains with the parent/runtime lane.

## Five review axes

| Axis | WRAP | Focus |
| --- | --- | --- |
| Correctness | BLOCK: four paired cue-order regressions above | PASS: 32 independent context and transport checks |
| Readability | Source-identity comment overstates the permissive guard; resolved with required finding | Small generic preference with clear scope |
| Architecture | Scheduling and work-column placement are in their owning modules; no novel fix | Uses compiled ink and engine roles; no matrix router or ownership bypass |
| Security | No new I/O, authority or diagram commands; guard finding remains required | Roles come from the verified document; no auth or external-data boundary change |
| Performance | One linear pass over segment commands | Repeated entity lookups add O(labels × entities), bounded in tested scenes; no blocker found |

## Gates and durable evidence

Independent paired gate: **63 checks, 4 failures**, comprising WRAP **27/31**
and focus **32/32**. Failure outputs, not only exit codes, are retained.
Normalized paired failure SHA-256:
`88aa97f4ad4198c743803faf9ea0e3af1fda4245242ad82944e103bd8d2b8a7e`.
The probe bundles each exact `9031aac` source module with its existing dependencies
and compares it to staged source on identical inputs. Temporary baseline bundles
are removed in `finally`; no author source was replaced.

From private `apps/tutor`, run
`pnpm exec tsx scripts/verify/probes/w1-live-review/writing-review.ts`.
The current BLOCK intentionally exits 1 with the four unchanged controls.
The two author gates pass 21 and 46 checks. Six relevant existing gates pass
unchanged: board-layout, segment-planning, segment-ink, verified-scene-presentation,
label-glossary and intro-pacing. Pacing retains 9 figures, 22 beats, 162 cued
commands and 43 labels, with first strokes within 400 ms.

Scoped ESLint of all three changed modules and the probe passes. Scoped TypeScript
passes after local Prisma generation with a disposable dummy URL and correction
of the review fixture's required `verified_scene` id. Offline frozen install
with scripts ignored and per-package drawing, scene-engine and tutor-core builds
pass. No cross-checkout dependency symlink, root build, runtime port or full
three-suite rerun was used. No new baseline-red digest claim is made from these
bounded collateral gates.

Coordination evidence is under
`/Users/kaizen/heytutor-claude-coord/reviews/w1-writing-review-logs/`:
`independent-writing.log`, `independent-summary.json`, exact
`guard-regression-inputs.json`, `immutable-probe.json`, source stability receipts,
all eight gate logs, scoped tsc/lint and local preparation logs. The review summary
is `reviews/w1-writing-review.md`; status is `status/w1-live-review.md`.

Parent may adopt **only the reviewed focus candidate**. Do not integrate this
private tip wholesale because it includes blocked WRAP. The original circle and
optics verdicts remain BLOCK and unrelated numeric patch 64587ecd is outside
this review. Slot is released after the clean user-only evidence commit; a new
clean WRAP pin can be reviewed against these immutable controls.
