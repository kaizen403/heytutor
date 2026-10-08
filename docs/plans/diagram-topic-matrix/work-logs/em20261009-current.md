# Current Electricity packet evidence — 9 October 2026

Disposition: partial implementation submitted for integration. **No topic is accepted.** The focused declared-scope gates pass; the explicit full-obligation gate remains red on three data-cardinality obligations. Student runtime, narrated reveal, persistence, and saved replay are unrun. No accepted counters or ledger rows were edited.

## Ownership and frozen scope

- Worker receipt: `/root/current_packet`; requested GPT-6.1 SOL with xhigh reasoning. The runtime exposes no reliable actual model/reasoning receipt, so that selection is not certified here.
- Worktree: `/Users/kaizen/heytutor-cov-wt/em-five-20261007`, branch `cov/em-five-chapters-20261007`, existing dirty checkout based on `834cbd6ad9dea29e5151da6314459be0104b91eb`.
- Contract: `2026-10-02-topic-matrix-v1`, frozen in `.context/em-five-acceptance-20261009-v1/row-obligation-checklist.md`; all 17 exact Current Electricity IDs from agent1/agent2 assignments remain in scope. Potentiometer remains supplemental for all three selected exams, not silently removed.
- Reviewed scope: repository `AGENTS.md`, root coverage plan and universal acceptance contract, topic matrix index, relevant `physics.csv` rows, progress contract, session ownership, frozen Current Electricity checklist rows, original agent1/2 assignments/logs, current modules and dedicated gates.
- TDD seams: public `consumePhysicalModel`, source-bound `validateProblemIR` → `synthesizeFamilyScene`, deterministic solver, and real validator/compiler. Red-before-green receipts were observed for independent bridge arms, signed carriers, piecewise heat, conserved-volume stretching, charging cells, temperature validity range, supplied observations, parallel cells, end corrections, potentiometer loaded/comparison cases, open load, and declared two-loop resistances.

Only these implementation/gate paths were edited:

- `packages/scene-engine/src/physics/em20261007/agent1-admission.ts`
- `packages/scene-engine/src/physics/em20261007/agent1-current-laws.ts`
- `packages/scene-engine/src/physics/em20261007/agent2-dc-networks.ts`
- `packages/scene-engine/scripts/verify/em20261007/verify-agent1.ts`
- `packages/scene-engine/scripts/verify/em20261007/verify-agent2.ts`
- This evidence log.

The integration owner separately supplied shared network MNA support for ideal sources/open branches, and qualitative input-quantity carry-through. This worker did not edit those shared files, other packet files, audio, providers, progress ledgers, or root counters. Changes remain uncommitted.

## Implemented behavior and independent checks

Current laws add `ce.carrier_density`, `ce.joule_piecewise`, `ce.stretched_wire`, `ce.cell_signed`, `ce.temperature_range`, `ce.iv_samples`, `ce.temperature_samples`, and `ce.material_comparison`.

Networks add `dc.wheatstone_declared`, `dc.cells_signed`, `dc.cells_parallel`, `dc.metre_bridge_observed`, `dc.potentiometer_loaded`, `dc.potentiometer_comparison`, `dc.kirchhoff_declared`, and `dc.ohm_open`. Existing `dc.ohm` now accepts signed emf, an ideal source, and an explicitly shorted load; a zero-total-resistance source short rejects. All legacy DC models now have source-role/assumption admissions.

The four-arm bridge does not reuse the balanced-only shortcut. For the worked fixture E=11.8, r=1, P=5, Q=25/6, R=5, S=10, Rg=5, independent node equations give VR=10, VT=5, VB=4 and detector current +0.2 A. Source reversal gives −0.2 A. Holdouts include equal ratios 3/7=6/14 (zero detector), unequal 3/7 versus 6/13 (nonzero detector), and source reversal. The gate independently checks signed KCL at every node and KVL on the non-tree edges of a spanning tree, not the production elimination steps.

