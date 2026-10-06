# Packet completion log: C-04 / chemical-thermodynamics-20261005

## Assignment and source contract

- Worker: chemistry lane in this session. No separate human reviewer signed this packet. Do not read `accepted_by` as Rishi Vhavle.
- Worktree: `/Users/kaizen/heytutor`. Atomic Structure stays 6/6 and Chemical Bonding stays 7/7. `/Users/kaizen/heytutor-claude-coord` was not edited. No commit, push, or merge.
- Packet: C-04a and C-04b. All six `chemistry|4` rows.
- Frozen profile: `2026-10-02-topic-matrix-v1`; JEE Main 2026 Paper 1; JEE Advanced 2026; NEET 2026.
- Owned files: `packages/scene-engine/src/chemistry/chemicalThermodynamics.ts` (new), `packages/scene-engine/src/chemistry/thermoGraphs.ts`, `packages/scene-engine/scripts/verify/verify-c04-chemical-thermodynamics.ts` (new). The bounded Atomic Structure review also touched `hydrogenicRadial.ts` and `verify-c02-atomic-structure.ts`. No shared physics solver, compiler, IR, persistence, replay, or presentation seam was edited.
- Subagents were available. The thermo figures share one module, so this session wrote that module directly instead of splitting it across workers.

## Changes and checks

New stems enter the existing `chem_thermo` family. `claimsChemicalThermodynamics` runs before the older profile, Gibbs, Born–Haber, Ellingham, and Maxwell classifiers. A claimed stem that cannot be grounded returns nothing from that builder. Ellingham, Maxwell, activation-energy profiles, and Born–Haber stay on their existing builders. Kinetics, metallurgy, solutions, and the rest of equilibrium were not added.

Independent oracles, written in the verify script and not imported from the builders:

- Chemistry convention: `ΔU = q + w`, `w = −Pext ΔV`, and `1 kPa·L = 1 J`. Expansion by 2 L against 100 kPa is `w = −200 J`. With `q = +500 J`, `ΔU = +300 J`. Compression of the same size is `w = +200 J`. Isochoric work is 0. Adiabatic heat is 0. `ΔH = ΔU + Δ(PV)` only when `Δ(PV)` is stated: `+300 J` and `+50 J` give `+350 J`.
- Constant heat capacity: sample `C = 20 J/K` from 300 K to 310 K gives `q = 200 J`. Molar `25 J/(mol·K)` for `2 mol` and `ΔT = 10 K` gives `q = 500 J`. Ideal-gas `Cp,m − Cv,m = R` uses `R = 8.314 J/(mol·K)`, so `Cp,m = 29.1` gives `Cv,m = 20.79`.
- Hess: `−394` as written plus reversed `−283` is `−111 kJ`. Scaling `−100` by 2 and adding `+30` is `−170 kJ`. A missing enthalpy is not invented.
- Entropy: `+20` and `−20` give universe `0` and the label `reversible`, not spontaneous. `+50` and `−20` give `+30` and spontaneous. `+10` and `−40` give `−30` and `not spontaneous`. System-only `+50` is labelled `sys only`. Reversible isothermal `q_rev = 400 J` at `298 K` is `400/298`, displayed as `1.34 J/K`.
- Gibbs: `ΔH = −40 kJ/mol` and `ΔS = −100 J/(mol·K)` cross at `400 K`. At `298 K`, `ΔG = −40 − 298×(−0.1) = −10.2 kJ/mol`. `ΔG° = −RT ln K` with `R = 8.314` and `ΔG° = −5.708 kJ/mol` at `298 K` gives `K = exp(5708/(8.314×298))`.
- Closing NaCl Born–Haber still uses the stated steps and `U = −787 kJ`. An incomplete KBr cycle that states only sublimation `90 kJ/mol` must not show `787`, `108`, `496`, or `349`.

Commands, from `packages/scene-engine`:

- `pnpm exec tsx scripts/verify/verify-c04-chemical-thermodynamics.ts` → passed, including after the Gibbs line was kept schematic.
- `pnpm exec tsx scripts/verify/verify-c02-atomic-structure.ts` → passed with the new disclosure labels.
- `pnpm verify:chemistry` subject gate → ok (15 chemistry, 18 not chemistry).
- `pnpm exec tsx scripts/verify/verify-chemistry-families.ts` after the Gibbs line was kept schematic → ok (families=13 of 13, draws=174, declines=47, physics stems kept out=8, bank regressions=19).

Frozen sha256:

- `packages/scene-engine/src/chemistry/chemicalThermodynamics.ts` `bae995a5cc7eb6cabb8bd33a6df5d06c7808ec4c6eee3f79cfe3a4a3b181a347`
- `packages/scene-engine/src/chemistry/thermoGraphs.ts` `b899531b6d56660748faa7182222f14052ee885b497d57839b3fa6fe3c6f1e20`
- `packages/scene-engine/scripts/verify/verify-c04-chemical-thermodynamics.ts` `020ceaebfdbc35f58dd815e94b7c4a8c1e45a125d80a885e89661a30d4f24267`
- `pnpm exec tsc --noEmit` → exit 0.
- `pnpm exec eslint` on the thermodynamics sources and `verify-c04-chemical-thermodynamics.ts` → exit 0.
- `pnpm exec tsup src/index.ts --format esm --dts` → dist rebuilt. `--clean` was not used.

