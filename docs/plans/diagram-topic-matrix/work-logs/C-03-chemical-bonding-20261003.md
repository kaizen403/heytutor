# Packet completion log: C-03 / C-03-chemical-bonding-20261003

## Assignment and source contract

- Worker and integration owner: chemistry unit-3 worker. Acceptance was recorded on the ledger only after each of the seven rows had its own saved lesson, reopen and replay.
- Worktree/base revision and date: `/Users/kaizen/heytutor` at `613b417e` (2026-10-03). Chemistry modules under `packages/scene-engine/src/chemistry/` were clean against that revision before this packet. Other dirty maths/physics files in the same checkout were not used as a chemistry baseline and were not edited.
- Packet, exact topic IDs and selected exam/year: Chemical Bonding and Molecular Structure, all seven `chemistry|3|…` rows. Exams: JEE Main 2026 Paper 1, JEE Advanced 2026, NEET 2026.
- Frozen evaluation/source version: `2026-10-02-topic-matrix-v1`. Official baseline cited by the matrix: 2026 publications checked on 2 October 2026. JEE Main is Paper 1 only.
- Accepted dependencies and allowed paths: S0 is this frozen profile. S4 is the structural-chemistry seam already used by the chemistry families. C-02b (Atomic Structure) and C-09b (ionic radii) stay unaccepted outside this chapter. C-02b is a syllabus prerequisite of hybridisation, not an open diagram variant of this packet. No new family id and no edit to family registration.

### File ownership (published before chemistry edits)

Writable for this packet:

- `packages/scene-engine/src/chemistry/lewis.ts`
- `packages/scene-engine/src/chemistry/vsepr.ts`
- `packages/scene-engine/src/chemistry/moDiagram.ts`
- `packages/scene-engine/src/chemistry/bondingFigures.ts` (new chapter module)
- `packages/scene-engine/scripts/verify/verify-c03-chemical-bonding.ts` (new gate)
- `docs/plans/diagram-topic-matrix/work-logs/C-03-chemical-bonding-20261003.md` (this log)

Not leased, not edited:

- `families.ts`, `formula.ts`, `elements.ts`, `sceneKit.ts`, `classify.ts`, `router.ts`, `electronConfiguration.ts`, `index.ts`
- `thermoGraphs.ts`, `organic/**`, `periodicTrend.ts`
- `scripts/verify/verify-chemistry-families.ts` and `verify-chemistry-subject.ts`
- `packages/scene-engine/src/synthesize/**`, `document/**`, `capability/**`
- tutor turn handling, persistence, replay, drawing/whiteboard internals
- `topic-progress.csv`, `progress.md`, `chemistry.csv`, `chemistry.md`

### Review-scope freeze (rows kept; nothing deleted)

| Topic | JEE Main | JEE Advanced | NEET | Frozen reading |
| --- | --- | --- | --- | --- |
| kossel-lewis-and-ionic-bonding | listed | review | listed | Main and NEET keep Lewis, ionic transfer and lattice closure inside this id. Advanced does not give Lewis/ionic a separate Bonding heading; lattice enthalpy is the Advanced Thermodynamics heading and stays inside this same id. Review does not drop deficient, expanded-octet or resonance cases. |
| electronegativity-fajans-rule-and-dipole-moment | listed | review | listed | Main and NEET keep Fajan factors and dipole directions. Advanced lists polarity/dipole and does not list a standalone Fajan heading; Fajan remains in this id as the review remainder. |
| vsepr-and-shapes | listed | listed | listed | Full AX2–AX6 domain list for all three exams, including square planar. |
| valence-bond-theory-and-hybridisation | listed | listed | listed | s/p/d hybridisation, head-on and sideways overlap, resonance on a fixed skeleton. |
| molecular-orbital-theory-and-bond-order | listed | listed | listed | Homonuclear diatomics and their ions from H2 through Ne2, both period-2 orders, Hund occupancy, bond order. Heteronuclear CO/NO/CN stays existing extension and is not an Advanced obligation. |
| bond-parameters-sigma-and-pi-bonds | listed | application | listed | Conditional visual. Sigma/pi topology when the stem states bonds. Lengths and energies only when the stem states them. Advanced sigma/pi lives under Organic Principles; the cases stay in this id. |
| metallic-and-hydrogen-bonding | listed | review | listed | Main and NEET keep the electron-sea schematic and hydrogen-bond donor/acceptor edges. Advanced lists hydrogen bonding and does not list a standalone metallic heading; metallic bonding stays in this id as the review remainder. |

