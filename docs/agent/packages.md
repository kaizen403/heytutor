# Shared Packages

All packages live in `packages/`, built with **tsup** (ESM + `.d.ts`), consumed by apps via `workspace:*` deps.

## `@heytutor/drawing`

**What to draw** — protocol, parsing, shapes, handwriting, diagram templates.

| Module | File | Description |
|--------|------|-------------|
| Protocol | `src/drawingProtocol.ts` | `DrawCommand` types, tag parsing |
| Incremental parser | `src/incrementalParser.ts` | `IncrementalTagParser` — char-by-char during LLM stream |
| Lesson planner | `src/lessonPlanner.ts` | `buildLessonSegments()` — splits `[STEP]...[/STEP]` into segments |
| Handwriting | `src/handwriting.ts` | Tegaki stroke paths for text |
| Shape paths | `src/shapePaths.ts` | SVG/Konva paths (cuboid, circle, annotation gestures) |
| Board zones | `src/boardZones.ts` | Canvas layout — 1200×700, diagram zone x 400–900 |
| Command placement | `src/commandPlacement.ts` | Template repair, label snapping, duplicate detection |
| Geometry snap | `src/geometrySnap.ts` | Snap points to template anchors |
| Stroke animation | `src/strokeAnimation.ts` | Animated drawing along paths |
| Cursor animation | `src/cursorAnimation.ts` | Cursor follows bezier/path |
| Templates | `src/templates/registry.ts` | 30+ diagram templates (FBD, circuits, optics family, calculus, chemistry, JEE topics) |
| Optics family | `src/templates/opticsFamily.ts` | Ray Optics templates (mirror, lens, prism, TIR, combo, instruments, slab) |
| Optics precision | `src/templates/opticsPrecision.ts` | Classifier + deterministic intro builders + debug payloads |

**Verify scripts:** `pnpm --filter @heytutor/tutor-core verify` runs drawing-related smoke tests.

## `@heytutor/tutor-core`

**How to talk** — LLM client, TTS clients, audio-drawing sync, prompts.

| Module | File | Description |
|--------|------|-------------|
| LLM streaming | `src/llmAPI.ts` | `streamLLMResponse()` — SSE from `/api/chat` |
| System prompt | `src/systemPrompt.ts` | Teaching rules, sync-aware command placement |
| Audio sync | `src/audioSync.ts` | TTS timings → per-char write schedules, command speech windows |
| TTS HTTP | `src/elevenLabsClient.ts` | HTTP ElevenLabs client + `mathToSpeech()` |
| TTS WebSocket | `src/elevenLabsWebSocketClient.ts` | Browser streaming TTS with alignment |
| TTS factory | `src/createTTSClient.ts` | Browser → WebSocket; server → HTTP proxy |
| Mock responses | `src/mockResponses.ts` | Fallback when no `FIREWORKS_API_KEY` |
| Sentence chunker | `src/sentenceChunker.ts` | Splits narration for TTS |
| Debug | `src/tutorDebug.ts` | Scoped console logging (`llm`, `draw`, `optics`, …) when `TUTOR_DEBUG=1` |
| JEE syllabus | `src/jee/jeeSyllabus.ts`, `jeeLabelCues.ts` | JEE topic matching + narration label rules |
| Topic planner | `src/topicPlanner.ts` | Per-question diagram/template prompt injection |
| Debug | `src/tutorDebug.ts` | Structured debug logging (`[tutor:tts]`, `[tutor:draw]`, etc.) |

**Not exported from index** but used internally: `topicPlanner.ts`, JEE modules.

## `@heytutor/whiteboard`

**Where to draw** — Konva canvas with imperative handle.

| File | Description |
|------|-------------|
| `Whiteboard.tsx` | Main canvas — `writeText()`, `drawShape()`, `eraseRegion()`, `clearBoard()`, annotation gestures |
| `VirtualCursor.tsx` | Animated teaching cursor |
| `SpeakingWaveform.tsx` | Voice activity indicator |
| `ThinkingSpinner.tsx` | Loading state |

Key API: `WhiteboardHandle` with `writeText(text, x, y, duration, schedule?)` where `schedule` is a `WriteSchedule` from `audioSync.ts`.

## `@heytutor/design-tokens`

Shared design constants. `src/designTokens.ts` exports `DS` — sage-green palette, whiteboard colors, canvas size, corner radii. Used by tutor app and landing site.

## `@heytutor/eslint-config` / `@heytutor/typescript-config`

Shared tooling configs. Not imported at runtime.

- ESLint: `base.mjs`, `react.mjs`, `next.mjs`
- TypeScript: `base.json`, `react-library.json`, `nextjs.json`

## Building Packages

```bash
# Build all packages (turbo handles dependency order)
pnpm build

# Watch a single package during dev
pnpm --filter @heytutor/drawing dev

# Typecheck everything
pnpm typecheck
```

Turbo `dev` task has `dependsOn: ["^build"]`, so `pnpm dev:tutor` rebuilds packages automatically.
