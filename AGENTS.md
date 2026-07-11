# HeyTutor

AI whiteboard tutor — streams LLM responses with embedded drawing commands, narrates via ElevenLabs TTS, and renders on a Konva canvas in sync.

## Quick Reference

- **Package manager:** pnpm (`pnpm@10.32.0`)
- **Monorepo:** Turborepo — `apps/*` + `packages/*`
- **Dev (tutor):** `pnpm dev:tutor` → http://localhost:3000
- **Dev (landing):** `pnpm dev:landing` → http://localhost:5173
- **Check:** `pnpm typecheck && pnpm lint && pnpm build`
- **DB:** `pnpm db:up` then `pnpm --filter @heytutor/tutor db:migrate`

Mock mode works without API keys (`FIREWORKS_API_KEY`, `ELEVENLABS_API_KEY`).

## Where to Start

| Task | Start here |
|------|------------|
| Live teaching loop | `apps/tutor/features/tutor-session/hooks/turn/useQuestionHandler.ts` |
| Voice + drawing sync bugs | [docs/tutor-sync-architecture.md](docs/tutor-sync-architecture.md) |
| LLM proxy | `apps/tutor/app/api/chat/route.ts` |
| Drawing protocol | `packages/drawing/src/drawingProtocol.ts` |
| Canvas rendering | `packages/whiteboard/src/Whiteboard.tsx` |
| Persistence | `apps/tutor/app/api/boards/[boardId]/turns/route.ts` |

## Agent Guidelines

- [Architecture & data flow](docs/agent/architecture.md)
- [Backend API & lib modules](docs/agent/backend.md)
- [Shared packages](docs/agent/packages.md)
- [Sync / voice / drawing](docs/tutor-sync-architecture.md)
- [Ray Optics debug playbook](docs/agent/optics-debug.md)
- [Geometry engine debug](docs/agent/geometry-debug.md)
- [CI/CD & deploy](docs/ci-cd.md)

## Critical Rules

1. **Canvas is 1200×700**, origin top-left. Diagram zone: x 400–900.
2. **Live drawing uses estimated schedules first** — never block on late TTS timings. See sync doc.
3. **Packages must be built** before the tutor app picks up changes (`turbo run dev` handles this).
4. **No user login** — anonymous `htutor_uid` cookie maps to a `User` row in Postgres.
5. **Split deploy:** `BACKEND_ORIGIN` proxies `/api/*` from Vercel to Azure; WebSocket TTS relay lives in `server.ts`.
