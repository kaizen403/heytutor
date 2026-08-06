# Verified Diagram Engine v3

This document records the v3 migration. The active extension architecture is
[Universal Verified Illustration Engine v4](universal-illustration-engine-v4.md).

## Status

The verified-only runtime is implemented. The former regex templates, optics and
circuit precision builders, SceneSpec compiler plugins, pixel architect,
topic-planner hints, and geometry snapping path have been removed.

The active contract is:

`TurnPlanV3 -> SceneDocument -> validation/repair -> RenderScene -> VerifiedDiagram -> whiteboard`

The teaching stream runs beside that pipeline only after scene commit and may
write equations in the work area. It cannot modify the diagram.

## Accuracy Gates

- Exact quantity agreement between the turn plan and scene document.
- Reference, dependency, construction, and required-render validation.
- Executable geometry, topology, root, and function-value assertions.
- Screen-space label placement with overlap rejection.
- Sequential symbolic arithmetic reconciliation with unit-safe variable parsing.
- Source-in-cycle, connector-contracted path/cycle, and vector-sum proofs.
- Coincident semantic aliases render once instead of overwriting the same ink.
- Obstacle-aware connector routing and semantic view-summary placement.
- Atomic scene commit: no candidate or partial scene reaches the board.
- Exact failures fall back to an independently compiled, source-grounded
  non-metric representation before narration starts.
- Trusted geometry is persisted for replay without runtime coordinate repair.
- A static verification prevents reintroducing legacy registry/plugin imports.

Planning uses multiple candidates and structured replacement attempts inside a
60-second hard deadline. Turn-plan generation receives a 28-second bounded
window; forty-five seconds remains the product latency target for the complete
path.
Exact verified-scene recovery can reuse a prior equivalent scene when transport
fails without weakening validation.

Verified scenes are presented as narrated structure, direction, and detail
groups. Semantic focus actions reuse compiled paths with a thin trace stroke;
the teaching model never supplies trace coordinates.

## Next Accuracy Work

1. Expand the golden corpus across geometry, mechanics, electricity, chemistry
   graphs, apparatus, statistics, and multi-branch functions.
2. Add general constraint and law operators only when corpus failures prove a
   missing semantic capability.
3. Improve graph routing and dense-label optimization using viewport-level
   collision metrics.
4. Add a shadow vision critic that reports visual defects but cannot approve an
   invalid scene or block production until its false-positive rate is measured.
5. Add semantic focus actions tied to entity IDs instead of freehand circles or
   arrows from the teaching model.
6. Track ready, retry, repair, proof-failure, collision, and recovery rates by
   operator family rather than syllabus topic.
7. Grow the live stochastic corpus and report repeated-run success rates; one
   passing sample must not be treated as a 100% availability guarantee.

## Non-Negotiable Rules

- No topic template or plugin per chapter.
- No model-authored pixels, paths, labels, or marker gestures.
- No partial diagram followed by speech.
- No visual claim without an executable proof obligation where one exists.
- No retry or recovery path may bypass the same validator used for fresh scenes.
