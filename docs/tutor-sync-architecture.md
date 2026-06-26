# Tutor Speech/Whiteboard Sync Architecture

This file is for agents working on "voice and drawing are not in sync", "writing appears after the explanation", Tegaki handwriting smoothness, drawing queue latency, or replay sync bugs.

Always read this file before touching the tutor sync path.

## User Goal

The product is an AI whiteboard tutor. It should teach like a human teacher:

- Speak and draw/write at the same time.
- If the tutor says "five x plus three", the board should write `5x + 3` while those words are spoken, not after the sentence finishes.
- Drawing should support any subject, not only math: formulas, diagrams, labels, vocabulary, cause/effect flows, summaries, etc.
- The narration should teach concepts. It should not narrate UI actions like "I am drawing a circle."

## High-Level Flow

The main live path is:

1. User submits a question in `apps/tutor/app/c/[sessionId]/page.tsx`.
2. `streamLLMResponse()` in `packages/tutor-core/src/llmAPI.ts` streams text from Fireworks.
3. The response is parsed into lesson segments by `buildLessonSegments()` in `packages/drawing/src/lessonPlanner.ts`.
4. Each segment is queued through `enqueueSegment()` / `segmentChainRef` in `page.tsx`.
5. `runSegment()` speaks the segment narration and runs the segment drawing command concurrently.
6. `createTTSClient()` returns `ElevenLabsWebSocketTTSClient` in the browser.
7. `Whiteboard.writeText()` or `Whiteboard.drawShape()` renders on Konva layers.
8. Captured audio/timings/commands are persisted as turns and replayed later by `replayLecture()`.

## Critical Files

### `packages/tutor-core/src/systemPrompt.ts`

Controls how the LLM structures teaching.

Important rules:

- The model must speak board text out loud.
- Board commands must appear immediately after the spoken phrase they sync with.
- Long formulas must be split into small steps.

If the model writes a command at the end of a long explanatory paragraph, the app can only draw after the cue phrase appears in speech. Prompt wording here directly affects sync.

### `packages/drawing/src/lessonPlanner.ts`

Parses `[STEP]...[/STEP]` blocks into `TutorSegment`s.

Key behavior:

- `extractActionsFromBlock()` finds drawing tags.
- `parseStructuredLessonSteps()` creates one segment per command.
- Text before a command becomes that command's spoken narration.
- Text after a command becomes a later narration-only segment.

Implication: if prompt output is:

```text
[STEP]
five x plus three [WRITE:5x + 3,100,100] means multiply first.
[/STEP]
```

then the write command pairs with "five x plus three", and "means multiply first" becomes a following narration-only segment. This is good for sync.

If prompt output is:

```text
[STEP]
first we think about the expression and how the terms combine. the expression is five x plus three.
[WRITE:5x + 3,100,100]
[/STEP]
```

then drawing starts near the end of the spoken explanation because the board cue appears late.

### `packages/tutor-core/src/audioSync.ts`

Maps spoken narration to drawing/writing times.

Important functions:

- `getWriteCharScheduleMs(narration, command, timings)` maps `WRITE`/`LABEL` text to per-character offsets using TTS character timings.
- `getEstimatedWriteCharScheduleMs(narration, command)` creates an immediate script-derived schedule when TTS timings are missing or late.
- `getCommandSpeechWindow()` estimates a start/duration window for non-character-scheduled commands.
- `mathToSpeech()` from `elevenLabsClient.ts` converts symbols to spoken form before matching.

Important design rule:

Live writing must not block on ElevenLabs alignment. Real timings may arrive after the relevant words are already spoken. The live path should use real timings only when already available; otherwise it should use the estimated script schedule. Persisted/replay paths can use exact timings.

### `packages/tutor-core/src/elevenLabsWebSocketClient.ts`

Handles browser TTS streaming.

Important behavior:

- `/api/tts/ws` streams ElevenLabs audio chunks and alignment.
- `onStart` fires around first audio chunk/playback start, not necessarily exactly when every audio sample becomes audible.
- `getPlaybackPositionMs()` returns the AudioContext playback position for the current segment when known.
- `ctx.currentTime` freezes when `pause()` suspends the AudioContext, so it is pause-aware.

Known caveat:

If WebSocket TTS falls back to HTTP streaming or browser `SpeechSynthesis`, exact playback position may be unavailable. The app then uses a wall-clock fallback from segment start. This is less exact, but should still draw during speech because the live path uses estimated schedules immediately.

### `apps/tutor/app/c/[sessionId]/page.tsx`