Unequal parallel cells E1=10, r1=2, E2=4, r2=1, load=2 give V=4.5, I1=2.75, I2=−0.5: the weak source absorbs power (supplied power −2 W). Source, internal, and load power balance is checked independently. Two ideal parallel sources reject for incompatible voltages or indeterminate current split. Ideal 12 V across 6 Ω gives 2 A; a 12 V source with r=2 and a shorted load gives 6 A; an explicit open gives zero current. Invalid zero-total resistance rejects.

Metre-bridge observed l=25, L=100, equivalent ends cL=cR=5, known left R=2 gives X=16/3 Ω. With sample area 0.03 m² and length 5 m, rho=0.032 Ω m. Swapping the known gap and observed null to l=75 preserves X/rho. Endpoint nulls and invalid dimensions reject.

Potentiometer same-gradient comparison uses separate full null apparatus panels. Loaded observation driver wire voltage=4 V, wire=100 cm, open null=50 cm, loaded null=40 cm, external load=8 Ω gives E=2 V, terminal V=1.6 V, internal r=2 Ω. The apparatus has shared declared terminal references, a split resistive wire at the jockey, detector, source return, and parallel cell load. It is not a bare wire/jockey substitute. Resistor labels use engine layout; arbitrary pinned source labels caused a real rotation collision and were corrected.

Carrier tests cover signed charge, field reversal, area/density changes and a holdout. Piecewise heating integrates signed I²R over three supplied intervals (102 J in the main example). Stretching at conserved volume doubles length, halves area, and quadruples resistance (4→16 Ω). Signed cell tests include charging, open, and short and independently check E I = V I + I²r. Linear R(T) requires a declared reference and range and remains positive over that entire range.

`ce.iv_declared`, `ce.iv_samples`, and `ce.temperature_samples` validate inputs but return **empty scalar/certified records**. Their points are source observations, not fitted or solver-derived results. They create no joining curve, assumed intermediate slope, or device identity. Axis-name anchors hide their point marks so they do not appear as extra observations.

Tests cover ordinary/altered cases, independent equations/literals, composite source/power and instrument calculations, rotation/source-polarity controls, foreign-family refusal, stale values, wrong roles, missing assumptions/bindings, undeclared inputs, invalid/singular cases, and holdouts. An omitted bridge branch rejects atomically with no RenderScene. Generated source fixtures test binding integrity; their role vocabulary is read from the public admission metadata and is not independent evidence of syllabus breadth.

## Commands and actual results

Commands run from `packages/scene-engine`:

| Command | Result |
| --- | --- |
| `EM_CURRENT_RENDER_DIR=<worktree>/.context/em-five-acceptance-20261009-v1/current-frames ./node_modules/.bin/tsx scripts/verify/em20261007/verify-agent1.ts` | PASS: legacy and extension source/solver/numeric/invalid/omitted-evidence/observed-plot/holdout gates; 36 full frames generated. |
| `EM_CURRENT_RENDER_DIR=<same> ./node_modules/.bin/tsx scripts/verify/em20261007/verify-agent2.ts` | PASS: 34 full frames; source admissions, signed KCL/KVL, power, ideal/short/open, bridge controls, orientation, invalid/evidence and holdouts. |
| `./node_modules/.bin/tsx scripts/verify/em20261007/verify-agent1.ts --full-obligations` | FAIL, deliberately retaining the three required-cardinality gaps listed below. This is not a full-row completion receipt. |
| `./node_modules/.bin/tsc --noEmit` | PASS after the final implementation/render correction. |
| `./node_modules/.bin/eslint src/physics/em20261007/agent1-admission.ts src/physics/em20261007/agent1-current-laws.ts src/physics/em20261007/agent2-dc-networks.ts` | PASS before the final axis-anchor hideMark-only correction. |
| `./node_modules/.bin/tsx scripts/verify/em20261007/verify-em-five.ts` | FAIL: aggregate has 108 models versus the old 92-model literal-oracle table and lacks the 16 new current oracles. Concurrent foreign packet failures also appeared (ef.torque/ef.energy undefined helper, changed ef.lines certification, ef.ring/ef.line layout). Those files were not changed by this worker. Integration owner owns aggregate reconciliation. |

