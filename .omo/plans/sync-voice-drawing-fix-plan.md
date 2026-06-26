# Sync, Voice, Drawing & Content Alignment Fix Plan

> **Date**: 2026-06-23
> **Prior plans**: `realtime-sync-plan.md` (implemented), `handwriting-stroke-plan.md` (implemented), `ai-tutor-whiteboard.md` (implemented)
> **This plan addresses**: 6 residual issues after prior implementations

---

## Problem Summary (User Report)

1. **Speech not in sync with drawing** — voice and drawing are desynchronized
2. **Voice breaking/laggy** — audio stutters, cuts out, is very laggy
3. **Stops after 30-40 seconds** — the whole session dies mid-way
4. **Drawing doesn't match speech content** — drawing one thing while talking about another
5. **Drawing too slow** — not drawing fast enough
6. **Pen rotation erratic** — pen rotates up and down during handwriting

---

## Root Cause Analysis

### Issue 1: Speech-Drawing Desync

**Status after prior plan**: Per-segment barrier sync was implemented (Promise.all per segment). This was a huge improvement over the old serial pipeline. But residual desync remains.

**Root causes (all confirmed in code)**:

#### 1A. Drawing starts LATE — only on TTS `onStart`, not simultaneously

**File**: `apps/tutor/app/c/[sessionId]/page.tsx` lines 475-509

```typescript
const ttsPromise = tts.speakSegment(narration, {
  onStart: () => {
    setPhase("drawing");
    drawPromise ??= runDraw(segment.command!);  // <-- drawing starts HERE
  },
})
```

The drawing only starts when TTS fires `onStart` — which fires when the **first audio chunk arrives from ElevenLabs**. This means:

- TTS request is sent → network latency (50-300ms) → first audio chunk arrives → `onStart` fires → drawing starts
- During that 50-300ms window, the user hears nothing and sees nothing — dead air
- The drawing is always 50-300ms behind the speech

**Fix**: Start drawing immediately, don't wait for `onStart`. The `onStart` callback should only be used for UI phase updates, not for gating drawing start.

#### 1B. Drawing duration is independent of speech duration — no real-time pacing

**File**: `apps/tutor/app/c/[sessionId]/page.tsx` lines 385-399

```typescript
const estimatedSpeechMs = Math.max(
  narration.length * msPerCharRef.current,  // rough estimate
  boardText.length * 100,
  700,
);
let durationScale = 1;
if (narration && segment.command && !isWriteCommand) {
  const drawMs = getCommandDrawDurationMs(segment.command);
  if (drawMs > 0) {
    durationScale = Math.min(Math.max(estimatedSpeechMs / drawMs, 1), 2.2);
  }
}
```

The `durationScale` tries to stretch/squash drawing to match estimated speech duration. But:

- `msPerCharRef` starts at 85ms/char and is only updated AFTER a segment completes (from `onTimings`)
- The estimate is available for the NEXT segment, not the current one — the first segment always uses the default 85ms/char
- The scale is clamped to [1, 2.2] — if speech is 5s and drawing is 1s, scale maxes at 2.2x, making drawing 2.2s. Speech finishes at 5s, drawing at 2.2s — 2.8s of dead silence
- For WRITE commands, `speechDurationMs` is passed instead, but `writeText` distributes it across all strokes, so individual strokes may be too fast or too slow

**Fix**: Use `onTimings` from the TTS to adjust drawing speed MID-ANIMATION, not just for the next segment. Alternatively, implement a real-time pacing mechanism that adjusts the drawing animation speed based on actual audio playback position.

#### 1C. `waitForDraw` busy-waits with 16ms polling

**File**: `apps/tutor/app/c/[sessionId]/page.tsx` lines 502-507

```typescript
const waitForDraw = async (): Promise<void> => {
  while (!drawPromise) {
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await drawPromise;
};
```

This busy-waits for `drawPromise` to be assigned (which happens on `onStart`). 16ms polling wastes CPU and adds up to 16ms latency.

**Fix**: Use a Promise that resolves when drawing is started, instead of polling.

---

### Issue 2: Voice Breaking / Laggy

**Root causes (all confirmed in code)**:

#### 2A. 500ms idle timer prematurely completes TTS segments

**File**: `packages/tutor-core/src/elevenLabsWebSocketClient.ts` lines 337-345

```typescript
const scheduleIdleComplete = (): void => {
  if (idleCompleteTimer !== null) {
    window.clearTimeout(idleCompleteTimer);
  }
  idleCompleteTimer = window.setTimeout(() => {
    void completeSegment();
  }, 500);
};
```

After each audio chunk, a 500ms idle timer is set. If no new audio chunk arrives within 500ms, the segment is considered "complete." This is extremely fragile:

- ElevenLabs WebSocket can have >500ms gaps between chunks, especially for longer text
- Network jitter can easily cause 500ms+ delays
- When this fires prematurely, the segment ends, `onEnd` is called, and the next segment starts — creating a gap in audio
- The `onTimings` callback fires with incomplete data, corrupting the `msPerCharRef` estimate

**Fix**: Increase idle timer to 2000ms, or better yet, rely on the `isFinal` flag from ElevenLabs instead of idle timeout.

#### 2B. Per-segment TTS requests create inter-segment gaps

**File**: `packages/tutor-core/src/elevenLabsWebSocketClient.ts` lines 145-178

Each segment is sent as a separate TTS request:
```typescript
async speakSegment(text: string, options: SpeakSegmentOptions = {}): Promise<void> {
  // ...
  if (this.ws?.readyState === WebSocket.OPEN) {
    await this.streamSegmentOverWebSocket(spokenText, options);
    return;
  }
  // HTTP fallback also per-segment
}
```

Between segments:
1. Current segment's audio finishes playing
2. `speakSegment` resolves
3. `runSegment` finishes
4. Next segment is dequeued from `segmentChainRef`
5. `speakSegment` is called again
6. Text is sent to ElevenLabs
7. First audio chunk arrives
8. Audio starts playing

Steps 2-7 create a **200-500ms gap of silence** between each segment. For a 10-segment response, that's 2-5 seconds of total silence distributed throughout.

**Fix**: Implement a continuous TTS pipeline that sends the next segment's text BEFORE the current segment's audio finishes playing. Use a queue that pre-fetches the next TTS segment while the current one is playing.

#### 2C. `decodeAudioData` on main thread can cause stuttering

**File**: `packages/tutor-core/src/elevenLabsWebSocketClient.ts` line 368

```typescript
const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
```

`decodeAudioData` is called for each chunk on the main thread. For MP3 decoding, this can take 5-20ms per chunk, causing frame drops and audio stuttering, especially on slower devices.

**Fix**: Use the promise-based `decodeAudioData` which runs on a separate thread (already used, but ensure no other main-thread work blocks it). Also consider pre-decoding the next chunk while the current one plays.

#### 2D. No audio pre-buffering — chunks played immediately as received

**File**: `packages/tutor-core/src/elevenLabsWebSocketClient.ts` lines 369-389

Audio chunks are scheduled on the `AudioContext` timeline as they arrive:
```typescript
const startAt = Math.max(ctx.currentTime + 0.02, this.scheduledEnd);
```

The 0.02s (20ms) lead time is too short. If the next chunk takes >20ms to arrive, there's a gap in playback. No buffer queue exists to absorb network jitter.

**Fix**: Introduce a minimum buffer of 100-200ms before starting playback. Schedule the first chunk at `ctx.currentTime + 0.15` instead of `ctx.currentTime + 0.02`.

#### 2E. WebSocket reconnect between turns adds latency

**File**: `packages/tutor-core/src/elevenLabsWebSocketClient.ts` lines 180-193

```typescript
private shouldReconnect(traceId?: string, sessionId?: string): boolean {
  return traceId !== this.connectedTraceId || sessionId !== this.connectedSessionId;
}
```

Each turn gets a new `traceId`, so `shouldReconnect` returns true, and the WebSocket is closed and reconnected. This adds 200-500ms of connection overhead at the start of each turn.

**Fix**: Keep the WebSocket connection alive across turns. Only reconnect if the connection drops. The `traceId` can be sent per-segment, not per-connection.

---

### Issue 3: Stops After 30-40 Seconds

**Root causes (all confirmed in code)**:

#### 3A. `max_tokens: 4096` limit on LLM response

**File**: `packages/tutor-core/src/llmAPI.ts` line 146
**File**: `apps/tutor/app/api/chat/route.ts` lines 133-136

```typescript
// llmAPI.ts
max_tokens: 4096,

// chat/route.ts
parsed.max_tokens = Math.min(
  typeof parsed.max_tokens === "number" ? parsed.max_tokens : 4096,
  4096,
);
```

4096 tokens at ~4 chars/token = ~16,000 characters of response. With drawing commands embedded (each tag is ~30-50 chars), and narration text, this might represent 20-40 seconds of teaching content. Once the token limit is reached:

1. Fireworks stops sending chunks
2. `streamLLMResponse` returns
3. `parser.flush()` is called
4. Remaining segments are processed
5. `segmentChainRef.current` resolves
6. Turn completes → `setPhase("idle")`

There is **no continuation mechanism** — when the LLM hits the token limit, the teaching just stops.

