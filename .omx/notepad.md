# Notepad

## Priority Context

- Monorepo: pnpm + turbo. App: `apps/tutor` (Next 15.3.6, custom `server.ts` with TTS WS relay). Packages: `packages/drawing`, `packages/tutor-core`, `packages/whiteboard`.
- Dev: `pnpm dev:tutor` → http://localhost:3000 (Postgres in Docker on :5433, `pnpm db:up`).
- Do NOT commit unless user asks. Do NOT re-adopt Hey Clicky (farzaa/clicky) architecture.

## Working Memory

### 2026-07-11 — Ray Optics mastery + convex-mirror cleanup (compact)

**Shipped (uncommitted on `main`, tip `236dced`):**
- Ray Optics family templates: `opticsFamily.ts` splits catch-all into prism / TIR / instrument / lens_combo / lens / mirror / refraction_plane (registry most-specific first).
- `opticsPrecision.ts`: classifier, per-kind intros, label/dimension geometry. Convex: C/F/image behind pole; labels at `LABEL_ABOVE_Y=228`; accurate DIMENSION endpoints; signed f/v when virtual.
- `commandPlacement.ts`: `isBlockedOpticsOwnedAnnotation` blocks LLM DIMENSION + owned labels (C/F/O/u/v/f…) even when diagram-zone LLM draw is allowed (rays still OK).
- Optics debug: `tutorDebug` scope `"optics"`; Langfuse events (`optics-match`, `optics-classify`, `optics-intro-built`, …); playbook `docs/agent/optics-debug.md`; `MAX_EVENTS=400`.
- Prefer hand templates when `templateCommandCount >= plannerCommandCount` in `useQuestionHandler.ts`. Planner still weak for diagram JSON — templates are primary for optics/cube.
- Earlier in thread: diagram architect, adaptive draw speed, cube zigzag resistors, 32 backdated commits pushed Jul 8–10.

**Retest first:** convex mirror *object 20 cm in front, f=15 cm* — expect clean axis, C/F behind pole (x>610), no stacked u/f DIMENSION overwrite. Langfuse: `template-draw-blocked` on DIMENSION; `optics-intro-built` command_summary.

**Servers:** tutor http://localhost:3000 · landing http://localhost:5173 · Postgres healthy on :5433.

**Key files:** `opticsFamily.ts`, `opticsPrecision.ts`, `commandPlacement.ts`, `useQuestionHandler.ts`, `docs/agent/optics-debug.md`, `verify-diagram-templates.ts`.

### 2026-07-11 — Optics snap + mid-lesson lag

**Ray snap:** optical-plane projection in `geometrySnap.ts` (lens x=650, combo 620/680, instrument 520/820). Decorative bezier samples no longer steal bends. Mirror arc control fixed so B(0.5)=pole (610,300) via cx=530. Shared `LENS_O_X`/`MIRROR_POLE_X`/`OPTICS_MIRROR_CURVE`.

**Lag:** `drawChainRef` — speech advances segment chain; ink trails. Optics intro C/F/O + u/f/v merged into fewer segments. `startDelayMs` capped at 400ms. TTS `failCurrentJob` no longer wipes the whole queue.

**Retest:** convex lens principal rays (bend on vertical spine); mid-lesson should not go silent after a paragraph.

### 2026-07-11 — Idle/smooth fix (Langfuse f2f0c8f3)

**Last turn:** concave lens u=60 f=20, latency **574s**, 8× `tts-segment-failed` at 45s, draw waiting 2.5s×N per command with no audio.

**Fixes:** WS watchdog 5s; outer TTS timeout 12–18s + `abandonSpeaking()` kills zombies; HTTP timeline wait capped 1.2s; one audio-wait per segment (700ms) not per command; idle-complete 350ms.

**Retest:** same concave lens question — should stay continuous, no multi-minute silence.

## MANUAL

