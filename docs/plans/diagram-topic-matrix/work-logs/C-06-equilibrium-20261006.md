# Packet completion log: C-06 / equilibrium-20261006

## Assignment and source contract

- Worker: chemistry lane in this session. No separate human reviewer signed this packet. Do not read `accepted_by` as a person. `accepted_by` stays blank.
- Worktree: `/Users/kaizen/conductor/workspaces/heytutor/muscat`, branch `kaizen403/o4pd4`. Date: 2026-10-06. Atomic Structure stays accepted 6/6. Chemical Bonding stays accepted 7/7. Chemical Thermodynamics stays ready 6/6 and accepted 0/6. Solutions stays ready 6/6 and accepted 0/6. `/Users/kaizen/heytutor-claude-coord` was not edited. No commit, push, or merge.
- Packet: C-06a, C-06b, and C-06c. All eight `chemistry|6` rows. Frozen profile: `2026-10-02-topic-matrix-v1`; JEE Main 2026 Paper 1; JEE Advanced 2026; NEET 2026.
- Henry's law stays on `chemistry|5|solubility-and-henrys-law`. This packet does not update `chemistry|5`. A Gibbs relation `ΔG° = −RT ln K` with no reaction quotient stays on `chemistry|4|gibbs-energy-and-equilibrium-constant`.
- New modules: `equilibriumPhysical.ts`, `equilibriumConstants.ts`, `acidBaseEquilibrium.ts`, `ionicEquilibrium.ts`. Routing seams: `kinetics.ts` (`chem_kinetics`) and `solutionsGraphs.ts` (`chem_solutions`). Owned gate: `packages/scene-engine/scripts/verify/verify-c06-equilibrium.ts`. No shared compiler, IR, persistence, replay, or presentation seam was edited. No fourteenth chemistry family was added.
- Eight writing agents plus a reviewer and a runtime-procedure agent ran. The coordinator owns the family seams and this log.

## Changes and checks

Dynamic and physical equilibrium figures show both directions (`fwd` and `rev`), equal forward and reverse rates, and unequal amounts. A stopped reaction, an open dish, and a driven steady state decline. A phrase that only says solid–gas or gas–gas, without a closed vessel and equal rates, is claimed and not drawn.

`Q` and `K` use the balanced stoichiometry. Pure solids and liquids are omitted. The ammonia control is `Kc = 4`, `T = 298 K`, `R = 0.083 L bar/(K mol)`, `Δn = −2`, so `Kp = 4 / (0.083 × 298)^2 = 0.006538`, labelled `Kp=0.00654`. A 1:1 extent with `nA = 1`, `nB = 0`, and `Kc = 4` gives `x = 0.8`. Negative `Kc`, including `[CaCO3]`, and an extent past the limiting reactant decline.

Reaction `ΔG = ΔG° + RT ln Q`. `Q = 1` and `ΔG° = 10 kJ/mol` give reaction `ΔG = 10 kJ/mol`, labelled as not the total system Gibbs energy. `Q = K` makes reaction `ΔG = 0`. It does not make `ΔG° = 0`. A stem that says `ΔG°` must be 0 declines.

Le Chatelier changes `Q` immediately. `K` changes with temperature only. Increasing pressure on `N2 + 3H2 <=> 2NH3` is labelled `dN=-2`, `P up`, `toward NH3`, `K fixed`, `schematic`. An inert gas at constant volume does not shift that equilibrium; at constant pressure it does. A catalyst does not change the final composition. No pressure shift is drawn when `Δn(gas) = 0`.

Acids and bases cover Arrhenius ionisation, Brønsted conjugate pairs, and Lewis electron-pair donor and acceptor. Strong is not the same as concentrated. Multistage `Ka` stays staged. `1e-8 M` HCl with `Kw = 1e-14` uses `[H+] = (c + sqrt(c^2 + 4Kw)) / 2` and is labelled `pH=6.98`, not pH 8. Neutral water at `Kw = 1e-13` is pH 6.5. Pure water at `Kw = 1e-14` is pH 7. Activity coefficients are labelled unused. The interval 0 to 14 is not treated as a universal pH bound.

