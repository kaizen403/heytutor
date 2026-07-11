# Geometry Engine Debug Playbook

Diagrams come from **SceneSpec → Geometry Compiler**, not from LLM pixel guessing or live regex template matching.

Regex templates remain as golden fixtures inside domain plugins (optics/circuit/mechanics) and for test verification. `matchDiagramTemplate` is telemetry-only on the turn path.

For Ray Optics precision-builder internals still used by the optics plugin, see [optics-debug.md](optics-debug.md).

## Quick path

1. Open the Langfuse turn by `traceId`.
2. Read planner span metadata: `source`, `kind`, `plugin`, `residual`, `command_count`, `template_compare_id`, `degrade_reason`.
3. Look for `geometry-compile` / planner `source=compiler`.
4. For optics, also follow [optics-debug.md](optics-debug.md) (`optics-intro-built`, snaps, ray draws).

## Event → failure mode

| Symptom | Look at | Means |
|---|---|---|
| No diagram / narration-only | `degrade_reason`, compile `ok`, `source=none` | Scene missing, high residual, or compile failed |
| Wrong domain (circuit for optics) | `kind` / `plugin` | Autoformalizer or `inferSceneFromQuestion` mis-route |
| Soft geometry / drifted points | `residual` | Constraint solver did not converge |
| Optics quality regression | `plugin=optics` + optics events | Precision builder / classify path |
| Template compare id set but source=compiler | `template_compare_id` | Fixture would have matched; compiler owns ink |
| LLM redrew skeleton | `template-draw-blocked` | Guard working; check `allowLlmDrawInDiagramZone` |

## Happy path

```
inferSceneFromQuestion (fast) or planScene (LLM SceneSpec)
  → compileScene (optics/circuit/mechanics/euclidean/axes/generic + repair)
  → intro segments (introPhases when present)
  → teaching stream with named anchors
```

## Key files

| Concern | File |
|---|---|
| Scene IR | `packages/drawing/src/geometry/sceneSpec.ts` |
| Compiler | `packages/drawing/src/geometry/compileScene.ts` |
| Constraint solver | `packages/drawing/src/geometry/solver.ts` |
| Plugins | `packages/drawing/src/geometry/plugins/` |
| Local infer | `packages/drawing/src/geometry/inferScene.ts` |
| Planner HTTP | `packages/tutor-core/src/scenePlanner.ts` |
| Turn wiring | `apps/tutor/.../useQuestionHandler.ts` |

## Verify

```bash
pnpm --filter @heytutor/drawing verify:geometry
pnpm --filter @heytutor/tutor-core verify
```
