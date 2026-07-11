# Geometry Engine Debug Playbook

Diagrams come from **SceneSpec → Geometry Compiler**, not from LLM pixel guessing. Regex templates are fixtures / last-resort fallback only.

Related: [optics-debug.md](optics-debug.md) for Ray Optics precision-builder details still used by the optics plugin.

## Quick path

1. Open the Langfuse turn by `traceId`.
2. Read planner span metadata: `source`, `kind`, `plugin`, `residual`, `command_count`, `template_compare_id`, `degrade_reason`.
3. Look for `geometry-compile` event.
4. For optics, also follow [optics-debug.md](optics-debug.md) (`optics-intro-built`, snaps, ray draws).

## Event → failure mode

| Symptom | Look at | Means |
|---|---|---|
| No diagram / narration-only | `degrade_reason`, `geometry-compile.ok` | Scene missing or compile failed |
| Wrong domain (circuit for optics) | `kind` / `plugin` | Autoformalizer or `inferSceneFromQuestion` mis-route |
| Soft geometry / drifted points | `residual` | Constraint solver did not converge; check SceneSpec constraints |
| Optics quality regression | `plugin=optics` + optics events | Precision builder / classify path |
| Template used instead of compiler | `source=template` | Compile failed; regex fallback engaged |
| LLM redrew skeleton | `template-draw-blocked` | Guard working; check `allowLlmDrawInDiagramZone` |

## Happy path

```
planScene / inferSceneFromQuestion
  → geometry-compile (ok, plugin, residual)
  → intro segments (templateIntro)
  → teaching stream with named anchors
```

## Key files

| Concern | File |
|---|---|
| Scene IR | `packages/drawing/src/geometry/sceneSpec.ts` |
| Compiler | `packages/drawing/src/geometry/compileScene.ts` |
| Plugins | `packages/drawing/src/geometry/plugins/` |
| Local infer | `packages/drawing/src/geometry/inferScene.ts` |
| Planner HTTP | `packages/tutor-core/src/scenePlanner.ts` |
| Turn wiring | `apps/tutor/.../useQuestionHandler.ts` |

## Verify

```bash
pnpm --filter @heytutor/drawing exec tsx scripts/verify-geometry-compiler.ts
pnpm --filter @heytutor/tutor-core verify
```
