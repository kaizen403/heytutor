# DCP-04: vertical loop-the-loop work-energy failure — fixed

Dated 2 Oct 2026. Thin vertical slice: one baseline hard-probe decline resolved
with a reusable apparatus variant, not a question patch.

## Outcome

The physics-unit-4 hard probe

> "A smooth incline ends in a vertical circular loop of radius R. A small body
> is released from height h. If it exerts a force of three times its weight on
> the track at the highest point of the circle, then h = α R. Find α."

taught with **no figure**. It now commits a `qualitative_verified`
`vertical_circle` track figure: loop, approach incline, release-height
dimension `h`, body at the top with velocity `v`, normal reaction `N`, and
weight `mg`. No tension is drawn; nothing numeric is invented (symbolic R/h).

## Root cause (traced in code, both layers)

1. `detect.ts` scored "vertical circular loop" only 2 (bare `circular loop`
   cue), with no string/track distinction. The generator drew a mass-on-a-string
   figure with tensions for a track question.
2. `sceneDemand.ts` counted a bare "circular loop" as a magnetic source, so the
   demand veto (`suspended_body`) rejected the archetype figure **and** the
   `contact_body` family fallback (`verticalCircleDocument`, which draws a
   weight). Both layers declined → text-only for a required visual.

## Changes (reusable, no question routing)

- `src/archetypes/detect.ts` — `vertical_circle` gains strong cues for
  "vertical circular loop/track" (4) and "loop-the-loop" (3); EM vetoes
  (current, magnetic, biot, coil, solenoid, cyclotron, wire); `variant`
  (string/track), `releaseHeight`, `approach` slots. Bare "vertical circle"
  keeps the string figure.
- `src/archetypes/catalog.ts` — new slots; contract becomes
  `roles: [circular path, body, weight]` + `anyRoles: [[tension, normal
  reaction]]` via a new optional `PictureContract.anyRoles` disjunction.
- `src/archetypes/contract.ts` — enforces `anyRoles` (at least one role per
  group).
- `src/archetypes/generators/mechanics.ts` — `verticalLoopTrack`: loop +
  optional approach incline + release-height dimension + `N`/`mg`/`v` at the
  top, with on/perpendicular proofs and label checks. String path untouched.
- `src/synthesize/sceneDemand.ts` — `isMagneticSource`: a circular loop counts
  as magnetic only with EM context (current, magnetic, biot, ampere, coil,
  torque, induc, galvanometer). All 18 MUST_VETO / keep stems in
  `verify-structure-driven-scene.ts` still hold by inspection (Biot-Savart via
  "biot", cyclotron/helical/elements via direct words).
- `scripts/verify/verify-vertical-loop-energy.ts` (new) — 10-case independent
  gate: verbatim hard fixture, 2 string controls, magnetic + wire declines,
  numeric R/h grounding, 2 phrasing variants, grounded-incline contest, contract
  negative, planner availability (fallback + ProblemIR → contact_body). Wired
  into `scene-engine` `verify` after `verify-archetype-pictures`.
- Decline thresholds unchanged: no `minScore`/margin/threshold touched; the
  gate pins that Biot-Savart and wire loops still decline.

## Miss/decline grouping (from inspected reports, not a fresh run)

From `data/question-bank/reports/coverage/bank-family-compile-2026-08-27.json`
(22 physics + 5 maths required misses, inspected 2 Oct 2026):

| Gap | Cluster | Reusable fix (open) |
|---|---|---|
| de Broglie λ(V)/λ(√V) variation graphs (~7) | energy_level | stated-relation curve plotter |
| Biot-Savart loop/coil field-on-axis, cyclotron working, coil moment (~11) | point_field/circuit_network | current-loop field-geometry builder, cyclotron Dee figure |
| X-ray tube, Van de Graaff apparatus (2) | energy_level | apparatus builders |
| Calculation-only stems caught by `DIAGRAM_CUE` ("wave") (~3) | energy_level | calc-vs-figure demand classification |
| Circle-line locus/chord/trisection (3) | analytic_curve | coordinate-figure gaps |
| Garbled OCR (see exclusions) | mixed | source exclusion, not a gap |

Probe declines: the 49/63 counts were **not reproduced** (shell unavailable,
see below). Last inspected measurement is
[figure-relevance-fixes](figure-relevance-fixes.md) (48 vetoed + 54 no-builder
buckets). This slice resolves the loop-the-loop hard decline and unblocks the
family fallback for all mechanics loop stems via the same demand fix.

## Source exclusions (reported separately, not worked)

- `maths|7` marginal-cost OCR page, `maths|8` mixed integral/vector OCR page,
  `physics|13` Hindi-OCR block (`q_6d4071…`), `physics|17` stage-table OCR
  (`q_72c9c88c…`): garbled source text, no English demand to build from.

## Gates — BLOCKED, not run

Every shell invocation in this session failed with `Too many open files (os
error 24)`, including bare `echo`. Nothing was executed: not the new gate, not
the package `verify` chain, not typecheck/lint/build. First command to run:

```text
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-vertical-loop-energy.ts
pnpm --filter @heytutor/scene-engine verify
```

All gate assertions were instead hand-traced against the cue/demand/contract
code and are documented case by case; treat this slice as unexecuted until the
above is green.

Note: per `docs/agent/session-ownership.md`, scene-engine
synthesize/archetype/verify edits should be announced; this child session has
no announcement channel, so the edits land unannounced — flagging here.
