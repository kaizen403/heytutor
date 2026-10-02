# Diagram engine coverage plan and session record

Updated: 2 October 2026. Status: **25-chapter expansion complete; further coverage work paused at the user's request.**

This is the review and resume document for the reusable scene-operator expansion. The user asked to publish the completed work through a PR and merge it to `main`, then leave a documented path toward full coverage. Do not start the future backlog until the user resumes it.

## What was requested and completed

The first request covered fifteen chapters. The extension added ten more while the original checks continued. Each chapter received a separate implementation and accuracy gate, with chapter workers reused in waves because the runtime allowed three workers alongside the parent. Shared compiler, validation, capabilities, planner contracts and final integration remained under parent ownership. Workers used the requested fast model with xhigh reasoning.

The expansion adds **67 reusable operators across 25 chapters**. These operators expose explicit mathematical inputs; they do not look up a chapter or question to choose a picture. The live planner can request them, and deterministic validation and compilation establish whether the requested scene is admissible before any ink renders.

Catalog counts need their baseline:

- Development workspace: 61 → 128 canonical operators. The initial 61 included a pre-existing, uncommitted `solid_anchor` operator from another session.
- Publication branch based on `origin/main` at `ae6c166655bc937de36f57f9fd29ccc9c07d9cba`: **60 → 127**, adding the same 67 operators. The separate `solid_anchor` work is not included in this PR.
- Operator count is expressibility, not a question-bank success percentage or a guarantee that every question in a chapter works.

The first fifteen chapters are the first fifteen rows below; the subsequent ten run from complex numbers through elasticity.

## Completed operator inventory

| Chapter | Operators | Verified behavior |
| --- | --- | --- |
| Statistics | `histogram`, `frequency_polygon`, `cumulative_frequency` | Exact frequency density and area for unequal bins; real class midpoints; less/greater cumulative sums. |
| Trigonometry and triangles | `triangle_from_sides`, `triangle_from_sas`, `triangle_from_asa`, `triangle_center` | SSS/SAS/ASA and centroid, incenter, circumcenter, orthocenter under rotations and reflections. |
| Conic sections | `conic`, `conic_anchor`, `conic_directrix`, `conic_asymptotes`, `conic_tangent` | Rotated ellipse/hyperbola/parabola; separate branches; exact foci, directrices, landmarks, tangents and analytic incidence. |
| Probability | `probability_tree` | Explicit conditional tree topology, sibling sums, zero weights and computed joint leaf probabilities. |
| 3D geometry | `space_project`, `space_closest_points`, `space_intersection`, `space_segment` | Orthogonal projections, skew-line feet, line/plane and plane/plane intersections, true world distances and proofs. |
| Electrostatics | `electric_field`, `field_components` | Explicit point-charge superposition in SI or schematic units; signed components and certified cancellation. |
| Circle geometry | `circle_from_three_points`, `circle_tangent_at`, `circle_tangency_points`, `circle_intersections` | Circumcircle, exact tangent contacts and intersection multiplicity. |
| Linear algebra | `affine_point`, `affine_path` | Matrix/translation composition and inverse transforms; preserved closure, direction and orientation. |
| Vector algebra | `vector_sum`, `vector_scale`, `vector_projection` | Exact rational components through composed operations, signed scaling, orthogonal projection and genuine zero markers. |
| Kinematics | `constant_acceleration_trajectory`, `trajectory_state` | Explicit 2D motion, exact states and derivatives; physical units kept separate from arrow display scale. |
| Calculus | `curve_anchor`, `curve_secant`, `curve_derivative` | Analytic differentiation of the expression AST; exact anchors, secants, derivatives, tangent/normal composition. |
| Waves | `harmonic_wave`, `wave_superposition`, `wave_sample` | Explicit physical phases, anti-alias bounds, compatible superposition, exact sampling and cancellation checks. |
| AC circuits | `impedance`, `impedance_combine`, `phasor_response` | Complex R/L/C impedance, explicit series/parallel composition, RMS current and complex power. |
| Thermodynamic graphs | `polytropic_process`, `isochoric_process`, `process_state` | Explicit PV law, normalized states, analytic derivatives and stable SI work integration. |
| Geometric optics | `gaussian_image`, `optical_focus` | Signed Cartesian lens/mirror image anchors and foci with physical metadata independent of display scale. |
| Complex numbers | `complex_point`, `complex_transform`, `complex_roots` | Exact complex arithmetic and affine images, all bounded roots, magnitude/argument and independently verified numeric claims. |
| Sets and Venn diagrams | `set_partition`, `set_select` | Exact inclusion-exclusion and Boolean selection for two/three sets; witnesses certify membership, while circle areas remain nonmetric. |
| Combinatorics | `permutation_cycles`, `subset_lattice` | Explicit bijections, inverse/cycles/parity/factorial counts; bounded powersets, rank/binomial counts and directed cover edges. |
| Simple harmonic motion | `harmonic_motion`, `harmonic_state` | Explicit sinusoidal position/velocity/acceleration time laws, exact source-time states and calculus callbacks. |
| Rotational mechanics | `rotational_motion`, `rotational_state`, `planar_torque` | Source polar position, tangent/centripetal/total acceleration and signed page-normal torque; independent display lengths. |
| Gravitation | `gravitational_field`, `gravitational_force` | Explicit point-mass superposition, field/potential and force from a supplied test mass and gravitational constant. |
| Magnetism | `magnetic_force`, `magnetic_components` | Signed Lorentz force from explicit charge/velocity/field, planar vectors and page-normal glyphs. |
| Electromagnetic induction | `flux_process`, `induction_state` | Explicit affine uniform field/oriented-area laws, exact quadratic flux linkage and signed emf; no guessed loop or current. |
| Fluids | `hydrostatic_profile`, `hydrostatic_state`, `buoyancy` | Source pressure-depth law, exact states and Archimedes force from explicit displaced volume. |
| Elasticity | `elastic_profile`, `elastic_state` | Explicit linear constitutive law, stress, and optional force/extension/energy under a supplied uniform-bar assumption and dimensions. |

