# W2 matrix strict completeness correction — 6 October 2026

## Assignment and source contract

- Worker: Rishi Vhavle. Integration owner: parent/coordinator.
- Worktree: `/Users/kaizen/heytutor-cov-wt/w2-matrix-completeness-fix-20261006`.
- Base: `c891f7427025b4c58d00d8e3d0c7cfa456a905e3`.
- Scope: reproduced strict matrix-plan completeness P2 in `matrixProductSourceAuthority.ts`, with this worktree's dedicated gate, mutation fixture and evidence log.
- Review source: `/Users/kaizen/heytutor-cov-wt/w2-matrix-products-final-review-20261006/coordinator/reviews/w2-matrix-products-final-20261006/REPORT.md` and its `repros/finding.mjs`, source and ESM receipts.
- Isolation: protected dirty `/Users/kaizen/heytutor` was not edited or switched. Dependencies were installed from this worktree's frozen lockfile; drawing, scene-engine and authority sidecar artifacts were built here. No copied `dist`, environment or provider artifacts; no agents, forks, database or remote access.

## Changes and checks

- `matrixProductSourcePlanIssues` now requires exactly one numeric given for every source matrix input cell, checks the supplied value against the exact parsed source literal, and rejects missing or duplicate cell identities. Existing audited zero-placeholder withdrawal remains unchanged; it still replaces only eligible placeholders with source-cell givens and preserves the original caller IR.
- Every derived product cell now requires the complete unique dependency set from its row/column dot product. Repeated input-cell IDs are deduplicated when forming that expected set. Missing, empty, partial, substituted and duplicate dependency lists decline; the strict seam does not reconstruct omitted evidence.
- New gate `verify-matrix-product-strict-completeness.ts` uses the immutable actual capture for strict negatives and all-seams preservation controls, and an independently authored `AA` one-cell plan for a positive deduplication case. Mutation fixture: `fixtures/matrix-product-strict-completeness.json`.
- RED reproduction before the implementation change: the source gate failed because a missing `dependsOn` list passed `matrixProductSourcePlanIssues`.
- Source gate: `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-matrix-product-strict-completeness.ts` — 26 checks passed.
- Own built ESM gate: `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-matrix-product-strict-completeness.ts dist/matrix-product-sidecar/matrixProductSourceAuthority.js` — 26 checks passed.
- Actual and independent matrix controls: `verify-matrix-products-live-20261006.ts` — source 348 checks passed; built ESM with `--check-capture` 353 checks passed.
- Module regressions: `verify-matrix-array-operators.ts` — 9,270 checks passed; `verify-matrix-source-binding-hey88.ts` — 440 checks passed.
- `pnpm install --frozen-lockfile` — passed with Node `v24.21.0`, pnpm `10.32.0`.
- `pnpm --filter @heytutor/drawing build` and `pnpm --filter @heytutor/scene-engine build` — passed; authority sidecar `tsup src/ir/matrixProductSourceAuthority.ts --format esm --dts --out-dir dist/matrix-product-sidecar` — passed.
- `pnpm --filter @heytutor/scene-engine typecheck` — passed after building the local drawing dependency.
- `pnpm --filter @heytutor/scene-engine lint` — 0 errors, 4 existing warnings in unrelated DSA simulator files.
- Readiness, topic ledger, accepted counters, and parent integration hooks were not changed. This module fix gives no readiness or certification credit.

## Per-topic outcome

| Exact topic ID | Variants checked | Tier | Proposed state | Evidence | Remaining obligations |
| --- | --- | --- | --- | --- | --- |
| `maths\|3\|matrices-and-types` | Actual captured AB/BA complete corrected plan; empty/missing/duplicate/wrong-valued givens; missing/empty/subset/duplicate/substituted dependencies; independently authored repeated-operand cell dependency | Offline source-authority module only | `integration_pending` | This log; dedicated source/ESM gate; matrix actual-products gate | Parent review/integration of the correction policy and central hooks; live student render/reveal and affected save/reopen/replay; all frozen variants, native full-stem/options and holdouts |

## Handoff

- Strict plan admission now refuses incomplete source numeric and dependency witnesses, while the actual captured zero-placeholder path remains accepted only through its existing audited correction.
- Parent action: independently review this module diff and its early withdrawal policy before integrating the source/plan/IR/document guard into shared hooks.
- No topic readiness, full certification, accepted state, count or publication is claimed.
