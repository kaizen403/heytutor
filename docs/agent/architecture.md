# Architecture

## Mental Model

```
User question
    ↓
streamLLMResponse()          ← packages/tutor-core (Fireworks SSE via /api/chat)
    ↓
buildLessonSegments()        ← packages/drawing (parse [STEP] blocks + drawing tags)
    ↓
enqueueSegment() → runSegment() ← apps/tutor/features/tutor-session/hooks/
    ↓
TTS (ElevenLabs WS)  +  Whiteboard (Konva)   ← parallel, synced via audioSync.ts
    ↓
saveTurn() → Postgres + R2    ← apps/tutor/app/api/boards/[boardId]/turns
```

## Apps

### `apps/tutor` — main product

Next.js 15 app with a **custom Node server** (`server.ts`) that serves Next.js and relays WebSocket TTS at `/api/tts/ws`.

| Area | Path | Role |
|------|------|------|
| Session route | `app/c/[sessionId]/page.tsx` | Thin wrapper → `TutorSessionPage` |
| Orchestrator | `features/tutor-session/TutorSessionPage.tsx` | Whiteboard, input, replay, settings |
| Turn lifecycle | `features/tutor-session/hooks/useTurnLifecycle.ts` | Composes question + segment hooks |
| Question flow | `hooks/turn/useQuestionHandler.ts` | Submits question, streams LLM, enqueues segments |
| Segment playback | `hooks/turn/useSegmentRunner.ts` | Runs TTS + drawing per segment |
| Command dispatch | `hooks/useCommandExecution.ts` | Executes `DrawCommand`s on whiteboard |
| Board loading | `hooks/useBoardSession.ts` | Fetches board + turns from API |
| Replay | `hooks/useReplay.ts` | Replays saved turns with audio + drawing |
| Custom server | `server.ts` | HTTP + WebSocket TTS relay to ElevenLabs |
| Dev bootstrap | `scripts/dev.ts` | Starts Postgres, runs migrations, starts server |

### `apps/landing` — marketing site

Vite + React 19 static site. No backend. Uses `@heytutor/design-tokens`.

## Package Dependency Graph

```
design-tokens          (standalone)
drawing                (roughjs, tegaki)
tutor-core             → drawing
whiteboard             → drawing, design-tokens
tutor app              → drawing, tutor-core, whiteboard, design-tokens
```

## Data Model (Prisma)

```
User (id from cookie)
  └── Board (id, title, preview)
        └── Turn (question, rawResponse, speedMultiplier, traceId)
              └── Segment (narration, spokenText, command JSON, audioUrl, timings JSON)
```

Schema: `apps/tutor/prisma/schema.prisma`

## Auth

No login. `middleware.ts` sets an httpOnly `htutor_uid` cookie (10-year maxAge). `lib/auth.ts` reads it and upserts a `User` row.

## Split Deploy

Production can split frontend and backend:

| Component | Where | Env |
|-----------|-------|-----|
| Next.js UI | Vercel | `BACKEND_ORIGIN` in middleware |
| API + WebSocket | Azure VM (Docker) | `server.ts` |
| Client API/WS URLs | Browser | `NEXT_PUBLIC_API_ORIGIN`, `NEXT_PUBLIC_WS_ORIGIN` |

See [ci-cd.md](../ci-cd.md).

## Drawing Protocol

The LLM embeds commands inline with narration:

```
[DRAW_RECT:x,y,w,h]  [DRAW_CIRCLE:cx,cy,r]  [DRAW_LINE:x1,y1,x2,y2]
[DRAW_ARC:cx,cy,r,startDeg,endDeg]  [DRAW_POINT:x,y,r?]
[WRITE:text,x,y]     [LABEL:text,x,y]        [PAUSE:ms]
[CLEAR]              [ERASE:x,y,w,h]
[UNDERLINE:...]      [CIRCLE_AROUND:...]     [ARROW:...]  [HIGHLIGHT:...]
```

Responses are wrapped in `[STEP]...[/STEP]` blocks. Each block becomes one or more `TutorSegment`s with paired narration + command.

Full protocol: `packages/drawing/src/drawingProtocol.ts`

## Geometry Engine (Scene IR)

Diagrams are planned as a semantic **SceneSpec** (entities + constraints + quantities), then compiled to exact `DrawCommand`s:

```
question → planScene() / inferSceneFromQuestion()
        → compileScene()  (optics/circuit/euclidean/axes/generic plugins)
        → DiagramTemplate + intro segments
        → teaching LLM (anchors only; no skeleton redraw)
```

| Module | Path |
|--------|------|
| Scene IR | `packages/drawing/src/geometry/sceneSpec.ts` |
| Compiler | `packages/drawing/src/geometry/compileScene.ts` |
| Planner | `packages/tutor-core/src/scenePlanner.ts` (`x-planner` HTTP path) |
| Debug | [geometry-debug.md](geometry-debug.md) |

Regex `DIAGRAM_TEMPLATES` remain as golden fixtures inside domain plugins and verify scripts — `matchDiagramTemplate` is telemetry-only on the live turn path (not a diagram source).


## Local Dev

```bash
pnpm install
cp apps/tutor/.env.example apps/tutor/.env.local   # if present
pnpm dev:tutor
```

`dev.ts` auto-starts Postgres via `docker-compose.yml` (port 5433) when `DATABASE_URL` points at localhost.
