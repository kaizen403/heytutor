# H3 R11 regions solver contracts — 12 October 2026

Owner: region solver worker. Base: `34857285`, private branch
`h3r11/region-solver-contracts`. Scope: free/offline source-contract replay,
`ir/solverAuthority.ts`, and new dedicated gates/fixtures. No API/model/HTTP,
images, paid measurement, push, PR, or delegation. No accepted topic rows or
coverage counters change. These are capture/contract counts, not topic counts.

## Feedback loop and diagnosis

The first runnable loop was
`pnpm --filter @heytutor/scene-engine exec tsx ../../.context/solver-evidence/replay.mts`
from the private workspace. It recomputed the three current captured original
ProblemIR objects and audited their complete original TurnPlans. All evidence
truncation counters were zero. All provider results matched the retained
original solver results exactly. It exited 1:

- `sys02-unique-rational`: `value_type_mismatch` for `ux`.
- `sys10-opposite-slopes-rational`: `value_type_mismatch` for `xp`.
- `separated-boolean-union`: two `value_type_mismatch` issues and
  `unbound_unknown` for symbolic `S`.

The portable red commands were then run against the same frozen tree:

```sh
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-region-solver-recorded.ts
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-region-solver-admission.mts
```

Both reached the real audit and failed on `sys02`: expected `verified`, got
`contradiction`. The tutor gate calls the same pure `selectProductionScene`
module and `audit.status === "contradiction"` guard used by the live hook; it
does not request a planner or model.

Ranked, falsifiable hypotheses were declared before fix probes:

1. Source-role matching misses complete coordinate/boundary requests. Equivalent
   direct coordinate wording should remove a rejection if wording alone is the
   cause. Rewording the reduced `sys10` request alone did not remove it: complete
   paired-coordinate proof is also required.
2. An unavailable scalar comparison is confused with a numeric contradiction.
   Removing the binding produces `incomplete`. A global downgrade was rejected
   by the coordinator because unsupported nonlinear/multiple-root scalar claims
   could cross the live boundary. Contradiction codes remain unchanged.
3. The unknown `S` is a symbolic set rather than a numeric answer. Once its two
   boundaries have independent proofs, it should remain unbound/incomplete
   without any finite derived scalar for `S`. Numeric whole-set claims need a
   separate refusal, including a genuine boundary number under the wrong role.

The reduced `sys10` request retained the original whole-source text, requested
quote, affine expressions, quantity id/symbol/value, and provider set. Removing
the companion y request, entities, constraints, and unrelated claims retained
the type rejection. This is a refusal-class minimization, not evidence that a
single tuple request is safe. The final positive requires the original complete
pair; deleting its companion must still refuse scalar certification.

## Narrow repair and source evidence

Role-worker dependency: `724e1b70aa96fcc7438a86ccb59118f281c97530`,
cherry-picked as `08e48dd1` solely for private validation. Its native named-set
follow-up `01e163df65053fb224870e33d93fd7290b063360` was cherry-picked as
`b6701523`. Both dependencies are required for the final green production gate.
That worker owns `ir/linearScalarBinding.ts`, `compile/linearSourceAgreement.ts`, and
`compile/linearRegionSource.ts`. The solver worker did not edit those files.

Initial guard commit: `237289d3`; the atomic follow-up in this log adds explicit
finite-role refusals and machine-relative boundary comparisons. Final guard
source SHA-256: `44cf78d23a21df3feb44f4aeb2081c5a49fb253bc93ea93ae7545f93182e296c`. Only source-boundary projections are conditional on
complete finite requested claims. Each finite derived unknown requires exactly
one matching symbol/unit binding and its own independent
`unique_source_linear_boundary` certificate. An unbound symbolic set has no
finite derived value and is exempt. An unrelated evaluate result or a genuine
boundary root named `S` cannot certify the source's whole solution set. If the
contract is incomplete, boundary values remain sets; existing type-mismatch
contradictions block admission. The follow-up also emits explicit
`unproved_source_boundary_scalar` refusal: boundary quantities may be
intermediates, so their restored arrays alone are not an admission guard. Coordinate/native-source routes and provider
semantics remain unchanged. Exact boundary comparisons use 64 machine-epsilon relative rounding, with
no absolute floor or planner uncertainty; genuine boundary scalar reconciliation remains available.

