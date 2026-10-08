# Ownership announcement — em-five batch 2026-10-07

Announced before the first edit of this batch.

Integration owner: this session.
Integration worktree: /Users/kaizen/heytutor-cov-wt/em-five-20261007
Branch: cov/em-five-chapters-20261007
Base HEAD: 834cbd6ad9dea29e5151da6314459be0104b91eb
Checked runtime/source parent: 84144809ba28b34ddb81d7305c4c822b5abdb612 (documentation-only child is the base HEAD)
Baseline preserved: /Users/kaizen/heytutor-cov-wt/w2-integration-20261006
Protected checkout not touched: /Users/kaizen/heytutor

## Announced shared seams

This session will edit, after this announcement:

- packages/scene-engine/src/synthesize/**
- packages/scene-engine/src/document/**
- packages/scene-engine/src/capability/**
- packages/scene-engine/scripts/verify/** (new gates only under scripts/verify/em20261007/; existing verify scripts stay unchanged)
- packages/scene-engine/src/compile/compiler.ts
- packages/scene-engine/src/compile/outputLabels.ts
- packages/scene-engine/src/ir/problemIR.ts
- packages/scene-engine/src/ir/solver.ts
- packages/scene-engine/src/ir/solverAuthority.ts
- packages/tutor-core/src/planners/sceneCapabilities.ts
- packages/tutor-core/src/planners/scenePlannerV2Prompt.ts
- apps/tutor presentation and persistence seams only if a shared consumer requires them
- docs/plans/diagram-topic-matrix/topic-progress.csv (integration owner only)

Workers must not edit those paths. Workers may import them.

## Worker-owned new paths

- packages/scene-engine/src/physics/em20261007/agent1-current-laws.ts through agent8, one module each
- packages/scene-engine/scripts/verify/em20261007/verify-agentN-*.ts
- docs/plans/diagram-topic-matrix/work-logs/em20261007-agentN.md

No other session's verify gate is modified.
