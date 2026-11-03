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

Native VSEPR angle labels pass save admission through
`certifyVseprSourceDocument` in `chemistry/sourceEvidence.ts`. It regenerates
the complete source graph and checks planner scalars by species and role;
only matching graph-bound labels gain numeric authority. Stripping family
metadata cannot skip this check. Unknown or ambiguous derived roles decline,
and projected angles or inequality bounds do not prove an exact measurement.
The common plan audit still checks all other values. A closed carbon bond
line, such as CH2=C=O or CH3-CH=CH-C≡N, is declined: the formula reader
must not split it into a fragment molecule or invent a charge on the bond
hyphen. Separate formulas, including CH3- next to CH2, stay eligible. Run
the offline tutor gate `scripts/verify/verify-vsepr-source-evidence.ts` for
live/save/reopen, answer staging and graph/plan tampering controls.

## Curly arrow mechanisms (`organic/mechanism/`)

A mechanism figure is drawn from electron bookkeeping, never from a picture
of the reaction.

- `state.ts`: atoms with lone pairs and bonds with orders; formal charge is
  V minus lone pair electrons minus bond count. The shell rule refuses more
  than 8 electrons, and fewer than 8 except on a carbon the step declares
  as a carbocation.
- `condensed.ts`: reads condensed formulas (`CH_2=CH_2`, `R-C(=O)-OH`,
  `HO-N(CH3)2`, `(CH3)3C+`) into states. Molecular formulas such as `C2H4`
  are refused because they name no structure. A charge must sit on the one
  atom whose valence needs it.
- `arrows.ts`: a curly arrow moves one pair. A lone pair forms a bond from
  its own atom. A bond pair stays on one of its atoms or moves to a bond
  sharing one atom. The arrows of a step act together, and the result must
  conserve electrons and charge and pass the shell rule.
- `eliminations.ts`: ester pyrolysis and xanthate pyrolysis (six atom
  ring) and the Cope elimination (five atom ring). The site is found on the
  graph. When only products are stated, the substrate is rebuilt from them
  and the forward arrows must give exactly those products. A xanthate is
  O-alkyl and S-alkyl: `HS-C(=S)-SH` comes from no xanthate, and
  `HS-C(=O)-SH` only from the free xanthic acid, which loses CS2 instead.
  A Cope amine oxide is tertiary. The alkene carbons carry only C and H, so
  no enol or enamine is drawn as a product. Products that fit two
  substrates, a substrate with two inequivalent beta sites, and a ring
  opening that leaves one species decline.
