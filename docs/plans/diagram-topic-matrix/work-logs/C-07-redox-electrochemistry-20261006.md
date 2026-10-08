# Packet completion log: C-07 / redox-electrochemistry-20261006

## Assignment and source contract

- Worker: chemistry lane in this session. No separate human reviewer signed this packet. `accepted_by` stays blank.
- Worktree: `/Users/kaizen/conductor/workspaces/heytutor/muscat`, branch `kaizen403/o4pd4`. Date: 2026-10-06. Atomic Structure stays accepted 6/6. Chemical Bonding stays accepted 7/7. Chemical Thermodynamics stays ready 6/6 and accepted 0/6. Solutions stays ready 6/6 and accepted 0/6. Equilibrium is recorded in the C-06 log as gate-ready 8/8 and accepted 0/8. `/Users/kaizen/heytutor-claude-coord` was not edited. No commit, push, or merge.
- Packet: C-07a, C-07b, C-07c, and C-07d. All eight `chemistry|7` rows. Frozen profile: `2026-10-02-topic-matrix-v1`; JEE Main 2026 Paper 1; JEE Advanced 2026; NEET 2026.
- Faraday stays an application on `chemistry|7|electrolysis-and-faradays-laws` (Main/NEET electrolytic cells). It is not a separate Faraday heading. Corrosion is Advanced-explicit and Main/NEET review, on `chemistry|7|commercial-cells-and-batteries`.
- New modules: `redoxBalance.ts`, `cellAccounts.ts`, `conductanceFaraday.ts`, `commercialCells.ts`. Routing seam: `electrochemistry.ts` (`chem_electrochem`). `lewis.ts` no longer claims a stem that says oxidation number. Owned gate: `packages/scene-engine/scripts/verify/verify-c07-redox.ts`. No shared compiler, IR, persistence, replay, or presentation seam was edited. No fourteenth chemistry family was added.
- The existing Daniell cell, salt-bridge notation, brine, molten NaCl, aqueous copper sulfate, and the sulphuric-acid electrolysis product path stay on the previous builders. The new modules decline those stems.

## Changes and checks

Oxidation numbers are summed, atom by atom, to the formula charge. Peroxide oxygen is −1. The sum is not a formal charge, and oxygen is not set to −2 by default. The acidic control `MnO4- + 5Fe2+ + 8H+ -> Mn2+ + 5Fe3+ + 4H2O` balances atoms and charge, and the five electrons cancel.

A galvanic anode is negative and an electrolytic anode is positive. Oxidation is at the anode in both. `Ecell = Ecathode − Eanode`. Standard potentials are not multiplied by stoichiometric coefficients. The Daniell standard emf remains `E° = 1.10 V`.

The new Nernst path is `E = E° − (RT/nF) ln Q` with `T` in kelvin. At 310 K, `E° = 1.10 V`, `n = 2`, `Q = 10`, `R = 8.314`, and `F = 96500`, `E = 1.069251 V`, labelled `E=1.069 V` and `not 0.059`. `Q = 1` returns `E°`. The existing 298 K Daniell concentration figure still uses the factor 0.0591 and still labels `E = 1.07 V`. That path was not changed.

`ΔG = −nFE` and `ΔG° = −nFE°`. For `E° = 0.100 V`, `n = 1`, and `T = 298 K`, `ΔG° = −9.65 kJ/mol` and `K = exp(9650 / (8.314 × 298)) = 49.153`, labelled `K=49.2`. `K` is not inferred from a nonstandard `E`.

Conductivity is `kappa = G × l / A`. With `G = 0.020 S`, `l = 2 cm`, and `A = 4 cm2`, `kappa = 0.01 S/cm`. With kappa in S/cm and concentration in mol/L, `Λm = 1000 × kappa / c`. Kohlrausch sums the stated ionic limiting conductivities. The `Λm` versus `√c` curve is labelled `schematic` and `not measured` on the board.

