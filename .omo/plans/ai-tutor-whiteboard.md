# AI Tutor Whiteboard — Build Plan

> **Repo base**: `/home/kaizen/heytutor`
> **Reference repo**: https://github.com/farzaa/clicky (cloned at `/tmp/clicky-ref`)
> **Date**: 2026-06-21

---

## 1. What We're Building

A web-based AI math tutor that teaches by **drawing on a whiteboard** — exactly like a teacher on a whiteboard, but there's no teacher. A virtual cursor draws shapes (cuboid, cube) and writes formulas (A² + B²) **stroke-by-stroke** on a canvas, while ElevenLabs voice AI narrates the explanation in real-time.

### User's Vision (verbatim requirements)

> Suppose if I'm given a problem, suppose there's a mathematical equation. For example, we need to find some kind of question around mensuration. There is some volume of cube, volume of cuboid, and we need to find the difference from the cuboid, like between the cuboid and the cube, whatever is left over. And the cube is inside. You have to find the volume of that, the difference between cuboid and the cube.

> I want to use AI and draw on a board. On a board, it needs to draw the cuboid first and then the cube. It needs to write the formula, and the cursor should write the formulas exactly. Like, some kind of formula is A squared + B squared, it should exactly write A squared + B squared and point the cursor exactly there. So it is basically drawing on the screen.

> While writing A squared, it uses voice AI — ElevenLabs for this case — and it says A squared + B squared. And if it's drawing a cuboid, then it can say something like "So let's draw a cuboid with these sides" and it should draw a cuboid. Very quick. And it should draw a cube inside of that.

> The cursor should follow the drawing always, and it should be like a drawing. It should not just show the picture on the screen. It should draw exactly the cuboid, the cube, and while writing the formulas, it should actually write the formulas instead of just putting it on the board. It should draw the numbers like how a teacher teaches on the whiteboard.

> It's exactly the same thing, but what we're doing is we are using this cursor here to draw exactly how the teacher draws on the board. So that's how you can think of representing it — like a teacher is drawing on the board, but there's no teacher. There is just a cursor writing on the board, not typing the text. It's actually writing on the board.

### Key Behaviors

1. **Virtual cursor draws shapes** — cuboid drawn first, then cube drawn inside it
2. **Cursor writes formulas** — actually writes "A² + B²" stroke-by-stroke, not just displays text
3. **Cursor follows the drawing always** — the cursor moves along the path being drawn
4. **Voice narration synced** — ElevenLabs says "A squared plus B squared" while the cursor writes it
5. **Teacher-like experience** — it's like watching a teacher draw on a whiteboard, but there's no teacher, just a cursor
6. **Stroke-by-stroke** — shapes and text are drawn progressively, not shown as finished images

---

## 2. Why We're Using Clicky

