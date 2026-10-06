# W2 matrix products actual-runtime sidecar — 6 October 2026

Disposition: `integration_pending`. Integration owner: parent running W3 student cases. Worker: this session, without agent forks or provider/runtime changes.

Worktree: `/Users/kaizen/heytutor-cov-wt/w2-matrix-products-live-fix-20261006`.
Branch: `fix/w2-matrix-products-live-20261006`.
Base: `2314ec33b6fb421028bca597f819bca17cc2b168` from `/Users/kaizen/heytutor`.

Read before implementation: `AGENTS.md`, `DIAGRAM_ENGINE_COVERAGE_PLAN.md`, topic-matrix `index.md`, `progress.md`, `readiness.md`, and `docs/agent/session-ownership.md`. Ownership was announced before adding the dedicated gate. This is a bounded repair for `maths|3|matrix-algebra` / CH-14a, rather than a full topic submission or an exam-bank expansion.

## Immutable runtime evidence and reproduction

Capture: `/Users/kaizen/heytutor-claude-coord/runtime/runs/2026-10-06T0731-w2-03574f88/evidence/followup-matrix-product-planner-exchanges.json`.
SHA-256: `7c8d08e30f1f0b1c6bd9dd7f205628ded20d0e2bc5c9a9d959d3411a6c286753`.

Diagnosis: `/Users/kaizen/heytutor-claude-coord/reviews/w2-matrix-actual-20261006/diagnosis.json`.
SHA-256: `d3b62f6e9aef8628b08c1dd1dbf6db9dce3d68ebaad67a0b79f1823eb140a76d`.

The fixture extracts the **complete canonical plan from the first scene-document request**, not diagnosis.plan, which contains invalid string-valued matrix quantities. Its full original typed IR is diagnosis.ir unchanged. The raw problem-planner response is retained separately for provenance. `--check-capture` verifies both immutable hashes, the complete canonical plan, the complete original typed IR, and the raw formulation response. Capture files were read only.

Question: `Let A=[[1,2],[3,4]] and B=[[2,0],[1,2]]. Find AB and BA.`

Independent dot products give `AB=[[4,4],[10,8]]` and `BA=[[2,4],[7,10]]`.
The bare existing builder reproduces 28 primitives. Binding its actual canonical plan fails because A/B scalar zeros are not matrix source roles. The original IR has fA/fB literal facts, fAB/fBA requested facts, matA/matB entities, and empty expressions/constraints/representationIntents/solveRequests. A missing numerical graph must not make those facts and requests disappear from authority.

## Owned changes

- `packages/scene-engine/src/compile/matrixSourceBinding.ts`: exposes a product-only view of the existing whole-question parser; computes each ordered binary product with existing exact matrix operators; binds requested AB11 / `(AB)11` entry roles even without an assigned product name; retains non-algebra request obligations so product admission cannot erase type/order tasks. Existing general matrix grammar remains available.
- `packages/scene-engine/src/ir/matrixProductSourceAuthority.ts`: new whole-IR, complete-plan, audited early-correction, and document seams.
- `packages/scene-engine/scripts/verify/verify-matrix-products-live-20261006.ts`: dedicated source/artifact gate.
- `packages/scene-engine/fixtures/matrix-products-live-20261006/{actual-runtime,independent-products}.json`: immutable capture extraction and independent ordered-product oracles.
- This unique worker evidence log.

No registry, central validator, index, application, synthesize, current worker file, shared ledger, provider configuration, environment, other worktree dependencies, or other worktree build output was changed. No push, stash or main mutation was performed.

## Correction policy for parent review

The strict `matrixProductSourcePlanIssues` seam continues to reject the original A/B scalar placeholders. `correctMatrixProductSourcePlan` can withdraw only source-named zero placeholders with matching id/symbol, unchanged full literal quote, given provenance, dimensionless unit, no dependencies/nonzero uncertainty, and no asserted scalar sign. A fabricated quote, nonzero value, conflicting role, or explicit zero sign declines.

For the actual capture, withdrawal replaces A/B numeric givens with eight independently source-bound input cells (A11…A22, B11…B22). All eight derived dependencies become the specific input row/column cell ids. Derived values, source calculations, unknowns, claims, assumptions, laws and visual requirement survive only after complete revalidation; incorrect values and false explanations are rejected rather than corrected away.

