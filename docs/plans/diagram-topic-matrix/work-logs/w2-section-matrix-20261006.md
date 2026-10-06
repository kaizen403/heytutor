# Wave 2 section/matrix source admission — Sol, 6 October 2026

## Assignment and pin

- Integration owner: continuing parent; implementation worker: fresh Sol. No agents spawned/forked. Chemistry, Biology and DSA engineering excluded.
- Tree: `/Users/kaizen/heytutor-cov-wt/w2-section-matrix-20261006`; branch `cov/w2-section-matrix-20261006`.
- Exact starting pin: `dcb9be95403e5ec19da1b3c1f6f87c2b0ae9d523` (PR91 baseline supplied as verified remote main). Parent subsequently reports deployment success; this worker did not perform remote/deployment operations.
- Exact implementation/test/fixture pin: `31573ff98df2e81e4f7f41c6dd1048d2b29440b7`; author and committer both Rishi Vhavle `<rishivhavle21@gmail.com>`, no coauthors. The follow-up commit changes this evidence log only.
- Topics: `maths|10|section-formula` (CH-06a) and `maths|3|matrices-and-types` (CH-14a). JEE Main/Advanced readable numeric source core; no new exam-bank/native cohort claim.
- Read root AGENTS, coverage plan, topic matrix index/progress/readiness, continuation and session ownership. User continuation supersedes historical pauses. READY 1/FULLY-CERTIFIED 0/new READY 0 for the nine-topic queue; accepted Chemistry rows remain untouched.
- Owned source paths: existing `src/ir/sectionFormulaSource.ts`, existing `src/compile/matrixSourceBinding.ts`, new bounded `src/ir/matrixLiteralSource.ts` (all under `packages/scene-engine`). New verify path and fixtures announced before edits: `scripts/verify/verify-w2-section-matrix.ts`, `scripts/verify/fixtures/w2-section-matrix/`. This worklog is the only documentation write.
- No shared index/compiler/synthesis/document/capability/planner/selection/persistence/replay/hook edits, ledger/count writes, protected-main changes, runtime servers/browser/ports/DB, keys/env reads, remote pushes/PRs/merges, stashes or old-tree deletions. Own frozen ignore-scripts dependency installation only.

## Actual source and full IR

Captured inputs were read from `/Users/kaizen/heytutor-claude-coord/runtime/w1-runtime-audit/batch-c6b41c4/`. Sanitized fixtures preserve entire IR/plan objects, excluding unrelated runtime/solver envelopes and external paths; they are source diagnostics, not student evidence.

| Original artifact | SHA-256 |
| --- | --- |
| `w1-section-sf3-actual-full-ir.json` | `f86267e61b55a1707c894c4eceef98e12b889983b5040a743f433338eb4de1c5` |
| `w1-matrix-case1-normalized-ir-and-solver.json` | `9819ee68f40340fcb8c8a9583bcd96b0e9d9bf5420f9a68c9d96b153e4121cf1` |
| `w1-matrix-case1-selection-diagnostic.json` | `1fb0809c73ee715a4a1a6f5dfaadfa73e043b6d2de3ae316b0c47e29fbb46eed` |

Fixtures:

- `section-sf3-actual-full-ir.json`: byte-identical original SF3 artifact (hash above), all five facts, four entities, eight expressions, two solve requests and graph intent.
- `matrix-case1-actual-normalized-ir.json`: complete captured normalized IR; SHA-256 `6a910e10b7aebad47447ac86b85310378a51b2f2ea72fe4b5ffe73799b4000e9`.
- `matrix-case1-actual-raw-ir.json`: complete raw model IR; SHA-256 `1359f80eff51a014659e78747b71daa2e94561098b2681427cbbd047e92f989a`.
- `matrix-case1-actual-plan.json`: complete actual plan; SHA-256 `e0d4a3c720f8afc3826a3c625cfd68a9a9464a825bb455cf389bcfc34cacccd3`.

SF3: source A(1,2), B(4,5), external AP:PB=2:1. Independent affine parameter t=2 gives P=(7,8), beyond B. The actual graph contains ptA, ptB, ptP and lineAB. Original binder insisted on exactly three intent entities, then also failed on captured e-prefixed roles/result computations. Reproduction failed at “actual four-entity SF3 must bind the entire graph” after the drawing package was built (initial attempt had missing drawing dist).

Matrix: unchanged source `A=[[2,5,19,-7],[35,-2,2.5,12],[1.5,1,-5,17]]. Show the matrix A, state its order and write the elements a13, a21, a33, a24 and a23.` Independent order 3×4; requested entries 19,35,-5,12,2.5. Actual given quotes `A[1][1]=2` etc. do not occur in the question. Original source binder still rejects this unchanged plan. Captured normalized IR has 20 entities (A, every row/column/cell), 14 expressions, five facts, six solve requests and a graph intent; its scalar `order` request has no final binding. Raw model equations use unsupported lhs/rhs strings and unary `op` fields: raw IR continues to decline, with no constraints stripped by this worker. The normalized captured IR is preserved exactly; independent canonical source IR also contains all 20 entities, 14 expressions and seven requests (both order components plus all five entries).

