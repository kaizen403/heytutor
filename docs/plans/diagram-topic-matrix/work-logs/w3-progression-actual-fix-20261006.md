# W3 actual progression rejection fix — 6 October 2026

Worker: Codex in the user-assigned isolated worktree. Integration owner: parent coordinator.
Disposition: **integration_pending**. Real-student credit: **0**. No readiness or accepted ledger changes.

Worktree: `/Users/kaizen/heytutor-cov-wt/w3-progression-actual-fix-20261006`.
Frozen base: `50865ce221042e254e3ac5972d6c80496b54d08d`.
Branch: `fix/w3-progression-actual-20261006`.
Topic reference: `maths|6|arithmetic-and-geometric-progressions`; this is a bounded authored-source repair, not exam-bank/topic certification.

Read AGENTS.md, DIAGRAM_ENGINE_COVERAGE_PLAN.md, topic-matrix index/progress/readiness and session-ownership. Ownership was announced before creating this worker's verify gate. Protected main was not edited, stashed, switched or reset. No agents, forks, remotes, DB operations, other workers' gates or readiness/accepted-ledger edits were used.

## Allowed files

- `packages/scene-engine/src/ir/finiteProgressionSourceProgram.ts`
- `packages/scene-engine/scripts/verify/verify-finite-progression-actual-w3.ts` (new, worker-owned)
- `packages/scene-engine/fixtures/source/finite-progression-actual-w3-20261006.json` (new, full source-authority capture)
- This worker log (new).

No core planner, registry, central contracts/compiler/validation, family or guidance edits.

## Original capture and concrete diagnosis

Evidence directory:
`/Users/kaizen/heytutor-claude-coord/runtime/runs/2026-10-06T0833-w2-c4ede352/evidence`.
Inputs: `reviewed-progression-ap-positive-live.json` and `reviewed-progression-ap-positive-planner-exchanges.json`. Their SHA-256 hashes and original text-only/no-scene receipt are recorded in the fixture. The fixture preserves the original question, complete raw planner IR, actual validated Plan from the formulation request, and the complete normalized IR. It does not substitute the stripped empty Plan persisted after the original failure.

Exact source:

> Let a_n be an arithmetic progression with a_1 = 5 and common difference 3. Find a_20, sum_{k=1}^20 a_k.

Original normalized input has five facts (`fModel`, `fFirst`, `fDiff`, `fAskTerm`, `fAskSum`), one entity, three expressions, zero constraints, one conceptual intent referencing all five facts, and two bound evaluate requests. The actual Plan has both unknowns and both correct derived values (62 and 670), including the original sourceText and sum dependsOn fields. Nothing was removed or renamed.

Before changing the operator, the full-capture source replay failed with:

```
{"mode":"source","actual":"declined","reason":"every full-IR fact must participate in a proved source dependency"}
AssertionError: 'declined' !== 'ok'
```

Concrete unconsumed obligations were `fFirst` (`a_1 = 5`, span 42–49) and `fDiff` (`common difference 3`, span 54–73). Entity/model expression consume `fModel`; result expressions/bindings consume the two requested facts. Intent validation checked the conceptual kind and references but never consumed its already-grounded roles. The original whole model quote itself passes statement/span auditing.

At this specific frozen base the independently generated sum root is already the compact `20*(2*5+(20-1)*3)/2`, so AST mismatch is not the first reproduced rejection here. The pair form identified in the task, `20*(5+(5+(20-1)*3))/2`, formerly fails structural source-ask matching. Both forms are covered by this bounded repair. The diagnosis distinguishes the actual frozen-base failure from that additional equivalence gap.

## Bounded repair and proofs

Conceptual intent consumption now requires every fact to have passed complete source-span/statement/role proof and to address its actual represented sequence entity. All source roles/asks must still exist; all expressions, entities, constraints, bindings and actual Plan quantities must still audit successfully. Mere membership in an intent cannot consume arbitrary facts. First/difference representation labels now carry actual supporting fact IDs, including the redundant grounded facts. A failure reports exact unconsumed IDs.

AST admission keeps structural equality and adds only source-operand identities:

- AP: `N*(2*A+T)/2`, `N*(A+(A+T))/2`, `N*((A+A)+T)/2` and corresponding `(N/2)*...` forms. Proof is `A+A=2*A` plus addition associativity and multiplication/division by the same nonzero 2. `A`, `T` and `N` are taken from the independently constructed source AST, not recovered from the candidate's evaluated answer. The implementation recognizes either compact or pair-shaped source AST.
- GP: `A*(1-R^N)/(1-R)` versus `A*(R^N-1)/(R-1)`. Both numerator and denominator reverse signs together. The source's complete first, ratio, exponent and denominator subtrees remain intact. Unit-ratio sources retain their existing nonsingular `N*A` form.

