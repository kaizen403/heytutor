# Real-Time Sync Architecture Plan

## Problem

Voice and drawing are not synced. Voice starts 10-60s after drawing. Narration doesn't match what's being drawn at that moment. Total latency from question to first action: 20-120 seconds.

## Root Cause

The pipeline is **fully serial, then unsynchronized parallel**:

```
[Wait for FULL LLM response] -> [Parse FULL text] -> [Start TTS for FULL narration] + [Start drawing]
                                    ^                              ^
                              10-60s blocking              10-60s more blocking
                              NO incremental work          audio buffers ENTIRE response
                                                          before playing a single sample
```

### 7 Bottlenecks (all confirmed in code)

| # | Bottleneck | File | Impact |
|---|-----------|------|--------|
| 1 | `streamLLMResponse` accumulates full response, returns only on `[DONE]` | `lib/llmAPI.ts` | Blocks ALL work 10-60s |
| 2 | TTS sends FULL narration in one POST | `lib/elevenLabsClient.ts` | ElevenLabs must generate entire audio before any plays |
| 3 | Client buffers ENTIRE SSE response (`await response.text()`) before playing | `lib/elevenLabsClient.ts` | Negates ElevenLabs streaming entirely |
| 4 | `buildSyncPlanFromTimings` imported but never called | `app/page.tsx` | Real timestamp-based sync is dead code |
| 5 | `onTimings` callback never passed to `tts.speak()` | `app/page.tsx` | Character alignment data collected then discarded |
| 6 | `startMs` computed but drawing loop never reads it | `app/page.tsx` | No clock synchronization between audio and drawing |
| 7 | TTS and drawing run as independent promises with no coordination | `app/page.tsx` | Drawing runs 10-60s ahead of voice |

## Target

- Latency from question to first action: **<2 seconds** (Phase 1), **<500ms** (Phase 2)
- Voice and drawing tightly synced per-segment
- Narration describes what's being drawn at that moment
- Graceful fallbacks preserved (mock responses, browser SpeechSynthesis)

---

## New Architecture

```
User submits question
        |
        +--> Pre-warm TTS (start AudioContext, warm up connection)
        |
        v
+------------------------------------------------------+
|  LLM SSE Stream (Fireworks kimi-k2p6, ~0.7s TTFT)   |
|  via /api/chat proxy                                 |
+------------------+-----------------------------------+
                   | (text deltas, ~370 tokens/sec)
                   v
+------------------------------------------------------+
|  Incremental Tag Parser (state machine)              |
|  Buffers partial [DRAW_*] tags across chunks         |
|  Emits two streams as tags complete:                 |
|    1. Narration segment text (text before each tag)  |
|    2. DrawCommand (parsed from completed tag)        |
+-------+------------------+---------------------------+
        |                  |
        | (narration)      | (command)
        v                  v
+------------------+  +------------------------------+
| Segment Queue     |  | Command Queue (FIFO)         |
| (narration texts) |  | (draw commands, in order)    |
+--------+---------+  +--------------+---------------+
         |                           |
         v                           |
+--------------------------------+   |
| Per-Segment TTS (streaming)    |   |
| POST /api/tts/stream           |   |
|   - Send ONE segment's text    |   |
|   - Receive audio chunks SSE   |   |
|   - Play chunks AS THEY ARRIVE |   |
|   - Get character alignment    |   |
|   - onTimings -> sync coord    |   |
+------------+-------------------+   |
             |                       |
             v                       v
+------------------------------------------------------+
|  Segment Coordinator (per-segment Promise.all)       |
|                                                      |
|  For each segment:                                   |
|    1. Start TTS for this segment's narration         |
|    2. Start drawing for this segment's command       |
|    3. await Promise.all([tts, drawing])              |
|    4. Move to next segment only when BOTH finish     |
|                                                      |
|  Speed mismatch handling:                            |
|    - Drawing finishes first -> wait for audio        |
|    - Audio finishes first -> wait for drawing        |
+------------------------------------------------------+
```

**Key principle: per-segment execution, not per-response.**

Instead of one big `Promise.all([fullTTS, fullDrawing])`, we do:

```
for each segment:
  await Promise.all([speakSegment(narration), drawSegment(command)])
```