The acetate buffer `pKa = 4.76`, salt 0.2 M, acid 0.1 M is `4.76 + log10(2) = 5.061`, labelled `pH=5.06`. Henderson–Hasselbalch is refused outside its bounds, and an exhausted buffer is not called a buffer. Acetate `Kb = 5.6e-10` at 0.1 M gives pH 8.87. `CaF2` with `Ksp = 4.0e-11 = 4s^3` is labelled `s=2.15e-4`. `Q < Ksp` does not precipitate. Mixing volumes are applied before `Q`.

Commands, from `packages/scene-engine`:

- `pnpm exec tsx scripts/verify/verify-c06-equilibrium.ts` → `verify-c06-equilibrium: ok`.
- `pnpm exec tsx scripts/verify/verify-chemistry-families.ts` → ok (families=13 of 13, draws=178, declines=43, physics stems kept out=8, bank regressions=19). The Le Chatelier ammonia-pressure stem and the 0.1 M / 0.2 M acetate buffer now draw.
- `pnpm exec tsx scripts/verify/verify-chemistry-subject.ts` → ok (15 chemistry, 18 not chemistry).
- `pnpm exec tsc --noEmit` → exit 0.
- `pnpm exec eslint` on the touched chemistry files → exit 0.
- `pnpm exec tsup src/index.ts --format esm --dts` → dist rebuilt. `--clean` was not used.

sha256:

- `equilibriumPhysical.ts` `54c023f87dda2ba8cdb22abd2623472f88573f153c0e2170127dbf57429b6adf`
- `equilibriumConstants.ts` `d5345915bdf3f50957243115deb241bbd62d8fbd72e1f4bf0ecaadd39b6fe333`
- `acidBaseEquilibrium.ts` `b809648dd0e58b257e4a5e76b768e515cba88a18c3fed3b114c239403d0e1020`
- `ionicEquilibrium.ts` `e07cf8cf35bb496ad64608312ec01a3da0f7c80f5fa4eee29e2ccbd372ca90cb`
- `kinetics.ts` `bcb4801b294eb3a14c689c84bebf826a3d77276becf6e5c35fc30905345d1886`
- `solutionsGraphs.ts` `a757613fe08d5fdf4767718de97cf3563446357bba570e54b2efc6f14951cb97`
- `verify-c06-equilibrium.ts` `3360b7ac0cb0e3bfba8b462ba0e7fecbb2450f4e566dbbeb7cbcdabf77c249ac`

## Live path

The tutor already listening on `http://127.0.0.1:3017` was left running. Its process belongs to `/Users/kaizen/heytutor/apps/tutor`, not this worktree. This session did not restart it and did not start a second tutor. Postgres on `127.0.0.1:5433` was not restarted. The database name was not printed again; earlier chemistry lessons used `heytutor_c03`.

Each lesson was compiled with `synthesizeFamilyScene` in this worktree and posted to `/api/boards/:id/turns`. The running server canonicalized the document. Every saved turn is `visualStatus` `validated`, `representationTier` `qualitative_verified`, `diagramResultStatus` `ready`. Reopen is `GET /api/boards/:id?page=0`, and the required mark is in the saved commands. No audio file was uploaded. Lecture audio was not tested.

Firefox BiDi could not start, so an earlier pass rasterized figures with Quick Look into `.context/figures/`. Saved-command replay is not a spoken replay.

The current check used `http://127.0.0.1:3027` and did not touch port 3017. Each saved board was opened at `/c/:id` with no `?replay=1`. The restored screenshot was taken after the boot overlay was hidden and the saved commands had been drawn, without clicking Replay. The required mark is visible in that image. Replay on these boards was already driven: the control showed disabled `Replaying…`, then returned to enabled `Replay`, and the replayed image shows the mark with the control idle. All eight `chemistry|6` rows are restore/replay-ready. Lecture audio and paid TTS were not tested and are not a blocker for this pass.

