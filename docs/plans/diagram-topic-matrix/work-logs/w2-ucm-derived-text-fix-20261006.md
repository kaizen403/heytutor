# W2 UCM derived source text authority — 6 October 2026

Disposition: **verification_pending; worker source/figure boundary repair complete,
parent teaching refusal still required.** No READY, FULLY-CERTIFIED, ledger,
accepted-topic or chapter credit. Topic: `physics|2|uniform-circular-motion`.

Base: `f260ce68b3ebd96ce87d506e6a8031cef4029542`, detached new worktree
`/Users/kaizen/heytutor-cov-wt/w2-ucm-derived-text-fix-20261006`. Read AGENTS,
coverage plan, matrix index, progress, readiness and session ownership. Input:
[immutable fresh review](../../../../../../heytutor-claude-coord/reviews/w2-ucm-caller-final-20261006/REPORT.md)
at `50865ce2`. The parent's structural fix is present on the assigned base;
this worker changes neither that hook nor other workers' gates.

## Source proof and full raw retention

Allowed production changes are only
`packages/scene-engine/src/physics/uniformCircularAuthority.ts` and
`packages/scene-engine/src/physics/uniformCircularSource.ts`. New files are the
session-owned `verify-w2-ucm-derived-text.ts`, `run-w2-ucm-derived-text.mjs`, seven
JSON fixtures in `fixtures/w2-ucm-derived-text-20261006/`, and this worklog.

For the existing bounded numeric radius plus speed/period contract, every
supplied derived `sourceText` is a complete proposition obligation, independent
of the declared scalar. A pure bounded math parser retains role symbols,
operators and source operands; source-law tree proofs permit exact arithmetic
subtree folds, independently verified scalar/pi displays and terminal decimal
approximation. Same-answer arbitrary expressions, canceling role injections,
unsupported clauses, false physical remainders and wrong units decline. An
inward direction suffix binds only acceleration. No fixture ID, question-string
allowlist, smaller IR/Plan, alternate certification or new routing is used.

Original Plan conflicts run **before** scalar correction. Any conflict returns
that identical raw Plan reference with `unbound`, no correction and no
withdrawal. The registry reports `declineFigure`. Bad text is never removed or
rewritten to obtain a correct scene. Every Plan channel and every original IR
row remains. A bound scalar may still be corrected when its independently
proved text and all other obligations pass; correction changes its value only,
retaining the entire original text and metadata. Omitted optional text does not
invent a textual assertion; scalar/IR/caller guards still apply.

The parent reuses the same Plan conflicts at structural validation, caller,
central source validation, compiler, live/save admission, raw stored read,
sanitizer and restore. The new gate verifies all these seams on the **same
actual text** and full IR/Plan, including null render output and refusal of pure
canonical save. Positive canonical saves preserve the full Plan and full IR by
deep equality, not just their row IDs. Negative processing leaves the caller
and stored raw Plan/IR unchanged. This is offline pure production-graph evidence,
not authenticated HTTP, DB, voice, student render or real replay evidence.

## Cases and independent expectations

The original car, stone and clockwise capture files remain untouched. The three
report repro snapshots are copied into new fixtures in full; their old `result`
fields describe the reviewed pin's defect and are **not** new certifications.
The gate consumes the complete problem/Plan and expects refusal.

| Complete source shape | Inputs | Independently expected SI outputs |
| --- | --- | --- |
| Actual car | r=50, v=20 | a=8, T=5π |
| Actual stone, new safe text control | r=.8, T=2 | v=.8π, a=.8π² |
| Actual clockwise body | r=12, v=6 | omega=.5, a=3 |
| Independent car | r=80, v=16 | a=3.2, T=10π |
| Independent stone | r=1.2, T=3 | v=.8π, a=8π²/15 |
| Independent clockwise body | r=18, v=9 | omega=.5, a=4.5 |
| Independent equal-valued input roles | r=20, v=20 | a=20, T=2π |

These expectations come from circumference/time and v²/r, checked against the
solver's original request IDs, independently of scene values. Independent
fixtures parameterize the entire captured shape; all original channels, rows,
IDs, setup, expressions and requests remain. The equal-valued input case proves
that `r²/r` does not become acceleration authority from coincident numbers.

The **unaltered actual stone is negative**: `(2.513)^2/.8` equals `7.89396125`,
not `7.89568352087`; its speed row also asserts a truncated decimal with `=`.
The new stone positive changes only the two textual assertions to exact source
operand expansions with final `≈` displays. It does not delete rows or bless the
original expansion. The gate includes legitimate exact symbolic formulas and
safe complete prose, plus correct expansions, all report false-text repros,
zero acceleration, outward/inline tails, unrelated equations/physical claims,
wrong/equal-valued roles, wrong units, unsupported/empty/nonstring/over-budget
text, exact truncation, reused approximate intermediate, equal-answer unrelated
arithmetic, canceling roles and bad text alongside a stale bound scalar.

One initial proposed negative used `2*value/2` on the stone. Its denominator was
actually the source period and the numerator was a legitimate circumference
fold. The final unrelated-arithmetic negative uses divisor 31. The initial
failure log is preserved, not counted as a production false acceptance.

## Checks and receipts

Node 24.21.0, pnpm 10.32.0, supplied Node24 PATH. Own offline frozen dependency
install: 666 packages, zero downloads. Forced own drawing/engine/core/whiteboard
builds pass (4 tasks, zero cache); final engine/core/dependency build also passes.