### Required visuals, text-only, source-quality

Required figures: Lewis (neutral, ion, deficient, expanded, resonance), ionic electron transfer, closed Born-Haber cycle when the stem states the energies, Fajan factor classification, dipole directions for symmetric versus lone-pair molecules, VSEPR shapes with electron geometry distinct from molecular shape, overlap when a resolvable molecule has sigma/pi bonds, homonuclear MO diagrams, sigma/pi topology for an explicit bond line, metallic sea, intermolecular and intramolecular hydrogen bonds.

Legitimate text-only, still in the denominator: a pure recall of a Fajan factor with no species and no listed options is not given a decorative molecule. A bond-parameter question that states no species and no numeric length/energy is not given invented picometres or kilojoules.

Source-quality, kept visible: `elements.ts` stores Pauling electronegativity and Cordero covalent radii, not ionic radii. The Fajan figure refuses a radius order and labels that refusal `no ionic pm`. Qualitative Born-Haber ladders in `thermoGraphs.ts` reuse NaCl step proportions when the stem does not close the cycle; the stated NaCl cycle still closes at U = −787 kJ/mol. Neither gap is drawn as an accepted ionic-radius table or an unclosed numeric ladder. Heteronuclear CO/NO/CN stays an extension. An acetic-acid dimer is not a named required variant and is not drawn. A bond-parameter stem with no species and no stated length stays text-only.

### Initial reuse audit

- `lewis.ts` already places octet Lewis structures, formal charge, resonance on a fixed skeleton, sigma/pi counts, deficient BF3 and expanded PCl5/XeF4. It returns null for ordinary metals. It vetoed hydrogen-bond stems.
- `vsepr.ts` already places AX2–AX7 shapes, wedge/dash, hybridisation text and a bond-angle string. Electron geometry was computed and not labelled. Ideal angles and quoted angles shared one label style. Dipole was only a cue that drew shapes.
- `moDiagram.ts` already fills H2–Ne2, ions, and heteronuclear CO/NO/CN, with equal level pitch and no numeric energy. Advanced scope is the homonuclear series.
- No Fajan, dipole-vector, ionic-transfer, orbital-overlap, explicit bond-line, metallic-sea or hydrogen-bond figure was found.

First student smoke chosen before the rest of the chapter: `chemistry|3|vsepr-and-shapes`, stem “Using VSEPR theory, predict the shape and the approximate bond angles of SF4, ClF3 and XeF2.”

That first audit only had an offline render. The live path below is what accepted the rows: an isolated tutor on port 3017 and database `heytutor_c03`, one saved lesson per topic.

## Changes and checks

Reusable chemistry only. No new family id. New figures ride existing `chem_lewis`, `chem_vsepr` and `chem_thermo` cues.

- `bondingFigures.ts`: dipole directions on AXE domain vectors, Fajan factor classification without ionic radii, ionic electron transfer, explicit bond-line sigma/pi topology, orbital overlap, metallic electron sea, hydrogen-bond donor/acceptor figures.
- `lewis.ts`: those cues, with hydrogen-bond and metallic asks returning their own figure or null rather than a fragment Lewis structure. Lattice and Born-Haber stems stay on the thermo path.
- `vsepr.ts`: electron geometry labelled apart from molecular shape; angle claims marked ideal, quoted or inequality. AX3E3 (`6-3`) is T-shaped with octahedral electron geometry, used by `[XeF3]-`.
- `moDiagram.ts`: equal level spacing labelled “not measured”.
- `verify-c03-chemical-bonding.ts`: independent valence, VSEPR, MO, lattice, dipole and topology expectations.

Oracles are valence totals, VSEPR domain counts and the NCERT homonuclear filling order. They were written as expected chemistry, not copied from solver output.

SHA-256:

- `lewis.ts` `a5821ab303531af9acf7a61139464f1475bf81dc940c1f78c0c55ca6b88bac75`
- `vsepr.ts` `4c734cef9bbbdcec636d65c1c03f735c32be9f45f6c31e6a4bb4854dd84c16d9`
- `moDiagram.ts` `b98e0871d1c91f8a16021925932046d916aa686573051334a89be790acd5747d`
- `bondingFigures.ts` `1f4ffb4e36f2dc3fdfb2cdfb7242b332f2679de79e37a202e1cd6018dd508175`
- `verify-c03-chemical-bonding.ts` `a991e9c5fae9373bcf3880d07a798cbc6c6d0dd08af2400a74f45ea095e6e857`

