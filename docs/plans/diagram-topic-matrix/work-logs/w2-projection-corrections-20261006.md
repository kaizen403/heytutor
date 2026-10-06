# W2 point-line N1/N2 correction — 6 October 2026

Implementation commit: `78d624916788719100af9bf64cd1be38e446957a`.
Baseline: `5a3a9bbbf2b081505187fc23562d89df1135a2e5` (clean at assignment).
Owned tree: `/Users/kaizen/heytutor-cov-wt/w2-projection-corrections-20261006`.
Worker: this bounded point-line correction session; integration owner: parent.
Topic: `maths|10|point-to-line-distance`, Coordinate Geometry maths/10,
JEE Main/Advanced 2026, authored bounded source cohort, not a bank audit.
Disposition: **integration_pending; no READY, FULLY-CERTIFIED or accepted-count change**.

Read AGENTS, coverage plan and packet contract, matrix index/progress/readiness,
continuation and session ownership. Exact review:
`/Users/kaizen/heytutor-claude-coord/reviews/w2-corrections-arithmetic-review-20261006.md`.
The review's N1/N2 observations at the baseline establish the initial defects;
N3 arithmetic remains parent-owned and was not changed. The owned verify path
was announced before its first edit. The user separately added the distance
quantity/annotation requirement during this assignment.

## Changes and numeric boundary

Only these implementation/gate paths changed:

- `packages/scene-engine/src/math/exactBinary64.ts`: extracted exact dyadic
  decoding from the existing source proportionality proof; exact product/sum
  residual followed by one ties-to-even binary64 rounding. Exact nonzero
  residuals that underflow on conversion throw rather than return zero.
- `src/ir/pointLineSource.ts`: reuse exact product equality; use the common
  certified projection for foot/caption checks; preserve lowercase foot
  identity in compact/explicit coordinate captions. Given-point admission
  retains its previous uppercase grammar.
- `src/compile/analyticLineGeometry.ts`: source program and generic
  `point_line_distance` share an exact incidence decision. A nonzero distance
  at or below the existing 1e-6 world-unit geometry threshold declines; a
  drawable distance whose encoded foot fails incidence, length or normal
  direction within 1e-8 of that distance also declines. True exact incidence
  retains distance zero. Rescaled display lengths cannot rescue a nonzero
  distance below supported precision.
- The analytic producer validation hook checks each referencing generic
  `project`, even without a distance operator or source program. It compares
  the inherited endpoint-based compiler calculation to the certified foot;
  cancellations and collapsed/unrepresentable feet reject atomically.
  `project_point_to_line` is not an operator/alias in this baseline. The actual
  inherited operator is `project`; `compiler.ts` and dispatch are untouched.
- `src/ir/pointLineProgram.ts`: capture the requested foot name from the same
  successful whole-request grammar match. Keywords ignore case; identifiers
  preserve case, with one/two ASCII letters, optional digit and apostrophe.
  Case-sensitive identity collisions reject. Unsupported supplied names
  decline rather than silently becoming H. Construction also rejects a
  collision with the line label. Source Q remains Q.
- `scripts/verify/verify-w2-projection-precision.ts`: owned independent oracles,
  mutation/rejection controls and actual compiled-ink checks; optional SVG/JSON
  evidence output. Existing gates are unchanged.

The exact N1 requests P(10,0.0000000000000001) versus x+y=10 and
P(100000000,0.000000001) versus x+y=100000000 now decline the whole source
program and family. Direct generic distance evaluation throws, and forged
point-kind/d=0 documents compile to null render output. A project-only candidate
also rejects through the analytic guard after the distance producer is removed.
Bit oracles additionally cover product cancellation
(1+2^-27)(1-2^-27)-1 = -2^-54, signed residuals and subnormal boundaries.

## Parent integration requirement: distance quantity binding

With actual validated full IR and one distance evaluate result, the source
program carries the recomputed distance under the exact
`resultBinding.turnPlanQuantityId`, preserving its symbol, supported coordinate
unit and requested-fact evidence. Exactly one quantity-backed label annotation
links that quantity to `projection_distance`. Missing/empty binding, unsupported
unit, given-fact binding, wrong answer or ambiguous distance requests decline.
All existing full-IR agreement checks remain; caller IR is not mutated.

Without IR, the program carries deterministic `projection_d` and its annotation.
This does not fabricate a caller plan or solver binding. With IR but no distance
result request, it adds no substitute distance quantity/annotation. Foot-only
save admission remains a parent responsibility under the existing contract.
The source seam cannot establish a matching TurnPlan quantity or serialized
solver authority; parent must supply actual full IR through the normal path,
verify same-ID plan/solver/request bindings, and run save/reopen/replay.
The application persistence contract was read only and not modified.

## Five core oracles and inspected actual geometry

| Case | Independent expected foot / distance | Actual offline result |
| --- | --- | --- |
| Mixed-case Perpendicular Foot Q, P(0,0), 3x+4y-25=0 | Q=(3,4), d=5 | Q preserved; connector ends at foot |
| Distance and uppercase FOOT q, P(1,2), y=2x+5 | q=(-1,3), d=sqrt(5) | q preserved; d≈2.236 |
| A(2,-3), x=7 | H=(7,-3), d=5 | Horizontal connector to vertical line |
| Origin, y-3=2(x-1) | H=(-.4,.2), d=1/sqrt(5) | d≈.447; perpendicular connector |
| P(3,4), 3x+4y-25=0 | Foot=P, d=0 | Shared point; no fictitious segment |