Faraday uses `Q = It`, `m = M × Q / (zF)`, and the copper mass 63.546 from the element table. `I = 1 A` for 965 s and `z = 2` gives `m = 0.31773 g`, labelled `m=0.318 g`. A deposit that needs more copper than is available declines. Molten and aqueous products stay on the existing electrolysis figures and are not invented.

The dry cell, lead accumulator discharge and recharge, acid fuel cell, and moist-air corrosion use the stated materials and balanced half-reactions. Discharge is not drawn as recharge. No voltage, lifetime, capacity, or corrosion rate is invented.

Commands, from `packages/scene-engine`:

- `pnpm exec tsx scripts/verify/verify-c07-redox.ts` → `verify-c07-redox: ok`.
- `pnpm exec tsx scripts/verify/verify-chemistry-families.ts` → ok (families=13 of 13, draws=178, declines=43, physics stems kept out=8, bank regressions=19).
- `pnpm exec tsx scripts/verify/verify-chemistry-subject.ts` → ok (15 chemistry, 18 not chemistry).
- `pnpm exec tsc --noEmit` → exit 0.
- `pnpm exec eslint` on the touched chemistry files → exit 0.
- `pnpm exec tsup src/index.ts --format esm --dts` → dist rebuilt. `--clean` was not used.

sha256:

- `redoxBalance.ts` `4876f297583f8704c22fb6a4b39c94c9ffe7f3b727bd08f9a6fbb7d17fd40955`
- `cellAccounts.ts` `467fdd8447198f5cbc3a3a55bb4d220197d5e8791d5147c9165a92fe391d8c2a`
- `conductanceFaraday.ts` `8a545ee2ce3f8e46ab4c8857be6a0b100ec0cf96a850672a84c121f35fa1a370`
- `commercialCells.ts` `0c6049c2464916e7f2057a8356d6bcdf36a76eb79dce5e20a96d9758dd9f4731`
- `electrochemistry.ts` `4cc575c40e12684b5b94203a09847ec33d23b9be65b777f6161e262771c3a575`
- `lewis.ts` `98c2760a746d0668f79d3b76902130ecd79fee6026d367f56c572caa3d43f1a6`
- `verify-c07-redox.ts` `d74378d2efb1715da2fd4a62d0eb69dd98e25b9d9c86ba73654716cc0899213a`

## Live path

The earlier pass used `http://127.0.0.1:3017` and did not upload audio. This check used `http://127.0.0.1:3027` and did not touch port 3017. Each turn is `validated`, `qualitative_verified`, and `ready`. Reopen returned the mark.

Each saved board was opened at `/c/:id` with no `?replay=1`. The restored screenshot was taken after the boot overlay was hidden and the saved commands had been drawn, without clicking Replay. The required mark is visible in that image. Replay on these boards was already driven: the control showed disabled `Replaying…`, then returned to enabled `Replay`, and the replayed image shows the mark with the control idle. All eight `chemistry|7` rows are restore/replay-ready. Lecture audio and paid TTS were not tested and are not a blocker for this pass. The 298 K Daniell concentration path still uses 0.0591.