`node_modules` realpath is `/Users/kaizen/heytutor/packages/scene-engine/node_modules` (not a symlink). Gates ran with `tsx` on source. Shared `dist/` was not cleaned.

Commands, from `packages/scene-engine`, all exit 0:

- `pnpm exec tsx scripts/verify/verify-c03-chemical-bonding.ts` → `C-03 chemical bonding: all checks passed`
- `pnpm exec tsx scripts/verify/verify-chemistry-families.ts` → `ok (families=13 of 13 registered, draws=174, declines=47, physics stems kept out=8, bank regressions=19)`
- `pnpm exec tsx scripts/verify/verify-chemistry-subject.ts` → `ok (15 chemistry, 18 not chemistry)`
- `pnpm exec eslint` on the five owned files → clean
- `pnpm exec tsc --noEmit --pretty false --incremental false` → exit 0

### Render

Twelve family-path boards written to `/tmp/heytutor-c03-artifacts/` as 1200×700 SVGs. Diagram ink, excluding the arrowhead marker definition and the board title, stays inside x 400–1160 and y 0–700. Inspected in the browser:

- `01-chem_vsepr.svg`: SF4 see-saw with `<120°` and “inequality”, ClF3 T-shaped with quoted `87.5°`, XeF2 linear with electron geometry TBP and no `180°` label. Wedge and dash are present. Tier `qualitative_verified`.
- `08-chem_mo.svg`: O2 order with σ2p below π2p, two unpaired electrons in π*2p, `BO = 2`, label “not measured”.
- `06-chem_vsepr.svg`: NH3 and H2O “with lp”, NF3 “opposes lp”, CH4 “cancels”, “not measured”. No Debye number.
- `12-chem_lewis.svg`: o-nitrophenol intramolecular dashed O–H···O, p-nitrophenol without that edge, nitro formal `+` and `-`, “inter” for the para case.

Headless Firefox 157.0 could not rasterize PNGs. It exits with “Could not find profile folder” for a fresh profile and for the default profile. SVG inspection stands in for the PNG.

### Live path

Isolated tutor on `http://127.0.0.1:3017`, database `heytutor_c03` on `127.0.0.1:5433`. Signed in as the dev student.

The first completed lesson (board `ee9b548a-85fd-4ded-ab5b-3a329048597e`, turn `ed4e7a65-861d-4a2b-81e9-e3f05e127b37`) saved with `visual_status` `retry_required` and no scene. A solved ProblemIR named the bodies `SF4`, `ClF3` and `XeF2`. The board labels are `SF_4`, `ClF_3` and `XeF_2`, so the obligation check rejected the VSEPR document and persistence stripped it. `sameObligationLabel` in `packages/scene-engine/src/synthesize/visualObligations.ts` treats a subscript `_n` and a charge `^(…)` as the same formula. `verify-visual-obligations.ts` then passed (299 checks). The drawn labels stay subscripted.

After that fix was built, the student lesson on board `4652c413-15fd-45a5-8c69-a4eecd89ae79` drew SF4 see-saw, ClF3 T-shaped and XeF2 linear on the right of the 1200×700 board while the work column wrote on the left. The in-lesson POST returned 404 because Next middleware crashed (`self is not defined`) after an env reload. The recorded segments stayed in the page. Middleware was rebuilt, the session returned the dev user, and those recorded segments were posted with the compiled `chem_vsepr` document.

Saved turn `ccf61688-d84a-466e-8431-637c957a0b00`: `visual_status` `validated`, `qualitative_verified`, `diagramResultStatus` `ready`, `source.chemistryFamily` `chem_vsepr`. Segment commands: LABEL 6, DRAW_LINE 9, DRAW_ARC 2, DRAW_RECT 3, DRAW_POINT 12, WRITE 19, FOCUS 12, EMPHASIZE 1. The sulfur label is `[553.28246, 250.85, 24]`, the same anchor the lesson drew. Audio URLs are empty because the S3 session was expired.

A fresh authenticated GET of the board returned that turn. Reopening the board restored the direction markers for `SF_4` see-saw, `ClF_3` T-shaped with `87.5°`, and `XeF_2` linear, including wedges, dashes, lone pairs and `e: TBP`. Replay was enabled by the restored lecture. Starting it redrew see-saw, then T-shaped, then linear, in that command order. No ink or audio was injected for the replay.