Clicky (https://github.com/farzaa/clicky) is an AI teacher that lives as a cursor on Mac. It's already implemented:
- Claude API integration with SSE streaming
- ElevenLabs TTS integration (model: `eleven_flash_v2_5`)
- Cloudflare Worker proxy pattern (hides API keys)
- Cursor animation with bezier arc math
- State machine (idle → processing → responding)
- System prompt structure for teaching AI
- Tag parsing protocol (`[POINT:x,y:label]`)
- Conversation history (last 10 exchanges)
- Design system (colors, animations, cursor shapes)

We port Clicky's proven logic to TypeScript/React instead of reinventing it.

### What Clicky Does NOT Have (We Build New)

Clicky does NOT draw shapes or write text on a whiteboard. It's a cursor companion that follows the mouse and points at UI elements. The `[POINT:x,y]` protocol just flies the cursor to a single coordinate. There is zero drawing path generation logic in Clicky.

We need to build:
- Canvas whiteboard surface
- Shape path generation (cuboid, cube as animated SVG paths)
- Handwriting-style text/formula rendering
- Stroke-by-stroke animation with virtual cursor following the path
- Voice-drawing synchronization
- Extended drawing command protocol (not just `[POINT:x,y]`)

---

## 3. Clicky Research Summary

### Architecture (from CLAUDE.md / AGENTS.md)

- **App Type**: macOS menu bar-only app (SwiftUI + AppKit)
- **AI Chat**: Claude (Sonnet 4.6 default) via Cloudflare Worker proxy with SSE streaming
- **TTS**: ElevenLabs (`eleven_flash_v2_5` model) via Worker proxy
- **STT**: AssemblyAI real-time streaming (we drop this — text input only)
- **Screen Capture**: ScreenCaptureKit (we drop this — we draw on our own canvas)
- **Element Pointing**: Claude embeds `[POINT:x,y:label:screenN]` tags → cursor flies to that position via bezier arc
- **Concurrency**: @MainActor, async/await

### Key Files Analyzed

| File | Lines | What It Does |
|------|-------|-------------|
| `CompanionManager.swift` | 1,026 | Central state machine, AI pipeline, system prompt, tag parser |
| `OverlayWindow.swift` | 881 | Transparent overlay, cursor tracking, bezier flight animation, triangle cursor, waveform, spinner |
| `ClaudeAPI.swift` | 291 | Claude vision API client with SSE streaming, conversation history, message building |
| `ElevenLabsTTSClient.swift` | 81 | ElevenLabs TTS client, `eleven_flash_v2_5` model, `AVAudioPlayer` playback |
| `worker/src/index.ts` | 141 | Cloudflare Worker proxy: `/chat`, `/tts`, `/transcribe-token` |
| `CompanionResponseOverlay.swift` | 217 | Text bubble near cursor, cursor tracking, fade-out |
| `DesignSystem.swift` | 880 | Colors (`overlayCursorBlue: #3380FF`), corner radii, animation durations |
| `BuddyDictationManager.swift` | 866 | Push-to-talk pipeline (DROP — no mic) |
| `AssemblyAIStreamingTranscriptionProvider.swift` | 478 | WebSocket STT (DROP — no mic) |
| `ElementLocationDetector.swift` | 335 | Computer Use API for UI element coords (DROP — no screen capture) |
| `GlobalPushToTalkShortcutMonitor.swift` | 132 | CGEvent tap (DROP — no global hotkey) |
| `CompanionScreenCaptureUtility.swift` | 132 | ScreenCaptureKit (DROP — no screen capture) |
| `MenuBarPanelManager.swift` | 243 | NSStatusItem menu bar (DROP — no menu bar) |
| `WindowPositionManager.swift` | 262 | macOS permissions (DROP — no macOS) |

### Clicky's Data Flow (Pipeline We Port)

```
User input (voice in Clicky, text in ours)
  ↓
voiceState = .processing (spinner)
  ↓
Capture screenshot (DROP — we don't need this)
  ↓
Send to Claude via Worker proxy (SSE streaming)
  ↓
Collect full response text
  ↓
Parse [POINT:x,y:label] tag from response
  ↓
Strip tag from spoken text
  ↓
Send spoken text to ElevenLabs TTS via Worker proxy
  ↓
voiceState = .responding (waveform)
  ↓
Play audio (AVAudioPlayer)
  ↓
Animate cursor to target via bezier arc
  ↓
voiceState = .idle
```

### Clicky's System Prompt (CompanionManager.swift L544-577)

```
you're clicky, a friendly always-on companion that lives in the user's menu bar.
the user just spoke to you via push-to-talk and you can see their screen(s).
your reply will be spoken aloud via text-to-speech, so write the way you'd actually talk.

rules:
- default to one or two sentences. be direct and dense.
- all lowercase, casual, warm. no emojis.
- write for the ear, not the eye. short sentences. no lists, bullet points, markdown.
- don't use abbreviations or symbols that sound weird read aloud.
- never say "simply" or "just".
- focus on giving a thorough, useful explanation.

element pointing:
you have a small blue triangle cursor that can fly to and point at things on screen.
when you point, append a coordinate tag at the very end of your response.
format: [POINT:x,y:label] where x,y are integer pixel coordinates.
```

### Clicky's Tag Parser (CompanionManager.swift L784-823)

Parses `[POINT:x,y:label:screenN]` or `[POINT:none]` from end of Claude's response using regex:
```
\[POINT:(?:none|(\d+)\s*,\s*(\d+)(?::([^\]:\s][^\]:]*?))?(?::screen(\d+))?)\]\s*$
```
Returns: spoken text (tag removed), coordinate, label, screen number.

### Clicky's Bezier Arc Animation (OverlayWindow.swift L495-568)

Quadratic bezier with smoothstep easing:
```
B(t) = (1-t)²·P0 + 2(1-t)t·P1 + t²·P2
Smoothstep: 3t² - 2t³
Tangent rotation: atan2(tangentY, tangentX) * 180/π + 90
Scale pulse: 1 + sin(t·π)·0.3
60fps Timer → requestAnimationFrame
```

### Clicky's Cursor States (OverlayWindow.swift)

- **Triangle** — idle/responding (blue, glowing, follows cursor)
- **Waveform** — listening (5 audio-reactive bars)
- **Spinner** — processing (blue spinning arc)

### Clicky's Worker Proxy (worker/src/index.ts)

Three routes, already in TypeScript:
- `POST /chat` → `api.anthropic.com/v1/messages` (Claude, SSE streaming)
- `POST /tts` → `api.elevenlabs.io/v1/text-to-speech/{voiceId}` (ElevenLabs)
- `POST /transcribe-token` → AssemblyAI token (DROP)

Secrets: `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`
Vars: `ELEVENLABS_VOICE_ID`

### Clicky's ElevenLabs TTS (ElevenLabsTTSClient.swift)

```swift
model_id: "eleven_flash_v2_5"
voice_settings: { stability: 0.5, similarity_boost: 0.75 }
// Sends text to Worker proxy, plays back via AVAudioPlayer
```

### Clicky's Claude API (ClaudeAPI.swift)

- SSE streaming: parses `data: {json}` lines, extracts `content_block_delta` events
- Message building: conversation history + current turn with images + user prompt
- `max_tokens: 1024`, `stream: true`
- TLS warmup optimization (DROP — browser handles it)

---

## 4. Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 15 (React 19) | API routes for proxy, SSR, easy deployment |
| Canvas Engine | Konva.js | Built-in `getPointAtLength()` for cursor-along-path animation, layered architecture |
| Hand-drawn Shapes | Rough.js | Same engine as Excalidraw — sketchy rectangles, cubes with `roughness` parameter |
| Handwriting | opentype.js | Load Caveat font, extract glyph outlines, produce SVG path data per character for stroke animation |
| Animation | GSAP (Timeline + MotionPath) | Orchestrate sequences: draw shape → write formula → next |
| Voice (TTS) | ElevenLabs `/stream/with-timestamps` | Character-level timing for audio-canvas sync |
| API Proxy | Next.js API routes | Replaces Clicky's Cloudflare Worker — keeps keys server-side |
| LLM | Claude (via proxy) | Generates narration text + drawing commands |

### Dependencies

```json
{
  "dependencies": {
    "next": "^15",
    "react": "^19",
    "konva": "^9",
    "react-konva": "^19",
    "roughjs": "^4",
    "opentype.js": "^1.3",
    "gsap": "^3"
  }
}
```

---

## 5. File-by-File Port Map

### What We PORT Directly (Clicky logic → TypeScript)

| Clicky Source File | Lines | Web Equivalent | What We Port |
|---|---|---|---|
| `worker/src/index.ts` | 141 | `app/api/chat/route.ts` + `app/api/tts/route.ts` | Near-verbatim copy. Already TypeScript. Same routes: `/chat` (Claude proxy), `/tts` (ElevenLabs proxy). Drop `/transcribe-token`. Adapt to Next.js route handlers. |
| `ClaudeAPI.swift` | 291 | `lib/claudeAPI.ts` | SSE streaming logic. Same message building (conversation history + current turn). Same SSE parsing (`data:` prefix, `[DONE]` marker, `content_block_delta` events). Same `max_tokens: 1024`, `stream: true`. Drop image MIME detection (no screenshots). Drop TLS warmup (browser handles it). |
| `ElevenLabsTTSClient.swift` | 81 | `lib/elevenLabsClient.ts` | TTS request pattern. Same model (`eleven_flash_v2_5`), same voice settings (`stability: 0.5, similarity_boost: 0.75`), same proxy pattern. Replace `AVAudioPlayer` with Web Audio API (`AudioContext.decodeAudioData`). Add `/stream/with-timestamps` endpoint for character-level timing (Clicky doesn't have this — we need it for sync). |
| `CompanionManager.swift` | 1,026 | `lib/tutorManager.ts` | State machine + pipeline. Port `voiceState` enum → `tutorState` (idle/thinking/drawing/speaking). Port `conversationHistory` (last 10 exchanges). Port `sendTranscriptToClaudeWithScreenshot()` pipeline → `processQuestion()`. Port error fallback. Adapt system prompt for math teaching. |
| `CompanionManager.swift` (L544-577) | 34 | `lib/systemPrompt.ts` | System prompt structure. Keep style rules (lowercase, casual, write for the ear, no emojis). Replace "element pointing" section with "drawing commands" section. Replace `[POINT:x,y:label]` with drawing tags. |
| `CompanionManager.swift` (L784-823) | 40 | `lib/drawingProtocol.ts` | Tag parsing pattern. Clicky parses `[POINT:x,y:label:screenN]` with regex. We extend to parse multiple tag types: `[DRAW_CUBOID:...]`, `[DRAW_CUBE:...]`, `[WRITE:...]`, `[DRAW_LINE:...]`, `[DRAW_CIRCLE:...]`, `[LABEL:...]`, `[PAUSE:ms]`, `[CLEAR]`. Same regex approach, same "strip tags from spoken text" pattern. |
| `OverlayWindow.swift` (L495-568) | 74 | `lib/cursorAnimation.ts` | Bezier arc animation. Port quadratic bezier math: `B(t) = (1-t)²·P0 + 2(1-t)t·P1 + t²·P2`. Port smoothstep easing (`3t² - 2t³`). Port tangent-based rotation (`atan2`). Port scale pulse (`sin(t·π)·0.3`). Replace `Timer.scheduledTimer` with `requestAnimationFrame`. |
| `OverlayWindow.swift` (L56-71) | 16 | `components/VirtualCursor.tsx` | Triangle cursor. Port equilateral triangle shape to SVG `<polygon>`. Port blue glow shadow. Port rotation. |
| `OverlayWindow.swift` (L749-774) | 26 | `components/ThinkingSpinner.tsx` | Spinner animation. Port `Circle().trim(0.15, 0.85)` + `AngularGradient` + `repeatForever` to canvas/SVG rotation animation. |
| `OverlayWindow.swift` (L709-743) | 35 | `components/SpeakingWaveform.tsx` | Waveform animation. Port 5-bar audio-reactive waveform. Port idle pulse + reactive height math. Replace `TimelineView(.animation)` with `requestAnimationFrame`. |
| `CompanionResponseOverlay.swift` | 217 | `components/ResponseBubble.tsx` | Text bubble near cursor. Port bubble styling (dark surface, rounded corners, shadow). Port cursor-tracking positioning. Port fade-out behavior. |
| `DesignSystem.swift` | 880 | `lib/designTokens.ts` | Design tokens. Port `overlayCursorBlue: #3380FF`, surface colors, corner radii, animation durations. |

### What We DROP (Not Needed for Web MVP)

| File | Lines | Why Drop |
|---|---|---|
| `BuddyDictationManager.swift` | 866 | No mic — text input only |
| `AssemblyAIStreamingTranscriptionProvider.swift` | 478 | No STT |
| `GlobalPushToTalkShortcutMonitor.swift` | 132 | No global hotkey |
| `CompanionScreenCaptureUtility.swift` | 132 | No screen capture |
| `ElementLocationDetector.swift` | 335 | No Computer Use API |
| `MenuBarPanelManager.swift` | 243 | No menu bar |
| `WindowPositionManager.swift` | 262 | No macOS permissions |
| `BuddyTranscriptionProvider.swift` | 100 | No STT providers |
| `OpenAIAudioTranscriptionProvider.swift` | 317 | No STT |
| `AppleSpeechTranscriptionProvider.swift` | 147 | No STT |
| `BuddyAudioConversionSupport.swift` | 108 | No mic audio |
| `ClickyAnalytics.swift` | 121 | No analytics for MVP |
| **Total dropped** | **3,241** | |

### What We BUILD NEW (Clicky Doesn't Have)

| New File | What It Does | Est. Lines |
|---|---|---|
| `components/Whiteboard.tsx` | Konva canvas with 3 layers (draw, animation, cursor). The whiteboard surface. | ~150 |
| `components/InputBar.tsx` | Text input where user types the math question. | ~50 |
| `lib/shapePaths.ts` | Generate SVG path data for cuboid, cube, rectangle, circle, line. Drawing primitives with isometric projection for 3D shapes. | ~120 |
| `lib/strokeAnimation.ts` | Animate stroke-by-stroke reveal using `stroke-dashoffset` + `getPointAtLength()` for cursor position along path. The "teacher writing on board" effect. | ~100 |
| `lib/handwriting.ts` | Convert text → stroke paths using opentype.js. Load Caveat font, extract glyph outlines, produce SVG path data per character. Animate each character stroke. | ~80 |
| `lib/audioSync.ts` | Map ElevenLabs character timestamps to drawing command start times. `AudioContext.currentTime` master clock drives both audio playback and canvas animation. | ~100 |
| **Total new** | | **~600** |

---

## 6. Extended Drawing Protocol

### Replacing Clicky's `[POINT:x,y:label]`

Clicky uses one tag at the end of the response. We extend to **multiple tags embedded throughout** the response, each at the position where the narration should be spoken while drawing.

### Tag Types

```
[DRAW_CUBOID:x,y,width,height,depth]  — draw a 3D cuboid
[DRAW_CUBE:x,y,size]                  — draw a 3D cube
[DRAW_RECT:x,y,width,height]          — draw a 2D rectangle
[DRAW_CIRCLE:x,y,radius]              — draw a circle
[DRAW_LINE:x1,y1,x2,y2]              — draw a line
[WRITE:text,x,y]                      — write text on the board (handwritten style)
[LABEL:text,x,y]                      — short label near a shape
[PAUSE:ms]                            — pause before continuing
[CLEAR]                               — clear the board
```

### Example Response

```
So let's draw a cuboid with length 10, width 8, and height 6. [DRAW_CUBOID:200,150,300,200,80]
The volume of a cuboid is length times width times height. [WRITE:V = l x w x h,200,420]
Now let's draw a cube inside the cuboid. [DRAW_CUBE:350,180,140]
The volume of a cube is side cubed. So if the side is 5, that's 5 cubed which is 125. [WRITE:V = s^3 = 5^3 = 125,350,420]
The difference is the cuboid volume minus the cube volume. [WRITE:Difference = V1 - V2,200,480]
```

### Parser Logic (Extended from Clicky's `parsePointingCoordinates`)

The parser extracts:
1. **Narration segments** — text between tags (what gets spoken)
2. **Drawing commands** — the parsed tag data with their character position in the narration
3. **Sync mapping** — each command knows which narration segment it belongs to and the character range

Regex pattern (extended from Clicky's):
```
\[(DRAW_CUBOID|DRAW_CUBE|DRAW_RECT|DRAW_CIRCLE|DRAW_LINE|WRITE|LABEL|PAUSE|CLEAR):([^\]]*)\]
```

For each match:
- Extract tag type and parameters
- Text before the tag = narration segment for that command
- Strip all tags from full response = complete narration for TTS
- Record character positions for audio sync

---

## 7. Adapted System Prompt

```
you're an AI math tutor that teaches by drawing on a whiteboard. the user
types a question and you respond with narration plus drawing commands. your
response will be spoken aloud via text-to-speech, so write the way you'd
talk. the drawing commands will be executed stroke-by-stroke on a canvas
while your narration plays. this is an ongoing conversation — you remember
everything they've said before.

rules:
- all lowercase, casual, warm. no emojis.
- write for the ear, not the eye. short sentences. no lists, bullet points, markdown, or formatting.
- spell out math: write "a squared" not "a²", write "five cubed" not "5³"
- draw shapes first, then write formulas
- one concept at a time, keep it simple
- never say "simply" or "just"
- don't end with simple yes/no questions. end by planting a seed — mention
  something bigger they could try, a related concept that goes deeper.

drawing commands (embed in your response at the point where they should execute):
[DRAW_CUBOID:x,y,width,height,depth] — draw a 3D cuboid
[DRAW_CUBE:x,y,size] — draw a 3D cube
[DRAW_RECT:x,y,width,height] — draw a 2D rectangle
[DRAW_CIRCLE:x,y,radius] — draw a circle
[DRAW_LINE:x1,y1,x2,y2] — draw a line
[WRITE:text,x,y] — write text on the board (handwritten style)
[LABEL:text,x,y] — short label near a shape
[PAUSE:ms] — pause before continuing
[CLEAR] — clear the board

coordinate space: 1200x700 canvas, origin (0,0) top-left, x rightward, y downward.

examples:
- "so let's draw a cuboid with these sides. [DRAW_CUBOID:200,150,300,200,80] the volume of a cuboid is length times width times height. [WRITE:V = l x w x h,200,420]"
- "now let's draw a cube inside. [DRAW_CUBE:350,180,140] the volume of a cube is side cubed. [WRITE:V = s^3,350,420]"
```

---

## 8. The Pipeline (Ported from CompanionManager)

```
User types question in InputBar
  ↓
tutorState = 'thinking' (show spinner near cursor)
  ↓
Send to Claude via /api/chat (SSE streaming — same as Clicky)
  ↓
Collect full response text (same as Clicky's accumulate pattern)
  ↓
Parse drawing commands from response (extended from parsePointingCoordinates)
  ↓
Split into: narration segments + drawing commands (with char positions)
  ↓
Send narration to /api/tts (ElevenLabs with timestamps — extended from Clicky)
  ↓
tutorState = 'speaking' (show waveform near cursor)
tutorState = 'drawing' (start canvas animation)
  ↓
AudioContext.currentTime = master clock
  ↓
For each drawing command:
  1. Wait until audio reaches command's char position (from timestamps)
  2. Generate SVG path for the shape (shapePaths.ts)
  3. Animate stroke-by-stroke (strokeAnimation.ts — stroke-dashoffset)
  4. Virtual cursor follows path via getPointAtLength() (cursorAnimation.ts)
  5. If WRITE command: render text via opentype.js → per-character stroke paths
  6. Command completes → next command
  ↓
Audio finishes → tutorState = 'idle'
```

### State Machine (Ported from Clicky's CompanionVoiceState)

```
Clicky:                    Ours:
idle              →       idle
listening         →       (drop — no mic)
processing        →       thinking
responding        →       speaking
                          drawing (new — canvas animation active)
```

---

## 9. Cursor Animation (Ported from OverlayWindow.swift)

### Bezier Arc Flight (Port from L495-568)

The cursor flies between drawing positions using the same quadratic bezier:

```
B(t) = (1-t)²·P0 + 2(1-t)t·P1 + t²·P2
Smoothstep: 3t² - 2t³
Tangent rotation: atan2(tangentY, tangentX) * 180/π + 90
Scale pulse: 1 + sin(t·π)·0.3
```

- `Timer.scheduledTimer(0.016)` → `requestAnimationFrame`
- `NSEvent.mouseLocation` → virtual cursor position (follows drawing path, not mouse)
- `NSHostingView` → Konva layer

### Cursor During Drawing (New)

While drawing a shape or writing text, the cursor follows the SVG path:
```
pathEl.getTotalLength() → total path length
pathEl.getPointAtLength(distance) → cursor position at given distance
strokeDashoffset = totalLength - distance → stroke reveals as cursor moves
```

### Cursor Visual States (Ported from OverlayWindow)

- **Triangle** (blue, glowing) — idle or drawing
- **Spinner** (blue spinning arc) — thinking/processing
- **Waveform** (5 audio-reactive bars) — speaking/narrating

---

## 10. Audio-Canvas Synchronization

### The Sync Problem

The cursor draws shapes while ElevenLabs narrates. We need:
- Shape drawing starts when narration says "let's draw a cuboid"
- Formula writing starts when narration says "the volume is"
- Each completes in sync with the narration

### Solution: ElevenLabs Character Timestamps

Use the `/stream/with-timestamps` endpoint (or WebSocket `alignment` field):

```typescript
interface Alignment {
  characters: string[];                    // ["H", "e", "l", "l", "o"]
  character_start_times_seconds: number[]; // [0.0, 0.05, 0.12, 0.18, 0.25]
  character_end_times_seconds: number[];   // [0.05, 0.12, 0.18, 0.25, 0.35]
}
```

### Sync Logic

1. Parse response into narration segments + drawing commands
2. Each command knows its character position range in the narration
3. Send narration to ElevenLabs `/stream/with-timestamps`
4. Receive character-level timing
5. Map each command's char range → start time in audio
6. `AudioContext.currentTime` = master clock
7. `requestAnimationFrame` loop checks elapsed audio time
8. When elapsed time reaches a command's start time, begin that command's drawing animation
9. Drawing animation duration = command's char range duration in audio

### Math Expression Pronunciation

Pre-process math notation before sending to TTS:
```typescript
function mathToSpeech(text: string): string {
  return text
    .replace(/(\w)²/g, '$1 squared')
    .replace(/(\w)³/g, '$1 cubed')
    .replace(/√(\d+)/g, 'square root of $1')
    .replace(/π/g, 'pi')
    .replace(/×/g, 'times')
    .replace(/÷/g, 'divided by');
}
```

---

## 11. Shape Path Generation

### Cuboid (3D Box) — Isometric Projection

```
Front face:  rectangle at (x, y, width, height)
Back face:   rectangle at (x+depth, y-depth, width, height) (partial — only visible edges)
Depth lines: 4 lines connecting front corners to back corners
```

SVG path:
```
M x,y L x+w,y L x+w,y+h L x,y+h Z     (front face)
M x,y L x+d,y-d                        (top-left depth line)
M x+w,y L x+w+d,y-d                    (top-right depth line)
M x+w,y+h L x+w+d,y+h-d                (bottom-right depth line)
M x,y+h L x+d,y+h-d                    (bottom-left depth line)
M x+d,y-d L x+w+d,y-d L x+w+d,y+h-d L x+d,y+h-d Z  (back face visible edges)
```

### Cube

Special case of cuboid where width = height = size and depth = size * 0.5 (isometric).

### Hand-drawn Aesthetic

Use Rough.js to generate sketchy versions of the paths:
```javascript
const rc = rough.canvas(canvas);
const drawable = rc.generator.rectangle(x, y, w, h, { roughness: 1.5, stroke: '#222', strokeWidth: 2 });
```

Rough.js returns `Drawable` with `sets[].ops[]` — animate ops sequentially for stroke-by-stroke effect.

---

## 12. Handwriting Animation

### Text → Stroke Paths

Using opentype.js with Caveat font:

```typescript
import opentype from 'opentype.js';

const font = await opentype.load('/fonts/Caveat.ttf');
const path = font.getPath('V = l × w × h', x, y, 48);
const pathData = path.toPathData();

// Create SVG path element to measure
const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
pathEl.setAttribute('d', pathData);
const length = pathEl.getTotalLength();

// Animate with stroke-dashoffset
pathEl.style.strokeDasharray = length;
pathEl.style.strokeDashoffset = length;
// Animate strokeDashoffset → 0 (stroke reveals progressively)
```

### Per-Character Animation

For more realistic handwriting, animate each character separately:
1. Split text into characters
2. Get glyph path for each character via `font.getPath(char, x, y, fontSize)`
3. Animate each character's stroke-dashoffset sequentially
4. Cursor follows along each character's path

---

## 13. Project Structure

```
/home/kaizen/heytutor
├── app/
│   ├── page.tsx                    # Whiteboard + input bar (main page)
│   ├── layout.tsx                  # Root layout
│   └── api/
│       ├── chat/route.ts           # ← PORT from worker/src/index.ts handleChat()
│       └── tts/route.ts            # ← PORT from worker/src/index.ts handleTTS()
├── components/
│   ├── Whiteboard.tsx              # NEW: Konva canvas (3 layers: draw, animation, cursor)
│   ├── VirtualCursor.tsx           # ← PORT from OverlayWindow.swift Triangle
│   ├── ThinkingSpinner.tsx         # ← PORT from OverlayWindow.swift BlueCursorSpinnerView
│   ├── SpeakingWaveform.tsx        # ← PORT from OverlayWindow.swift BlueCursorWaveformView
│   ├── ResponseBubble.tsx          # ← PORT from CompanionResponseOverlay.swift
│   └── InputBar.tsx                # NEW: text input where user types question
├── lib/
│   ├── claudeAPI.ts                # ← PORT from ClaudeAPI.swift (SSE streaming)
│   ├── elevenLabsClient.ts         # ← PORT from ElevenLabsTTSClient.swift
│   ├── tutorManager.ts             # ← PORT from CompanionManager.swift (state machine)
│   ├── systemPrompt.ts             # ← PORT from CompanionManager.swift (adapted prompt)
│   ├── drawingProtocol.ts          # ← PORT from CompanionManager.swift (extended parser)
│   ├── cursorAnimation.ts          # ← PORT from OverlayWindow.swift (bezier math)
│   ├── shapePaths.ts               # NEW: SVG path generation for shapes
│   ├── strokeAnimation.ts          # NEW: stroke-dashoffset + getPointAtLength
│   ├── handwriting.ts              # NEW: opentype.js text → stroke paths
│   ├── audioSync.ts                # NEW: ElevenLabs timestamps → canvas timing
│   └── designTokens.ts             # ← PORT from DesignSystem.swift
├── public/
│   └── fonts/
│       └── Caveat.ttf              # Handwriting font for opentype.js
├── .env.local                      # ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
└── package.json
```

---

## 14. Design Tokens (Ported from DesignSystem.swift)

```typescript
export const DS = {
  Colors: {
    overlayCursorBlue: '#3380FF',   // ← from Clicky
    background: '#101211',          // ← from Clicky
    surface1: '#171918',            // ← from Clicky
    surface2: '#202221',            // ← from Clicky
    borderSubtle: '#373B39',        // ← from Clicky
    textPrimary: '#ECEEED',         // ← from Clicky
    textSecondary: '#ADB5B2',       // ← from Clicky
    whiteboard: '#F8F6F0',          // NEW: warm whiteboard background
    ink: '#1A1A1A',                 // NEW: dark ink for drawing
  },
  CornerRadius: {
    small: 6,
    medium: 8,
    large: 10,
  },
  Animation: {
    fast: 0.15,                     // ← from Clicky
    normal: 0.25,                   // ← from Clicky
    slow: 0.4,                      // ← from Clicky
  },
  Cursor: {
    size: 16,                       // ← from Clicky (triangle frame size)
    glowRadius: 8,                  // ← from Clicky (shadow radius)
    flightScalePeak: 1.3,           // ← from Clicky (buddyFlightScale at midpoint)
    rotationDefault: -35,           // ← from Clicky (triangleRotationDegrees default)
  },
} as const;
```

---

## 15. Mock Mode (No API Keys Needed)

Since the user doesn't have API keys yet, the app runs in **mock mode**:

- `/api/chat` returns a hardcoded mock response with drawing commands for the cuboid + cube problem
- `/api/tts` returns silence or a short beep placeholder
- The full drawing + cursor animation pipeline works end-to-end
- When API keys are added to `.env.local`, it switches to real Claude + ElevenLabs automatically

### Mock Response Example

```
So let's draw a cuboid with length 10, width 8, and height 6. [DRAW_CUBOID:200,150,300,200,80]
The volume of a cuboid is length times width times height. [WRITE:V = l x w x h,200,420]
Now let's draw a cube inside the cuboid. [DRAW_CUBE:350,180,140]
The volume of a cube is side cubed. So if the side is 5, that's 5 cubed which is 125. [WRITE:V = s^3 = 125,350,420]
The difference is the cuboid volume minus the cube volume. [WRITE:Difference = V1 - V2,200,480]
```

---

## 16. Build Phases

### Phase 1: Core Drawing Engine (No API Keys Needed)

**Goal**: Whiteboard + animated cursor drawing shapes and writing text

1. Next.js project setup in `/home/kaizen/heytutor`
2. Install dependencies: konva, react-konva, roughjs, opentype.js, gsap
3. Port worker proxy routes → `app/api/chat/route.ts` + `app/api/tts/route.ts`
4. Port Claude API client → `lib/claudeAPI.ts` (SSE streaming)
5. Port design tokens → `lib/designTokens.ts`
6. Build `components/Whiteboard.tsx` — Konva canvas with 3 layers
7. Build `lib/shapePaths.ts` — SVG path generation for cuboid, cube, rectangle, line
8. Build `lib/strokeAnimation.ts` — stroke-dashoffset animation + getPointAtLength cursor
9. Build `lib/handwriting.ts` — opentype.js text → stroke paths
10. Port cursor animation → `lib/cursorAnimation.ts` — bezier arc math
11. Port triangle cursor → `components/VirtualCursor.tsx`
12. Port spinner → `components/ThinkingSpinner.tsx`
13. Port waveform → `components/SpeakingWaveform.tsx`
14. Build `components/InputBar.tsx` — text input
15. Build mock response system — hardcoded drawing commands for testing
16. Wire up: type question → mock response → parse commands → animate drawing on canvas

**Phase 1 Success Criteria**: Type "find the volume difference between a cuboid and a cube inside it" → cursor draws cuboid, then cube inside it, then writes formulas — all stroke-by-stroke with the cursor following the drawing path. No audio yet.

### Phase 2: Voice + Sync

**Goal**: ElevenLabs TTS narration synced to drawing

1. Port ElevenLabs TTS client → `lib/elevenLabsClient.ts`
2. Add `/stream/with-timestamps` endpoint support in `/api/tts/route.ts`
3. Build `lib/audioSync.ts` — character timestamps → drawing command timing
4. Implement `AudioContext.currentTime` master clock
5. Wire up: narration plays via Web Audio API, drawing starts at correct timestamp for each command
6. Port response bubble → `components/ResponseBubble.tsx` — shows narration text near cursor
7. Implement math expression pronunciation pre-processing

**Phase 2 Success Criteria**: Same as Phase 1 but with voice. Cursor draws cuboid while voice says "let's draw a cuboid", writes formula while voice says "volume equals length times width times height".

### Phase 3: AI Brain

**Goal**: Real Claude integration with math tutor system prompt

1. Port system prompt → `lib/systemPrompt.ts` (adapted for math teaching)
2. Port drawing protocol parser → `lib/drawingProtocol.ts` (extended tag parser)
3. Port tutor manager → `lib/tutorManager.ts` (state machine + pipeline)
4. Port conversation history (last 10 exchanges)
5. Wire up: real Claude API → parse drawing commands → drive animation + TTS
6. Add error handling and fallbacks (ported from Clicky's error patterns)
7. Test with real API keys

**Phase 3 Success Criteria**: Type any math question → Claude generates narration + drawing commands → cursor draws and writes on whiteboard while narrating via ElevenLabs. Full end-to-end AI tutor.

---

## 17. Summary: Port vs New

| Metric | Clicky (Swift) | Our Web App (TS/React) |
|---|---|---|
| Ported code | ~1,500 lines Swift | ~1,500 lines TypeScript (logic translated) |
| New code | 0 (Clicky doesn't draw) | ~600 lines (canvas, shapes, strokes, handwriting, sync) |
| Dropped code | ~3,241 lines (mic, STT, screen capture, permissions, menu bar) | 0 |
| Architecture | Same pipeline, same proxy, same state machine | Same + drawing layer |

---

## 18. API Keys Needed (When Ready)

```env
# .env.local
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=kPzsL2i3teMYv0FxEYQ6
```

Until keys are added, the app runs in mock mode with hardcoded responses.

---

## 19. Reference Projects (Proven Patterns)

| Project | What to Reference |
|---------|-------------------|
| [farzaa/clicky](https://github.com/farzaa/clicky) | Architecture, proxy, Claude SSE, ElevenLabs, cursor animation, state machine |
| [Sparks AI Math Tutor](https://github.com/thegauravmahto/sparks-ai-math-tutor) | Rough.js + KaTeX + function-plot for math whiteboard |
| [Professor KIA](https://github.com/HassanFazal97/Professor-KIA) | Font → stroke paths, MathJax SVG pipeline for handwriting |
| [MathBoard](https://github.com/RajShah3006/Gemini_Live_Agent_Challenge) | Canvas tools: draw_latex, draw_graph, draw_text, glowing cursor |
| [BoardyBoo](https://github.com/HamaRegaya/BoardyBoo) | Excalidraw + Framer Motion staggered animation |
| [simstudioai/sim](https://github.com/simstudioai/sim) | React hook + backend proxy for TTS streaming |
| [mastra-ai/mastra](https://github.com/mastra-ai/mastra) | Web Audio API playback from ReadableStream |
| [Deodat-Lawson/LaunchStack](https://github.com/Deodat-Lawson/LaunchStack) | Next.js route handler for TTS proxy |

---

## 20. Input Method

- **Text input only** for MVP (no mic, no push-to-talk)
- User types math question in InputBar
- No browser mic permissions needed
- No AssemblyAI STT integration needed
- Simpler, faster to build, easier to test
