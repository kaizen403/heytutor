# W3 AP duplicate-premise repair / 2026-10-06

## Assignment and source contract

- Worker: Codex; integration owner: pending.
- Worktree/base: `/Users/kaizen/heytutor-cov-wt/w3-ap-duplicate-fix-20261006`, base `7e92167c77841ad0e1132919ed7f21f48ace84e1`.
- This is a bounded verification-regression repair, not a topic-coverage assignment. It changes no accepted topic count and earns no student, lifecycle, or diagram-READY credit.
- Authorized files: `packages/scene-engine/src/ir/finiteProgressionSourceProgram.ts`, the exclusive gate `packages/scene-engine/scripts/verify/verify-w3-ap-duplicate-premise.ts`, and this work log.
- Initial reproduction: a duplicated full actual `fModel` fact under a new ID was accepted by the source program while attached to the actual conceptual intent. The unchanged review-fixes gate reproduced its line-113 intent-padding failure before the repair.

## Changes and checks

- The admission path now rejects duplicate complete asserted given-role sets across fact IDs. The key is the parsed source-role set, not span containment: the actual `fModel` set (model, first, parameter), `fFirst` set (first), and `fDiff` set (parameter) remain distinct and are retained fully.
- The exclusive gate independently tests duplicate copies of `fModel`, `fFirst`, and `fDiff`, each referenced by the conceptual intent. It also requires the untouched captured AP to remain admissible with every IR fact, both Plan quantities, both Plan scalar values, and both computed bindings intact.
- Offline frozen install: `pnpm install --offline --frozen-lockfile --ignore-scripts`, Node 24.21.0, pnpm 10.32.0; no downloads. Built drawing and scene-engine packages from this worktree.
- Source checks: exclusive duplicate gate 18 PASS; actual-capture gate 407 PASS; unchanged review-fixes gate 1,552 PASS.
- Built ESM checks: actual-capture gate 407 PASS; unchanged review-fixes gate 1,552 PASS; exclusive duplicate gate 18 PASS. The exclusive and unchanged gates also pass when launched by native Node ESM against the built engine.
- Package typecheck and targeted ESLint for the source module and exclusive gate pass.
- Actual-capture assertions preserve the fixture verbatim, including `fModel`, `fFirst`, `fDiff`, complete IR/Plan retention, and result values 62 and 670.
- Render/compiler checks remain the offline evidence exercised by the existing 407-check actual-capture gate; no live reveal, persistence, or replay was performed or claimed.

## Per-topic outcomes

No syllabus topic rows were assigned or accepted. Coverage counters remain unchanged. This repair addresses a verification contract regression only.

## Handoff

- Proposed disposition: `verification_pending` until independent integration review.
- Integration owner: inspect the three-file diff and confirm the old failure is repaired without changing the immutable gate or actual capture.
- No shared ledger, counts, runtime/replay work, or protected-main changes are included.
