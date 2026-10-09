# Packet completion log: C / chemistry-kit-fit-20261010

## Assignment and source contract

- Worker: Codex in `muscat`; integration owner: repository owner. Date: 2026-10-10.
- Branch `feat/chemistry-kits`, rebased onto harness `917b17ee`. Measurement base HEAD `5ce2845b` plus the frozen patch committed at `116c1203958e78f9aa2660191b94c3e7faa426fe`, with per-file hashes in `.context/chem-fit-source-snapshot.json`. Approved budget continuation and final evidence publication did not change measured code or the library.
- Scope: repair existing molecule, Lewis and VSEPR kit fit; no new family or topic coverage assignment. Frozen evaluation: the same 55 required/optional chemistry rows from the prior 106-row Part 12 chemistry cohort, 17 required and 38 optional. No chapter certification is claimed.
- Owned chemistry modules, planner chemistry guidance, kit verification scripts and curated chemistry examples. The owner explicitly approved one exception: raise only the curated `chem_organic` cap to four in `apps/tutor/scripts/lecture-lab/build-diagram-exemplar-library.ts`. No other restricted lab/app implementation was edited.
- Reuse audit: share existing molecule graph layout/rendering, Lewis and VSEPR builders. Previously rejected source inputs exposed single-molecule API limits, malformed SMILES acceptance, expanded sulfur rejection, collapsed-group/aldehyde bond proofs, overlapping kit origins, required carbon helper dots and label spacing.

## Changes and checks

- Existing skeletal operator now accepts 1..4 name/SMILES molecules, comparison/reaction layout, and at most three optional labelled arrows. All geometry and nonadjacent routing are engine-owned, with no topic/question lookup or product inference.
- Tightened the supported SMILES subset and actionable name failures. Preserved legacy single-molecule inputs. Expanded sulfur valence is computed from the graph; unsupported isotope/tetrahedral stereo is rejected rather than discarded.
- Fixed visible-bond proofs, skeletal helper visibility and multi-kit packing. Lewis/VSEPR fit parameters are kit-only; live defaults and live family routing remain unchanged.
- Wrapped longer kit captions into ordinary compact labels without bypassing the validator. Four active panel examples (two comparison, two reaction); six other active chemistry examples and all 16 excluded `.json.unconverted` references retained.
- Independent/source oracles: malformed syntax and impossible valence rejection; H2SO4/H2SO5 formulas; ethene/ethyne stroke counts; SF4 atoms/lone pairs; CO2 double bonds/lone pairs; explicit source-derived graphs for all 15 previous invalid-input rows; XeF2/4/6 shape composition; nitrate resonance; six iodoform source candidates split across two panels.
- Mutation/red evidence: new panel/parser/proof gates failed before repairs; complete-caption gate failed on truncated `2-methylpropan-2-ol`. A long-label attempt was rejected by the unchanged compact-label validator, then ordinary wrapped labels passed. No validator bypass was retained.
- Passed commands: `pnpm --filter @heytutor/scene-engine verify:chemistry-kits`, `typecheck`, `lint`, `verify:chemistry`, `build`; `pnpm --filter @heytutor/tutor-core build`, `typecheck`, `verify:coverage`; tutor `typecheck`; `tsx scripts/lecture-lab/build-diagram-exemplar-library.ts`; `tsx scripts/verify/verify-diagram-eval.ts`; `git diff --check`. Builds/verifies used `nice -n 19` while the harness's paid round was RUNNING, and no builds were run during this chemistry round.
- Existing full-suite baseline failures remain: scene-engine Kirchhoff/collision/photoelectric archetypes; tutor-core photoelectric expects energy_level but selects chem_orbital. Four existing scene-engine DSA lint warnings and one existing tutor-core warning; no new lint errors.
- Offline render evidence: `.context/chem-fit-renders/`, four panel SVG/PNG examples inspected. Full names/conditions remain readable and complete. Paid figures: all ten committed figures among 55 completed rows were viewed once and graded in the same session as 40 anchors. Continuation viewed only the four new crops; the previous six crops and anchors were not reopened.
- Live/replay: owned Azure port-3100 server restarted and HTTP 200/405 read-only health checks passed. No live reveal/persistence/replay certification or whole-chapter acceptance is claimed.

## Source-input outcomes

These are partial source-input compile gates, not full topic acceptance. Exact IDs below omit the leading `chemistry|` only for readability.

| Exact topic ID | Checked source variants | Proposed state | Remaining obligations |
|---|---|---|---|
| chemistry\|10\|group-16-oxygen-family | q2 peroxosulphuric/sulphuric panel; q3 sulphuric acid | verification_pending | Paid invalid inputs still present; rejected argument payloads not stored |
| chemistry\|10\|group-18-noble-gases | q3 XeF2/XeF4/XeF6 composition | verification_pending | End-to-end source obligation and live/replay unaccepted |
| chemistry\|14\|structural-and-stereoisomerism | q2 source alkene graph | verification_pending | Complete bromination isomer enumeration is not implemented |
| chemistry\|15\|classification-nomenclature-and-preparation-of-hydrocarbons | q2 source branched bromide | verification_pending | Paid invalid-input code cleared, but no figure; complete elimination products not inferred by kit |
| chemistry\|15\|ozonolysis-and-polymerisation-of-alkenes | q2 alkene/propanone panel | verification_pending | Paid planner arguments still fail |
| chemistry\|16\|preparation-and-nature-of-c-x-bond | q2 three halide graphs | verification_pending | q2 retains invalid-input code; q1 acquires it; rejected payloads not stored |
| chemistry\|17\|alcohols-identification-and-dehydration | q1 three alcohol graphs | verification_pending | Paid planner arguments still fail |
| chemistry\|17\|alpha-hydrogen-aldol-cannizzaro-and-haloform | q1 all six source substrates in two panels | verification_pending | Full question obligation and paid planner repair remain |
| chemistry\|17\|ethers-structure-and-reactions | q3 anisole/phenol/methyl iodide graph panel | verification_pending | Paid invalid-input code cleared; family fallback still omits products |
| chemistry\|17\|preparation-of-aldehydes-and-ketones | q2 benzoyl chloride/benzaldehyde/benzyl alcohol | verification_pending | Paid invalid-input code cleared but no figure; full question obligation unaccepted |
| chemistry\|18\|basic-character-of-amines | q1 ammonia/primary/secondary/tertiary amines | verification_pending | Paid planner arguments still fail |
| chemistry\|18\|preparation-of-amines | q1 phthalimide/benzamide/aniline; paid q3 Gabriel panel right | integration_pending | q1 still fails; q3 passing is not acceptance of whole topic |
| chemistry\|19\|amino-acids-and-peptides | q2 one source tripeptide sequence | verification_pending | Does not enumerate all six sequences or prove full-topic coverage |
| chemistry\|3\|bond-parameters-sigma-and-pi-bonds | q2 ethene/ethyne graphs | verification_pending | Paid invalid-input code cleared; family figure partial, missing explicit C-H bonds and relative C-C lengths |