The original-source contracts are retained in
`packages/scene-engine/scripts/verify/fixtures/region-solver-recorded.json`.
These include the exact original question, facts/quotes/offsets, ProblemIR,
TurnPlan, solver values and proofs, plus SHA-256 provenance from the frozen R10
captures. Nothing is reconstructed for these five current contracts. Two
controls preserve the genuine planner errors `sys01 y=-1` versus source `1`
and `sys07 y_P=-33` versus source `7`; the native source guard must continue to
refuse both at production selection.

## Guard red/green at production admission

The independent local command
`pnpm --filter @heytutor/tutor exec tsx ../../.context/solver-evidence/guard-red.mts before`
used an existing valid source-boundary contract, not a reconstructed original
model response. Before the guard it exited 1: symbolic `S` admitted, finite
unbound `S=99` admitted with `incomplete`, and irrelevant explicit evaluate
`S=99` admitted with `verified`. Repeating with `after` exited 0: symbolic `S`
remained admitted, while both finite controls became contradictions and
`representation=null`. The `strengthened` run also refused `S=-1` attached to
a genuine exact left-boundary roots request, preserving the requested named-set
role independently of its coincident numerical boundary value.

Fresh review found two further real red classes after the first guard. With
original boundary quantities removed from `unknowns` but retained as derived
intermediates, finite `S=99` and `S=-1` remained incomplete and were admitted.
The live gate was run red before the follow-up repair. An explicit scoped
source-boundary role contradiction now refuses these claims independently of
whether the requested boundary quantities remain in the unknown loop. A
matching irrelevant scalar evaluate request cannot evade it either.

The precision red case changed only the original exact left boundary `-1` to
`-0.9999999995` and removed its arithmetic source text. The old absolute
`1e-9` tolerance admitted it. Certified-boundary comparisons now allow only
machine-relative rounding. Actual-selector class controls preserve exact zero
and `1e-8`, refuse zero/nonzero substitution and small shifts, and retain a
one-ULP rounding positive. Other scalar tolerances are unchanged.

Review also disguised finite `S=99` as a given or derived intermediate, removed
its requested unknown, and retained genuine boundary certificates. The valid
plan was admitted; this source-role problem belongs to the role worker's
independent native named-set guard. That guard must refuse the original source's
whole set alias at every finite provenance without demanding boundary
certificates for source coefficients. Both `S=99` and the genuine boundary
number `S=-1` are durable actual-selector negatives for these provenance forms.
The native guard dependency `01e163df` and both own gates now pass these
provenance controls at the actual selector.

The durable recorded and admission gates include these controls, complete-pair
deletion, wrong companion evaluation, forged singleton results, stale scalar
values, exact-boundary uncertainty, and safe boundary reconciliation. Existing
tuple-only, nonlinear, multiple-root and source-mutation gates are retained.

## Frozen capture differential

Initial R10 stock/branch1 cohort: 60 files, 59 full original metadata contracts,
one missing ProblemIR/TurnPlan (`hp02-negative-y-strict`) because its solver
entry is null. The missing
record is not replayed or counted as an accepted contract.

| Measure | Frozen base | After role dependency + guard |
| --- | ---: | ---: |
| Provider results equal original | 59/59 | 59/59 |
| Solver verified | 28 | 30 |
| Solver not applicable | 17 | 17 |
| Solver incomplete | 11 | 12 |
| Solver contradiction | 3 | 0 |
| Native source plan accepted | 49/59 | 56/59 |
| Native source plan refused | 10/59 | 3/59 |
| Independently compiled source figures | 56/59 | 56/59 |
| Previously verified contracts lost | 0 | 0 |

