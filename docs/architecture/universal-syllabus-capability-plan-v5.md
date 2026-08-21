# Universal Syllabus Capability Engine v5

## Status

This is the implementation plan for certified JEE Main Physics and Mathematics
coverage. It extends the v4 verified illustration pipeline without reintroducing
chapter templates, topic plugins, question regex routing, or model-authored
pixels.

The syllabus is an evaluation and release catalog. It is never consulted to
select a drawing at runtime.

## Requirements

1. A visualizable question must receive a relevant problem representation before
   worked algebra begins.
2. Metric geometry, directions, topology, labels, and derived locations must be
   produced by deterministic operators and checked proof obligations.
3. The tutor must narrate the structural setup as it is revealed, then solve in
   the work area, and later trace only existing verified entities.
4. A failed exact plan must never become unrelated boxes, decorative ink, or an
   authoritative partial diagram.
5. Coverage must grow through reusable capabilities and executable law schemas,
   not one implementation file per syllabus topic.
6. Released capabilities must pass easy, medium, hard, composite, and adversarial
   cases repeatedly in the live pipeline.
7. The runtime must report the missing solver, operator, predicate, or transport
   capability when it cannot produce an exact representation.

## Recent Refraction Failure

Question:

```text
Light enters glass at 45 degrees with n = 1.5. Find the angle of
refraction and draw both rays.
```

The latest Langfuse run failed through four independent mechanisms:

1. `refraction` matched the unbounded `/fraction/i` board-title rule.
2. ProblemIR emitted safe function-call aliases `{name,arg}`. The boundary only
   accepted `{function,argument}`, so the Snell expression and solve request were
   dropped and solver authority became `not_applicable`.
3. Both scene lanes received about 27K characters because the complete scene
   contract was duplicated in system and user messages. Both timed out before
   producing a candidate, so existing `surface_contact`, `normal_at`, and
   `refract_direction` operators never ran.
4. The non-function fallback tokenized the question and rendered each selected
   word as a rectangle. Seven source tokens became seven unrelated boxes, which
   passed the existing nonempty-render corpus gate.

This failure establishes two release invariants:

- A required physical diagram may not degrade to a fact-card or token-box scene.
- Transport failure and missing capability must remain distinguishable from a
  successful, meaningful representation.

## Architectural Principles

1. **Semantic programs, not pixels.** Models choose typed capabilities and bind
   grounded inputs. Deterministic evaluators own geometry.
2. **Knowledge as executable laws.** Subject knowledge is unavoidable, but it is
   encoded once as typed equations, applicability conditions, units, and proof
   rules rather than drawing templates.
3. **Independent completeness.** The planner cannot decide that its own output is
   complete. Runtime-generated visual requirements and proof obligations decide.
4. **One capability source of truth.** Planner schemas, validator contracts,
   compiler dispatch, documentation, and corpus expectations come from one
   registry so their operator lists cannot drift.
5. **Fail honestly and atomically.** Invalid or incomplete geometry never appears
   on canvas. A degradation must still represent the actual question.
6. **Certification over anecdotes.** One successful screenshot is evidence for a
   bug fix, not syllabus coverage.

## Target Pipeline

```text
submitted question
  -> ProblemIR/v2
       exact evidence, typed quantities, equations, entities, constraints
  -> CapabilityRequirementIR/v1
       visual goals, required entities/relations/views, solver capabilities
  -> LawGraph/v1 + SolverProviders
       dimension checks, equation systems, certificates, residuals
  -> RequiredVisualSpec/v1
       independent completeness contract and mandatory annotations
  -> OperatorProgram/v1
       typed reusable construction graph, no pixels
  -> ProofObligationCompiler
       obligations derived from requirements + laws + operators
  -> deterministic compile/layout/label/render validation
  -> atomic scene transaction
  -> TeachingScriptIR/v1
       narrated reveals, worked steps, semantic focus/traces
  -> persisted server revalidation and identical replay
```

