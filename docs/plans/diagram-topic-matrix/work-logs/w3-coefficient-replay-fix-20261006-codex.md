# W3 saved coefficient reveal parity / 6 October 2026

Disposition: **integration_pending**. Offline regression and implementation
checks pass. The actual missing-audio replay requires the small parent-owned
hook proposal below; its fresh student lifecycle has not been rerun here.
Full-scope **READY: 1; FULLY-CERTIFIED: 0**, unchanged. No ledger, counter,
remote, authentication harness, timeout, persistence, engine or core edits.

## Ownership and inputs

- Worker: Codex; integration/runtime owner: parent coordinator.
- Isolated root: `/Users/kaizen/heytutor-cov-wt/w3-coefficient-replay-fix-20261006`.
- Base: `e67bfa1af95da7377651f4cc77ab5400d2bb988e`.
- Branch: `fix/w3-coefficient-replay-20261006`.
- Read root AGENTS/coverage plan, matrix index/progress/readiness/session
  ownership, sync architecture including finished player/seek rules, prior
  replay gate review, original saved document/IR/Plan/reveal groups/commands,
  normal live/reopen logs and parent receipts.
- Runtime input:
  `/Users/kaizen/heytutor-claude-coord/runtime/runs/2026-10-06T0846-w2-f0d74113`,
  parent application at `50865ce221042e254e3ac5972d6c80496b54d08d`.
- The saved-turn fixture retains the complete scene document, full caller
  ProblemIR/Plan/solver/artifacts, commands and real timings. Only turn identity,
  trace identity and creation time are omitted/replaced. Original live JSON
  SHA-256: `1e58633b3f04cba9c57ba84fd641b05470ae187a587c9466a6544e80a0b78d12`.

Both required screenshots were visually inspected. Live final shows rows
`0/64`, `1/192`, `2/[240]`; replay final shows only `2/[240]`. Live screenshot
SHA-256: `fa12b9fd11a0efe8301df60679e9b909182e68f6c76fb20b38fa77b7cfd605aa`;
replay screenshot: `1563dce8f1f6a4bfa8e809edba57e3992981fdc86286e3056006663209e56a66`.
These are the original PNGs under that run's `evidence/`, not new render captures.

The parent's six live criteria passed. Save HTTP200, own Postgres restart,
fresh Auth.js GET200, earliest whole replay to idle within the unchanged 120s
limit and exact persisted authority/commands are inherited receipts. Generic
`ok: true`, 0 live/replay draw shapes and 10 WRITE/2 FOCUS checks missed the
label-only omission. The parent's semantic replay FAIL remains open.

## Root cause and implementation

The restored presentation defers all ten coefficient-scene LABEL commands.
FOCUS `poly` releases the four source/header/answer labels; FOCUS
`poly_power_2` releases `2` and `[240]`. The remaining labels are exactly
`0`, `64`, `1`, `192`. Live `useTurnControl.processResponseText` waits for
narration/drawing queues then calls `remainingDeferredAnnotations`. Its normal
runtime log shows these four labels at 53833–54149ms, before turn completion
at 54157ms. That flush is outside saved teaching segments. Both replay paths
lack equivalent completion; the data is complete but reveal state is not.

- `features/tutor-session/lib/replay/completeReplayDiagram.ts`: shared turn-end
  flush, using only the current restored VerifiedDiagram and existing public
  drawing protocol. Runs after the final cue's ink and speech. Consumes only
  remaining deferred commands, preserves live order/styles/semantic references,
  checks cancellation between marks and is idempotent. Same-page doubts do
  not release the stopped lesson's future marks. Frame-managed code layouts
  retain their existing behaviour; no DSA work is claimed.
- `features/tutor-session/hooks/useLecturePlayer.ts`: recorded player uses the
  completion wrapper; seek catch-up completes prior turns at their boundary.
  FOCUS catch-up executes at durationScale0, retaining permanent labels while
  skipping transient gestures. The original cue clocks, indices, narration,
  source admission and end-overrun limit are preserved.
- New gate: `scripts/verify/verify-w3-saved-reveal-parity.ts`.
- New saved fixture and parent hook proposal under `scripts/verify/fixtures/`.

There is no coefficient/table selector, query router, initial reveal-all,
authority waiver or synthesized diagram command. Unmentioned marks appear
at live-equivalent completion, never at replay startup or a partial seek.

