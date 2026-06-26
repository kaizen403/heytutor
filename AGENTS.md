# heytutor — AGENTS.md

AI whiteboard math tutor that teaches by narrating and drawing simultaneously. pnpm + Turborepo monorepo, deployed on Vercel.

## Quick Reference

| | |
|---|---|
| **Package manager** | pnpm@10.32.0 |
| **Node** | 20 (CI) |
| **Build orchestrator** | Turborepo ^2.5.4 |
| **CI gates** | `pnpm turbo run lint typecheck build` |
| **Test framework** | None (quality gates are lint + typecheck + build) |
| **Deploy** | Vercel (per-app Root Directory) |

## Commands

```bash
# Setup
pnpm install
cp apps/tutor/.env.example apps/tutor/.env.local
wrangler login && pnpm r2:setup          # provision Cloudflare R2

# Dev (all via turbo)
pnpm dev                                  # both apps
pnpm dev:tutor                            # tutor only → :3000
pnpm dev:landing                          # landing only → :5173
pnpm dev:tutor:reset                      # clear .next + restart

# Quality gates
pnpm build                                # turbo run build
pnpm typecheck                            # turbo run typecheck
pnpm lint                                 # turbo run lint

# Database (tutor app)
pnpm --filter @heytutor/tutor db:generate
pnpm --filter @heytutor/tutor db:migrate:dev

# Clean
pnpm clean                                # turbo run clean
```

## Monorepo Structure

```
apps/
  tutor/      @heytutor/tutor      Next.js 15 whiteboard tutor (product)
  landing/    @heytutor/landing    Vite marketing site
packages/
  design-tokens/     @heytutor/design-tokens     Design system constants
  drawing/           @heytutor/drawing            Drawing protocol, parser, shapes, animation
  tutor-core/        @heytutor/tutor-core         LLM/TTS clients, system prompt, sync, mock
  whiteboard/        @heytutor/whiteboard         Konva canvas component + visual indicators
  typescript-config/ @heytutor/typescript-config  Shared tsconfig presets (base/react-library/nextjs)
  eslint-config/     @heytutor/eslint-config      Shared ESLint flat configs (next/react)
```

**Naming:** All internal packages use `@heytutor/*` scope. Internal deps use `"workspace:*"`.

**Root scripts:** Only delegate via `turbo run`. No build logic at root.

## Package Dependency Graph

```
typescript-config                eslint-config
       │                              │
   ┌───┴───┐                     ┌────┴────┐
 base  react-lib               next.mjs  react.mjs
   │       │
   ├── design-tokens
   ├── drawing ─────────────────┐
   │                            │
   ├── tutor-core ◄─────────────┘  (depends on drawing for types)
   │
   └── whiteboard ◄─────────────┐  (depends on drawing for handwriting)
         peerDeps: konva,        │
         react, react-dom,       │
         react-konva             │
```

All 4 runtime packages build with `tsup --format esm --dts`. All are `"private": true` (not published).

## apps/tutor

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router), React 19 |
| Styling | Tailwind CSS v4 (CSS-first, no config file) |
| UI primitives | Radix UI (shadcn-style components in `components/ui/`) |
| Canvas | Konva 10 + react-konva 19 |
| Handwriting | roughjs, tegaki |
| Animation | GSAP 3 |
| Database | Prisma 6 + Neon Postgres |
| LLM | Fireworks AI (`accounts/fireworks/models/kimi-k2p6`) |
| TTS | ElevenLabs (`eleven_flash_v2_5`) + SpeechSynthesis fallback |
| Observability | Langfuse 3 |
| Audio storage | Cloudflare R2 via Wrangler CLI (no S3 keys) |
| WebSocket | ws 8 (custom server TTS relay) |

### Path Aliases (tsconfig.json)

```
@/*                      → ./*
@heytutor/design-tokens  → ../../packages/design-tokens/src/index.ts
@heytutor/drawing        → ../../packages/drawing/src/index.ts
@heytutor/tutor-core     → ../../packages/tutor-core/src/index.ts
@heytutor/whiteboard     → ../../packages/whiteboard/src/index.ts
```

