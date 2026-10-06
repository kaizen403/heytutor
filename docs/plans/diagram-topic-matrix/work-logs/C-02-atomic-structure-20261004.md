# Packet completion log: C-02 / atomic-structure-20261004

## Assignment and source contract

- Worker and integration owner: chemistry lane, same session that accepted Chemical Bonding. Accepted by Rishi Vhavle.
- Worktree: `/Users/kaizen/heytutor`. Chemical Bonding stays on this baseline. The maths/physics checkout at `/Users/kaizen/heytutor-claude-coord` was not edited.
- Packet: C-02a, C-02b, C-02c. Exact topic IDs, all six `chemistry|2` rows.
- Frozen profile: `2026-10-02-topic-matrix-v1`; JEE Main 2026 Paper 1; JEE Advanced 2026; NEET 2026.
- Allowed paths: `packages/scene-engine/src/chemistry/atomicRadiation.ts`, `packages/scene-engine/src/chemistry/hydrogenicRadial.ts`, `packages/scene-engine/src/chemistry/orbitalBox.ts`, `packages/scene-engine/scripts/verify/verify-c02-atomic-structure.ts`. Bohr orbit and transition authorities were read, not edited. No shared compiler, IR, solver, family synthesis, persistence, replay, or presentation seam was rewritten.
- Chemical Bonding evidence is unchanged: 7/7, VSEPR `accepted_at` 2026-10-03T21:53:43Z, the other six 2026-10-04T00:13:58Z.

## Changes and checks

Figures stay on the existing `chem_orbital` family. `orbitalBox.ts` dispatches a radiation/Bohr/de Broglie/uncertainty stem, then a hydrogenic radial stem, then declines an impossible quantum-number tuple, then keeps the existing box, shape, and ladder builders. A matched cue that cannot be grounded returns nothing rather than falling through to another figure.

Changed files:

- `packages/scene-engine/src/chemistry/atomicRadiation.ts` (new)
- `packages/scene-engine/src/chemistry/hydrogenicRadial.ts` (new)
- `packages/scene-engine/src/chemistry/orbitalBox.ts`
- `packages/scene-engine/scripts/verify/verify-c02-atomic-structure.ts` (new)

Independent oracles, written in the verify script and not imported from the builders:

- `E = h*nu` and `E = hc/lambda`, with `h = 6.62607015e-34 J s`, `c = 299792458 m/s`, `1 eV = 1.602176634e-19 J`.
- `K = E - phi` only when both are stated and `E` is at least `phi`. No invented work function. No negative `K`.
- Hydrogen `E_n = -13.6 Z^2/n^2` eV and `r_n = 0.0529 n^2/Z` nm. A transition is discarded unless `deriveBohrTransition` agrees within `1e-6` eV. A radius is discarded unless `deriveBohrOrbit` agrees within `1e-9` nm. Line count is `n(n-1)/2`.
- `lambda = h/p`. Electron mass `9.109e-31 kg`. Uncertainty comparison uses `hbar/2 = 1.054571817e-34 / 2`.
- Hand occupancy, not read back from the drawer: Cr `[Ar] 3d5 4s1`, 24 electrons, 6 unpaired; Cu `[Ar] 3d10 4s1`, 29 electrons, 1 unpaired; Fe2+ `[Ar] 3d6`, 24 electrons, 4 unpaired; Fe3+ `[Ar] 3d5`, 23 electrons, 5 unpaired.
- Hydrogenic shapes use the standard atomic-unit formulae. `4*pi*r^2*|psi_1s|^2 = 4 r^2 exp(-2r)`. The 2s radial node is `r = 2 a0`. Radial probability is 0 at `r = 0`.

Commands, from `packages/scene-engine`:

- `pnpm exec tsx scripts/verify/verify-c02-atomic-structure.ts` → `C-02 atomic structure: all checks passed` (re-run after the wavelength case and the radial axis-label change).
- `pnpm exec tsx scripts/verify/verify-chemistry-families.ts` → ok (families=13 of 13, draws=174, declines=47, physics stems kept out=8, bank regressions=19).
- `pnpm exec tsx scripts/verify/verify-level-relation-source-hey88.ts` → directedExamples 4, indexedCollections 6, atomicDeclines 9.
- `pnpm exec tsx scripts/verify/verify-chemistry-subject.ts` → ok (15 chemistry, 18 not chemistry).
- `pnpm exec eslint` on the three chemistry sources and the new verify script → exit 0.
- `pnpm exec tsup src/index.ts --format esm --dts` → dist rebuilt so the tutor bundle includes the new modules. `--clean` was not used.

