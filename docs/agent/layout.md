# Layout conventions

Put new files next to the job they belong to. Do not add a topic template under
`apps/`, a new root helper in `apps/tutor/lib/`, or a `*-vN.md` at `docs/` root.

Public package imports stay `@heytutor/scene-engine`, `@heytutor/tutor-core`,
`@heytutor/drawing`, and `@heytutor/whiteboard`. Apps import those barrels, not
internal package paths. The one documented exception is
`@heytutor/whiteboard/pen-spinner` (Konva-free chrome spinner).

Cleanup backlog (renames, clustering, root hygiene):
[folder-structure.md](../plans/folder-structure.md). When a move lands, update
this file and strike it from that plan.

## Where new files go

- Scene operator, proof, compile, IR, solver, family synthesis, archetype, or
  DSA-trace geometry → `packages/scene-engine/src/` in the matching folder
  (`compile/`, `document/`, `ir/`, `capability/`, `contracts/`, `math/`,
  `physics/`, `topology/`, `labels/`, `synthesize/`, `archetypes/`, `dsa/`,
  `bank/`). Never a topic file under `apps/`.
- Planner, TTS, speech-sync, teaching-LLM, or code-lesson *plan/teach* code →
  `packages/tutor-core/src/{planners,tts,sync,llm,text,code}/`.
- Canvas protocol, handwriting, board layout, stroke animation, or the write
  clock the pen waits on →
  `packages/drawing/src/{protocol,handwriting,layout,animation,sync}/`.
- Konva renderer, cursor, pen pose, or capture clock →
  `packages/whiteboard/src/` (keep the package root flat until a cluster has
  four files of its own).
- Session UI (home board, `/c/[id]`, landing overlay, notes, marking, code
  panel) → `apps/tutor/features/tutor-session/`. Shared primitives only in
  `apps/tutor/components/ui/`. Brand marks in `apps/tutor/components/brand/`.
  Admin playground → `apps/tutor/features/admin/`.
- App helper → `apps/tutor/lib/<domain>/`, not `features/` and not a new file
  at `lib/` root unless it is a tiny cross-cutting util (`auth.ts`, `utils.ts`,
  `site.ts`, `cookies.ts`). Domains already in use:
  `boards/`, `scene/`, `replay/`, `tts/`, `llm/`, `obs/`, `r2/`, `client/`,
  `db/`, `code-lesson/` (persist parse), `code-render/`, `lecture-export/`.
- Check → `scripts/verify/verify-<kebab-name>.ts` next to the package that
  owns the code; wire it into that package’s `verify` script. Live/manual
  probes go in `scripts/live/` or `scripts/measure/` and stay out of
  `pnpm verify` unless they are meant to gate. Whole-lecture offline runs go
  in `apps/tutor/scripts/lecture-lab/`.
- Architecture note → `docs/architecture/` (current) or `docs/plans/` (open
  work). Agent maps stay in `docs/agent/`. Runbooks stay in `docs/ops/`.
  Product-facing checklists stay in `docs/product/`. Dated traces stay in
  `docs/snapshots/`.
- Question-bank code → `tools/question-bank/` (`qbank.py`, `question_bank/`,
  `importers/`, `tests/`); corpus → `data/question-bank/`. Syllabus / leetcode
  probe JSON → `data/syllabus-probes/`, `data/leetcode-probes/`. Do not copy
  JSONL into packages.
- Marketing site → `apps/landing/src/`. Do not grow a third landing feature
  inside the tutor app; the empty-board overlay lives in `tutor-session`.

## Naming

- New folders: kebab-case (`code-lesson`, `lecture-export`).
- New source files: camelCase (`useBoardLayout.ts`); React components
  PascalCase (`SessionHeader.tsx`).
- Verify scripts: `verify-<kebab>.ts`.
- Protocol versions live in types and constants (`TurnPlanV3`,
  `code-lesson/v1`), not in new helper filenames. Do not add
  `fooV5.ts` / `bar-v4.ts` for a rewrite of an existing helper.

## Package source trees

```text
packages/scene-engine/src/
  index.ts, types.ts
  capability/   compile/   document/   contracts/
  ir/           math/      physics/    topology/   labels/
  synthesize/   archetypes/   dsa/     bank/

packages/tutor-core/src/
  index.ts, publicOrigins.ts, tutorDebug.ts
  planners/   tts/   sync/   llm/   text/   code/

packages/drawing/src/
  index.ts
  protocol/   handwriting/   layout/   animation/   sync/

packages/whiteboard/src/
  index.ts, Whiteboard.tsx, pen-spinner.ts   (flat on purpose)
```

`drawing/src/sync` is the pen write-clock. `tutor-core/src/sync` is TTS /
speech scheduling. Do not merge them.

`scene-engine/src/dsa` owns algorithm traces and the figures compiled from
them. `tutor-core/src/code` owns the lesson plan and teaching text. The tutor
app owns the live panel and persistence parse.

## App source tree

```text
apps/tutor/
  app/                         Next routes only
    (session)/                 home board + /c/[sessionId]
    admin/                     syllabus playground
    api/                       route handlers (no business logic dumps)
  components/
    ui/                        shadcn primitives
    brand/                     Logo, Brand
    dither/                    session-home pixel field (not the marketing site)
  features/tutor-session/      session page, hooks, presentation, chrome
    components/  hooks/  hooks/turn/
    lib/
      scene/  board/  turn/  notes/  input/  replay/  code-lesson/
      statusConfig.ts
  features/admin/              syllabus playground
  lib/                         app-wide helpers grouped by domain
    boards/  scene/  replay/  tts/  llm/  obs/  r2/  client/  db/
    code-lesson/  code-render/  lecture-export/
  scripts/
    dev.ts, r2-setup.ts
    verify/                    wired into pnpm verify
    live/                      optional / not in the default verify chain
    lecture-lab/               offline whole-lecture runs
  prisma/                      schema + migrations
  server.ts                    custom server + TTS WebSocket relay
```

```text
apps/landing/src/
  pages/                       Privacy, Terms
  components/                  marketing sections (hero-lesson, dither, …)
  lib/                         cal/tutor hrefs, scroll helper
```

See [packages.md](packages.md) for per-file maps and [backend.md](backend.md)
for API and `lib/` modules.
