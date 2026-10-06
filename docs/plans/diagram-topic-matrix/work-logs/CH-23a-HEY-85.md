# Packet completion log: CH-23a / HEY-85

## Current DCP-10 foundation submission — HEY-88 slot 2

**Proposed foundation state: `integration_pending`. No topic or S2/S3 seam is accepted.** This current submission supersedes the historical no-runtime/no-gate permission below only for the two paths named here. The earlier audit/reproduction record is retained rather than overwritten.

### Assignment and source contract

- Current global integration owner: HEY-88, `jam_01M3Z9CRVNHPDQYTZ8ASFG7SRS`, replacing the prior Cursor owner under Kaizen's explicit continuation. Actual recorded approval read: `/Users/kaizen/heytutor/docs/plans/diagram-topic-matrix/work-logs/integrator-DCP05-12-HEY88-20261002.md`, SHA-256 at approval `f09533e92b0966609ca80253046657abe43d1adf52a41049508c0628d5d266e5`. It assigns `SLOT RELEASED AND ASSIGNED` slot 2 to this finite foundation. No extra workers.
- Worktree/base: unchanged isolated `/Users/kaizen/.capy/worktrees/jam_01M3Z10WD1WZKTPRNE3PN2KEFK/heytutor`, `eec2d36b151cf4950c9fcfadd7840f53b26415ec`; local date 2026-10-03 / UTC 2026-10-02.
- S0, taxonomy and assignment checksums remain those recorded below. The four exact CH-23a topic IDs remain the traceability envelope; this assignment implements only the ordered bound-state/photon numeric prerequisite, not full topic evidence. Main/NEET listed and Advanced listed/application distinctions are preserved. No question cohort/holdout or text-only decisions were invented.
- Approved source/gate paths: NEW `packages/scene-engine/src/physics/bohrTransitionAuthority.ts`; NEW `packages/scene-engine/scripts/verify/verify-bohr-transition-authority-hey85.ts`. Allowed additional edits: only this log and `CH-18-25-handoff-HEY-85.md`. No shared compiler, document, capability, index, planner, family selection, parser, other gate, ledger or Drive edits.
- Explicit input class: structural `model="bohr_hydrogenic"`, `electronCount=1`, integer `Z` 1–10, ordered distinct integer `nFrom`/`nTo` 1–64, supplied positive numeric `bindingEnergy`, **required own** `bindingEnergyConvention="hydrogen_reference"|"ion_ground"`, and case-sensitive `energyUnit="eV"|"J"`; an optional declared emission/absorption must agree. Every required field must be OWN, not an inherited default. No guessed calibration, 13.6 eV coefficient, radius, material, ion label, photon energy or source evidence. The eV-to-J factor `1.602176634e-19` is an exact SI unit conversion, not a default binding-energy scale.
- Numeric domain: source binding energy and every derived level/delta/photon value in source units and canonical joules must be finite, nonzero normal doubles (magnitude at least `2^-1022`); unsupported strings/wrappers, extra fields, multi-electron models, subnormal/unresolved values and overflow reject. This is bounded model arithmetic, not experimental atom/trajectory certification. Finite high-magnitude results are retained without an unnecessary intermediate overflow.

### Changes and checks