## Architecture decisions and accuracy boundaries

1. **Keep diagram authority in scene-engine.** Geometry, topology, labels, dimensions, layout and reveal order are engine-owned. The teaching stream owns narration and work-area `WRITE`; `[FOCUS:id]` can trace existing verified geometry. No chapter registry, question template, question-ID allowlist, new English routing layer or model-authored diagram marks were added.
2. **Source evidence is numeric authority.** Explicit quantities, units, signs and physical assumptions feed deterministic constructions. The planner cannot attach stale scalar results to otherwise correct geometry. Numeric label/annotation checks run before engine label assignment.
3. **Separate physical quantities from display scale.** Independently scaled arrows and axes retain source metadata. Their rendered lengths cannot certify physical dimensions or length ratios. Generic descendants cannot discard that metadata and gain permission to display numeric physical claims.
4. **Use world geometry for 3D proofs.** Incidence, distance, collinearity and direction use actual world coordinates and frame identity. Flattened projections and mixed frames cannot certify these properties. The point-to-plane archetype now derives its foot with `space_project` and uses `space_segment`.
5. **Keep nonmetric representations honest.** Venn membership/count witnesses and discrete graph topology do not imply area, distance, angle or electrical connectivity. A page-normal cross/dot glyph does not certify an in-plane vector or incidence relation.
6. **Fail atomically.** Incomplete, infeasible, singular or numerically uncertifiable candidates emit no partial scene. Honest question representations compile independently; required visuals that cannot be represented still teach without fabricated ink.
7. **Respect numerical precision and unit case.** SI prefix case is significant. Nonzero literals cannot underflow into certified zero, including through quantity chains. Ill-conditioned subnormal vector operations reject rather than certify a wrong direction.
8. **Compose exact analytic curves.** Bounded memoized dependency replay connects calculus with kinematics, waves, PV, hydrostatic, SHM, induction and elasticity. Analytic callbacks preserve the source parameter and its units; display slopes do not become physical scalar authority.
9. **Preserve planner budgets.** Scoped requests keep full contracts. Broad requests compact input/output shapes without losing operators, required physical assumptions or conditional output kinds. Initial and repair transport limits stay 24,500 and 27,000 characters. Repairs retain detailed contracts for their actual operators.
10. **Review actual rendered output.** Source-derived count/scalar anchors participate in fitting; infinite-line labels anchor to the visible clipped stroke. Lens outlines reject crossing surfaces. The board stays 1200 × 700 with diagram x=400–1160.