## Reusable changes and independent checks

Section:

- Resolve exactly one requested point among intent point entities instead of using total intent cardinality. Require source-grounded endpoint roles; allow only a single line labelled AB with given evidence for both endpoints. Unknown additional points/lines/entities still decline.
- AB is the existing source joining segment, required and revealed, with original ProblemIR entity/fact lineage. Its geometry and restored/source validation are re-read independently; submitted provenance/section markers are not authority.
- Recognize bounded captured expression spellings eAx/eAy/eBx/eBy/eM/eN while keeping role-based numeric/lineage checks. Exact rational arithmetic checks captured ePx/ePy against freshly solved source coordinates and endpoint/ratio/external evidence. Unsupported expressions decline. Bind exceptions decline without partial output.
- Keep explicit result identity controls and anonymous naming policy, coordinate label-channel checks, AP/PB orientation and reversed-endpoint/swapped-weight protections. Existing full-IR gates stay unchanged.

Matrix:

- Extend the existing whole-source parser to expose requested cell positions. `readMatrixLiteralSourceProgram` reuses its grammar/operator math and recovers literal evidence from the unchanged question. It does not accept unresolved indexed native premises, scalar multipliers or operations as literal-only repair input.
- `recoverMatrixLiteralPlanEvidence` recovers only correct indexed-assignment evidence spellings for uniquely symbol-owned literal cells. Wrong cell values, indices, names, symbols, units and ownership remain rejected by independent source math/original binder. Wrong values in fabricated evidence also decline; arbitrary fabricated prose is not rewritten. Input plan is not mutated.
- `prepareMatrixLiteralSourceAuthority` preserves validated captured facts/entities/expressions/intents and requests, or independently constructs full source IR when no model IR is supplied. Unknown entities, unsupported constraints, wrong expressions/bindings and omitted requested cells decline. Tuple order becomes rowsA/colsA with explicit deterministic solver bindings, preserving its qualitative claim and both components. Add missing derived cell values only from source arithmetic; wrong existing derived values are not washed away. Recompute solver results after preparation; captured solver flags/results are never accepted.
- Source entity/dimension helpers bind individual matrix/row/column/cell/order roles against the freshly verified whole grid; exact position/shape/fact identity replaces scalar-value membership. Required/reveal coverage and the single literal table are mandatory. Extra marks, changed cells/names, dropped construction/required/reveal and wrong lineage/value controls reject. These are parent integration helpers, not a registered obligation exemption.

Independent section core cases: actual SF3 P(7,8); internal A(-3,7),B(7,-8),3:2 → Q(3,-2); external A(1,2),B(4,5),1:2 → R(-2,-1); midpoint A(-2,4),B(6,-8) → (2,-2); given P(4,5) on A(2,3),B(8,9) → 1:2. Check actual analytic operator geometry against these manually fixed oracles (absolute 1e-12 tolerance for double geometry only; source rational checks remain exact), compile output, full-IR obligations and reversed-parameter protections. Controls cover wrong result Q/R identities, endpoints, extra line/point, line evidence/geometry, given roles/ratios, false computations, fabricated evidence, false constraints, coordinate labels, singular/signed/zero ratio and fractional-coordinate declines.

Independent matrix core cases: actual 3×4; row [-4,0,1.25]; column [0,-2.5,8]; 2×2 identity; repeated-value 2×2 [[2,2],[-5,7]]. Check full source IR, exact local solver results and authority bindings, table compile and all actual 20 role witnesses. AB/BA independently remain [[2,1],[4,3]] and [[3,4],[1,2]]. Literal scale labels keep product dots. Initial “If A”, symbolic cells, oversized/underflow inputs, inverse requests and unresolved native-option premises remain fail-closed. Existing native q5 source component still compiles as question_representation; this is not full-native question acceptance.

## Commands and results

All pnpm commands used Node24 PATH `/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH`; observed Node v24.21.0 and pnpm10.32.0.

| Command (from assigned tree) | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS; own 666 packages; no foreign node_modules copied/symlinked |
| `pnpm --filter @heytutor/drawing build` | PASS, before engine/app imports |
| `pnpm --filter @heytutor/scene-engine build` | PASS |
| `pnpm --filter @heytutor/tutor-core build` | PASS, before app-facing gates |
| `pnpm --filter @heytutor/scene-engine typecheck` | PASS after fixing cellRole structural parameter type |
| `pnpm --filter @heytutor/scene-engine lint` | PASS, 0 errors; four pre-existing DSA unused-variable warnings |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-section-matrix.ts` | PASS; actual IR, five section/five matrix cores, source ownership/negative controls, AB/BA and native preservation; offline only |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w1-section-fullir.ts` | PASS; six normal, five explicit-Q forms and original source/dimension controls |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-topic-section-formula.ts` | PASS 37/37 |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-section-formula-ready.ts` | FAIL after 21 positives, source-static hook-order assertion line197 (below) |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-matrix-source-binding-hey88.ts` | PASS 440 |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-matrix-array-operators.ts` | PASS 9270 |
| `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-matrices-ready.ts` | FAIL “2·A: drawn with a product dot”, line314; native block after this failure is unrun in this gate |
| `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-matrix-source-types-hey88.ts` | PASS 1676 including unchanged native sentinel; in-memory only |
| `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-matrix-source-persistence-hey88.ts` | PASS 248; in-memory only |
| `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-fullir.ts` | PASS six source cases, 12 declines, explicit/anonymous naming; offline canonical/read/restore checks |
| `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-section-formula-ready.ts` | PASS seven cases, eight declines, 138 checks |
| `git diff --check` | PASS |