No full package build/suite, browser student session, live narration, persistence/save/reopen, or replay was run by this worker. These remain integration obligations.

## Render evidence

Seventy standalone SVG frames, each `width=1200 height=700 viewBox="0 0 1200 700"`, are under `.context/em-five-acceptance-20261009-v1/current-frames/`. Ordinary and altered scenes for every current law/DC model were compiled; the renderer includes full board/zone guides and real directed ink.

Full PNGs rasterized with the checkout's existing sharp package were inspected for `dc.wheatstone_declared-0`, `dc.potentiometer_loaded-0`, `ce.cell_signed-0`, and `ce.iv_samples-0`, in `current-frames/previews/`. Quick Look thumbnails were square/cropped and were not used as full-board evidence. The inspected full PNGs preserve the board and diagram bounds, source/detector polarity, parallel loaded-cell branch, and signed current direction. Axis-name extra dots observed in the plot render were removed using hideMark; SVGs were regenerated afterward. Offline inspection is not Konva/reveal/replay acceptance.

## Exact topic dispositions

All states below are proposals only. Every row still needs the frozen source cohort and shared/live/save/reopen/replay acceptance. Unsupported prior remaining items are preserved explicitly; none are relabelled text-only.

| Exact topic ID | Frozen obligations tested / implementation | Proposed disposition and unresolved items |
| --- | --- | --- |
| physics\|12\|current-drift-velocity-and-mobility | Electron versus conventional current, positive carriers, signed q/vd, density/area changes: ce.drift + ce.carrier_density. | verification_pending. Nonuniform density, alternating drift, collision pictures remain unsupported; no claim those are covered by scalar uniform transport. |
| physics\|12\|mobility-and-current-density | vd=sign(q)muE, J=nqvd, I=JA and sign controls: ce.carrier_density; legacy current/area magnitudes retained. | verification_pending. Anisotropic conductivity and Hall mobility remain unsupported. |
| physics\|12\|ohms-law-and-resistance | Distinct load terminals and signed drops; ideal source, R=0 wire, explicit open, singular rejection: dc.ohm + dc.ohm_open. | verification_pending. Bare source/geometry authority still needs shared live integration. |
| physics\|12\|iv-characteristics | Ohmic slope V/I; non-ohmic source points with arbitrary coordinates/signs; no interpolation/certified fit: ce.iv_ohmic, ce.iv_declared, ce.iv_samples. | **integration_pending / full gate red** for observation cardinality beyond three. Named device identity is not inferred. |
| physics\|12\|electrical-energy-and-power | P=VI and multiple dissipating branches; signed supplying/charging sources, total source/internal/load balance: ce.power + dc.cells_signed/parallel. | verification_pending. AC/time-varying loads remain outside these steady models and are not claimed. |
| physics\|12\|joules-law-of-heating | Constant and piecewise signed-current intervals; independent I²R dt sum and source duration: ce.joule + ce.joule_piecewise. | **integration_pending / full gate red** for interval cardinality beyond three. Fuse ratings remain uninferred. |
| physics\|12\|resistivity-and-conductivity | Same explicit geometry/different rho and sigma=1/rho in SI: ce.resistivity + ce.material_comparison. | verification_pending. Tensor conductivity and measured rho(T) constitutive law remain unsupported; no text-only credit claimed. |
| physics\|12\|resistance-from-dimensions | rhoL/A and conserved-volume stretch factor with independent L/A/R outputs: ce.resistance + ce.stretched_wire. | verification_pending. Nonuniform/tapered conductors require a resistance integral; combined thermal/geometry laws remain separate source obligations. |
| physics\|12\|resistor-combinations | Series/parallel connections, independent reductions/KCL/KVL and zero-current open; bridge zero controls and disconnected crossings use named nodes. | verification_pending. Arbitrary branch cardinality and arbitrary netlist admission beyond declared graph models remain unproved. |
| physics\|12\|mixed-resistor-networks | Nested series-parallel dc.mixed plus irreducible four-arm bridge; independent node/cycle equations and omitted-branch rejection. | verification_pending. An arbitrary unlabeled mesh is not inferred; generic source-bound netlist cardinality is not proved. |
| physics\|12\|temperature-dependence-of-resistance | Source reference/range/alpha, positivity throughout range; independent supplied nonlinear points: ce.temperature_range + ce.temperature_samples. | **integration_pending / full gate red** for nonlinear observation cardinality beyond three. No semiconductor exponential law/fitted extrapolation claimed. |
| physics\|12\|cell-emf-potential-difference-and-internal-resistance | Signed V=E−Ir, discharge/charge/open/short; emf/terminal/internal power balance: ce.cell_signed. | verification_pending. Electrochemical transients are unsupported; ideal zero-total-resistance short rejects. |
| physics\|12\|cell-combinations | Aiding/opposing signed unequal series/parallel cells, internal resistances, branch currents and power; inconsistent/ambiguous ideal parallel controls. | verification_pending. Full source/lifecycle acceptance remains; no invented ideal-source current split. |
| physics\|12\|kirchhoffs-laws | Two independent loops, source polarity, arbitrary positive supplied branch resistances, node/cycle residuals and omitted evidence: dc.kirchhoff_declared. | verification_pending. Dependent sources and non-ohmic branches need their own laws. |
| physics\|12\|wheatstone-and-metre-bridge | Balanced/unbalanced four independent arms, detector resistance/current, polarity and ratio/source reversal holdouts: dc.wheatstone_declared. | verification_pending. Nonlinear detector law/dependent sources remain unsupported. No balanced-only completion claim. |
| physics\|12\|metre-bridge | Observed interior null, known/unknown resistance, both gap placements, declared equivalent end corrections, SI resistivity dimensions. | verification_pending. Nonuniform wire needs an integral; unspecified contact corrections are not assumed zero. |
| physics\|12\|potentiometer | Full null apparatus, same-gradient EMF comparison, separately observed open/loaded cell and internal r. | verification_pending. Supplemental scope remains explicit. Driver calibration/internal resistance and drift are not inferred from its supplied wire voltage. |