**Fix**: 
- Increase `max_tokens` to 8192 or higher (kimi-k2p6 supports up to 16384 output tokens)
- Implement auto-continuation: when the LLM response is cut off (doesn't end with a natural conclusion), send a follow-up prompt like "continue" to get the rest
- Detect incomplete responses by checking if the last segment has a command but no trailing narration, or if the response ends mid-sentence

#### 3B. 10-second watchdog can cut off long TTS segments

**File**: `packages/tutor-core/src/elevenLabsWebSocketClient.ts` lines 347-354

```typescript
const watchdog = window.setTimeout(() => {
  if (!receivedAudio) {
    reject(new Error("websocket tts timeout"));
    return;
  }
  void completeSegment();
}, 10000);
```

If a TTS segment takes >10 seconds (long narration + slow ElevenLabs response), the watchdog fires and completes the segment prematurely. This can cut off audio mid-playback.

**Fix**: Increase watchdog to 30 seconds, or remove it entirely and rely on the `isFinal` flag from ElevenLabs.

#### 3C. No detection or handling of stream interruption

If the Fireworks API stream is interrupted (network issue, rate limit, server-side timeout), the `reader.read()` call in `streamLLMResponse` throws or returns `done: true` prematurely. The error is caught, but there's no retry or continuation.

**Fix**: Add retry logic for stream interruptions, with exponential backoff.

---

### Issue 4: Drawing Doesn't Match Speech Content

**Root causes (all confirmed in code)**:

#### 4A. System prompt doesn't strictly enforce per-segment narration-drawing alignment

**File**: `packages/tutor-core/src/systemPrompt.ts`

The current prompt says:
```
- say what you're about to draw, then immediately place the drawing command.
- structure your answer as a sequence of small teach moments: brief narration, drawing command, brief narration, drawing command.
```

This is advisory, not enforced. The AI can:
- Talk about concept A, then draw something related to concept B
- Put multiple drawing commands in a row without narration between them
- Narrate without any drawing command
- Draw something then talk about something completely different

**Fix**: Strengthen the prompt with explicit rules and examples. Add a validation step that checks if narration and drawing command in each segment are topically aligned.

#### 4B. No post-generation validation of content alignment

There is no code anywhere that checks whether a segment's narration is actually about its drawing command. The `IncrementalTagParser` simply pairs whatever text comes before a tag with that tag's command. The `runSegment` function blindly speaks the narration and draws the command without any alignment check.

**Fix**: Add a lightweight validation step (either rule-based or LLM-based) that checks if narration and drawing command are aligned. If not, either skip the misaligned command or adjust the narration.

#### 4C. No structured output format that forces alignment

The AI generates free-form text with embedded tags. Nothing prevents it from generating:
```
now let's look at the perpendicular line. [DRAW_CIRCLE:300,350,100]
```

The narration talks about a perpendicular line, but the command draws a circle. This is a fundamental limitation of the free-form text format.

**Fix**: Consider moving to a structured output format (JSON) where each step has a `narration` field and a `drawing_command` field, with the AI explicitly generating both for each step. Alternatively, add stronger prompt engineering with few-shot examples that demonstrate correct alignment.

---

### Issue 5: Drawing Too Slow

**Root causes (all confirmed in code)**:

#### 5A. Handwriting is stroke-by-stroke with `flyCursorTo` between each stroke

**File**: `packages/whiteboard/src/Whiteboard.tsx` lines 367-451

For each character, for each stroke:
1. `flyCursorTo(stroke.startX, stroke.startY, Math.min(flyMsPerStroke, perStrokeDuration * 0.2))` — 30ms+ per stroke
2. Create `Konva.Path`
3. Animate dash offset over `perStrokeDuration`
4. Move to draw layer

For a 20-character text with average 2 strokes per character = 40 strokes. At 30ms fly + ~100ms stroke = 130ms per stroke = 5.2 seconds total. With `speedMultiplier: 1.5`, that's still ~3.5 seconds.

**Fix**: 
- Reduce `flyMsPerStroke` from 30ms to 10-15ms
- Skip `flyCursorTo` entirely for strokes that are very close to the previous stroke's end point (distance < 20px)
- Batch multiple strokes of the same character without fly-between (only fly between characters, not between strokes of the same character)
- Increase the default `speedMultiplier` or make the speed calculation more aggressive

#### 5B. `batchDraw` called on every animation frame

**File**: `packages/whiteboard/src/Whiteboard.tsx` lines 298, 306, 384, 396, etc.

`animLayer.batchDraw()` and `drawLayer.batchDraw()` are called inside the `animateOver` callback, which runs on every `requestAnimationFrame` (60fps). For complex scenes with many nodes, this can cause frame drops.

**Fix**: Only call `batchDraw` when something actually changes. Use `drawLayer.batchDraw()` only when moving nodes from anim to draw layer, not during animation.

#### 5C. Speed multiplier applied after durationScale, creating compound effect

**File**: `apps/tutor/app/c/[sessionId]/page.tsx` line 240

```typescript
const scaledDuration = (duration: number) =>
  Math.max(Math.round((duration * durationScale) / speedRef.current), 100);
```

When `durationScale` is 2.2 (max) and `speedRef.current` is 1.5, the effective duration is `duration * 2.2 / 1.5 = duration * 1.47`. The speed multiplier partially cancels the duration scale, making drawing slower than intended.

**Fix**: Apply speed multiplier to the base duration BEFORE durationScale, or make them independent.

---

### Issue 6: Pen Rotation Erratic

**Root causes (all confirmed in code)**:

#### 6A. Bezier rotation during `flyCursorTo` creates wild rotation changes

**File**: `packages/whiteboard/src/Whiteboard.tsx` lines 327-335

```typescript
await animateOver(flightDuration, (linearProgress) => {
  const easedProgress = smoothstep(linearProgress);
  const point = bezierPoint(start, control, end, easedProgress);
  const rotation = bezierRotation(start, control, end, easedProgress);
  // ...
  setCursorViewSafely(point.x, point.y, rotation, scale);
});
```

The rotation is calculated from the bezier curve tangent. Since the control point is above the midpoint (`midpoint.y - arcHeight`), the tangent direction changes dramatically during flight:
- At t=0: tangent points up-right toward control point → rotation ≈ 45-90°
- At t=0.5: tangent points roughly horizontal → rotation ≈ 90°
- At t=1: tangent points down-right toward end point → rotation ≈ 90-135°

This causes the pen to rotate wildly during flight.

**Fix**: Smooth the rotation by interpolating between start and end rotations, rather than using the raw bezier tangent. Or clamp the rotation to a narrow range (e.g., -45° to -25°) during flight.

#### 6B. No rotation update during stroke drawing

**File**: `packages/whiteboard/src/Whiteboard.tsx` line 296

```typescript
await animateOver(duration, (progress) => {
  const drawnLength = progress * totalLength;
  const point = path.getPointAtLength(drawnLength);
  path.dashOffset(totalLength - drawnLength);
  if (point) {
    setCursorViewSafely(point.x, point.y);  // <-- no rotation update!
  }
  animLayer.batchDraw();
});
```

`setCursorViewSafely(point.x, point.y)` is called WITHOUT setting rotation — it keeps the previous rotation (from the last `flyCursorTo`). So during drawing, the pen stays at whatever angle it was at the end of the flight, which could be anything.

For handwriting, each stroke has its own `flyCursorTo`, so the rotation changes between strokes but stays fixed during each stroke. This creates the "rotating up and down" effect the user describes.

**Fix**: Calculate rotation from the path tangent during drawing. Use `getPointAtLength` at two nearby points to compute the tangent direction, then set rotation accordingly. This makes the pen follow the natural writing direction.

#### 6C. Handwriting `flyCursorTo` between strokes causes constant rotation changes

**File**: `packages/whiteboard/src/Whiteboard.tsx` lines 403-406

```typescript
await flyCursorTo(
  stroke.startX,
  stroke.startY,
  Math.min(flyMsPerStroke, perStrokeDuration * 0.2),
);
```

Between each stroke of handwriting, `flyCursorTo` is called, which calculates a new bezier rotation. Since strokes start at different positions (top of 't', middle of 'i', etc.), the rotation changes dramatically with each stroke, creating the erratic up-and-down rotation.

**Fix**: During handwriting, use a fixed rotation (e.g., -35°) for all strokes, or interpolate smoothly between the end of one stroke's rotation and the start of the next.

---

## Fix Plan

### Phase 1: Fix Voice Breaking & Laggy (HIGHEST PRIORITY)

> **Goal**: Smooth, continuous audio without breaks or stuttering

#### Fix 2A: Increase idle timer, rely on `isFinal` flag

**File**: `packages/tutor-core/src/elevenLabsWebSocketClient.ts`

- Change idle timer from 500ms to 2000ms
- Only use idle timer as a fallback; primarily rely on `isFinal` flag from ElevenLabs
- When `isFinal` is received, complete immediately (already implemented)
- When idle timer fires, check if audio is still playing before completing

```typescript
// BEFORE:
idleCompleteTimer = window.setTimeout(() => {
  void completeSegment();
}, 500);

// AFTER:
idleCompleteTimer = window.setTimeout(() => {
  // Only complete if no audio is still playing
  if (this.scheduledEnd <= ctx.currentTime + 0.1) {
    void completeSegment();
  } else {
    scheduleIdleComplete(); // reschedule
  }
}, 2000);
```

#### Fix 2B: Implement continuous TTS pipeline with pre-fetching

**File**: `packages/tutor-core/src/elevenLabsWebSocketClient.ts` + `apps/tutor/app/c/[sessionId]/page.tsx`

Add a TTS queue that pre-fetches the next segment while the current one plays:

1. Add a `queueSegment(text, options)` method to TTSClient that sends text to ElevenLabs immediately but doesn't wait for completion
2. In `runSegment`, when a segment starts playing, immediately queue the next segment's text
3. The next segment's audio starts generating while the current one is still playing
4. When the current segment finishes, the next one's audio is already buffered and ready

This eliminates the 200-500ms inter-segment gap.

For the WebSocket client, this means:
- Keep sending text to the WS without waiting for `isFinal`
- Use `flush: true` at segment boundaries
- Audio chunks from different segments are scheduled sequentially on the AudioContext timeline

For the HTTP fallback client, this means:
- Fire the next segment's fetch request before the current one finishes
- Schedule the next segment's audio chunks after the current one's `scheduledEnd`

#### Fix 2D: Increase audio buffer lead time

**File**: `packages/tutor-core/src/elevenLabsWebSocketClient.ts` line 369

```typescript
// BEFORE:
const startAt = Math.max(ctx.currentTime + 0.02, this.scheduledEnd);

// AFTER:
const startAt = Math.max(ctx.currentTime + 0.15, this.scheduledEnd);
```

Also apply to `packages/tutor-core/src/elevenLabsClient.ts` line 316.

#### Fix 2E: Keep WebSocket alive across turns

**File**: `packages/tutor-core/src/elevenLabsWebSocketClient.ts`

- Remove `shouldReconnect` check on `traceId` change
- Only reconnect if WebSocket is closed/errored
- Send `traceId` per-segment in the message payload, not as a connection parameter
- Add heartbeat/ping to keep connection alive

```typescript
// BEFORE:
private shouldReconnect(traceId?: string, sessionId?: string): boolean {
  return traceId !== this.connectedTraceId || sessionId !== this.connectedSessionId;
}

// AFTER:
private shouldReconnect(traceId?: string, sessionId?: string): boolean {
  // Only reconnect if WS is closed
  return this.ws === null || this.ws.readyState !== WebSocket.OPEN;
}
```

---

### Phase 2: Fix 30-40 Second Cutoff

> **Goal**: Teaching sessions run for 2+ minutes without stopping

#### Fix 3A: Increase max_tokens and add auto-continuation

**File**: `packages/tutor-core/src/llmAPI.ts` line 146
**File**: `apps/tutor/app/api/chat/route.ts` lines 133-136

- Increase `max_tokens` from 4096 to 8192
- After `streamLLMResponse` returns, check if the response appears incomplete:
  - Doesn't end with punctuation (.!? or a closing tag])
  - Last segment has a command but no trailing narration
  - Total response length is close to the token limit
- If incomplete, send a continuation prompt: `{"role": "assistant", "content": partialResponse}, {"role": "user", "content": "continue"}`
- Append the continuation to the original response
- Feed the continuation through the same `IncrementalTagParser`

```typescript
// In llmAPI.ts
max_tokens: 8192,

// In page.tsx handleQuestion:
let fullResponse = "";
let continueCount = 0;
const MAX_CONTINUATIONS = 3;

do {
  const result = await streamLLMResponse(
    {
      systemPrompt: continueCount === 0 ? TUTOR_SYSTEM_PROMPT : "continue your previous response exactly where you left off. do not repeat anything.",
      userPrompt: continueCount === 0 ? question : "continue",
      conversationHistory: continueCount === 0 ? conversationHistoryRef.current : [
        ...conversationHistoryRef.current,
        { user: question, assistant: fullResponse },
      ],
      proxyUrl: "/api/chat",
      sessionId,
      signal: abortController.signal,
      onTraceId: (id) => { currentTraceIdRef.current = id; },
    },
    (delta) => {
      fullResponse += delta;
      parser.push(delta);
    },
  );
  
  continueCount++;
  
  // Check if response seems complete
  const trimmed = result.text.trim();
  const looksComplete = trimmed.endsWith('.') || trimmed.endswith('!') || 
    trimmed.endsWith('?') || trimmed.endsWith(']') ||
    result.streamStats?.contentChars < 1000; // short response = probably complete
  
  if (looksComplete || continueCount >= MAX_CONTINUATIONS) break;
  
  // Prepare for continuation
  fullResponse = trimmed; // will be prepended to next response
} while (true);
```

#### Fix 3B: Increase watchdog timeout

**File**: `packages/tutor-core/src/elevenLabsWebSocketClient.ts` line 354

```typescript
// BEFORE:
}, 10000);

// AFTER:
}, 30000);
```

---

### Phase 3: Fix Speech-Drawing Desync

> **Goal**: Drawing and speech are tightly synchronized per-segment

#### Fix 1A: Start drawing immediately, not on `onStart`

**File**: `apps/tutor/app/c/[sessionId]/page.tsx` lines 471-511

```typescript
// BEFORE:
const ttsPromise = tts.speakSegment(narration, {
  onStart: () => {
    setPhase("drawing");
    drawPromise ??= runDraw(segment.command!);
  },
})
.finally(() => {
  drawPromise ??= runDraw(segment.command!);
});

// AFTER:
if (hasNarration && hasCommand) {
  setPhase("drawing");
  
  // Start both simultaneously
  const drawPromise = runDraw(segment.command!);
  
  const ttsPromise = tts.speakSegment(narration, {
    previousText,
    nextText,
    traceId: currentTraceIdRef.current ?? undefined,
    sessionId: sessionId ?? undefined,
    onStart: () => {
      tutorDebug("tts", "segment audio started", { index });
      // Drawing already started - no need to trigger here
    },
    onTimings: (timings) => {
      // Use timings to adjust drawing speed mid-animation
      if (timings.totalDuration > 0 && narration.length > 0) {
        const measured = (timings.totalDuration * 1000) / narration.length;
        msPerCharRef.current = Math.min(Math.max(measured, 65), 150);
      }
    },
  });
  
  await Promise.all([ttsPromise, drawPromise]);
}
```

#### Fix 1B: Use `onTimings` for real-time drawing speed adjustment

**File**: `packages/whiteboard/src/Whiteboard.tsx` — add a `setSpeed` method to `WhiteboardHandle`

Add the ability to adjust animation speed mid-flight:
1. Expose a `setAnimationSpeed(multiplier: number)` method on `WhiteboardHandle`
2. In `animateOver`, check a ref for the current speed multiplier and adjust the progress calculation
3. When `onTimings` fires with the actual audio duration, calculate the ratio of actual audio duration to estimated duration, and call `setAnimationSpeed` with that ratio

This makes the drawing speed up or slow down to match the actual audio playback, not just the estimate.

#### Fix 1C: Remove busy-wait polling

**File**: `apps/tutor/app/c/[sessionId]/page.tsx` lines 502-507

With Fix 1A, the busy-wait is no longer needed since `drawPromise` is assigned immediately.

---

### Phase 4: Fix Drawing Content Mismatch

> **Goal**: Drawing always matches what's being spoken

#### Fix 4A: Strengthen system prompt with strict alignment rules

**File**: `packages/tutor-core/src/systemPrompt.ts`

Add explicit rules:

```
critical sync rules:
- each drawing command must be directly about what you just said in the narration immediately before it.
- if you say "let's draw a circle", the next command MUST be DRAW_CIRCLE. never say "circle" and then draw a line.
- if you say "now write the formula", the next command MUST be WRITE or LABEL with that exact formula.
- never talk about one concept while drawing something for a different concept.
- one narration segment = one drawing command. the narration describes exactly what the command does.
- if you need to explain something without drawing, just talk — don't add a drawing command.
- if you need to draw without talking, just add the command — but this should be rare.

examples of CORRECT alignment:
"so let's draw a circle with radius r from the center." [DRAW_CIRCLE:600,350,120]
"now i'll write the formula for area." [WRITE:area = pi times r squared,200,500]

examples of WRONG alignment (never do this):
"let's look at the perpendicular line." [DRAW_CIRCLE:300,350,100]  <- WRONG: said perpendicular line, drew circle
"the volume is l times w times h." [DRAW_RECT:200,200,300,200]  <- WRONG: said volume formula, drew rectangle
```

#### Fix 4B: Add post-generation alignment validation

**File**: New file `packages/drawing/src/alignmentCheck.ts`

Add a lightweight rule-based checker that:
1. Extracts key nouns from narration (circle, line, cuboid, cube, formula, etc.)
2. Checks if the drawing command type matches (DRAW_CIRCLE should have "circle" in narration, DRAW_LINE should have "line", etc.)
3. For WRITE/LABEL, checks if the text being written is mentioned in the narration
4. If mismatch detected, either:
   - Log a warning (for monitoring)
   - Skip the misaligned command (conservative)
   - Adjust the narration to match (aggressive — requires LLM call)

```typescript
export function checkSegmentAlignment(segment: TutorSegment): {
  aligned: boolean;
  reason?: string;
} {
  if (!segment.command) return { aligned: true };
  
  const narration = segment.narration.toLowerCase();
  const cmd = segment.command;
  
  const COMMAND_KEYWORDS: Record<DrawCommandType, string[]> = {
    DRAW_CIRCLE: ['circle', 'round', 'radius'],
    DRAW_LINE: ['line', 'segment', 'connect'],
    DRAW_RECT: ['rectangle', 'rect', 'box'],
    DRAW_CUBE: ['cube'],
    DRAW_CUBOID: ['cuboid', 'box', 'rectangular'],
    WRITE: [],  // check text match instead
    LABEL: [],
    PAUSE: ['pause', 'wait', 'moment'],
    CLEAR: ['clear', 'erase', 'wipe', 'start fresh'],
    ERASE: ['erase', 'clear', 'remove'],
  };
  
  if (cmd.type === 'WRITE' || cmd.type === 'LABEL') {
    // Check if the text being written is referenced in narration
    const writeText = (cmd.text ?? '').toLowerCase();
    if (writeText.length > 0 && narration.length > 0) {
      // At least some words from writeText should appear in narration
      const writeWords = writeText.split(/\s+/).filter(w => w.length > 2);
      const matches = writeWords.filter(w => narration.includes(w));
      if (matches.length === 0 && writeWords.length > 1) {
        return { aligned: false, reason: `write text "${cmd.text}" not mentioned in narration` };
      }
    }
    return { aligned: true };
  }
  
  const keywords = COMMAND_KEYWORDS[cmd.type] ?? [];
  if (keywords.length > 0) {
    const hasKeyword = keywords.some(kw => narration.includes(kw));
    if (!hasKeyword) {
      return { 
        aligned: false, 
        reason: `${cmd.type} drawn but narration doesn't mention: ${keywords.join(', ')}`
      };
    }
  }
  
  return { aligned: true };
}
```

#### Fix 4C: Use few-shot examples in system prompt

Add 2-3 concrete examples to the system prompt that demonstrate perfect narration-drawing alignment, specifically for geometry topics (circles, lines, points) since the user mentioned these.

---

### Phase 5: Fix Drawing Speed

> **Goal**: Drawing is fast enough to keep up with speech

#### Fix 5A: Reduce fly time between handwriting strokes

**File**: `packages/whiteboard/src/Whiteboard.tsx` lines 362-363

```typescript
// BEFORE:
const flyMsPerStroke = 30;
const totalFlyMs = totalStrokes * flyMsPerStroke;