The Gibbs line is qualitative. Its axes put the crossover at a fixed display position. The caption says the line is schematic and the vertical scale is not kJ. `T = 400 K` and `ΔG=-10.2 kJ` are calculated labels, checked against the oracle above. They are not a claim that a curve point has those coordinates.

## Live path

Isolated tutor on `http://127.0.0.1:3017`, database `heytutor_c03` on `127.0.0.1:5433`. Signed in as the dev student (`dev@localhost`). Each lesson was compiled through `selectVerifiedRepresentation`, canonicalized by the turn route, and posted to `/api/boards/:id/turns`. Every saved turn is `visual_status` `validated`, `qualitative_verified`, `diagramResultStatus` `ready`. No audio file was uploaded. Lecture audio was not tested for C-02 or C-03, and it was not tested here.

| Topic | Board | Turn | Reopen and finished replay |
| --- | --- | --- | --- |
| systems-state-functions-and-processes | `e4818100-0e1a-468f-a65f-7111a66393ad` | `4d173aac-4c98-4dcd-a3bb-48aa2beb3531` | Closed boundary, energy arrow inward, labels `closed`, `no matter`, `energy`. Replay finished and those marks returned. |
| first-law-work-heat-and-internal-energy | `b3b7d53b-fa31-4088-8166-81a5711fd75a` | `0fb21bcd-ba46-475d-b87d-ce09a06bb4ed` | `q=+500 J`, `w=-200 J`, `dU=+300 J`, `dU=q+w`. Replay finished and those marks returned. |
| heat-capacity | `ad17913e-f743-485c-a026-28d451b8150f` | `b254d01f-07f7-435e-9bc1-6d06251a02e7` | `q=200 J`, `C sample`, `q=C*dT`. Replay finished and those marks returned. |
| hesss-law-and-enthalpies-of-reaction | `0018dea0-16a9-4265-a553-9a0f263aed4c` | `981fdb38-e24c-4b51-8751-7c8e04d4d0a7` | `-394 kJ`, `rev +283 kJ`, `net=-111 kJ`. Replay finished and those marks returned. |
| entropy-and-spontaneity | `08e70b54-f8a1-4d69-9230-a488d63e97f2` | `8857463d-565b-47eb-ae27-4d1d19618d61` | `dSsys=+20`, `dSsurr=-20`, `dSuniv=0`, `reversible`. Replay finished and those marks returned. The word spontaneous is not on the board. |
| gibbs-energy-and-equilibrium-constant | `8e898a84-5754-4e6e-bd37-4353b52f42bb` | `e8c6f38b-78b7-4314-94cf-9a13d3a187fb` | Schematic line, `T = 400 K`, `ΔG=-10.2 kJ`, `ΔH = -40 kJ/mol`, `spontaneous` on the low-temperature side and `not spontaneous` on the other. Replay finished and those marks returned. |

Earlier C-02 and C-03 boards are still in `heytutor_c03`. The radial disclosure board from the C-02 review is `bae5bd28-7292-491c-9c3b-14da1a660074`.

## Per-topic outcomes