## Exact full-obligation failures and smallest shared sequence contract

The dedicated full gate reports exactly:

1. `joules-law-of-heating: arbitrary declared interval cardinality beyond three`
2. `iv-characteristics: arbitrary supplied observation cardinality beyond three`
3. `temperature-dependence-of-resistance: arbitrary nonlinear measured observation cardinality beyond three`

Concrete red cases retain the existing three input pairs and add `I4=1,t4=2`, `i3=4,v3=16`, or `T3=80,R3=30`, respectively. They are valid additional source data, rejected by the current static input/role map. They remain coverage gaps, not source exclusions or text-only successes.

Proposed integration contract shape: a **source-bound bounded sequence**, not an English router or topic registry. Keep a finite numeric record and the existing 32-input maximum. Declare sequence count in a source binding (unit `1`); derive expected indexed keys from that validated count (e.g. R plus N current/duration pairs; N current/voltage pairs; N temperature/resistance pairs). Every indexed value retains its own role, SI unit, expressionId and evidenceFactId. Reject missing, duplicate, noncontiguous or surplus indexes, count outside the bound, nonfinite values and reordered independent coordinates. Do not pad unused entries with invented zero facts.

The smallest shared admission extension is a typed way to derive the exact role map from a **source-grounded count**, before enforcing all bindings: `rolesForCount(count): Record<string, InputRole>` alongside the fixed roles. This must be used consistently by ProblemIR validation, `groundExplicitModel`, solver and consumer. The packet scalar/builder can then iterate the exact same declared sequence. Heating returns the derived integral/duration; observational plots return `{}` and carry input quantities/points only. Tests must bind the count and each element, mutate/omit them independently, and run holdouts at another cardinality. Merely allowing unknown keys would weaken source authority and is not proposed.

Other integration actions: extend `verify-em-five.ts` with independent literal oracles for the 16 new models, preserving empty qualitative certification; run package build/type/lint, aggregate/frozen source cohort and browser/lifecycle gates. No worker acceptance, publication, or commit is implied by this handoff.
