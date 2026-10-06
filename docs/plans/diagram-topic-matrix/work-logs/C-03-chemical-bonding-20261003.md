# Packet completion log: C-03 / C-03-chemical-bonding-20261003

## Assignment and source contract

- Worker and integration owner: chemistry unit-3 worker; integration owner records `accepted_by` / `accepted_at` and chapter counters. This log does not update `topic-progress.csv` or `progress.md`.
- Worktree/base revision and date: `/Users/kaizen/heytutor` at `613b417e` (2026-10-03). Chemistry modules under `packages/scene-engine/src/chemistry/` were clean against that revision before this packet. Other dirty maths/physics files in the same checkout were not used as a chemistry baseline and were not edited.
- Packet, exact topic IDs and selected exam/year: Chemical Bonding and Molecular Structure, all seven `chemistry|3|…` rows. Exams: JEE Main 2026 Paper 1, JEE Advanced 2026, NEET 2026.
- Frozen evaluation/source version: `2026-10-02-topic-matrix-v1`. Official baseline cited by the matrix: 2026 publications checked on 2 October 2026. JEE Main is Paper 1 only.
- Accepted dependencies and allowed paths: S0 is this frozen profile. S4 is the structural-chemistry seam already used by the chemistry families. C-02b, C-03a, C-03c and C-09b are not accepted chapters; they are reused only where a function already exists, and gaps stay listed below. No new family id and no edit to family registration.

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

Source-quality, kept visible: `elements.ts` stores Pauling electronegativity and Cordero covalent radii, not ionic radii. Fajan radius order is not certified from that table. Qualitative Born-Haber ladders in `thermoGraphs.ts` reuse NaCl step proportions when the stem does not close the cycle; stated-data closure is the checked subcase. Those two gaps are unresolved dependencies, not accepted variants.

### Initial reuse audit

- `lewis.ts` already places octet Lewis structures, formal charge, resonance on a fixed skeleton, sigma/pi counts, deficient BF3 and expanded PCl5/XeF4. It returns null for ordinary metals. It vetoed hydrogen-bond stems.
- `vsepr.ts` already places AX2–AX7 shapes, wedge/dash, hybridisation text and a bond-angle string. Electron geometry was computed and not labelled. Ideal angles and quoted angles shared one label style. Dipole was only a cue that drew shapes.
- `moDiagram.ts` already fills H2–Ne2, ions, and heteronuclear CO/NO/CN, with equal level pitch and no numeric energy. Advanced scope is the homonuclear series.
- No Fajan, dipole-vector, ionic-transfer, orbital-overlap, explicit bond-line, metallic-sea or hydrogen-bond figure was found.

First student smoke chosen before the rest of the chapter: `chemistry|3|vsepr-and-shapes`, stem “Using VSEPR theory, predict the shape and the approximate bond angles of SF4, ClF3 and XeF2.”

Bounded estimate from this audit: offline board render of that stem in this working session. Live save/reopen/replay stays `verification_pending` unless an isolated tutor port and database are free; that blocker does not count as chapter acceptance.

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

`verification_pending`. Port 3000 was free. `DATABASE_URL` in `apps/tutor/.env.local` points at `localhost:5433`, and nothing was listening there. No isolated database was leased, so the tutor was not started and the shared database was not created. Authenticated save, reopen, GET and replay were not run.

## Per-topic outcomes