Type-checking resolves to **source files** (not `dist/`). Next.js `transpilePackages` compiles package source at build time.

### Custom Server (server.ts)

The tutor app uses `tsx server.ts` (not `next start`) for both dev and production:

1. **HTTP handler** — delegates to Next.js request handler
2. **WebSocket TTS relay** — on `/api/tts/ws` upgrade, relays to ElevenLabs streaming TTS API
3. **Dev route warming** — pre-fetches API routes to avoid webpack cold-start races
4. **localStorage patch** — fixes Node 22+ SSR crash in dev overlay

`next dev` / `next start` are available as `dev:next` / `start:next` fallbacks but lack WebSocket support.

### Auth

Anonymous cookie-based. No login, no OAuth:

1. `middleware.ts` sets `htutor_uid` cookie (UUID, httpOnly, 10-year maxAge) on first visit
2. `lib/auth.ts` reads cookie, `ensureUser()` upserts User record in DB
3. All API routes call `getUserId()` → 401 if missing

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/chat` | POST | LLM proxy to Fireworks (SSE streaming, Langfuse tracing). Mock mode if no API key |
| `/api/tts` | POST | TTS proxy to ElevenLabs (HTTP) |
| `/api/tts/stream` | POST | TTS streaming proxy with timestamps |
| `/api/tts/ws` | WS | WebSocket relay to ElevenLabs (handled by server.ts) |
| `/api/boards` | GET/POST | Board list + create |
| `/api/boards/[id]` | GET/PATCH/DELETE | Board CRUD (ownership-checked) |
| `/api/boards/[id]/turns` | POST | Save turn (FormData: metadata JSON + audio blobs → R2) |
| `/api/board-name` | POST | LLM-generated 3-5 word topic name |
| `/api/trace/event` | POST | Client telemetry → Langfuse |

### Database (Prisma + Neon Postgres)

Schema: `apps/tutor/prisma/schema.prisma`
Models: `User`, `Board`, `Turn`, `Segment` (cascade deletes)
Migration: `0_init/migration.sql`

### Core Application Flow

The main session page (`app/c/[sessionId]/page.tsx`, ~1700 lines) orchestrates:

1. **Question** → streams LLM response via `streamLLMResponse()`
2. **Incremental parse** → `IncrementalTagParser` detects drawing command tags in real-time
3. **Segment queue** → each parsed segment enqueued into a promise chain
4. **Segment execution** → TTS narration + whiteboard drawing run in parallel (Promise.all)
5. **Persistence** → turn saved as FormData (metadata + audio) to `/api/boards/[id]/turns`
6. **Replay** → fetches audio from R2, replays drawing commands in sync

State machine: `idle` → `thinking` → `speaking`/`drawing` → `idle` (+ `erasing`)

### Key Patterns

- **Mock mode**: Works without API keys. `/api/chat` returns keyword-matched demo responses. TTS returns empty audio.
- **Incremental streaming**: LLM response parsed char-by-char as it arrives. Drawing/speaking starts before full response.
- **R2 via Wrangler CLI**: Audio uploads use `wrangler r2 object put --pipe --remote` (no S3 credentials).
- **Turn persistence as FormData**: Multipart upload (metadata JSON + audio blobs), not JSON.
- **Conversation history**: Last 10 Q&A exchanges, kept in ref, passed to LLM. Reconstructed from DB on board load.
- **LLM continuation**: Up to 3 continuation requests if response is truncated.
- **Cost tracking**: USD cost per LLM/TTS call, recorded in Langfuse.
- **Alignment checking**: Each segment's drawing command validated against narration. Misaligned commands skipped.

### Environment Variables

File: `apps/tutor/.env.local` (NOT repo root)

| Variable | Purpose | Required |
|----------|---------|----------|
| `FIREWORKS_API_KEY` | LLM | No (mock mode) |
| `FIREWORKS_MODEL` | LLM model | No (default: kimi-k2p6) |
| `ELEVENLABS_API_KEY` | TTS | No (browser voice fallback) |
| `ELEVENLABS_VOICE_ID` | TTS voice | No |
| `LANGFUSE_PUBLIC_KEY` | Observability | No |
| `LANGFUSE_SECRET_KEY` | Observability | No |
| `LANGFUSE_HOST` | Langfuse host | No |
| `DATABASE_URL` | Neon Postgres | Yes for persistence |
| `R2_ACCOUNT_ID` | Cloudflare R2 | Yes for audio |
| `R2_BUCKET` | R2 bucket | Yes for audio |
| `R2_PUBLIC_BASE_URL` | R2 public URL | Yes for audio |

## apps/landing

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Build | Vite 5 |
| Framework | React 19 |
| Styling | Tailwind CSS 3 (custom palette config) |
| Icons | lucide-react |
| Linter | ESLint 9 (flat config, shared `@heytutor/eslint-config/react`) |

### Structure

Single-page marketing site. **No router.** `App.tsx` renders `<Hero />` (composed of `Navbar`, `DashboardMockup`, CTA sections). Cross-app links use `<a href="/app">` which Vite proxies to tutor app at `:3000` in dev.

```
src/
  main.tsx, App.tsx, index.css
  components/
    Hero.tsx, Navbar.tsx, Logo.tsx, DashboardMockup.tsx
