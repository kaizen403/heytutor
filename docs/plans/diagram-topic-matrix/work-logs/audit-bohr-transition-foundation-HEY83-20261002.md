# Independent Bohr-transition foundation audit — HEY-83

Audit date: 2026-10-02 UTC. HEY-83 is a read-only auditor. HEY-88 is the implementation/integration owner; HEY-85 holds the isolated slot-2 foundation assignment. This receipt is not source-cohort, shared-consumer, prerequisite, topic, render, live, persistence or saved-replay acceptance. No submission/shared source, worker log, ledger or counter was edited by the auditor.

## Reviewed submission and reproduction

Worktree: `/Users/kaizen/.capy/worktrees/jam_01M3Z10WD1WZKTPRNE3PN2KEFK/heytutor`.

- `packages/scene-engine/src/physics/bohrTransitionAuthority.ts`: SHA256 `782fe2d73a6ae76520854f32d5b7a4f8489ca67a3da928dd75f697ba1432b79e`.
- `packages/scene-engine/scripts/verify/verify-bohr-transition-authority-hey85.ts`: current SHA256 `76f07003908a487cd83a00a89c14929c8b6f192145c6dfbdd40b3a86e4e1a9fd`. This differs from the earlier reported gate hash `b4c5ef7bba5e8ede0361e7ce2e8e9e6535524df0e794321b05fceaf027dd51cb`; the source hash matches the submitted source.
- Independently executed `PATH=/opt/homebrew/bin:$PATH pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-bohr-transition-authority-hey85.ts`: exit 0, **40,320 bounded ordered level/Z cases; 645,233 reported core checks**, then **257 synthetic holdout cases; 4,112 checks; seed 20261002**. The worker's earlier 645,231 core-check count is not the current observed count.
- Independent public-seam probe: `/Users/kaizen/.capy/work/diagram-topic-matrix/audits/bohr-public-seam-review.mts`; captured result: adjacent `bohr-public-seam-review.json`. Executed from the worker worktree with `pnpm --filter @heytutor/scene-engine exec tsx <absolute-probe-path>`: exit 0 after correcting the auditor's scratch cleanup to use `Object.hasOwn` on its saved descriptors. The initial cleanup failure was in the probe, not in the submission. All prototype changes were confined to a disposable Node process and restored by the successful probe.

The gate has a BigInt-rational oracle for level energies and the independently expressed ordered difference, including the exact SI elementary-charge constant. It exercises reversal, hydrogenic Z scaling, one explicit J-source equivalence case, frozen outputs, unsupported fields/model/units, bounds, underflow and overflow. Its exhaustive grid and seeded variable-B holdout assume the same Z=1 binding-coefficient convention. A synthetic numerical holdout is not an exam/source holdout, and does not decide that source convention.

## Finding 1 — binding-energy calibration must be explicit before consumer readiness

The approved owner record says explicit ground binding-energy/unit; the API field is `bindingEnergy` and its rejection message says “supplied ground binding energy.” However source lines 73–75 derive `-bindingEnergy * (Z/n)^2` and `bindingEnergy * Z^2 * (nTo^2-nFrom^2)/(nFrom^2*nTo^2)`. These are correct if the binding energy is a reference-Z=1 coefficient, not the ground binding energy of the declared ion. That reference convention is not represented by an input field or named by the API.

Public-seam reproduction with an actual declared-ion ground binding:

| Input/quantity | Observed | Required under the declared-ion ground-binding interpretation |
| --- | --- | --- |
| one electron; Z=2; nFrom=3; nTo=2; bindingEnergy=54.4 eV | Accepted frozen authority, emission | An explicit ground binding B for the specified ion means E_n=-B/n². |
| energyFrom | -24.177777777777777 eV | -6.044444444444444 eV |
| energyTo | -54.4 eV | -13.6 eV |
| photonEnergy | 30.22222222222222 eV | 7.555555555555555 eV |

This is a **source-normalization contract blocker**, not a finding that the reference-Z=1 arithmetic is wrong. Z=1 cases cannot expose it; gate cases using B=13.6 and Z=2 only confirm the reference convention. A consumer that supplies a question's actual He+ ground binding of 54.4 eV can silently apply Z² twice.

