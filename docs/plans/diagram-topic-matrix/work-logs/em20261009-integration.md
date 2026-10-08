# EM five-chapter integration and acceptance log — 2026-10-09

## Ownership announcement

Announced before this continuation's first edit to any shared seam.

- Integration owner: current Codex parent session (`/root`).
- Worktree: `/Users/kaizen/heytutor-cov-wt/em-five-20261007`
- Branch: `cov/em-five-chapters-20261007`
- Starting HEAD: `834cbd6ad9dea29e5151da6314459be0104b91eb`
- Source profile: `2026-10-02-topic-matrix-v1`; frozen JEE Main Paper 1 / JEE Advanced / NEET 2026 contract.
- Evidence root: `.context/em-five-acceptance-20261009-v1/`
- Publication: uncommitted; no push, PR, merge, or auto-merge.

The integration owner alone may edit these shared paths in this continuation:

- `packages/scene-engine/src/physics/em20261007/admission.ts`
- `packages/scene-engine/src/physics/em20261007/registerAdmission.ts`
- `packages/scene-engine/src/ir/**`
- `packages/scene-engine/src/compile/compiler.ts`
- `packages/scene-engine/src/synthesize/**`
- `packages/scene-engine/src/document/**`
- `packages/scene-engine/src/capability/**`
- `packages/scene-engine/scripts/lib/renderSceneSvg.ts`
- new integration-owned gates under `packages/scene-engine/scripts/verify/em20261007/`
- `packages/drawing/src/protocol/**`
- `apps/tutor/features/tutor-session/lib/scene/verifiedScenePresentation.ts`
- `apps/tutor/features/tutor-session/hooks/useCommandExecution.ts`
- production persistence/replay seams under `apps/tutor/lib/scene/**` and `apps/tutor/features/tutor-session/lib/replay/**`
- `docs/plans/diagram-topic-matrix/topic-progress.csv`
- `docs/plans/diagram-topic-matrix/progress.md`
- root accepted counters in `DIAGRAM_ENGINE_COVERAGE_PLAN.md`

Workers own only the explicitly assigned agent modules, their dedicated gates,
and their new packet logs. Workers must return proposed shared changes instead
of editing the paths above.

## Baseline reproduction

- Copied the round-05 probes byte-for-byte into `.context/em-five-acceptance-20261009-v1/before/`.
- `packages/scene-engine ./node_modules/.bin/tsx .../before/probe-current.mts`: exit 1; ordinary control PASS; swapped role/value/unit FAIL; explicitly unbalanced premise FAIL; geometry controls PASS.
- `apps/tutor ./node_modules/.bin/tsx .../before/probe-presentation.mts`: exit 0 and reproduced the defect detector; the B centre dot is transported as `fillRole: region` while the exporter renders opaque ink.
- No audio was played and no provider was called.

## Row contract

`.context/em-five-acceptance-20261009-v1/row-obligation-checklist.{json,md}` contains all 86 unique rows with source refs, exam scopes, required variants, independent acceptance tests, dependencies, current ledger state, and current remaining obligations. Validated counts: 17 / 24 / 23 / 14 / 8.

## Acceptance disposition

Pending. No topic row or chapter counter may be changed until all frozen
obligations, shared checks, render review, student runtime, persistence/replay,
and independent Claude review pass.