The returned audit retains both original placeholder quantities, all original rejection issues, and each previous/corrected dependency list. Typed `matrix_source_alias` evidence retains original quantity id, named literal identity, source quote, and exact rational entries; `numericScalarAuthority:false` and absence of a `value` field prohibit a scalar zero interpretation. These aliases and the withdrawal audit are evidence, not numeric teaching quantities. Parent review of this explicit withdrawal policy remains an integration obligation.

`prepareMatrixProductSourceAuthority` requires a supplied full original IR and returns that same IR reference unchanged. It neither creates a fake numeric graph nor replaces the original graph. Every given/requested fact and entity must bind one source role with matching statement and unchanged quote. Additional assumptions, graphs, solve requests, intents, or unowned channels decline in this initial contract. No validator waiver or numerical-graph-absence exemption is used.

## Independent cases and negative controls

Five complete questions are exercised: the actual runtime question plus these four variants. Expectations are fixture oracles, derived independently by row/column sums. The gate compares source arithmetic and every emitted cell position/exact rational value against those oracles.

| Variant | Inputs | Ordered outputs |
| --- | --- | --- |
| Signed | P=[[-1,2],[0,-3]], Q=[[4,-2],[1,5]] | PQ=[[-2,12],[-3,-15]], QP=[[-4,14],[-1,-13]] |
| Fractions | C=[[1/2,-1/3],[2/3,3/2]], D=[[2,3],[-3,4]] | CD=[[2,1/6],[-19/6,8]], DC=[[3,23/6],[7/6,7]] |
| Rectangular | M=[[1,2,-1],[0,3,4]], N=[[2,0],[1,-2],[-1,1]] | MN=[[5,-5],[-1,-2]], NM=[[2,4,-2],[1,-4,-9],[-1,1,5]] |
| Commuting | E=[[1,0],[0,1]], F=[[0,-2],[3,0]] | EF=FE=[[0,-2],[3,0]] |

Negatives cover wrong/missing facts, reversed request identity, missing unknowns/cells, false matrix claims and commutativity, additional assumptions/laws/channels, wrong units/dependencies/uncertainty, scalar placeholder forgeries, counterfeit AST/equation/intent/solve graphs, accessors/inherited data, reversed scene operands, wrong source entries, missing product/reveal/required ownership, scene quantity/annotation injection, hidden source placeholders, missing stored question, determinant/inverse/unknown-product/type/order requests, and incompatible dimensions.

A failing negative exposed that the existing general plan validator admits `9*9=4` when the declared result is 4. The sidecar now checks a complete source row/column calculation if sourceText is present. Unrelated `2+2=4` and correct arithmetic followed by `A=0` also decline. Supported calculation spelling is the complete dot-product expansion, with negative/fraction factors parenthesized; absent sourceText makes no explanation claim. No central arithmetic validator was edited.

## Commands and outcomes

All commands ran in the owned worktree with Node `v24.21.0` and pnpm `10.32.0`. PATH began with `/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin`.

```sh
pnpm install --frozen-lockfile
pnpm --filter @heytutor/drawing build
pnpm --filter @heytutor/scene-engine typecheck
pnpm --filter @heytutor/scene-engine lint
pnpm --filter @heytutor/scene-engine build
pnpm --filter @heytutor/scene-engine exec tsup src/ir/matrixProductSourceAuthority.ts --format esm --dts --out-dir dist/matrix-product-sidecar
pnpm --filter @heytutor/tutor-core build
pnpm --filter @heytutor/tutor-core typecheck
pnpm --filter @heytutor/tutor-core lint
pnpm --filter @heytutor/scene-engine exec eslint src/ scripts/verify/verify-matrix-products-live-20261006.ts
pnpm --filter @heytutor/scene-engine exec tsc --noEmit --module ESNext --moduleResolution Bundler --target ES2022 --strict --skipLibCheck --typeRoots ../tutor-core/node_modules/@types --types node scripts/verify/verify-matrix-products-live-20261006.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-matrix-products-live-20261006.ts dist/index.js dist/matrix-product-sidecar/matrixProductSourceAuthority.js --check-capture
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-matrix-array-operators.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-matrix-source-binding-hey88.ts
git diff --check
```

