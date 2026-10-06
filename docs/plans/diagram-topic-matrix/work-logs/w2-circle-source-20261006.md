# GENERAL-CIRCLE source program — w2-circle-source-20261006

Disposition: **integration_pending; READY 0; FULLY-CERTIFIED 0; accepted-count delta 0**.
Topic: `maths|10|circle-general-form-radius-and-centre`. This is a bounded authored
profile, not native question-bank coverage. Parent owns integration and acceptance.

Base: `759aa107a935a0c0b800dedf418bf48e9840c732`, private worktree
`/Users/kaizen/heytutor-cov-wt/w2-circle-source-20261006`. Parent subsequently
reported clean integration head `9211b396`; this worker did not rebase onto it or
edit its shared files. Commit author/committer: Rishi Vhavle
`rishivhavle21@gmail.com`, no coauthors, owned commit uses `core.hooksPath=/dev/null`.

Read AGENTS, root coverage plan, matrix index/progress/readiness, ownership,
continuation and w1-live-review work log. Reviewed the existing circle algebra,
source reader, IR/document contracts, circuit full-IR regeneration pattern and
external w1-live-review circle failure logs. Read c8814e67 as a rejected reference
only; no cherry-pick or reused exemption. The private reviewer probe source is
absent from this base/object path; its retained logs/work log describe the exact
P/Q boundary, reproduced here in an independently authored full IR.

## Owned implementation

- `src/ir/circleSourceMath.ts`: bounded exact rational polynomial reduction,
  source syntax checked with the existing math parser. Polynomial equivalence
  uses exact coefficients and nonzero constant scaling, never sampled equality
  or scalar coincidence. Source literal precision loss, variable denominators,
  degree above two and non-polynomial ASTs decline.
- `src/ir/circleSourceProgram.ts`: closed whole-source reader, independently
  regenerated document, full-IR binding, candidate validator and narrow entity/
  given-expression correspondences. Original `ProblemIR` object is retained
  unchanged, with every fact/entity/expression/constraint/request/intent checked.
  Only the trusted regenerated document is normalized; submitted candidates are
  compared without repairs. No callback into familyScene/compiler.
- `src/ir/circleSourceAuthority.ts`: pure fresh source-plan authority. Explicit
  coefficient roles, values and units bind separately; derived centre/r/r² roles,
  request IDs, units and dependency closure must agree. Stale supported results
  are recomputed; unsupported identities/dependencies and linked claims withdraw.
- `scripts/verify/verify-w2-circle-source.ts` and `fixtures/w2-circle-source/*`:
  independent authored full-IR oracles, complete historical plans, provenance and
  bounded check receipts including original baseline failure output.

All paths above are under `packages/scene-engine/`. This log is the only other
owned file. No shared index/compiler/family/visualObligations/sourceQuantityAuthority,
app, capability, document validator or existing verification gate was edited.

## Evidence and supported scope

The inspected actual student artifact
`/Users/kaizen/heytutor-claude-coord/runtime/runs/2026-10-04T0313-batch6b-66e72812/evidence/b6b-circle-general-frac-live.json`
has no saved full IR. Its corresponding planner-exchanges `problem-ir-v1`
response is an availability error. It cannot prove native/full-IR success.
Hashes and exact error are in `fixtures/w2-circle-source/provenance.json`.

The complete actual first b6b teaching plan is preserved, including null unknown
units and r=2.5. The existing native plan validator reports
`source_text_arithmetic_invalid`; the fixture is not reduced/normalized to pass.
The rejected c881 historical batch6a plan is separately retained as evidence:
h=1.5, k=-2, stale r=3. On the independently authored full IR, the new authority
retains the centres, corrects r to **sqrt(7)** and withdraws its linked claim.
These are teaching-plan observations, not captured full-IR proof.

Independent numeric/geometry oracles include:

- `.5x²+.5y²−1.5x+2y−.3750=0`: C=(1.5,-2), r²=7.
- `2x²+2y²+8x−12y−6=0`, and its negative scale: C=(-2,3), r=4.
- Equal-valued D/E and A/F roles retain separate role/evidence identity.
- `(x-1)²+(y+2)²=0` is one physical singleton with its name/coordinates in
  the actual scene caption. r²<0 declines.
- Exact adverse source unchanged: `Draw the circle x^2+y^2=25 and mark the
  point P(3,4) and the point Q(8,0).` Both physical marks, source labels,
  required IDs and reveal membership survive. P is on; Q is outside. Q-only
  retains Q. Origin-as-member reuses its actual centre mark without hiding O.
- Explicit centre/radius and named K/C; standard member source; equivalent
  polynomial scalings, including scoped coefficients of the second equation.
  Full evaluation requests have independently authored centre/radius ASTs.
- Long point coordinates retain physical Q plus the exact coordinate pair in
  `RenderScene.caption`; every caption/name/geometry mutation is checked afresh.
  The source circle has an explicit label annotation on real geometry, because
  a dimension annotation suppresses the compiler's automatic body label.

Marker-stripped candidates reject missing Q, missing required/reveal membership,
wrong entity/caption/semantic coordinates, Q→P, swapped equal-valued coefficient
roles, wrong units, foreign hidden entities, extra assertions and layout-space
coordinates. Actual-question/full-IR mismatch, dangling/cyclic dependencies,
wrong result IDs/units/evidence and naked coincident scalar result ASTs decline.