| Exact topic ID | Exam/model variants checked | Tier / text-only reason | Proposed state | Evidence links | Remaining variants or blockers |
| --- | --- | --- | --- | --- | --- |
| chemistry\|4\|systems-state-functions-and-processes | Closed, isolated, and open boundaries. Doubling the sample keeps `T=300 K` and doubles `U` from 10 kJ to 20 kJ. `U` state, `q` and `w` path. Isothermal endpoints `10 L` to `5 L` are labelled and no pressure is invented. Isolated-with-matter, closed-with-matter, and open-with-no-matter decline. An endpoint-free PV request does not become this figure. | qualitative_verified | verification_pending | this log; turn `4d173aac-4c98-4dcd-a3bb-48aa2beb3531` | No quantitative P–V curve. Isobaric and adiabatic endpoint pairs were not given a separate live board. |
| chemistry\|4\|first-law-work-heat-and-internal-energy | Expansion `w=-200 J`, `ΔU=+300 J`. Compression `w=+200 J`, `ΔU=+100 J`. Isochoric `q=+400 J` gives `w=0`. Adiabatic expansion gives `q=0`, `w=-200 J`, `ΔU=-200 J`. `Δ(PV)=+50 J` gives `ΔH=+350 J`. Missing pressure, an expansion without `Δ(PV)`, isochoric-plus-expansion, and adiabatic-plus-nonzero-heat decline. | qualitative_verified | verification_pending | this log; turn `0fb21bcd-ba46-475d-b87d-ce09a06bb4ed` | Reversible ideal-gas `∫P dV` stays off this figure. Non-PV work is outside the assigned scope. |
| chemistry\|4\|heat-capacity | Sample `q=200 J`. Molar `q=500 J` with `n=2 mol`. Ideal-gas `Cv=20.79` and the label `ideal gas R`. Amount 0, negative C, melting, and liquid `Cp−Cv=R` decline. | qualitative_verified | verification_pending | this log; turn `b254d01f-07f7-435e-9bc1-6d06251a02e7` | A heat capacity that varies with temperature is not integrated. Only stated phase-change words are rejected. |
| chemistry\|4\|hesss-law-and-enthalpies-of-reaction | Reverse gives net `−111 kJ`. Scale-by-2 gives net `−170 kJ`. Combustion and formation names use that same sum. Missing numbers decline. Closing NaCl still shows `U = −787 kJ`. Incomplete KBr does not borrow NaCl magnitudes. | qualitative_verified | verification_pending | this log; turn `981fdb38-e24c-4b51-8751-7c8e04d4d0a7` | Bond, atomisation, sublimation, phase, hydration, ionisation, and solution enthalpies are the same step operation when the stem gives the numbers. A bond-enthalpy sentence that is not written as Hess steps still declines. They were not each given a live board. |
| chemistry\|4\|entropy-and-spontaneity | Reversible zero total, irreversible `+30`, negative `−30`, system-only `+50`, and `q_rev/T = 1.34 J/K`. Irreversible `q/T`, a zero total called irreversible, and a nonzero total called reversible decline. | qualitative_verified | verification_pending | this log; turn `8857463d-565b-47eb-ae27-4d1d19618d61` | A non-isothermal `∫ dq_rev/T` is not computed. |
| chemistry\|4\|gibbs-energy-and-equilibrium-constant | All four sign pairs. The assigned crossover is `400 K` and `ΔG=-10.2 kJ` at `298 K`. `ΔG°=-RT ln K` for `−5.708 kJ/mol` at `298 K`. `K=0` and `T=0` decline. The existing `+40 kJ` / `+100 J/K` probe still says `T = 400 K` and does not invent a `ΔG` label. | qualitative_verified; the line is schematic | verification_pending | this log; turn `e8c6f38b-78b7-4314-94cf-9a13d3a187fb` | The K account is labels, not a second curve. Equilibrium is not a rate and not an activation barrier. No human acceptance. |

## Handoff

Ready rows: 6/6. The core path of each row compiles, matches the independent oracle, declines the contradictions above, and has a saved, reopened, and finished replay. Fully accepted rows: 0/6. Remaining variants are listed in the table and are not `none`.

Atomic Structure remains 6/6. Chemical Bonding remains 7/7. Lecture audio remains untested. No shared seam patch. Do not start the next chemistry chapter from this packet.

Publication: uncommitted.

## Integration-owner disposition

Not accepted. The reviewer for this log is the chemistry lane that wrote the packet, not a separate person. `accepted_by` is blank.

## Presentation preflight, 2026-10-06

This note does not reopen the thermodynamics audit and does not change the ready 6/6 or accepted 0/6 counts. The remaining variants in the table above stay as written.

The schematic Gibbs line now carries board ink `schematic` and `not a kJ scale`. A caption alone is not the disclosure. For the per-mole stem, `ΔH = −40 kJ/mol` and `ΔS = −100 J/(mol·K)` at 298 K are labelled `ΔG=-10.2 kJ/mol`. The earlier placement put `not a kJ scale` on the rising line. Those words now sit at display coordinates (1.7, 2.7) and (1.7, 1.85), above the line.

`pnpm exec tsx scripts/verify/verify-c04-chemical-thermodynamics.ts` passed after that move. The corrected lesson was saved, reopened, and replayed to completion on board `1a6e9317-5176-476e-9b9e-26fe5ad1060b`, turn `1ae1a39c-b8cb-479b-a78a-896f749f7dad`. The finished board shows `schematic`, `not a kJ scale`, and `ΔG=-10.2 kJ/mol`. Board `26bcdaae-bf98-4a0d-8003-cf40acff5831` still has the crossed disclosure and is not the example. Lecture audio was not tested.

The two hashes below replace the earlier `thermoGraphs.ts` and `verify-c04-chemical-thermodynamics.ts` hashes in this log. sha256 after this preflight:

- `packages/scene-engine/src/chemistry/thermoGraphs.ts` `1fdcb57e816dc1586582d9a3b559ea9ed2eb2a4c2678a143b8a48e57192fc91c`
- `packages/scene-engine/scripts/verify/verify-c04-chemical-thermodynamics.ts` `1ab0a32d27acb7f60af2fa3bfac79331ae1ccd844953eb650fd5e78c5bb1e6e0`
- `packages/scene-engine/src/chemistry/chemicalThermodynamics.ts` `bae995a5cc7eb6cabb8bd33a6df5d06c7808ec4c6eee3f79cfe3a4a3b181a347` (unchanged)
