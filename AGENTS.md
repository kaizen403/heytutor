# HeyTutor

AI whiteboard tutor with two coordinated streams and one authority boundary:

1. **Verified diagram** — `@heytutor/scene-engine` commits exact, qualitative, or
   question-representation geometry before narration.
2. **Narrated work** — teaching LLM + ElevenLabs TTS write equations in the left
   work area and reveal the already-verified scene in sync on Konva.

## Quick Reference

- **Package manager:** pnpm (`pnpm@10.32.0`)
- **Monorepo:** Turborepo — `apps/*` + `packages/*`
- **Dev (tutor):** `pnpm dev:tutor` → http://localhost:3000
- **Dev (landing):** `pnpm dev:landing` → http://localhost:5173
- **Check:** `pnpm typecheck && pnpm lint && pnpm build`
- **Verify:** `pnpm --filter @heytutor/scene-engine verify && pnpm --filter @heytutor/tutor-core verify && pnpm --filter @heytutor/tutor verify`
- **DB:** `pnpm db:up` then `pnpm --filter @heytutor/tutor db:migrate`

Mock mode works without API keys (`FIREWORKS_API_KEY`, `ELEVENLABS_API_KEY`).

## Turn Pipeline

```text
question
  -> TurnPlanV3 (quantities, claims, laws, visualRequirement)
  -> ProblemIR/v1 + SolverResult/v1 (source-grounded numeric authority)
  -> scene-document/v2 candidates + constraint compilers
  -> validate / proof / repair / compile / label layout
  -> exact_verified | qualitative_verified | question_representation
  -> atomic VerifiedDiagram commit + narrated reveal
  -> teaching [STEP] narration + work-area WRITE
```

Required visuals that fail both exact and source-grounded representation return
`retry_required`. Optional visuals may teach text-only. Partial candidates never
render.

## Where to Start

| Task | Start here |
|------|------------|
| Live teaching loop | `apps/tutor/features/tutor-session/hooks/turn/useQuestionHandler.ts` |
| Scene engine authority | `packages/scene-engine/` |
| Scene presentation / reveal | `apps/tutor/features/tutor-session/lib/verifiedScenePresentation.ts` |
| Representation fallback | `apps/tutor/features/tutor-session/lib/representationFallbackV4.ts` |
| Voice + handwriting sync | [docs/architecture/tutor-sync-architecture.md](docs/architecture/tutor-sync-architecture.md) |
| LLM / planner proxy | `apps/tutor/app/api/chat/route.ts` |
| Drawing protocol | `packages/drawing/src/protocol/drawingProtocol.ts` |
| Canvas rendering | `packages/whiteboard/src/Whiteboard.tsx` |
| Turn persistence trust | `apps/tutor/lib/scene/turnScenePersistence.ts` |
| Syllabus capability coverage | `packages/scene-engine/scripts/verify/verify-syllabus-corpus.ts` |
| Question bank pipeline | `tools/question-bank/` + `data/question-bank/` |

## Agent Guidelines

- [Folder layout](docs/agent/layout.md)
- [Architecture & data flow](docs/agent/architecture.md)
- [Backend API & lib modules](docs/agent/backend.md)
- [Shared packages](docs/agent/packages.md)
- [Sync / voice / writing](docs/architecture/tutor-sync-architecture.md)
- [Verified scene debug](docs/agent/geometry-debug.md)
- [Universal illustration engine v4](docs/architecture/universal-illustration-engine-v4.md)
- [Verified diagram architecture](docs/architecture/diagram-accuracy-architecture.md)
- [Syllabus capability plan v5](docs/architecture/universal-syllabus-capability-plan-v5.md)
- [Deploy runbook](docs/ops/ci-cd.md) (no CI — workflows removed, no required checks on `main`)

## Git authorship

Never add Cursor / `cursoragent` as a commit co-author. Never commit `.cursor/` or Cursor IDE lockfiles. Author commits as the user only.

## Critical Rules

1. **Canvas is 1200×700**, origin top-left. Diagram zone: x 400–900.
2. **`@heytutor/scene-engine` owns every diagram mark** — geometry, topology,
   labels, dimensions, layout, and reveal order. No topic templates, chapter
   registries, regex routers, fixed-pixel plugins, or model-authored diagram ink.
3. **Teaching stream owns narration and work-area `WRITE` only** — never draw,
   label, annotate, erase, circle, or supply focus coordinates. `[FOCUS:id]` may
   trace existing verified geometry. Filters and `useCommandExecution()` enforce
   ownership.
4. **Numeric authority is deterministic** — `TurnPlanV3` is scene-facing;
   `ProblemIR` + solver recompute supported values. Stale planner scalars cannot
   pair with a correct diagram.
5. **Invalid or partial candidates never render** — fallbacks are independently
   compiled honest representations, not repaired fragments.
6. **Coverage grows via reusable operators/assertions**, never per-question
   templates or validator bypasses. Corpus fixtures are oracles only.
7. **Live writing uses estimated schedules first** — never block on late TTS
   timings. See sync doc.
8. **Packages must be built** before the tutor app picks up changes
   (`turbo run dev` handles this).
9. **No user login** — anonymous `htutor_uid` cookie maps to a `User` row in
   Postgres.
10. **Split deploy:** `BACKEND_ORIGIN` proxies `/api/*` from Vercel to Azure;
    WebSocket TTS relay lives in `server.ts`.
