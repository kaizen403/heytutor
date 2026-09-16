# Chemistry lessons

A chemistry question takes the same turn as physics and maths, with one
difference in the middle: the figure is computed by the engine's chemistry
families from the formula, the named process or the numbers in the stem, and
the LLM scene planner is never asked for one. A model-authored molecule or
cell was the wrong picture every time it compiled, and a wrong picture is
worse than none.

## The turn

```text
question
  -> isChemistryQuestion            subject: classifier words, formulas, or a family cue
  -> inferChemistryFamilies         which chemistry figures claim the stem, in catalog order
  -> restrictFamiliesToChemistry    chemistry families or nothing (Bohr ladder and P-V plot are shared)
  -> synthesizeFamilyScene          first family whose document compiles and survives sceneDemand
  -> validate / compile / labels    the same engine every physics figure goes through
  -> CHEMISTRY_LESSON_RUNTIME_ADDON script notation, balanced rows, read the figure by its labels
```

`useQuestionHandler` sets `chemistryLane` from the inferred families and the
question, and skips exact planning when it is true. The fallback path then
draws the figure the way it draws a physics family figure, and the teaching
prompt gets the chemistry addon keyed off the question, never the account
subject, which does not reach that code.

## The families (`packages/scene-engine/src/chemistry/`)

| Family | Module | Draws | Grounding |
|---|---|---|---|
| `chem_organic` | `organic/` | skeletal structures from IUPAC or common names, reaction schemes with the reagent on the arrow, constitutional isomers | a name the parser fully resolves; never a partial parse |
| `chem_vsepr` | `vsepr.ts` | AXnEm shape with wedge and dash bonds, lone pairs, the characteristic angle, hybridisation and shape text | a parseable p-block formula with one central atom |
| `chem_lewis` | `lewis.ts` | Lewis structure with bond orders, lone pairs, formal charges, resonance forms side by side | a formula the octet method resolves |
| `chem_mo` | `moDiagram.ts` | three-column MO diagram for period 2 diatomics and ions, CO, NO, CN-; compact ladders for comparisons | a diatomic species token |
| `chem_orbital` | `orbitalBox.ts` | box diagrams from the electron configuration, orbital shapes with nodes, subshell ladders for a given n | an element or ion, an orbital name, or n |
| `chem_cft` | `crystalField.ts` | octahedral, tetrahedral and square planar splitting with electrons, Δ, CFSE, spin, μ, VBT hybridisation | a parseable complex with a CFT cue |
| `chem_coordination` | `coordination.ts` | complex geometry; every geometrical isomer and the Δ/Λ pair by orbit enumeration on the polyhedron | a parseable complex with an isomer or structure cue |
| `chem_electrochem` | `electrochemistry.ts` | galvanic cell with salt bridge, voltmeter and electron flow; electrolytic cell with products; Λm vs √c | cell notation, a named cell, a prose cell, or a named electrolyte; stated E° wins over the NCERT table |
| `chem_unit_cell` | `unitCell.ts` | sc, bcc, fcc cubes in isometric with hidden edges dashed; NaCl, CsCl, ZnS, CaF2; voids; density | a lattice word; edge length and mass for density |
| `chem_kinetics` | `kinetics.ts` | concentration and linear plots for orders 0, 1, 2 with half lives and asked times; Arrhenius; equilibrium approach | order plus k or t½ or percentages; two (k, T) pairs |
| `chem_thermo` | `thermoGraphs.ts` | reaction energy profile with Ea, ΔH, catalyst and two-step forms; ΔG vs T; Born Haber ladder; Ellingham; Maxwell Boltzmann | Ea and ΔH, or the named diagram |
| `chem_solutions` | `solutionsGraphs.ts` | titration curves with equivalence and half equivalence, Raoult lines and deviations, boiling point elevation | acid, base, concentrations and volumes; pA° and pB° |
| `chem_periodic` | `periodicTrend.ts` | trend plots from the element table, ordering answers, a period fragment with the asked element highlighted | a property and a period, group or element list |

Every module exports its family id, `is<Name>Stem`, `build<Name>Scene` and
`<NAME>_PROBES`. `families.ts` registers them in catalog order; the order is
the tie-break when several cues fire (VSEPR sits ahead of the coordination
families because it declines a complex itself, so a mixed option list draws
the p-block species).