- Independent HEY-83 review found two blocking holes in the superseded first submission: its `bindingEnergy` name/contract did not distinguish a Z=1 reference coefficient from the actual declared ion ground binding, allowing a factor-of-Z² misinterpretation; own-key validation also did not require presence of each required own field. Owner HEY-88 explicitly approved the convention amendment and own-field fix in its agent message before these changes. Final code requires and retains `bindingEnergyConvention`: hydrogen-reference B applies Z², ion-ground B applies no extra Z². Missing/unknown convention rejects. All required fields are checked with `Object.hasOwn` before reading values. HEY-83's original independent receipt is `audit-bohr-transition-foundation-HEY83-20261002.md` in main; its original findings apply to the superseded hash, not proof of readiness for the revised hash.
- Distinguishing calibration evidence: supplied actual He+ B=54.4 eV, Z=2, 3→2 gives photon 7.555555555555555 eV and final level −13.6 eV; supplied reference B=13.6 eV with Z=2 gives the same values. Actual He+ binding in joules agrees; supplied Li2+ B=122.4 eV gives the independent 5→2 photon 25.704 eV. Every core/holdout tuple also compares independently supplied actual-ion binding against the reference calibration. The gate's isolated Node child temporarily defines required defaults on Object.prototype, checks an empty object and each missing own field reject, then restores/verifies every original descriptor; parent prototype state is untouched.
- Final independent recheck: HEY-83 verified source `9411a87...` and gate `5d1be58...` hashes before/after its full rerun, independently reproduced both calibration conventions, actual-ion J equivalence, absorption reversal, missing convention, and all nine empty/missing-own inherited-default cases. Its revised receipt, read by HEY-85 at `/Users/kaizen/heytutor/docs/plans/diagram-topic-matrix/work-logs/audit-bohr-transition-foundation-HEY83-20261002.md`, explicitly resolves both original findings at this exact numeric-module snapshot. That independent module disposition is not shared-consumer readiness, S2/S3/topic acceptance, rendered/live evidence or saved replay; the consumer must ground the convention in source rather than default it.
- Public seam: `deriveBohrTransition(raw: unknown): Readonly<BohrTransitionAuthority>`, with exported input/result types for the integration owner. It retains ordered source/model metadata, derives `energyFrom`, `energyTo`, signed `atomicDelta` and positive `photonEnergy`, and supplies canonical joule values. A frozen result prevents accidental replacement of derived authority. It emits no scene or diagram marks and selects no topic/family.
- Independent references: integer/BigInt rational level energies and squared-level differences, exact integer-rational SI conversion, literal Lyman/Balmer/Paschen/He+ worked examples, independent Rydberg wave-number/frequency relations, transition reversal, unit consistency and conservation. Runtime uses a cancellation-resistant factored difference; the oracle uses integer-rational squared-level differences. Closure is checked at `64 * EPSILON * max(|Efrom|, |Eto|)`; gate numeric comparisons use relative `2e-13`, with no unit-hiding absolute floor.
- Positive/edge IDs: ordered `(Z,nFrom,nTo)` grid at B=136/10 eV, covering all 40,320 pairs for Z=1–10/n=1–64 with unequal levels; explicit Balmer 3→2 and absorption 2→3, Lyman 2→1, Paschen 4→3, He+ scaling, joule-source equivalence, absent optional direction, small normal outputs and representable large-source outputs.
- Invalid/mutation cases: missing every required field; wrong/multi-electron model; zero, fractional, negative, excessive, string, wrapped or nonfinite Z/n; equal levels; zero/negative/subnormal/overflow binding source; unsupported/case-wrong units; reversed ordered levels with a stale emission claim; contradictory or undefined declared direction; extra/stale computed answers; unsupported radius/temperature/question-ID fields; hidden symbol fields; unresolved canonical outputs. Numeric derivation throws before returning a result; **shared atomic scene rejection remains owner integration work**, not a claim made from this unit seam.
- Synthetic holdout IDs: seed `20261002`, indices 0–256, 257 variable-binding rational cases distinct from the fixed-binding grid. This is a bounded synthetic arithmetic holdout, **not an independently frozen exam/source cohort**.

Exact final commands (all use `export PATH=/opt/homebrew/bin:$PATH`):

