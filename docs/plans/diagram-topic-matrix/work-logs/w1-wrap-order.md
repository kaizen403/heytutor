# W1 WRAP order and continuation x parity

## Assignment and source contract

- Worker: bounded w1-wrap-order author. Integration and actual runtime remain with the parent.
- Worktree: `/Users/kaizen/heytutor-cov-wt/w1-wrap-order`, branch `cov/w1-wrap-order-20261006`, base `6e26b84829e46de3da9a959a1e92110c4f5f8bc9`, 6 October 2026.
- Cross-cutting writing defect, no assigned topic acceptance or exam coverage claim. Matrices READY and AB/BA narration semantics are outside this assignment.
- Captured oracle: `/Users/kaizen/heytutor-claude-coord/runtime/w1-runtime-audit/batch-6e26b848/protocol-and-wrap-audit.json`. The associated live capture was read sparsely for this segment's question, commands, timings and console events.
- Read BRIEF, CHECKPOINT, AGENTS, coverage plan, topic index, progress, readiness, session ownership and sync architecture. Applied diagnosing-bugs and git workflow skills. Current user instructions override older commit/coauthor and publication guidance.
- Exact paths were announced in `/Users/kaizen/heytutor-claude-coord/status/w1-wrap-order.md` before edits. Four changed files: `apps/tutor/features/tutor-session/lib/turn/segmentInk.ts`, `apps/tutor/features/tutor-session/lib/board/boardLayout.ts`, `apps/tutor/scripts/verify/verify-w1-wrap-order.ts`, and this log.
- Protected main tree, scene-engine source, parser/protocol, prompts, persistence, hooks, readiness and ledgers were not edited. No agents, server, container, stash, push or PR.

## Reproduction and root cause

The actual first WRITE parses completely. Its saved pieces are:

1. `A = [[2,5,19,-7],[35,-2,2.5,12],[1.5,1,` at `[90,145,32]`.
2. `-5,17]]` at `[90,208,32]`.

Both retain source `charPosition=90` and the same original narration. The live console nevertheless reordered them by their independent speech anchors, executing the tail at x118 before the head at x90. The unmatched tail's fallback anchor is earlier than the head's matched estimate. A gate using the actual narration and the live runner's estimated duration reproduces this; substituting the finished clip duration initially hid the ordering symptom, so the final gate uses the appropriate clock in each mode.

Ranked hypotheses were independent piece anchoring, non-durable runtime indentation, then late alignment changing schedule selection. The first two are the causes. The ordering defect reproduces without alignment, and also when the capture's non-monotonic alignment arrives late. Save calls `fitWorkTextCommand` on each WRITE piece independently, resetting its x to the work margin. Runtime's special continuation indent therefore did not survive save canonicalization.

## Source change and explicit placement contract

- `segmentInk.ts` recognizes adjacent WRITE pieces only when they share a valid sourced position and matching string narration. Missing metadata, invalid positions and the synthetic zero/empty default are not group evidence. Each continuation's sort anchor is bounded below by its predecessor's anchor. Independent commands and verified FOCUS keep their own speech anchors; resume order, cancellation and estimated schedules retain their existing behavior.
- `boardLayout.ts` places all runtime-owned work rows at the canonical world work-column margin, x90, including continuations. This explicitly changes live continuation placement from x118 to x90, matching the actual canonical saved pieces and replay work-column placement. Model x values remain non-authoritative.
- Parser wrapping may still propose indentation and conservatively reserve the narrower continuation width. Those parser/typography expectations remain intact. Persisting a durable indent would require a different persistence contract; this bounded patch chooses the margin that the current save boundary already preserves.
- No existing gate or assertion was edited or relaxed. In particular, the older `verify-board-layout.ts` parser-indent assertions and drawing typography continuation-indent assertions still pass unchanged.

## Functional regressions and checks

Dedicated command:

```sh
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-wrap-order.ts
```

Result: **21 checks pass**. The source-based gate calls `planSegmentInk`, `drawSegmentInk`, `findWorkTextSlot`, command serialization/readback and the real turn save canonicalizer. It includes the exact saved pieces and captured alignment, missing/late alignment, a three-piece WRAP, independently reverse-cued rows with distinct, absent and default metadata, equal offsets with different narration, inline entity-bound FOCUS, resume order, cancellation, and continuation margin variations. The save subcase uses the shared teaching-command canonicalization path in a text-only envelope; it does not claim whole-scene admission or a DB lifecycle.

Red controls, with candidate bytes restored after each:

- Original `6e26b848` source files: **7/21 fail**, including tail-before-head and x118 versus x90. Log: `/Users/kaizen/heytutor-claude-coord/status/w1-wrap-order-red-base.log`.
- Unguarded equality grouping mutant: **2/21 fail**, independently reverse-cued rows with missing metadata and zero/empty defaults. Log: `/Users/kaizen/heytutor-claude-coord/status/w1-wrap-order-red-missing-identity.log`.
- Final guarded candidate: **21/21 pass** after restoration. No mutation or debug instrumentation remains.

Existing checks, all passed without edits:

| Command prefix | Script | Result |
| --- | --- | --- |
| `pnpm --filter @heytutor/tutor exec tsx` | `scripts/verify/verify-segment-ink.ts` | Cued figure execution and per-target replay FOCUS pass |
| same | `scripts/verify/verify-segment-planning.ts` | Glued commands and independent spoken ordering pass |
| same | `scripts/verify/verify-board-layout.ts` | Wrapping, parser indent, column width and sequential paging pass |
| same | `scripts/verify/verify-replay-ink.ts` | Ink save, rewind, restore and export pass |
| same | `scripts/verify/verify-focus-execution.ts` | Focus authority, target timing and cancellation pass |
| same | `scripts/verify/verify-board-frame.ts` | Shared board geometry passes |
| same | `scripts/verify/verify-intro-pacing.ts` | 9 figures, 22 beats, 162 cued commands and 43 labels pass |
| same | `scripts/verify/verify-turn-scene-persistence.ts` | Existing persistence regressions pass |
| `pnpm --filter @heytutor/drawing exec tsx` | `scripts/verify-board-typography.ts` | Existing wrap and continuation-indent assertions pass |
| same | `scripts/verify-write-audio-clock.ts` | Null, zero and stuck writing clocks pass |
| `pnpm --filter @heytutor/tutor-core exec tsx` | `scripts/verify/verify-live-write-sync.ts` | Audible playback and estimated schedule behavior pass |
| same | `scripts/verify/verify-sync-schedules.ts` | 12 schedule cases plus rate, late-cue and catch-up checks pass |

The live-write-sync gate was initially invoked under the app directory, where it does not exist. The table records the corrected, passing tutor-core invocation.

- `pnpm install --offline --frozen-lockfile --ignore-scripts`: passed, 666 packages, zero downloads, no cross-tree node_modules symlink.
- `pnpm --filter @heytutor/tutor exec prisma generate`: passed locally. Builds for drawing, scene-engine, tutor-core and whiteboard passed. These produced only ignored local artifacts; no root/app production build was run.
- `pnpm --filter @heytutor/tutor lint`: exit 0, 0 errors and 9 existing warnings. Baseline and candidate output are byte-identical. Logs: `status/w1-wrap-order-baseline-lint.log` and `status/w1-wrap-order-final-lint.log` in the coordination folder.
- `pnpm --filter @heytutor/tutor typecheck`: exit 2 only for baseline `scripts/_c03-select.ts(14,64)`, missing `ArchetypeMatch.family`. After local Prisma generation and package builds, exact base-source and final diagnostic digests match: SHA-256 `9c30fd8fac69e79b54990a3933a819f276c6d69856e01efb559ceacf618d6b8c`. Logs: `status/w1-wrap-order-base-tsc.log` and `status/w1-wrap-order-final-tsc.log`. Initial missing generated Prisma/whiteboard types were resolved by local generation/build, not source edits.
- `git diff --check`: passed.

## Reviewable disposition and remaining limits

Disposition: **integration_pending for the bounded WRAP order and continuation x fix**. Author slot can be released after the clean user-authored commit for independent review alongside the parent's disjoint focus patch. No topic acceptance, readiness update or runtime success is claimed.

The parent must replay the actual captured teaching response on the integrated runtime and inspect head-before-tail, tail x90, saved command readback and whole replay. The original capture also has head y/font differences, live 142/27 versus stored 145/32, due to existing placement/typography canonicalization. This patch does not fix or certify those differences, glyph-level voice synchronization, arbitrary WRAPs without reliable source identity, AB/BA narration semantics, or full matrix readiness. Existing wrapping remains conservative about continuation width after the margin change.

No server or container was needed. The integration owner retains independent review, actual runtime, physics/section integration and all ledger/readiness decisions.

## Independent-review correction

Socrates' paired baseline/candidate probe found four newly frozen independent
reverse-cued WRITE sequences: equal positive position with empty or whitespace
narration, zero position with nonempty narration, and descending row y with
shared metadata. The original755f0dd is therefore BLOCK and must not land.
Parent took the released clean tree on cov/w1-wrap-guard-20261006 and requires
a positive finite integer source position, identical nonempty narration, and
an increasing continuation row y before treating adjacent WRITEs as pieces of
one authored command. The actual matrix's position90/head145/tail208 remains
a proven continuation. Synthetic zero/default producers remain independent;
this guard does not claim to infer authored groups from missing identities.

Four new regression cases retain genuine v-before-u spoken ordering at those
boundaries, with the previous captured-wrap, inline FOCUS, cancellation, save,
estimated scheduling and replay controls retained. Own gate now25 PASS;
existing segment-ink and segment-planning gates PASS; scoped ESLint/diff PASS.
Existing board-layout indent assertions stay unchanged. Header y/font requested
coordinates are layout inputs, and actual live/replay placement remains to be
checked on the landed head. No reviewer assertions or baseline evidence were
modified. Independent follow-up on this clean correction remains required.

## Integration and collateral replay gate

Socrates independently approved the corrected combined chain: immutable63/63
and author25/25; all four independent-row regressions now match the baseline.
Evidence112bb145. Parent landed only755f0dd plus6d0b5314 together, with reviewed
focus9a1376ec, on actual handoff9cd7da24. Focus46, WRAP25 and existing verified
presentation checks PASS there. Real student rerender remains pending.

The existing replay race gate then failed its obsolete negative-control x>90
heuristic, since all WRITE rows now share canonical x90. Its independent race
still reproduces seven late restore writes and offsets up to66px. The test
now asserts extra interleaved restore rows directly; every earlier lateness/
offset red assertion and every fixed exact-text/x/y/no-late-write assertion
is unchanged. No scenario, timing, barrier or production code changed.

Socrates' separate frozen-byte review PASS pins test SHA256
bc9dcce8efeafc9fad6fd31836697a6f29c424bd345315ad686899c4a921a22c.
Original test exits1 at the indent heuristic; corrected test exits0; disabling
settle only in the fixed test pass still exits1 at exact row equality. Parent
run also passes, with eight extra rows without settle, zero late rows with
settle and all nine fixed rows at x90 within existing y tolerance. Scoped lint
and diff check pass. This adjusts an obsolete observation of the same race;
it does not suppress a failure or relax the required replay behaviour.