Text-only declines, separate from the drawn figures: missing work function; explain-only photoelectric (that stem stays off `chem_orbital`); reversed emission; a two-electron helium atom; momentum 0; a claim that position and momentum are both known exactly; impossible `(n, l, m_l, m_s)`; identical spins in one orbital; a request to draw the electron's path.

## Live path

Isolated tutor on `http://127.0.0.1:3017`, database `heytutor_c03`. The owned process was restarted after the scene-engine rebuild so the turn route recompiled with the new bundle. Signed in as the dev student. Each lesson was compiled through `selectVerifiedRepresentation`, canonicalized, and posted to `/api/boards/:id/turns`. Each saved turn is `visual_status` `validated`, `qualitative_verified`, `diagramResultStatus` `ready`, `source.chemistryFamily` `chem_orbital`. No audio file was uploaded.

| Topic | Board | Turn | Reopen and finished replay |
| --- | --- | --- | --- |
| electromagnetic-radiation-and-photoelectric-effect | `268e1fbb-2d5e-400d-8335-5d0619fb18e4` | `fef54fcc-3ec4-4989-b91f-57d4ef8627a7` | `phi=2.30 eV`, `E=6.20 eV`, `E = h*nu`, `K=3.90 eV`, kinetic-energy arrow. Replay finished and those marks returned. |
| hydrogen-spectrum-and-bohr-model | `fc845127-e4c6-406f-945f-b41a922409c3` | `7493c27d-db74-427e-9328-9ff240f0348b` | `n=2`, `E2=-3.40 eV`, `r2=0.212 nm`, `Bohr model`, `not a path`. Replay finished and those marks returned. |
| de-broglie-and-heisenberg | `6dbf1ec8-d9cc-4656-a00e-d49446552317` | `0b821a19-597c-4f20-adc2-1da360ee513d` | `lambda = h/p`, `L=0.364 nm`, `h in J s`. Replay finished and those marks returned. |
| quantum-numbers-and-orbital-shapes | `9d3408fb-f115-4dba-868d-fcd9ccad9fd9` | `b09980e5-02a6-4b35-bb26-27f5b0b4323f` | `3p`, `+`, `−`, `nodal plane`, `radial nodes: 1`, `phase not charge`. Replay was watched drawing the radial-node label and finished with those marks. |
| electronic-configuration-and-filling-rules | `d80ed06c-6557-41ce-b710-af408afe6b06` | `fda63a19-4427-422d-be58-60449e5ef26a` | Cr, five 3d boxes and one 4s box, each with one electron, `[Ar] 3d^5 4s^1`, `6 unpaired`, `μ = 6.93 BM`. Replay finished and those marks returned. |
| quantum-mechanical-model-and-orbitals | `7aac9cca-e6ef-412f-9b9f-a161fa757c42` | `2d22b4de-138f-4904-9ac7-bb70c91b699a` | Upper band `psi 2s`, `|psi|^2 2s`, `radial 2s`, `node r=2a0`, `sign change`. Lower band `psi 1s`, `|psi|^2 1s`, `radial 1s`. Also `P(0)=0`, `not a path`, `radial norm 1`. Replay was watched drawing the upper curve and finished with those marks. |

An earlier radial board, `67cb4894-2b7b-4824-af45-da1d4d60d9fd` turn `dcbca22e-6321-4547-9315-4b03dd6d513a`, placed the axis words `1s` and `2s` beside the lower plot. That board is superseded. The qualified board uses `r` on the axes and names the orbitals in the side labels.

Lecture audio was not tested. No audio part was posted, and the C-03 S3 session was expired. Do not treat these replays as spoken-audio verification.

## Per-topic outcomes

