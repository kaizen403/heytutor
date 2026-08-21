# Verified Scene Debug Playbook

## Trace Order

1. Open the Langfuse turn by `traceId`.
2. Inspect `TurnPlanV3`: exact quantities, claims, laws, assumptions, and
   `visualRequirement`.
3. Inspect candidate spans and structured validation issue codes.
4. Inspect the accepted scene artifact, compiler counts, and render primitives.
5. Inspect `verified-scene-intro-queued` and `unverified-draw-blocked` events.
6. Confirm narration starts only after a `validated` commit.

## Common Failures

| Symptom | Evidence | Likely boundary |
|---|---|---|
| Conceptual fallback instead of exact diagram | `scene_representation_tier` is not `exact_verified` | Planner transport, unsupported operator, or fatal exact-scene validation |
| No required diagram | `visual_status=retry_required` | Exact and source representations both failed; treat as an invariant bug |
| Wrong value or sign | quantity agreement / turn-plan proof issue | Turn plan or scene candidate |
| Wrong connection | topology assertion issue | Scene endpoints or construction graph |
| Missing object | required-render issue | Scene entity or compiler primitive coverage |
| Labels collide | label placement issue | Screen-space label engine |
| Speech stops after bad draw tag | segment filtering counters | Teaching filter or queue; narration should be retained |
| Diagram is overwritten | `unverified-draw-blocked` absent | Verified diagram ownership guard |

## Key Files

| Concern | File |
|---|---|
| Contracts | `packages/scene-engine/src/contracts/contractsV3.ts`, `types.ts` |
| Problem and solver proofs | `packages/scene-engine/src/ir/problemIR.ts`, `src/ir/solver.ts`, `src/ir/solverAuthority.ts`, `src/ir/remoteSolver.ts` |
| Validation/compiler | `packages/scene-engine/src/document/validation.ts`, `src/compile/compiler.ts` |
| Topology | `packages/scene-engine/src/topology/topology.ts` |
| Labels | `packages/scene-engine/src/labels/labelEngine.ts` |
| Planner transport | `packages/tutor-core/src/planners/scenePlannerV2.ts`, `apps/tutor/lib/llm/plannerTransport.ts` |
| Presentation / fallback | `apps/tutor/features/tutor-session/lib/verifiedScenePresentation.ts`, `representationFallbackV4.ts` |
| Persistence trust | `apps/tutor/lib/scene/turnScenePersistence.ts` |
| Turn wiring | `apps/tutor/features/tutor-session/hooks/turn/useQuestionHandler.ts` |
| Command ownership | `packages/drawing/src/protocol/commandPlacement.ts` |

## Verify

```bash
pnpm --filter @heytutor/scene-engine verify
pnpm --filter @heytutor/tutor-core verify
pnpm --filter @heytutor/tutor verify
```