The publication worktree preserves `main`'s newer polyhedral solids, hollow-cylinder contours/sections, source-mensuration inference, existing speech changes and existing verification scripts. Unrelated billing, authentication, landing, chemistry and label-workspace changes are excluded. No production credentials or generated build artifacts belong in this change.

## Code and gate map

| Concern | Entry point |
| --- | --- |
| Construction dispatch, geometry metadata and proofs | `packages/scene-engine/src/compile/compiler.ts` |
| Chapter implementations | `packages/scene-engine/src/compile/*Geometry.ts`, `statistics.ts`, `spaceDerivations.ts` |
| Source-bound numeric claims | `packages/scene-engine/src/compile/outputLabels.ts`, `derivedValueLabels.ts` |
| Structural contracts and output kinds | `packages/scene-engine/src/document/validation.ts` |
| Canonical operator inventory | `packages/scene-engine/src/capability/capabilityManifest.ts` |
| Expression analytic differentiation | `packages/scene-engine/src/math/expression.ts` |
| Semantic planner availability | `packages/tutor-core/src/planners/sceneCapabilities.ts` |
| Full/compact contracts and repair detail | `packages/tutor-core/src/planners/scenePlannerV2Prompt.ts`, `scenePlannerV2.ts` |
| Chapter accuracy gates | `packages/scene-engine/scripts/verify/verify-*-operators.ts`, `verify-space-derivation-operators.ts` |
| Shared authority regressions | `verify-derived-value-labels.ts`, `verify-operator-accuracy.ts` in the engine verify directory |
| Render gallery | `packages/scene-engine/scripts/verify/render-reusable-operators.ts` |
| Planner transport and access gate | `packages/tutor-core/scripts/verify/verify-reusable-scene-capabilities.ts` |
| Earlier detailed session report | [Reusable operator coverage](docs/plans/reusable-operator-coverage.md) |
| Existing priorities | [Diagram engine priority](docs/plans/diagram-engine-priority.md) |
| Longer-term capability architecture | [Universal syllabus capability plan](docs/architecture/universal-syllabus-capability-plan-v5.md) |

## Verification record

These are completed development-workspace results before publication integration. Publication results are recorded separately below so results from different source trees are not conflated.

| Check | Result and scope |
| --- | --- |
| Full scene-engine verification | Passed existing engine, bank/corpus, DSA/chemistry gates and all 25 chapter gates. |
| Final expansion coverage | All 25 gates passed after the final literal-underflow fixes; shared numeric-label gate 220 checks, authority gate 319 checks. |
| Planner coverage | 25 request cases and all 67 new operator contracts passed, including initial/repair budget checks. Fetch is mocked; this proves contract access and transport behavior, not live model success. |
| Tutor-core gates | 41/43 passed. `verify-work-energy-visuals` and `verify-physics-unit-probe-visuals` failed against the starting tree as well. The threshold was not raised. |
| Physics baseline comparison | 846 probes, 63 declines before and after, zero newly introduced declines. |
| Offline tutor diagram integration | 12/12 passed: presentation, teaching prompt, generation, legacy-path exclusion, recovery, representation fallback/corpus, session capabilities, label accuracy/glossary, focus execution and dimension reveal. |
| Typecheck and lint | Repository checks passed; existing lint warnings remain. |
| Builds | Shared packages and landing passed; tutor production build passed in an isolated source tree, including types and 46 static pages. The ordinary app build shares `.next` with a running dev server and raced on a trace file after successful compilation. |
| Rendered compositions | 32 verified SVG examples, viewport checked and reviewed as raster images. This is offline render review; browser/voice synchronization was not tested live. |
| Full tutor command | DB-backed trace-ownership verification could not run without `DATABASE_URL`. Production DB credentials were not used. |

Local artifacts from this session are useful if this machine still retains them, but are not durable repository dependencies:

- `/tmp/heytutor-25-engine-verify.log`, `/tmp/heytutor-25-coverage-final.log`
- `/tmp/heytutor-25-core-gates.json`, `/tmp/heytutor-25-final-app-gates.json`
- `/tmp/heytutor-25-final-planner-coverage.log`
- `/tmp/heytutor-25-final-typecheck.log`, `/tmp/heytutor-25-final-lint.log`
- `/tmp/heytutor-25-final-isolated-tutor-build.log`
- `/tmp/heytutor-expansion-physics-baseline.json`
- `/tmp/heytutor-operator-coverage/index.html` and its SVG/JSON files

### Publication validation

Checked against the current `main` base in `/tmp/heytutor-coverage-pr`, with its own frozen dependencies and build artifacts:

| Publication check | Result |
| --- | --- |
| Canonical catalog and contracts | 127 operators; all 67 additions available. 25 request/contract cases pass; legacy capability and planner/repair policy gates pass with unchanged transport limits. |
| Full scene-engine suite | Passed, preserving upstream `verify:mensuration` and existing bank/corpus, chemistry/DSA gates, plus all 25 new chapter gates. Shared authority gate: 323 checks; numeric-label gate: 220. |
| Tutor-core gates | 43/45 passed on the newer upstream suite. The same two work-energy/physics baseline failures remain; no threshold changed. |
| Physics comparison with current `main` | 846 probes; 63 declines in both revisions, zero regressions. |
| Offline tutor integration | All 11 corresponding gates present on current `main` passed. The development tree's separate dimension-reveal gate belongs to another session and is excluded from publication. |
| Repository checks | Typecheck and lint passed, 12 tasks each; full production build passed, 7 tasks, in this isolated worktree. |
| Security regressions | Local `pnpm verify:security` passed. GitHub's required `Security checks` status gates merge and includes disposable-DB checks. |
| Render review | 32 examples passed viewport checks; rerendered probability and subset-lattice examples were also inspected after integration. |
| Scope and credentials | 72 intended files; no credential-pattern matches, environment files, IDE files or build artifacts in the publication scope. |

Integration corrections were limited to the completed feature: computed label anchors are included in viewport fitting through actual checked output ownership; the original catalog's baseline gate remains independent of later extensions; compact planner wording fits the existing repair budget; a primitive fixture now declares source points visible instead of hidden helpers. The latter fixture failure was reproduced on unchanged `main`. No chapter/family routing, validator bypass or unrelated feature was introduced.

The PR and its check history are the durable publication record. Merging `main` is authorized by the user; further coverage implementation remains paused.

## What full coverage should mean

Full coverage must be defined against a versioned, finite evaluation set from the supported syllabus. It is not a claim that all conceivable questions have a diagram. Before implementation resumes, freeze source-quality criteria, diagram need, source completeness and the expected representation independently of the engine's current capabilities.

Each evaluated question should have an auditable result in one of these categories:

| Result | Required evidence |
| --- | --- |
| `exact_verified` | Source-grounded solved geometry with its required mathematical obligations proved. |
| `qualitative_verified` | Correct source-grounded qualitative relations; no invented numeric measurement. |
| `question_representation` | Complete, faithful source setup with named limits; no implication that unsolved geometry is numerically certified. |
| Legitimate text-only | Independently reviewed as not needing a diagram, or source explicitly lacks the figure/evidence needed to reconstruct it. Record why. |
| Coverage gap | A valid diagram-required input is unsupported, wrong-family, incomplete, rejected incorrectly, badly rendered or fails persistence/replay. Keep it in the gap denominator. |
| Source-quality exclusion | Unreadable/OCR-corrupt/incomplete source, with a stable exclusion reason. Report separately; never count it as a successful scene. |

Track at least three separate rates:

- **Supported required-visual coverage:** faithful committed scenes / independently identified, eligible required-visual questions. Report the tier breakdown and the full denominator.
- **Diagram accuracy:** correct and complete scenes / committed scenes, judged against source requirements and independent mathematics. Include family relevance and labels; primitive count is not a correctness score.
- **End-to-end reliability:** correctly presented, persisted and replayed verified scenes / eligible required-visual turns attempted in the live pipeline.