This makes voice and drawing naturally synced because:
- Each segment's narration describes that segment's drawing
- They start at the same time
- Neither can run ahead of the other
- The voice says "so here's a cuboid" WHILE drawing the cuboid, not 30 seconds later

---

## Key Design Decisions

### 1. TTS Delivery: Per-Segment HTTP Streaming (MVP) -> WebSocket (Phase 2)

**MVP**: Per-segment HTTP streaming with the `/stream/with-timestamps` endpoint.

Each segment is 50-200 chars. ElevenLabs Flash generates ~75ms. First audio chunk arrives in ~200-300ms. That's a 100x improvement over current 20-120s.

**Phase 2 upgrade**: ElevenLabs WebSocket Stream-Input (`/v1/text-to-speech/{voice_id}/stream-input`).
- Send text incrementally as LLM generates it
- `flush: true` at segment boundaries
- `chunk_length_schedule=[50]` for aggressive low-latency
- Bidirectional, ~200ms TTFA
- Requires a custom server or separate WS relay (Next.js App Router doesn't support WebSocket upgrade)

**Why not WebSocket for MVP**: Next.js App Router doesn't natively support WebSocket routes. Adding a custom server is a bigger change. Per-segment HTTP streaming works within the existing architecture and gets us 90% of the benefit.

**Stitching**: Use `previous_text` and `next_text` parameters on ElevenLabs requests to maintain prosody continuity between segments.

### 2. Sync Model: Segment Barrier (neither is master clock)

Neither audio nor drawing is the master clock. Instead, each segment is a barrier -- both must complete before the next segment starts.

```
Segment 1: "so here's a cuboid" + DRAW_CUBOID
  +-- TTS: ~1.5s audio  --------+
  +-- Drawing: ~3.0s (500ms fly + 2500ms draw) --+
  +-- Promise.all -> wait for both -> ~3.0s total
      (audio finishes early, waits 1.5s for drawing to finish)

Segment 2: "and here's a cube" + DRAW_CUBE
  +-- TTS: ~1.2s audio
  +-- Drawing: ~2.5s
  +-- Promise.all -> ~2.5s total
```

**Why this works for teaching**: A real teacher draws and talks simultaneously, finishes the drawing, pauses briefly, then moves to the next thing. If audio finishes before drawing, the silence feels like the teacher concentrating on finishing the drawing. If drawing finishes before audio, the cursor waits for the explanation to finish before moving on. Both feel natural.

### 3. LLM Streaming + Incremental Tag Parsing

Convert `streamLLMResponse` from "accumulate full string" to "yield deltas via callback":

```typescript
export async function streamLLMResponse(
  params: StreamLLMResponseParams,
  onDelta?: (chunk: string) => void  // NEW
): Promise<string>
```

New `IncrementalTagParser` state machine:

```
State: NARRATION (accumulating narration text)
  +-- See '[' -> peek: does it match DRAW_|WRITE|LABEL|PAUSE|CLEAR?
  |   +-- Yes -> switch to TAG_BUFFER, accumulate tag text
  |   +-- No  -> it's just a bracket in narration, keep accumulating
  +-- No '[' -> keep accumulating narration

State: TAG_BUFFER (inside a potential [DRAW_*] tag)
  +-- See ']' -> parse complete tag -> emit DrawCommand + emit narration segment -> back to NARRATION
  +-- No ']'  -> keep accumulating (tag might be split across chunks)

Edge case: buffer grows too large without ']' -> treat as narration, not a tag
```

The parser emits events:
- `onNarration(text)` -- narration text before a tag (a segment)
- `onCommand(command)` -- a parsed DrawCommand
- `onFlush()` -- remaining text at end of stream

This handles tags split across SSE chunks naturally because it buffers until `]` is found.

### 4. Audio Playback: True Streaming (not buffered)

The current `elevenLabsClient.ts` does `await response.text()` which buffers the entire response. The fix:

```typescript
// Instead of: const fullText = await response.text(); // buffers ALL chunks
// Do: read the SSE stream chunk by chunk, play each audio chunk immediately

const reader = response.body.getReader();
const decoder = new TextDecoder();
let sseBuffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  sseBuffer += decoder.decode(value, { stream: true });
  const lines = sseBuffer.split('\n\n');
  sseBuffer = lines.pop() || ''; // keep incomplete chunk

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = JSON.parse(line.slice(6));

    // Play this audio chunk IMMEDIATELY
    const audioBytes = base64ToUint8Array(data.audio_base64);
    await playAudioChunk(audioBytes);

    // Fire onTimings with this chunk's alignment data
    if (data.alignment && onTimings) {
      onTimings({
        charStartTimes: data.alignment.character_start_times_seconds,
        charDurations: data.alignment.character_end_times_seconds.map((e, i) =>
          e - data.alignment.character_start_times_seconds[i]),
        totalDuration: 0 // updated as chunks arrive
      });
    }
  }
}
```

Audio chunks are scheduled on the `AudioContext` timeline as they arrive. No buffering the full response.

### 5. WebSocket Proxy Strategy (Phase 2)

Next.js App Router can't upgrade HTTP to WebSocket. Three options:

| Option | Complexity | Pros | Cons |
|--------|-----------|------|------|
| Custom server (`server.ts`) | Medium | Single process, standard pattern | Deviates from Next.js defaults |
| Separate Node WS process | Medium | Clean separation, scalable | Two processes to manage |
| Vercel/Edge function WS | High | Serverless | Not all platforms support WS |

**Recommended for MVP**: Don't do WebSocket yet. Per-segment HTTP streaming gets us to <2s latency. WebSocket is a Phase 2 optimization for <500ms.

---

## File-by-File Changes

### Phase 1 (MVP -- Fix Core Sync, Target <2s)

| File | Change | What |
|------|--------|------|
| `lib/llmAPI.ts` | Modify | Add `onDelta` callback param. Call it per SSE chunk. Still return full string at end (backward compat). |
| `lib/incrementalParser.ts` | **New** | State machine that buffers partial tags, emits `onNarration` + `onCommand` events. |
| `lib/elevenLabsClient.ts` | Modify | Add `speakSegment(text, options)` method. Reads SSE stream chunk-by-chunk, plays audio immediately, fires `onTimings`. Keep old `speak()` for backward compat. |
| `lib/audioSync.ts` | Modify | Wire up `buildSyncPlanFromTimings`. Add `getSegmentDuration(command, audioTimings)` that returns max of drawing duration and audio duration. |
| `app/api/tts/route.ts` | Modify | Add `/api/tts/stream` endpoint that proxies to ElevenLabs `/stream/with-timestamps`. Add `previous_text`/`next_text` params for prosody stitching. |
| `app/page.tsx` | Major rewrite of `handleQuestion` + `runSyncedSequence` | Replace sequential model with incremental pipeline. |
| `lib/systemPrompt.ts` | Minor tweak | Encourage shorter narration per segment for tighter sync. Discourage long tangents between drawing commands. |

### Phase 1 Core Flow (`app/page.tsx`)

```typescript
async function handleQuestion(question: string) {
  setPhase("thinking");

  const parser = new IncrementalTagParser();
  const segmentQueue: { narration: string; command: DrawCommand | null }[] = [];
  let streamComplete = false;

  parser.onNarration = (text) => {
    segmentQueue.push({ narration: text, command: null });
  };

  parser.onCommand = (command) => {
    const lastUnpaired = segmentQueue.findLast(s => s.command === null);
    if (lastUnpaired) {
      lastUnpaired.command = command;
    }
  };

  // Start LLM stream with incremental callback
  const fullResponse = await streamLLMResponse(
    { systemPrompt, userPrompt, conversationHistory, proxyUrl: "/api/chat" },
    (delta) => parser.push(delta)  // feed each chunk to parser
  );
  parser.flush(); // emit any remaining narration

  // Now process segments sequentially with per-segment sync
  setPhase("speaking");
  for (const segment of segmentQueue) {
    if (cancelRef.current) break;

    setCurrentSegmentText(segment.narration);

    const promises: Promise<void>[] = [];

    // TTS for this segment's narration (streaming, plays immediately)
    if (segment.narration.trim()) {
      promises.push(
        ttsClient.speakSegment(segment.narration, {
          onStart: () => {},
          onTimings: (timings) => {
            // Could use timings to adjust drawing speed
          },
        })
      );
    }

    // Drawing for this segment's command
    if (segment.command) {
      promises.push(executeCommand(segment.command));
    }

    // Wait for BOTH to finish before next segment
    await Promise.all(promises);
  }

  setPhase("idle");
}
```

### Phase 2 (Optimize Latency, Target <500ms)

| File | Change | What |
|------|--------|------|
| `server.ts` or `lib/ws-relay.ts` | **New** | WebSocket relay: client WS <-> ElevenLabs WS with API key injection |
| `lib/elevenLabsClient.ts` | Add WS client | `ElevenLabsWebSocketTTSClient` that sends text incrementally, `flush: true` at segment boundaries, `chunk_length_schedule=[50]` |
| `app/page.tsx` | Modify | Feed narration text to WS as parser emits it (not waiting for command pairing). Use `flush: true` when a drawing command is detected. |
| `lib/systemPrompt.ts` | Modify | Structure output for even shorter segments (1 sentence per drawing command) |

### Phase 3 (Polish)

| Area | What |
|------|------|
| Speed-adjust drawing | Use `onTimings` audio duration to scale drawing animation speed (slower/faster stroke) to match audio |
| Pre-warm TTS | Start AudioContext + first ElevenLabs connection before LLM response arrives |
| Sentence-boundary chunking | Split long narration segments at `.`, `!`, `?`, `,` for even earlier TTS start |
| Fallback chain | ElevenLabs WS -> ElevenLabs HTTP stream -> browser SpeechSynthesis -> mock |
| `perf_metrics_in_response` | Add to Fireworks request for TTFT monitoring |

---

## Expected Latency Improvement

| Stage | Current | Phase 1 | Phase 2 |
|-------|---------|---------|---------|
| LLM TTFT | 0.7s | 0.7s | 0.7s |
| Wait for full LLM | +10-60s | **0s** (incremental) | **0s** |
| Parse | <1ms | <1ms (incremental) | <1ms |
| TTS first audio | +10-60s | **~200-300ms** (per-segment HTTP stream) | **~75-200ms** (WebSocket) |
| Drawing starts | after full LLM | **after first segment parsed** (~1-2s) | **after first segment parsed** (~1s) |
| **Total to first action** | **20-120s** | **~1.5-2.5s** | **~0.9-1.5s** |
| **Sync quality** | None (voice 30s behind) | **Per-segment synced** | **Per-segment synced + speed-adjusted** |

---

## What Makes This Work

1. **Per-segment barriers** -- voice and drawing are locked together per segment. Neither can run ahead.
2. **True streaming TTS** -- audio plays as chunks arrive, not after full download. Per-segment requests are small (50-200 chars), so ElevenLabs generates fast.
3. **Incremental LLM parsing** -- drawing starts after the first segment is parsed, not after the full LLM response.
4. **Narration matches action** -- each segment's narration is the text before its drawing tag. The voice describes what's about to be drawn, then the drawing happens, then both finish and move on.
5. **Natural pauses** -- if drawing takes longer than audio, the silence feels like a teacher concentrating. If audio takes longer, the cursor waits before moving on. Both are natural teaching behaviors.

---

## Research Sources

### ElevenLabs
- WebSocket Stream-Input: `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input`
- HTTP Stream + Timestamps: `POST /v1/text-to-speech/{voice_id}/stream/with-timestamps`
- Model: `eleven_flash_v2_5` (~75ms inference, 32 languages, 40k char limit)
- `chunk_length_schedule=[50]` for aggressive low-latency generation
- `flush: true` to force generation at segment boundaries
- `sync_alignment=true` for character-level alignment in WS messages
- `previous_text` / `next_text` params for prosody stitching across requests
- `optimize_streaming_latency=3` for HTTP endpoints

### Fireworks AI (kimi-k2p6)
- TTFT: 0.70-0.71s
- Output speed: 370.8 tokens/sec
- OpenAI-compatible SSE streaming
- Supports function calling (alternative to inline tags)
- `perf_metrics_in_response` for TTFT monitoring

### Streaming Pipeline Patterns
- LiveKit sequential pipeline: 400-800ms vs 1000-2000ms naive
- NEO voice assistant: 1.25s TTFA with sub-sentence streaming
- LLMVoX: 475ms total cascaded pipeline with dual TTS queues
- Sentence-level chunking at punctuation boundaries with 25-char look-ahead
- Pre-warm TTS pipeline before LLM response arrives
