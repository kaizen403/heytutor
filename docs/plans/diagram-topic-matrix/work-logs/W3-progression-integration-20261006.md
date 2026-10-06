# W3 bounded progression engine integration — Sol, 6 October 2026

Disposition: **verification_pending; READY=0, accepted=0**. This receipt is for
normal engine integration only. Actual student/native/lifecycle acceptance and
external app/core Plan wiring remain parent-owned. No topic/counter/readiness
change, Chemistry work, subagent, fork or Astral work.

Assigned worktree and branch:
`/Users/kaizen/heytutor-cov-wt/w3-progression-integration-20261006`,
`cov/w3-progression-integration-20261006`. Clean starting revision:
`a3233de2061a4f93bf98bc430cbbc9427b5c8476`, containing the progression source
foundation and binomial foundation/integration. Commit author is Rishi Vhavle
`rishivhavle21@gmail.com`, with hooks disabled per commit command.

Read AGENTS.md, DIAGRAM_ENGINE_COVERAGE_PLAN.md, topic matrix index/progress,
session ownership, layout guidance and
[the source worker receipt](W3-sequences-source-20261006.md). The exact shared
paths were announced before editing. Work stayed within the assigned tree.

## Baseline gaps and contract changes

- The original worker gate passed **250 checks**, but reported
  `unsupported_operator` at the normal compiler. The existing
  `indexedProgressionGeometry.ts` evaluator, structural validator and renderer
  were present without canonical registration or normal compiler dispatch.
- The five frozen authored fixture Plans had numeric unknowns and **no derived
  results**. Standard `validateTurnPlanV3` independently rejects those actual
  profiles with `unresolved_numeric_unknown`. The source worker did not run
  whole V3 validation. No exception is added for that profile. The integration
  gates explicitly preserve its rejection and supply complete authored Plans
  from their external test callers, using independently frozen expectations.
  The raw fixture files remain unchanged.
- The worker also rejected all repeated IDs across unknown/derived lists.
  Consistent unknown + derived roles under the same ID now work, after whole
  actual Plan validation. Duplicates within a list, given/request collisions,
  inconsistent same-ID symbols/units, wrong provenance/sign/dependencies,
  unresolved or stale values, unknown fields and uncertain scalars decline.
- Generic pruning drops the summary anchors of the worker candidate. Normal
  structural validation also materializes undeclared point outputs as helper
  entities. The source program now emits that canonical helper form itself,
  and the family submits its complete source candidate to the normal compiler.
  Repeated validation, compile and JSON read use the same complete proof;
  pruning or payload changes are not waived.
- Given dimensions map to their **actual expression IDs and source roles**
  after whole-source proof. Names use ordinary visual-obligation matching;
  required/reveal checks still run. No binder waiver or scalar-coincidence
  matching replaces those obligations.

## Owned paths (complete commit scope)

All paths below are relative to the assigned worktree:

1. `packages/scene-engine/src/compile/compiler.ts`
2. `packages/scene-engine/src/document/validation.ts`
3. `packages/scene-engine/src/types.ts`
4. `packages/scene-engine/src/capability/capabilityManifest.ts`
5. `packages/scene-engine/src/index.ts`
6. `packages/scene-engine/src/contracts/finiteProgressionContract.ts` (new)
7. `packages/scene-engine/src/ir/sceneSourceAuthority.ts`
8. `packages/scene-engine/src/ir/finiteProgressionSourceProgram.ts`
9. `packages/scene-engine/src/synthesize/familyScene.ts`
10. `packages/scene-engine/src/synthesize/visualObligations.ts`
11. `packages/scene-engine/scripts/verify/verify-w3-progression-integration.ts` (new)
12. `packages/scene-engine/scripts/verify/verify-w3-progression-integration.mjs` (new)
13. `packages/scene-engine/scripts/verify/verify-w3-progression-source.ts`
14. This work log.

The old source gate's complete authored caller Plans and compiler assertions
are adjusted to the actual normal operator contract. Its original numeric,
source, IR, native-hash and mutation controls remain; stale-value attacks now
mutate the existing resolved role, rather than accidentally testing a duplicate
role. The five numeric stdout lines are unchanged. Ten normal-compile assertions
raise its count from 250 to **260**; its final measurement changes from
`unsupported_operator` to `wired`. That output difference is intentional and
is not reported as a byte-identical baseline.

No edits to the existing progression evaluator/renderer/structural validator,
finite-progressions set solver, source grammar/math, binomial math/code/gates,
measurement code, apps/tutor, tutor-core, ledgers, readiness, environment files,
providers, DB, browser, main, stash or remotes. No copied dependencies or builds.