## Handoff

- Paid run configuration: planner_examples_strict only, Azure gpt-6-1-sol, figure only, production 60 s. Original concurrency three, then serial resume under the cumulative $10 cap. Owner explicitly approved "Allow up to $15 total for this chemistry rerun"; the final 15 rows ran serially under that cumulative cap. No Fireworks calls.
- **55/55 completed and judged**, **zero untested**, conservative charge **$12.711315 / $15**, zero outstanding reservations and no final budget-terminated rows. The saved first 40 run hashes and judgments are unchanged. No completed row was repeated; no further paid calls are planned. The original source snapshot preserves first-segment $10/concurrency-three provenance.
- Full same-55 comparison: required drawn **3/17 -> 4/17**, required fully right **1/17 -> 1/17**; declines **23 -> 23**; invalid kit inputs **15 -> 14**; label_overlap_unresolved and required_entity_not_rendered each **6 -> 0**, unattached labels and duplicate geometry each **2 -> 0**. Zero transport failures. The extra required drawing is partial ethene/ethyne from chemistry_family, not a planner-kit coverage pass.
- Three accepted planner figures: Gabriel four-molecule reaction panel **right**, Bohr labelled levels **right**, He+ levels **partial**. Source verdicts right/partial/wrong: planner **2/1/0**, chemistry_family **2/4/1**. No figure: **32 empty_ok, 13 empty_bad**. All ten figures: **4 right, 5 partial, 1 wrong**. Required figures: 1 right, 2 partial, 1 wrong; optional figures: 3 right, 3 partial. Optional coordination-isomer q2 loses its previous partial family figure and becomes empty_ok.
- Full historical 55-row baseline: 3/17 required drawn, 15 invalid input rows, **23** distinct decline-coded rows. Owner's quoted **18** is retained as a discrepancy, not silently used as an equivalent metric.
- Fifteen previous invalid-input rows: four clear, eleven retain the error; three new rows acquire it, one on the successfully drawn Gabriel row. Exact transitions are preserved in the metrics. The raw rejected arguments are not stored, so kit fault versus malformed planner arguments cannot be fully assigned from these records.
- Forty anchor crops viewed once before reading reference labels; **34/40 (85%)** agreement, owner-selected Codex reference rather than human-only labels. No retrospective changes. Two literal-label review flags (Gabriel capitalization and VSEPR charged/subscript formatting) remain.
- Spend segments: $9.446033 initial, $0.064659 failed serial continuation, **$3.200623 approved final continuation**. Completed scene/planning usage-confirmed cost $3.015732; unknown-call retry reservations $8.900680; picker estimate $0.654426; remaining paid work $0.140477. The cumulative checkpoint includes all paid attempts. Conservative ceiling, not an Azure invoice claim; previous paired Azure and Kimi runs are excluded.
- Complete metrics/IDs, source hashes and budget evidence: `.context/chemistry-kit-fit-report.json`, `.context/chemistry-kit-fit-results.md`, and `apps/tutor/.lecture-lab/chemistry-kit-fit-azure-20261010/planner_examples_strict/`.
- Publication: keep draft PR #106 against `feat/diagram-eval-harness`; do not merge. No new operator families. Next priority is existing organic-panel fit: **23/24 requests not fully satisfied**, including three required requests and five actual judged failures. Obtaining remaining rejected arguments needs harness-owner coordination; no new instrumentation or paid rerun is performed here.
- Full disjoint demand ranking: organic 23 unmet, coordination/CFT 4, Lewis/inorganic 3, orbital boxes 3; Newman, p-V, solution curves, TLC and periodic charts 2 each; VSEPR, hydrogen-bond network, MO, Bohr, allotropes, orbital shapes, electrolysis and kinetics 1 each. Totals **55 requests, 51 unmet = 19 actual judged failures + 32 allowed optional omissions**. Optional omissions are not incorrect drawn figures. Every row remains in the denominator.

## Integration-owner disposition

- No accepted topic IDs, progress CSV rows, root-plan counters or chapter counts changed. Source compile gates and the completed paid sample are not whole-topic or chapter acceptance. Existing independently accepted Chemistry evidence is preserved.
- The requested measurement and reporting are complete. End-to-end kit repair remains partial: fourteen rejected-input rows, twenty-three decline-coded rows, thirteen missing required figures, two partial required figures and one wrong required figure remain. Topic proposals stay pending until the integration owner's independent full-scope/live/replay review.