| Topic | Board | Turn | Reopen mark |
| --- | --- | --- | --- |
| oxidation-number-and-redox-reactions | `c0bd47ae-7ddb-44c9-a6f0-4aa48c72e0ed` | `6fdef120-494b-4f16-96e8-70308889d27c` | `O=-1` |
| balancing-redox-reactions | `7bfe343c-2ec5-4c4e-9022-279d29eedd3c` | `490e5f7d-dc86-4179-9fad-182ddec6e938` | `e cancel` |
| electrochemical-cells-and-electrode-potential | `e3662ea9-e43c-4273-bc97-9f3525a4932c` | `fcccfcc5-5554-49ee-951b-7a9323187822` | `E° = 1.10 V` |
| nernst-equation | `87b0fc7e-1e63-476f-886a-5ea836f67469` | `f97ab868-7c39-4afd-8e3e-4a79fd5326a6` | `E=1.069 V` |
| cell-potential-and-gibbs-energy | `41d02c23-751c-4849-bb3c-00393b6e8eb8` | `067e3b83-aa0d-4506-83d9-9d6d1027feeb` | `K=49.2` |
| conductance-and-kohlrauschs-law | `53796064-e91a-45ba-8ab2-d90c3ce1394f` | `efe5cdb9-6878-463a-9f4e-d2d29f8add33` | `k=0.01 S/cm` |
| electrolysis-and-faradays-laws | `764b5b4b-8f2e-486d-97cd-cce7127ea507` | `fcd197a0-07fa-45c1-a41c-3165a3897a92` | `m=0.318 g` |
| commercial-cells-and-batteries | `81deba22-348d-471b-826d-c76a25e9ef8c` | `5072d1b9-7555-49cd-848e-a8122793b1da` | `no voltage` |

## Per-topic outcomes

| Exact topic ID | Exam/model variants checked | Tier | Proposed state | Remaining variants |
| --- | --- | --- | --- | --- |
| chemistry\|7\|oxidation-number-and-redox-reactions | Peroxide sum to charge 0. Superoxide, hydride, and mixed valence are separate from formal charge. | qualitative_verified | verification_pending | The saved board is `H2O2`. |
| chemistry\|7\|balancing-redox-reactions | Acidic permanganate and iron, atoms, charge, and cancelled electrons. | qualitative_verified | verification_pending | The saved board is the acidic net. |
| chemistry\|7\|electrochemical-cells-and-electrode-potential | Daniell standard emf, galvanic versus electrolytic anode polarity, oxidation at the anode. | qualitative_verified | verification_pending | `E°` is not multiplied by coefficients. |
| chemistry\|7\|nernst-equation | 310 K uses `RT/nF`. `Q = 1` returns `E°`. | qualitative_verified | verification_pending | The existing 298 K Daniell concentration path still uses 0.0591. |
| chemistry\|7\|cell-potential-and-gibbs-energy | `ΔG° = −nFE°` and `ln K = nFE°/RT` from standard `E` only. | qualitative_verified | verification_pending | A nonstandard `E` does not give `K`. |
| chemistry\|7\|conductance-and-kohlrauschs-law | `kappa = Gl/A`, `Λm = 1000 kappa/c`, and an independent Kohlrausch sum. The dilution curve says `schematic` and `not measured`. | qualitative_verified | verification_pending | The saved board is the conductivity account. The curve is not measured data. |
| chemistry\|7\|electrolysis-and-faradays-laws | Copper mass from `Q = It` and the element mass, with efficiency and available reactant. Molten NaCl still gives sodium and chlorine. | qualitative_verified | verification_pending | The saved board is the Faraday mass. Product identity stays on the existing electrolysis figures. |
| chemistry\|7\|commercial-cells-and-batteries | Dry cell, lead discharge and recharge, acid fuel cell, and moist-air corrosion, with balanced charges and no invented voltage. | qualitative_verified | verification_pending | Corrosion is Advanced-explicit and Main/NEET review. |

## Handoff

Gate-ready rows: 8/8. Each row compiles, matches the independent oracle, declines the contradictions above, and has a validated turn that reopened with its mark. Fully accepted rows: 0/8. All eight rows are restore/replay-ready. Lecture audio and paid TTS were not tested and are not a blocker for this pass. The 298 K Daniell concentration path still uses 0.0591. Remaining limits are listed above.

Combined with C-06, the new gate-ready rows are 16. Combined accepted rows are 0. Prior acceptance is unchanged.

Publication: uncommitted.

## Integration-owner disposition

Not accepted. The reviewer for this log is the chemistry lane that wrote the packet. `accepted_by` is blank. Proposed state: `verification_pending`.