## 1. ProblemIR v2

Extend `packages/scene-engine/src/ir/problemIR.ts` from one-variable scalar
arithmetic to a safe, typed constraint document.

### Required types

- Dimensioned scalar quantities with canonical SI dimensions and display units.
- Two- and three-dimensional vectors with coordinate-frame ownership.
- Complex values and matrices.
- Indexed sequences, finite sets, distributions, and state variables.
- Piecewise, parametric, polar, implicit, multivariable, and differential
  expressions.
- Equality, inequality, domain, incidence, topology, conservation, boundary, and
  initial-condition constraints.
- Source evidence on every fact, law selection input, and requested result.

### Safe normalization

Only mechanical aliases may be repaired. Normalization may not invent a domain,
law, unit, sign convention, entity, or result binding. Unknown model fields are
retained for telemetry but excluded from authority.

## 2. Capability Requirement Predictor

Add a multi-label `CapabilityRequirementIR`, separate from TurnPlan prose and
separate from SceneDocument.

Topic-neutral visual goals:

- `spatial_setup`
- `path_or_trajectory`
- `field_distribution`
- `network_topology`
- `free_body`
- `coordinate_graph`
- `bounded_measure`
- `state_sequence`
- `apparatus_reading`
- `discrete_structure`
- `table_or_distribution`
- `three_dimensional_relation`

Each goal declares required semantic entities, relations, views, quantities,
proof families, and acceptable representation tiers. The predictor combines:

1. deterministic cues for explicit requests and source structures;
2. ProblemIR entity and constraint types;
3. a structured model classification lane;
4. a conservative union rule so uncertain required capabilities are not dropped.

The current short draw-word regex in `turnPlannerV3.ts` remains only an explicit
request signal. It must not serve as the full predictor.

## 3. Capability Manifest

Create one generated registry in `packages/scene-engine`.

Every capability record owns:

- stable ID and version;
- typed input and output schema;
- preconditions and supported coordinate spaces;
- deterministic evaluator;
- default proof obligations;
- renderer and presentation role;
- layout and label constraints;
- estimated visual and compute cost;
- compatible requirements and law families;
- corpus cases and adversarial mutations.

Generate from the registry:

- planner-facing compact tool schemas;
- validator allowlists and input checks;
- compiler dispatch metadata;
- documentation tables;
- corpus coverage reports.

Do not send every detailed capability contract on every request. Select a compact
candidate subset from `CapabilityRequirementIR`, while always including shared
geometry, layout, and annotation primitives.

## 4. Executable Law Graph

Add reusable law schemas with typed variables, units, equations, applicability
conditions, branches, invariants, and solver certificates.

Initial P0 law families:

- kinematics and relative motion;
- momentum, impulse, equilibrium, and conservation;
- work-energy and power;
- KCL, KVL, Ohm's law, equivalent networks;
- reflection, Snell's law, lens and mirror relations;
- basic thermodynamic state and first-law processes;
- derivatives, extrema, areas, and volumes.

Snell's law is one law schema reused by plane interfaces, parallel slabs, prisms,
spherical surfaces, lenses, and total internal reflection. It is not an optics
drawing template.

## 5. Solver Providers

Solver providers operate on ProblemIR and return typed results plus independently
checkable certificates.

### P0 providers

- unit and dimension algebra;
- linear and nonlinear scalar equation systems;
- inequalities and interval isolation;
- derivatives, limits, extrema, roots, intersections, and integrals;
- two-dimensional vector and coordinate geometry;
- network graph equations for circuits;
- physics law-graph substitution and residual verification.

### P1 providers

- matrices, determinants, and linear systems;
- complex arithmetic and loci;
- sequences, series, combinatorics, probability, and statistics;
- first-order differential equations;
- three-dimensional vector, line, and plane geometry;
- broader symbolic integration and piecewise functions.

