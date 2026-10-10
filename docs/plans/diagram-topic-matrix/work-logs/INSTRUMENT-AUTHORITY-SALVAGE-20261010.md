# Instrument authority salvage — 10 October 2026

This follow-up salvages two corrections from the read-only HEY88 instrument checkout into the existing instrument builders. It normalizes source-declared physical values before computing geometry or labels, and expresses downhill acceleration in the same uphill coordinate basis as the force vectors.

A cyclotron given charge 2 mC, mass 4 g, field 500 mT and speed 180 km/h previously treated those raw numbers as C/kg/T/m·s⁻¹, producing radius 0.72 m. Normalization produces the independently expected 200 m. A block sliding down a 30° incline with g=10 m/s² and μ=0.1 previously emitted acceleration x=+3.580127 despite net force/m x=−3.580127. Its acceleration now agrees with both force components.

The implementation reuses the four existing operators (`metre_bridge`, `potentiometer`, `incline_friction`, `cyclotron`) and the current scalar/source-unit authority. Supported source resistance, length, emf, mass, acceleration, charge, field and speed units convert to each builder's declared working units. Unknown units, wrong dimensions and conflicting nested/reference scales are rejected atomically. Bare numbers retain their existing working-unit interpretation. The current document is passed to both validation and compilation so referenced givens retain their units. The cyclotron tangent/sign correction remains in PR #104.

The branch starts from main `bd6069501cec60f4e070e68d9f1a3a5b2d45a296`. The HEY88 reference is `/Users/kaizen/.capy/worktrees/HEY88-instrument-consumer-20261003/heytutor`, detached at `1f12e86522a45c24247c70016ca23fc6aa3f8d4b`. Only its unique unit-normalization and incline-basis behavior was adapted; its older compiler and gates were read as references. Current main's compiler received a document argument at the existing evaluator call. No planner-selection, chapter-routing or new operator code was added.

Two new owned gates test the exported evaluator and public `compileSceneDocument`, with the compiler explicitly loaded from the built package. They are wired into `verify:instrument-authority` and the full scene-engine verification chain. Oracles include literal bridge/potentiometer balances, the 200 m cyclotron label, independent incline component values and force/acceleration closure after undoing the separate arrow display scales. Negative cases require a null render scene. Matching-unit/bare inputs, resting/uphill inclines, zero acceleration, and unsupported friction states remain checked.

| Gate | Built main before fix | Rebuilt final package |
| --- | --- | --- |
| `verify-instrument-source-units.ts --compiled-boundary` | 11 passed, 47 failed | 58 passed, 0 failed |
| `verify-incline-acceleration-basis.ts --compiled-boundary` | 13 passed, 9 failed | 22 passed, 0 failed |

Both red runs used unchanged main's built engine SHA-256 `32fe581532409cd4302197e8a865c74ecd796b3913d68d893edc64cd3c7e663a`. The incline gate was introduced after the unit source slice passed; its direct evaluator had that unit fix, while its compiled boundary still used unchanged built main. Its baseline quantities use matching kg/m·s⁻² units, isolating the acceleration sign defect. The first draft of the zero-render assertion was corrected to main's existing label-only presentation; that diagnostic log is retained separately. The authoritative red run uses the preserved presentation contract.

Packages were installed offline and built with model/API credentials removed. Scene-engine, tutor-core and tutor typechecks and lints passed. Tutor's first typecheck lacked the unbuilt whiteboard `marker-ink` export; building the whiteboard package and rerunning the app check resolved it without a source change.

| Full verification chain | Initial result | Final comparison with immutable `bd606` main baseline |
| --- | --- | --- |
| Scene-engine | 82/85 leaves passed | 3 confirmed baseline failures, 0 new |
| Tutor-core | 47/52 leaves passed | 5 confirmed baseline failures, 0 new |
| Tutor | 152/159 leaves passed | 6 confirmed baseline failures; one 50 ms mocked planner-evidence timeout passed on a serial rerun; 0 new |

The 14 inherited failures match main's exact signature/detail arrays. Scene-engine: archetype pictures, geometric optics operators and archetype point ownership. Tutor-core: scene capabilities, work-energy visuals, mechanics probes, physics unit probes and planner repair-context size. Tutor: turn-save idempotency, marker visibility, chemistry lane, visual-need context, Sentry speech relay and fast-figure authority. Full leaf logs, the initial timeout, its passing rerun, and baseline joins are retained in local evidence.

The reference checkout's HEAD, detached branch state, index, porcelain status, all dirty file contents and symlink targets remained unchanged across the work (13 dirty entries). Before/after snapshot files have identical SHA-256 `fe42e8e92c6d3fdb7c742436fc42d4ac32d8dc50591bff7fb8c94204662b0981`. Source git reads used `GIT_OPTIONAL_LOCKS=0`. No reference file or index was edited, and no ignored environment file was copied or read.

Independent root review found no code blocker and verified that cyclotron velocity/tangent lines stay unchanged. Local evidence is `.context/pr-train/instrument/`: `result.json`, `source-before.json`, `source-after.json`, `source-preservation.json`, both red/green gate logs, `scene-verify/`, `core-verify/`, `tutor-verify/`, and `baseline-comparison.json` joined to `.context/pr-train/pr92/bd606/main-baseline-failures.json`.

This is offline deterministic authority evidence. Live model selection, narration, persistence and replay were not exercised. It makes no new topic-readiness or accepted-coverage claim and changes no topic ledger counts. Paid model calls: zero.