| Exact topic ID | Exam/model variants checked | Tier / text-only reason | Proposed state | Evidence links | Remaining variants or blockers |
| --- | --- | --- | --- | --- | --- |
| chemistry\|2\|electromagnetic-radiation-and-photoelectric-effect | Frequency 1.5e15 Hz with phi 2.3 eV gives K=3.90 eV. Wavelength 400 nm with phi 2.0 eV matches hc/lambda. Photons of 2.0 eV against phi 4.0 eV say no emission and draw no K. A missing work function draws nothing. The numberless explain-only stem stays off this figure. | qualitative_verified | accepted | this log; turn `fef54fcc-3ec4-4989-b91f-57d4ef8627a7` | none |
| chemistry\|2\|hydrogen-spectrum-and-bohr-model | Hydrogen n=2 energy and radius. He+ n=2 to n=1 photon. n=4 line count 6. Reversed emission and a two-electron helium atom decline. The shared "emits a photon... draw the energy level diagram" sentence keeps its existing ladder. | qualitative_verified | accepted | this log; turn `7493c27d-db74-427e-9328-9ff240f0348b` | none |
| chemistry\|2\|de-broglie-and-heisenberg | Electron at 2.0e6 m/s. Momentum 0 declines. Exact position and momentum together decline. Position 1e-10 m and momentum 1e-24 kg m/s is above hbar/2. | qualitative_verified | accepted | this log; turn `0b821a19-597c-4f20-adc2-1da360ee513d` | none |
| chemistry\|2\|quantum-numbers-and-orbital-shapes | 3p shape, phase signs, nodal plane, radial nodes n-l-1 = 1. Impossible n/l, m_l, and identical spins decline. n=3 ladder is 9 orbitals and 18 electrons. Angular node count is in the caption (`angular nodes = l`). | qualitative_verified | accepted | this log; turn `b09980e5-02a6-4b35-bb26-27f5b0b4323f` | none |
| chemistry\|2\|electronic-configuration-and-filling-rules | Cr live boxes. Cu, Fe2+, and Fe3+ checked against the hand oracle, including 4s removed before 3d. Identical spins decline. | qualitative_verified | accepted | this log; turn `fda63a19-4427-422d-be58-60449e5ef26a` | none |
| chemistry\|2\|quantum-mechanical-model-and-orbitals | 1s and 2s psi, density, and radial probability on separate bands, 2s node at r=2 a0, radial probability 0 at the origin, sign change, not a path. A classical path request declines. | qualitative_verified | accepted | this log; turn `2d22b4de-138f-4904-9ac7-bb70c91b699a` | none |

## Recorded model limits

These are boundaries of the accepted figures, not open topic rows:

- Bohr vertical gaps are ordinal so pinned energy labels do not collide. The caption says so. Energies are the labels.
- Transition wavelengths use `hc/E` from the 13.6 eV convention, checked against the Bohr authority before drawing.
- A photoelectric kinetic energy is drawn only when both the photon energy and the work function are stated. Stopping potential is that kinetic energy in eV, not a separate voltage axis.
- The 2s curves are drawn 2.5 units above their own zero line. The 2s density curve is multiplied by 10 so its shape is visible. Neither factor is part of the function. Both `r` axis labels sit beside the lower plot; the side labels name 1s and 2s.
- Levels outside 1..8, multi-electron wavefunctions, and two-electron atoms are not drawn.
- Shared hydrogen energy-level sentences and the numberless photoelectric explanation stay on their existing paths.

## Handoff

Ready rows: 6/6. Fully accepted rows: 6/6. Chemical Bonding remains 7/7.

No shared seam patch. The next integration step is to review this chemistry-only diff on its own. Do not merge it into the concurrent maths/physics checkout, and do not start another chemistry chapter from this packet.

Publication: uncommitted. No commit, push, or PR.

## Bounded review before Chemical Thermodynamics

Reviewed 2026-10-06, before C-04. The four Atomic Structure files were not re-audited as a chapter, and the photoelectric, Bohr, de Broglie, 3p, and chromium boards were not replayed again.

The 2s band is drawn 2.5 units above its own zero, and the 2s density is multiplied by 10 so the shape is visible. Both facts were only in the caption annotation, which is not board ink, so a student could read the raised curves as physical values. The figure now carries pinned labels `lifted +2.5` and `dens drawn x10`. The wavefunction expressions are unchanged. `verify-c02-atomic-structure.ts` requires both labels and passed.

Frozen sha256:

- `packages/scene-engine/src/chemistry/atomicRadiation.ts` `c809fa01d412bb6ffa53b2403cf7f1bf9fccde48a032481f99580f77ebcd5ae9`
- `packages/scene-engine/src/chemistry/hydrogenicRadial.ts` `b19ee1b4dc89b351586fc2277c414183b4596875ade532ff9dd082d49cb0ca6d`
- `packages/scene-engine/src/chemistry/orbitalBox.ts` `671bab5210ecb8c8043515b98a0fd4d7e9908923828e3ab8e0b8ebd9ae0cb0e7`
- `packages/scene-engine/scripts/verify/verify-c02-atomic-structure.ts` `420d13895f2a0a425184a5eb2908fe8cba98a9e200febb45f779055b087cbd0c`

The disclosure was saved and replayed on board `bae5bd28-7292-491c-9c3b-14da1a660074`, turn `a2528bfe-63a1-4a4b-8fa6-cd513246d9c9`. A fresh page load showed `lifted +2.5` and `dens drawn x10` beside the 2s labels. Replay drew the curves and finished with those labels, `node r=2a0`, `P(0)=0`, `not a path`, and `radial norm 1`. The earlier radial board `7aac9cca-e6ef-412f-9b9f-a161fa757c42` predates the visible labels. Acceptance of the six Atomic Structure rows is unchanged. Lecture audio was still not tested.