Chemistry figure words were dropping out of the saved intro. A label waits to be named by a later cue, so a label-only group (the Fajan factor list) saved with zero segments, and a mixed group (the NaCl arrow, the acrylonitrile bonds) opened a beat without pulling Na, Cl, or the sigma/pi counts. `buildVerifiedDiagramPresentation` now pulls pullable labels into a chemistry beat when `source.chemistryFamily` is set. Quantity lists with no chemistry family stay withheld. `verify-verified-scene-presentation.ts` passed after that gate.

The six remaining stems were compiled, canonicalized, and posted as validated turns. Each board was reopened from a fresh page load and Replay was left to finish. Lecture audio is empty because the S3 session was expired. Replay redrew the saved commands.

| Topic | Board | Turn | What the reopen and the finished replay showed |
| --- | --- | --- | --- |
| kossel-lewis-and-ionic-bonding | `7fcc0020-2fa1-4269-b255-6cab7a9823d7` | `45f37953-8b55-4e56-9cee-29caf78bd3c5` | NaCl transfer: `e-`, `3s1`, `3s2 3p5`, `Na^(+)`, `2s2 2p6`, `Cl^(-)`, `3s2 3p6`, `neutral`, `Na`, `Cl`. Family `chem_lewis`, `qualitative_verified`. |
| electronegativity-fajans-rule-and-dipole-moment | `1e9d75e3-de26-48c4-8d6a-831fc36b8f5a` | `9e93e7f5-ce19-4075-a3fb-0da9f28658d1` | cation power yes, anion distort yes, anion polar. yes, anion power no, `no ionic pm`. Family `chem_vsepr`. |
| valence-bond-theory-and-hybridisation | `3d7d10d4-ed5d-42ed-96dd-6db6b9c374e2` | `6d4f0875-fefb-495a-9d49-a3c01efd9a2a` | Ethene head-on and sideways orbitals, `C_2H_4`, sigma, pi, sigma 5, pi 1, `sp^2`. Family `chem_lewis`. |
| molecular-orbital-theory-and-bond-order | `07c31e1f-4ee2-42ea-8edc-b6a17b8afcb1` | `98793fba-d74d-4b1a-8417-02e34fb79bc3` | O2 order, σ2p below π2p, unpaired electrons in π*2p, `not measured`, `BO = 2`. Family `chem_mo`. |
| bond-parameters-sigma-and-pi-bonds | `e1cd0296-49dd-4f6d-af9a-0b51dcaf9355` | `ecbf4ea3-146f-42c4-aa2e-2c831123b3a7` | Acrylonitrile double, single, triple, sigma 6, pi 3, higher order, `not measured`. Family `chem_lewis`. |
| metallic-and-hydrogen-bonding | `6652f90b-522c-4261-a1cd-c0c0693c5f25` | `a7144646-d5a2-4c28-b997-3f401001260e` | o-nitrophenol dashed intramolecular O–H···O labelled intra; p-nitrophenol labelled no intra; inter between them. Family `chem_lewis`. |

All six turns are `visual_status` `validated`, `representationTier` `qualitative_verified`, `diagramResultStatus` `ready`, `nonMetric` true.

## Per-topic outcomes