// AFTER:
const flyMsPerStroke = 12;  // reduced from 30
const totalFlyMs = totalStrokes * flyMsPerStroke;
```

And at line 403-406:
```typescript
// BEFORE:
await flyCursorTo(
  stroke.startX,
  stroke.startY,
  Math.min(flyMsPerStroke, perStrokeDuration * 0.2),
);

// AFTER:
// Skip fly entirely if stroke starts very close to current cursor position
const cursorPos = cursorViewRef.current;
const dist = Math.hypot(stroke.startX - cursorPos.x, stroke.startY - cursorPos.y);
if (dist > 15) {
  await flyCursorTo(
    stroke.startX,
    stroke.startY,
    Math.min(flyMsPerStroke, perStrokeDuration * 0.15),
  );
} else {
  setCursorViewSafely(stroke.startX, stroke.startY);
}
```

#### Fix 5B: Reduce `batchDraw` calls during animation

**File**: `packages/whiteboard/src/Whiteboard.tsx`

In the `animateOver` callback for `drawShape` (line 298), only call `animLayer.batchDraw()` — don't call `drawLayer.batchDraw()` during animation. Only call `drawLayer.batchDraw()` when moving a completed node from anim to draw layer.

This is already partially the case, but verify no redundant `batchDraw` calls exist.

#### Fix 5C: Fix speed multiplier ordering

**File**: `apps/tutor/app/c/[sessionId]/page.tsx` line 240

```typescript
// BEFORE:
const scaledDuration = (duration: number) =>
  Math.max(Math.round((duration * durationScale) / speedRef.current), 100);

