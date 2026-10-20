# Rotation origin through production normalization

Owner: Sentry/hard-chapters lane. Base: main `6ca8b616a`. Offline only; $0;
no production change and no accepted-topic count update.

## Cause and change

`normalizeMechanicalPlannerArtifacts` converted a rotation construction's inline
`origin` into a point reference. Rotation operators deliberately require a
coordinate value, so the engine's own circular program failed after production
pruning with `invalid_rotational_motion_origin`. Preserve the value contract for
the rotation family, as for matrix constructions. External point references and
malformed origins remain invalid.

The circular source boundary now accepts either complete engine-generated form:
before pruning or after production pruning and validation. It compares the whole
quantity/construction/assertion/entity authority shape. It never prunes submitted
ink to conceal changes. Wrong radius, reversed sense and extra ink still fail.

Blind replay also exposed a domain mismatch: a plain circular state was offered
for SHM/projection questions. Those requests now stay outside this source reader's
existing supported domain; they need their own position law and construction.

## Evidence and limits

- New owned gate: 47 checks of engine synthesis → prune → validate → compile,
  torque array/object origins, source tampering, idempotence, malformed values,
  unrelated vector normalization, and SHM/projection controls.
- Removing the origin exemption makes the actual gate fail. Removing acceptance
  of the complete pruned engine form makes its source-boundary check fail.
- Existing UCM readiness: 399 checks; rotation operators: 526 checks. Engine
  build, typecheck and focused lint pass.
- All 60 recorded raw rotation-family candidates were replayed: neither main
  nor branch compiles them. Removing the origin error exposes independent label
  and output-kind failures; this is not counted as recovered coverage.
- Recorded source-program replay: 8,969 unique question/plan inputs, 52 eligible
  circular programs. Main admits 0 after production pruning; branch admits 38.
  Every changed distinct figure was judged blind. The retained figures exactly
  match the judged render hashes: 5 right / 33 partial / 0 wrong occurrences
  (1 right / 6 partial distinct). The other 14 occurrences (4 distinct) judged
  wrong for SHM/projection mismatch remain rejected. No baseline figure is lost.

This measures the source-program prune/validate/compile boundary, not a live
lesson or full chapter coverage. Remaining partials need additional force,
state, projection or change-in-velocity constructions; no unsupported marks are
invented to fill them. Private inputs, render keys and judgments stay outside git.

## 20 October review: unsupported laws retain numeric source authority

The SHM/projection producer veto also made the binding reader return no source.
A planner could omit the archetype marker and submit a reversed circular state
for a question that explicitly stated its radius, rate and rotation sense.
Separate the unsupported-law veto from the older topic exclusions. The producer
still declines these requests. The binding alone probes the stated numeric
circular state while ignoring that veto, then returns fatal
`ucm_source_unsupported` rather than releasing source authority. Older topic
exclusions, numeric parsing, and the verified circular-parts proof remain intact.

The merge with main retains both the verified circular-parts policy and the
comparison against the complete regenerated program after production pruning.
Submitted geometry is never pruned inside the source binding to hide a mismatch.

- Owned engine gate: 100 checks, including 12 unsupported planner candidates
  without source markers (four request forms, each with the plain program,
  reversed sense and internally consistent wrong-radius geometry).
- Owned production gate: 29 checks using the actual
  `validateProductionSceneCandidate`; all 12 unsupported candidates reject,
  and ordinary numeric circular controls keep their existing behavior.
- Removing the new binding veto makes both owned gates fail. The original
  coordinator compile reproduction also refuses every unsupported variant;
  its production reproduction refuses all 10 cases across five numeric stems.
- Source engine and application typechecks, and focused engine/application
  gate lint, pass.
  Existing UCM readiness 399, UCM identity 162, rotation 526, harmonic motion
  197, and verified circular-parts gates pass.

All checks above are local and use source modules; no build, model/provider call,
image generation or production change was made. Final combined-source four-
chapter and Oscillations replays, and blind review of any changed renders, remain
integration work. Earlier recorded replay totals are historical evidence, not a
claim that the final combined tree has already passed those replays. No accepted
topic count changes.