| Command | Final result |
| --- | --- |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-bohr-transition-authority-hey85.ts` | Exit 0: 40,320 core tuples checked under both calibration conventions / 887,167 checks; 257 synthetic holdout tuples under both conventions / 5,654 checks. |
| Same command with `--holdout-only` | Exit 0: standalone 257-tuple / 5,654-check holdout; the same prerequisite invalid/worked/prototype-child checks also run. |
| `pnpm --filter @heytutor/scene-engine typecheck` | Exit 0, including the new source. |
| `pnpm --filter @heytutor/scene-engine exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --strict --skipLibCheck --esModuleInterop --types node --typeRoots ../../apps/tutor/node_modules/@types scripts/verify/verify-bohr-transition-authority-hey85.ts` | Exit 0, dedicated gate plus source types using existing repository dependencies. |
| `pnpm --filter @heytutor/scene-engine lint` | Exit 0, four pre-existing DSA unused-variable warnings, no errors. No DSA edits. |
| `pnpm --filter @heytutor/scene-engine exec eslint scripts/verify/verify-bohr-transition-authority-hey85.ts` | Exit 0, dedicated gate lint. |
| `pnpm --filter @heytutor/scene-engine build` | Exit 0, ESM/declarations. Public package entry is intentionally unchanged; owner must integrate/import this new source before the tutor can consume it. |

Final local raw outputs: `/Users/kaizen/.capy/work/HEY-85/bohr-foundation-gate-final.log` and `bohr-foundation-checks-final.log`. Scratch files are outside the repository and not runtime dependencies.

Development friction preserved: the initial one-case gate failed red with `ERR_MODULE_NOT_FOUND` before adding the module, then passed. The expanded gate caught an unnecessary unused `bindingEnergyJ` output rejecting a valid case whose actual level/photon outputs were normal; that unconsumed output was removed, retaining all invalid/normal-domain checks. A manual NodeNext gate typecheck initially failed because this repo uses bundler resolution and Node types are in an existing app dependency; rerun with repository conventions exposed and corrected the new gate's `assert.throws` overload. No pre-existing tests were edited, weakened or deleted.

Final hashes:

- Source `9411a87fe8afe1d882ee80cfc34dab682c990f398d54f47306a6022da6105da6`.
- Gate `5d1be58c156eb08d905a01f71312436f87a0a5553194b334af61cba791c3533f`.
- Isolated shared `familyScene.ts` remains `07e44aa2329b8e5c62be87eb07b00044cb6e2ef0494287b69158f7cb6a96dec2`; `archetypes/detect.ts` remains `2f0497dc56bf610b70056ae643736d25670ecfec362415fbb1264790e18a9cee`.

Render/live/reveal/persistence/replay: **not supplied by this pure scalar foundation**. It does not fix the running family/detector by itself. HEY-88 owns the immediate consumer: serially copy/import the source, preserve ordered source levels and explicit model/scale provenance, replace/veto the fixed fallback, validate scalar labels/units and invalid scene candidates, inspect source-correct figures/reveal, and verify canonical saved-turn persistence/replay. Offline gate/build success is not saved replay or accepted coverage.

### Current per-topic outcomes

| Exact topic ID | Checked subset / tier | Proposed state | Remaining full-row obligations |
| --- | --- | --- | --- |
| physics\|18\|bohr-model-and-hydrogen-spectrum | One-electron supplied-scale level/photon arithmetic, ordered transitions, Z=1–10/n=1–64; numeric foundation only, no verified scene tier assigned. | integration_pending (partial foundation) | Structural source/assumption grounding, accepted prerequisite slice, Bohr-model labels, all requested objects/levels, atomic shared compile/label checks, rendered scene, live reveal, persistence and saved replay; valid outside-bound cases stay unsupported. |
| physics\|18\|hydrogen-spectral-series | Lyman/Balmer/Paschen numeric examples, both photon directions and independent Rydberg/frequency relation; no series router/scene implemented. | integration_pending (partial foundation) | Complete source-defined series scene, ionization/series limits beyond finite n, source-cohort/holdout, invalid scene/label mutations and full rendering/reveal/persistence/replay. |
| physics\|18\|bohr-orbit-radius-and-velocity | None beyond the earlier read-only mismatch diagnosis. | blocked | Explicit radius/speed authority, source/model limits, required scene and full lifecycle; not inferred from level energy or literal electron trajectories. |
| physics\|18\|rutherford-scattering-and-model | Earlier apparatus decline reproduced; no new implementation. | blocked | Source/collimator/foil/detector topology, impact-parameter paths and independent repulsion/quantitative relation where supplied, all lifecycle checks. |

### Handoff

HEY-88 has been sent the source API, approved paths, exact command results and initial hashes; final gate/log hashes are supplied with completion. HEY-83 was asked for read-only independent review, not a new worker. Foundation remains uncommitted in this worktree; no commit/push/PR/merge or new writing worker. Main ledgers and accepted topic/chapter counts unchanged by HEY-85. Next runtime packet requires HEY-88's explicit assignment; other CH-19–25 topic dependencies remain outstanding.

Integration-owner disposition of this submission: pending; no accepted topic IDs or seam acceptance inferred.

## Assignment and source contract

- Worker: HEY-85. Initial integration owner: Cursor session `b10f1489-5216-4a2d-9b0a-9b2ca6f2de33`; current global owner is HEY-88 as recorded in the latest submission above. This worker and HEY-83/84 are not global integration owners.
- Isolated worktree: `/Users/kaizen/.capy/worktrees/jam_01M3Z10WD1WZKTPRNE3PN2KEFK/heytutor`; clean detached base `eec2d36b1`; audit date 2026-10-02 UTC (local device 2026-10-03).
- Chapter workstream 18–25; this proposed packet: CH-23a, 4 exact topic rows below. CH-18 belongs to HEY-84 and is excluded from this packet.
- Planning/source reference: `2026-10-02-topic-matrix-v1`, Main Paper 1 / Advanced / NEET-UG 2026 as individually tagged below. This is **not an accepted evaluation-profile extension**. Listed/application/review/supplemental tags are preserved. No denominator, text-only or source-quality decisions were changed.
- Matrix checksum: physics.csv `03ce28161fe86e04450748a658cd38e431572d0ad7b31cfaa5c6f75104fbeac5`; local taxonomy matches index checksum `2d2a65ff89f4ce6aae9016c3a607dfb3d1f06a259a2313d1cf47db07a51a7510`.
- Prerequisites specified by all these rows: `S0; S2; S3`. No missing prerequisite was recreated or treated as accepted.
- Allowed edits exercised: this unique worker log only. No implementation/gate paths approved; shared compiler/document/capability/planner/source synthesis remain read-only. Central ledger, progress, root counters, main checkout and shared Drive untouched.
- Ownership/contract blocker: The unnamed local 6–10 integration session is not reachable through a known thread/contact. Its log scopes S0 to CH-06–10, not this assignment; no independently accepted DCP-01/02 source/evaluation profile for CH-18–25 is supplied. S2/S3 are existing seeds, not accepted complete prerequisite contracts. Three writing slots are asserted occupied. Implementation packet IDs, allowed paths, total budget and handoff have not been approved. No new implementation worker was started.
- Initial reproduction and reuse audit: Actual source-to-family/last-resort audit reproduced a wrong n=2→1 ladder for Balmer, n=3→2 emission and n=2→3 absorption. Family marks all three qualitative_verified; last-resort marks question_representation. Rutherford apparatus source declines. See detailed CH23A case evidence below. Shared synthesis/detection changes are owner-only.

## Changes and checks

### Global owner disposition received

Latest amendment read after HEY-83's CH-14a integration notice: the same authoritative owner handoff now frees slots 1 and 2 but leaves them **unassigned**, retains slot 3 for CH-14a `verification_pending`, and explicitly gives HEY-85 no released slot or approved packet. The earlier three-occupied-slots statement below is historical. Unaccepted S2/S3, owner-only Bohr fixes and the prohibition on an HEY-85 gate remain unchanged. Free capacity does not authorize a writer; no runtime or shared files were edited.

Kaizen relayed the owner's reply, and HEY-85 read the actual approval record at `/Users/kaizen/heytutor/docs/plans/diagram-topic-matrix/work-logs/integrator-ch11-ch25-handoff.md` (local date 2026-10-03). Cursor `b10f1489-5216-4a2d-9b0a-9b2ca6f2de33` explicitly accepts global integration ownership for chapters 11–25. The S0 profile `2026-10-02-topic-matrix-v1` is extended to those chapters with the same taxonomy/assignment checksums and full base `eec2d36b151cf4950c9fcfadd7840f53b26415ec`. Topic IDs, exam tags, required variants and independent checks are frozen; no question cohort or holdout IDs are frozen, and diagram-need/text-only values remain hypotheses.

This supersedes earlier references in this log to an unknown owner or unapproved S0 scope extension. It does not accept S1, S2, S3 or S5. Existing source modules and gates remain seeds/baselines. **CH-23a is not approved**, and no other HEY-85 packet or runtime/gate path is approved. The shared Bohr defect is confirmed, but `familyScene.ts` and `archetypes/detect.ts` fixes stay with the owner. HEY-85 must not add a CH-23a gate.

Budget remains one owner plus three writing workers, all occupied by CH-06a, CH-07a and CH-08a. A submitted CH-08a log with 983 checks does not release its slot. No runtime writes or extra workers are allowed. Resumption requires an amended owner handoff explicitly naming an approved HEY-85 packet/paths, accepted prerequisite contracts and `SLOT RELEASED` for that packet. A slot release alone does not make CH-23a's S2/S3 prerequisites accepted.

Current per-topic outcome for all four CH-23a IDs below: **blocked on unaccepted S2/S3 and no approved packet/path/slot**, with all source-correctness and lifecycle obligations outstanding. Earlier row text about missing S0 refers to the initial audit and is superseded by this receipt. No acceptance/ledger/counter/Drive changes were made.

Submission contract is now explicit: worker logs propose pending/blocked states, remain uncommitted in the isolated worktree, and Kaizen relays their paths. The global owner alone copies approved files to main, integrates shared seams serially, and accepts only after independent/render/reveal/persistence/replay review. No offline pass closes those obligations. HEY-83/84 were notified of this disposition and the actual owner-record path.

### Owner contact update

Kaizen identified the 6–10 Cursor owner as `b10f1489-5216-4a2d-9b0a-9b2ca6f2de33` and clarified HEY-83 handles 0–6. Read-only transcript inspection at `~/.cursor/projects/Users-kaizen-heytutor/agent-transcripts/b10f1489-5216-4a2d-9b0a-9b2ca6f2de33/b10f1489-5216-4a2d-9b0a-9b2ca6f2de33.jsonl` confirms this session wrote the S0 integrator log and retained shared integration. Its latest recorded turn ended successfully; that does not establish current worker activity or a free writing slot. HEY-83 and HEY-84 were notified.

Tool discovery exposes no external Cursor message endpoint. The actual `~/.local/bin/cursor-agent --help` supports starting/resuming an agent, not a message-only send into this IDE session. No CLI resume, new agent, session-state edit or Cursor submission was performed. Required next action: Kaizen relays the existing CH-18–25 packet/source/path/budget handoff request to this owner and returns its decision. Owner identity is now resolved; approval and contact delivery are not.

- Changed file: `docs/plans/diagram-topic-matrix/work-logs/CH-23a-HEY-85.md` only for this packet. No runtime or dedicated gate added because required coordination is unavailable.
- Deterministic authority/reference obligations: full matrix checks in the per-topic table remain unresolved except explicitly identified baseline subsets above; no expected relation is inferred from primitive count or an operator-name match.
- Positive/parameter/edge/invalid/mutation/holdout status: inherited baseline checks are recorded below; new packet/source-cohort cases and held-out evaluation are not approved or passed. CH-23a diagnostic cases are recorded in that packet log, not credited here.
- `cd ~/.capy/drive/project-heytutor/diagram-coverage-plan && shasum -a 256 -c SHA256SUMS`: all 18 entries pass.
- `shasum -a 256 data/question-bank/syllabus-taxonomy.json /Users/kaizen/heytutor/data/question-bank/syllabus-taxonomy.json`: both `2d2a65ff89f4ce6aae9016c3a607dfb3d1f06a259a2313d1cf47db07a51a7510`.
- `export PATH=/opt/homebrew/bin:$PATH; pnpm install --frozen-lockfile --offline --ignore-scripts`: exit 0, pnpm 10.32.0, Node v26.7.0; no dependency-manifest/lock changes.
- `cd packages/scene-engine && pnpm exec tsx scripts/verify/verify-elasticity-operators.ts`: exit 0, 360 checks.
- `cd packages/scene-engine && pnpm exec tsx scripts/verify/verify-fluid-operators.ts`: exit 0, 288 checks.
- `cd packages/scene-engine && pnpm exec tsx scripts/verify/verify-thermodynamics-operators.ts`: exit 0, 496 checks.
- `cd packages/scene-engine && pnpm exec tsx scripts/verify/verify-instrument-labels.ts`: exit 0; caption/scale-label geometry, not full experimental method certification.
- `pnpm --filter @heytutor/drawing build && pnpm --filter @heytutor/scene-engine typecheck && pnpm --filter @heytutor/scene-engine lint && pnpm --filter @heytutor/scene-engine build`: exit 0; lint has four pre-existing DSA unused-variable warnings, no errors. DSA was not edited or separately verified.

These are read-only baseline/reuse checks on eec2d36, not new packet gates, frozen source cohorts, holdout passes, topic acceptance or full tutor validation.

- Render evidence: existing compile output was exercised by baseline gates, but no new packet render acceptance/gallery/label-inspection evidence is claimed.
- Live reveal, persistence and replay: not tested. These remain blockers; no production DB/credentials used.
- Shared integration: proposal pending actual owner identification, complete S0 and relevant seam acceptance, packet/path assignment, available writer slot and lifecycle handoff. This worker has no authority to update acceptance.

### CH-23a reproducible false-certification/completeness evidence

Scratch harness: `/Users/kaizen/.capy/work/HEY-85/ch23a-source-audit.mts`; results: `/Users/kaizen/.capy/work/HEY-85/ch23a-source-audit.json`. These are local artifacts outside the repository, not runtime dependencies or holdout fixtures. Case stems are explicit diagnostic inputs, not an independently frozen exam cohort.

Command: `export PATH=/opt/homebrew/bin:$PATH; pnpm --filter @heytutor/scene-engine exec tsx /Users/kaizen/.capy/work/HEY-85/ch23a-source-audit.mts` — exit 0, four source cases recorded. First `.ts` invocation failed because scratch defaults to CJS and drawing exports ESM only; renaming the scratch harness `.mts` fixed the environment mismatch. No repository code changed.

| Case | Independent expectation | Observed result |
| --- | --- | --- |
| CH23A-BALMER-01 | Balmer transitions terminate at n=2 from n>2; n=2→1 is Lyman, not Balmer. | `synthesizeFamilyScene`: qualitative_verified, n=1/n=2 levels with n=2→1 arrow. Last-resort: same figure, question_representation. |
| CH23A-EMISSION-32 | Requested n=3→2 downward transition; Bohr ΔE=13.6(1/4−1/9)=1.888… eV for hydrogen, not n=2→1 energy 10.2 eV. | Both pathways emit n=2→1. Detector selects from=3,to=2 but generatorFor(bohr_transition) is null; family discards these levels. |
| CH23A-ABSORPTION-23 | Requested n=2→3 upward transition absorbing a photon. | Detector sorts to from=3,to=2; both pathways emit n=2→1 downward arrow. |
| CH23A-RUTHERFORD-01 | Explicit alpha source, collimator, gold foil and detector; qualitative repulsion and apparatus must be complete. | No archetype match, family=null and lastResort=null; unsupported visual stays a gap, not legitimate text-only success. |

Root-cause evidence: `packages/scene-engine/src/synthesize/familyScene.ts:3834–3881` delegates to fixed `bohrLevelDocument` with n=1/n=2 and downward arrow, independent of question values. `packages/scene-engine/src/archetypes/detect.ts:878–887` sets from=max(levels),to=min(levels), losing emission/absorption order. The declared bohr_transition archetype has no executable generator in this checkout. Existing family-synthesis smoke gate `:440–447` asserts only tier/ink for a Balmer last-resort case, not its source series completeness; it must not be weakened or silently treated as acceptance.

Shared integration proposal (not applied): derive ordered initial/final levels, ion Z and model/source obligations through accepted structural source authority; use a reusable level/transition construction with checked E_n, photon ΔE sign and optional Rydberg relation, preserving scope and no question/chapter runtime router. The integration owner must serially replace/veto fixed fallback source contradictions and add dedicated atomic wrong-level/wrong-direction/omitted-source regression coverage. Until then do not accept any CH-23a topic from these cases. I cannot safely fix shared synthesis/detection/IR/planner registration without the owner's assigned paths.

No numeric labels are claimed to have rendered in these cases: the ΔE numbers above are independent oracle expectations, not observed output values. No live app or full persisted/replayed turn was exercised.

Independent peer reproduction: HEY-83 reran all four cases against current `/Users/kaizen/heytutor` (eec2d36 + concurrent uncommitted changes), obtained the same wrong family/fallback figures and sorted absorption slots, and confirmed the same root cause. Its local evidence is `/Users/kaizen/.capy/work/diagram-topic-matrix/audits/ch23a-independent-reproduction.json`; command `PATH=/opt/homebrew/bin:$PATH pnpm --filter @heytutor/scene-engine exec tsx /Users/kaizen/.capy/work/diagram-topic-matrix/audits/reproduce-ch23a.mts` exited 0. This confirms the finding is not limited to the isolated base; it is not owner approval or lifecycle acceptance.

## Per-topic outcomes

Scope column order J / A / N. Every row is a proposed blocked disposition, not a ledger edit. No complete topic is accepted.

| Exact topic ID | Exam/model variants checked | Tier / text-only reason | Proposed state | Evidence | Remaining variants or blockers |
| --- | --- | --- | --- | --- | --- |
| physics\|18\|rutherford-scattering-and-model | 2026 listed / application / listed; full variants unverified | null/declined; coverage gap, not text-only success | blocked | CH23A-RUTHERFORD-01 | Alpha source, collimator, foil and detector; impact-parameter trajectories. Independent checks: Verify repulsive scattering direction and supplied Rutherford relation if quantitative; schematic atom is not a literal size measurement. Source: J-PDF p.6 Physics U18; A-PDF p.16 Modern Physics; N-PDF p.7 Physics U18. Missing coordination/S0; prerequisite graph S0; S2; S3; full render/live/reveal/persistence/replay, negative/mutation/holdout acceptance. |
| physics\|18\|bohr-model-and-hydrogen-spectrum | 2026 listed / listed / listed; full variants unverified | observed qualitative_verified / question_representation are source-wrong; no acceptable tier | blocked | CH23A-EMISSION-32, CH23A-ABSORPTION-23 | Bohr hydrogen and hydrogen-like ions; allowed level transitions. Independent checks: Check En=-13.6Z²/n² eV under Bohr model and state domain; classical orbit model labels must be explicit. Source: J-PDF p.6 Physics U18; A-PDF p.16 Modern Physics; N-PDF p.7 Physics U18. Missing coordination/S0; prerequisite graph S0; S2; S3; full render/live/reveal/persistence/replay, negative/mutation/holdout acceptance. |
| physics\|18\|bohr-orbit-radius-and-velocity | 2026 application / application / application; full variants unverified | not assigned; no independent diagram-need/text-only freeze | blocked | baseline/reuse section only; not topic acceptance | Allowed orbit radii/speeds for hydrogen-like ions. Independent checks: Independently check rn∝n²/Z and vn∝Z/n; orbits are model schematics, not literal electron paths. Source: J-PDF p.6 Physics U18; A-PDF p.16 Modern Physics; N-PDF p.7 Physics U18. Missing coordination/S0; prerequisite graph S0; S2; S3; full render/live/reveal/persistence/replay, negative/mutation/holdout acceptance. |
| physics\|18\|hydrogen-spectral-series | 2026 listed / application / listed; full variants unverified | observed qualitative_verified / question_representation are source-wrong; no acceptable tier | blocked | CH23A-BALMER-01, CH23A-EMISSION-32, CH23A-ABSORPTION-23 | Lyman/Balmer/Paschen examples; emission/absorption and limits. Independent checks: Check transition ΔE=hf and independent Rydberg relation; no upward transition may be labelled spontaneous emission. Source: J-PDF p.6 Physics U18; A-PDF p.16 Modern Physics; N-PDF p.7 Physics U18. Missing coordination/S0; prerequisite graph S0; S2; S3; full render/live/reveal/persistence/replay, negative/mutation/holdout acceptance. |

## Handoff

- Fully accepted topics: none. Baseline support remains reusable; complete required variants remain unresolved above. This log does not change allocation or accepted counts.
- Owner action needed: review the relayed proposal; confirm S0 source/evaluation extension and accepted prerequisite slice; approve exact IDs, disjoint implementation/gate paths and total writing concurrency; provide accepted code/version and integration/lifecycle handoff.
- Next ready candidate for the 19–25 stream: a bounded CH-23a ordered hydrogen-level/transition slice may use planar source geometry, but it is only a proposal until S0/S2/S3, paths and a writing slot are agreed. CH-19a/19d require S5; S1 blocks thermal systems, photoelectric apparatus, electronics and experiments. Do not skip remaining dependency edges.
- Publication: all changes uncommitted; no branch, commit, push, PR or merge created. No extra workers spawned.

## Integration-owner disposition

Pending. No reviewer/acceptance timestamp, accepted topic IDs, central-ledger changes or chapter-counter transition has been recorded by this worker. Only the global owner may complete this section after independent/shared/render/live/replay review.