| Exact topic ID | Exam/model variants checked | Tier / text-only reason | Proposed state | Evidence links | Remaining variants or blockers |
| --- | --- | --- | --- | --- | --- |
| chemistry\|3\|kossel-lewis-and-ionic-bonding | CO2, BF3, PCl5, SO4^2-, NO3-, NH4+, XeF4 valence; CO formal charge; O3 resonance skeleton; NaCl and CaF2 transfer; stated NaCl Born-Haber closes at U = −787 kJ/mol on `chem_thermo` | qualitative structures; lattice number only when the stated cycle closes | integration_pending; live verification_pending | this log; `/tmp/heytutor-c03-artifacts/02-chem_lewis.svg`, `03-chem_lewis.svg`, `04-chem_thermo.svg` | Unclosed qualitative Born-Haber ladders in `thermoGraphs.ts` still reuse NaCl step sizes. That file was not leased. |
| chemistry\|3\|electronegativity-fajans-rule-and-dipole-moment | JEE factor list: cation power, anion distortion and anion polarisability yes; anion polarising power no. NH3/H2O with the lone pair, NF3/SF4 against it, CH4/CO2/BF3/XeF4/XeF2 cancel | qualitative directions; arrow length is not Debye | integration_pending; live verification_pending | this log; `05-chem_vsepr.svg`, `06-chem_vsepr.svg` | Ionic radii are not in `elements.ts`. Fajan radius order is not certified. Depends on C-09b. |
| chemistry\|3\|vsepr-and-shapes | AX2–AX7 table including square planar; SF4/ClF3/XeF2 smoke; CH4 ideal vs H2O quoted; CF4 vs SF4; `[TeBr6]2-`, `[BrF2]+`, SNF3, `[XeF3]-` lone pairs sum to 6 | qualitative_verified | integration_pending; live verification_pending | this log; `01-chem_vsepr.svg` | Live save/reopen/replay. |
| chemistry\|3\|valence-bond-theory-and-hybridisation | Ethene head-on and sideways overlap: sigma, pi, sp2. Methane sideways overlap declines. Resonance skeleton remains the Lewis O3 case. Hybrid labels sit on the VSEPR figures | qualitative overlap | integration_pending; live verification_pending | this log; `07-chem_lewis.svg` | C-03a and C-02b are not accepted chapters. |
| chemistry\|3\|molecular-orbital-theory-and-bond-order | H2 through Ne2 and the listed ions, both period-2 orders, Hund on O2, bond order, C2 with mixing off. Cl2, O3 and Na2 decline | qualitative_verified levels | integration_pending; live verification_pending | this log; `08-chem_mo.svg` | Heteronuclear CO/NO/CN remains an existing extension, not the Advanced homonuclear obligation. |
| chemistry\|3\|bond-parameters-sigma-and-pi-bonds | Acrylonitrile CH2=CH−C≡N is sigma 6, pi 3, higher-order C–C marked, no invented length. Stated 134 pm and 154 pm are copied onto CH2=CH2 and CH3−CH3 | conditional; stated numbers are quotes | integration_pending; live verification_pending | this log; `09-chem_lewis.svg`, `10-chem_lewis.svg` | A stem with no species and no stated length stays without a figure. |
| chemistry\|3\|metallic-and-hydrogen-bonding | Sodium sea: three Na+ and three electrons, neutral. Iron declines. o- vs p-nitrophenol, HF and NH3 intermolecular. Methane and HCl decline | qualitative | integration_pending; live verification_pending | this log; `11-chem_lewis.svg`, `12-chem_lewis.svg` | Acetic acid dimer is not drawn. An unnamed “metallic bonding” stem with no metal declines rather than inventing sodium. |

## Handoff

Offline chapter gate is green for the frozen seven rows. The first student smoke, the SF4 / ClF3 / XeF2 VSEPR stem, is rendered and zone-checked. The chapter is not accepted.

Separate status:

- Offline verified: yes, `verify-c03-chemical-bonding.ts`, chemistry family gate, chemistry subject gate, eslint, `tsc --noEmit`.
- Rendered: yes, 1200×700 SVGs, diagram ink in x 400–1160. Browser inspection of the smoke, O2, dipole and nitrophenol boards. PNG rasterize blocked by Firefox 157.
- Live verified: no.
- Saved: no.
- Reopened: no.
- Replayed: no.

Integration owner action: do not set `accepted_by`, `accepted_at`, or the chapter counter from this log. An independent chemistry review of the frozen rows is still required before acceptance. Shared files were not patched. Interface notes, if a later lease is opened:

- Qualitative Born-Haber ladders in `thermoGraphs.ts` reuse NaCl magnitudes when the cycle does not close.
- `elements.ts` has covalent radii, not ionic radii.
- No new chemistry family id is required.

Next work is live verification on a leased port and an isolated database once Postgres is up. Do not start another chapter from this packet.

Publication: uncommitted. No commit, push or PR.

## Integration-owner disposition

Not reviewed. `accepted_by` and `accepted_at` stay empty. Chapter counter stays 0/7.
