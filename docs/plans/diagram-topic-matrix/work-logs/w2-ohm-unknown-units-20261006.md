# W2 Ohm unknown dimension and owner binding — 6 October 2026

Disposition: **bounded B2 correction complete; integration_pending; READY 0 / newly accepted 0 / FULLY-CERTIFIED 0.** This closes only finding B2 in the independent Ohm corrections acceptance review. No ledger or accepted count changed.

## Assignment and baseline

- Topic: `physics|12|ohms-law-and-resistance`, bounded strict-authority correction.
- Tree: `/Users/kaizen/heytutor-cov-wt/w2-ohm-unknown-units-20261006`; branch `cov/w2-ohm-unknown-units-20261006`.
- Base: `f741829c66824169bc61c0d0661f57060b63e7de`.
- Review finding: B2 only, `/Users/kaizen/heytutor-claude-coord/reviews/w2-ohm-corrections-acceptance-20261006.md`.
- Read the repository instructions, coverage plan, topic matrix index/progress/readiness, continuation, and prior Ohm correction work log before editing.
- Dependencies installed from the frozen lockfile with scripts disabled and offline. Commands used Node `v24.21.0` and pnpm `10.32.0`.

## Change

In strict `requireBoundClaims` mode, each explicit unknown sharing an ID with a derived row now has to declare that row's dimension. A known symbol is resolved in the unknown's own dimension and must share the derived result's physical owner. Conflicting rows, unknowns, and linked qualitative claims are removed before independent circuit additions. Incompatible unknown IDs are tracked through cleanup so an unsupported unit cannot survive via the legacy unknown-unit fallback. An absent unit inherits the matched derived dimension. An unbound alias such as `ghost` remains compatible when that ID's actual source request and validated dependencies establish the answer owner. Default legacy authority policy is unchanged.

The added gate has four negatives (voltage dimension, leaf resistance owner, unsupported unit, and wrong known current symbol) and two positives (request-bound alias and absent unit). It checks withdrawal of `Itot`, its unknown and linked `c3`, preservation of `Rs=6`, `Req=2`, and both positive output plans.

## Evidence and commands

The acceptance `supplemental.mts` was copied to `/tmp/w2-ohm-unknown-binding-review/` and its import/fixture roots were adapted to this owned tree. The pinned review implementation was not executed as product evidence. Its two B2 witnesses each passed against this tree; the retained ghost-alias and reverse-row-order controls also passed.

All commands below ran from this tree with the supplied Node 24 PATH prefix:

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts --offline` | PASS; 666 packages reused from local store. |
| `pnpm --filter @heytutor/drawing build` | PASS. |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-ohm-unknown-binding.ts` | PASS; 6 focused controls. |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-ohm-corrections.ts` | PASS; original 13 review reproductions retained in the 73-check gate. |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-ohm-fullir.ts` | PASS; existing 60 checks. |
| Adapted review `supplemental.mts unknown-dimension-conflict` | PASS; contradictory `Itot`, unknown, and `c3` withdrawn. |
| Adapted review `supplemental.mts unknown-cross-class-owner` | PASS; contradictory `Itot`, unknown, and `c3` withdrawn. |
| Adapted review `supplemental.mts unknown-unbound-symbol` | PASS; request-bound `ghost` retained. |
| Adapted review `supplemental.mts row-order-reversed` | PASS; valid transitive rows retained. |
| `pnpm --filter @heytutor/scene-engine typecheck` | PASS. |
| `pnpm --filter @heytutor/scene-engine lint` | PASS; zero errors and the inherited four DSA unused-variable warnings. |
| `pnpm --filter @heytutor/scene-engine build` | PASS; ESM and declarations. |
| `git diff --check` | PASS. |

The captured valid plan still yields `Rs=6 Ω`, `Req=2 Ω`, and `Itot=3 A`; the positive unknown variants retain all three rows and claims. Invalid unknown declarations remove `Itot`, its linked unknown, and claim `c3`; the engine's independent source-current addition remains separately identified as `circuit_I`.

## Scope and remaining work

Only these three files are owned by this change: `packages/scene-engine/src/ir/statedCircuitAuthority.ts`, `packages/scene-engine/scripts/verify/verify-w2-ohm-unknown-binding.ts`, and this work log. The parent-owned multiplicity fix in `statedCircuitSemantics.ts` was not edited. No legacy default-mode policy, other topic rows, shared counts, student render, lifecycle, or deployment was changed or claimed. Parent integration and independent acceptance remain pending; READY stays **0**.
