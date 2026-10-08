# Packet completion log: C-09 / periodicity-20261006

## Assignment and source contract

- Worker: chemistry lane in this session. No separate human reviewer signed this packet. `accepted_by` stays blank.
- Worktree: `/Users/kaizen/conductor/workspaces/heytutor/muscat`, branch `kaizen403/d622635b-chem-diagram`. Date: 2026-10-06. Earlier chemistry chapters keep the counts in the C-08 log. `/Users/kaizen/heytutor-claude-coord` was not edited. No commit, push, or merge.
- Packet: C-09a and C-09b. All six `chemistry|9` rows. Frozen profile: `2026-10-02-topic-matrix-v1`; JEE Main 2026 Paper 1; JEE Advanced 2026; NEET 2026. This packet does not open the p-block or d/f-block chapters.
- New modules: `periodicPlacement.ts`, `periodicSize.ts`, `periodicReactivity.ts`. Routing seam: `periodicTrend.ts` (`chem_periodic`). `elements.ts` numbers were not edited. Owned gates: `verify-c09a-placement.ts`, `verify-c09b-size.ts`, `verify-c09b-reactivity.ts`, `verify-c09-periodicity.ts`. No fourteenth chemistry family was added.
- Two earlier families were releasing these stems. `orbitalBox.ts` treated the letters in "Pauling" as a Pauli cue; the cue is now the whole word. `electrochemistry.ts` yields a stem that `claimsPeriodicReactivity` owns, so a valence board is not replaced by an oxidation-number sum. Existing period-3 and group trend probes stay on the previous graphs.

## Changes and checks

Placement is read from the element table. Helium is `Z=2`, group 18, period 1, block s. The board labels `He grp 18` and `block s`. Chromium stays d-block for a `4s1 3d5` configuration (`Cr block d`). Copper's table row is Z 29, group 11, block d. An f-block element with no group number labels `f not group`. The modern law labels `by Z` and `not mass`. Stating that the modern law is atomic-mass order declines.

Ionic radii use the six-coordinate values already in the code. `Na+`, `Mg2+`, and `Al3+` are 10 electrons and `102 > 72 > 54`. Covalent radius is not plotted as ionic. First ionisation enthalpy keeps `Be>B` (`899>801`) and `N>O` (`1402>1314`) even when the stem asks for a monotonic rise. A supplied second ionisation enthalpy is labelled `not IE1` and is not replaced by the first value.

Electron-gain enthalpy is not Pauling electronegativity. Chlorine (`-349`) is more negative than fluorine (`-328`). Fluorine's electronegativity (`3.98`) is higher than chlorine's (`3.16`). The board labels `Cl more -`. Helium, neon, and argon stay null. Setting helium's electronegativity to 0 declines and does not fall through to an orbital diagram. Sodium in NaCl labels `valence 1`. Valence, oxidation state, and reactivity stay distinct. A reactivity arrow inferred from radius declines.

Commands, from `packages/scene-engine`:

- `pnpm exec tsx scripts/verify/verify-c09a-placement.ts` → `verify-c09a-placement: ok`.
- `pnpm exec tsx scripts/verify/verify-c09b-size.ts` → passed.
- `pnpm exec tsx scripts/verify/verify-c09b-reactivity.ts` → `verify-c09b-reactivity: ok`.
- `pnpm exec tsx scripts/verify/verify-c09-periodicity.ts` → `verify-c09-periodicity: ok`. The live family path is `chem_periodic`. The period-3 first-ionisation probe still draws sodium.
- `pnpm exec tsx scripts/verify/verify-chemistry-families.ts` → ok (families=13 of 13, draws=178, declines=43, physics stems kept out=8, bank regressions=19).
- `pnpm exec tsx scripts/verify/verify-chemistry-subject.ts` → ok (15 chemistry, 18 not chemistry).
- `pnpm exec tsc --noEmit` → exit 0.
- `pnpm exec eslint` on the touched chemistry files and these verify scripts → exit 0.
- `pnpm exec tsup src/index.ts --format esm --dts` → dist rebuilt. `--clean` was not used.

sha256:

- `periodicPlacement.ts` `b77c65e74852d770cbe8e93a9a9125877e438292d48be0865a8c22eed2ec3e6c`
- `periodicSize.ts` `2a7922c72b6dcebbf958965c9122da161079e868b4d6af08d85be1ffa27a505e`
- `periodicReactivity.ts` `8647d79f7d40b6ec287d6345c46df65cf407feafe82ee062d6baa33f2f102e8d`
- `periodicTrend.ts` `2c88d11b63a404a28f395a1801bee18cd3f5e134f8ca8345f85c7c0c1df5fadc`
- `electrochemistry.ts` `07acfbfa82f34c9ac78dbd1f4b4b2ff3602b3bd9f6aff41fb208c859cba171db`
- `orbitalBox.ts` `d95b544e75690cec532fef2ce9c65caae9562050e303cf463b26f4d4dd55b046`
- `verify-c09a-placement.ts` `bce9514c7debdc117caaead7a915b5175422e5cde33fbe338c598ce241842136`
- `verify-c09b-size.ts` `e6841cf4c48eb79cfd929708ca4cbf127169387daedb2d45c08bfd78ce6a6176`
- `verify-c09b-reactivity.ts` `9a2050cb272cb4deb39b3668032b342308c871e39ed9be2de219776161d73fbe`
- `verify-c09-periodicity.ts` `fb5da787489c5b41b4156df93144adcfb0ced0195dd5eb3294f97e16b0380113`

## Student-page attempt

The no-spend fixture in the C-08 log is the same run. Chat was `mock:true`. Reservations stayed at 213. The live 402 `out_of_credits` blocker is unchanged: 384 millicents remain of the 3500 millicent free allowance, and the recorded teaching reserves for the earlier rate question were 614 and 617 millicents. Lecture audio was not tested.

Two periodicity turns were saved. Their scene documents contain the required labels. The restored paper does not. Four questions never stored a turn: the local paid-route limiter returned 429 after the earlier lessons, before `/api/chat` could finish.

| Topic | Board | What the paper showed | Blocker |
| --- | --- | --- | --- |
| modern-periodic-law-and-periodic-table | `21b585c2-b1c0-4841-9fbe-4100ab77e196` | an unrelated mock mechanics solution, `a = F_net/m` and `a = 1.06 m/s^2` | scene document has `by Z` and `not mass` |
| s-p-d-and-f-block-elements | `10050008-0069-4bf0-bf49-1968e8830432` | a box containing only `He` | scene document also has `He grp 18`, `block s`, `period 1`, `Z=2`, and `1s2` |
| atomic-and-ionic-radii | `ad47273d-8aed-4e2d-860c-0c824e4af6e2` | no turn | HTTP 429 before teaching |
| ionisation-enthalpy | `f862a2cd-e4ba-44ad-9228-76961213453c` | no turn | HTTP 429 before teaching |
| electron-gain-enthalpy-and-electronegativity | `8ab1bae9-ccc1-4411-9f58-3efe23ca2207` | no turn | HTTP 429 before teaching |
| valence-oxidation-states-and-chemical-reactivity | `446575a8-4b65-4c07-aeec-2e8e66207bba` | no turn | HTTP 429 before teaching |

## Status after the generic no-key mock

Gate-ready 6/6. That generic-mock paper was restore/replay-ready 0/6. Live-provider lesson/save qualification is blocked by the 402. Accepted 0/6. The table below is that pass only. The later controlled-provider pass is the current student-page result.

| Topic | Gate | Fixture restore / replay | Accepted |
| --- | --- | --- | --- |
| modern-periodic-law-and-periodic-table | ready | paper is a different subject | no |
| s-p-d-and-f-block-elements | ready | paper shows only He | no |
| atomic-and-ionic-radii | ready | not saved | no |
| ionisation-enthalpy | ready | not saved | no |
| electron-gain-enthalpy-and-electronegativity | ready | not saved | no |
| valence-oxidation-states-and-chemical-reactivity | ready | not saved | no |

## Controlled-provider fixture pass

This is the same muted 3027 run as the C-08 controlled-provider section. Group narration cues name the label strings. Shared presentation files were not edited. Reservations stayed 213 to 213. The 402 and the generic-mock boards above are unchanged. Lecture speech was written to files and not played.