## Independent checks

The coefficient oracle is `C(6,0)*2^6=64`, `C(6,1)*2^5=192`,
`C(6,2)*2^4=240`. The gate restores through the real authority/compiler path,
uses the real command executor with a minimal asynchronous paint adapter,
and checks exact label text/coordinates against live completion.

- Baseline replay reproduces exactly the four missing marks, with `[240]`
  already visible. Completion produces the full live-equivalent result.
- Original narration/cue indices and FOCUS position remain ordered; absent
  rows wait until the final cue ends. Separate restored turns complete
  independently before the following turn's first cue.
- The actual fallback `useReplay.renderBoardAtTime` is loaded unchanged and
  then with the proposed patch applied **in memory**. End seek reproduces
  the omission before and matches complete marks after. Partial seek keeps
  future rows hidden and retains earlier FOCUS labels.
- Ordinary geometry: independently constructed A/B points and their joining
  segment compile normally; a staged B mark remains hidden until completion.
- Idempotence, same-page doubt, partial turn, null diagram, cancelled replay,
  cancellation between marks and mismatched source rejection controls pass.
- A scratch negative control disables completion only in the positive run.
  It exits 1 at the exact missing-row assertion. No assertion, authority
  function, original fixture or production source is weakened.

Commands from the private root (Node `v24.21.0`, pnpm `10.32.0`, supplied PATH):

| Check | Result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | PASS; no downloads |
| `pnpm exec turbo run build --filter='@heytutor/tutor^...' --force` | PASS; 5 own package builds, 0 cache hits |
| `pnpm --filter @heytutor/tutor exec prisma generate` | PASS; own generated client, no database connection |
| `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w3-saved-reveal-parity.ts` | PASS |
| completion-disabled scratch gate | Expected FAIL, exit1; substantive parity assertion |
| existing `verify-lecture-player.ts`, `verify-replay.ts`, `verify-dimension-reveal.ts`, `verify-replay-ink.ts` | PASS, unchanged gates |
| tutor `pnpm exec tsc --noEmit` | PASS |
| tutor ESLint on changed hook/helper/new gate | PASS |
| tutor `NEXT_TELEMETRY_DISABLED=1 pnpm build` | PASS; optimized compile, type validation, page generation |
| `git apply --check apps/tutor/scripts/verify/fixtures/w3-coefficient-replay-parent-hook-20261006.patch` | PASS; check only |
| `git diff --check` | PASS |

Initial local check setup exposed missing generated Prisma types; own
`prisma generate` resolved them. Initial gate setup errors (CJS top-level
await, literal `[240]` spelling, command ink snapshot mutation and geometry
deferral setup) were corrected before the successful runs. These setup
failures are not counted as the defect reproduction or negative control.
Check output logs are `/tmp/w3-coefficient-replay-{install,packages-force,
focused,negative,typecheck,lint,tutor-build}-20261006.log`.

## Parent integration and remaining work

The original turn's stored audio URLs are all null. `TutorSessionShell` therefore
selects the in-place `useReplay` fallback, not the recorded player. This hook
is outside this worker's allowed files. The proposal is concrete and tested:

```sh
git apply apps/tutor/scripts/verify/fixtures/w3-coefficient-replay-parent-hook-20261006.patch
```

It imports the shared helper and awaits it after a fully drawn/spoken turn's
last replay cue, before idle. It also uses the helper for completed turns
during instant seek reconstruction. It adds the corresponding dependencies;
it does not edit `turn/useQuestionHandler.ts` or change persistence.
The gate applies this proposal only in memory; the production hook is untouched.
The integration owner must apply/review it in the parent tree.

After integration, parent owns fresh real student save/voice, own DB restart,
fresh Auth.js reopen and earliest whole replay under120s. Inspect new final PNGs
for all three rows and ordinary geometry, not merely generic harness success.
Offline paint accounting is not a new student render or runtime acceptance.

| Topic | Supported result | Proposed state | Remaining |
| --- | --- | --- | --- |
| `maths\|5\|binomial-theorem` actual `(2+x)^6` coefficient turn | Original exact nonmetric scene restored; offline whole-turn reveal parity repaired | integration_pending | parent fallback hook + affected fresh lifecycle, topic variants/native/holdout obligations |

No acceptance disposition is filled on the integration owner's behalf.
Publication is the requested user-authored local commit only; no push/PR/merge.