Remote providers may propose results or certificates, but local checks must verify
units, domains, residuals, and applicability. Local verification does not need to
repeat the provider's algorithm; it must independently establish the certificate.

## 6. Reusable Operator Families

### P0 foundation

- `view` and explicit disjoint-view ownership;
- `body`, `contact_surface`, `path_constraint`, `pulley`, `spring`;
- `material_region`, `surface_profile`, `interface`;
- multi-surface path propagation assembled from contact, normal, reflection, and
  refraction transforms;
- `field_pattern` with source and boundary ownership;
- derived curve intersection, extremum, and interval markers;
- general closed regions with function, parametric, polar, and implicit bounds;
- `data_table` and `discrete_plot`.

### P1 visual structures

- set/Venn/map operators;
- matrix/table/grid operators;
- probability tree, histogram, box plot, and distribution plot;
- 3D axes, point, vector, line, plane, section, and projection;
- fluid vessel, pipe, piston, free surface, capillary, and streamline;
- particle ensemble and distribution;
- wavefront, slit, fringe, standing-wave mode, and polarizer;
- charge, field, equipotential, dipole, and Gaussian surface;
- coil, solenoid, bar magnet, transformer, and generator;
- energy-level stack and transition;
- transistor, logic gate, truth table, rectifier, and waveform;
- instrument scale, vernier, screw gauge, bridge, tube, calorimeter, and probes.

Operators are composable semantic geometry. Their names describe structures, not
chapters or questions.

## 7. Predicate And Proof Families

### P0 predicates

- `inside` / `contains`
- `opposite_side`
- `tangent`
- `ordered_along`
- `angle_value` / `equal_angle`
- `closed_path` / `path_orientation` / `signed_area`
- `extremum`
- `vector_magnitude` / `equal_magnitude`
- `attached_to`
- `quantity_equation`
- `dimensionally_consistent`
- `view_disjoint` / `no_overlap`
- `interface_order`
- `medium_membership`
- `law_residual`
- `virtual_extension_style`

The proof compiler generates obligations from requirements and operator semantics.
Planner-authored assertions may add useful checks but cannot remove mandatory
ones.

### Refraction proof contract

For every refracting path:

1. The source medium, destination medium, and interface are visible and owned.
2. The incident path terminates at a derived interface contact.
3. The constructed local normal shares that contact.
4. The outgoing path is produced only by the refraction transform using certified
   refractive indices.
5. Each path segment is contained in its declared medium.
6. Interface contacts are ordered for slabs, prisms, lenses, and compound systems.
7. Snell residual is within the numeric tolerance.
8. Incidence, refraction, and emergence angles are derived and correctly marked.
9. Total internal reflection is chosen only when its precondition holds.
10. Labels belong to semantic owners and do not collide with paths or other views.

## 8. Layout And Annotation

Build layout after semantic and proof validation.

- Pack independent views into explicit non-overlapping regions.
- Solve labels against entity bounds, paths, reserved work space, and other labels.
- Prefer leader lines when no close collision-free label position exists.
- Treat annotations as owned semantic entities, never free text coordinates.
- Reject a scene when mandatory labels cannot be placed legibly.
- Add topology-preserving adaptive sampling for analytic curves and fields.
- Add perspective and occlusion validation for 3D scenes.

## 9. Natural Teacher Choreography

Compile the complete scene before speech starts, then reveal it in narrated
semantic phases:

1. physical or mathematical setup;
2. directions, coordinate frame, and given values;
3. relevant relationships and target quantity;
4. symbolic setup and calculation in the work area;
5. result interpretation;
6. thin transient focus traces over existing verified geometry during review.

Add `TeachingScriptIR` with references to entity, quantity, law, proof, and work
step IDs. The teaching model may paraphrase checked narration but may not emit
diagram commands or focus coordinates.

Timing acceptance:

- first narrated ink begins after the scene transaction is ready;
- no silent marker motion;
- every reveal has narration;
- speech and ink onset skew P95 <= 250 ms, P99 <= 500 ms;
- a TTS context cannot finalize another segment;
- cancellation rolls back the complete in-progress scene transaction.

## 10. Degradation Policy

Allowed outcomes:

1. `exact_verified`: full metric/proof authority.
2. `qualitative_verified`: meaningful source-grounded structure whose exact
   non-metric relations are proved.
3. `question_representation`: only when a deterministic equation, table, named
   structure, or other meaningful source representation exists.
4. `retry_required`: a required visual could not be represented safely.
5. `text_only`: the question is not visual or its visual is optional.

Forbidden outcomes:

- token boxes;
- generic fact cards in the diagram zone;
- freehand rays, forces, field lines, or graph paths;
- partial exact diagrams presented as complete;
- hiding planner transport or missing-capability errors behind a successful
  existence-only fallback report.

## Syllabus Capability Matrix

Status means current end-to-end exact capability, not whether basic lines could
approximate the picture.

### Physics

| Unit | Main visual archetypes | Current | Required capability families |
| --- | --- | --- | --- |
| Measurement | scales, apparatus, uncertainty | missing | units, instrument scale, reading proof |
| Kinematics | x-t/v-t/a-t, trajectory, vectors | partial | derivatives, piecewise motion, extrema |
| Laws of Motion | FBD, contacts, strings, pulleys | partial | bodies, attachments, equilibrium laws |
| Work/Energy/Power | F-x area, energy, collisions | partial | signed area, conservation, state sequence |
| Rotation | rigid body, COM, torque, axes | weak | rigid body, inertia, torque solver |
| Gravitation | orbit, field, potential graph | partial | inverse-square fields, orbit laws |
| Solids/Liquids/Thermal | stress, vessels, flow, heat | weak | fluids, pressure levels, thermal flow |
| Thermodynamics | P-V process/cycle, piston | partial | state/process, cycle area, first law |
| Kinetic Theory | ensemble, distributions | missing | particles, distributions, equipartition |
| Oscillations/Waves | spring, pendulum, modes | partial | spring, boundaries, nodes, superposition |
| Electrostatics | charges, fields, Gaussian surfaces | weak | charge/field/flux/equipotential |
| Current Electricity | circuits, bridges, I-V | partial | KCL/KVL/Ohm, polarity, network solver |
| Magnetism | wire, loop, coil, field | weak | magnetic sources, field, orientation |
| EMI/AC | flux, generator, transformer, phasor | partial | loop flux, induction, AC network |
| EM Waves | coupled E/B wave, spectrum | weak | orthogonal fields, wavelength, bands |
| Optics | interfaces, elements, rays, wavefronts | partial | media propagation, angles, wave optics |
| Dual Nature | characteristic graphs, particles | weak | energy balance, photon/matter wave |
| Atoms/Nuclei | levels, scattering, reactions | weak | level ordering, transition, reaction |
| Electronic Devices | circuits, I-V, gates | partial | device symbols, logic, waveform |
| Experimental Skills | instruments, apparatus, tables | missing | measurement structures and readings |

### Mathematics

| Unit | Main visual archetypes | Current | Required capability families |
| --- | --- | --- | --- |
| Sets/Relations/Functions | Venn, maps, tables, graphs | weak | sets, mappings, finite reasoning |
| Complex/Quadratics | Argand, loci, roots | weak | complex values, loci, argument |
| Matrices/Determinants | matrix grid, systems | weak | table/matrix, linear solver |
| Permutations/Combinations | trees, grids | missing | discrete structures, counting |
| Binomial | coefficient rows, term lattice | missing | indexed sequences, binomial solver |
| Sequences/Series | discrete plot, number line | missing | indexed expressions, convergence |
| Limits/Differentiability | graphs, tangent, extrema | partial | limits, derivatives, continuity |
| Integral Calculus | regions, slices, revolution | partial | general regions, shells, improper/piecewise |
| Differential Equations | slope fields, families | missing | ODE solver, slope field |
| Coordinate Geometry | conics, loci, tangents | partial | exact 2D geometry and conic invariants |
| 3D Geometry | axes, lines, planes | missing | 3D values, projection, line-plane solver |
| Vector Algebra | 2D/3D vectors, products | partial | 3D vectors, dot/cross/triple products |
| Statistics/Probability | plots, tables, trees | missing | statistical and probability structures |
| Trigonometry | unit circle, triangles, graphs | partial | angle/length law and trig solver |