```

### Notable

- **No shadcn/ui** — no `components.json`, no CVA, no tailwind-merge
- **No path aliases** — all imports are relative
- **TypeScript project references** — `tsconfig.json` → `tsconfig.app.json` + `tsconfig.node.json`
- **ScaledDashboard** — `ResizeObserver`-based responsive scaling for the product mockup
- **design-tokens installed but unused** — colors are hardcoded as hex in Tailwind classes (same palette: `#003C43`, `#135D66`, `#77B0AA`, `#E3FEF7`)
- **External image CDN** — Hero background from `images.higgs.ai`, grass overlay from Cloudinary

## Shared Packages

### @heytutor/design-tokens

Exports `DS` (frozen object): `Colors`, `CornerRadius`, `Animation`, `Cursor`, `Canvas`. Canvas: 1200x700. Color palette: `#003C43` (darkest), `#135D66` (dark), `#77B0AA` (sage), `#E3FEF7` (mint).

### @heytutor/drawing

The drawing engine. 7 modules:
- `drawingProtocol.ts` — `DrawCommand` types, `parseDrawingCommands()`, `TutorSegment`
- `incrementalParser.ts` — `IncrementalTagParser` class (streaming char-by-char)
- `shapePaths.ts` — SVG path generators: `cuboidPath`, `cubePath`, `rectPath`, `circlePath`, `linePath`
- `handwriting.ts` — `textToStrokePaths()` (Tegaki glyph data → stroke paths)
- `alignmentCheck.ts` — `checkSegmentAlignment()`, `filterAlignedSegments()`
- `strokeAnimation.ts` — `animateStroke()`, `animateRoughStroke()` (requestAnimationFrame)
- `cursorAnimation.ts` — `animateBezierArc()`, `animateAlongPath()` (cursor movement)

Deps: `roughjs`, `tegaki`. Consumed by tutor app, tutor-core (types), whiteboard (handwriting).

### @heytutor/tutor-core

The AI tutor brain. 9 modules:
- `systemPrompt.ts` — `TUTOR_SYSTEM_PROMPT` (persona, drawing syntax, pacing rules)
- `llmAPI.ts` — `streamLLMResponse()` (SSE streaming, Fireworks, returns `StreamLLMResult`)
- `elevenLabsClient.ts` — `ElevenLabsTTSClient` (HTTP), `SpeechSynthesisTTSClient` (fallback), `mathToSpeech()`
- `elevenLabsWebSocketClient.ts` — `ElevenLabsWebSocketTTSClient` (WS, prefetch pipeline, job queue)
- `createTTSClient.ts` — `createTTSClient()` factory (WS in browser, HTTP in SSR)
- `audioSync.ts` — `buildSyncPlan()`, `buildSyncPlanFromTimings()`, duration estimators
- `sentenceChunker.ts` — `splitSegmentNarration()` (splits at sentence/clause boundaries, max 120 chars)
- `mockResponses.ts` — `getMockResponse()` (5 demo topics, keyword-matched)
- `tutorDebug.ts` — `tutorDebug(scope, message)` (scoped logger, env-gated)

