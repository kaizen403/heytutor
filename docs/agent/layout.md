# Layout conventions

Put new files next to the job they belong to. Do not add a topic template under
`apps/`, a new root helper in `apps/tutor/lib/`, or a `*-vN.md` at `docs/` root.

Public package imports stay `@heytutor/scene-engine`, `@heytutor/tutor-core`,
`@heytutor/drawing`, and `@heytutor/whiteboard`. Apps import those barrels, not
internal package paths.

## Where new files go

- Scene operator, proof, compile, IR, or solver code →
  `packages/scene-engine/src/` in the matching folder (`compile/`, `document/`,
  `ir/`, `capability/`, `contracts/`, `math/`, `physics/`, `topology/`,
  `labels/`). Never a topic file under `apps/`.
- Planner, TTS, sync, or teaching-LLM code →
  `packages/tutor-core/src/{planners,tts,sync,llm,text}/`.
- Canvas protocol, handwriting, layout, or animation →
  `packages/drawing/src/{protocol,handwriting,layout,animation}/`.
- Session UI → `apps/tutor/features/tutor-session/`. Shared primitives only in
  `apps/tutor/components/ui/`.
- App helper → `apps/tutor/lib/<domain>/`, not `features/` and not a new file
  at `lib/` root unless it is a tiny cross-cutting util (`auth.ts`, `utils.ts`,
  `site.ts`, `cookies.ts`).
- Check → `scripts/verify/verify-<name>.ts` next to the package that owns the
  code; wire it into that package’s `verify` script. Live/manual probes go in
  `scripts/live/` or `scripts/measure/` and stay out of `pnpm verify` unless
  they are meant to gate.
- Architecture note → `docs/architecture/` (current) or `docs/plans/` (open
  work). Agent maps stay in `docs/agent/`. Runbooks stay in `docs/ops/`.
  Product-facing checklists stay in `docs/product/`.
- Question-bank code → `tools/question-bank/` (`qbank.py`, `question_bank/`,
  `importers/`, `tests/`); corpus → `data/question-bank/`. Do not copy JSONL
  into packages.

## Package source trees

```text
packages/scene-engine/src/
  index.ts, types.ts
  capability/   compile/   document/   contracts/
  ir/           math/      physics/    topology/   labels/

packages/tutor-core/src/
  index.ts, publicOrigins.ts, tutorDebug.ts
  planners/   tts/   sync/   llm/   text/

packages/drawing/src/
  index.ts
  protocol/   handwriting/   layout/   animation/
```

## App source tree

```text
apps/tutor/
  app/                         Next routes only
  components/ui/               shadcn primitives
  features/tutor-session/      session page, hooks, presentation, chrome
  features/admin/              syllabus playground
  lib/                         app-wide helpers grouped by domain
    boards/  scene/  replay/  tts/  llm/  obs/  r2/  client/  db/
  scripts/
    dev.ts, r2-setup.ts
    verify/                    wired into pnpm verify
    live/                      optional / not in the default verify chain
```

See [packages.md](packages.md) for per-file maps and [backend.md](backend.md)
for API and `lib/` modules.
