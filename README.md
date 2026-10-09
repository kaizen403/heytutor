# HeyTutor

AI whiteboard tutor that teaches with two coordinated streams: a verified diagram committed before narration, and a teaching stream that writes equations while revealing that diagram in sync with speech.

Invalid or partial diagrams never reach the canvas. Numeric values come from a deterministic solver, not from planner guesswork.

## Architecture

```text
question
  -> TurnPlanV3
  -> ProblemIR + SolverResult (numeric authority)
  -> fast deterministic family figure, else scene-document candidates + constraint compilers
  -> validate / proof / repair / compile / label layout
  -> exact_verified | qualitative_verified | question_representation
  -> atomic VerifiedDiagram commit + narrated reveal
  -> teaching [STEP] narration + work-area WRITE
```

| Stream | Owner | Responsibility |
|--------|--------|----------------|
| Verified diagram | `@heytutor/scene-engine` | Geometry, topology, labels, dimensions, layout, reveal order |
| Narrated work | Teaching LLM + TTS (Cartesia; Sarvam for Hinglish) | Spoken explanation and left-panel `WRITE` only |

The teaching model cannot draw, label, annotate, erase, or supply diagram coordinates. `[FOCUS:id]` may only trace geometry already committed by the scene engine.

Canvas: **1200×700**, origin top-left. Diagram zone: **x 400 to 1160**.

Deeper design notes: [docs/agent/architecture.md](docs/agent/architecture.md), [docs/architecture/diagram-accuracy-architecture.md](docs/architecture/diagram-accuracy-architecture.md), [docs/architecture/tutor-sync-architecture.md](docs/architecture/tutor-sync-architecture.md).

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
| LLM | Fireworks AI (Kimi K3) by default; `LLM_PROVIDER=azure` selects gpt-6.1-sol on Azure AI Foundry ([llm-provider.md](docs/agent/llm-provider.md)) |
| TTS | Cartesia `sonic-3.6` by default (`TTS_PROVIDER`); Sarvam `bulbul:v3` for Hinglish when `SARVAM_API_KEY` is set; ElevenLabs optional |
| Speech to text | Cartesia `ink-whisper` by default (`STT_PROVIDER`) |
| Accounts | Auth.js (Google sign-in) |
| Data | Prisma + Postgres |
| Audio + question photos | Private S3 |
| Monorepo | pnpm workspaces + Turborepo |
| Deploy | Vercel (landing) + AWS EC2 (tutor UI / API / WebSocket) |

## Prerequisites