## Engine authority and placement

The existing `indexed_progression`, `progression_recover` and
`progression_insert` operators/kind are registered and dispatched through the
normal compiler using their existing evaluation and structural contracts.
Their discrete renderer is reused, with normal logical glyph extents,
viewport fit and measured handwriting label clearance. Normal source placement
is engine-owned `{origin: [0,0], displayScale: 1}`. Placement is nonmetric;
coordinates cannot certify terms, dimensions, topology or physical relations.
Generic explicit graphs with `source: {}` still compile under the existing
operator contract, including recovery and both insertion sign branches.

The source program preserves the actual complete facts/entities/expression
ASTs/constraints/intents/requests/binding IDs and actual Plan. Unknown full-IR
fields and nested AST/constraint/request fields decline instead of being
projected away. Source names, each numeric given role, the cumulative recurrence
and domain, and every requested result are required and revealed. Finite sums
use compact `S_N(sequence)` notation; result primitives retain the actual
quantity ID, Plan symbol, full source ask symbol, request ID and unit. Index
numerals do not carry the term quantity ID. Helper anchors are solver-only.

A source claim demands proof, including a progression source marker, a source
question or stored IR/Plan attached to progression ink. These fields are never
read as authority. The same guard also rederives the complete document whenever
the **actual external source question** is admitted, so removing all document
source markers does not bypass a supplied caller context. Missing needed actual
question/full IR/Plan declines atomically before normalization. Accessor Plan,
document source and authority controls are rejected without executing getters.

## Parent integration APIs

Public exports are available through the normal package entrypoint:

- `finiteProgressionSourceProgram(question, actualProblemIR, actualTurnPlan,
  placement?)`; omitted placement is the canonical normal engine placement.
- `validateFiniteProgressionSourceDocument(document, trustedQuestion,
  actualProblemIR, actualTurnPlan, placement?)`; same complete rederivation for
  admission/live/save/read/restore.
- `finiteProgressionSourceTablePrimitives(...)`; the same proof then existing
  table renderer, with actual names and result bindings.
- `finiteProgressionDocumentIssues(document, sourceAuthority?)`; the guard used
  before normal document normalization.
- `validateSceneSourceAuthority(document, actualQuestion, actualProblemIR?,
  actualTurnPlan?)`; the fourth parameter is optional for other engine lanes.
- `compileSceneDocument(document, {sourceAuthority: {question, problemIR,
  turnPlan}})` and `validateSceneDocument(document, {sourceAuthority: ...})`.
  `CompileOptions.sourceAuthority.turnPlan?: unknown` is additive.
- `synthesizeFamilyScene({question, problemIR, turnPlan})` and the normal last
  resort path select this family from complete source admission, not from native
  codes, a topic registry or a keyword router.

Parent must pass actual trusted values from app/core at every external boundary.
Neither document.source nor construction values/flags can supply missing caller
authority. Cached render payload validation and actual application persistence
remain parent work; offline document roundtrip is not cached payload authority
or lifecycle acceptance.

## Independent checks and receipts

All commands ran in the assigned worktree with PATH prefixed by:
`/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin`.
Node **v24.21.0**; pnpm **10.32.0**.

