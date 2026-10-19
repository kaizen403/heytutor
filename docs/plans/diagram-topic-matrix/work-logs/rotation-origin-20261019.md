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