## Certification Corpus

Create a machine-readable record for every syllabus checklist item. Every record
declares visual goals, solver/law families, operators, predicates, easy/medium/
hard/composite questions, answer oracle, scene invariants, and mutation rules.

Initial release floor:

- all 34 units represented;
- minimum 3 seed problems per unit: 102 seeds;
- at least 5 adversarial mutations per seed;
- previous production failures included as immutable regressions;
- repeated live planner runs for stochastic availability;
- browser screenshot, label collision, narration, persistence, and replay checks.

The existing 21 physics and 12 mathematics metadata cases remain inventory
seeds, but are not accepted as end-to-end coverage evidence.

## Release Gates And SLOs

### Hard safety gates

- 100% of committed metric geometry passes deterministic proof validation.
- 100% of pinned certified corpus cases solve, compile, persist, and replay.
- 100% of seeded incorrect mutations are rejected.
- 100% of mandatory visual requirements have generated proof obligations.
- zero accepted label collisions or cross-view overlaps.
- zero token-box or unrelated fallback illustrations for required visuals.
- zero unverified geometry commands committed to the canvas.

### Availability and teaching SLOs

- supported visual-question exact-tier rate >= 99% over repeated live runs;
- verified-answer accuracy >= 99.5% with zero known corpus contradictions;
- P95 first narrated ink <= 15 seconds, P99 <= 30 seconds;
- P95 speech/ink onset skew <= 250 ms, P99 <= 500 ms;
- premature speech or drawing termination < 0.1%;
- previously certified archetype regressions block release.

A literal guarantee for every arbitrary input is not technically honest because
questions may be ambiguous or malformed and external providers may fail. The
hard guarantee is that the system never displays unverified geometry as correct.

## Observability

Persist and index:

- evidence coverage and normalization actions;
- required capability IDs and missing capability IDs;
- selected laws, solver providers, certificates, units, and residuals;
- RequiredVisualSpec and generated proof coverage;
- every operator candidate and rejection code;
- degradation tier and original exact failure family;
- layout, label, unrelated-ink, and render coverage metrics;
- first narrated ink latency and speech/ink skew;
- truncation, cancellation, rollback, and persistence failures;
- deterministic semantic-scene and screenshot hashes.

Cluster failures into formulation, solver, operator, predicate, layout, schema,
transport, narration, and persistence categories. A vision reviewer may score
aesthetics in shadow mode, but it cannot authorize geometry.

## Phased Implementation

### Phase 0: Current refraction stabilization

1. Fix board-title word boundaries.
2. Normalize safe ProblemIR function-call aliases and replay the exact trace.
3. remove duplicated scene prompt contracts and enforce a request-size budget.
4. Delete token-box fallback acceptance for required spatial questions.
5. Preserve exact planner failures in degradation telemetry.
6. Add a full refraction case with interface, media, normal, incident ray,
   refracted ray, angle marks, Snell result, narration, persistence, and replay.

### Phase 1: Capability foundation

1. Add CapabilityRequirementIR and RequiredVisualSpec.
2. Consolidate the capability manifest and generate planner/validator metadata.
3. Add dimensioned quantities, equation systems, and law graph contracts.
4. Compile mandatory proof obligations independently of scene candidates.
5. Add structured missing-capability diagnostics.