| Check | Result |
| --- | --- |
| New complete derived-text gate, own source graph | **172 groups, zero failures** |
| Same gate, native own public ESM `dist/index.js` | **172 groups, zero failures** |
| Same gate, original source helpers overlaid from f260 | **172 groups, 157 failures**; demonstrates regression detection |
| Engine typecheck after own builds | Pass |
| Scoped source and new gate ESLint | Pass |
| Diff whitespace | Pass |
| Unchanged worker whole-guards on f260 helper baseline | **238 groups, zero failures** |
| Unchanged worker whole-guards after fix, source and native ESM | **RED** at unchanged unsafe actual stone positive |
| Unchanged parent full-caller on f260 helper baseline | **288 checks pass** |
| Unchanged parent full-caller after fix, source and native ESM | **RED** at unchanged unsafe actual stone positive |
| Older `verify-ucm-ready.ts` | **RED**: first source-only empty Plan/no original IR control violates parent's existing caller contract; same failure on f260 helper baseline |
| Full app typecheck | **Setup RED**: ungenerated Prisma client after offline `--ignore-scripts` install, missing Prisma exports and resulting type errors; no DB or remote engine fetch attempted |

The first engine typecheck ran before drawing build output existed and failed
on missing drawing declarations; the subsequent build and typecheck close that
setup failure. An initial new-gate runner used `.includes` on the teaching
prompt object rather than its `runtimeAddon`; that runner error was corrected.
Both initial logs remain. Existing gate assertions and unsafe fixture content
are unchanged. **Not all old gates are green.**

Durable local receipts, including failure logs and hashes:
`/Users/kaizen/heytutor-claude-coord/reviews/w2-ucm-derived-text-fix-20261006/`.
Run from the own worktree:

```sh
export PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin
node packages/scene-engine/scripts/verify/run-w2-ucm-derived-text.mjs source
node packages/scene-engine/scripts/verify/run-w2-ucm-derived-text.mjs esm
node packages/scene-engine/scripts/verify/run-w2-ucm-derived-text.mjs baseline
node packages/scene-engine/scripts/verify/run-w2-ucm-derived-text.mjs baseline ./verify-w2-ucm-whole-guards.ts
node packages/scene-engine/scripts/verify/run-w2-ucm-derived-text.mjs baseline ../../../../apps/tutor/scripts/verify/verify-w2-ucm-full-caller.ts
```

Baseline mode overlays only the two owned helpers from the immutable pin and
uses this worktree's other sources/dependencies; it neither switches the
worktree nor imports another worktree's builds. Native ESM mode imports this
worktree's freshly built public engine, including app-boundary imports.

## Required parent teaching hook — concrete proposal, not implemented here

The new gate prints seven `PARENT_TEACHING_HOOK` measurements: figure declined,
raw Plan retained, **false prose still appears if that raw Plan is passed to
`buildTurnTeachingPrompt`**. The helper/registry's present shape exposes the
retained Plan, so `declineFigure` alone does not prevent that call. This worker
does not claim end-to-end P1 closure or safe teaching. The parent owns
`ir/sourceQuantityAuthority.ts`, API, `useQuestionHandler`, prompt and persistence.

Proposed explicit discriminated authority decision (parent-owned integration):

```ts
type TurnSourceAuthorityDecision =
  | { status: "verified"; authoritativePlan: TurnPlanV3; solverAuthority: VerifiedSolverAuthority }
  | {
      status: "refused";
      authoritativePlan: null;
      solverAuthority: null;
      declineFigure: true;
      reason: "ucm_unproved_plan_obligation";
      // Original evidence retained outside all authority/prompt channels.
      rawEvidence: { question: string; originalPlan: TurnPlanV3; originalProblemIR: ProblemIR };
      conflictingQuantityIds: string[];
    };
```

Construct refusal when the UCM outcome declines (including unsupported claims),
before making any teaching request or authoritative API response. Store the full
raw originals as diagnostic evidence outside the authoritative Plan field.
For refusal, pass **no TurnPlan and no solver projection** to authoritative
teaching blocks; teach from the original question under explicit source-refusal
state, or stop the lesson with a typed refusal. Do not manufacture a smaller
Plan, report a verified solver/Plan pair, or let the rejected raw Plan reach
`AUTHORITATIVE TURN PLAN V3`. Preserve raw originals separately during text-only
save/read/reopen; the existing figure guards must continue rejecting the same
actual text. A parent integration gate must assert the false sentence is absent
from every authoritative prompt/API channel while diagnostic raw evidence stays
byte/deep-equal and no figure or false certificate survives.

Remaining scope: existing bounded single-body numeric radius+speed/period inputs.
This repair does not certify symbolic native UCM, angular/mass/force/elapsed-time
or positional source profiles, arbitrary algebra/prose, non-SI derived text,
unit-conversion derivations, bank holdouts, student render/narration, audio,
authenticated save/reopen/replay or the full corpus/suite. Unsupported supplied
text in the bounded profile declines honestly. Historical extended-profile
policies are unchanged. Parent must integrate and independently verify the
teaching refusal and affected lifecycle before accepting P1 closure.

Protected `/Users/kaizen/heytutor` was only read; never edited, stashed, switched
or reset. No agent/fork, remote, DB, environment-file copy, ledger or readiness
mutation. Commit as RishiVhavle with hooks disabled after this log is written;
the final commit/file/check receipt is recorded in the separate local report.
