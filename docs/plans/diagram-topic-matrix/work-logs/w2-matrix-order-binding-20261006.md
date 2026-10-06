# W2 matrix order binding fix — 6 October 2026

Scope: F4 only, in `/Users/kaizen/heytutor-cov-wt/w2-matrix-binding-fix-20261006`, branch `cov/w2-matrix-binding-fix-20261006`, based on `a8a1e9c6d3963264a24cb139035a3f5394d00434`.

Implementation and independent gate commit: `62c8656af0b84671bca592e81e72632de4bcbdcd` (`fix(scene-engine): preserve matrix order binding evidence`), authored by Rishi Vhavle without co-authors.

Changed paths:

- `packages/scene-engine/src/ir/matrixLiteralSource.ts`
- `packages/scene-engine/scripts/verify/verify-w2-matrix-order-binding.ts`
- `docs/plans/diagram-topic-matrix/work-logs/w2-matrix-order-binding-20261006.md` (this evidence log)

Preparation now accepts an absent order binding, a unitless `order`/`order` tuple binding tied to requested source order evidence and the plan's actual `order` unknown, or a unitless binding to the matching row/column component. Tuple evidence is carried to both scalar requests. A compatible existing per-axis binding and its evidence are retained. Wrong-axis, unrelated-target, unit-bearing, given-fact, duplicate, and cross-role bindings decline before a prepared authority is returned. Cell bindings must also name their matching cell quantity. Full IR preparation continues on a structured snapshot; the captured facts, entities, expressions, intents, and constraints are retained.

The new independent gate exercises the four exact F4 review negatives, mismatched alias/cross-role and duplicate bindings, compatible tuple and axis positives, preservation of source evidence, caller-input immutability, the complete 20-entity captured IR, and deterministic solving plus `verifyTurnPlanAgainstSolver` for `[3, 19, 35, -5, 12, 2.5, 4]`.

Environment: frozen `pnpm install --frozen-lockfile --ignore-scripts`; Node `v24.21.0`; pnpm `10.32.0`; PATH prefixed with `/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin`.

Checks completed successfully:

- `pnpm --filter @heytutor/drawing build`
- `pnpm --filter @heytutor/scene-engine build`
- `pnpm --filter @heytutor/scene-engine typecheck`
- `pnpm --filter @heytutor/scene-engine lint` — 0 errors, 4 existing unused-variable warnings in DSA trace simulators.
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-matrix-order-binding.ts`
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-section-matrix.ts`
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-matrix-source-binding-hey88.ts` — 440 checks.
- `git diff --check`

Limits: these are offline source/solver gates. The full scene-engine suite, tutor/core integration and normal student turn, parent hook/compiler wiring, restore/replay, rendered board, narration/WRITE, providers, database, topic readiness/counts, and the parent-owned independent review were not run or claimed. No parent glue, shared obligation code, old tests, readiness artifacts, or counts were changed. No remote, publish, main-tree, server, browser, database, stash, or provider/key activity was performed.