### Phase 2: P0 high-frequency physics and calculus

1. mechanics bodies/contacts/constraints and law authority;
2. circuit equation solving and topology proof;
3. material regions and multi-interface optics;
4. field/flux structures;
5. general calculus regions, markers, slices, and extrema;
6. view packing and collision rejection.

### Phase 3: Remaining mathematics

Add discrete structures, matrices, probability/statistics, ODEs, broader symbolic
calculus, complex geometry, and analytic 3D geometry with certified providers.

### Phase 4: Remaining physics and experimental skills

Add fluids, waves, thermal processes, electromagnetic apparatus, modern physics,
electronics, and reusable instruments/measurement readings.

### Phase 5: Hard composite certification

Expand coupled systems, multi-stage state transitions, compound 3D structures,
adaptive analytic rendering, accessibility, shadow visual review, and live SLO
enforcement.

## File-Level Migration Map

- `packages/scene-engine/src/ir/problemIR.ts`: ProblemIR v2 and typed constraints.
- `packages/scene-engine/src/ir/solver.ts`: provider/certificate expansion.
- `packages/scene-engine/src/contracts/contractsV3.ts`: migrate TurnPlan authority into
  law/capability references.
- `packages/scene-engine/src/document/validation.ts`: generated capability validation.
- `packages/scene-engine/src/compile/compiler.ts`: reusable evaluator families.
- `packages/scene-engine/src/topology/topology.ts`: generalized graph proofs.
- `packages/scene-engine/src/labels/labelEngine.ts`: leaders and hard collision gates.
- `packages/tutor-core/src/planners/problemPlannerV1.ts`: safe v2 model boundary.
- `packages/tutor-core/src/planners/turnPlannerV3.ts`: capability requirement prediction.
- `packages/tutor-core/src/planners/scenePlannerV2Prompt.ts`: generated compact schemas.
- `apps/tutor/features/tutor-session/hooks/turn/useQuestionHandler.ts`: staged v5
  orchestration, telemetry, and degradation policy.
- `apps/tutor/features/tutor-session/lib/representationFallbackV4.ts`: meaningful
  source representations only; no token boxes.
- `apps/tutor/features/tutor-session/lib/verifiedScenePresentation.ts`:
  TeachingScriptIR reveal mapping.
- `apps/tutor/lib/scene/turnScenePersistence.ts`: server revalidation of new contracts.
- `packages/scene-engine/fixtures/evaluation`: syllabus certification matrix.

## ADR

### Decision

Build a capability-registry, law-graph, proof-compiler architecture and certify it
against the syllabus. Do not build chapter plugins or question templates.

### Drivers

- arbitrary question composition;
- deterministic correctness and traceability;
- maintainable coverage growth;
- natural teaching choreography;
- measurable release confidence.

### Alternatives considered

1. **One template/plugin per topic.** Rejected because combinations create an
   unbounded registry and repeated geometry logic.
2. **A stronger multimodal model drawing pixels directly.** Rejected because
   physical and mathematical claims remain unprovable and replay is unstable.
3. **Pre-rendered images or generated SVGs.** Rejected as the main path because
   they cannot support semantic tracing, proof-linked labels, or synchronized
   construction. They may be supplementary media for non-analytic illustrations.
4. **Current free-form scene JSON with more prompting.** Rejected as the final
   architecture because prompt growth, schema drift, and self-declared
   completeness worsen as coverage expands.

### Consequences

- More engineering is required in solver and proof infrastructure.
- Subject knowledge becomes explicit, testable data instead of hidden prompts.
- Coverage can be reported by reusable capability and syllabus item.
- Unsupported cases fail transparently instead of drawing plausible nonsense.

### Follow-ups

Implement Phase 0 immediately, then land Phase 1 before adding broad P1 operator
families. Every subsequent production failure must become an archetype-level
regression and a capability gap, never a question-specific fixture.