Hand substitution and normal-direction equations check the oracles. Actual
compiled primitives check required point/foot marks, connector endpoints,
original-case foot labels, distance labels and board bounds. For incidence,
coincident connector point ink may be deduplicated; the d=0 label remains.
All five SVGs were rasterized from the actual compiled scene and visually
inspected at 1200×700. Q/q, perpendicular geometry, readable separated labels
and in-zone ink were confirmed. This is **offline geometry inspection**, not
student UI, narration, WRITE, FOCUS or interactive reveal evidence.

F1 whole-request suffixes/unreadable extra points, F2 changed large-coordinate
and intercept mutations, F3 underflow/lost decimal digits, exact coefficient
cancellation and supported terminating fractions remain covered. New controls
also include lowercase caption identity/coordinate contradictions, P/foot name
collisions under every keyword case, unsupported names, sourceNameQ and full-IR
quantity binding. No old gate/count/threshold was relaxed.

## Exact commands and logs

All commands ran in the owned tree with its own frozen dependencies and local
builds. Node **v24.21.0**, pnpm **10.32.0**. Set PATH first:

```sh
export PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
```

Log root: `<owned tree>/.w2-projection-evidence/`.
Artifact root: `<owned tree>/tmp/w2-projection-corrections-20261006/`.
These ignored local receipts are not tracked dependencies.

| Command | Final result / log |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | Exit 0, 666 own packages, zero downloads; lockfile unchanged; `install.log` |
| `pnpm --filter @heytutor/drawing build` | Exit 0, ESM/declarations; `build-drawing.log` |
| `pnpm --filter @heytutor/scene-engine build` | Exit 0, ESM/declarations; `build-engine.log` |
| `pnpm --filter @heytutor/scene-engine typecheck` | Exit 0; `typecheck.log` |
| `pnpm --filter @heytutor/scene-engine lint` | Exit 0, four inherited warnings, no errors; `lint.log` |
| `pnpm --filter @heytutor/scene-engine exec tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --typeRoots ../../node_modules/.pnpm/@types+node@22.20.0/node_modules/@types scripts/verify/verify-w2-projection-precision.ts` | Exit 0; `typecheck-gate.log` |
| `pnpm --filter @heytutor/scene-engine exec eslint src/math/exactBinary64.ts src/ir/pointLineProgram.ts src/ir/pointLineSource.ts src/compile/analyticLineGeometry.ts scripts/verify/verify-w2-projection-precision.ts` | Exit 0, no warnings/errors; `lint-owned.log` |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-projection-precision.ts ../../tmp/w2-projection-corrections-20261006` | Exit 0, five cores / **196 checks**; `gate-projection-precision.log` |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-point-line.ts` | Exit 0, original source/composition/full-IR and F1/F2/F3 controls; `gate-w2-point-line.log` |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-point-line-ready.ts` | Exit 0, unchanged five cases / 19 controls / **113 checks**, no student claim; `gate-ready113.log` |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-ch06a-line-operators.ts` | Exit 0, **553 checks**; `gate-ch06a.log` |
| `node tmp/w2-projection-corrections-20261006/raster.mjs` | Exit 0, five PNGs from actual scene SVGs using own installed sharp; `raster.log` |
| `node tmp/w2-projection-corrections-20261006/compiled-smoke.mjs` | Exit 0, built ESM Q/q/incidence positives and forged cancellation rejection; `compiled-smoke.log` |
| `git diff --check` / staged diff check | Exit 0 |

Artifacts: `general-Q`, `slope-q`, `vertical`, `origin`, `incident` each have
`.json`, `.svg`, `.png`; `receipts.json` records outcomes;
`full-ir-distance-binding.json` preserves the actual authored whole IR and
bound document. `compiled-smoke.mjs` and `raster.mjs` are owned ignored scripts.

Initial diagnostic invocations were corrected: an invented
`verify-coordinate-line-operators.ts` filename did not exist (the actual
553-check gate is `verify-ch06a-line-operators.ts`); direct gate tsc initially
lacked visible Node types (rerun with own installed typeRoots); tsx `-e` used
CJS against ESM-only drawing exports (rerun as owned .mts); sharp's installed
entry is `dist/index.mjs`, not the guessed lib entry. These tool/bootstrap
failures are not product passes or product failures. The owned gate initially
exposed a missing annotation insertion and an overstrict expectation of
separate coincident connector ink; final annotation insertion and actual-ink
oracle are checked above. Final repeated commands and counts refer to the
committed source/gate, not those initial attempts.

## Limits and parent handoff

The proposed source class remains one explicit 2D point/origin and one readable
linear equation, supported exact source literal conversions and complete
bounded projection request. Precision-limited inputs decline; no below-precision
question representation is claimed. Native/holdout, multibody/3D, parameter,
intersection and word/two-point line definitions remain outside this cohort.
The generic project guard is attached to analytic line producer validation;
arbitrary non-analytic/inline/finite-line project dispatch is not certified by
this patch. No shared compiler dispatch or new operator/alias was added.

Fresh independent review, normal caller/export/pre-TTS plan integration,
real student geometry/narration/WRITE/reveal, authenticated save, restart, fresh
reopen and whole replay are **UNRUN**. Full suites and frozen failure-digest
comparisons are **UNRUN**. Parent owns N3 and shared integration seams. No topic
count or acceptance state is changed by these offline passes.

Only the five allowed code/gate files and this log are committed, with author
and committer Rishi Vhavle <rishivhavle21@gmail.com>,
`core.hooksPath=/dev/null`, no coauthors. No remotes, providers, runtime servers,
DB, environment/key reads, stash, other-tree/protected-main writes, agents,
forks or Astral were used. Dependencies were installed offline with scripts
ignored; no lifecycle/native rebuild was required. Parent must review the
commit and complete the real-IR quantity binding/lifecycle checks before any
readiness claim.
