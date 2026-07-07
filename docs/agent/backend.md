# Backend API & Lib Modules

All backend code lives in `apps/tutor`. There is no separate backend app — API routes are Next.js route handlers, plus a custom WebSocket relay in `server.ts`.

## API Routes

| Route | File | Methods | Purpose |
|-------|------|---------|---------|
| `/api/chat` | `app/api/chat/route.ts` | POST | LLM proxy → Fireworks AI (SSE). Mock mode without `FIREWORKS_API_KEY`. Langfuse tracing. |
| `/api/tts` | `app/api/tts/route.ts` | POST | ElevenLabs TTS proxy (audio MPEG or timestamps JSON) |
| `/api/tts/stream` | `app/api/tts/stream/route.ts` | POST | ElevenLabs streaming TTS with character timestamps |
| `/api/tts/ws` | `server.ts` | WebSocket | Real-time TTS relay to ElevenLabs with alignment data |
| `/api/boards` | `app/api/boards/route.ts` | GET, POST | List/create boards for cookie user |
| `/api/boards/[boardId]` | `app/api/boards/[boardId]/route.ts` | GET, PATCH, DELETE | Board detail + turns/segments; update title/preview; cascade delete + R2 cleanup |
| `/api/boards/[boardId]/turns` | `app/api/boards/[boardId]/turns/route.ts` | POST | Save turn (multipart: metadata JSON + per-segment audio blobs) |
| `/api/board-name` | `app/api/board-name/route.ts` | POST | LLM-generated board title from first question |
| `/api/trace/event` | `app/api/trace/event/route.ts` | POST | Client telemetry → Langfuse |

## Custom Server (`server.ts`)

Production and dev both use `tsx server.ts` (not `next start`):

- Serves Next.js via `createServer` + `app.getRequestHandler()`
- Upgrades `/api/tts/ws` to WebSocket and relays to ElevenLabs `stream-input` endpoint
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
| `boardsClient.ts` | Frontend API client — fetch/create/update boards, `saveTurn()` |
| `langfuse.ts` | Observability — traces, spans, LLM/TTS cost tracking |
| `usageCost.ts` | Cost enrichment for Langfuse metadata |
| `ttsProxy.ts` | ElevenLabs URL/payload helpers |
| `r2.ts` / `r2Keys.ts` | Cloudflare R2 audio upload/delete |
| `boardTitle.ts` | Board title prompt + fallback heuristics |
| `turnTelemetry.ts` | Client-side turn span instrumentation |
| `replayTurns.ts` / `replayAudio.ts` / `replayTimeline.ts` | Replay orchestration |
| `exportNotesPdf.ts` | PDF export of board notes |
| `subtitleText.ts` | Subtitle rendering helpers |
| `site.ts` | SEO metadata constants |

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `FIREWORKS_API_KEY` | No | LLM — mock mode without it |
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

See [ci-cd.md](../ci-cd.md) and [r2-setup.md](../r2-setup.md).