// AFTER:
// Apply speed multiplier first, then durationScale
const scaledDuration = (duration: number) =>
  Math.max(Math.round((duration / speedRef.current) * durationScale), 100);
```

This ensures the speed multiplier makes the base animation faster, and then `durationScale` stretches it to match speech. The math is the same (multiplication is commutative), but conceptually it's clearer and prevents the durationScale from being reduced by the speed multiplier.

Actually, looking at this more carefully, the math IS the same: `duration * durationScale / speed === duration / speed * durationScale`. The issue is the minimum of 100ms — when duration is small and speed is high, the 100ms floor kicks in and makes things slower than intended. Lower the floor to 50ms.

---

### Phase 6: Fix Pen Rotation

> **Goal**: Pen rotation is smooth and natural during both flight and drawing

#### Fix 6A: Smooth rotation during `flyCursorTo`

**File**: `packages/whiteboard/src/Whiteboard.tsx` lines 327-335

Instead of using raw bezier tangent for rotation, interpolate between start and end rotations:

```typescript
// BEFORE:
const rotation = bezierRotation(start, control, end, easedProgress);

// AFTER:
// Calculate start and end rotations from path tangents
const startRotation = cursorViewRef.current.rotation;
// Target rotation: point in direction of movement, but clamped
const dx = end.x - start.x;
const dy = end.y - start.y;
const targetRotation = Math.atan2(dy, dx) * 180 / Math.PI + 90;
// Smoothly interpolate, but keep pen roughly upright
const clampedTarget = Math.max(-60, Math.min(-20, targetRotation));
const rotation = startRotation + (clampedTarget - startRotation) * easedProgress;
```

#### Fix 6B: Update rotation during stroke drawing

**File**: `packages/whiteboard/src/Whiteboard.tsx` lines 290-299

Calculate rotation from the path tangent during drawing:

```typescript
// BEFORE:
await animateOver(duration, (progress) => {
  const drawnLength = progress * totalLength;
  const point = path.getPointAtLength(drawnLength);
  path.dashOffset(totalLength - drawnLength);
  if (point) {
    setCursorViewSafely(point.x, point.y);  // no rotation
  }
  animLayer.batchDraw();
});