Modern law and ionisation enthalpy did not issue a problem-ir request. Their turn plans and teaching text were fixture-backed, and both turns saved. The other four rows intercepted problem-ir as well. The ionic-radii library title is "Circle geometry" and the ionisation-enthalpy library title is "Photosynthesis"; those titles came from the board-name request. The paper marks are the chemistry labels below.

| Topic | Board | Paper | Replay |
| --- | --- | --- | --- |
| modern-periodic-law-and-periodic-table | `7ec20ba1-c6a1-43ef-aa32-8bf3871d9301` | `by Z`, `not mass`, `modern law` | paths 162, drawDone 9, Replay enabled |
| s-p-d-and-f-block-elements | `bb4e21d5-61f8-4b34-b067-567a623ebba2` | boxed `He`, `He grp 18`, `block s`, `period 1`, `Z=2`, `1s2`, `e=Z=2` | paths 210, drawDone 22, Replay enabled |
| atomic-and-ionic-radii | `2506bf07-f6da-49b0-8f32-45f3de3cbd44` | `6-coord`, `10 electrons`, `102>72>54`, `Z Na<Mg<Al`, `r falls as Z`, `Na+ Mg2+ Al3+` | paths 330, drawDone 18, Replay enabled |
| ionisation-enthalpy | `dc9ce73d-5caf-4c45-a49f-11322420f94a` | `Be>B`, `899>801 kJ`, `N>O`, `1402>1314 kJ`, `not monotonic` | paths 282, drawDone 15, Replay enabled |
| electron-gain-enthalpy-and-electronegativity | `387b1127-86c8-41d0-8656-e99f47923e26` | `F egH -328`, `Cl egH -349`, `Cl more -`, `F EN 3.98`, `Cl EN 3.16`, `F higher EN` | paths 358, drawDone 19, plan ids egh_F, egh_Cl, en_F, en_Cl, Replay enabled |
| valence-oxidation-states-and-chemical-reactivity | `8cb37b95-2a9c-4e08-b127-f60bd1d07b41` | `valence 1`, `Na ox +1`, `not formal`, `not reaction` | paths 267, drawDone 14, plan ids valence_Na and ox_Na, Replay enabled |

Gate-ready 6/6. Controlled-provider fixture restore/replay-ready 6/6. Live-provider qualification remains blocked by the 402. Accepted 0/6. `accepted_by` stays blank. State stays `verification_pending`.

## Claude review and source repair, 2026-10-08

The same Claude Opus 5.5 high pass opened the six periodicity pairs. Modern law, helium, and the electron-gain comparison passed. Ionic radii failed for a missing `pm` and the cut label `r falls as Z`. Ionisation enthalpy failed because the molar values were labelled `kJ`. Valence failed because the figure said `Na ox +1` while the given line said `ox(Na,NaCl) = 1`. The library titles "Circle geometry" and "Photosynthesis" come from `TOPIC_PATTERNS` in `apps/tutor/lib/boards/boardTitle.ts`, not from the fixture.

Source now labels `102>72>54 pm`, `171>140>133 pm`, and `r falls, Z rises` (16 characters). The ionisation labels are `899>801 kJ/mol` and `1402>1314 kJ/mol`. The title rules keep a real circle and a real photosynthesis question, and they leave ionic radius and elemental oxygen alone. The given writer keeps a source-text plus. `periodicPlacement.ts` and `periodicReactivity.ts` were not edited. `periodicSize.ts` sha256 is `691de66fdf7114ccb66095ace57a7ffd6b269737bd94156930f6154823041478`. `verify-c09b-size` and `verify-c09-periodicity` passed with the C-08 gates listed in that log.

The v2 screenshots still show the old labels and the two wrong titles. They were not overwritten. Nothing is listening on 3027, and the disposable `heytutor_c03` database was not up, so those boards were not recaptured. Accepted stays 0/6. Remaining variants that were not failed: the modern-law board does not print the full sentence that properties are a periodic function of atomic number, and the electron-gain board does not print an explicit "electron-gain enthalpy is not electronegativity" label. The numbers and the distinction are on the paper.
