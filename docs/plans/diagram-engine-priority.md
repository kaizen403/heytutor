# Diagram engine — priority plan

Dated 28 Aug 2026. Working tree is ahead of `origin/main` (`5d7a5f1`) with uncommitted Physics/Maths/lecture-lab work. Do not commit unless asked.

The engine can compile honest geometry. Live failures are almost always the **wrong picture for this stem**, not a missing operator. Bank-compile `physics_misses=0` only means some ink compiled.

Do not: grow English regex as coverage, add per-question templates, question-id picture lookup, or a v5 rewrite before the selector is honest about schematic vs exact.

## Now — live-check the patches already in the tree

Done in code, not yet proven on a fresh admin/tutor pass. Completion: you watch one new run of each, not a replay of the old boards.

1. **River-boat (Physics Unit 2).** Easy / medium / hard must be three different figures: along-stream banks, 150° heading, two velocity triangles. Not origin–A–B arrows.
2. **Kirchhoff.** Watch Live during **Planning**. Figure is a two-loop with batteries, not a series resistor chain. Speech and pen keep moving. Simple “draw a labelled diagram” lessons run a real 8–12 step setup, not a two-line wrap-up.
3. **Save leftovers.** Re-record a Kirchhoff (or any dense intro). It must persist a turn. `Delete leftover` on `f6477c0e-…` and `cac2ff98-…` is safe.
4. **Concurrency.** Admin **At a time → 5**, five distinct questions. Ink and audio stay on the matching board. Mixing is blocked in tests; tab CPU / five TTS sockets are the live risk.

Old saved lectures still hold the bad scenes. Re-record; do not judge the patch from replay.

## P0 — Stop lying about the picture

Highest product risk. Same class as river-boat A/B and Kirchhoff series-for-loops.

| Issue | Why it hurts | Done when |
|---|---|---|
| Last-resort is a recycled unit picture (`schematic: true` + dummy `f_o`, canned `4-x^2`, default two charges) | Medium looks like easy; “angle” becomes a circle | Last-resort emits a grounded schematic **or** text-only. No canned apparatus the stem does not name. |
| Family synthesis can stamp `exact_verified` on invented coordinates | Trust label hides leftovers | Ungrounded family builders are `qualitative_verified` or `question_representation`. Exact needs plan-backed metric assertions, not `exists` only. |
| ProblemIR does not choose families on the live exact path; `ENTITY_FAMILIES` is eight coarse kinds | Boat→contact_body, river→bounded_region; English override still wins | `inferSceneCapabilities` receives ProblemIR on the live path. Circuit loop/branch count and river variant (along-stream / crossing / two triangles) come from structure, not a second regex file. |
| Duplicate stem classifiers in `sceneCapabilities.ts`, `familyScene.ts`, and fallback rejectors | River/hyperbola/Kirchhoff fixes will drift | One family-program seam. English stays a **test oracle**, not the live catalog. |
| Teaching never has to match the committed diagram | COMPLETE Kirchhoff: series ink, two-loop voice | Narration topology is checked against committed entity/family (loop vs series, crossing vs along-stream), or teaching is constrained to named verified IDs. |
| Bank compile scores `primitive_count > 0` | Wrong family still “passes” | Physics sample gate asserts picture class: two-loop vs chain, banks vs A/B, hyperbola vs circle. Style already in `verify-family-synthesis.ts`. |
| Figure-absent “honest text-only” is harness-only; live still drops only `state_plot` | “Shown in the figure” can paint a fake network | Live `familyScene` matches the harness: no drawable apparatus → no fake circuit. |

First discriminators (Physics): Kirchhoff / Wheatstone / series vs two-loop; river-boat three variants. Then meter bridge, instruments, parallel plates — live-test, log **wrong family vs no ink vs persist 400**, fix as family programs.

## P1 — Persist the accepted live document

| Issue | Why it hurts | Done when |
|---|---|---|
| Non-metric persist re-runs `selectVerifiedRepresentation({ question, turnPlan })` with no families and no ProblemIR | Replay can differ from what was taught; FOCUS on new IDs 400s the save | Persist **recompiles the accepted document** and replaces intro ink. Do not re-infer families from the question. |
| 400 on FOCUS-unknown-id still empties the lecture | Leftover boards with 0 turns | Keep 400 for proof/solver/untrusted geometry. Do not 400 because intro command counts differed (already patched). Confirm FOCUS mismatch is a warning or a teaching-filter, not a dropped recording. |

## P2 — Live lecture = main tutor

Mostly patched in the working tree. Treat as closed only after the Now live-check.

- Planning / thinking overlay on Watch Live (same copy as `/c/...`).
- Pen uses estimated TTS schedules immediately (no 2.4s audio-start wait).
- Per-lecture `AudioContext`; Watch Live click still resumes audio.
- Simple diagram-setup stems: 8–12 step beginner loop. Hard numbered problems stay capped; no recap filler.
- Cap **5** jobs; scene memory `{boardId}::{question}`; cannot attach to another job’s board.

Open live risks: five TTS sockets in one tab; content quality still depends on the teaching model following the new prompt.

## P3 — Maths after Physics live-test

Operators are in: `space_frame` / `space_point` / `space_line` / `plane`; named hyperbola/ellipse via `implicit_curve`; planar angle is not isometric 3D; OCR calculus + `function_region`.

Bank: `maths_misses=2` (garbled OCR, not missing operators). `maths|10|11|12` required misses are 0.

Live-test: skew lines, hyperbola/ellipse, related-rate circle, area-between-curves, 2D angle-between-lines. Do not grow regex to chase the two OCR leftovers.

## Explicitly later / not this plan

- v5 `CapabilityRequirementIR` / `OperatorProgram` rewrite
- Per-question templates, topic registries, question-id lookup
- Weakening persist so leftovers “complete”
- Committing `.images/`
- Starting a new Maths operator push before Physics live-test of circuits + Unit 2

## Issue log (this session)

| Seen | Root | Status |
|---|---|---|
| Unit 2 river-boat: two lectures, same A/B angle | `vector_diagram` default two arrows | Patched in tree; re-record to confirm |
| Kirchhoff easy/hard: could not save | Persist required client ink == server compile | Patched; leftovers are empty boards |
| Kirchhoff medium COMPLETE: series chain, two-loop voice | Default `circuit_network` fixture | Two-loop builder in tree; teaching match still P0 |
| Marker stops / speech drops on Watch Live | Pen waited on TTS; shared AudioContext | Patched; live-check |
| Watch Live showed no Planning | Headless shell omitted tutor overlay | Patched; live-check |
| Simple questions too short | Teaching prompt wrapped up | Prompt asks 8–12 steps; live-check |
| Hyperbola drawn as circle; 2D angle as 3D | `coordinate_figure` defaults | Patched in tree |
| Concurrent jobs could share a scene by stem | `rememberVerifiedScene` keyed only by question | Scoped to board+question |
| Admin concurrency | Cap 3, isolation incomplete | Cap 5 + attach/watch guards |

## Sequence

```text
1. You: live-check Now (river-boat, Kirchhoff, save, 5-at-once)
2. P0: honest tier + ProblemIR family programs (circuits, river variants)
3. P0: bank sample scores wrong picture; live figure-absent = text-only
4. P1: persist accepted document; FOCUS mismatch must not drop the lecture
5. You: live-test remaining Physics (instruments, meter bridge, plates, bands)
6. P3: live-test Maths conics / 3D
```