| Command | Result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | Own 666 packages; downloaded 0; lockfile unchanged |
| `pnpm --filter @heytutor/drawing build` | Own prerequisite ESM/DTS success |
| `pnpm --filter @heytutor/scene-engine build` | Own sequential baseline/final ESM/DTS builds succeed |
| `pnpm --filter @heytutor/scene-engine typecheck` | PASS; no diagnostics |
| `pnpm --filter @heytutor/scene-engine lint` | PASS; 0 errors, 4 existing warnings in untouched DSA files |
| Targeted `eslint` over every touched TypeScript/ESM implementation and gate | PASS; no diagnostics |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-progression-integration.ts --output-dir /tmp/w3-progression-integration-20261006` | **2286** checks PASS |
| `node packages/scene-engine/scripts/verify/verify-w3-progression-integration.mjs` | **301** independent built-ESM checks PASS; imports only normal public bundle |
| `... tsx scripts/verify/verify-w3-progression-source.ts` | **260** checks PASS; all original five numeric stdout lines retained |
| `... tsx scripts/verify/verify-indexed-progression-operators.ts` | **9290** checks PASS; stdout byte-identical to baseline |
| `... tsx scripts/verify/verify-finite-progression-sets-hey84.ts` | **848025** checks PASS; stdout byte-identical to baseline |
| `... tsx scripts/verify/verify-w3-binomial.ts` | **236** checks PASS; stdout byte-identical to baseline |
| `... tsx scripts/verify/verify-w3-binomial-integration.ts` | **341** checks PASS; stdout byte-identical to baseline |
| `... tsx scripts/verify/verify-w3-binomial-integration.ts --esm` | **341** built public-ESM checks PASS |
| `... tsx scripts/verify/verify-problem-ir.ts` | PASS; stdout byte-identical to baseline |
| `... tsx scripts/verify/verify-scene-engine.ts` | PASS; stdout byte-identical to baseline |
| `... tsx scripts/verify/verify-visual-obligations.ts` | **299** checks PASS |
| `... tsx scripts/verify/verify-label-ink-clearance.ts` | PASS |
| `... tsx scripts/verify/verify-family-synthesis.ts` | Existing RED at line 307: `thin lens topic figure must compile`; reproduced with pinned tracked sources, restored owned edits in finally; full output byte-identical before/after |
| `git diff --check` | PASS |

Independent oracles use direct integer recurrence/aggregation, explicit signed
mean answers and frozen expectations, rather than production progression
formulas. Controls cover actual V3 roles, unknown/extra fields, units, full-IR
identity, AST scalar-coincidence attacks, both sign branches, generic recovery,
finite bounds, nonmetric proofs/descendants, missing authority, required/reveal
and timeline omissions, source names, quantity/request binding ink, mutation of
stored source and placement, canonical revalidation, JSON/JSONB ordering,
handwriting ink clearance, and raw native byte hashes. The ESM gate is separate
plain JavaScript, not an import of the TS gate.

Stdout SHA-256 receipts:

| Output | SHA-256 |
| --- | --- |
| Source TS integration | `96e1415e3a4defd556255d9bc3209dfa4022dff436a70f9a5019b9aa2aa4b177` |
| Independent built ESM | `4c4803690579a7cdf73f5fa67d2ead6f238542bf1ee3e4783c27ee408c6fb4dd` |
| Updated source worker gate | `d51eba070aa5cd9003681d10121c4455a9ffea7add0df0aaf5ddda81b905e799` |
| Indexed operator unchanged | `7c9ac0f424cb8722d40ddbc4d10f18e9a26b69c35d5f72d0cf64323be99ce5b7` |
| Finite sets unchanged | `089c1e2494c9fb662e0e3723ccb23135bc65dec3e8ba20e44e732e4f18930d08` |
| Binomial foundation unchanged | `55944a9b43a2c4a748f815c332ff0a163416226e6368d9ddab7232b471bb7d7e` |
| Binomial source integration unchanged | `27477041c88bb7a01bf44ab8a62d76e9bff3d5f695437ed5564f600da9da4af8` |
| ProblemIR unchanged | `3193767a4af4acb107bdb81ca2da870a8917596cd730a6c9c53aaa0854a96b9f` |
| Existing thin-lens failure unchanged | `dd0a137433246b023092d5d709e9287d8b9521a738b04dd9373464aafe5c54d2` |

Scratch stdout and normal render payload evidence:
`/tmp/w3-progression-integration-20261006/`; authored cases are in
`progression-scenes.json`. These are offline compilation artifacts, not browser
inspection or actual student screenshots. Generated files are not committed.

## Remaining gaps

- **READY=0, accepted=0.** Actual student rendering/teaching WRITE/FOCUS/reveal,
  native admission, authenticated save, restart, fresh reopen and whole replay
  remain parent work. No engine-only gate closes a complete topic row.
- All three raw native blocks remain declined with hashes preserved. Frozen
  **2019 Q10 OCR stays a gap**. The readable 2022 recurrence transcription is
  authored, not native admission. Independent values are **T20=1504,
  sum20=10510, T30=3454, sum30=35615**; printed options 1604 and 35610 are false
  and cannot become actual Plan authority. Native codes are never routers.
- The source grammar is still the worker's bounded explicit finite grammar.
  Arbitrary prose/OCR rewriting, option truth classification, mixed AP/GP,
  infinite GP/convergence, general special sums, irrational branches and
  unsupported equivalent AST forms are not added.
- Existing term/sum/index/branch/capacity limits remain. Normal label and
  viewport limits still apply, including the existing compact-label contract;
  long or overcrowded candidates decline atomically. Five normal authored
  compositions and generic controls are evidenced, not every grammar instance.
- The thin-lens shared family gate is an unchanged baseline failure. It is
  outside this progression packet and is not fixed or hidden by this work.