Actual source-representation admission was replayed in **separate processes**
with explicit root/private tutor tsconfigs. A first combined-process attempt
was discarded after detecting that TSX path aliases selected the private
engine for both selector imports. The true frozen `34857285` baseline admitted
43/59 original contracts, with 16 retry-required. The final private replay admitted 53/59, with six retry-required: ten newly
admitted contracts and zero lost admissions. All ten changed rows are the new
admissions; this is source fallback admission, without planner candidates,
model calls, narration or persistence, and is not a paid/live-rate result.
Per-row capture SHA-256 and changed/new/lost outcomes are retained in the local
`production-isolated-differential-final.json` artifact (SHA-256
`37a870e9436de0b32ce07b4c84b5d10e35699a8848c6ad0d28e55453bb701a00`).
New admissions: lpp01/02/03/04, sys02/05/10, multiple-optimum-edge,
separated-boolean-union, and vertical-line-system. Original sys01/sys07 remain
refused. This final replay was rerun after the explicit-role, precision, and
whole-set provenance fixes; all 59 provider results still match originals.

The initial native refusals include both genuine wrong-y controls. Native plan
agreement and diagram compilation are distinct from solver status; neither is
a topic acceptance or a fresh live measurement.

## Older captures already repaired on the frozen base

- Original unsafe `hp06`, `hp07`, `hp10`, and `nl09` programs are all atomically
  rejected; independently compiled whole-source recoveries pass 4/4 on
  `34857285`. No repair was added here.
- Original full ProblemIR is absent for older `sys06` and `sys07`. The retained
  captured summaries and exact source were explicitly reconstructed into
  minimal affine-intersection class formulations. Old `054cdbad` audits were
  contradictions; frozen-base audits are verified 2/2 with identical provider
  results. This is a labelled class differential, not original-IR replay.
- Original `sys04` generic function-curve program compiles before and after.
  Its actual diagram defect is detached axes registration, not an unsafe
  partial program. Independent screen coordinates computed from the rendered
  axis endpoints and source `(2x+6)/3` give maximum error 306.6556 pixels on
  `054cdbad`, versus 0.008125 pixels across all 65 samples on `34857285`.
  Separate setup/result reveals remain. No compiler edit was needed.

Local diagnostic JSON/scripts are under
`.context/h3r11/region-repairs/wt-solver/.context/solver-evidence/`; original
inputs remain under the root R7/R10 capture directories. These local artifacts
are intentionally ignored rather than committed. The portable gates and
source-contract fixture are the durable regression evidence.

## Checks and limitations

Private dependencies were installed with
`pnpm install --offline --frozen-lockfile --ignore-scripts`: zero downloads.
Private drawing, scene-engine and tutor-core packages were built before app
checks. Baseline/preservation commands passed: `verify-linear-solver-binding`
(64), `verify-linear-numeric-authority` (293), `verify-linear-composite-contract`
(189), `verify-cartesian-reveal-frame` (343), `verify-problem-ir`, scene-engine
typecheck, build and lint. Lint has four existing DSA warnings; DSA was not
edited or worked on. After the role dependency and guard, the complete `verify:linear` suite also
passed (361 math, 4,015 public compiler, 95 equivalence, 41 source-point, 189
composite, 64 solver, 343 frame, 72 completion, 264 plan, 693 source-recording,
293 numeric-authority checks). New recorded-metadata gate: 124 passed. New
actual production-selector gate: 53 passed through the production selector. Direct ESLint checks on both new
gates, scene-engine typecheck/build/lint, and `git diff --check` passed.

No narration, voice, browser, persisted lecture, or end-to-end model run was
performed. No claim is made about paid/live rates, whole-syllabus coverage, or
topic readiness. The guard deliberately declines mixed finite scalar roles
without their own source-boundary certificate, and does not change generic
scalar authority outside boundary projection. Original source-completeness,
strictness, shading, corner, equivalence and atomic partial-scene checks remain.
