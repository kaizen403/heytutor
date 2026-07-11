# Ray Optics Debug Playbook

Optics diagrams are compiled via the **geometry engine** (`plugin=optics`). Start with [geometry-debug.md](geometry-debug.md) for SceneSpec → compile → turn wiring, then use this playbook for precision-builder internals.

Every Ray Optics turn must leave a diagnosable Langfuse + `[tutor:optics]` timeline. No silent diagram decisions.

## Quick path

1. Open the Langfuse turn by `traceId` (board turn stores `traceId`).
2. Read **trace metadata**: `optics_kind`, `matched_template_id`, `diagram_source`, `parsed_numbers`, `intro_segment_count`, `intro_command_types`, `allow_llm_draw`, `planner_overridden`.
3. Walk the named events in order (below).
4. Cross-check the same fields in the browser/server console under `[tutor:optics]`, `[tutor:draw]`, `[tutor:segment]`.

## Event → failure mode

| Symptom | Look at | Means |
|---|---|---|
| Wrong diagram (mirror for lens/prism) | metadata `matched_template_id` / event `optics-match` | Registry regex order or catch-all match bug |
| Wrong markings / missing C,F,O / bad u,f | `optics-classify` + `optics-intro-built` `command_summary` | Classifier kind or precision builder coordinates |
| Numbers not parsed | `optics-classify` `parsed_numbers` | Parser regex gap in `parseOpticsNumbers` |
| Ray endpoints miss surface | `geometry-snap` `before_xy` / `after_xy` / `snap_target` | Snap targets wrong for lens/prism/mirror |
| LLM redrew skeleton | `template-draw-blocked` | Guard working; if ink still wrong, allowLlmDraw / block reason |
| Principal ray executed | `optics-ray-draw` | LLM ray path; check `snapped` |
| Speech/ink drift | `optics-sync-lag` + `draw-complete` + `tts-timing-*` + `write-schedule-ready` | Sync/pacing; lag_ms over ~450 ms |
| Planner overrode hand template | metadata `planner_overridden` | Should be true only when optics family still won; if diagram_source is planner for optics, prefer-hand bug |

## Event chain (happy path)

```
optics-match
  → optics-classify
  → optics-intro-built
  → optics-intro-queued / template-intro-queued
  → geometry-snap (as needed)
  → optics-ray-draw (LLM rays)
  → draw-complete / write-schedule-ready / tts-timing-*
  → optics-sync-lag (only if lag exceeds threshold)
```

## Local console

Enable with `TUTOR_DEBUG=1` or `NEXT_PUBLIC_TUTOR_DEBUG=1` (also on in development). Filter logs for `[tutor:optics]`.

## Code anchors

- Family templates: `packages/drawing/src/templates/opticsFamily.ts`
- Classifier + builders + playbook comment: `packages/drawing/src/templates/opticsPrecision.ts`
- Snap: `packages/drawing/src/geometrySnap.ts`
- Turn wiring: `apps/tutor/features/tutor-session/hooks/turn/useQuestionHandler.ts`
- Snap/block/ray marks: `apps/tutor/features/tutor-session/hooks/useCommandExecution.ts`
- Sync lag: `apps/tutor/features/tutor-session/hooks/turn/useSegmentRunner.ts`
- Event budget: `apps/tutor/lib/turnTelemetry.ts` (`MAX_EVENTS = 400`, decision-event preference)