Report by subject, chapter, reusable family, representation tier and source-quality category. Include declines and false acceptances as well as successful scenes. Keep a holdout set that is not used to guide fixes. Require zero known false certifications; any wrong scene is an accuracy defect even when it increases apparent coverage.

### Existing numbers that must not be presented as full coverage

The old syllabus gate's 100% inventory result is 1,621/1,621 minimal operator/predicate demand checks, not end-to-end question coverage. Its 6,459 classified rows exclude 3,090 `not_diagram_led` rows and 1,748 `filtered_low_quality` rows. `not_diagram_led` can mean the old demand map has no entry for that unit; `filtered_low_quality` also uses `isDiagramWorthy`. Neither category independently establishes that a question should be excluded from the future required-visual denominator. Sets, complex numbers, statistics and probability require particular care here.

Other recorded snapshots use different cohorts: 17 representative unit compile probes, 31 depth probes, 80 seeded rejected mutations; bank family compile has 1,485 visualizable rows, with 1,170 scenes, 49 required misses and 266 honest text-only outcomes (required-visual denominator 1,219). A separate picture-class sample has 48 correct-class compiled outcomes out of 55 sampled, with 7 not compiled. These reports are diagnostics from the development tree, not a fresh measured coverage gain from the 67 operators. Scene counts alone do not establish exact/qualitative certification.

## Prioritized backlog for a later session

This table is a proposed order, not work currently running. Confirm the evaluation scope and priorities when resuming; reassess stale counts against current `main` first.

| ID / priority | Work | Completion evidence |
| --- | --- | --- |
| DCP-01 / P0 | Freeze an independent evaluation denominator and a result schema for source quality, diagram need, expected objects/relations, representation tier, relevance, proofs, labels, persistence and replay. | Reproducible versioned report with exclusions separated, chapter/family breakdowns and a holdout cohort. No success metric based only on ink count or existing operator inventory. |
| DCP-02 / P0 | Express required visual obligations from source evidence and structural ProblemIR. Detect missing named bodies, connections, given dimensions and spatial relations. | Wrong-family and partial-scene mutations reject; independently compiled honest representations preserve all supported source requirements. No topic templates or question-ID routing. |
| DCP-03 / P0 | Recheck the known live circuit, river-boat and free-body relevance cases; distinguish wrong family, no ink, stale scalar and persistence failures. | Live source-to-verified-scene-to-narrated-reveal tests plus saved-turn replay, with independent source obligations and no model-authored diagram ink. |
| DCP-04 / P0 | Reproduce and group the 49 recorded bank required misses and 63 probe declines by reusable mathematical gap. Resolve the baseline hard vertical-circle work-energy failure. | Each gap gets a source-grounded failure fixture, reusable solution and independent regression gate; original decline thresholds remain unchanged. Report source exclusions separately. |
| DCP-05 / P1 | Extend deterministic network and constrained-mechanics solvers: KCL/KVL networks, coupled bodies, rigid-body constraints and nonlinear motion cases. | Source laws compute the authority values and certify topology/contact/directions across parameter variations, degeneracies and incompatible inputs. |
| DCP-06 / P1 | Broaden fields and induction beyond explicit point sources/affine uniform laws: continuous distributions, Gauss-law geometry, current-element fields and supported varying flux. | Explicit assumptions, integration/domain bounds and independent field/flux oracles; no guessed charge distribution, loop/current or fabricated three-dimensional force. |
| DCP-07 / P1 | Compose optics and wave optics: multi-surface paths, instruments, interference/diffraction and polarization with source-defined topology. | Ray/phase laws, ordered contacts and expected observable relations proved; singular/incomplete setups decline honestly. Existing lens/mirror regressions stay green. |
| DCP-08 / P1 | Expand calculus and algebra: piecewise domains/continuity, integral and ODE curves, matrix systems, sequences/series and indexed combinatorial constructions. | Safe expression/domain contracts, exact or explicitly bounded numerical authority, bounded complexity and independent source equations. |
| DCP-09 / P1 | Broaden spatial geometry and compound regions/solids without flattening physical proofs. | World-frame incidence/distance/angle proofs, exact derived intersections/sections and dimensions tied to their source owner; upstream mensuration behavior preserved. |
| DCP-10 / P2 | Expand thermal/kinetic diagrams, modern physics, electronics and instruments according to the measured gap report. | Correct apparatus or level/state family, source-unit authority, supplied physical assumptions and no substitution of an unrelated network/graph. |
| DCP-11 / P2 | Review the existing chemistry and DSA lanes under the same completeness, proof, label, persistence and replay schema. Add reusable gaps only where the frozen supported-syllabus scope requires them. | Subject-specific independent oracles and live/replay checks; formula/trace authority preserved. The 25 math/physics chapters do not count as chemistry/DSA coverage. |
| DCP-12 / P0 release gate | Certify composite questions and the complete live turn lifecycle, then rerun the frozen corpus and holdout. | No known wrong certifications, reproducible tier-specific coverage report, readable in-zone scenes, correct reveal ownership, successful atomic commit/persistence/replay and required repository/CI checks. |