HEY-88 must choose and encode the convention: name/require a reference-Z=1 binding coefficient, use the actual declared-ion ground binding without another Z² factor, or require a reference charge and normalize explicitly. The caller may not guess which a supplied source B means. Add distinguishing Z>1 source cases, including actual-ion and reference-coefficient quantities and J equivalence. HEY-85 may refine its approved isolated module/gate after this owner decision; shared source extraction remains owner-only.

## Finding 2 — required fields need own-source membership

Source lines 51–63 reject unsupported own keys and nonstandard prototypes, but read required fields through `raw.model`, `raw.Z`, etc. There is no required-own-field check. The independent probe temporarily places exactly the seven required defaults on `Object.prototype`, then calls `deriveBohrTransition({})`. The input has **zero own keys**, yet returns a frozen hydrogen 3→2 emission authority with photon energy 1.8888888888888888 eV.

This is conditional on a polluted prototype; no live pollution or exploit is claimed. It nevertheless breaks the explicit-source/no-guessed-fields contract. Reject missing own required fields before reading them; add an inherited-default negative regression with cleanup. Rejecting `Object.create(customPrototype)` alone does not cover the ordinary `Object.prototype` case.

## Disposition and remaining obligations

Both findings and the exact reproduction paths were delivered to HEY-85 and HEY-88. The two approved files remain unmodified by HEY-83. Their corrections need fresh hashes and rerun independent review; the public-seam contract is not ready for acceptance at this snapshot.

Within the intended reference-Z=1 convention, no new arithmetic/direction/SI defect was demonstrated by this review's gate and direct probes. That bounded statement does not establish all J-source magnitudes, an independently frozen exam cohort, complete atom/spectrum variants, or correction of the known shared family/detect/fallback defect.

Unaccepted S2/S3, complete CH23a variants, source-grounded shared compiler behavior, readable labels, live Konva reveal, actual saved-turn persistence and saved-turn replay remain open. Offline deterministic computation is not saved replay. No accepted topic IDs or chapter-counter transition is recorded.

## Revised submission — both public-seam findings resolved at the numeric-module boundary

HEY-85 supplied the owner-approved refinement with source SHA256 `9411a87fe8afe1d882ee80cfc34dab682c990f398d54f47306a6022da6105da6` and gate SHA256 `5d1be58c156eb08d905a01f71312436f87a0a5553194b334af61cba791c3533f`. HEY-83 read the new source, checked both hashes before and after execution, and reran the dedicated gate: exit 0; 40,320 bounded ordered/Z tuples, **887,167 reported core checks**; 257 synthetic holdout tuples, **5,654 checks**. Both conventions are tested per tuple. The hashes remained unchanged during this rerun.

The input now requires an own `bindingEnergyConvention` field equal to `hydrogen_reference` or `ion_ground`. The former applies Z²; the latter does not. The convention is retained in the frozen result. All eight required input fields must be own properties before their values are read.

Independent correction probe: `/Users/kaizen/.capy/work/diagram-topic-matrix/audits/bohr-revised-public-seam-review.mts`, with adjacent captured JSON. The same direct tsx invocation exited 0 and matched the revised hashes before/after the probe. It independently confirms:

- Actual He+ ground binding 54.4 eV, Z=2, 3→2, `ion_ground` returns photon **7.555555555555555 eV** and final energy **-13.6 eV**. Hydrogen-reference 13.6 eV with Z=2 returns the same energies under its explicitly different source convention.
- A J-source actual-ion binding agrees with the canonical eV-to-J result; reversal to 2→3 preserves photon magnitude and reverses signed atomic delta.
- The old ambiguous input without the convention rejects. Under temporary prototype defaults, the empty input and each of eight missing-own-field inputs reject: **9 independently tested cases**. The disposable probe restores its prior prototype descriptors.

**Finding 1 and finding 2 are resolved for this exact revised numeric-module snapshot.** This permits owner review of that bounded prerequisite; it is not shared consumer readiness or topic/S2/S3 acceptance. A consumer must source-ground the convention instead of choosing a default merely to satisfy the schema. The original shared family/detect/fallback, readable-label, live, persistence and saved-replay obligations remain independently open.
