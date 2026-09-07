# Architecture

HeyTutor has two coordinated streams with one authority boundary: a verified
diagram stream and a narrated work stream.

Map: [start.md](../../start.md) · [architecture.excalidraw](../../architecture.excalidraw)

## Turn Flow

```text
question
  -> TurnPlanV3 (quantities, claims, laws, visualRequirement)
  -> ProblemIR/v1 + SolverResult/v1 (source-grounded numeric authority)
  -> scene-document/v2 candidates + reusable constraint compilers
  -> deterministic validation, proof checks, repair, compile, label layout
  -> exact_verified | qualitative_verified | question_representation
  -> atomic VerifiedDiagram commit
  -> trusted reveal commands on Konva

question + TurnPlanV3 + visible diagram context
  -> teaching LLM [STEP] narration + work-area WRITE
  -> incremental parser
  -> TTS and handwriting schedules
```

The teaching model cannot draw, label, annotate, erase, or move diagram ink.
`prepareVerifiedLessonSegments()` removes those commands before queueing, and
`useCommandExecution()` enforces the same ownership again at execution time.
`[FOCUS:entity_id]` may only trace existing verified geometry.

## Main App

| Concern | Path |
|---|---|
| Turn planning and commit | `apps/tutor/features/tutor-session/hooks/turn/useQuestionHandler.ts` |
| Speech/draw scheduling | `apps/tutor/features/tutor-session/hooks/turn/useSegmentRunner.ts` |
| Command execution guard | `apps/tutor/features/tutor-session/hooks/useCommandExecution.ts` |
| Verified presentation | `apps/tutor/features/tutor-session/lib/scene/verifiedScenePresentation.ts` |
| Representation fallback | `apps/tutor/features/tutor-session/lib/scene/representationFallback.ts` |
| Scene recovery | `apps/tutor/features/tutor-session/lib/scene/verifiedSceneRecovery.ts` |
| Replay | `apps/tutor/features/tutor-session/hooks/useReplay.ts` |
| Student marking (Mark & Ask) | `apps/tutor/features/tutor-session/lib/board/boardMarking.ts` |
| Persistence trust boundary | `apps/tutor/lib/scene/turnScenePersistence.ts` |
| Persistence API | `apps/tutor/app/api/boards/[boardId]/turns/route.ts` |
| Planner/chat proxy | `apps/tutor/app/api/chat/route.ts` |

## Packages

```text
scene-engine          semantic contracts, validation, proofs, layout, compile
drawing               generic command protocol, filtering, paths, animation
tutor-core            planners, teaching stream, TTS, audio synchronization
whiteboard            Konva renderer
design-tokens         shared visual constants
```

## Student marking

A third substance exists on the board, owned by neither stream: the student's
own marker. `useBoardMarking` + `BoardMarkingLayer` draw it on a plain 2D canvas
laid over the Konva stage, so it cannot reach a draw layer, a snapshot, the
notes PDF, the MP4 export, or a persisted turn.

A stroke is grounded deterministically, not by a screenshot or a vision model.
`collectMarkCandidates()` reads the exact text of every board row from
`BoardLayoutState.rects` and every figure part from `VerifiedDiagram.anchors`,
and `resolveMarkTarget()` picks the one the stroke is actually on. The doubt
prompt then quotes that text verbatim and names the entity id.

A stroke that lands on nothing resolves to a *region*, which may name only where
it is — never what it is on. The same rule as the diagram engine: a wrong
reading is worse than no reading. Gate:
`apps/tutor/scripts/verify/verify-board-marking.ts`.

## Persistence

Before write, the server revalidates the turn plan, recompiles the accepted
scene, rebuilds non-metric fallbacks when needed, recomputes supported solver
results, and accepts trusted command envelopes only when they exactly match the
fresh server presentation. A turn stores narration segments plus verified-scene
artifacts when present: turn plan, candidates, accepted scene document, engine
version, validation report, and visual status.

Historical `visualStatus: "legacy"` is a read-compatibility value only. New
legacy turns normalize to text-only.

## Failure Rules

- Invalid or partial candidates never render.
- A required visual whose exact candidate fails becomes a separately compiled,
  non-metric source representation before narration starts when operators can
  express meaningful structure; otherwise `retry_required`.
- Optional visuals may teach text-only.
- Fallbacks never render question tokens, fact cards, or derived claims as boxes.
- Planner recovery must pass the same validators as a fresh scene.
- New visual capability is implemented as reusable operators/assertions, never
  as a topic template, regex router, or fixed-pixel plugin.

See [geometry-debug.md](geometry-debug.md),
[../architecture/universal-illustration-engine-v4.md](../architecture/universal-illustration-engine-v4.md),
and [../architecture/diagram-accuracy-architecture.md](../architecture/diagram-accuracy-architecture.md).
