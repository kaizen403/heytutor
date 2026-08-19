# HeyTutor

AI whiteboard tutor that teaches with two coordinated streams: a verified diagram committed before narration, and a teaching stream that writes equations while revealing that diagram in sync with speech.

Invalid or partial diagrams never reach the canvas. Numeric values come from a deterministic solver, not from planner guesswork.

## Architecture

```text
question
  -> TurnPlanV3
  -> ProblemIR + SolverResult (numeric authority)
  -> scene-document candidates + constraint compilers
  -> validate / proof / repair / compile / label layout
  -> exact_verified | qualitative_verified | question_representation
  -> atomic VerifiedDiagram commit + narrated reveal
  -> teaching [STEP] narration + work-area WRITE
```

| Stream | Owner | Responsibility |
|--------|--------|----------------|
| Verified diagram | `@heytutor/scene-engine` | Geometry, topology, labels, dimensions, layout, reveal order |
| Narrated work | Teaching LLM + ElevenLabs TTS | Spoken explanation and left-panel `WRITE` only |

The teaching model cannot draw, label, annotate, erase, or supply diagram coordinates. `[FOCUS:id]` may only trace geometry already committed by the scene engine.

Canvas: **1200×700**, origin top-left. Diagram zone: **x 400–900**.

Deeper design notes: [docs/agent/architecture.md](docs/agent/architecture.md), [docs/diagram-accuracy-architecture.md](docs/diagram-accuracy-architecture.md), [docs/tutor-sync-architecture.md](docs/tutor-sync-architecture.md).

## Repository layout

```text
apps/
  tutor/          Next.js product (API, WebSocket TTS relay, whiteboard session)
  landing/        Marketing site (Vite + React)

packages/
  scene-engine/   Diagram authority: contracts, validation, proofs, compile
  drawing/        Command protocol, parser, paths, animation
  tutor-core/     Turn planning, teaching stream, TTS, audio sync
  whiteboard/     Konva renderer
  design-tokens/  Shared visual constants
```

## Stack

| Layer | Choice |
|-------|--------|
| Apps | Next.js 15, React 19, Tailwind CSS v4; Vite landing |
| Canvas | Konva / react-konva, roughjs, tegaki |
| LLM | Fireworks AI |
| TTS | ElevenLabs (WebSocket streaming) |
| Data | Prisma + Postgres |
| Audio objects | Cloudflare R2 |
| Monorepo | pnpm workspaces + Turborepo |
| Deploy | Vercel (frontend) + Azure VM (API / WebSocket) |

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) 10.32.0 (`packageManager` in root `package.json`)
- Docker (local Postgres)

## Local setup

```bash
pnpm install
cp apps/tutor/.env.example apps/tutor/.env.local
```

Edit `apps/tutor/.env.local`. Without `FIREWORKS_API_KEY` / `ELEVENLABS_API_KEY`, the app runs in mock mode (usable for UI and sync work).

```bash
pnpm db:up
pnpm --filter @heytutor/tutor db:migrate
pnpm dev:tutor
```

Tutor: [http://localhost:3000](http://localhost:3000)

`pnpm dev:tutor` starts the tutor app; if `DATABASE_URL` points at localhost, the dev script can bring up Postgres and apply migrations. Compose binds Postgres to `127.0.0.1:5433` only.

Optional lecture audio persistence:

```bash
wrangler login
pnpm r2:setup
```

Landing site:

```bash
pnpm dev:landing   # http://localhost:5173
```

## Environment variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `DATABASE_URL` | Postgres connection | Yes |
| `FIREWORKS_API_KEY` | LLM | No (mock mode) |
| `FIREWORKS_MODEL` | Model id | No |
| `ELEVENLABS_API_KEY` | TTS | No (browser voice fallback) |
| `ELEVENLABS_VOICE_ID` | Voice selection | No |
| `R2_ACCOUNT_ID` / `R2_BUCKET` / `R2_PUBLIC_BASE_URL` | Lecture audio storage | No |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | Observability | No |
| `NEXT_PUBLIC_SITE_URL` | SEO / absolute URLs | No |
| `BACKEND_ORIGIN` | Production: Vercel proxies `/api/*` to Azure | Production only |

See `apps/tutor/.env.example` for the canonical list.

## Commands

```bash
pnpm dev              # all apps
pnpm dev:tutor        # tutor → :3000
pnpm dev:landing      # landing → :5173
pnpm build
pnpm typecheck
pnpm lint
pnpm check            # typecheck + lint + build

pnpm db:up
pnpm db:down
pnpm --filter @heytutor/tutor db:migrate
```

## Verification

Package and app invariants (golden corpora, transport ownership, persistence trust):

```bash
pnpm --filter @heytutor/scene-engine verify
pnpm --filter @heytutor/tutor-core verify
pnpm --filter @heytutor/tutor verify
```

There is no CI — run these checks locally before pushing.

## Deployment

| Surface | Platform | Notes |
|---------|----------|--------|
| Tutor UI | Vercel | Root directory `apps/tutor` |
| Landing | Vercel | Root directory `apps/landing` |
| API + WebSocket TTS relay | Azure VM | `server.ts`; manual deploy via `deploy/azure/deploy.sh` |

Split deploy: set `BACKEND_ORIGIN` on Vercel so `/api/*` proxies to Azure. Full runbook: [docs/ci-cd.md](docs/ci-cd.md). R2: [docs/r2-setup.md](docs/r2-setup.md).

## Documentation

| Doc | Contents |
|-----|----------|
| [AGENTS.md](AGENTS.md) | Agent quick reference and critical ownership rules |
| [docs/agent/architecture.md](docs/agent/architecture.md) | Turn flow and key paths |
| [docs/agent/backend.md](docs/agent/backend.md) | API and lib modules |
| [docs/agent/packages.md](docs/agent/packages.md) | Shared package map |
| [docs/tutor-sync-architecture.md](docs/tutor-sync-architecture.md) | Voice / handwriting sync |
| [docs/universal-illustration-engine-v4.md](docs/universal-illustration-engine-v4.md) | Illustration engine v4 |
| [docs/diagram-accuracy-architecture.md](docs/diagram-accuracy-architecture.md) | Verified diagram design |
| [docs/ci-cd.md](docs/ci-cd.md) | Deploy runbook |

## Product constraints (non-negotiable)

1. `@heytutor/scene-engine` owns every diagram mark. No topic templates, chapter registries, regex routers, fixed-pixel plugins, or model-authored diagram ink.
2. Teaching stream owns narration and work-area `WRITE` only.
3. Numeric authority is deterministic (`ProblemIR` + solver). Stale planner scalars cannot pair with a correct diagram.
4. Coverage grows through reusable operators and assertions, not per-question templates or validator bypasses.
5. Live writing uses estimated schedules first; do not block the board on late TTS timings.
6. Sessions are anonymous: `htutor_uid` cookie maps to a Postgres `User` row. There is no login product surface.