Limits: one finite numeric Cartesian circle/singleton and at most eight distinct
residual coordinate points. Only graph intents, circle equation constraints and
supported true incidence/inside constraints bind; every other IR object or
constraint declines. Direct membership contradictions, second different circle,
symbolic/OCR-corrupt/unreadable precision, physical coordinate units, extra lines,
tangents and unsupported requests decline. Coincident residual identities and
named singleton-centre aliases require a future proved alias correspondence.
Result ASTs support the declared coefficient-based completing-square operations;
other solver formulations/aliases may decline. Coefficient letters use the
explicit six polynomial roles: a planner's B-as-y² convention is not silently
reclassified as C. Coefficients cannot be invented as givens from a centre/radius
declaration. Ordinary physics circles and point-line questions return `none`.

## Checks and preserved failures

Owned frozen install: `pnpm install --offline --frozen-lockfile --ignore-scripts`.
All commands use Node **24.21.0** through the requested PATH prefix
`/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin`;
pnpm **10.32.0**. No provider, browser, DB, remote, main/other-tree, stash, key,
agent/fork or Astral operation. No student/live/restart/reopen/replay claim.

| Check | Result |
| --- | --- |
| `pnpm --filter @heytutor/drawing build` | PASS |
| `pnpm --filter @heytutor/scene-engine build` | PASS |
| `pnpm --filter @heytutor/scene-engine exec tsup src/ir/circleSourceProgram.ts src/ir/circleSourceAuthority.ts --format esm --dts --out-dir /tmp/w2-circle-source-20261006/helper-dist` | PASS; new helper JS and declarations explicitly built |
| `pnpm --filter @heytutor/scene-engine typecheck` | PASS before/after |
| `pnpm exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --strict --skipLibCheck --esModuleInterop --typeRoots node_modules/.pnpm/node_modules/@types packages/scene-engine/scripts/verify/verify-w2-circle-source.ts` | PASS |
| Own four TS paths, `pnpm --filter @heytutor/scene-engine exec eslint ...` | PASS; zero warnings/errors |
| `pnpm --filter @heytutor/scene-engine lint` | PASS; four warnings in unchanged DSA files retained; no DSA work |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-circle-source.ts` | **352 checks PASS** |
| Existing circle-operators / visual-obligations / problem-ir | PASS |
| Existing parallel-circle-standard-topic | exit 1 before/after, identical full output: unrelated physics/helper circle assertion |
| Existing archetype-pictures | exit 1 before/after, identical full output: kirchhoff-bilingual, ladder, collision, photoelectric declines |
| Existing archetype-point-ownership | exit 1 before/after, identical full output: collision body/label failure |

Five paired regression outputs have byte-identical SHA-256 digests and exits.
`fixtures/w2-circle-source/check-results.json` commits the exact three baseline
failure outputs, comparisons, build/type/lint receipts and focused sentinel.
Detailed owned logs remain at `/tmp/w2-circle-source-20261006/`.
The full engine/core/tutor suites and application checks were not rerun: no shared
or app changes, no root build and no assertion of a fully green repository.

## Parent integration points and remaining work

1. Export `readCircleSourceProgram`, `bindCircleSourceProblem`,
   `circleSourceDocument`, `checkCircleSourceProblemBinding`,
   `circleSourceProblemEntitySceneId`, `circleSourceDimensionIsCarried` and
   `applyCircleSourceAuthority` from the parent-owned index.
2. Offer `circleSourceDocument(actualQuestion, actualFullIR)` as the bounded
   source candidate. Do not replace the original IR or bypass obligations.
   Never treat a declined Cartesian source as permission for a partial circle.
3. Invoke `checkCircleSourceProblemBinding(actualQuestion, actualFullIR,
   candidate)` at the applicable public compiler/source-authority boundary,
   independent of document source markers. Avoid applying Cartesian authority
   to unrelated physics helper circles. Registering it inside the document
   normalizer would recurse, since trusted regeneration normalizes its document.
4. In visualObligations, use the independently verified entity correspondence
   for named geometry/captions (singleton curve maps to a real point), and the
   exact role/evidence-bound given-expression correspondence before generic
   scalar matching. An explicit false correspondence must stay a rejection;
   null merely denotes an unsupported/unbound correspondence. The central
   validator remains mandatory. Keep all residual objects/relations gated.
5. Adapt `applyCircleSourceAuthority(question, plan, actualFullIR)` into the
   parent source-quantity registry before the final teaching authority checks.
   Null on unsupported/mismatched IR is not successful authority. Preserve the
   parent's current result-unit/public compiler and persistence guards.
6. Parent independent review must exercise normal compile/selection/save/restore
   with complete real IR. Then run a normal student general-circle turn and the
   adverse P/Q and Q-only cases, inspect geometry/labels/captions, narration,
   WRITE/FOCUS/reveal and the affected lifecycle. Current standalone compiled
   primitives/captions are offline structural evidence only.

No ledger/root counts changed. READY stays 0 for this submission pending parent
integration, independent review and student evidence.