The old miss distribution can help choose the first investigation, but must be refreshed: recorded concentrations include magnetic unit 13 (19 misses), modern physics unit 17 (10) and coordinate geometry unit 10 (6). A miss count is a triage signal, not permission to add a chapter router.

## Resume checklist and working protocol

1. Read this file, `AGENTS.md`, [session ownership](docs/agent/session-ownership.md), the linked priority/architecture plans and the current coverage report. Fetch current `main`; do not reuse this session's old base blindly.
2. Reproduce the baseline and freeze DCP-01's evaluation contract before claiming progress toward full coverage. Separate parser/source-quality defects from mathematical, representation, rendering and persistence gaps.
3. Choose a reusable gap from the measured report. Assign chapter/family workers distinct modules and dedicated gates. Keep shared compiler/document/capability/planner integration under one owner; announce before editing shared paths.
4. Build a thin vertical slice: explicit input contract → deterministic authority → geometry and proof obligations → numeric-label checks → planner availability → compiler → actual rendered scene → persistence/replay where relevant.
5. Use independent equations and metamorphic/parameter variations, not implementation-mirroring tests. Test invalid documents through the live atomic compiler and assert no partial scene.
6. Build shared packages before tutor checks. Run focused gates first; broaden when shared changes or new failures justify it. Add no dependencies or validator exceptions solely to make fixtures pass.
7. Render and inspect examples; use real browser/live tutor tests when available. Record when a result is offline only. Use a disposable DB for DB gates; do not point tests at production.
8. Re-run the frozen evaluation and holdout, record changed denominators/tiers, and preserve baseline failures explicitly. Never raise a threshold or relabel a miss as text-only just to obtain green output.
9. Update this root plan and the detailed report with results, remaining gaps and a concrete resume seed; review, open a scoped PR and merge only after the applicable checks pass.

## Reproduction commands

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm rebuild @prisma/client @prisma/engines esbuild prisma
pnpm --filter @heytutor/tutor exec prisma generate
pnpm --filter @heytutor/scene-engine build
pnpm --filter @heytutor/tutor-core build
pnpm --filter @heytutor/scene-engine verify:coverage
pnpm --filter @heytutor/tutor-core verify:coverage
pnpm --filter @heytutor/scene-engine verify
pnpm --filter @heytutor/tutor-core verify
pnpm typecheck
pnpm lint
pnpm build
```

The monolithic tutor-core command stops at its first failure; use individual gates to establish the complete result when a known baseline failure remains. Full tutor verification requires an isolated test `DATABASE_URL`. See [deploy runbook](docs/ops/ci-cd.md) for the repository's required PR checks and production deployment path. Merging to `main` triggers the repository deployment workflow; this document does not assert that the deployment has completed.

## Immediate handoff

Completed operators and guards passed the publication integration checks above. **Further full-coverage implementation is intentionally paused.** The next substantive task, when the user resumes, is DCP-01: establish a trustworthy coverage denominator and independent source obligations, then select a measured reusable gap. Do not spend another session adding chapter operators without measuring how they improve source-faithful, end-to-end diagrams.
