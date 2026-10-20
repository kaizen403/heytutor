# Kimi physics operator inputs — 19 October 2026

Frozen main: `6ca8b616aae40c521e918837889aaf34ce96b587`. New model spend: **$0**.

The recoverable recorded responses justify one narrow reader change: an
`incline_friction` construction may omit its redundant working-unit block when
every declaration on each mass/gravity operand already states the SI working
unit. The compact planner contract also omitted three required display scales;
it now offers those keys and the working-unit block. No missing scale or physical
value is supplied.

The frozen replay changes **no recorded figure** and demonstrates no increase in
right figures. Fourteen chapters lack recoverable original scene inputs; this is
an all-chapter inventory, not a completed all-chapter scene replay.

## Source coverage

An inventory of 14,974 byte-deduplicated lab records found 8,338 physics records:
7,424 explicitly Azure, 649 explicitly Kimi, 29 dated before the provider switch
without model proof, and 236 with unknown provider. Only explicit Kimi model
provenance qualifies here. Of the 649 Kimi records, 566 have a chapter and 83 are
generic physics/eval rows. Historical records usually retained codes and selected
SVGs, rather than raw planner responses.

Recovery across lab records, trace exports, prepared corpora and frozen Harness 1
planner-probe captures yielded **52 distinct original scene responses**: 35 raw
strings and 17 parsed trace-export objects whose lexical bytes were lost. Dates
are 9 October (10), 18 October (12), and 19 October (30). Same-question Azure
documents and date-only provider guesses were excluded. Active capture files were
frozen by hashes; the replay does not chase later writes.

| Physics chapter | Historical Kimi lab rows | Replayed scene responses |
|---|---:|---:|
| Units and Measurements | 41 | 0 |
| Kinematics | 49 | 13 |
| Laws of Motion | 22 | 14 |
| Work, Energy and Power | 24 | 2 |
| Rotational Motion | 28 | 1 |
| Gravitation | 25 | 0 |
| Properties of Solids and Liquids | 25 | 0 |
| Thermodynamics | 25 | 0 |
| Kinetic Theory of Gases | 25 | 0 |
| Oscillations and Waves | 38 | 0 |
| Electrostatics | 26 | 0 |
| Current Electricity | 25 | 11 |
| Magnetic Effects of Current and Magnetism | 25 | 0 |
| Electromagnetic Induction and Alternating Currents | 25 | 0 |
| Electromagnetic Waves | 30 | 0 |
| Optics | 24 | 11 |
| Dual Nature of Matter and Radiation | 25 | 0 |
| Atoms and Nuclei | 25 | 0 |
| Electronic Devices | 29 | 0 |
| Experimental Skills | 30 | 0 |
| Chapter-assigned total | 566 | 52 |

One saved, normalized selected-document view was replayed separately with equal
results on both arms. It duplicates an underlying lesson and is not a 53rd
original response. A saved SVG alone cannot recover operator inputs.

## Actual input errors, ranked

Counts are response rows and overlap. Opaque example IDs join the private frozen
payloads and error paths; no student text is included here. Singleton causes have
one observed example, rather than a fabricated second example.

| Cause | Rows | Examples | Decision |
|---|---:|---|---|
| Missing relation IDs | 16 | `S3439a11a45c486a6d5ce`, `S6c42d0937e295eaae15c` | Harness 1 owns the reader; retain all relations. |
| Instrument output-label contract | 8 | `Sdf5fc6a73962e2748c8b`, `Sc31e337b146d65cde06c` | Preserve label and quantity checks; handoff to label/truth owners. |
| Dimension on independently scaled geometry | 3 | `S8ef76ccf1efb6e0b1df1`, `S3bc16427dbff59f2ca08` | Preserve refusal: display length cannot establish a physical measurement. |
| Angle-arm topology | 2 | `chat-aa39f3bfd2d2f7e6fee0`, `kimi-recovered-planning-probe-1f5205952f9d12311d7e` | No intended endpoint can be inferred. |
| Function assertion target contract | 2 | `chat-8780f6a0e82f9cd8ec75`, `chat-46012c5f31e380195c77` | Preserve the target check; no justified operator substitution. |
| Missing incline display/force/acceleration scales | 2 | `Sa5eb6cd2a1d92b18ccd4`, `Sf4e39912df6ddcd75006` | Keep refusal; correct the compact prompt's offered shape. |
| Missing redundant incline units | 2 | `Sa5eb6cd2a1d92b18ccd4`, `Sf4e39912df6ddcd75006` | Read only existing, unanimous SI source declarations. |
| Duplicate geometry | 1 | `kimi-recovered-planning-probe-1f5205952f9d12311d7e` | Do not delete geometry to make the candidate pass. |
| Malformed/truncated JSON | 1 | `kimi-recovered-planning-probe-9a396b1c9c1bd5bfa24a` | No speculative JSON completion. |
| Scalar graph assertion `expected:{value:number}` | 1 | `S3e2f87ff1f2c72792c62` | Shared assertion-reader handoff; also has independent authority/topology failures. |
| Identical wire endpoints | 1 | `S4027499bc4c0d61d6431` | Do not invent the intended endpoint. |