// AFTER:
await animateOver(duration, (progress) => {
  const drawnLength = progress * totalLength;
  const point = path.getPointAtLength(drawnLength);
  path.dashOffset(totalLength - drawnLength);
  if (point) {
    // Calculate tangent from two nearby points
    const aheadLength = Math.min(drawnLength + 2, totalLength);
    const aheadPoint = path.getPointAtLength(aheadLength);
    const dx = aheadPoint.x - point.x;
    const dy = aheadPoint.y - point.y;
    let rotation = cursorViewRef.current.rotation; // default to current
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      rotation = Math.atan2(dy, dx) * 180 / Math.PI + 90;
      // Clamp to reasonable pen-writing angle
      rotation = Math.max(-80, Math.min(80, rotation));
    }
    setCursorViewSafely(point.x, point.y, rotation);
  }
  animLayer.batchDraw();
});
```

Apply the same fix to the handwriting stroke animation (lines 433-442).

#### Fix 6C: Use fixed rotation during handwriting fly-between

**File**: `packages/whiteboard/src/Whiteboard.tsx` lines 403-406

During handwriting, use a fixed writing rotation (e.g., -35°) for all inter-stroke flights:

```typescript
// Add a parameter to flyCursorTo for fixed rotation
await flyCursorTo(
  stroke.startX,
  stroke.startY,
  Math.min(flyMsPerStroke, perStrokeDuration * 0.15),
  // Use fixed rotation for handwriting
  -35,  // pen-writing angle
);
```

This requires modifying `flyCursorTo` to accept an optional `targetRotation` parameter that overrides the bezier tangent calculation.

---

## Implementation Order

| Priority | Phase | Effort | Impact |
|----------|-------|--------|--------|
| 1 | Phase 1: Fix voice breaking | Medium | Immediate — smooth audio |
| 2 | Phase 2: Fix 30-40s cutoff | Small | Immediate — longer sessions |
| 3 | Phase 3: Fix speech-drawing desync | Medium | High — core sync quality |
| 4 | Phase 6: Fix pen rotation | Small | High — visual quality |
| 5 | Phase 5: Fix drawing speed | Small | Medium — performance |
| 6 | Phase 4: Fix content mismatch | Medium | High — but needs prompt iteration |

### Recommended execution: Phases 1+2 first (parallel), then 3+6 (parallel), then 5+4

---

## Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `packages/tutor-core/src/elevenLabsWebSocketClient.ts` | 1, 2 | Idle timer, buffer lead time, WS persistence, watchdog, continuous pipeline |
| `packages/tutor-core/src/elevenLabsClient.ts` | 1 | Buffer lead time, continuous pipeline for HTTP fallback |
| `packages/tutor-core/src/llmAPI.ts` | 2 | Increase max_tokens to 8192 |
| `apps/tutor/app/api/chat/route.ts` | 2 | Increase max_tokens cap to 8192 |
| `apps/tutor/app/c/[sessionId]/page.tsx` | 2, 3, 5 | Auto-continuation, simultaneous draw start, speed multiplier fix |
| `packages/whiteboard/src/Whiteboard.tsx` | 5, 6 | Reduced fly time, rotation during draw, smooth flight rotation, skip close flies |
| `packages/tutor-core/src/systemPrompt.ts` | 4 | Strict alignment rules, few-shot examples |
| `packages/drawing/src/alignmentCheck.ts` | 4 | **NEW** — post-generation alignment validation |
| `packages/drawing/src/index.ts` | 4 | Export alignment check |
| `packages/tutor-core/src/index.ts` | 4 | Re-export alignment check |

---

## Testing Checklist

After each phase, verify:

- [ ] Voice plays continuously without breaks for 60+ seconds
- [ ] Drawing starts at the same time as speech (no 300ms delay)
- [ ] Session runs for 2+ minutes without stopping
- [ ] Drawing content matches what's being spoken (circle when saying "circle")
- [ ] Drawing completes within 1 second of speech completing per segment
- [ ] Pen rotation is smooth during flight and follows writing direction during strokes
- [ ] Handwriting completes in reasonable time (<3s for a 20-char formula at 1.5x speed)
- [ ] No regression in existing functionality (pause/resume, stop, board switching)
