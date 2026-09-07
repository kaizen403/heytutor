# Folder structure plan

Dated 5 Sep 2026. Living backlog for layout — not a rewrite.

[layout.md](../agent/layout.md) is the placement rule. This file is the cleanup
queue. When a move lands, update `layout.md` and strike the row here.

The repo is a deep-module split: scene-engine / drawing / tutor-core /
whiteboard behind small barrels, plus one tutor app and one marketing app.

## Do not

- Do not add a package for a second consumer that does not exist.
- Do not split `features/tutor-session` into many features. Home, `/c/[id]`,
  notes, marking, and the code panel are one product surface
  (`TutorSessionShell`). Cluster *inside* that feature when a folder is
  touched.
- Do not add `features/landing` in the tutor app. Marketing is `apps/landing`.
  The empty-board overlay stays in `tutor-session`.
- Do not merge `drawing/src/sync` with `tutor-core/src/sync`.
- Do not move DSA traces out of `scene-engine` or lesson plans out of
  `tutor-core`.
- Do not rename protocol types (`TurnPlanV3`, `SceneDocument/v2`,
  `code-lesson/v1`) to “drop the version”.
- Do not copy question-bank JSONL into `packages/`.
- Do not add a sibling at `features/tutor-session/lib/` root. New helpers go
  in `scene/`, `board/`, `turn/`, `notes/`, `input/`, `replay/`, or
  `code-lesson/`. `statusConfig.ts` is the only leftover at that root.

## Target shape

```text
apps/landing/          marketing site (Vite)
apps/tutor/            session product (Next) + API + WS
packages/
  scene-engine/        diagram authority
  drawing/             command protocol, paths, write clock
  tutor-core/          planners, teaching LLM, TTS, code-lesson plan
  whiteboard/          Konva renderer + pen chrome
  design-tokens/       shared visual constants
  eslint-config/       lint presets
  typescript-config/   tsconfig presets
tools/question-bank/   Python corpus pipeline (not in the pnpm workspace)
data/                  corpora and probes only
docs/                  agent | architecture | ops | plans | product | snapshots
deploy/azure/          backend VM
```

Root keeps `package.json`, lockfile, `turbo.json`, `docker-compose.yml`,
`README.md`, `AGENTS.md`, `start.md`, `architecture.excalidraw`. Nothing else
durable.

## Session `lib/` clusters (landed)

```text
apps/tutor/features/tutor-session/lib/
  scene/          verified commit / reveal / fallback
  board/          layout, marking, route, spotlight, write helpers
  turn/           teaching prompt, failure, segments, follow-up
  notes/          notes chat, notes PDF glue, math text
  input/          ask-bar, mic, image
  replay/         auto-replay gate
  code-lesson/    live conductor, type-along, CodeMirror
  statusConfig.ts chrome status copy (left at root on purpose)
```

Code-lesson split, kept:

| Home | Owns | Never |
|---|---|---|
| `packages/scene-engine/src/dsa/` | Algorithm catalog, simulators, `traceToScene` figures | Teaching copy, CodeMirror, persistence |
| `packages/tutor-core/src/code/` | `CodeLessonPlan`, classifier, teaching prompt, format/trace gates | Konva, CodeMirror, R2/PG |
| `apps/tutor/features/tutor-session/lib/code-lesson/` | Live conductor, type-along, CodeMirror setup | Plan schema, trace geometry |
| `apps/tutor/lib/code-lesson/` | Persist parse / re-validate on restore | Live playback |
| `apps/tutor/lib/code-render/` | Canvas snapshot of the code panel (notes / MP4) | Lesson logic |

## Landed

- Agent maps list the current folders (`layout.md`, `packages.md`, `backend.md`).
- Session `lib/` clustered (P0). `lib/` root holds only `statusConfig.ts`.
- App folders kebab-renamed: `codeLesson/` → `code-lesson/` (P1).
- Helper filenames dropped version suffixes (P2): `diagramGeneration.ts`,
  `representationFallback.ts`, matching verify scripts. Protocol symbols
  (`TurnPlanV3`, `contractsV3.ts`, `turnPlannerV3.ts`) stay.
- `.images/` gitignored. `verified-diagram-engine-v3-plan.md` stamped historical.

## Still open

### P3 leftovers (no behavior, optional)

- Do not commit root `hero-*.png` / `landing-*.png`, `remaining.md`, or
  `verify4.js`. Delete them when they are not needed.
- `remaining.md` is a session dump, not a map. Do not extend it; engine work
  stays in `docs/plans/diagram-engine-priority.md`.

### Later — only if a second consumer appears

- Shared Brand / dither package. Until then, two copies are cheaper than a
  shallow `@heytutor/ui`.
- Grouping `packages/whiteboard/src/` (`pen/`, `cursor/`). Flat is still
  smaller than 20 files.
- `apps/tutor/components/dither` vs landing dither: leave both.
- `features/tutor-session/components/`: do not pre-split. A subfolder is
  allowed when a cluster already has four files and is being edited
  (`landing/`, `notes/`, `code-lesson/`). `hooks/turn/` is the model.

## How this plan is maintained

1. Adding a folder → add it to `layout.md` in the same PR.
2. Landing a row above → strike it here, keep `layout.md` as the live tree.
3. A new kind of file with no row in “Where new files go” → add the row first,
   then add the file. Do not invent a parallel tree.