- `source.ts`: a named mechanism plus stated condensed species, read from
  two accepted stem shapes only. Every other stem declines. The reader
  accepts what it understands instead of refusing what it has seen go
  wrong: seven review rounds showed free text always has one more way to
  state the opposite (a reverse direction, a swapped pairing, an option, a
  second task).
  - The ask: "Show / Draw / Explain / Describe (the mechanism of) the
    <reaction> of <substrate>", or "What is the mechanism of the
    <reaction> of <substrate>?", with fixed tails ("on heating", "with
    curly arrows", "with mechanism", "via a six membered cyclic transition
    state", "at 500 C") and an optional "Draw the arrows." The substrate is
    a condensed formula the named class runs on. A stated temperature must
    be one the class runs at (ester pyrolysis 250 to 700 C, the others 100
    to 700 C).
  - Notes: reaction headings, ring size and heat phrases ("A six membered
    T.S.", "Heat", arrows) and product sets "A + B". The only verb is a
    bare "<reaction> gives A + B". The one descriptive phrase is "involves
    the cleavage of amine oxide(s)", read only in a sentence whose only
    name is the Cope elimination; a stored question cut inside it ("amine
    oxid") still reads.
  - Both shapes: outside formulas, only letters, digits, spaces, `. , ; :
    ? ! ( )` and forward arrows (`→`, `->`, `⇒`) are read. Any other symbol
    declines (`←`, `⇌`, `≠`, `<`, `/`), and so does a bare `-`: a spaced
    sign ("at - 300 C") or a "none" mark in a table.
  - In notes, a set is under the group of names last written before it,
    a group being names with no line or sentence break and no set between
    them. One name pairs the set outright; a heading line listing several
    binds the set by chemistry among them, which photographed notes need.
    A listing on the set's own line declines, since its order is not read,
    and so do names joined by "and" or "," over fewer sets than names (the
    text gives one set to more than one reaction).
    A set followed in its sentence by a name, linked by any word but "and"
    or "the" ("A + B via ester pyrolysis"), declines; bare juxtaposition is
    the next heading, since notes run a set straight into it.
  - A reaction whose own stated products fail is declined, recorded in
    `source.yieldDemotions`, and never takes another set; the caption and
    titles name only what is drawn. A stated set no declined reaction can
    own (an option list, a contradiction) declines the whole figure, and
    so does a set the text gives another reaction that a drawn class also
    gives, since the drawn panel would answer it. Any
    stated ring size (three to eight, "membered", "centre", "atom") must be
    the drawn ring, and two different sizes decline.
  - Known and left as is: a flattened two column table ("Ester pyrolysis
    Chugaev reaction" over two sets in the other order) binds each set by
    chemistry and draws both right panels, as photographed notes need.
- `figure.ts`: per reaction, the substrate on a regular ring with the curly
  arrows, the transition state with every changing bond dashed, and the
  products. A curly arrow is a `vector` built by `polyline` through sampled
  quadratic Bezier helpers. The compiler holds any curved path to 12 px
  across, so arrows keep a minimum bow.

`buildOrganicScene` reads the mechanism first. A mechanism ask that does not
verify returns null instead of falling through to a product row without
arrows. The ask is read from words: "mechanism" (and its common
misspellings), "curly arrows", "with arrows", "draw the arrows", "electron
movement", "movement of electrons", "transition state", a named
rearrangement after an article or an ask verb ("the Cope rearrangement",
"Explain Claisen rearrangement"), or SN1, SN2, E1 or E2 in any case and
spelling (`S_N2`, `SN-2`, `SN¹`, `sn2`; not `Sn2+`, the tin ion) in a stem
that also says show, draw, write, explain, illustrate, depict, describe,
outline, give, steps or how. A phrasing outside that list still reaches
the product row, so new phrasings go into the gate's lone row list. Naming
SN1 or SN2 alone is not a mechanism ask, and neither is a reactivity
comparison ("more reactive towards SN1", "order of", "arrange"): those keep
their structure rows.
### SN1, SN2 and E2 from the plan's example reactions

A topic ask that names a mechanism and no species ("Teach me SN1 and SN2
reactions ... with examples") has nothing to compute. The planner may name
one example per class in `exampleReactions: [{mechanism, equation}]`
(`contractsV3.ts`, at most two, distinct classes; a malformed entry is
refused, never repaired). `buildPlanExampleDocument` reads them first, so
the #303 recheck, save admission and the teaching hand off
(`source.exampleSpecies`) carry them unchanged.

- `planReaction.ts`: a chemistry question that names no species
  (`questionNamesSpecies` now ignores SN1, SN2, E1 and E2, which the formula
  parser read as sulfur and nitrogen), names one or two of SN1, SN2 and E2,
  and has exactly one example for each named class and none other. The
  question is read closed: every word must be an ask or teaching word that
  puts no condition on the species or outcome; one failing example declines
  the whole figure.
- `substitution.ts`:
  - SN2 on a methyl or primary haloalkane (two arrows, one step) with a bare
    halide or an O⁻ or S⁻ anion that carries only C and H; a branched
    alkoxide only on a methyl carbon, and no hydroxide or alkoxide on a beta
    branched primary carbon (E2 competes).
  - SN1 on a tertiary carbon with no neighbour that could shift onto the
    cation and no stereocentre: ionisation, capture by water or a primary
    alcohol, and proton transfer to a second molecule of the same solvent
    (the halide as the base is uphill and declines, so the equation is
    written with the solvent twice).
  - E2 with hydroxide or an alkoxide where every beta site gives the same
    alkene (three arrows); on a primary halide only a tertiary alkoxide,
    since an unhindered base mostly substitutes there.
  The equation's reactants must be the operator's inputs and its products
  exactly what the arrows give.
- `substitutionFigure.ts`: one row per reaction, each step a reveal group;
  the SN2 transition state dashes exactly the forming and breaking bonds and
  carries δ⁻ on the nucleophile and the leaving group, and the product shows
  inversion. Every panel's label charges add up to the total. Titles and
  caption say "example".
- The teaching prompt names the drawn equations (`planExampleTeachingAddon`),
  so the narration and the work area use the board's examples.
- The plan quantity audit no longer reads a group count written straight
  after a closing bracket (`(CH_3)_3C`) as a measured value (it read three
  coulombs); `x_2m`, `T_300K` and `λ_500 nm` are still read.
- A malformed `exampleReactions` list is dropped, not repaired, and never
  rejects the plan.
- Gate `verify-chemistry-substitution` (in `gates.d` and `verify:chemistry`).

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
| `verify-chemistry-substitution` | scene-engine | SN2, SN1 and E2 operator rules and refusals, the plan example question reader, the figure, a mutant per guard with exact red sets |
| `verify-chemistry-mechanism` | scene-engine | arrow bookkeeping refusals, SN2 and SN1 charges, the cyclic eliminations and their substrate rules, the source binding, guards and demotions, narration, textbook layouts, no lone product row for the listed mechanism asks; a mutant per guard, each turning exactly its own rows red |
| `verify-chemistry-notation` | drawing | the script rewrite, wired into `normalizeStrokeText` |
| `verify-chemistry-lane` | tutor | subject offered, addon keyed off the question, exact planner skipped, figure named to the tutor |

The lecture lab runs a chemistry question the same way as physics:
`pnpm exec tsx scripts/lecture-lab/run.ts --ask questions.txt --max-usd 5 --out .lecture-lab/chem-01`
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