- Node.js 24 (what CI and production run)
- [pnpm](https://pnpm.io) 10.32.0 (`packageManager` in root `package.json`)
- Docker (local Postgres)

## Local setup

```bash
pnpm install
cp apps/tutor/.env.example apps/tutor/.env.local
```

Edit `apps/tutor/.env.local`. Without `FIREWORKS_API_KEY` (or the Azure key when `LLM_PROVIDER=azure`) the LLM runs in mock mode (usable for UI and sync work); without `CARTESIA_API_KEY` narration falls back to browser speech. `.env.example` sets `AUTH_DEV_LOGIN=1`, which adds a local sign-in that skips Google (never in production).

```bash
pnpm db:up
pnpm --filter @heytutor/tutor db:migrate
pnpm dev:tutor
```

Tutor: [http://localhost:3000](http://localhost:3000)

`pnpm dev:tutor` starts the tutor app; if `DATABASE_URL` points at localhost, the dev script can bring up Postgres and apply migrations. Compose binds Postgres to `127.0.0.1:5433` only.

Optional lecture audio persistence (local): set `S3_BUCKET` and AWS credentials
in `apps/tutor/.env.local`. Production uses an EC2 instance role. See
[docs/ops/s3-setup.md](docs/ops/s3-setup.md).

Landing site:

```bash
pnpm dev:landing   # http://localhost:5173
```

## Environment variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `DATABASE_URL` | Postgres connection | Yes |
| `LLM_PROVIDER` | `fireworks` (default) or `azure` (needs `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`; missing values fall back to Fireworks) | No |
| `FIREWORKS_API_KEY` | LLM | No (mock mode) |
| `FIREWORKS_MODEL` | Planner model id | No |
| `FIREWORKS_FAST_MODEL` | Planner Fast serving id | No |
| `FIREWORKS_TEACHING_MODEL` | Spoken teaching model id | No |
| `FIREWORKS_TEACHING_FAST_MODEL` | Teaching Fast serving id | No |
| `TTS_PROVIDER` / `STT_PROVIDER` | Speech vendor for narration and dictation: `cartesia` (default) or `elevenlabs` | No |
| `CARTESIA_API_KEY` | Narration and ask-bar dictation | No (narration falls back to browser speech) |
| `SARVAM_API_KEY` | Hinglish voice | No (Hinglish is not offered) |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | Narration, only with `TTS_PROVIDER=elevenlabs` | No |
| `ELEVENLABS_STT_API_KEY` | Dictation, only with `STT_PROVIDER=elevenlabs` | No |
| `AUTH_SECRET` | Auth.js session secret (a dev default exists outside production) | Production |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google sign-in | Production |
| `WS_TICKET_SECRET` | Signs short-lived `/api/tts/ws` tickets | Production |
| `S3_BUCKET` / `AWS_REGION` | Lecture audio + question photos | No |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | Observability | No |
| `NEXT_PUBLIC_SITE_URL` | SEO / absolute URLs | No |
| `BACKEND_ORIGIN` | Leave unset on the collocated EC2 tutor | Split-deploy only |

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

GitHub deploys Cloudflare Pages `dev` first, then promotes the same commit
to `main` (tutor EC2 + landing production). Before any deploy, CI runs
typecheck, lint, build, `verify:publication`, the security, payment and
database checks, and a dependency audit; a failure blocks the deploy. The
full package `verify` suites above are not in CI, so run them locally before
pushing.

## Deployment

| Surface | Platform | Notes |
|---------|----------|--------|
| Landing | Vercel production (`accelute.co`); Cloudflare Pages `dev` first (`dev.accelute.pages.dev`) | Push to `dev` or `main` runs `.github/workflows/deploy-tutor.yml` |
| Tutor UI + API + WebSocket | AWS EC2 | Same workflow, after the Cloudflare `dev` stage, through GitHub OIDC and the SSM document `AcceluteDeploy` (which runs `deploy/aws/deploy.sh` on the box) |
| Postgres | Hosted | `DATABASE_URL` — not Docker on the app box |
| Objects | Private S3 | Lecture MP3s and question photos |

Full runbook: [docs/ops/ci-cd.md](docs/ops/ci-cd.md). S3: [docs/ops/s3-setup.md](docs/ops/s3-setup.md).

## Documentation

| Doc | Contents |
|-----|----------|
| [AGENTS.md](AGENTS.md) | Agent quick reference and critical ownership rules |
| [docs/agent/layout.md](docs/agent/layout.md) | Where new files go |
| [docs/agent/architecture.md](docs/agent/architecture.md) | Turn flow and key paths |
| [docs/agent/backend.md](docs/agent/backend.md) | API and lib modules |
| [docs/agent/packages.md](docs/agent/packages.md) | Shared package map |
| [docs/architecture/tutor-sync-architecture.md](docs/architecture/tutor-sync-architecture.md) | Voice / handwriting sync |
| [docs/architecture/speech-providers.md](docs/architecture/speech-providers.md) | Cartesia, Sarvam and ElevenLabs setup |
| [docs/architecture/diagram-accuracy-architecture.md](docs/architecture/diagram-accuracy-architecture.md) | Verified diagram design |
| [docs/ops/ci-cd.md](docs/ops/ci-cd.md) | Deploy runbook |

## Product constraints (non-negotiable)

1. `@heytutor/scene-engine` owns every diagram mark. No topic templates, chapter registries, regex routers, fixed-pixel plugins, or model-authored diagram ink.
2. Teaching stream owns narration and work-area `WRITE` only.
3. Numeric authority is deterministic (`ProblemIR` + solver). Stale planner scalars cannot pair with a correct diagram.
4. Coverage grows through reusable operators and assertions, not per-question templates or validator bypasses.
5. Live writing uses estimated schedules first; do not block the board on late TTS timings.
6. Accounts use Auth.js (Google sign-in). `AUTH_DISABLED=1` with `NEXT_PUBLIC_AUTH_DISABLED=1` restores the anonymous `htutor_uid` identity outside production; production ignores it.