Deps: `@heytutor/drawing` (types only, externalized in build). Consumed by tutor app.

### @heytutor/whiteboard

Konva canvas component. 4 exports:
- `Whiteboard` — `forwardRef` component with imperative handle: `drawShape()`, `writeText()`, `clearBoard()`, `eraseRegion()`, `flyCursorTo()`, `setCursorState()`, `setPaused()`, `cancelAnimations()`, `setAnimationSpeed()`. 3 Konva layers (draw, anim, cursor).
- `VirtualCursor` — chalk-shaped cursor Konva component
- `ThinkingSpinner` — rotating arc spinner
- `SpeakingWaveform` — audio-reactive bar waveform

PeerDeps: `konva`, `react`, `react-dom`, `react-konva`. Deps: `@heytutor/drawing` (handwriting). Consumed by tutor app (dynamic import, `ssr: false`).

### @heytutor/typescript-config

3 JSON configs: `base.json` (ES2022, strict, bundler), `react-library.json` (+DOM, react-jsx), `nextjs.json` (+DOM, Next plugin, preserve jsx). No build step.

### @heytutor/eslint-config

2 flat configs: `./next` (core-web-vitals + TS), `./react` (TS-eslint + react-hooks + react-refresh). No build step. Consumed by landing app.

## Drawing Command Protocol

Tags embedded in LLM response text, parsed by `IncrementalTagParser`:

```
[DRAW_CUBOID:x,y,width,height,depth]
[DRAW_CUBE:x,y,size]
[DRAW_RECT:x,y,width,height]
[DRAW_CIRCLE:cx,cy,radius]
[DRAW_LINE:x1,y1,x2,y2]
[WRITE:text,x,y]
[LABEL:text,x,y]
[PAUSE:ms]
[CLEAR]
[ERASE:x,y,width,height]
```

Canvas: 1200x700, origin top-left, warm off-white paper tone `#F8F6F0`.

## CI/CD

**File:** `.github/workflows/ci.yml`
**Triggers:** push to main/master, all PRs
**Steps:** `pnpm install --frozen-lockfile` → `pnpm turbo run lint typecheck build`
**No `--affected`** flag (runs all packages). No tests. No PR/issue templates.

## Deployment

Vercel. Set **Root Directory** per app:

| App | Path | Domain |
|-----|------|--------|
| `@heytutor/landing` | `apps/landing` | marketing root |
| `@heytutor/tutor` | `apps/tutor` | app subdomain |

No `vercel.json`. No Docker. Tutor uses `outputFileTracingRoot` set to monorepo root.

## Known Gaps

- **No tests** — no test framework, no test files anywhere
- **design-tokens unused in landing** — colors hardcoded as hex, package installed but not imported
- **eslint-config unused in tutor** — devDep listed but `eslint.config.mjs` uses FlatCompat instead
- **typescript-config unused in landing** — devDep listed but tsconfig doesn't extend it
- **Template leftovers in landing** — `App.css`, `react.svg`, `vite.svg` from Vite scaffold
- **Tailwind version split** — v4 in tutor, v3 in landing

## Documentation

- `docs/r2-setup.md` — Cloudflare R2 provisioning guide
- `docs/langfuse-dashboard-setup.md` — Langfuse observability dashboard config
- `docs/saas-landing-brief.md` — Product/marketing brief (persona, features, brand, pricing)
- `docs/tutor-sync-architecture.md` — Speech/whiteboard sync architecture, drawing queue, TTS timing, Tegaki/Konva handwriting, debug logs, and failure modes. **Read this first for any voice/drawing sync or whiteboard latency task.**
- `.omo/plans/` — Feature build plans (6 files covering original build, monorepo migration, sync, handwriting, eraser tool)

## Agent Notes

- `.omo/` contains OpenCode agent working state (plans, evidence, notepads, boulder tracker)
- `.agents/skills/langfuse/` — installed Langfuse skill (CLI + docs access)
- `skills-lock.json` — locks the langfuse skill (GitHub source, hash-pinned)
- `.cursor/settings.json` — enables Langfuse Cursor plugin