No observed vector alias or wrong-operator replacement was unambiguous. The
observed vector `start`/`end` fields already work.

The actual fatal-code ranking is: `invalid_id` 16 rows, `construction_failed` 14,
`scene_quantity_unverified` 8, `assertion_failed` 7, `scene_quantity_mismatch` 6,
`unconstructed_required_entity` 6, `invalid_display_derived_claim` 3,
`invalid_function_assertion` 2, `invalid_incline_friction_units` 2,
`turnplan_loop_member_not_proven` 2, and `duplicate_geometry` 1.

Historical codes on the separate 649-run inventory include
`invalid_function_samples` (25 rows), `invalid_parallel_guides_fields` (8),
`invalid_velocity_triangle_fields` (8), and `invalid_projectile_trajectory_fields`
(8). Without the original inputs, those codes cannot justify a normalization or
be counted as actual replay results.

## Reader and prompt change

The incline reader uses the existing source-unit chain reader. Every explicit
declaration must agree; bare values, unknown units, non-SI values without a
working-unit block, and explicit malformed/partial/conflicting blocks retain
their refusals. Existing explicit-block conversion behavior remains covered.

Admission of the missing-block shape also requires checking the other physical
declarations: an angle marked radians cannot silently become degrees, and a
coefficient marked percent or force units cannot become dimensionless. Existing
shared unit checks now enforce this, including nested references. Bare
degree/coefficient inputs retain their established contract.

The compact incline contract previously offered only
`mass,gravity,angleDeg,mu,motion`. It now also offers
`displayScale,forceScale,accelScale,units`, with `mass:"kg"` and
`gravity:"m/s^2"`. A gate executes the shape offered by compact, detailed and
universal prompts against the real engine. No new planning call measured the
prompt's generation effect.

## Replay and blind judgment

Both arms use the real parser, model-output normalizer and production candidate
validator with recorded TurnPlans. Source-question conflicts and recorded
rejected plans are preserved. The additional 17 recovered probe responses use
their recorded final selected plan (14 turn-accepted, 3 rejected); their original
scene-request body was not retained. These rows are candidate/admission probes,
not an end-to-end production acceptance measurement.

Both arms have 12 valid responses, 39 validation refusals and 1 parse failure.
The strict/current selection probes each draw 7 candidates on each arm, with
zero new, lost or changed figures. They use `problemIR:null` where full turn
authority was not captured; this does not establish production yield. The two
incline rows advance from `invalid_incline_friction_units` to
`invalid_incline_friction_displayScale`, retaining refusal because all three
scales are absent.

An independent image judge saw 16 opaque images: the seven drawable recorded
candidates per arm and a synthetic pair comparing the fully declared oracle with
the inferred-source form, both compiled on the branch. Verdicts per
recorded arm are **2 right, 2 partial, 3 wrong**, unchanged; the synthetic control
is partial on both arms. Every pair's diagram is identical and verdicts agree.
Existing wrong figures include energy shading above a curve, a distance reference
offset, and a spring connection that stops short. This PR claims no right-yield
gain and no new wrong figure.

## Verification and evidence

- Incline source-unit gate: 115 checks, source and built-package boundaries.
- Planner contract gate: 63 checks across compact, detailed and universal prompts.
- Existing source-unit regression: 58 checks; incline acceleration-basis: 21.
- Reusable scene-capabilities gate passes (33 requests, 76 contracts).
- Six deliberate mutations fail a gate; both source files restore byte-for-byte.
- Scene-engine and tutor-core builds, typechecks and targeted lint pass;
  gate-runner structural tests pass (5 tests).
- The broader `verify-scene-planner-v2` has an existing repair-prompt budget
  failure: frozen main 27,187 characters, branch 27,263, limit 27,000. The assertion
  is unchanged. The contract adds 76 required-input characters to that request.

Gates are registered in `packages/scene-engine/scripts/verify/gates.d/incline-source-units.txt`.
Private evidence stays in `adelaide/.context/h4/overnight-19/`: the `kimi/` frozen
payloads, manifests, per-row resumable checkpoints, ranked reviews, main/branch
results and blind packet; and `operator-units/` checks and mutation logs. The
committed fixtures are synthetic. Topic coverage counters are unchanged.

## Motion in a Plane / draft #206

The 13 recovered Kinematics responses span four source-question hashes. Only two
responses concern vector resolution in Motion in a Plane: one validates but is
not admitted as a figure; the other fails angle-arm construction and required
entity checks. Neither uses `projectile_trajectory`.

Across all 52 responses there are zero projectile operators. Applying #206's
actual alias stage to the 51 parsed frozen-main documents changes none. This is
alias-stage parity, not a replay of the entire older branch or a measurement of
its planner examples. Its earlier 0-of-42 lesson finding was Azure, not a Kimi
baseline. #206 remains draft; its live comparison waits for Harness 1's smoke
result. No paid run, merge or production change was performed.
