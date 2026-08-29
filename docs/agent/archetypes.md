# Archetype layer

`packages/scene-engine/src/archetypes/` decides *which* figure a question calls
for and computes that figure from the question's own numbers. It runs before
the legacy family builders in `synthesizeFromFamilies` and returns `null` for
anything it does not own, so every other path is unchanged.

Why it exists: the audit of 29 Aug 2026 found that the family layer stamped
fixed-coordinate fixtures selected by first-match regexes (a Wheatstone bridge
drawn as a series chain, a satellite as two point charges, an x–t graph as a
v–t trapezoid), and that nothing checked a picture *corresponded* to the stem.

## Pieces

| File | Job |
| --- | --- |
| `catalog.ts` | Closed vocabulary of ~58 archetypes. Each has a family, typed slots (with `required` / `metric` flags) and a **picture contract** — the roles, operators and symbols a document must contain to be that figure. No coordinates. |
| `slots.ts` | Extraction utilities: plan givens first, stem numbers second, every value tagged with its source (`plan` / `stem` / `default`). |
| `detect.ts` | Scored decision over the catalog: weighted cues, vetoes, structure bonuses from `lawIds` / ProblemIR intents, a margin rule. Fills slots. Returns `null` when no figure clears the bar. |
| `generators/*.ts` | One parameterized generator per archetype. Geometry is computed from slots (trajectory from u and θ, incline components from θ, image position from the mirror formula, P–V cycle from the named processes, tangent from the stated curve…). Missing slots use declared display values. |
| `document.ts` | `SceneBuilder`: a small DSL over scene-document/v2 so generators read as geometry. |
| `contract.ts` | `checkPictureContract` (completeness) and `metricAssertions` (which fatal assertions carry a value). |
| `tier.ts` | One tier rule: `exact_verified` only when every metric slot is grounded **and** a fatal metric assertion is present; otherwise `qualitative_verified`; `question_representation` for schematics. `tierForForeignDocument` applies the same honesty to planner or legacy documents. |
| `index.ts` | `attemptArchetypeScene` / `synthesizeArchetypeScene`: detect → generate → contract → validate → compile → `demandRejection` → tier. `augmentTurnPlanWithArchetypeSlots` turns stem numbers into plan-shaped givens for builders that only read the plan. |

## Gates and tools

- `scripts/verify/verify-archetype-pictures.ts` — the picture gate. Asserts archetype, tier floor, contract, compile, phrasing-variant agreement and the must-decline negatives from `scripts/probes/archetypeProbes.ts`. `--render <dir>` writes every accepted figure as SVG plus contact sheets.
- `scripts/render-scene.ts "<question>" [out.svg] [--png]` — one board for one question through the deterministic path.
- `scripts/lib/renderSceneSvg.ts` — RenderScene → SVG; the only way to look at a diagram without the browser.

## Rules

- Grow coverage by adding an archetype (catalog entry + cue set + generator + probes), never by widening a regex to catch one more stem or by adding a fixture.
- A generator that cannot honour its slots returns `null`. Text-only beats a wrong picture.
- Roles are semantic and honest: a paraxial principal ray is declared with `approximation: "paraxial"` on its construction (validator-recognised), not by avoiding the words the validator checks.
- Display scaling is a declared affine factor on the vertical axis of graphs; assertions are written in the scaled space and labels report true values.
- The stem cues are a test oracle exercised by the gate. If a probe group's variants disagree, fix the cue set, not the probe.