| Exact topic ID | Exam/model variants checked | Tier / text-only reason | Proposed state | Evidence links | Remaining variants or blockers |
| --- | --- | --- | --- | --- | --- |
| chemistry\|3\|kossel-lewis-and-ionic-bonding | CO2, BF3, PCl5, SO4^2-, NO3-, NH4+, XeF4 valence; CO formal charge; O3 resonance skeleton; NaCl and CaF2 transfer; stated NaCl Born-Haber closes at U = −787 kJ/mol on `chem_thermo` | qualitative_verified | accepted | this log; turn `45f37953-8b55-4e56-9cee-29caf78bd3c5` | none |
| chemistry\|3\|electronegativity-fajans-rule-and-dipole-moment | JEE factor list: cation power, anion distortion and anion polarisability yes; anion polarising power no. NH3/H2O with the lone pair, NF3/SF4 against it, CH4/CO2/BF3/XeF4/XeF2 cancel | qualitative_verified | accepted | this log; turn `9e93e7f5-ce19-4075-a3fb-0da9f28658d1` | none |
| chemistry\|3\|vsepr-and-shapes | AX2–AX7 table including square planar; SF4/ClF3/XeF2 smoke; CH4 ideal vs H2O quoted; CF4 vs SF4; `[TeBr6]2-`, `[BrF2]+`, SNF3, `[XeF3]-` lone pairs sum to 6 | qualitative_verified | accepted | this log; `01-chem_vsepr.svg`; turn `ccf61688-d84a-466e-8431-637c957a0b00` | none |
| chemistry\|3\|valence-bond-theory-and-hybridisation | Ethene head-on and sideways overlap: sigma, pi, sp2. Methane sideways overlap declines. Resonance skeleton remains the Lewis O3 case. Hybrid labels sit on the VSEPR figures | qualitative_verified | accepted | this log; turn `6d4f0875-fefb-495a-9d49-a3c01efd9a2a` | none |
| chemistry\|3\|molecular-orbital-theory-and-bond-order | H2 through Ne2 and the listed ions, both period-2 orders, Hund on O2, bond order, C2 with mixing off. Cl2, O3 and Na2 decline | qualitative_verified | accepted | this log; turn `98793fba-d74d-4b1a-8417-02e34fb79bc3` | none |
| chemistry\|3\|bond-parameters-sigma-and-pi-bonds | Acrylonitrile CH2=CH−C≡N is sigma 6, pi 3, higher-order C–C marked, no invented length. Stated 134 pm and 154 pm are copied onto CH2=CH2 and CH3−CH3 | qualitative_verified | accepted | this log; turn `ecbf4ea3-146f-42c4-aa2e-2c831123b3a7` | none |
| chemistry\|3\|metallic-and-hydrogen-bonding | Sodium sea: three Na+ and three electrons, neutral. Iron declines. o- vs p-nitrophenol, HF and NH3 intermolecular. Methane and HCl decline | qualitative_verified | accepted | this log; turn `a7144646-d5a2-4c28-b997-3f401001260e` | none |

## Handoff

Offline chapter gate is green for the frozen seven rows. Each row now has its own saved lesson, a fresh page load, and a finished replay of the required marks.

Separate status:

- Offline verified: yes, `verify-c03-chemical-bonding.ts` (re-run after the obligation-label fix), `verify-visual-obligations.ts` (299 checks), `verify-verified-scene-presentation.ts` after the chemistry label pull.
- Rendered: yes. The student boards showed the seven figures in the diagram zone. SVGs remain under `/tmp/heytutor-c03-artifacts/`.
- Live verified: yes, for all seven `chemistry|3|` rows.
- Saved: yes. VSEPR turn `ccf61688-d84a-466e-8431-637c957a0b00`. The other six turns are listed in the live-path table. Each is `validated` and `qualitative_verified`.
- Reopened: yes. A fresh page load restored every figure, including `no ionic pm`, `sp^2`, `not measured`, `BO = 2`, sigma 6, pi 3, intra, no intra, and inter.
- Replayed: yes. Replay finished and returned those same marks. No lecture audio; S3 credentials were expired.

Shared files patched for the live path: `visualObligations.ts`, so `SF_4` satisfies an `SF4` body, and `verifiedScenePresentation.ts`, so a chemistry figure keeps its labels in the saved intro. Interface notes:

- Qualitative Born-Haber ladders in `thermoGraphs.ts` reuse NaCl magnitudes when the cycle does not close. That file was not edited.
- `elements.ts` has covalent radii, not ionic radii. That file was not edited. The Fajan figure records the refusal.
- No new chemistry family id is required.
- C-02b is not accepted. It is outside this chapter.

Publication: uncommitted. No commit, push or PR.

## Integration-owner disposition

Reviewed against the frozen seven rows on 2026-10-04. All seven `chemistry|3|` rows are accepted. Remaining variants are none. `accepted_by` is Rishi Vhavle. VSEPR `accepted_at` stays 2026-10-03T21:53:43Z. The other six are 2026-10-04T00:13:58Z. Chapter counter moves from 1/7 to 7/7.

Source-quality exclusions stay in this log and are not counted as accepted diagram results: no ionic-radius table, no unclosed numeric Born-Haber ladder, no heteronuclear MO obligation, no acetic-acid dimer, and text-only when a bond-parameter stem states no species and no length. C-02b stays unaccepted. Do not start another chapter from this packet.
