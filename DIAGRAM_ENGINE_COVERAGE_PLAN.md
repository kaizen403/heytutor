# Diagram engine coverage plan and session record

Updated: 2 October 2026. Status: **25-chapter expansion complete; further coverage work paused at the user's request.**

Publication: [PR #80 — Expand verified diagram operators across 25 chapters](https://github.com/kaizen403/heytutor/pull/80).

This is the review and resume document for the reusable scene-operator expansion. The user asked to publish the completed work through a PR and merge it to `main`, then leave a documented path toward full coverage. Do not start the future backlog until the user resumes it.

**DSA is discontinued.** It is not in this coverage at all. Do not work on anything DSA.

## What was requested and completed

The first request covered fifteen chapters. The extension added ten more while the original checks continued. Each chapter received a separate implementation and accuracy gate, with chapter workers reused in waves because the runtime allowed three workers alongside the parent. Shared compiler, validation, capabilities, planner contracts and final integration remained under parent ownership. Workers used the requested fast model with xhigh reasoning.

The expansion adds **67 reusable operators across 25 chapters**. These operators expose explicit mathematical inputs; they do not look up a chapter or question to choose a picture. The live planner can request them, and deterministic validation and compilation establish whether the requested scene is admissible before any ink renders.

Catalog counts need their baseline:

- Development workspace: 61 → 128 canonical operators. The initial 61 included a pre-existing, uncommitted `solid_anchor` operator from another session.
- Publication branch initially based on `origin/main` at `ae6c166655bc937de36f57f9fd29ccc9c07d9cba`: **60 → 127**, adding the same 67 operators. The separate `solid_anchor` work is not included in this PR.
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

The branch also incorporates the landing-only `main` update at `ff6a35d`; its landing build passed again. The PR and its check history are the durable publication record. Merging `main` is authorized by the user; further coverage implementation remains paused.

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
| DCP-11 / P2 | Review the existing chemistry lane under the same completeness, proof, label, persistence and replay schema. Add reusable gaps only where the frozen supported-syllabus scope requires them. DSA is discontinued and is not in this coverage; do not work on it. | Subject-specific independent oracles and live/replay checks; formula/trace authority preserved. The 25 math/physics chapters do not count as chemistry coverage. |
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

Completed operators and guards passed the publication integration checks above. **Further full-coverage implementation is intentionally paused.** DSA is discontinued and is not in this coverage at all; do not work on it. The next substantive task, when the user resumes, is DCP-01: establish a trustworthy coverage denominator and independent source obligations, then select a measured reusable gap. Do not spend another session adding chapter operators without measuring how they improve source-faithful, end-to-end diagrams.

## Chapters still to cover

A chapter stays off this list only when the completed operators cover more than 90% of its admin topics. None do. The shares below are the inherited topic-to-operator inventory, not fresh measured question coverage or end-to-end certification. Coordinate Geometry has the largest recorded share, 15/29 (about 52%); Electrostatics is only 2/24 (about 8%). Finishing a few operators does not finish their chapter. A recorded 0 means no credit in that inventory, not proof that no existing engine capability can be reused.

**This is a delegation plan, not implementation in progress.** Keep all 34 chapters below in their existing order and priority. The DCP-01–DCP-12 backlog above is unchanged. DSA remains discontinued and outside every assignment. Chemistry and NEET Biology are separately identified expansion lanes below; their inclusion here does not certify current support or authorize workers to start.

**Coordinator:** start with [delegation and dependencies](#delegation-model-and-dependency-aware-execution), then the [packet acceptance contract](#universal-packet-contract-and-definition-of-done) and [assignment template](#copyable-agent-assignment). Use the topic tables as reference when filling a specific assignment. **Worker:** read your assigned row/slice, its exam boundaries and the acceptance contract; other subject catalogs are context only, not additional work assigned to you.

### Explicit topic-to-agent matrix and planned coverage

Before assigning a slice, use the [topic matrix index and chapter coverage tables](docs/plans/diagram-topic-matrix/index.md), then open only its subject file. Those tables map every existing primary and supplemental taxonomy topic ID to one primary packet, with exam-specific scope, proposed diagram need, source references, current-evidence status, required variants, independent acceptance tests and dependencies. Biology and additional Advanced Chemistry have separately versioned editorial checklists, not invented admin-topic counts.

**Planned allocation and implemented coverage are different numbers.** Assigning every topic gives 100% checklist allocation; it does not predict 100% successful diagrams. The index calculates each packet's unique topic share and the integer threshold needed to exceed 90% for each inherited core chapter. Existing chapter fractions remain historical aggregates: they cannot identify which topic rows have passed, so individual topic evidence stays **topic audit pending** until checked. Candidate operators/modules are reuse leads, not new certification.

The detailed matrix controls dispatch scope when the chapter descriptions below use broad phrases. Explicitly include charged-ring fields, conductor charge sharing, conducting-slab capacitors, translation of axes, latus rectum and the named optical variants rather than assuming a chapter heading includes them. Supplemental/unlisted topics remain visible and assigned, but stay outside an exam's accepted denominator unless that scope is selected. Workers return unresolved variants even if their packet's top-level topic count is complete.

### Scope, sources and how to read the assignments

The exam baseline is deliberately versioned to the official **2026** publications checked on 2 October 2026. Do not label this a 2027 syllabus or silently carry a deleted chapter into another exam's denominator. Recheck the official publications before execution and record any syllabus revision as a new evaluation version.

| Key | Primary source | Scope used here |
| --- | --- | --- |
| J | [NTA JEE Main 2026 syllabus page](https://jeemain.nta.nic.in/document/syllabus-2026/) and [official PDF](https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2025/10/202510311323551056.pdf) | Paper 1, B.E./B.Tech.: 14 Mathematics, 20 Physics and 20 Chemistry units. Paper 2 architecture/drawing/planning is not in this plan. |
| A | [JEE Advanced 2026 official syllabus](https://jeeadv.ac.in/documents/jee-advanced-2026-syllabus.pdf) | Mathematics, Physics and Chemistry, including the expressly listed Advanced-only extensions. The PDF states that the 2026 syllabus is unchanged from 2025. |
| N | [NMC NEET-UG 2026 syllabus, published by NTA](https://www.nta.ac.in/Download/Notice/Notice_20260108180635.pdf) | 20 Physics, 20 Chemistry and 10 Biology units. Mathematics is not a separate NEET subject. |
| N-FAQ | [NTA NEET-UG 2026 Information Bulletin](https://cdnbbsr.s3waas.gov.in/s37bc1ec1d9c3426357e69acd5bf320061/uploads/2026/02/202602231394640855.pdf), PDF p. 81 / printed p. 76, syllabus FAQ Q4 | Corrects the syllabus's “insect (Frog)” wording to “an insect and a frog”; use the current correction when scoping animal anatomy. |

The 34 core rows are the 20 Physics and 14 Mathematics admin units, not 34 entirely unsupported engine families. Physics topics are cross-checked against J/N and A; Mathematics against J/A. Chemistry C-01–C-20 follows J/N's unit numbering; Biology B-01–B-10 follows N's unit numbering. The exam-specific exceptions below override any broad subject label. Added teaching applications must be marked as applications of a listed concept, not misquoted as official syllabus headings.

`CH-01a`, `CH-01b`, and similar IDs are **human work-packet IDs only**. They must never become a runtime chapter registry, routing key, question template or fixture lookup. Each letter is an independently bounded slice to investigate, implement and certify; do not assign an entire long row as one unbounded task. The packet's independent oracle is part of its acceptance, not a suggestion to copy implementation formulas into tests.

### What is still to do — the 34-chapter core queue

The new audit counter is maintained through the [topic progress ledger and work logs](docs/plans/diagram-topic-matrix/progress.md). Its initial zero means no topic evidence has yet been accepted into this tracker, **not zero existing engine capability**. Audit already-supported topics before extending them; keep the historical fractions unchanged and update the new column after acceptance.

| Order | Priority | Chapter | Historical baseline | Accepted topics (new audit) | What is still to do |
| --- | --- | --- | --- | --- | --- |
| 1 | P0 | Kinematics | 6/14 | 0/14 — audit pending | **CH-01a:** relative-motion frames, river-boat along-stream/crossing/minimum-time/minimum-drift variants, rain-person and two-body relative velocity. **01b:** piecewise x–t/v–t/a–t graphs, average versus instantaneous quantities, signed area, slopes and turning points. **01c:** horizontal/oblique/inclined-plane projectiles, landing conditions and uniform circular-motion states. Reuse constant-acceleration authority; do not replace a river setup with two arbitrary arrows. Oracle: independent relative-vector equations, derivatives/integrals and landing intersections. |
| 2 | P0 | Current Electricity | 0/17 | 0/17 — audit pending | **CH-02a:** explicit terminal netlists, branch/junction/loop identity, series/parallel reductions, two-loop Kirchhoff networks and source polarity. **02b:** cells with internal resistance, emf versus terminal voltage, current/power/heating, drift velocity/mobility and resistance/resistivity versus temperature. **02c:** Wheatstone/metre bridges and Ohmic/non-Ohmic I–V data. Apparatus connections must survive narration and replay; a drawn crossing is not automatically a junction. Oracle: independent KCL/KVL residuals, equivalent resistance, bridge balance and power conservation. |
| 3 | P0 | Laws of Motion | 0/17 | 0/17 — audit pending | **CH-03a:** source-bound bodies, supports, contacts and free-body diagrams; concurrent-force equilibrium; paired action/reaction forces on different bodies. **03b:** friction direction, static inequality versus limiting/kinetic friction, rough inclines, connected blocks, strings and fixed/movable pulleys. **03c:** circular-road/banked-road force balance, lifts and accelerated-frame applications where in scope. Never assume impending motion or invent a normal/tension. Oracle: force balance per body, nonnegative contact reaction, string-length constraints and friction-regime consistency. |
| 4 | P0 | Work, Energy and Power | 0/16 | 0/16 — audit pending | **CH-04a:** reproduce the hard vertical-circle failure; tension/contact, critical speeds and loss-of-contact conditions must agree with energy. **04b:** constant/variable-force work, signed F–x area, conservative potential/force curves, spring energy, frictional loss and instantaneous/average power. **04c:** impulse–momentum views and before/after states for 1D/2D elastic/inelastic collisions. Oracle: independent work integrals, energy/momentum balance and restitution; reject physically incompatible supplied states instead of drawing a plausible trajectory. |
| 5 | P0 | Magnetic Effects of Current and Magnetism | 1/23 | 0/23 — audit pending | **CH-05a:** current sources and Biot–Savart/Ampere geometry for straight wires, circular loops/coils, axial fields and long solenoids. **05b:** charged-particle circular/helical motion, crossed-field applications, forces on wires/parallel currents and current-loop torque/dipole moment. **05c:** moving-coil galvanometer, sensitivity, shunt/series conversion; bar-magnet axial/equatorial fields and dia/para/ferromagnetic comparisons for J/N. Existing Lorentz-force vectors are only a seed. Oracle: signed cross products, symmetry, limiting field formulas and torque; page-normal glyphs cannot certify planar incidence. |
| 6 | P0 | Coordinate Geometry | 15/29 | 0/29 — audit pending | **CH-06a:** straight-line forms, intercepts, section/distance formulas, translation of axes, concurrence, intersections, angles and perpendicular feet. **06b:** source-defined loci, angle bisectors and line families; chords, normals, circle–line/circle–circle compositions and circles through intersections, with Advanced-only scope tagged. **06c:** composed conic tangents/normals, parametric contacts, latus rectum and triangle-center constraints beyond isolated constructions. Do not reimplement existing conics/circles. Oracle: equation substitution, incidence, metric distance and locus completeness, including vertical lines, tangencies and degeneracies. |
| 7 | P1 | Rotational Motion | 3/17 | 0/17 — audit pending | **CH-07a:** centre of mass of particles/extended bodies, inertia of supported simple bodies, parallel/perpendicular axes and radius of gyration. **07b:** rigid-body equilibrium, angular momentum/conservation, fixed-axis dynamics and distributed torques. **07c:** rolling without slipping and point-mass/rigid-body collision applications for A. Couple contact constraints to CH-03/04, not just polar trajectories. Oracle: independent mass integrals or supported analytic inertia, world-axis identity, torque/angular-momentum balance, energy and no-slip constraints. |
| 8 | P1 | Electrostatics | 2/24 | 0/24 — audit pending | **CH-08a:** electric dipoles, axial/equatorial fields, torque/energy and source-grounded field/equipotential relations. **08b:** continuous charge distributions, charged-ring axial fields and Gaussian surfaces for a line, infinite sheet and thin spherical shell, with boundary/interior cases. **08c:** potential and energy of charge systems; conductors/charge sharing, polarization, parallel-plate capacitors with dielectrics or conducting slabs, series/parallel networks, stored energy and battery-connected versus isolated changes. Point-charge fields do not close any of these slices. Oracle: independent superposition/integration, Gauss flux, potential gradients and charge/energy accounting. |
| 9 | P1 | Electromagnetic Induction and Alternating Currents | 6/14 | 0/14 — audit pending | **CH-09a:** oriented loops, changing field/area/angle, supported motional emf, Lenz polarity, eddy-current representations for J/N and induced current only with a supplied closed circuit. **09b:** self/mutual inductance, magnetic energy and coupled coils; RC/LR/LC transients for A. **09c:** series RLC resonance, RMS/peak/phase/power, frequency response, generators and ideal transformers for J/N. Compose existing affine flux and impedances rather than claiming them as apparatus coverage. Oracle: flux derivatives, KVL, energy and turn ratios; singular ideal resonance must not yield fabricated finite current. |
| 10 | P1 | Optics | 2/27 | 0/27 — audit pending | **CH-10a:** reflection/refraction at ordered plane/spherical interfaces, slabs, apparent depth, total internal reflection/optical fibre, prisms/deviation/dispersion. **10b:** mirror–lens/lens–lens systems, lens-maker/power relations, ray contacts, real/virtual images and magnification; microscopes/telescopes for J/N. **10c:** Huygens wavefronts, YDSE path/phase/slab/angular-fringe variants, single-slit diffraction and polarization/Brewster/Polaroid applications; thin films/resolving power remain explicitly scope-tagged supplemental topics in the matrix. Gaussian image anchors alone do not prove ray paths. Oracle: independent Snell/reflection/image laws, contact order and phase/intensity relations; no ray may pass through the wrong medium. |
| 11 | P1 | Limit, Continuity and Differentiability | 6/18 | 0/18 — audit pending | **CH-11a:** domains, piecewise graphs, one-sided limits, removable/jump/infinite discontinuities, open/closed endpoints and continuity. **11b:** differentiation of composite/implicit functions, first/second derivatives, cusps/corners, vertical tangents and normals. **11c:** monotonicity, extrema with endpoints, rates/related rates; Rolle/Lagrange MVT, intermediate-value applications and L'Hospital limits for A. Reuse analytic derivatives. Oracle: symbolic identities or independently bounded evaluations plus domain hypotheses; a connected polyline cannot certify continuity across a hole or pole. |
| 12 | P1 | Integral Calculus | 0/13 | 0/13 — audit pending | **CH-12a:** antiderivative families and fundamental-theorem relationships; substitution, parts and partial-fraction applications where a visual helps. **12b:** Riemann sums, signed definite area versus geometric area, regions between curves, correct intersection/partition bounds and piecewise integrands. Symmetry/definite-integral properties must retain the domain. Volumes of revolution are supplemental, not automatically J/A coverage. Oracle: independent antiderivatives or error-bounded quadrature and region membership; never fill across an undefined interval or count unsigned area as a signed integral. |
| 13 | P1 | Differential Equations | 0/8 | 0/8 — audit pending | **CH-13a:** order/degree and formation from families, separable and first-order homogeneous equations. **13b:** linear first-order equations, particular solutions from initial conditions, solution-family curves and bounded slope-field representations. **13c:** growth/decay and other explicitly stated application models. No general-purpose ODE promise: name supported forms and singular domains. Oracle: substitute each displayed solution into the differential equation and initial condition; numerical curves need method, interval and an independently checked error bound. |
| 14 | P1 | Matrices and Determinants | 0/14 | 0/14 — audit pending | **CH-14a:** readable source-bound matrix grids, dimensions/types, addition/product/transpose and noncommutativity examples. **14b:** 2×2/3×3 determinants, minors/cofactors, adjoint/inverse, singularity and triangle-area interpretation. **14c:** two/three-variable systems, consistency, unique/infinite/no solutions, row/column operations for A and geometric line/plane interpretation. Affine transforms are not a matrix-system solver. Oracle: exact arithmetic where available, multiplication/inverse identities, equation residuals and determinant/area agreement; do not draw a unique intersection for an inconsistent system. |
| 15 | P1 | Sequence and Series | 0/10 | 0/10 — audit pending | **CH-15a:** AP/GP indexed terms, inserted means and source-defined discrete plots. **15b:** finite sums/partial sums and A's infinite GP with its convergence condition; sums of natural numbers/squares/cubes in A. **15c:** AM–GM applications with their positive-domain assumptions. Preserve discrete versus continuous meaning; a connecting stroke does not create values at noninteger indices. Oracle: independent term/sum identities, direct small-case enumeration and convergence/domain checks. General convergence tests are supplemental. |
| 16 | P1 | Binomial Theorem and its Simple Applications | 0/8 | 0/8 — audit pending | **CH-16a:** positive-integer-index expansions, coefficient rows/Pascal construction, term indexing and general/middle terms. **16b:** coefficient extraction, symmetry, sums/identities and binomial-coefficient properties for A. Use bounded indexed algebra, not a picture for each expression. Oracle: exact combinatorial coefficients, direct expansion at small n and substitution equality; reject unsupported fractional/negative-index infinite expansions rather than borrowing the finite construction. |
| 17 | P1 | Permutations and Combinations | 2/9 | 0/9 — audit pending | **CH-17a:** fundamental counting principle, ordered versus unordered selections and restrictions. **17b:** arrangements/selections with repeated objects, slots/groups and bounded case trees as applications of counting principles. **17c:** connect event counts to probability without multiplying over dependent choices. Reuse cycles/subset lattices where relevant; they do not prove every counting answer. Oracle: independent enumeration on small instances and bijection/count formulas; overlapping cases must not be counted twice. Bound factorial-size diagrams before rendering. |
| 18 | P1 | Three-Dimensional Geometry | 6/14 | 0/14 — audit pending | **CH-18a:** coordinates, section formula, direction ratios/cosines and line equations in a consistent world frame. **18b:** intersecting/parallel/skew lines, angles and shortest-distance compositions beyond isolated feet. **18c:** plane equations, point–plane distance, line–plane/plane–plane angles and coplanarity for A. Keep J's line-only scope separate from A's planes. Oracle: world-coordinate incidence/dot products/distances, normalized direction checks and frame compatibility; projected crossing or apparent angle is never a spatial proof. |
| 19 | P1 | Properties of Solids and Liquids | 5/27 | 0/27 — audit pending | **CH-19a:** shear/bulk strain and constitutive assumptions; labelled stress–strain regimes without inventing a material's measured curve. **19b:** Pascal devices, layered pressure/manometers, continuity/Bernoulli applications, viscosity/Stokes terminal speed and laminar/turbulent distinctions. **19c:** surface tension, contact angle, capillary rise, drops/bubbles and excess pressure. **19d:** expansion, calorimetry/latent-heat curves, conduction/convection/radiation and explicit thermal apparatus. Oracle: pressure/force/flow/heat balance and interface conditions. Do not include Poiseuille's equation in A; a hydrostatic plot is not flow coverage. |
| 20 | P2 | Thermodynamics | 5/12 | 0/12 — audit pending | **CH-20a:** state variables, zeroth-law/thermal-equilibrium representations, first-law heat/work/internal-energy accounting and piston/process assumptions. **20b:** composed isothermal/adiabatic/isobaric/isochoric cycles, signed work and reversible versus irreversible paths. **20c:** second-law heat reservoirs, Carnot engine/efficiency and engine/refrigerator teaching applications with exam tags. Existing PV graphs lack these thermal obligations. Oracle: independent process laws, loop orientation/work, first-law closure and second-law bounds; temperature, heat or γ must not be inferred from an unlabeled curve. |
| 21 | P2 | Kinetic Theory of Gases | 0/11 | 0/11 — audit pending | **CH-21a:** gas ensemble/container and momentum-transfer representations, pressure/temperature/ideal-gas relations. **21b:** degrees of freedom, equipartition and monoatomic/diatomic heat capacities. **21c:** RMS speed and mean-free-path representations; speed distributions and mean/most-probable comparisons belong explicitly to A chemistry and must be tagged if used here. Oracle: independent state/count/unit relations and normalized distributions when quantitative. A few illustrative particles are not an exact microstate or proof of the measured pressure. |
| 22 | P2 | Dual Nature of Matter and Radiation | 0/8 | 0/8 — audit pending | **CH-22a:** photoelectric apparatus, electron collection/polarity, photocurrent versus voltage and changes in intensity/frequency. **22b:** stopping potential, threshold frequency/work function, maximum kinetic-energy/frequency plots and photon balance. **22c:** de Broglie wavelength versus momentum/kinetic energy and stated matter-wave applications. The 10 recorded misses are a historical triage signal, not a fresh count. Oracle: independent energy equations, thresholds and axis units; a generic energy ladder cannot replace a photoelectric circuit or characteristic curve. |
| 23 | P2 | Atoms and Nuclei | 0/12 | 0/12 — audit pending | **CH-23a:** Rutherford-scattering setup/qualitative paths, Bohr hydrogen-like levels, transitions and spectral-series relationships. **23b:** nuclear composition/radius, mass defect, binding-energy-per-nucleon curve, balanced fission/fusion and Q-values from supplied masses. **23c:** A's α/β/γ radiation, exponential decay, half-life/mean life; characteristic/continuous X-rays and Moseley's law. Oracle: independent transition energies, charge/nucleon conservation and decay equations. Tag Bohr orbits as model diagrams, not literal electron trajectories; do not infer nuclide masses from display geometry. |
| 24 | P2 | Electronic Devices | 0/14 | 0/14 — audit pending | **CH-24a:** intrinsic/extrinsic semiconductor and p–n junction qualitative structures, forward/reverse bias, diode I–V and rectifier input/output waveforms. **24b:** LED, photodiode, solar cell, Zener I–V and regulation from an explicit source/load circuit. **24c:** AND/OR/NOT/NAND/NOR symbols, truth tables and bounded combinational networks. This is J/N coverage, not an A Physics chapter. Oracle: independently evaluated truth tables, explicit ideal/real device model and circuit polarity. Transistors/amplifiers are supplemental; never invent a real component's characteristic constants. |
| 25 | P2 | Experimental Skills | 0/33 | 0/33 — audit pending | **CH-25a:** Vernier/screw-gauge scales, zero corrections and readings; moment-balance/Young's-modulus apparatus. **25b:** pendulum energy-loss graphs, capillary/detergent setup, terminal-speed viscosity, resonance tube and calorimetry. **25c:** metre bridge/Ohm/half-deflection galvanometer, mirror/lens parallax, prism deviation, travelling-microscope slab and diode/Zener curves/component identification for J/N; A's listed u–v and post-office-box variants separately. Each apparatus needs connections, observation columns, units and derived result. Oracle: independent scale arithmetic or experimental law, not instrument resemblance. |
| 26 | P2 | Electromagnetic Waves | 0/8 | 0/8 — audit pending | **CH-26a:** source-defined propagation direction with transverse E and B, phase and right-handed orientation. **26b:** wavelength/frequency relations and ordered electromagnetic-spectrum bands with uses; distinguish a schematic/log axis from metric band widths. **26c:** displacement-current concepts in J/N with explicit physical assumptions. Reuse curve rendering, not mechanical-wave semantics. Oracle: orthogonality, cross-product direction and c = λf; a 2D sinusoid alone cannot establish the 3D field relationship. |
| 27 | After the gap report | Oscillations and Waves | 6/21 | 0/21 — audit pending | **CH-27a:** spring networks, restoring force, pendulum geometry/approximations and SHM kinetic/potential/total energy. **27b:** longitudinal/transverse/reflected waves, fixed/free boundaries, string/organ-pipe standing modes, nodes/antinodes, harmonics and beats. **27c:** A's forced/damped oscillation, resonance and sound Doppler with specified source/observer frames. Existing time laws and travelling-wave sums are not boundary-condition coverage. Oracle: independent phase/boundary/mode equations and energy; reject impossible pipe modes and do not reverse Doppler signs. |
| 28 | After the gap report | Gravitation | 2/14 | 0/14 — audit pending | **CH-28a:** g versus altitude/depth with supplied Earth model; field/potential/energy graphs and shell/bulk assumptions where supported. **28b:** circular-orbit speed/period/energy, escape speed and geostationary constraints. **28c:** Kepler-law swept-area and ellipse representations without promising an unsupported arbitrary-orbit solver. Oracle: independent inverse-square/circular-orbit laws, dimensions and source-specific Earth interior assumptions; an ellipse alone does not certify elapsed orbital time. |
| 29 | After the gap report | Sets, Relations and Functions | 4/10 | 0/10 — audit pending | **CH-29a:** finite Cartesian products, ordered-pair tables/relation graphs and equivalence partitions; reflexive/symmetric/transitive checks where applicable. **29b:** domain/codomain/range, one-one/into/onto mappings, composition and inverse existence. **29c:** graph transformations, even/odd functions and absolute-value/greatest-integer examples in A; link piecewise/domain work to CH-11. Oracle: independent finite-set membership and mapping properties. Existing Venn regions do not prove a relation or function, and unfilled codomain nodes cannot be silently removed. |
| 30 | After the gap report | Complex Numbers and Quadratic Equations | 7/14 | 0/14 — audit pending | **CH-30a:** quadratic roots, discriminant/nature of roots, coefficient relations, constructing equations and real-root parabola interpretations. **30b:** Argand loci, principal argument, conjugation, geometric modulus/triangle inequality and cube-root-of-unity compositions beyond isolated points. **30c:** symmetric root functions and A's stated algebra relationships. Oracle: exact polynomial substitution/Vieta identities and locus conditions; nonreal roots cannot be drawn as real x-intercepts. Preserve the already verified complex-transform/root authority. |
| 31 | After the gap report | Vector Algebra | 3/10 | 0/10 — audit pending | **CH-31a:** 2D/3D components, unit vectors, dot products, angles and signed projections. **31b:** cross products, orientation and parallelogram/triangle area. **31c:** scalar/vector triple products and coplanarity/volume for A, linked to CH-18 world frames. Oracle: independent component calculations and algebraic identities; reject undefined normalization/angles of zero vectors. Display-scaled arrows and flattened 3D projections cannot certify lengths, areas or handedness. |
| 32 | After the gap report | Statistics and Probability | 2/12 | 0/12 — audit pending | **CH-32a:** grouped/ungrouped tables, mean/median/mode, mean deviation, variance/standard deviation and same-mean/different-spread comparisons. **32b:** explicit sample spaces/events, conditional probability, independence, total probability/Bayes and counting-linked probability. **32c:** discrete random-variable distributions, mean/variance and normalized mass plots. Oracle: independent weighted calculations, finite enumeration and probability normalization; label grouped-data estimates honestly. Unequal-bin histogram area, Venn membership and probability trees alone do not certify these calculations. |
| 33 | After the gap report | Trigonometry | 1/10 | 0/10 — audit pending | **CH-33a:** unit-circle/radian relations and periodic sin/cos/tan graphs with asymptotes/domains. **33b:** addition/multiple/submultiple identities and general trigonometric-equation solution families for A. **33c:** inverse-trig principal branches/domains/ranges and triangle-law applications when the source requires them. Oracle: independent identity/angle equations and branch checks. Reuse triangle constructions; a drawn acute triangle cannot prove a principal-value result outside its domain, and sampling must not connect across tangent poles. |
| 34 | After the gap report | Units and Measurements | 0/13 | 0/13 — audit pending | **CH-34a:** independent diagram-need classification; dimensional relationships, significant figures, least count and source-unit conversions. **34b:** uncertainty/error propagation, data/graph error bars and repeated-measurement representations only when evidence is supplied. **34c:** source-bound instrument reading contracts shared with CH-25. Oracle: dimensions, conversion/rounding arithmetic and declared uncertainty rules. Many calculation-only questions legitimately stay text-only; never add a ruler or arbitrary error bars solely to improve the apparent coverage percentage. |

### Exam-specific boundaries that workers must preserve

| Topic | Scope decision for this plan |
| --- | --- |
| 3D planes, triple products and Advanced calculus theorems | Plane equations/angles/distances, scalar/vector triple products, Rolle/Lagrange MVT and L'Hospital are expressly in A. Do not count them as J's line-only 3D unit or invent a NEET Mathematics unit. |
| Doppler and forced/damped oscillation | Explicit A Physics requirements. J/N's 2026 oscillations/waves wording covers SHM, standing waves and beats but does not list these as standalone requirements. |
| Heat engines and radiation laws | A expressly lists Carnot efficiency, Newton cooling, Wien/Stefan/Kirchhoff radiation laws. Keep J/N second-law coverage separate from these extensions; refrigerator/COP teaching applications require their own scope label. |
| Nuclear decay and X-rays | A explicitly lists radioactive decay, half/mean life, characteristic/continuous X-rays and Moseley's law. J/N atoms/nuclei requirements do not make every one of these a shared chapter obligation. |
| Electronics and optical instruments | J/N include semiconductor devices/logic gates and microscopes/telescopes. These are not listed in A's 2026 Physics syllabus. Transistors, transistor amplifiers and communication systems remain supplemental unless a later official scope includes them. |
| Fluid viscosity | A expressly excludes Poiseuille's equation. It is not a hidden completion requirement for CH-19. |
| Advanced physical-model limits | A restricts wave motion to plane waves, heat conduction to one dimension and first-law applications to ideal gases. A Chemistry thermodynamic work is PV only. Broader models need a separately declared supplemental contract. |
| Chemistry legacy versus Advanced | Gases/liquids, solid state, surface chemistry, Hydrogen, s-block, metallurgy, environmental chemistry, polymers and chemistry in everyday life remain explicit A headings. Do not call them deleted from all exams just because J/N lack the corresponding standalone units. |
| Organic stereochemistry | A includes enantiomers/diastereomers/meso for up to two asymmetric centres and Newman ethane/butane conformations, but expressly excludes R/S and E/Z configurations. Its stated addition/elimination treatment also excludes the stereochemistry specified in that restriction. General J/N stereoisomerism wording is not a license to invent an exhaustive CIP assignment. |
| Advanced chemical-model limits | A's homonuclear MO scope runs up to Ne₂; empirical/molecular-formula determination in Organic Principles is combustion-method only. A excludes the benzyne mechanism/cine substitution in Haloarenes, but explicitly includes nucleophilic-substitution stereochemical aspects in Alkyl Halides. Do not interpret the configuration exclusions as a ban on all stereochemistry. |
| NEET plant/human physiology and ecology | N's Plant Physiology lists photosynthesis, respiration and growth/development; its Human Physiology does not list human digestion as a standalone topic. Plant transport/mineral nutrition, human digestion, sense-organ chapters, ecological succession/nutrient cycles and a general environmental-issues chapter are supplemental unless separately grounded in the selected scope. Necessary transport structures or frog digestive anatomy can still belong to their explicitly listed units. |
| NEET animal-example correction | N Biology Unit 2 prints “an insect (Frog)”, but N-FAQ Q4 corrects this to **an insect and a frog**. Include both brief system accounts; choose and cite the insect reference rather than treating frog as an insect or leaving the whole slice blocked. |

#### Experimental Physics inventory for CH-25

J/N's 18 listed activities must remain individually traceable even if their figures share operators. The following is an acceptance checklist, not a claim that any apparatus is newly implemented:

1. Vernier calipers: internal/external diameter and vessel depth.
2. Screw gauge: thin-sheet thickness or wire diameter.
3. Pendulum energy dissipation: amplitude squared versus time.
4. Metre-scale moment balance to determine mass.
5. Young's modulus of a metallic wire.
6. Capillary surface tension and detergent effects.
7. Viscosity from a sphere's terminal speed.
8. Resonance-tube speed of sound at room temperature.
9. Solid/liquid specific heat by mixtures.
10. Wire resistivity using a metre bridge.
11. Wire resistance using Ohm's law.
12. Galvanometer resistance/figure of merit by half deflection.
13. Convex-mirror, concave-mirror and convex-lens focal lengths by parallax.
14. Prism deviation versus incidence angle.
15. Glass-slab refractive index using a travelling microscope.
16. Forward/reverse p–n junction characteristic curves.
17. Zener characteristic and reverse breakdown voltage.
18. Diode/LED/resistor/capacitor identification from given specimens or source images.

A's separate General list is Vernier/screw-gauge measurements, **g from a simple pendulum**, Young's modulus, capillary/detergent surface tension, liquid specific heat by calorimeter, concave-mirror/convex-lens focal lengths by **u–v**, resonance-column sound speed, Ohm verification with voltmeter/ammeter, and wire specific resistance by metre bridge/**post office box**. Its listed measurement methods/error analysis belong to these experiments. Do not count a J/N parallax setup as evidence for an A u–v setup without checking the actual observation contract.

### Chemistry expansion — audit the existing lane before adding capabilities

Chemistry already has 13 documented families; this is not a greenfield rewrite. Read [chemistry lessons](docs/agent/chemistry-lessons.md), the current implementations in `packages/scene-engine/src/chemistry/` and their gates. Audit actual full-source stems and accepted documents first. Reuse formula parsing, electron configuration, molecular topology and numeric authority. Do not extend cue regexes or the legacy router as the mechanism for new coverage; any required selection/interface change belongs to the integration owner under the repo's authority rules.

No chemistry percentage is available from the inherited 34-row queue. Mark every C packet **audit pending**, not 0% and not complete. C-01–C-20 describes J/N's common unit headings; specific A additions/restrictions still need per-topic tags. These packets enter the execution queue through DCP-11 after scope/evaluation is frozen; they do not reorder the 34 core chapters.

| Packet / syllabus unit | Topics and figures to audit or extend | Independent acceptance obligation |
| --- | --- | --- |
| C-01 · Basic concepts | **a:** mole/particle/mass relationships and percentage composition. **b:** empirical/molecular formulas, balanced stoichiometry and limiting/excess-reagent applications. Use bounded species/count or mass-balance views when helpful, not arbitrary molecules for arithmetic. | Atom/charge/mass conservation and independent stoichiometric calculations; declare an illustrative particle count as nonmetric. |
| C-02 · Atomic structure | **a:** Hydrogen/Bohr levels, spectra and wave–particle relations. **b:** quantum numbers, electron filling, s/p/d shapes and nodes. **c:** Ψ versus Ψ²/radial interpretations. Audit `chem_orbital` and shared level diagrams before expansion. | Electron counts/charges, allowed quantum numbers, independent transition energies and clearly distinguished wavefunction, density and probability plots. Never depict an orbital as a classical path. |
| C-03 · Bonding and molecular structure | **a:** Lewis/formal charge/resonance. **b:** VSEPR, orbital overlap/hybridization, dipole vectors and hydrogen bonding. **c:** MO diagrams through supported diatomics, bond order/magnetism. **d:** ionic/lattice-enthalpy and Fajan-rule representations. Audit `chem_lewis`, `chem_vsepr`, `chem_mo`. | Valence-electron conservation, molecular connectivity, electron-domain versus molecular geometry, charge and MO occupancy. Qualitative bond angles must not masquerade as measured exact values. |
| C-04 · Chemical thermodynamics | **a:** Hess cycles, reaction/phase enthalpies, calorimetry and Born–Haber cycles. **b:** entropy/Gibbs/spontaneity and explicitly parameterized energy diagrams. Reuse `chem_thermo` and physical PV/process primitives. | Independent energy-cycle closure, sign/state conventions and ΔG/ΔH/ΔS units. Without given energy data, retain a qualitative tier; do not infer barriers from reaction names. |
| C-05 · Solutions | **a:** concentration, Raoult/ideal and nonideal graphs and vapour pressure. **b:** colligative properties, osmotic pressure and van't Hoff-factor association/dissociation. **c:** Henry's law, listed in J/N Equilibrium U6 and A Solutions; its local taxonomy location does not change that exam scope. Audit `chem_solutions`. | Independently computed compositions, limiting cases and colligative relations; distinguish supplied nonideal data from an illustrative deviation curve. |
| C-06 · Equilibrium | **a:** Kc/Kp, reaction quotient, equilibrium composition and Le Chatelier changes. **b:** pH/acid–base ionization, buffers and salt hydrolysis. **c:** common ion and solubility/precipitation. Audit titration support rather than counting it as the whole unit. | Independent mass/charge balances, equilibrium equations and explicit approximation validity; no positive concentration solution may be silently discarded or invented. |
| C-07 · Redox and electrochemistry | **a:** oxidation-number/electron accounting. **b:** galvanic/electrolytic cells, salt bridge, electron versus ion flow, polarity and Nernst. **c:** conductivity/dilution and Faraday electrolysis. **d:** batteries/fuel cells/corrosion. Audit `chem_electrochem`. | Balanced redox, explicit cell connectivity/conditions, independent emf and deposited amount; distinguish spontaneous galvanic polarity from driven electrolysis. |
| C-08 · Chemical kinetics | **a:** rate/order/molecularity, zero/first-order plots and half-life. **b:** Arrhenius/Ea and catalyst profiles. Audited existing second-order plots remain extension support, not mandatory J/N/A integrated-law coverage. | Independent integrated-law/half-life values, slope signs, temperature units and correct axis transforms. Parallel/sequential mechanisms require an explicit supported law rather than a guessed curve. |
| C-09 · Periodicity | **a:** period/group/block placement and configurations. **b:** atomic/ionic radii, ionization/electron-gain enthalpy, electronegativity and oxidation/valence/reactivity comparisons. Audit `chem_periodic`. | Versioned property data, correct species/charge and stated trend exceptions; a qualitative arrow is not a quantitative measured ordering without an oracle. |
| C-10 · p-block | **a:** J/N group 13–18 configurations/general trends and first-element anomalies. **b:** A's named compounds/allotropes/oxoacids/interhalogens/xenon species and reaction relationships, split further by supported structure class. Audit existing structural families. | Exact composition/connectivity where supported, balanced transformations and exam-specific species lists; no unsupported structure from a partially parsed formula. |
| C-11 · d- and f-block | **a:** configurations, oxidation states and spin/magnetic trends. **b:** lanthanoid/actinoid comparisons. **c:** chromium/manganese compound reactions/structures within scope. Use tables/structures only when they support the asked comparison. | Electron/oxidation-state accounting, versioned chemical facts and balanced redox; colours and stability are qualitative unless independently sourced. |
| C-12 · Coordination compounds | **a:** entity/nomenclature parsing, ligands/denticity/chelation and geometry. **b:** structural/geometrical/optical isomers. **c:** VBT/CFT splitting and spin/magnetic moment. **d:** supported metal carbonyls for A. Audit `chem_coordination`/`chem_cft`. | Charge/coordination number, complete bounded isomer enumeration and ligand identity; independent occupancy/CFSE checks where quantitative. Geometric projections must preserve stereochemical distinctions. |
| C-13 · Organic purification/characterisation | **a:** crystallization/sublimation/distillation/extraction/chromatography apparatus. **b:** qualitative N/S/P/halogen detection and basic quantitative C/H/N/halogen/S/P analysis in J/N, with empirical/molecular-formula evidence; A has its own narrower analysis requirements. | Source-specified separation principle and apparatus connectivity; atom/mass accounting for quantitative analysis. Chromatogram peaks/Rf values require supplied observations, not decorative output. |
| C-14 · Organic principles | **a:** fully resolved IUPAC/skeletal structures and structural/stereoisomers. **b:** σ/π/hybridization, resonance/inductive/electromeric/hyperconjugative effects. **c:** bond cleavage/intermediates and acidity/basicity. A adds bounded stereochemical relationships with the restrictions above. | Atom connectivity/valence/charge, isomer identity and stated electronic effects. Resonance is not equilibrium between different compounds; refuse partial parses or invented stereochemistry. |
| C-15 · Hydrocarbons | **a:** ethane Sawhorse/Newman conformations for J/N, ethane/butane Newman for A. **b:** alkane/alkene/alkyne preparation, substitutions/additions/eliminations, Markovnikov/peroxide, ozonolysis and polymerization applications. **c:** benzene/aromaticity and directing effects. Audit organic reaction schemes and reagent roles. | Balanced source-defined reaction relationships, complete reactant/reagent/product roles, conformation versus isomer identity and structural changes. Do not synthesize a product solely because one familiar reagent appears. |
| C-16 · Halogen compounds | **a:** C–X bond and supported substitution/elimination pathways, alkyl versus aryl behaviour. **b:** preparation/conversions and relevant environmental effects. Multi-step conversions need each stated intermediate/condition. | Atom mapping/valence, substrate identity and explicit mechanism scope. A curved arrow represents electron movement only if its source/target and electron accounting are validated. |
| C-17 · Oxygen compounds | **a:** alcohols/phenols/ethers and preparation/property comparisons. **b:** aldehydes/ketones/carbonyl additions, oxidation/reduction and named reaction applications. **c:** carboxylic-acid relationships and source-defined multi-step conversions. | Functional-group identity, balanced transformation and complete supported comparisons; do not turn answer options into a single asserted product. |
| C-18 · Nitrogen compounds | **a:** amines/basicity, preparation and identification. **b:** diazonium transformations/coupling and supported nitrile/nitro intermediates for the relevant exam. | Nitrogen connectivity/charge, reagent roles and balanced reaction; distinguish qualitative basicity comparisons from a computed equilibrium constant. |
| C-19 · Biomolecules | **a:** carbohydrate forms/linkages/anomers where listed. **b:** amino acids/peptides/protein levels. **c:** DNA/RNA components. **d:** vitamins/hormone classifications where a visual serves the question. Share audited structures with B-03/B-07, not anatomy templates. | Correct molecular linkage, monomer sequence and stereochemical scope. Structure-free recall legitimately stays text-only; a polymer segment cannot imply an unspecified complete molecule. |
| C-20 · Practical chemistry | **a:** organic element/functional-group tests. **b:** Mohr's salt/potash alum and listed organic preparations. **c:** acid/base and permanganate titrations. **d:** specified soluble-salt cation/anion analysis. **e:** solution/neutralization enthalpy, lyophilic/lyophobic sols and iodide–peroxide kinetics, split by experimental law. | Versioned official analyte/test lists, reagents/observations/branch order, balanced reactions and endpoint laws. Distinguish a qualitative decision flow from a fabricated laboratory measurement; A's separate analysis/test lists are not interchangeable. |

The C-20 preparation slice includes acetanilide, p-nitroacetanilide, aniline yellow and iodoform as listed by J/N. Freeze the salt-ion list from the original PDF before delegation: extracted subscripts/charges can be damaged. Insoluble salts are excluded in J/N's listed salt-analysis unit. Do not infer a precipitate colour, instrument reading or measured yield without a referenced chemical fact or source observation.

For C-20d, the J/N roster is **Pb²⁺, Cu²⁺, Al³⁺, Fe³⁺, Zn²⁺, Ni²⁺, Ca²⁺, Ba²⁺, Mg²⁺, NH₄⁺** and **CO₃²⁻, S²⁻, SO₄²⁻, NO₃⁻, NO₂⁻, Cl⁻, Br⁻, I⁻**. A's separate qualitative-analysis roster is **Ag⁺, Hg²⁺ (as printed), Cu²⁺, Pb²⁺, Fe³⁺, Cr³⁺, Al³⁺, Ca²⁺, Ba²⁺, Zn²⁺, Mn²⁺, Mg²⁺**, and nitrate, halides excluding fluoride, carbonate/bicarbonate, sulphate/sulphide. A's practical-organic tests additionally list **nitro** detection. Keep the two rosters/test obligations separate; do not silently “correct” a printed charge without a documented reference decision.

#### Additional Advanced Chemistry packets

These are explicit A headings, not nine extra J/N chapters and not part of the existing admin-topic fractions. Each requires a separately versioned A denominator. Useful figures within an otherwise factual chapter do not imply that every recall question needs a diagram.

| Packet | Bounded slices | Acceptance obligation |
| --- | --- | --- |
| CA-01 · Gases and liquids | Gas/partial-pressure laws, ideal versus van der Waals plots, kinetic-speed distributions/diffusion and intermolecular-potential/liquid-property comparisons. | Independent state/distribution laws and stated ideal/nonideal assumptions; qualitative intermolecular diagrams do not certify measured potential curves. |
| CA-02 · Solid state | Seven crystal systems, cubic/hcp close packing, coordination/voids, radius ratios and point defects. Audit `chem_unit_cell` before adding hcp/defect support. | World-cell geometry, occupancy/stoichiometry, packing/count proofs and defect charge neutrality; projected overlaps are not coincident lattice sites. |
| CA-03 · Surface chemistry | Adsorption/physisorption/chemisorption, Freundlich plots, colloid classifications/preparation/properties and emulsion/micelle illustrations within A's elementary scope. | Explicit isotherm parameters or honest qualitative plots; schematic aggregates are not measured particle-size distributions. |
| CA-04 · Hydrogen and s-block | Isotope/hydride comparisons, water/peroxide structure, named sodium/calcium compounds and specified preparation/reaction relationships. | Referenced chemical facts, complete formulas and balanced reactions. Do not demand invented figures for descriptive uses. |
| CA-05 · Metallurgy | Ore/concentration/extraction/refining flow, thermodynamic/Ellingham applications, electrochemical aluminium extraction and cyanide-process roles. | Explicit process ordering, balanced redox, phase/temperature assumptions and independently sourced energy data. |
| CA-06 · Environmental chemistry | Pollution sources/species, transport/control process relationships and green-chemistry examples. | Source-grounded causal/process graph without fabricated pollutant amounts or geographical distributions; recall may remain text-only. |
| CA-07 · Polymers and everyday chemistry | Addition/condensation and homo/copolymer repeat units, listed materials, soap/detergent cleansing and drug-target conceptual relationships. | Correct repeat-unit connectivity and monomer relation. A excludes the listed drug structures and asks only names for artificial sweeteners; do not invent those as mandatory visual tasks. |

### NEET Biology expansion — a new certification lane

The completed operator record does not establish Biology coverage. Start B packets with a syllabus/representation audit and a subject-specific authority contract, not a release claim. They must still compile through scene-engine and use its label/layout/reveal boundary. Molecular parts may reuse audited chemistry graphs; gross anatomy, microanatomy and developmental states need **curated, versioned reference evidence and checked topology**, not geometry guessed by the teaching model.

Reference data must describe subject objects, containment, connections, orientation and stage/species constraints independently of canvas coordinates. Reusable engine constructors derive presentation/layout from those facts; the reference corpus must not become a chapter-to-picture registry or fixed-pixel anatomy template. A subject reviewer checks the reference obligations separately from compiler/layout checks.

One B row can span several textbook chapters. Split it at the lettered boundaries below before assigning a worker. B-05's six organ-system slices, for example, must never be one agent's “implement human physiology” task. All B packets are **scope and baseline pending**; they do not replace or renumber the core queue.

| Packet / N Biology unit | Bounded topic and diagram slices | Independent acceptance obligation |
| --- | --- | --- |
| B-01 · Diversity | **a:** taxonomy hierarchy and five-kingdom comparison. **b:** representative Monera/Protista/Fungi/lichen/virus/viroid structures. **c:** algae/bryophyte/pteridophyte/gymnosperm features. **d:** nonchordate phyla/chordate classes with identifying body-plan traits. | Referenced taxonomic relationships and diagnostic structures; hierarchy is not automatically a phylogenetic tree or metric evolutionary distance. Species illustrations require a named reference, not a generic organism. |
| B-02 · Structural organisation | **a:** root/stem/leaf modifications and tissues/anatomical sections. **b:** inflorescence/flower/fruit/seed morphology and floral diagrams for the listed Malvaceae, Cruciferae, Leguminosae, Compositae and Gramineae families. **c:** animal tissues. **d:** brief insect and frog digestive/circulatory/respiratory/nervous/reproductive systems under the N-FAQ correction, split by organism/system at dispatch. | Correct section orientation, organ/tissue membership, vascular arrangement, floral whorls/fusion/ovary position and source labels. Do not certify drawing aesthetics as anatomy accuracy. |
| B-03 · Cells, biomolecules and division | **a:** prokaryotic/eukaryotic and plant/animal cells, membranes/walls, organelles, cilia/flagella/centrioles and nucleus. **b:** proteins/carbohydrates/lipids/nucleic acids and enzyme-action graphs. **c:** cell-cycle, mitosis/meiosis stages and chromosome/chromatid/ploidy changes. | Referenced organelle containment/connectivity and stage-dependent chromosome accounting; sister chromatids versus homologues must remain distinct. Enzyme curves need an explicit model/parameters if numerical. |
| B-04 · Plant physiology | **a:** chloroplast/pigments, light reactions, cyclic/noncyclic photophosphorylation and chemiosmosis. **b:** Calvin/C3/C4/photorespiration relationships and limiting-factor graphs. **c:** glycolysis/fermentation/TCA/ETS, amphibolic paths, ATP conventions and respiratory quotient. **d:** germination, growth curves/differentiation and auxin/gibberellin/cytokinin/ethylene/ABA relationships. | Referenced compartments, substrates/products and electron/proton/energy flows; explicitly name ATP-accounting conventions. Do not silently add standalone transport/mineral-nutrition chapters. |
| B-05 · Human physiology | **a:** airway/alveoli, ventilation/volumes and gas-exchange/transport curves. **b:** heart/vessels, double circulation, cardiac cycle/ECG and blood/lymph/coagulation relationships. **c:** nephron/urine formation, osmoregulation, hormonal feedback and dialysis. **d:** muscle/sarcomere, skeleton/joints and contraction. **e:** neuron/CNS/PNS and impulse/synaptic relationships. **f:** endocrine gland/hormone/feedback systems and named disorders. | Reference-checked organ connections/directions and spatial labels; distinguish schematic ECG/action-potential models from clinical traces. Never reverse oxygenated/deoxygenated flow or afferent/efferent paths. No diagnosis or invented normal ranges. |
| B-06 · Reproduction | **a:** flower/gametophytes, pollen–pistil interaction, double fertilization, embryo/endosperm/seed/fruit and special modes. **b:** male/female anatomy, gametogenesis and menstrual cycle. **c:** fertilization through blastocyst/implantation, placenta, parturition/lactation. **d:** source-scoped contraception and elementary IVF/ZIFT/GIFT process relationships. | Correct developmental ordering, gamete/ploidy/fertilization accounting, anatomy and hormone axes from references. Represent health topics educationally; do not infer patient-specific fertility outcomes or advice. |
| B-07 · Genetics and evolution | **a:** Mendelian crosses, incomplete/co-/multiple-allele/polygenic cases, sex determination/linkage/crossing-over, sex-linked and named genetic disorders. **b:** DNA/RNA/packaging/replication, transcription/translation/genetic code, lac operon, genome and fingerprinting. **c:** selection types, drift/gene flow, Hardy–Weinberg, adaptive radiation and evidence/human evolution. | Independently enumerated genotypes/probabilities, reference-checked sequence direction/complementarity and process stages. Pedigree inferences need explicit inheritance assumptions; evolution diagrams cannot imply a goal-directed ladder. |
| B-08 · Human welfare | **a:** specified pathogen/parasite life-cycle and transmission relationships, including malaria and other named diseases. **b:** immunity/vaccine/HIV/cancer conceptual processes. **c:** food/industrial microbes, sewage treatment, biogas, biocontrol and biofertilizers. | Referenced host/vector/stage identity and process ordering. Show qualitative immune mechanisms, not invented antibody levels or patient outcomes; treatment/medical advice is not a diagram requirement. |
| B-09 · Biotechnology | **a:** recombinant-DNA workflow, restriction/ligation/vector topology, amplification/separation and host expression where grounded in the unit. **b:** insulin/vaccines, gene therapy, GM/Bt crops, transgenic organisms and biosafety/patent/biopiracy relationships. | Checked DNA insert/orientation/site/sequence constraints where supplied and referenced process order. Gel bands and PCR counts require supplied data or an explicit ideal model; never invent experimental success. |
| B-10 · Ecology and conservation | **a:** population interactions/attributes, growth and age-distribution graphs. **b:** ecosystem components, productivity/decomposition, food chains/webs, energy flow and pyramids of number/biomass/energy. **c:** biodiversity patterns/loss/conservation, hotspots and protected-area concepts. | Explicit trophic edges and supplied population/energy data, units and correct pyramid type. Biomass/number may be inverted; energy must not be. Maps/distributions need referenced geography, not decorative invented ranges. |

### Delegation model and dependency-aware execution

#### One integration owner; workers own disjoint slices

The parent/integration owner retains shared compiler/document/capability/planner seams, evaluation denominators, scene-tier decisions and release acceptance. A worker receives one packet letter, a finite supported input class, exact allowed files and its own gate. It first audits reuse and reproduces a source-grounded gap; if the engine already supports the slice, it adds evidence/integration coverage rather than another equivalent operator.

| Responsibility | Owner / boundary |
| --- | --- |
| DCP-01 evaluation and DCP-02 source obligations | Integration owner freezes the schema, syllabus tags, source exclusions, topic mapping and holdout before capability work is credited. Chapter workers cannot alter denominators or relabel misses. |
| Mathematical/subject implementation | Worker owns explicitly assigned new or disjoint modules under the appropriate scene-engine domain and a dedicated `verify-<packet>-*.ts` gate. No two workers edit the same existing module concurrently. |
| Shared contracts and live access | Integration owner alone edits shared compiler dispatch, `document/**`, `capability/**`, source-claim validation and tutor-core planner integration. Workers return a proposed contract/integration diff; the owner reviews and applies it serially. Announce the shared-path edits first. |
| Source parsing and family/subject selection | Integration owner owns shared IR/normalization/selection changes. Chemistry/biology workers must not build competing English routers or relax source completeness to obtain ink. |
| Independent acceptance | A reviewer checks the source obligations and equations/reference topology against the actual rendered result. Corpus fixtures are oracles only, never runtime templates. |
| Publication | Leave work uncommitted unless the user requests publication. No worker pushes, opens a PR or merges by default. DCP-12 and explicit user merge authorization still apply. |

Use isolated worktrees for writing agents and read-only shared access for audits. A workable initial allocation is **one integrator plus up to three disjoint workers**, adjusted to the actual tool/runtime limit. This is a planning recommendation, not a claim that agents are running. Each worker reports integration needs rather than waiting for another worker to edit its tree.

#### Prerequisites, not a guessed calendar

| Dependency seam | Consumers / rule |
| --- | --- |
| S0 · frozen evaluation/source-obligation contract | Every CH/C/CA/B packet. DCP-01/02 come first; historical topic fractions cannot be used as a new success oracle. |
| S1 · typed topology and source attachments | CH-02 circuits, CH-03 bodies/strings, CH-09/24 circuits and CH-25 apparatus. Electrical terminals and mechanical contacts remain distinct types, even if both render as graphs. |
| S2 · domains, piecewise curves, calculus and bounded numerical authority | CH-01b, CH-04b, CH-11/12/13, thermal/field/kinetics plots. A blocked advanced solver can still deliver an independently honest representation, with the gap retained. |
| S3 · world frames, vectors and orientation | CH-05/07/08/09/18/26/31, spatial optics and CA-02. Coordinate projection is presentation; proofs stay in the owning world/physical frame. |
| S4 · structural chemistry/reference topology | C-02/03/10/12/14–19 and molecular B-03/07/09. Existing formula/configuration graphs are audited first; anatomy requires a separate curated-reference contract. |
| S5 · measurements and observed data | CH-25/34, C-13/20 and data-bearing B graphs. Reuse a reading/uncertainty interface, but keep subject-specific apparatus laws and observed facts independently checked. |

These seams are proposed interface areas, **not prescribed new abstractions**. Reuse existing contracts first and introduce a new module only for a demonstrated current consumer. “Depends on CH-03” means its required slice/contract is accepted, not that the entire chapter must be declared complete.

| Execution stage | Dispatch rule and exit condition |
| --- | --- |
| 0 · Establish truth | Integrator reproduces the current baseline, freezes S0 under DCP-01/02, refreshes recorded misses and separates existing capability from unsupported cases. Freeze each subject's inclusion before workers are assigned. |
| 1 · Core P0, orders 1–6 | Pick the earliest ready, non-overlapping slice. A candidate first batch is CH-01a relative motion, CH-02a network topology and CH-06a straight lines, after their contracts/files are isolated. Then dispatch CH-03a/05a; CH-04a follows accepted body/contact authority where needed. Exit with the named live failure classes reproduced/fixed and verified representations persisted/replayed. |
| 2 · Core P1, orders 7–19 | Retain chapter order when choosing ready work. Schedule rotational/contact/energy, electrostatics, induction/network and optics compositions against accepted seams; schedule calculus/algebra/spatial slices in parallel only when files/contracts are disjoint. Split CH-19 into its four subpackets. Exit per accepted slice, not by bulk operator count. |
| 3 · Core P2, orders 20–26 | Thermal/kinetic, modern physics, devices, experiments and EM-wave slices reuse the accepted physical/domain/topology contracts. Keep apparatus versus plot acceptance separate. Exit with subject laws, reading/phase/level obligations and real live/replay evidence. |
| 4 · Report-driven core, orders 27–34 | Refresh the gap report before dispatching these rows. Keep the existing priority label rather than silently promoting/deleting them. Reuse domain, world-vector and measurement seams; report which variants remain unsupported. |
| 5 · Optional subject expansion | After the selected exam scope is approved, route C/CA through DCP-11; begin B with reference/topology and syllabus audit. Inside Chemistry, structural C-02/03/14 and graph/authority C-04/06/07 foundations precede dependent structures/reactions; B cell/anatomy contracts precede system/process compositions. Do not block core work on unrelated new Biology assets. |
| 6 · Composite release | DCP-12 checks the selected scope's frozen corpus and holdout, readable rendering, narration ownership, atomic commit, persistence and replay. No milestone implies permission to merge. |

When a slice's prerequisites are not ready, report the named blocker and choose the next ready slice in the preserved queue. Do not work around a missing solver by asserting planner numbers, generating a canned figure or weakening validators. No duration estimate is promised before the baseline audit establishes gap sizes.

### Universal packet contract and definition of done

Each assigned packet must first enumerate **all** relevant frozen topics in its scope, including text-only ones. For each topic record: exam/year and source unit; explicit inputs/assumptions; required objects, labels and relations; appropriate representation tier; reusable capability to audit/extend; independent oracle; remaining unsupported variants. A general heading such as “potential” must be split into testable source/geometry cases before coding.

1. **Baseline and scope are explicit.** Reproduce the failing or missing source case and classify it as parsing, authority, capability, relevance/completeness, layout, narration or persistence. Preserve already passing constructions. No source-quality guess or operator-name match earns a new pass.
2. **Authority and diagram need are explicit.** Solve supported numeric quantities deterministically; curated Biology/chemical facts require a named/versioned reference. Diagram-optional/text-only topics remain in the topic map with their reason, while eligible diagram-required failures remain in the required-visual denominator.
3. **Breadth and depth are both tested.** As a proposed minimum for each distinct required-visual family, include easy, medium, hard and composite source cases when meaningful, plus parameter/orientation/domain variations. Require negative cases for wrong-family, omitted required objects, invalid quantities, degeneracy and unsupported/missing source evidence. This floor is not evidence that every topic is covered.
4. **Independent checks certify the right tier.** Exact results need supported mathematical obligations; qualitative diagrams need checked relations/reference topology; question representations need a complete faithful setup with named limits. Approximate numerical methods declare domain, tolerance and error evidence. “Compiles” or `primitive_count > 0` is never the oracle.
5. **Invalid candidates fail atomically.** Test bad inputs through the real validator/compiler and assert no partial scene. Mutate signs, units, topology, labels and relevant physical/stereochemical assumptions; do not weaken an existing test or move an unsupported case into text-only for a green report.
6. **A real student-facing scene is checked.** Inspect rendered compositions on the 1200 × 700 board, x=400–1160 diagram zone, including dense labels. Confirm required objects and reveal order, teaching-only `WRITE`/verified `FOCUS` ownership and a saved-turn replay. Offline-only evidence must be labelled offline and cannot close a live acceptance item.
7. **Focused and shared checks are current.** Run the packet's dedicated gates and the existing typecheck/lint/build checks covering touched code; build packages before tutor checks. The integration owner runs affected shared suites and the frozen corpus/holdout. Preserve baseline failures explicitly, and use a disposable DB when DB gates are needed.
8. **The handoff is actionable.** Return the contract, changed files, runnable checks/results, public-safe render evidence, added topic cases, tier outcomes, integration patch and unresolved cases. Keep scratch outputs, secrets and generated build files out of commits. Do not claim a percentage unless its versioned denominator and evidence are included.

The existing **more-than-90%** rule remains an inventory triage threshold, not a release guarantee. Keep separate topic-inventory, required-visual, accuracy and lifecycle measures. When these expanded topic lists are adopted, freeze a new denominator rather than comparing it directly with the old 6/14 or 2/24 counts. A chapter can leave this backlog only after the refreshed inventory clears the threshold **and** its required acceptance evidence exists; explicitly report the residual topics and unsupported variants. Zero known false certifications remains mandatory regardless of the share.

Track packets through the [progress contract and chapter counters](docs/plans/diagram-topic-matrix/progress.md), backed by `topic-progress.csv`. Each worker writes a unique [packet evidence log](docs/plans/diagram-topic-matrix/work-logs/TEMPLATE.md) before reporting its assignment complete. The integration owner records accepted topic IDs after shared/live/replay review and recomputes the chapter counters in that tracker and the core queue above. All topics initially remain **planned**; no historical gate pass is copied into new evidence.

The core queue's **Historical baseline** stays unchanged. Its **Accepted topics (new audit)** column is the live counter: after six Kinematics topics have independently accepted evidence it can read `6/14`, and after all fourteen qualify it can read `14/14`. Never replace a fraction with “full” merely because coding is finished, a packet is allocated, or one family gate passes. Keep the denominator and residual variants visible.

### Copyable agent assignment

Fill this in for **one lettered slice**, not for “finish Physics” or an entire multi-system Biology unit. The worktree base must include its accepted dependency contracts.

```text
Packet: <CH-08b / C-03a / B-05c / other bounded slice>
Goal: <finite supported input class and student-visible behavior>
Exam scope: <J/A/N, year, official source unit/topics, explicit exclusions>
Read: AGENTS.md, DIAGRAM_ENGINE_COVERAGE_PLAN.md, relevant subject guide,
      matrix rows for this packet, accepted dependency contracts,
      current modules and their existing gates.
Prerequisites/base: <accepted S seams, source/evaluation version, base revision>
Allowed edits: <exact disjoint implementation files and dedicated gate paths>
Shared integration: do not edit shared compiler/document/capability/planner,
                    denominator or routing files; return a proposed patch.
Existing capability to preserve/reuse: <operators, laws, parsers, references>
Required scene obligations: <objects, topology, relations, units, labels, tier>
Independent oracle: <equations, enumeration or versioned reference topology>
Cases: <easy/medium/hard/composite, edge/invalid/missing-source variations>
Verification: <focused commands, affected package checks, render review;
               live/persistence/replay evidence or explicit integrator handoff>
Out of scope: DSA; new English/chapter/question routing; canned geometry;
              validator bypasses; unrelated edits; denominator manipulation.
Deliver: changed files/contracts, exact check results, render evidence,
         per-topic outcomes, proposed integration patch, unresolved variants,
         work-logs/<packet>-<assignment-id>.md; integrator reconciles
         topic-progress.csv and chapter counters after acceptance.
Git: leave changes uncommitted; no branch publication, PR or merge unless asked.
Stop/escalate: an unmet dependency, ambiguous source contract or missing access;
               never invent source assumptions to finish the picture.
```

For CH-08b, for example, assign only the infinite line/sheet/thin-shell Gauss-law family: explicit density/geometry/test position, an oriented Gaussian surface, field/flux units and independently checked inside/outside/boundary cases. Dipole torque and dielectric capacitor networks belong to CH-08a/08c, not that worker. Its first deliverable is a source-obligation and reuse audit; its final deliverable is the accepted family plus rejection/render/live evidence, not “Electrostatics complete.”

### Resume seed for the coordinating agent

This planning update starts no implementation work. On an explicit resume, retain the 34-row order, run DCP-01/02 and refresh the baseline first. Then assign at most three ready disjoint slices using the template, integrate shared seams serially, and publish a per-slice evidence/gap report before taking the next batch. Add the Chemistry/Advanced/Biology lanes only to the selected versioned exam scope; do not rewrite the historical 25-chapter completion record as full-syllabus coverage.