There is no general simplifier, answer comparison as admission, canceled-operand elimination, chapter/ID runtime dispatch or reduced IR. Post-match numeric recomputation remains a separate check. Cumulative expressions and empty sums do not gain identity rewrites. The accepted document retains the original submitted AST and actual Plan rather than rewriting either.

## Independent gate

Final gate: **407 checks in source; 407 checks in freshly built ESM**.

The gate freezes and compares every original collection ID, exact fact statement/quote and complete unsimplified expression AST. It checks full admitted IR/Plan and document source retention, no input mutation, actual quantity IDs/symbols, conceptual first/difference labels and fact provenance, source regeneration, normal validation/compile, offline JSON round trip and discrete ink. These are offline checks; they are not saved student replay evidence.

Positive expectations use a separate finite recurrence loop, not the progression source reader, generated ask AST, or production aggregation. Four actual-capture forms, ten independent direct AP/GP holdouts, and two complete source-constraint/dependency cases pass. Holdouts cover negative and zero AP parameters, zero first, fractional first/parameter, equal-answer role ambiguity at N=2, positive/negative/fractional GP ratios, GP ratio 1 and ratio 0, and renamed source sequences. Examples: AP (-7,-2,N=6) gives term -17 and sum -72; AP (-3/2,1/4,N=8) gives term 1/4 and sum -5; GP (3,2,N=5) gives term 48 and sum 93; GP (-2,-3,N=4) gives term 54 and sum 40; GP (8,1/2,N=4) gives term 1 and sum 15.

Negatives include wrong-role ASTs (including wrong AP roles with the same numeric answer), answer-only constants, foreign compensated operands, answer substituted for source term, canceled foreign/source-looking extras, single GP sign reversal, foreign but algebraically equal GP model operands, same-at-zero wrong AP model, wrong requested evidence, omitted conceptual fact consumption, false/contradictory facts and constraints, clipped arbitrary intent facts, hypothetical/false/uncertain surrounding source, uncertain/stale/empty actual Plans, renamed binding, graph intents, uncovered expressions/constraints/entities/fields, domain beyond 64, and forged labels/required entities/reveal groups/embedded IR/embedded Plan. Forged scenes emit no partial ink through normal compilation.

An authored N=1 holdout exposed the existing compact lifting first-occurrence behavior for a requested term quote also present in the premise. Authored fixtures specify the exact requested occurrence span. The original captured IR is unchanged; modifying the normalizer remains parent-owned.

## Reproducible commands and results

All commands run in this worktree with Node 24.21.0 and pnpm 10.32.0:

```sh
export PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @heytutor/scene-engine... build
pnpm --filter @heytutor/scene-engine typecheck
pnpm --filter @heytutor/scene-engine lint
pnpm --filter @heytutor/scene-engine exec eslint src/ir/finiteProgressionSourceProgram.ts scripts/verify/verify-finite-progression-actual-w3.ts
pnpm --filter @heytutor/scene-engine exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --typeRoots ../tutor-core/node_modules/@types scripts/verify/verify-finite-progression-actual-w3.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-finite-progression-actual-w3.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-finite-progression-actual-w3.ts --esm
git diff --check
```

Frozen install succeeded (666 packages, zero downloads); lockfile unchanged. Drawing and scene-engine ESM/declarations built from this worktree's frozen sources. Workspace dependency links resolve within this worktree, including tutor-core's scene-engine import and scene-engine's drawing import. No other worktree's node_modules/dist/artifacts supplied admission authority.

Build, scene-engine typecheck, targeted standalone gate typecheck and targeted lint passed. Package lint passed with zero errors and four pre-existing unused-variable warnings in DSA simulator files. The new gate initially needed the Node type root for standalone tsc and was corrected to use the real compiler result API and polyline/axes primitive kinds. Final source/ESM outputs:

```
{"mode":"source","checks":407,"actualCapture":"full IR + actual Plan admitted","actualStudentCredit":0}
{"mode":"built ESM","checks":407,"actualCapture":"full IR + actual Plan admitted","actualStudentCredit":0}
```

## Integration limits and next obligations

This fixes bounded full-actual-IR admission offline. No new live student run, narration/work-area inspection, authenticated save/reopen or whole replay was performed. The original fresh run remains a real text-only failure; these offline checks do not replace that evidence.

Parent must integrate/rebuild and rerun the preserved original question through the actual planner/live selection path, then inspect teaching/reveal and affected persistence/replay. Existing general-English, symbolic, infinite-series, native/holdout coverage and recovery/insertion/cumulative lifecycle variants remain outside this repair's checked scope. Full-source rejection remains required for unsupported obligations.

No topic is READY or accepted from this work. Counters and ledgers remain unchanged. Publication is a local user-authored commit only; no push or merge.