Shared foundation: `elements.ts` (Z, mass, electronegativity, covalent
radius, first ionisation enthalpy, group, period, block), `formula.ts`
(formulas, charges in every spelling, coordination entities with oxidation
state and coordination number, ligand table with spectrochemical rank),
`electronConfiguration.ts` (aufbau with the textbook exceptions, ions from
the outer shell, unpaired electrons, μ), `sceneKit.ts` (`ChemScene`).

## What a chemistry figure may contain

`ChemScene` draws with the ordinary operators. Atoms are `label` entities
pinned on their position (`provenance.pinLabel`; a symbol beside a bond
junction reads as a substituent), bonds are segments trimmed back from a
labelled atom, multiple bonds are parallel strokes, a wedge is a thin
triangle, a dash is a dashed segment, lone pairs are dot pairs, electrons are
short up or down arrows, energy levels are horizontal segments, and a bond
angle is an `arc` with its value (an `angle_mark` promotes its vertex to a
drawn dot, which on an atom symbol reads as a stray electron). Pinned labels
are obstacles for the placement solver, so a solver-placed angle or level
label cannot land on an atom symbol.

A figure earns `exact_verified` only through a fatal numeric assertion
(`function_value` on a kinetics or titration curve, an energy profile with
stated Ea and ΔH). Shapes, level diagrams and cells are
`qualitative_verified`, which is the honest tier for them.

## The subject test