Main orchestration file.

Key functions/sections:

- `runSegment()` pairs narration and drawing.
- `waitForInitialTimings()` waits only briefly for first TTS timing data. It must not wait for most of the sentence.
- `runDraw()` executes commands for the segment.
- For `WRITE`/`LABEL`, live code should:
  - Use `getWriteCharScheduleMs()` if `capturedTimings` is already available.
  - Otherwise use `getEstimatedWriteCharScheduleMs()` immediately.
  - Pass `WriteSchedule` to `Whiteboard.writeText()`.
- `liveAudioPositionMs()` is the clock passed into `Whiteboard.writeText()`.
- `replayLecture()` uses persisted audio/timings and gates against `audio.currentTime`.

Debug logs to inspect:

- `[tutor:tts] ... segment audio started`
- `[tutor:draw] ... initial timing wait done`
- `[tutor:draw] ... write schedule ready`
- `[tutor:draw] ... write char start`
- `[tutor:draw] ... executeCommand start`
- `[tutor:draw] ... executeCommand done`

If `write schedule ready` appears after the relevant narration has already spoken, the runtime is blocking too long or the prompt placed the command too late.

If `write char start` has high positive `lag_ms`, the whiteboard started late relative to the schedule.

If `schedule_source` is often `estimated`, ElevenLabs timings are not available early enough for live sync. This is acceptable if visual sync feels right; exact timings still help replay/persistence.

### `packages/whiteboard/src/Whiteboard.tsx`

Konva canvas and handwriting renderer.

Important functions:

- `writeText(text, x, y, duration, schedule?)`
- `waitForAudioPosition(targetMs, getAudioPositionMs)`
- `flyCursorTo()`
- `drawShape()`

How scheduled writing works:

1. `textToStrokePaths()` converts text to Tegaki stroke paths.
2. `writeText()` iterates non-space characters in order.
3. For each character, it waits until `getAudioPositionMs() >= targetMs`.
4. It draws that character's strokes over the available gap before the next scheduled character.

Known Tegaki/Konva performance concerns:

- `textToStrokePaths()` and `Konva.Path.getLength()` happen before drawing begins. Long text can cause setup delay.
- Every stroke creates a Konva `Path`, calls `getLength()`, animates dash offset, then moves to the draw layer.
- Long `WRITE` commands will feel unsmooth. Prefer short `WRITE` commands and formulas split across steps.
- If setup delay is visible, consider caching glyph stroke lengths or precomputing character paths before audio starts.

## Common Failure Modes

### Drawing happens after explanation

Likely causes:

1. Prompt placed `[WRITE]` or drawing command after a long explanation.
2. Runtime waited for TTS timings before drawing.
3. The command's text was not actually spoken, so matching fell back late.
4. A long Tegaki setup/render blocked before the first character appeared.

Debug approach:

1. Inspect raw LLM response and segment list.
2. Check whether the command appears immediately after its spoken cue phrase.
3. Check `write schedule ready`:
   - `schedule_source`
   - `first_offset_ms`
   - `audio_pos_ms`
   - `start_lag_ms`
4. Check first `write char start` `lag_ms`.
5. If lag is high before `writeText`, fix orchestration/scheduling.
6. If lag is low but visual still appears late, investigate Tegaki/Konva setup/rendering.

### Formula writes too fast or all at once

Likely causes:

1. The command is too long.
2. The formula is not spoken token-by-token.
3. The matching collapsed to a fallback schedule.

Fix direction:

- Tighten prompt examples.
- Split formulas across multiple `[STEP]` blocks.
- Improve `normalizeForSpeechMatch()` / token matching in `audioSync.ts`.

### Browser voice fallback is being used

Exact ElevenLabs timings may not be available until speech ends. Live sync must use estimated scheduling in that case. Do not wait for `SpeechSynthesis` `onTimings`; it emits at `onend`.

## Quality Gates

Run:

```bash
pnpm turbo run typecheck
pnpm --filter @heytutor/tutor build
```

Full lint may fail in some local environments if package-local `eslint` binaries are not linked; the tutor build runs Next lint/type checks for the app.

## Current Root-Cause Notes

The most important recent finding: waiting for near-complete ElevenLabs timing alignment before drawing causes the exact user-visible bug: speech happens first, writing appears late.

The current live design should therefore be:

- **Estimated schedule first for live drawing.**
- **Real TTS timings opportunistically when already available.**
- **Persist real timings for replay.**
- **Prompt commands immediately after spoken cue phrases.**

