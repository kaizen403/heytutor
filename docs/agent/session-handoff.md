# Session handoff

Use this as the compact seed. Dated 28 Aug 2026. HEAD `5d7a5f1` on `origin/main`.

Range: https://github.com/kaizen403/heytutor/compare/9b55517...5d7a5f1

## Status

Physics required-visual gaps are closed. Bank compile: **physics_misses=0**, **maths_misses=2**. Maths reusable operators are in: `space_frame` / `space_point` / `space_line` / `plane` for 3D; `implicit_curve` for named 2D conics; calculus OCR + `function_region`. Coordinate geometry (maths|10), 3D (maths|11), and vectors (maths|12) required misses are 0. Live-test Physics when convenient, then Maths. Do not commit or push unless asked.

Local `.images/` scratch is untracked. Leave it.

## Product

HeyTutor: two streams, one authority boundary.

1. **Verified diagram** — `@heytutor/scene-engine` commits exact, qualitative, or question-representation geometry before narration. Operators and family builders, not teaching-LLM ink.
2. **Narrated work** — teaching LLM + ElevenLabs TTS write equations in the left work area and reveal the already-verified scene in sync on Konva.

Constraints that stay live:

- Canvas **1200×700**, origin top-left. Diagram zone: x **400–1160**.
- Scene-engine owns every diagram mark. No topic templates, chapter registries, question-id picture lookup, or model-authored diagram pixels.
- Teaching stream owns narration, work-area `WRITE`, and `[FOCUS:id]` only. `[FOCUS:id]` may trace existing verified geometry.
- Bank is an **oracle**. Runtime never looks up question id or topic id. Do not grow English regex as the main coverage strategy. Prefer family builders + ProblemIR structure.
- Invalid or partial candidates never render. Figure-absent MCQs (“shown in the figure” with no drawable apparatus) stay honest text-only.
- Coverage grows via reusable operators/assertions, never per-question templates or validator bypasses.
- Never add Cursor as co-author. If a commit gains a Cursor trailer, strip it with amend before finishing.

Map: [start.md](../../start.md) · [architecture.excalidraw](../../architecture.excalidraw) · [AGENTS.md](../../AGENTS.md)

## What this session finished (Physics gaps)

The leftover ~20 Physics required misses are closed.

- Whitespace collapse in `normalizeStem` so `magnetic\nfield` and `binding\nenergy per nucleon` match.
- `meter bridge` = `metre bridge` → `circuit_network`.
- `optical_train` is the instrument proof; exam text saying “normal adjustment” no longer demands a second LLM-style `converges` assertion (`packages/scene-engine/src/document/validation.ts`).
- Reusable families: parallel plates/sheets, named variation graphs (`v_d` vs `J`), hanging wires + pan, current-element field.
- Figure-absent MCQs stay **honest text-only**, not fake I–V/networks.
- Stronger OCR/mojibake filter in the bank harness.
- Admin probes: **label-driven extras** (`topicCue` in `generate-physics-unit-probes.ts`), not unit-wide apparatus. Refraction-at-plane-surface no longer mentions lens/mirror.

Key files:

- `packages/scene-engine/src/synthesize/familyScene.ts`
- `packages/tutor-core/src/planners/sceneCapabilities.ts`
- `packages/scene-engine/src/document/validation.ts`
- `packages/scene-engine/scripts/verify/generate-physics-unit-probes.ts`
- `packages/scene-engine/scripts/verify/verify-bank-family-compile.ts`

Bank report: `data/question-bank/reports/coverage/bank-family-compile-2026-08-27.json` — Physics required misses 0; Maths required misses 2.

## What this session finished (Maths operators)

Reusable, not per-question:

- 3D: `space_frame`, `space_point`, `space_line`, `plane` (isometric). Skew lines / vector equations stay in `coordinate_figure`.
- Planar conics: named hyperbola / ellipse / parabola compile `implicit_curve` (or `function_curve` for an explicit parabola). 2D “angle between two lines” stays analytic, not isometric 3D.
- Calculus: OCR `y=4-x2`, `abs()`, `function_region`; related-rate circle / triangle / cube.
- Circle-locus setup (variable diameter AB) compiles the given circle.

Leftover required misses (2): garbled non-English OCR cost function (maths|7); mixed integral + 3D-vector OCR page (maths|8). Do not grow English regex to chase those.

## Also on `main` (prior uncommitted WIP, same 11-commit push)

- Notes chat: Prisma `BoardChatMessage` + `/api/boards/[boardId]/notes-chat`, notes sidebar (`NotesPanel`, `NotesChatSidebar`).
- Lecture lab: live recordings / headless watch via one runtime.
- Landing: chalk comet + self-hosted type.
- Drawing: independent `scheduleFrame` clock so stalled TTS cannot freeze the pen.
- Stored-lecture auto-replay and board-shell restore.
- Tutor chrome on the same logo/tokens as landing.

## Eleven commits on `main`

| SHA | Why |
|---|---|
| `5b17b5c` | Independent drawing clock so stalled TTS cannot freeze the pen |
| `792f334` | Landing chalk comet and self-hosted type |
| `43c6d9d` | Persist board notes-chat off the teaching turn |
| `2708c28` | Notes panel + lesson chat instead of the transcript dialog |
| `4908603` | Lecture lab queue / watch / record via one headless runtime |
| `c1a7acf` | Stored-lecture auto-replay and board-shell restore |
| `1f31c10` | Physics diagram families (no per-question templates) |
| `1fde4ca` | On-topic Physics probes + bank compile at 0 required misses |
| `14749ce` | Agent map (`start.md`, Excalidraw, bank-compile pointers) |
| `d341ae9` | Tutor chrome on the same logo/tokens as landing |
| `5d7a5f1` | Verify scripts wired for notes, bank-compile, and Physics probes |

First two commits briefly had a Cursor co-author trailer from the environment; they were amended before later commits/push. Later commits had no trailer.

## Gates that were green

```text
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-family-synthesis.ts
pnpm --filter @heytutor/tutor-core exec tsx scripts/verify/verify-scene-capabilities.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-scene-engine.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-math-evaluation-corpus.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-evaluation-compile.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-bank-family-compile.ts
```

Dev: `pnpm dev:tutor` → http://localhost:3000

## Next

Priority order, issues, and live-checks: [diagram-engine-priority.md](../plans/diagram-engine-priority.md).

1. **Live-check the patches in this tree** (river-boat variants, Kirchhoff two-loop + save, Watch Live planning/pen, At a time → 5). Old boards still hold bad scenes — re-record.
2. **P0** — honest last-resort / exact tier, ProblemIR family programs (circuits + river variants), bank scores wrong picture not `primitive_count > 0`.
3. **P1** — persist the accepted live document; FOCUS mismatch must not drop the recording.
4. **Live-test remaining Physics**, then Maths conics / 3D. Log wrong family vs no ink vs persist 400. No question-id allowlists.
