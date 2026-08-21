# Backend API & Lib Modules

All backend code lives in `apps/tutor`. There is no separate backend app — API
routes are Next.js route handlers, plus a custom WebSocket relay in `server.ts`.

## API Routes

| Route | File | Methods | Purpose |
|-------|------|---------|---------|
| `/api/chat` | `app/api/chat/route.ts` | POST | LLM proxy → Fireworks AI (SSE). Planner and teaching transport. Mock mode without `FIREWORKS_API_KEY`. Langfuse tracing. |
| `/api/tts` | `app/api/tts/route.ts` | POST | ElevenLabs TTS proxy (audio MPEG or timestamps JSON) |
| `/api/tts/stream` | `app/api/tts/stream/route.ts` | POST | ElevenLabs streaming TTS with character timestamps |
| `/api/tts/ws` | `server.ts` | WebSocket | Real-time multi-context TTS relay to ElevenLabs with alignment data |
| `/api/boards` | `app/api/boards/route.ts` | GET, POST | List/create boards for cookie user |
| `/api/boards/[boardId]` | `app/api/boards/[boardId]/route.ts` | GET, PATCH, DELETE | Board detail + turns/segments; update title/preview; cascade delete + R2 cleanup |
| `/api/boards/[boardId]/turns` | `app/api/boards/[boardId]/turns/route.ts` | POST | Save turn (multipart: metadata JSON + per-segment audio blobs); revalidates scene artifacts |
| `/api/board-name` | `app/api/board-name/route.ts` | POST | LLM-generated board title from first question |
| `/api/trace/event` | `app/api/trace/event/route.ts` | POST | Client telemetry → Langfuse |

## Custom Server (`server.ts`)

Production and dev both use `tsx server.ts` (not `next start`):

- Serves Next.js via `createServer` + `app.getRequestHandler()`
- Upgrades `/api/tts/ws` to WebSocket and relays to ElevenLabs `stream-input`
- Uses multi-context segment protocol (`ttsRelayProtocol.ts`); waits for
  provider context-final rather than short network silence
- Records TTS spans to Langfuse
- Warms hot API routes in dev to avoid first-request compile races

## Middleware (`middleware.ts`)

1. If `BACKEND_ORIGIN` is set → proxy all `/api/*` requests to Azure backend
2. Otherwise → set `htutor_uid` cookie if missing

## Lib Modules (`lib/`)

| File | Purpose |
|------|---------|
| `auth.ts` | `getUserId()`, `ensureUser()` — cookie → Postgres user |
| `db/prisma.ts` | Prisma client singleton |
| `boards/boardsClient.ts` | Frontend API client — fetch/create/update boards, `saveTurn()` |
| `boards/boardTitle.ts` | Board title prompt + fallback heuristics |
| `boards/types.ts` | Shared `BoardEntry` DTO |
| `llm/plannerTransport.ts` | Planner model chain, retries, and completion fetch for turn/problem/scene plans |
| `llm/teachingTransport.ts` | Teaching-model selection, reasoning effort, and connect timeout |
| `tts/ttsRelayProtocol.ts` | Multi-context WebSocket message builders and payload normalization |
| `tts/ttsProxy.ts` | ElevenLabs URL/payload helpers |
| `tts/wsTicket.ts` | WebSocket TTS ticket mint/verify |
| `scene/turnScenePersistence.ts` | Server-side scene revalidation, trusted-command matching, fallback rebuild |
| `scene/turnPersistencePolicy.ts` | Whether submitted turn metadata is persistable |
| `scene/turnUploadLimits.ts` | Multipart turn upload size/count gates |
| `obs/langfuse.ts` | Observability — traces, spans, LLM/TTS cost tracking |
| `obs/usageCost.ts` | Cost enrichment for Langfuse metadata |
| `obs/turnTelemetry.ts` | Client-side turn span instrumentation |
| `r2/r2.ts` / `r2/r2Keys.ts` | Cloudflare R2 audio upload/delete |
| `replay/replayTurns.ts` / `replay/replayAudio.ts` / `replay/replayTimeline.ts` | Replay orchestration |
| `client/exportNotesPdf.ts` | PDF export of board notes |
| `client/subtitleText.ts` | Subtitle rendering helpers |
| `client/useMediaQuery.ts` | Compact-nav media query hook |
| `site.ts` | SEO metadata constants |
| `utils.ts` | `cn()` and shared class helpers |

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `FIREWORKS_API_KEY` | No | LLM — mock mode without it |
| `FIREWORKS_MODEL` / `FIREWORKS_TEACHING_MODEL` | No | Override teaching model |
| `ELEVENLABS_API_KEY` | No | TTS — browser voice fallback |
| `ELEVENLABS_VOICE_ID` | No | TTS voice selection |
| `ELEVENLABS_MODEL` | No | Default: `eleven_flash_v2_5` |
| `R2_ACCOUNT_ID` / `R2_BUCKET` / `R2_PUBLIC_BASE_URL` | No | Audio persistence in Cloudflare R2 |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | No | Observability |
| `BACKEND_ORIGIN` | Split deploy | API proxy target for Vercel frontend |
| `NEXT_PUBLIC_API_ORIGIN` | Split deploy | Client-side API base URL |
| `NEXT_PUBLIC_WS_ORIGIN` | Split deploy | Client-side WebSocket base URL |

## Database Commands

```bash
pnpm db:up                                          # start local postgres
pnpm db:down                                        # stop it
pnpm --filter @heytutor/tutor db:migrate            # apply migrations
pnpm --filter @heytutor/tutor db:migrate:dev        # create new migration
pnpm --filter @heytutor/tutor db:generate           # regenerate Prisma client
```

## Deploy

- **Frontend:** Vercel (root `apps/tutor`)
- **Backend API + WS:** Azure VM via `deploy/azure/` (Docker + systemd)
- **CI:** `.github/workflows/ci.yml`
- **Backend deploy:** `.github/workflows/deploy-backend.yml`

See [ci-cd.md](../ops/ci-cd.md) and [r2-setup.md](../ops/r2-setup.md).