Dependencies and sequential drawing → engine → tutor-core builds pass. Package typechecks pass. Lint has zero errors, with four pre-existing scene-engine unused-variable warnings and one pre-existing tutor-core warning. The dedicated gate is also statically typechecked and linted. Scene-engine does not declare Node types for scripts, so its dedicated script typecheck explicitly uses the already-installed tutor-core Node types; no dependency/configuration file was changed.

The final actual/all-seams artifact gate passes **353 checks**. It verifies normal engine compilation with complete sourceAuthority context, strict sidecar admission, source binding, emitted exact product cells, JSON serialization/revalidation, and idempotent early-correction → registry preparation. The inherited matrix operator gate passes **9,270** checks; source-binding gate passes **440** checks. The sidecar is bundled separately for artifact verification because index integration belongs to the parent. Generated outputs are ignored and uncommitted.

There is no new student render, narration/reveal observation, authenticated save/reopen, or whole replay evidence. JSON serialization checks establish only bounded offline revalidation. The supplied immutable runtime capture reproduces the failure, not a post-fix student success.

## Required parent hooks

1. Export the new authority module from scene-engine `src/index.ts`; the existing wildcard export of matrixSourceBinding already exposes `readMatrixProductSourceProgram`. Add the dedicated gate to the parent-owned verification registry if desired.
2. Before teaching/given-intro, scene prompt, or generic solver prompt generation, apply `correctMatrixProductSourcePlan` to a recognized bounded source product plan. Use only `.plan` as the teaching numeric plan. Retain `.audit` and `.sourceAliases` separately as explicit source evidence/telemetry; never merge the withdrawn rows back into teaching or scene-source metadata. A null correction means unsupported/contradictory data, not permission to drop obligations.
3. Once the actual full original IR arrives, call `prepareMatrixProductSourceAuthority(question, correctedOrOriginalPlan, originalProblemIR)` through the parent-owned source program registry. Preserve the caller IR unchanged, use the complete source-owned document, and compile with `{sourceAuthority:{question,problemIR:originalProblemIR,turnPlan:prepared.plan}}`. Do not manufacture expressions/requests or substitute a source-only IR for this captured IR.
4. Wire `matrixProductSourceDocumentIssues` into central sourceAuthority validation before any early exit based on absent expressions/constraints/intents/solveRequests. Alternatively compose the strict plan and full-IR issues with this document seam; all are exported. Central/visual-obligation integration must still retain existing structural/source/proof/compile validation. The sidecar is not permission for a blanket obligation waiver.
5. Route the recognized complete source document through the parent-owned family/prompt/application selection path. Exact entries coexist with nonmetric table spacing; the current builder conservatively marks the document `qualitative_verified`. Do not upgrade that tier from this worker log alone.
6. Persistence/restoration/replay must reapply the same whole source/plan/original-IR/document seam, including preservation of full question and every required/revealed source/product identity. The initial deterministic document forbids extra quantity/annotation/hidden-plan channels.
7. Parent review the withdrawal policy, then run the actual AB/BA student question and affected teaching/reveal/save/reopen/replay checks after integration. The existing literal-order path and all inverse/determinant/full numerical IR variants remain separate obligations.

## Per-topic disposition

| Topic | Checked scope | Proposed state | Remaining obligations |
| --- | --- | --- | --- |
| `maths\|3\|matrix-algebra` | Existing bounded literal parser; ordered binary products; signed/fractional/rectangular/commuting cases; captured fact-only full IR and complete canonical plan | `integration_pending` | Parent export/registry/central/app integration and withdrawal-policy review; actual student and affected lifecycle; addition/scaling/transpose/inverse/determinant/multi-step products; arbitrary numeric IR graphs; other wording/native/holdout variants |

Readiness, ledger and acceptance updates belong to the integration owner. No shared progress or counter file was changed. Commit requested by the user, authored as Rishi Vhavle (`rishivhavle21@gmail.com`) with `core.hooksPath=/dev/null`, without co-authors. No publication is requested.

## Integration-owner disposition

Pending parent independent review and integration. This section records no acceptance.
