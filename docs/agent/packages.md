# Shared Packages

All packages live in `packages/`, build with tsup, and are consumed through
workspace dependencies. Public imports stay the package barrel (`@heytutor/scene-engine`,
and so on). See [layout.md](layout.md) for where new files go.

## `@heytutor/scene-engine`

The only structural diagram authority.

| Concern | File |
|---|---|
| Scene contracts | `src/contracts/contractsV3.ts`, `src/types.ts` |
| Universal problem and solver contracts | `src/ir/problemIR.ts`, `src/ir/solver.ts` |
| Solver authority binding | `src/ir/solverAuthority.ts` |
| Safe remote solver boundary | `src/ir/remoteSolver.ts` |
| Expression evaluation | `src/math/expression.ts` |
| Validation and compile | `src/document/validation.ts`, `src/compile/compiler.ts` |
| Topology proofs | `src/topology/topology.ts` |
| Optics / reflection laws | `src/physics/opticsLaws.ts` |
| Label placement | `src/labels/labelEngine.ts` |
| Capability manifest | `src/capability/capabilityManifest.ts` |
| Golden corpus | `scripts/verify/verify-golden-corpus.ts` |
| Capability corpora | `scripts/verify/verify-physics-evaluation-corpus.ts`, `scripts/verify/verify-math-evaluation-corpus.ts` |
| Compile oracles | `scripts/probes/evaluationCompileProbes.ts`, `scripts/verify/verify-evaluation-compile.ts` |
| Syllabus capability corpus | `scripts/verify/verify-syllabus-corpus.ts` (Tier A name-check over the local question bank + Tier A+ per-unit compile-and-prove) |

The package consumes coordinate-free semantic documents and emits validated
screen-space render primitives. It contains reusable operators and assertions,
not syllabus-topic plugins.

## `@heytutor/drawing`

Generic whiteboard transport and animation utilities.

| Concern | File |
|---|---|
| Command protocol and persistence envelopes | `src/protocol/drawingProtocol.ts` |
| Streaming tag parser | `src/protocol/incrementalParser.ts` |
| Step segmentation | `src/layout/lessonPlanner.ts` |
| Verified diagram transport | `src/protocol/verifiedDiagram.ts` |
| Teaching command ownership | `src/protocol/commandPlacement.ts` |
| Shape and handwriting paths | `src/handwriting/shapePaths.ts`, `src/handwriting/handwriting.ts` |
| Board zones | `src/layout/boardZones.ts` |
| Stroke/cursor animation | `src/animation/strokeAnimation.ts`, `src/animation/cursorAnimation.ts` |

This package no longer contains topic templates, a geometry compiler, domain
plugins, or endpoint snapping.

## `@heytutor/tutor-core`

Planning transport, teaching model, TTS, and audio synchronization.

| Concern | File |
|---|---|
| Turn plan | `src/planners/turnPlannerV3.ts` |
| Problem IR planner | `src/planners/problemPlannerV1.ts` |
| Scene-document planner and repair | `src/planners/scenePlannerV2.ts`, `src/planners/scenePlannerV2Prompt.ts` |
| Scene capability catalog | `src/planners/sceneCapabilities.ts` |
| Teaching prompt | `src/llm/systemPrompt.ts` |
| LLM stream | `src/llm/llmAPI.ts` |
| Audio sync | `src/sync/audioSync.ts` |
| TTS | `src/tts/createTTSClient.ts`, `src/tts/elevenLabsClient.ts`, `src/tts/elevenLabsWebSocketClient.ts` |

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
