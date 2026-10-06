# Signed numeric literal measurement source repair — 2026-10-06

Disposition: implementation and offline authority proof complete; live lifecycle, persistence, and replay remain with the integration owner. This is a bounded source-authority fix, not a syllabus topic packet. No topic ledger or accepted-count changes were made.

## Frozen case and change

Base: `7e92167c77841ad0e1132919ed7f21f48ace84e1`, in `/Users/kaizen/heytutor-cov-wt/w3-count-signed-literal-fix-20261006`.

The reviewed capture is `/Users/kaizen/heytutor-claude-coord/runtime/runs/2026-10-06T0915-w2-3aad03bd`. Its source-rejection payload contains raw expression `((2.675+(-0.02))-2.5)/0.005`, a full raw Plan whose claimed count is 31, and `expression_source_lineage_incomplete`. The frozen fixture contains only the raw rejected IR, full Plan, rejection code, and its parsed full ProblemIR form; it does not copy the receipt or credentials. Fixture SHA-256: `fc82bc9c22360fd5baf1ca22ffed6d42b3a1f0bd3ef4c6fa3f4d4550c3f3aaab`.

`expressionRole` now recognizes exactly one unary `+` or `-` over a numeric leaf as a signed numeric atom. It does not admit nested unary arithmetic, simplify ASTs, or match by computed value alone. Whole-caller snapshots, closed-field checks, premise joins, and the original AST/Plan remain in force.

Changed files:

- `packages/scene-engine/src/ir/measurementSourceAuthority.ts`
- `packages/scene-engine/scripts/verify/verify-signed-measurement-source-actual.ts`
- `packages/scene-engine/scripts/verify/fixtures/w3-signed-measurement-source-actual/captured-input.json`
- `docs/plans/diagram-topic-matrix/work-logs/w3-count-signed-literal-fix-20261006.md`

## Independent proof cases

The new verifier reaches `verifyMeasurementSourceAuthority` through the source `src/index.ts` and built `dist/index.js` ESM APIs. It proves the captured negative error returns 31, a positive error returns 39, zero error at the sleeve boundary returns 0, and a negative error crossing below the 3.0 mm sleeve mark returns 99. These expected counts are fixed independent literals.

Nine controls decline: wrong sign, answer-only constant, cancelling operands, nested sign, unsupported instrument label, extra ProblemIR field, extra Plan field, own accessor, and inherited Plan data. The actual and independent positive cases also assert full structural IR preservation and caller non-mutation.

## Commands and results

Build, typecheck, lint, and final proof commands ran with Node `v24.18.0`, pnpm `10.32.0`; dependency installation was frozen and offline.

- `pnpm install --offline --frozen-lockfile` — passed; initial population reused 666 cached packages, Node 24 rerun was already up to date, none downloaded.
- `pnpm --filter @heytutor/drawing build` — passed.
- `pnpm --filter @heytutor/scene-engine build` — passed (ESM and declarations).
- `pnpm --filter @heytutor/scene-engine typecheck` — passed.
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-signed-measurement-source-actual.ts` — passed (source API; 1 capture + 3 independent cases + 9 refusal/guard controls).
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-signed-measurement-source-actual.ts --built` — passed (built ESM API; same cases).
- `pnpm --filter @heytutor/scene-engine exec eslint src/ir/measurementSourceAuthority.ts scripts/verify/verify-signed-measurement-source-actual.ts` — passed.
- `git diff --check` — passed.

Existing `verify-w3-measurements-hardening.ts` produced 59/69 checks; its ten successful-case failures are `assert.strictEqual(result.problem, callerProblem)` identity expectations. Existing `verify-w3-measurement-review-fixes.ts` stops on the same reference-identity expectation for a declined snapshot. The base implementation already snapshots source data to frozen null-prototype records (`snapshotMathSourceData` and `validateProblemIR`); this patch changes only the literal predicate, and neither existing gate was edited. Their adversarial negative controls that ran before the hardening summary passed. These baseline gate failures are not represented as passing checks.

No live app, hook, teaching, replay, persistence, database, or receipt rerun was performed. The original reviewed run remains semantically failed (manual teaching ended at 39); this engine fix supplies a passing source-authority proof for its raw input, while parent-owned lifecycle integration remains outstanding. No READY state or ledger action is implied.