`classify.ts` reads chemistry vocabulary against physics vocabulary; a lone
formula is not evidence ("V10" is an OCR'd root, "N/C" a unit), and a
compound microscope, a hinge reaction, a revolving charge's magnetic moment
and an isothermal expansion of an ideal gas all stay physics. The router's
cues count as subject evidence too, which is what keeps the archetype layer
(it runs before any family) from drawing two point charges for "the shape of
the d_z2 orbital". `sceneDemand` carries `subject: "chemistry"` and
`demandRejection` refuses any document without `source.chemistryFamily`.

## The board

The pen writes formulas in script notation whatever the model typed:
`packages/drawing/src/handwriting/chemistryNotation.ts` turns `H2SO4` into
`H_2SO_4`, `Fe3+` into `Fe^(3+)`, `NH4+` into `NH_4^(+)`, `2e-` into
`2e^(-)`, and leaves `R2`, `V0`, `f(x)` and `E = mc2` alone. The chemistry
addon asks the model for that notation, for a balanced row before any
calculation reads it, and for the figure to be read by its drawn labels with
the FOCUS tag directly after the label.

## Bench and gates

```bash
cd packages/scene-engine
pnpm exec tsx scripts/chemistry-lab/status.ts [lane]        # replay a lane's probes: draws, declines, refusals, cue and label misses
pnpm exec tsx scripts/chemistry-lab/probe-stems.ts stems.json # subject evidence and the family path result per stem
pnpm exec tsx scripts/chemistry-lab/render-stems.ts stems.json out/   # SVG and PNG per stem (headless Firefox)
pnpm verify:chemistry
```

| Gate | Package | Proves |
|---|---|---|
| `verify-chemistry-subject` | scene-engine | hand stems in both directions; shared figures kept; a bank sweep with loose thresholds (the bank's subject labels are noisy) |
| `verify-chemistry-families` | scene-engine | every family's probes through the registry and the real family path; physics stems never reach a chemistry family |
| `verify-chemistry-notation` | drawing | the script rewrite, wired into `normalizeStrokeText` |
| `verify-chemistry-lane` | tutor | subject offered, addon keyed off the question, exact planner skipped, figure named to the tutor |

The lecture lab runs a chemistry question the same way as physics:
`pnpm exec tsx scripts/lecture-lab/run.ts --ask questions.txt --out .lecture-lab/chem-01`
now writes the committed figure to `frames/<slug>.svg` beside the transcript.

## The bank sweep

`scripts/chemistry-lab/bank-sweep.ts <outdir>` runs every row the question bank
files under Chemistry (2,232, of which 1,812 are readable) through the live
family path and writes `rows.jsonl`, `summary.json` and SVG samples per family.
Measured on 11 Sep 2026 after the fixes below: 1,447 rows read as chemistry,
258 drew a chemistry figure, 0 builder exceptions, and no chemistry question
received a physics figure. The 92 physics figures in the sweep are maths and
physics questions the bank misfiled under a Chemistry heading, plus one Bohr
orbit, which is the shared ladder.

Reading the sweep's own figures found four classes of wrong picture, each now
fixed and pinned in `verify-chemistry-families` as a bank regression:

- **Lost subscripts.** Scans turn SO2 into "SO,", HNO3 into "HNO;", IF5 into
  "IF,", ClF3 into "CIF" and split "XeF 4". Each parses as a real but different
  species, and 11 of 13 Lewis figures on the bank were this. `ocrSuspectToken`
  in `formula.ts` rejects them, with an allow list of species really written
  without a subscript (CO, NO, HCl, NaCl...). The MO reader applies it too.
- **Reagent drawn as reactant.** About 12 of 28 organic reaction schemes put
  the reagent, the solvent or the product on the left. `mentionRole` reads the
  words before each compound: after "with", "dissolved in", "in the presence
  of" or a scheme step "(iii)" it is a reagent and is never drawn; after
  "gives", "produces" or "mixture of" it is a product. A statement stem never
  becomes a scheme.
- **Answer options.** A name that fills a short lettered item is an option; one
  option drawn alone reads as "the" compound, so a lone option, or a row missing
  more than one of three or more options, draws nothing. A name inside a long
  lettered statement is the subject and still draws. Formula debris split across
  tokens ("CH3 OH") is never a mention, and a split systematic name
  ("2,4-dimethyl pentane") is read whole.
- **Wrong family.** "Most stable carbocation" fired the MO cue; fuel cells,
  adsorption, isotonic solutions, atom counts and nuclear decay drew organic
  structures. Each is vetoed in the family's own cue.

Two debugging tools: `organic-debug.ts <question id prefixes>` prints every
organic mention with its role and the family path result for full bank text,
and `tokens-debug.ts` prints formula tokens and the electrochemistry cue parts.
Always debug against the full bank text: the sweep's `rows.jsonl` truncates
stems to 400 characters, and one early probe run gave the wrong answer on
truncated text.

## Syllabus and probes

Chemistry is a third subject in the question-bank pipeline: the JEE Main 2026
syllabus as 20 units and 132 topics in `data/question-bank/syllabus-taxonomy.json`
(plus nine supplemental units for chapters the 2026 syllabus dropped), lexical
rules per unit in `data/question-bank/syllabus-rules-chemistry.json`, and
`tools/question-bank/question_bank/syllabus.py` treating Chemistry as supported.
Rebuild the index with
`PYTHONPATH=tools/question-bank python3 tools/question-bank/importers/build_syllabus_index.py`;
it classified 942 of the 2,232 chemistry rows to a unit on 11 Sep 2026.

`data/syllabus-probes/chemistry-unit-1.json` to `chemistry-unit-20.json` hold
203 student-typed probes (94 cleaned from the bank, 109 authored and marked
`"exam": "authored"`), no appended drawing cue. The lecture lab runs them with
`--subjects chemistry`, and the admin playground lists chemistry as a third
subject. `scripts/chemistry-lab/probe-sweep.ts` runs every probe through the
family path per unit: 77 chemistry figures and 6 shared physics figures (Bohr
orbits, a gas expansion) on 11 Sep; units 1 (mole calculations) and 20 (salt
analysis) draw nothing, which is the honest outcome for those stems.

## Rules learned here

- A family must decline what it cannot honour: a complex whose charge OCR
  dropped, four salts electrolysed together, a five-coordinate complex, an
  organic name that only half parses. The gate treats a wrong draw as fatal
  and a decline as budgeted.
- Cue lists need the other subject's words beside them. "emf of a cell,
  internal resistance" is physics; "magnetic moment of a revolving charge" is
  physics; "electrical resistivity and conductivity" is physics. Each leaked
  into a chemistry cue before the physics word was written down.
- Pinned text does not enter the compiler's fit, so a data column beside a
  level diagram was clipped until an energy axis carried the vertical extent.
- Three complexes across the diagram zone is the readable limit; a fourth
  drops below 50 px per unit and the arrowheads swallow the shafts.