| Topic | Board | Turn | Reopen mark |
| --- | --- | --- | --- |
| dynamic-equilibrium-and-physical-equilibria | `7ebbd516-cc0e-4aad-9b32-278a7d238c72` | `2b95fa4b-7d22-4503-b30a-db509d77ffba` | `rates equal` |
| law-of-chemical-equilibrium-kp-and-kc | `86a79d98-5b8f-43d9-a7f2-2f5eb5a8643e` | `8fdc0a47-aede-4c21-8c75-17842d60e28d` | `Kp=0.00654` |
| gibbs-energy-and-equilibrium | `96bbf099-142a-4a75-95de-e0f5fef9781b` | `be4596fa-190f-4fe0-9ad3-0e0804c8ff43` | `dG=10 kJ/mol` |
| le-chateliers-principle | `53b59a35-7cf8-4081-b05c-e7b937d4ce47` | `5bbad704-f256-4471-ba5d-785819188f3f` | `toward NH3` |
| acids-bases-and-ionisation-constants | `29920bbe-fefa-4a73-88b5-7e384ef8a1c3` | `c98daca5-1d2c-4a4a-91de-5e173d17cfef` | `Arrhenius` |
| ph-scale-and-ionisation-of-water | `faad0437-aca8-48b8-b88f-b1e471bd2d3b` | `f621cc7c-4961-4935-b511-060938ffb994` | `pH=6.98` |
| common-ion-effect-buffers-and-salt-hydrolysis | `2c978f65-d5d6-4f08-b14e-3ae5e623c1bb` | `1068829f-413d-48cd-8f49-9f3a01648f74` | `pH=5.06` |
| solubility-product | `ee2dfeab-5c60-4e95-b42d-6d9a8795875c` | `0addb39c-b89b-436a-919d-cb35a0689062` | `s=2.15e-4` |

## Per-topic outcomes

| Exact topic ID | Exam/model variants checked | Tier | Proposed state | Remaining variants |
| --- | --- | --- | --- | --- |
| chemistry\|6\|dynamic-equilibrium-and-physical-equilibria | Closed water liquid–vapour, equal rates, unequal amounts, both arrows. Open dish, stopped rates, and a driven steady state decline. | qualitative_verified | verification_pending | A phase phrase without the closed and equal-rate words is not drawn. |
| chemistry\|6\|law-of-chemical-equilibrium-kp-and-kc | Ideal-gas `Kp = Kc(RT)^Δn`, heterogeneous `CaCO3`, and a nonnegative extent. Negative `Kc` and a pure-solid activity decline. | qualitative_verified | verification_pending | Heterogeneous solids stay activity 1. |
| chemistry\|6\|gibbs-energy-and-equilibrium | Reaction `ΔG` at `Q = 1` is not total `G` and is not `ΔG° = 0`. | qualitative_verified | verification_pending | `ΔG° = −RT ln K` without `Q` stays on chemistry\|4. |
| chemistry\|6\|le-chateliers-principle | Pressure on ammonia, `Δn = 0`, catalyst, temperature, and inert gas at constant volume versus constant pressure. | qualitative_verified | verification_pending | The saved board is the pressure shift. Inert-gas and catalyst panels were gate-checked. |
| chemistry\|6\|acids-bases-and-ionisation-constants | Arrhenius, Brønsted, Lewis, strong versus concentrated, and staged `Ka`. | qualitative_verified | verification_pending | The saved board is Arrhenius HCl. |
| chemistry\|6\|ph-scale-and-ionisation-of-water | Dilute strong acid with water, neutral pH at a stated `Kw`, and pH outside 0..14. | qualitative_verified | verification_pending | Activity coefficients are unused. |
| chemistry\|6\|common-ion-effect-buffers-and-salt-hydrolysis | Henderson–Hasselbalch inside its bounds, exhaustion, common ion, and the hydrolysing ion. | qualitative_verified | verification_pending | The saved board is the acetate buffer. |
| chemistry\|6\|solubility-product | `CaF2` `4s^3`, `AgCl`, `Q` versus `Ksp`, and post-mixing volume. | qualitative_verified | verification_pending | The saved board is pure-water `CaF2`. |

## Handoff

Gate-ready rows: 8/8. Each row compiles, matches the independent oracle, declines the contradictions above, and has a validated turn that reopened with its mark. Fully accepted rows: 0/8. All eight rows are restore/replay-ready. Lecture audio and paid TTS were not tested and are not a blocker for this pass. Henry's law stays on chemistry|5. `ΔG° = −RT ln K` without `Q` stays on chemistry|4. A phrase-only solid–gas figure without a closed vessel and equal rates is not drawn. Heterogeneous solids stay activity 1. The other remaining limits are listed above.

Atomic Structure remains accepted 6/6. Chemical Bonding remains accepted 7/7. Chemical Thermodynamics remains ready 6/6 and accepted 0/6. Solutions remains ready 6/6 and accepted 0/6.

Publication: uncommitted.

## Integration-owner disposition

Not accepted. The reviewer for this log is the chemistry lane that wrote the packet. `accepted_by` is blank. Proposed state: `verification_pending`.
