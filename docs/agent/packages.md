# Shared Packages

All packages live in `packages/`, build with tsup, and are consumed through
workspace dependencies.

## `@heytutor/scene-engine`

The only structural diagram authority.

| Concern | File |
|---|---|
| Scene contracts | `src/contractsV3.ts`, `src/types.ts` |
| Universal problem and solver contracts | `src/problemIR.ts`, `src/solver.ts` |
| Solver authority binding | `src/solverAuthority.ts` |
| Safe remote solver boundary | `src/remoteSolver.ts` |
| Expression evaluation | `src/expression.ts` |
| Validation and compile | `src/validation.ts`, `src/compiler.ts` |
| Topology proofs | `src/topology.ts` |
| Optics / reflection laws | `src/opticsLaws.ts` |
| Label placement | `src/labelEngine.ts` |
| Golden corpus | `scripts/verify-golden-corpus.ts` |
| Capability corpora | `scripts/verify-physics-evaluation-corpus.ts`, `scripts/verify-math-evaluation-corpus.ts` |
| Syllabus capability corpus | `scripts/verify-syllabus-corpus.ts` (Tier A name-check over the local question bank + Tier A+ per-unit compile-and-prove) |

The package consumes coordinate-free semantic documents and emits validated
screen-space render primitives. It contains reusable operators and assertions,
not syllabus-topic plugins.

## `@heytutor/drawing`

Generic whiteboard transport and animation utilities.

| Concern | File |
|---|---|
| Command protocol and persistence envelopes | `src/drawingProtocol.ts` |
| Streaming tag parser | `src/incrementalParser.ts` |
| Step segmentation | `src/lessonPlanner.ts` |
| Verified diagram transport | `src/verifiedDiagram.ts` |
| Teaching command ownership | `src/commandPlacement.ts` |
| Shape and handwriting paths | `src/shapePaths.ts`, `src/handwriting.ts` |
| Board zones | `src/boardZones.ts` |
| Stroke/cursor animation | `src/strokeAnimation.ts`, `src/cursorAnimation.ts` |

This package no longer contains topic templates, a geometry compiler, domain
plugins, or endpoint snapping.

## `@heytutor/tutor-core`

Planning transport, teaching model, TTS, and audio synchronization.

| Concern | File |
|---|---|
| Turn plan | `src/turnPlannerV3.ts` |
| Problem IR planner | `src/problemPlannerV1.ts` |
| Scene-document planner and repair | `src/scenePlannerV2.ts`, `src/scenePlannerV2Prompt.ts` |
| Scene capability catalog | `src/sceneCapabilities.ts` |
| Teaching prompt | `src/systemPrompt.ts` |
| LLM stream | `src/llmAPI.ts` |
| Audio sync | `src/audioSync.ts` |
| TTS | `src/createTTSClient.ts`, `src/elevenLabsClient.ts`, `src/elevenLabsWebSocketClient.ts` |

The teaching prompt is domain-neutral and cannot author diagram ink.

## `@heytutor/whiteboard`

Konva rendering and imperative draw/write APIs. It renders trusted commands but
does not decide diagram semantics.

## Verification

```bash
pnpm --filter @heytutor/scene-engine verify
pnpm --filter @heytutor/tutor-core verify
pnpm --filter @heytutor/whiteboard verify
pnpm --filter @heytutor/tutor verify
pnpm typecheck
pnpm lint
pnpm build
```