Baseline/failure qualification:

- Section readiness asserts textual ordering in unchanged `useQuestionHandler.ts`. `git hash-object` and `git rev-parse dcb9...:<path>` both give `75f9cccbca7c1744b6155b090d91f61ef3ff6a5f`. No shared hook/gate edit or assertion relaxation.
- Matrix readiness failure was reproduced with the exact `dcb9` matrix module: an owned-file Python try/finally temporarily wrote `git show dcb9...:packages/scene-engine/src/compile/matrixSourceBinding.ts`, ran `pnpm --filter @heytutor/scene-engine exec tsup src/index.ts --format esm`, then the unchanged app gate. Same line314 assertion/exit1. Finally restored worker source bytes and rebuilt the current engine package. No shared tracked file changed.
- New section negative test showed direct `compileSceneDocument` accepts a forged AB join while `validateSectionPointSourceInputs` and existing `validateTurnPlanSceneProofs` reject it. Source validation must be registered at the parent-owned direct compile seam; no direct-compile safety claim made here. The new gate asserts validator/admission rejection; independent derived-coordinate compile controls remain in old gates.
- Intermediate new-gate failures (missing drawing dist, original SF3 admission, source-compile seam, missing derived values in canonical source plan, incorrect evaluator test context and 4.44e-16 double geometry difference) were diagnosed explicitly. Missing canonical derived values and test context were fixed; double geometry uses a tight independent tolerance, without relaxing exact source authority.
- Full repository suites, real student turn/reveal/narration/WRITE, authenticated storage, actual DB restart/reopen and whole replay were not run by this worker. Existing passing in-memory/native source gates do not supply student evidence.

## Precise parent glue and remaining scope

1. Export the new helpers at the parent-owned package index. Existing section public signatures need no change.
2. Before/final solver authority, call `prepareMatrixLiteralSourceAuthority(question, turnPlan, normalizedProblemIR)`; on nonnull use both returned plan and preserved ProblemIR, recompute deterministic solver/audit/projections and then normal reconciliation. Do not keep old solver results beside repaired input. For invalid raw IR, retain its rejection separately; a source-only call produces a complete independent source IR, not a stripped/minimal model IR.
3. In the full-IR obligation path, use `matrixLiteralSourceEntityIsCarried(document, problem, entityId)` and `matrixLiteralSourceDimensionIsCarried(document, problem, expressionId, value, factIds)`. Tri-state null leaves unrelated sources on existing checks; false must reject. The validated table supplies real indexed subentity geometry rather than inventing separate row/cell marks. Preserve required/reveal checks (helpers already check the table). Do not exempt all matrix obligations or trust document/provenance flags. Current generic one-to-one body-name matching cannot independently map the captured row/column/cell entities to one table, so normal selection still needs this glue.
4. Register `validateSectionPointSourceInputs` at direct document validation/compile as well as existing admission/save/read/restore/replay paths. Re-read AB endpoint geometry and result label coordinates; do not use section/provenance markers as privileges.
5. Parent owns planner/source-program reporting, final numeric label/teaching checks, actual student and affected lifecycle review. Keep matrices nonmetric/qualitative or honest question-representation; do not promote the native component to whole-question exact authority.

Section full-IR binding pattern useful for point/line work: validate IR against the whole question; source-bind each entity role before generating marks; separate intent point cardinality from legitimate line entities; prove a line's endpoint-source facts independently; preserve the original facts/intents/constraints/requests; carry literal dimensions by role/value/fact lineage; let existing constraint obligations reject unsupported relations. No synthetic source text or equal-number substitution.

| Topic | Proposed disposition | Remaining variants |
| --- | --- | --- |
| `maths|10|section-formula` | integration_pending; no READY/acceptance claim | direct compile seam; parent real SF3 student/teaching/lifecycle; signed/zero ratios, fractional/symbolic coordinates, axis/line division, endpoint-from-midpoint, centroids/trisection/multiple ratios, native/holdouts |
| `maths|3|matrices-and-types` | integration_pending; no READY/acceptance claim | normal parent authority/selection/subentity glue and actual case1/lifecycle; tuple-order teaching audit; 17 row variants/native full stem/options/multiline/holdouts; symbolic cells, inverse and >6×6 remain unsupported; initial If-A policy and 2A unit collision preserved |

No accepted topic counts changed. Integration-owner disposition remains pending independent code/source/student/lifecycle review. Implementation pin is recorded above; final worker report supplies the resulting evidence-commit branch SHA.
