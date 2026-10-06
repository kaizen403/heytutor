# Maths topic-to-agent documentation matrix

**Current evidence: topic audit pending for all 179 rows.** This is complete assignment coverage, not measured diagram/runtime coverage. The inherited chapter fractions have no authoritative topic-to-evidence mapping; operator names, old gate passes and chapter counts earn no topic pass here. All packets are planned and no implementation is authorized by this matrix.

Use `maths.csv` for the exact topic/unit IDs, unchanged taxonomy labels, one primary packet, per-exam scope, official page/unit references, visual hypothesis, candidate seed, variants, independent acceptance tests and accepted dependency seams. This companion groups rows in the root plan's core chapter order; taxonomy unit numbering is preserved rather than reinterpreted as queue order. DSA is excluded.

## Scope and evaluation freeze

The baseline is the official 2026 JEE Main Paper 1 and JEE Advanced Mathematics publications checked on 2 October 2026. `J-PDF`, `A-PDF` and `N-PDF` resolve through the [source index](index.md#primary-sources); pages are physical PDF pages. Main Maths is pp1-2; Advanced Maths is pp9-12. N-PDF contains no Mathematics subject, so every NEET cell is `not_applicable`, never a fabricated NEET scope. Taxonomy `framework_ids` are not source evidence.

`listed` means the content is explicitly stated; `application` means a teaching/exam variant of a stated concept, not a separately enumerated heading; `supplemental` marks an unlisted standalone/outside-baseline extension; `review` means a mixed or ambiguous source-scope decision must be frozen editorially. A page/unit citation on a supplemental row locates the checked baseline and its boundary; it does not assert that the omitted heading occurs there. Each row's variants specify the boundary to test.

`required`, `conditional` and `text_only` are planning hypotheses. At S0 evaluation freeze, independently confirm diagram need from each full source question. `required` prioritizes object/graph/geometry obligations; `conditional` allows pure calculations to be text-only when independently justified; `text_only` proposes calculation/classification without a figure. None permits removing a required-visual miss or changing the denominator to suit the engine.

Before executing a packet, freeze the source cases and representation tier, confirm its named dependencies, and separate exact proofs, honest qualitative relations, complete question representations and legitimate text-only decisions. Run the root plan's universal negative/atomic/render/live/persistence/replay acceptance in addition to the mathematical checks below; a topic-level audit remains pending until independent evidence is attached.

### Boundaries requiring explicit decisions

- **Axis translation and latus rectum:** Advanced explicitly names shift of origin (A-PDF p10); Main translation is a coordinate-system application, not a named U10 heading. Neither syllabus explicitly names latus rectum; its chords/lengths are conic applications. The existing conic gate checks latus endpoints, but that is only a candidate seed, not certification of the topic.
- **Parametric derivatives:** both syllabi explicitly include implicit differentiation; neither explicitly enumerates parametric differentiation in its calculus list. The combined taxonomy label stays `review` in both exams. Freeze implicit cases separately from the parametric chain-rule application, including dx/dt=0 and the second-derivative denominator. Advanced parametric *conic coordinates* are explicitly listed, which does not by itself make parametric *calculus* a named heading.
- **Plane and triple-product scope:** standalone plane forms/angles/distances and scalar/vector triple products are Advanced-listed, not Main U11/U12-listed. Plane intersections/reflection are Advanced applications. The broad vector collinearity/coplanarity and area/volume rows remain Main `review`; retain Main area/collinearity applications and separately tag supplemental coplanarity/volume. A plane illustrating a Main three-variable matrix system does not import standalone plane syllabus membership.
- **Combined source labels:** `Into and many-one functions` stays `review` because into is explicit but many-one is a mapping variant; Main argument/polar form combines explicit argument with a polar-representation application; the Main circle-tangent row combines an origin-circle intersection application with deeper general tangent equations. Advanced quadratics explicitly have real coefficients, while the taxonomy row names real and complex number systems; `review` preserves the coefficient-domain decision without dropping nonreal roots of real-coefficient quadratics.
- **Supplemental content stays assigned:** Main infinite GP/special power sums, both-exam general De Moivre/nth-root demands and arithmetico-geometric progression are kept in their owning rows with supplemental tags. Main cube-unity/complex triangle inequality, incentre/angle bisectors, deeper conic parametrics/tangents, ODE formation and MVT have explicit nonlisted boundaries rather than inherited all-JEE labels.
- **Supplemental-unit handoff:** the separate [supplemental catalog](supplemental.md) owns the exact topic IDs `maths\|supplemental\|linear-programming\|core` (SX-M01), `maths\|supplemental\|mathematical-induction\|core` (SX-M02) and `maths\|supplemental\|mathematical-reasoning\|core` (SX-M03), as recorded in [supplemental.csv](supplemental.csv). Their corresponding unit IDs omit the terminal `\|core`. They are outside these 179 primary-unit rows and remain visible in the combined taxonomy denominator; none is reassigned here.
- **Optional calculus/series extensions:** volumes of revolution and improper integrals belong to a separately approved extension scope under CH-12b; general series/convergence tests belong to a separately approved extension scope under CH-15b. These are optional extension obligations, not invented taxonomy IDs, extra assigned rows or the three supplemental-unit topics above. Acceptance must check disk/washer/shell axes and bounds, one-sided improper convergence/divergence without principal-value conflation, and declared series tests/conditions respectively. Keep their evaluation denominators separate until that scope is approved.

## Assignment totals and packet allocation

**179/179 topics assigned exactly once (100.00%) across 14/14 units and 38 used primary packet slices.** Every topic, including supplemental and review rows, has an owner. These percentages measure assignment completeness only; verified runtime coverage is unknown.

| Core order | Unit ID | Chapter | Primary packet allocation: topics / chapter total (share) | Combined assigned / chapter total |
| --- | --- | --- | --- | --- |
| 6 | `maths\|10` | Coordinate Geometry | CH-06a: 9/29 (31.03%); CH-06b: 10/29 (34.48%); CH-06c: 10/29 (34.48%) | 29/29 (100.00%) |
| 11 | `maths\|7` | Limit, Continuity and Differentiability | CH-11a: 5/18 (27.78%); CH-11b: 9/18 (50.00%); CH-11c: 4/18 (22.22%) | 18/18 (100.00%) |
| 12 | `maths\|8` | Integral Calculus | CH-12a: 7/13 (53.85%); CH-12b: 6/13 (46.15%) | 13/13 (100.00%) |
| 13 | `maths\|9` | Differential Equations | CH-13a: 4/8 (50.00%); CH-13b: 3/8 (37.50%); CH-13c: 1/8 (12.50%) | 8/8 (100.00%) |
| 14 | `maths\|3` | Matrices and Determinants | CH-14a: 3/14 (21.43%); CH-14b: 7/14 (50.00%); CH-14c: 4/14 (28.57%) | 14/14 (100.00%) |
| 15 | `maths\|6` | Sequence and Series | CH-15a: 5/10 (50.00%); CH-15b: 4/10 (40.00%); CH-15c: 1/10 (10.00%) | 10/10 (100.00%) |
| 16 | `maths\|5` | Binomial Theorem and its Simple Applications | CH-16a: 3/8 (37.50%); CH-16b: 5/8 (62.50%) | 8/8 (100.00%) |
| 17 | `maths\|4` | Permutations and Combinations | CH-17a: 5/9 (55.56%); CH-17b: 4/9 (44.44%) | 9/9 (100.00%) |
| 18 | `maths\|11` | Three-Dimensional Geometry | CH-18a: 4/14 (28.57%); CH-18b: 2/14 (14.29%); CH-18c: 8/14 (57.14%) | 14/14 (100.00%) |
| 29 | `maths\|1` | Sets, Relations and Functions | CH-29a: 7/10 (70.00%); CH-29b: 3/10 (30.00%) | 10/10 (100.00%) |
| 30 | `maths\|2` | Complex Numbers and Quadratic Equations | CH-30a: 3/14 (21.43%); CH-30b: 9/14 (64.29%); CH-30c: 2/14 (14.29%) | 14/14 (100.00%) |
| 31 | `maths\|12` | Vector Algebra | CH-31a: 5/10 (50.00%); CH-31b: 1/10 (10.00%); CH-31c: 4/10 (40.00%) | 10/10 (100.00%) |
| 32 | `maths\|13` | Statistics and Probability | CH-32a: 3/12 (25.00%); CH-32b: 5/12 (41.67%); CH-32c: 4/12 (33.33%) | 12/12 (100.00%) |
| 33 | `maths\|14` | Trigonometry | CH-33a: 2/10 (20.00%); CH-33b: 5/10 (50.00%); CH-33c: 3/10 (30.00%) | 10/10 (100.00%) |
| All Maths primary units | — | 14 units | 38 slices | 179/179 (100.00%) |

The root queue positions are 6, 11–18 and 29–33; no core chapter has been reordered or renumbered. CH-17c (counting-to-probability compositions) and CH-29c (special-function transformations) are reserved root-plan slices with no primary topic row in these 14 units: their present consumers live in CH-32b and CH-11a/CH-33a respectively. This is not deletion of those root-plan slices or an added unknown owner.

## Packet definitions, dependencies and candidate seeds

Each used ID below is one bounded human documentation/assignment slice, never a runtime routing key. Dependencies name accepted contracts, not completion of an entire chapter: S0 is frozen evaluation/source obligations; S2 is domains/curves/calculus and bounded numerical authority; S3 is world frames/vectors/orientation; S5 is supplied observations/data. No Maths row currently needs S1 electrical/mechanical topology or S4 chemistry/reference topology.

The module/gate references below were read in this worktree; they were not rerun or credited as topic evidence. All are **candidate** reuse only. A packet with `none` has no established relevant seed from this bounded inspection, which is not proof that the repository has no reusable primitive. CSV seeds are narrower topic-specific candidates; packet notes also identify possible neighboring consumers that still need inspection.

### CH-06a — Coordinates, axis translation and straight lines

Finite 2D points/ratios and line forms, intersections, concurrency, angles and perpendicular feet; translation uses an explicit old/new frame.

Dependencies to accept before execution: S0; S3.

- **Candidate:** `packages/scene-engine/src/compile/affineGeometry.ts` with `packages/scene-engine/scripts/verify/verify-affine-operators.ts`. affine_point/path preserve explicit 2x2 transforms and translation; this is a shift-of-frame candidate, not a line solver.

### CH-06b — Loci, line families, bisectors and circles

Source-defined loci and line/circle constraints, circle equations and tangency; restrict deeper Main constructions by each row's scope tag.

Dependencies to accept before execution: S0; S3; CH-06a.

- **Candidate:** `packages/scene-engine/src/compile/circleGeometry.ts` with `packages/scene-engine/scripts/verify/verify-circle-operators.ts`. Three-point circles, tangent contacts and two/tangent circle intersections; the source line/locus solvers still need audit.

### CH-06c — Conics and triangle-center compositions

All three standard conics, branch/contact/landmark/latus-rectum variants and the four triangle centers; derived constraints, not new chapter templates.

Dependencies to accept before execution: S0; S3; CH-06a; CH-06b.

- **Candidate:** `packages/scene-engine/src/compile/conicGeometry.ts` with `packages/scene-engine/scripts/verify/verify-conic-operators.ts`. Typed conic branches, analytic incidence, focal/directrix/tangent and latus-rectum anchors; inspect the existing latus endpoint equations before adding another constructor.
- **Candidate:** `packages/scene-engine/src/compile/triangleGeometry.ts` with `packages/scene-engine/scripts/verify/verify-triangle-operators.ts`. SSS/SAS/ASA and centroid/incenter/circumcenter/orthocenter; compositions still need topic-level evidence.

### CH-11a — Domains, limits and continuity

Elementary/inverse graphs, algebraic domains, one-sided behavior and piecewise holes/poles; Advanced L'Hospital/IVT variants remain within their stated hypotheses.

Dependencies to accept before execution: S0; S2.

- **Candidate:** `packages/scene-engine/src/compile/calculusGeometry.ts` with `packages/scene-engine/scripts/verify/verify-calculus-operators.ts`. Analytic source-curve anchors only; existing callbacks do not establish full piecewise-domain, limit or continuity certification.

### CH-11b — Derivatives and tangent/normal contacts

Bounded first/second analytic derivatives, implicit constraints and separately reviewed parametric applications; corners, cusps and stationary parameters stay explicit.

Dependencies to accept before execution: S0; S2; CH-11a.

- **Candidate:** `packages/scene-engine/src/compile/calculusGeometry.ts` with `packages/scene-engine/scripts/verify/verify-calculus-operators.ts`. Analytic secant/derivative callbacks include function/parametric/polar curves and true zero derivative markers; implicit solving and second-derivative coverage remain audit pending.

### CH-11c — Derivative applications and mean-value theorems

Finite monotonicity/extremum/rate problems and Advanced Rolle/Lagrange theorem witnesses; enumerate endpoints and hypothesis failures.

Dependencies to accept before execution: S0; S2; CH-11a; CH-11b.

- **Candidate:** `packages/scene-engine/src/compile/calculusGeometry.ts` with `packages/scene-engine/scripts/verify/verify-calculus-operators.ts`. Source derivative metadata can support rate witnesses; no existing theorem/extrema certification is credited.

### CH-12a — Antiderivatives and integration methods

Source-declared elementary primitives, substitution/parts/fractions/trig/radical forms and FTC checks on legal intervals; no general integrator promise.

Dependencies to accept before execution: S0; S2; CH-11b.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-12b — Definite integrals, sums and bounded regions

Signed integrals, transformed/split bounds, finite-sum approximations and all bounded simple-curve components. Optional revolution-volume and improper-integral obligations require separately approved supplemental scope under this packet; they have no invented taxonomy IDs and do not add primary assignment rows. Check source axes/bounds and one-sided convergence rather than inheriting the ordinary definite-integral contract.

Dependencies to accept before execution: S0; S2; CH-12a; CH-06c.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-13a — ODE classification, formation and separable/homogeneous forms

Order/degree, finite-constant family elimination and named first-order forms with equilibrium/singular branches; no unrestricted ODE solver.

Dependencies to accept before execution: S0; S2; CH-12a.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-13b — Linear ODE families and initial conditions

First-order linear residuals, integrating factors and source-bound selected solutions on declared intervals; any numerical field/curve needs independent error evidence.

Dependencies to accept before execution: S0; S2; CH-13a.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-13c — Explicit rate-model applications

Growth/decay and other supplied separable/linear rate laws only, with units, initial condition and interval; modeling assumptions are source inputs.

Dependencies to accept before execution: S0; S2; CH-13b.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-14a — Matrix arrays and algebra

Bounded rectangular real arrays, types, dimensions, operations and transpose/symmetry; inspect entries rather than implying arbitrary matrices are affine pictures.

Dependencies to accept before execution: S0.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-14b — Determinants, adjoints and inverses

2x2/3x3 arithmetic, determinant properties, signed triangle area and nonsingular inverse identities; singular cases remain legitimate inputs to classification.

Dependencies to accept before execution: S0; CH-14a; CH-06a.

- **Candidate:** `packages/scene-engine/src/compile/affineGeometry.ts` with `packages/scene-engine/scripts/verify/verify-affine-operators.ts`. Explicit nonsingular 2x2 inverse transforms only; not 3x3 inverse grids, adjoints or linear-system solving.

### CH-14c — Linear systems and elementary operations

Two/three-variable systems, consistency and exact solution sets, Cramer/inverse methods and tracked row/column operations; geometric planes here do not expand Main U11 scope.

Dependencies to accept before execution: S0; S3; CH-14a; CH-14b; CH-18c (only plane representations).

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-15a — Indexed progressions and means

Finite AP/GP terms, insertions and simultaneous constraints, including zero/negative parameters with declared conventions; values remain discrete.

Dependencies to accept before execution: S0.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-15b — Partial sums and scoped series

Finite AP/GP and natural-number-power sums; Advanced infinite GP and separately tagged arithmetico-geometric extension; convergence is not inferred from a plot. General series/convergence tests are optional extension obligations under this packet, requiring separately approved supplemental scope and declared test hypotheses; they have no invented taxonomy IDs and do not add primary assignment rows.

Dependencies to accept before execution: S0; CH-15a.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-15c — AM-GM relations

Positive-domain mean inequalities and equality/constraint cases; bounds follow algebra, not the fitted areas of illustrative rectangles.

Dependencies to accept before execution: S0; CH-15a.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-16a — Finite expansions and term indexing

Positive-integral binomial rows, general/middle term positions and finite n=0 boundary convention; no negative/fractional infinite expansion.

Dependencies to accept before execution: S0.

- **Candidate:** `packages/scene-engine/src/compile/combinatoricsGeometry.ts` with `packages/scene-engine/scripts/verify/verify-combinatorics-operators.ts`. subset_lattice rank counts can check small coefficient rows; it is not an expansion or term-indexing solver.

### CH-16b — Coefficient applications and identities

Finite coefficient identities, greatest terms, sums, extraction and modular remainders, with an explicit signed/magnitude convention.

Dependencies to accept before execution: S0; CH-16a; CH-17a.

- **Candidate:** `packages/scene-engine/src/compile/combinatoricsGeometry.ts` with `packages/scene-engine/scripts/verify/verify-combinatorics-operators.ts`. Bounded subset ranks and binomial counts only; identities and numeric greatest terms need independent algebra.

### CH-17a — Counting principles and distinct selections

Finite product/sum choices, ordered/unordered selections and word/number restrictions; independently enumerated examples are complexity-bounded.

Dependencies to accept before execution: S0.

- **Candidate:** `packages/scene-engine/src/compile/combinatoricsGeometry.ts` with `packages/scene-engine/scripts/verify/verify-combinatorics-operators.ts`. permutation_cycles (at most 8 items) and subset_lattice (at most 4); cycles describe explicit bijections, not all choice or seating models.

### CH-17b — Repeated objects, circular arrangements and groups

Finite multisets, rotational/reflection equivalence and constrained group partitions; state each equivalence model before counting.

Dependencies to accept before execution: S0; CH-17a.

- **Candidate:** `packages/scene-engine/src/compile/combinatoricsGeometry.ts` with `packages/scene-engine/scripts/verify/verify-combinatorics-operators.ts`. Small subset ranks may support restricted selection; multiset/group/circular-equivalence counts are not thereby proved.

### CH-18a — World points, sections and line definitions

Common-frame 3D points, ratios/cosines and line forms with zero direction components handled explicitly.

Dependencies to accept before execution: S0; S3.

- **Candidate:** `packages/scene-engine/src/compile/spaceDerivations.ts` with `packages/scene-engine/scripts/verify/verify-space-derivation-operators.ts`. Existing world point/line/frame metadata is consumed by these derivations; foundational line/section contracts still need their own topic audit.

### CH-18b — Line angles and shortest connectors

Intersecting/parallel/skew/coincident line classification, world angles and feet/connectors with near-parallel limits.

Dependencies to accept before execution: S0; S3; CH-18a.

- **Candidate:** `packages/scene-engine/src/compile/spaceDerivations.ts` with `packages/scene-engine/scripts/verify/verify-space-derivation-operators.ts`. Closest points, projection and source-world segment length; near-parallel and line-classification variants remain audit pending.

### CH-18c — Advanced planes and their compositions

Nondegenerate plane forms, distances/angles, line/plane and plane/plane intersections, coplanarity and reflection applications; Main standalone plane topics are supplemental.

Dependencies to accept before execution: S0; S3; CH-18a; CH-18b.

- **Candidate:** `packages/scene-engine/src/compile/spaceDerivations.ts` with `packages/scene-engine/scripts/verify/verify-space-derivation-operators.ts`. Projection and line/plane or plane/plane intersection use matching world frames; reflection composition and all angles still need independent case coverage.

### CH-29a — Sets, finite relations and equivalence classes

Set representation/operations/cardinality/power sets plus bounded pair graphs, property witnesses and relation/function counts; extends the root packet's relation audit to these exact set topics.

Dependencies to accept before execution: S0.

- **Candidate:** `packages/scene-engine/src/compile/setGeometry.ts` with `packages/scene-engine/scripts/verify/verify-set-operators.ts`. set_partition/select certify supplied finite membership/count witnesses for two/three sets; circles are nonmetric.
- **Candidate:** `packages/scene-engine/src/compile/combinatoricsGeometry.ts` with `packages/scene-engine/scripts/verify/verify-combinatorics-operators.ts`. subset_lattice for bounded power sets; neither candidate proves arbitrary relations or equivalence properties.

### CH-29b — Mappings and composition

Source domain/codomain/image, injection/surjection/into/many-one distinctions and compatible composition; retain unused codomain nodes.

Dependencies to accept before execution: S0; CH-29a.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-30a — Quadratic solution geometry

Quadratic solutions, discriminant and reconstructed equations; Main complex-coefficient cases and Advanced real-coefficient cases stay separately scoped.

Dependencies to accept before execution: S0; S2; CH-30b.

- **Candidate:** `packages/scene-engine/src/compile/complexGeometry.ts` with `packages/scene-engine/scripts/verify/verify-complex-operators.ts`. Computed complex points/roots can present a separately solved quadratic result; no quadratic-coefficient solver is inferred.

### CH-30b — Complex arithmetic and Argand geometry

Bounded complex points/transforms/roots, polar branches and locus/inequality constraints; general nth-root and De Moivre demands are supplemental.

Dependencies to accept before execution: S0; S3.

- **Candidate:** `packages/scene-engine/src/compile/complexGeometry.ts` with `packages/scene-engine/scripts/verify/verify-complex-operators.ts`. Exact component transforms and analytic-certified roots of degree 2-12; zero argument is null and physical units are refused.

### CH-30c — Root-coefficient and common-root algebra

Vieta/symmetric expressions and intersections of two finite quadratic root sets, including proportional and degenerate inputs.

Dependencies to accept before execution: S0; CH-30a.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-31a — Components, sums, dot products and projections

Explicit 2D/3D frames, signed components/projections and zero-vector cases; existing planar arithmetic is not automatically 3D support.

Dependencies to accept before execution: S0; S3; CH-18a (3D frames).

- **Candidate:** `packages/scene-engine/src/compile/vectorGeometry.ts` with `packages/scene-engine/scripts/verify/verify-vector-operators.ts`. Exact rational planar sums/scales/projections; the two-component definition is not evidence for 3D/cross/triple-product support.

### CH-31b — Oriented cross products

Right-handed world cross products and their zero/reversed-order cases; surface area is a consumer in CH-31c's mixed area/volume taxonomy row.

Dependencies to accept before execution: S0; S3; CH-31a.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-31c — Triple products, collinearity/coplanarity and area/volume

Advanced scalar/vector triple products and geometric interpretation; mixed Main rows require split freeze decisions so area/collinearity applications do not import standalone volume/coplanarity.

Dependencies to accept before execution: S0; S3; CH-31a; CH-31b; CH-18c (coplanarity).

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-32a — Source data and descriptive statistics

Finite raw/grouped observations, central tendency and dispersion, with explicit grouped approximations and population/sample convention.

Dependencies to accept before execution: S0; S5.

- **Candidate:** `packages/scene-engine/src/compile/statistics.ts` with `packages/scene-engine/scripts/verify/verify-statistics-operators.ts`. Unequal-bin density, frequency polygons and cumulative sums; central-tendency/dispersion values require a separate authority audit.

### CH-32b — Sample spaces and conditional events

Finite weighted outcomes, addition/multiplication/independence, total probability and Bayes; counting constraints and conditioning are explicit.

Dependencies to accept before execution: S0; CH-17a; CH-17b.

- **Candidate:** `packages/scene-engine/src/compile/probabilityGeometry.ts` with `packages/scene-engine/scripts/verify/verify-probability-operators.ts`. Explicit conditional topology, sibling mass and joint leaf products; it never invents events, complements or independence.
- **Candidate:** `packages/scene-engine/src/compile/setGeometry.ts` with `packages/scene-engine/scripts/verify/verify-set-operators.ts`. Finite set membership may aid event overlap; area is nonmetric and is not itself probability.

### CH-32c — Discrete distributions and moments

Finite sample-space pushforwards and mass/moment calculations; binomial distributions require independent identical Bernoulli assumptions.

Dependencies to accept before execution: S0; CH-32b; CH-16b.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-33a — Trig function graphs and ranges

Radian/unit-circle and periodic graphs with pole/domain partitions; finite expression ranges distinguish attained endpoints.

Dependencies to accept before execution: S0; S2; CH-11a.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-33b — Identities and equation solution sets

Domain-safe identities and finite/general equation families, with integer parameter and complete branch enumeration.

Dependencies to accept before execution: S0; S2; CH-33a.

Candidate seeds: none established in this bounded inspection; begin with the source/authority audit.

### CH-33c — Principal inverses and triangle applications

Principal inverse domains/ranges and separately sourced height/distance setups; a drawn acute triangle cannot determine every inverse branch.

Dependencies to accept before execution: S0; S2; S3; CH-33a; CH-06c (triangles).

- **Candidate:** `packages/scene-engine/src/compile/triangleGeometry.ts` with `packages/scene-engine/scripts/verify/verify-triangle-operators.ts`. Source SSS/SAS/ASA constructions can render a solved height setup; they are not proof of trig principal branches or unstated observer geometry.

## Exact topic assignments

Scope tags below are `J` = Main, `A` = Advanced and `N` = NEET. All topic evidence is **topic audit pending**; row-level official page/unit citations and narrower seed references are in the CSV. Unit IDs and labels remain exact; literal pipes in IDs are escaped for Markdown.

### Core 6 — Coordinate Geometry

Unit `maths\|10`; 29 topics assigned.

| Topic ID | Topic | Primary packet | Scope tags | Visual hypothesis | Required variants | Independent acceptance tests |
| --- | --- | --- | --- | --- | --- | --- |
| `maths\|10\|cartesian-distance-section-and-locus` | Cartesian coordinates in a plane and the distance formula | CH-06a | J:listed; A:listed; N:not_applicable | required | Points in all quadrants; coincident and axis-aligned pairs; explicit source coordinates | Independent sqrt((x2-x1)^2+(y2-y1)^2) agrees with source distance; translation preserves it; reject a metric label obtained from fitted canvas scale |
| `maths\|10\|section-formula` | Section formula | CH-06a | J:listed; A:listed; N:not_applicable | required | Internal/external division; signed ratio; midpoint; external ratio with zero denominator | Independent affine combination and collinearity/ratio check verify the point; m=n external division at infinity cannot become a finite point |
| `maths\|10\|locus-and-locus-equations` | Locus and locus equations | CH-06b | J:listed; A:listed; N:not_applicable | required | Distance/equidistance constraints; lines/circles/conics; disconnected or restricted loci | Check both directions: every displayed point satisfies the source constraints and every algebraic branch meets restrictions; reject an extraneous squared-equation branch or omitted component |
| `maths\|10\|translation-of-axes` | Translation of axes | CH-06a | J:application; A:listed; N:not_applicable | required | Old/new origins; x=X+h,y=Y+k; translated line/circle/conic equation; shift only versus rotation | Independent substitution transforms the equation and preserves world distances/incidence; reverse translation returns original coordinates; wrong-sign shifts reject; A expressly names shift of origin |
| `maths\|10\|slope-parallel-perpendicular-and-intercepts` | Slope of a line and parallel and perpendicular lines | CH-06a | J:listed; A:application; N:not_applicable | required | Finite/zero/undefined slopes; parallel/perpendicular line pairs; negative directions | Independent direction vectors and dot/cross products verify parallel/perpendicular relations; vertical lines never acquire a finite slope; coincident-point direction rejects |
| `maths\|10\|intercepts-of-a-line` | Intercepts of a line on the coordinate axes | CH-06a | J:listed; A:application; N:not_applicable | required | Finite x/y intercepts; line through origin; axis-parallel/axis-coincident lines | Independent substitution x=0/y=0 verifies intersections; missing/infinite intercepts stay explicit; reject dividing by a zero intercept coefficient |
| `maths\|10\|straight-line-equations` | Various forms of equations of a straight line | CH-06a | J:listed; A:listed; N:not_applicable | required | General/point-slope/two-point/intercept/normal forms; vertical line; coincident two-point inputs | Independent endpoint substitution and proportional coefficient checks show equivalent lines; zero normal or identical-point uniqueness claims reject |
| `maths\|10\|family-of-lines` | Family of lines through the intersection of two lines | CH-06b | J:application; A:listed; N:not_applicable | required | L1+lambda*L2 through a unique intersection; exceptional L2 member; parallel/coincident inputs | Independent incidence at the shared point and parameter completeness check include the exceptional line; parallel inputs do not receive a fabricated common-point family |
| `maths\|10\|line-intersection-angles-and-concurrence` | Intersection of lines and angles between two lines | CH-06a | J:listed; A:listed; N:not_applicable | required | Intersecting/parallel/coincident lines; acute/obtuse angle convention; vertical lines | Independent solve of two equations and atan2 of cross/dot directions verifies contact and angle; zero direction and guessed projected angle reject |
| `maths\|10\|concurrence-of-three-lines` | Conditions for concurrence of three lines | CH-06a | J:listed; A:listed; N:not_applicable | required | Three lines through one point; pairwise intersections distinct; parallel or coincident degeneracies | Independent coefficient determinant plus explicit common-point substitution establish concurrency; determinant zero alone cannot certify a unique common point |
| `maths\|10\|point-to-line-distance` | Distance of a point from a line | CH-06a | J:listed; A:listed; N:not_applicable | required | General line; point on/off line; vertical/horizontal line; perpendicular foot | Independent abs(ax0+by0+c)/sqrt(a^2+b^2) and foot incidence/perpendicularity agree; a=b=0 rejects |
| `maths\|10\|angle-bisectors` | Equations of internal and external bisectors of the angles between two lines | CH-06b | J:supplemental; A:listed; N:not_applicable | required | Internal/external bisectors; intersecting oblique/vertical lines; signed normalized equations | Independent equal point-to-line distances and angular sectors identify both branches; reject missing normalization or mislabeled internal/external line |
| `maths\|10\|triangle-centres-centroid-and-orthocentre` | Coordinates of the centroid and orthocentre of a triangle | CH-06c | J:listed; A:listed; N:not_applicable | required | Acute/obtuse/right triangles; translated/rotated/reflected vertices; exterior orthocentre | Independent centroid average/median concurrency and altitude dot products verify both centers; collinear vertices reject; an exterior orthocentre must not be moved inside |
| `maths\|10\|triangle-centre-circumcentre` | Coordinate of the circumcentre of a triangle | CH-06c | J:listed; A:listed; N:not_applicable | required | Acute/obtuse/right triangles; perpendicular bisectors; equidistance; collinear limit | Independent equal vertex distances and bisector equations verify the center; collinear vertices reject a finite circumcircle |
| `maths\|10\|triangle-centre-incentre` | Coordinate of the incentre of a triangle | CH-06c | J:supplemental; A:listed; N:not_applicable | required | Scalene/isosceles/right triangles; internal angle bisectors; positive inradius | Independent side-length-weighted coordinates and equal side distances verify incenter; reject an excenter substituted as the internal center or a degenerate triangle |
| `maths\|10\|circle-standard-form` | Standard form of the equation of a circle | CH-06b | J:listed; A:listed; N:not_applicable | required | Center at origin/off origin; positive radius; point membership; radius-zero separately declared | Independent (x-h)^2+(y-k)^2=r^2 and radial distances verify the circle; negative radius rejects; a zero-radius point is not a nondegenerate circle |
| `maths\|10\|circle-general-form-radius-and-centre` | General form of the equation of a circle and finding its radius and centre | CH-06b | J:listed; A:listed; N:not_applicable | required | x^2+y^2+Dx+Ey+F=0; positive/zero/negative radius squared; completed-square comparison | Independent center=(-D/2,-E/2) and r^2=(D^2+E^2)/4-F agree; negative r^2 has no real circle; reject an invented real curve |
| `maths\|10\|circles-through-three-points` | Equation of the family of circles through three points | CH-06b | J:application; A:application; N:not_applicable | required | Three noncollinear points give one circle; collinear/duplicate points; underdetermined reduced constraints | Independent solve for D,E,F and incidence at all three points verifies uniqueness; reject a claimed one-parameter family through three noncollinear points and nonexistent collinear circle |
| `maths\|10\|circle-from-diameter-endpoints` | Equation of a circle when the endpoints of a diameter are given | CH-06b | J:listed; A:application; N:not_applicable | required | Arbitrary/axis-aligned diameter; midpoint and half-length; coincident endpoints | Independent center midpoint and endpoint distances verify the circle; Thales right-angle check at other points; coincident endpoints cannot certify a positive-radius circle |
| `maths\|10\|line-circle-intersection-at-origin` | Points of intersection of a line and a circle with the centre at the origin | CH-06b | J:listed; A:listed; N:not_applicable | required | Origin-centered circle with secant/tangent/disjoint line; vertical line; translated circle as Advanced/application extension | Independent quadratic discriminant enumerates 2/1/0 contacts; every contact satisfies both equations; reject wrong multiplicity and imaginary points rendered as real |
| `maths\|10\|tangent-to-circle` | Condition for a line to be tangent to a circle and the equation of the tangent | CH-06b | J:review; A:listed; N:not_applicable | required | Tangency condition at origin is a Main intersection application; general tangent equation is deeper scope; vertical tangents and normals | Independent center-line distance=r and radius-dot-tangent=0 verify single contact; secant or off-circle contact rejects; freeze Main mixed-label boundary before evaluation |
| `maths\|10\|length-of-tangent-from-a-point` | Length of the tangent from a point to a circle | CH-06b | J:supplemental; A:application; N:not_applicable | required | External/on/inside point; two contacts; translated circle; equality of tangent lengths | Independent sqrt(OP^2-r^2) plus contact incidence/perpendicularity verifies both lengths; inside points have no real tangent and on-circle degeneracy is explicit |
| `maths\|10\|conic-sections-standard-forms` | Parabola in standard form | CH-06c | J:listed; A:listed; N:not_applicable | required | Parabola opening +/-x or +/-y; translated/rotated presentation after source-frame transform; vertex/focus | Independent substitution verifies y^2=4px or its declared equivalent and signed focus direction; p=0 rejects a nondegenerate parabola; fitting cannot change opening direction |
| `maths\|10\|ellipse-standard-form` | Ellipse in standard form | CH-06c | J:listed; A:listed; N:not_applicable | required | Horizontal/vertical major axis; a>=b>0; circle limit; translated source frame | Independent x^2/a^2+y^2/b^2=1 and focal-distance sum verify the closed curve; invalid axis lengths reject and axis swap is tracked explicitly |
| `maths\|10\|hyperbola-standard-form` | Hyperbola in standard form | CH-06c | J:listed; A:listed; N:not_applicable | required | Both transverse-axis choices; separate positive/negative branches; asymptotes; finite parameter bounds | Independent x^2/a^2-y^2/b^2=1 and focus-distance difference verify both branches; reject a bridge across the gap or zero axes |
| `maths\|10\|eccentricity-foci-and-directrix` | Eccentricity, foci, and directrices of conic sections | CH-06c | J:application; A:listed; N:not_applicable | required | Ellipse/hyperbola paired foci/directrices; parabola signed focus; circle e=0 limit; source frame | Independent distance(P,F)=e*distance(P,directrix) with e=c/a verifies each applicable pair; circle limit has no finite directrix; mismatched focus/side rejects |
| `maths\|10\|parametric-points-on-conics` | Parametric coordinates on a parabola, ellipse, or hyperbola | CH-06c | J:supplemental; A:listed; N:not_applicable | required | Parabola (p*t^2,2p*t); ellipse trig parameter; both hyperbola branches with declared parametrization; endpoint restrictions | Independent implicit-equation substitution verifies each contact; branch/domain and parameter convention are explicit; missing hyperbola branch or off-curve point rejects |
| `maths\|10\|line-as-tangent-to-conic` | Condition for y = mx + c to be a tangent and point of tangency | CH-06c | J:supplemental; A:listed; N:not_applicable | required | Finite-slope tangent condition; vertical tangent outside y=mx+c chart; repeated intersection; parametric contact and normal composition | Independent discriminant zero/contact substitution and gradient-dot-tangent=0 verify tangency; negative discriminant or two distinct contacts rejects; slope-only chart cannot omit vertical case |
| `maths\|10\|latus-rectum-of-conics` | Latus rectum of a parabola, ellipse, or hyperbola | CH-06c | J:application; A:application; N:not_applicable | required | Parabola signed opening; ellipse/hyperbola at both foci; both transverse endpoints; rotated source frame | Independent conic-chord intersection through focus perpendicular to major axis gives endpoints and lengths 4*abs(p) or 2*b^2/a; reject wrong branch/focus pairing or a chord not through the focus |

### Core 11 — Limit, Continuity and Differentiability

Unit `maths\|7`; 18 topics assigned.

| Topic ID | Topic | Primary packet | Scope tags | Visual hypothesis | Required variants | Independent acceptance tests |
| --- | --- | --- | --- | --- | --- | --- |
| `maths\|7\|real-valued-functions-and-algebra` | Real-valued functions and algebra of functions | CH-11a | J:listed; A:listed; N:not_applicable | conditional | Sum/difference/product/quotient domains; interval intersections; rational cancellations with excluded points | Independent domain intersection and denominator constraints survive simplification; reject restoring a canceled undefined point; algebra-only simplification may stay text-only |
| `maths\|7\|elementary-functions` | Polynomial, rational, trigonometric, logarithmic, and exponential functions | CH-11a | J:listed; A:listed; N:not_applicable | required | Polynomial/rational/trig/log/exponential graphs; zeros; asymptotes; legal real domains | Independent equation values and pole/domain checks match branches; no stroke bridges a pole or log boundary; wrong-domain sample points reject |
| `maths\|7\|inverse-functions-and-graphs` | Inverse functions and graphs of simple functions | CH-11a | J:listed; A:listed; N:not_applicable | required | One-one restriction; inverse reflection; noninvertible full function; principal inverse examples | Composition f(f^-1(y)) and f^-1(f(x)) verifies legal restricted domains; reject an inverse for an unrestricted many-one map; domain/range exchange is explicit |
| `maths\|7\|limits-continuity-and-differentiability` | Limits | CH-11a | J:listed; A:listed; N:not_applicable | required | Finite one-sided/two-sided limits; removable holes; jumps/poles; Advanced L'Hospital only with valid hypotheses | Independent one-sided evaluations or analytic limit proof establishes equality/divergence; point value does not determine limit; reject L'Hospital without an allowed indeterminate form |
| `maths\|7\|continuity` | Continuity of a function | CH-11a | J:listed; A:listed; N:not_applicable | required | Piecewise join; removable/jump/infinite break; endpoint one-sided continuity; Advanced intermediate-value property | Check both one-sided limits and point value independently; IVT requires continuity on the full interval; reject a connected display across a hole or an unsupported IVT claim |
| `maths\|7\|differentiability` | Differentiability of a function | CH-11b | J:listed; A:application; N:not_applicable | required | Smooth join versus corner/cusp; vertical tangent; continuous but nondifferentiable functions; endpoint convention | Independent one-sided difference quotients agree only at a differentiable point; infinite slope is not a finite derivative; reject a derivative across a corner |
| `maths\|7\|differentiation-from-first-principles` | Differentiation from first principles | CH-11b | J:application; A:application; N:not_applicable | conditional | Difference quotient for polynomial/trig examples; shrinking nonzero h; one-sided failures | Independent symbolic quotient limit equals the derivative; h=0 cannot be inserted before taking the limit; pure derivation may be text-only |
| `maths\|7\|differentiation-rules` | Differentiation of the sum, difference, product, and quotient of two functions | CH-11b | J:listed; A:listed; N:not_applicable | conditional | Sum/difference/product/quotient with domain restrictions; nonconstant factors; denominator zeros | Independent derivative identities and bounded point checks agree; reject quotient derivatives at excluded denominators and missing product terms |
| `maths\|7\|special-function-differentiation` | Differentiation of trigonometric and inverse trigonometric functions | CH-11b | J:listed; A:listed; N:not_applicable | conditional | Trig poles; inverse-trig endpoint restrictions; principal inverse branches; radians | Independent analytic derivatives and branch/domain conditions agree; reject finite derivative labels at singular inverse endpoints or tangent poles |
| `maths\|7\|logarithmic-and-exponential-differentiation` | Differentiation of logarithmic and exponential functions | CH-11b | J:listed; A:listed; N:not_applicable | conditional | ln(x), log-base-a, e^x, a^x; positive arguments; legal bases; logarithmic differentiation | Independent derivative/base factors and domain checks agree; base<=0 or base=1 and nonpositive log arguments reject; no derivative certifies a forbidden real domain |
| `maths\|7\|composite-implicit-and-second-derivatives` | Differentiation of composite functions | CH-11b | J:listed; A:listed; N:not_applicable | conditional | Nested composition; nonunit inner derivative; chain-rule zero and sign changes | Independent chain rule agrees with expanded/simple special cases; reject omission of inner derivative and values outside the composite domain |
| `maths\|7\|implicit-and-parametric-differentiation` | Differentiation of implicit and parametric functions | CH-11b | J:review; A:review; N:not_applicable | required | Implicit F(x,y)=0 is explicit in both exams; parametric application x(t),y(t); dx/dt=0; stationary parameter; second derivative | Check F_x+F_y*y'=0 where F_y is nonzero and dy/dx=y_t/x_t where x_t is nonzero; d2y/dx2=(d/dt(y_t/x_t))/x_t; vertical/zero-velocity cases never divide by zero; freeze parametric scope separately |
| `maths\|7\|second-order-derivatives` | Derivatives of order up to two | CH-11b | J:listed; A:listed; N:not_applicable | conditional | First/second derivative correspondence; inflection candidates with and without sign change; singular endpoints | Independent repeated analytic differentiation gives y''; check concavity signs rather than inferring an inflection from y''=0 alone; undefined second derivatives reject |
| `maths\|7\|mean-value-theorems` | Rolle's and Lagrange's mean value theorems | CH-11c | J:supplemental; A:listed; N:not_applicable | required | Rolle equal-endpoint case; Lagrange secant slope; multiple valid c; violated continuity/differentiability hypotheses | Independent f'(c)=(f(b)-f(a))/(b-a) and interval membership; Rolle also requires equal endpoint values; a cusp/pole or endpoint-only c rejects certification |
| `maths\|7\|applications-of-derivatives` | Rate of change of quantities | CH-11c | J:listed; A:application; N:not_applicable | conditional | Source-defined rates and related rates; explicit variables/units; signed increasing/decreasing quantities | Independent chain differentiation of the stated relation and dimensional checks verify the rate; reject invented rate assumptions or display slope used as a physical value |
| `maths\|7\|monotonic-functions` | Monotonic increasing and decreasing functions | CH-11c | J:listed; A:listed; N:not_applicable | required | Increasing/decreasing intervals; stationary points; disconnected domain; nonstrict versus strict claims | Independent derivative signs plus interval reasoning establish monotonicity; a pole partitions the domain; zero derivative at one point does not imply a constant function |
| `maths\|7\|maxima-and-minima` | Maxima and minima of functions of one variable | CH-11c | J:listed; A:listed; N:not_applicable | required | Local/global extrema; closed/open interval endpoints; nondifferentiable candidates; flat stationary nonextrema | Independent candidate enumeration includes legal endpoints and corners; compare values and sign changes; reject global maximum claims on an unbounded or unattained domain without proof |
| `maths\|7\|tangents-and-normals` | Tangents and normals | CH-11b | J:application; A:listed; N:not_applicable | required | Nonzero/zero finite slope; vertical tangent; implicit contact; normal and secant distinction | Contact satisfies the curve equation and tangent direction agrees with independent derivative or gradient; normal is perpendicular in the source plane; reject a secant labeled tangent or reciprocal slope at zero |

### Core 12 — Integral Calculus

Unit `maths\|8`; 13 topics assigned.

| Topic ID | Topic | Primary packet | Scope tags | Visual hypothesis | Required variants | Independent acceptance tests |
| --- | --- | --- | --- | --- | --- | --- |
| `maths\|8\|antiderivative-and-fundamental-integrals` | Integral as an anti-derivative and fundamental integrals involving algebraic, trigonometric, exponential, and logarithmic functions | CH-12a | J:listed; A:listed; N:not_applicable | conditional | Algebraic/trig/exponential/log antiderivatives; integration constant; connected domain components | Differentiate the proposed primitive independently and recover the integrand on each legal interval; reject a missing domain exclusion or treating one C as forced across disconnected domains |
| `maths\|8\|integration-methods` | Integration by substitution | CH-12a | J:listed; A:listed; N:not_applicable | conditional | One-to-one/local substitution; inverse domain; transformed differential; definite limits when supplied | Differentiate the substituted primitive independently; dx factor and domain agree; reject missing Jacobian or illegal inverse substitution; purely symbolic work may stay text-only |
| `maths\|8\|integration-by-parts` | Integration by parts | CH-12a | J:listed; A:listed; N:not_applicable | conditional | Polynomial-times-exponential/trig/log products; boundary term in definite integrals | Differentiate uv-integral(v du) independently; check boundary contributions when limits exist; reject swapped differential signs or omitted boundary term |
| `maths\|8\|integration-by-partial-fractions` | Integration by partial fractions | CH-12a | J:listed; A:listed; N:not_applicable | conditional | Distinct/repeated linear factors; irreducible quadratic; polynomial division first; real poles | Independent recombination of fractions recovers the rational function; differentiate the primitive; reject unsupported intervals crossing poles and incomplete repeated-factor decomposition |
| `maths\|8\|integration-using-trigonometric-identities` | Integration using trigonometric identities | CH-12a | J:listed; A:application; N:not_applicable | conditional | Squared/product trig identities; tangent substitutions; zeros and poles; periodic branches | Independent identity equality and derivative of primitive hold on the common domain; reject an identity that removes an excluded tangent pole |
| `maths\|8\|standard-integrals-irrational-forms` | Standard integrals involving square-root linear and quadratic forms | CH-12a | J:listed; A:application; N:not_applicable | conditional | J-PDF p2 radical standard forms sqrt(a^2 +/- x^2), sqrt(x^2-a^2), sqrt(ax^2+bx+c); linear degeneration; sign/domain branches | Independent differentiation and radicand inequalities verify each primitive; reject wrong real branch, negative radicand, or a denominator endpoint treated as regular; formulas were checked against the PDF image |
| `maths\|8\|integral-as-limit-of-sum` | Integral as the limit of a sum | CH-12b | J:application; A:listed; N:not_applicable | required | Left/right/midpoint partitions; nonuniform partitions; finite bounded integrable curve; signed rectangles | Independent finite sums and refinement error bound approach the integral; widths and signs are source-derived; a finite sum is labeled approximate rather than an exact integral |
| `maths\|8\|fundamental-theorem-of-calculus` | Fundamental theorem of calculus | CH-12a | J:listed; A:listed; N:not_applicable | conditional | Accumulation F(x); derivative-integrand relation; endpoint evaluation; continuous versus singular integrands | Independent F'(x)=f(x) where hypotheses hold and integral_a^b f=G(b)-G(a); reject use across an undefined interval without a separately approved improper contract |
| `maths\|8\|properties-of-definite-integrals` | Properties of definite integrals | CH-12b | J:listed; A:listed; N:not_applicable | conditional | Reversed limits; interval additivity; even/odd symmetry; piecewise splits; unequal domains | Independent split integration verifies sign and symmetry identities on the stated domain; reject symmetry over a pole or a domain not symmetric about the center |
| `maths\|8\|evaluation-of-definite-integrals` | Evaluation of definite integrals | CH-12b | J:listed; A:listed; N:not_applicable | conditional | Signed positive/negative lobes; finite bounds; exact primitive versus error-bounded numerical value | Independent antiderivative endpoint difference or certified quadrature verifies the result; a sign change is not converted to absolute area; undefined integral cannot receive a finite exact label |
| `maths\|8\|substitution-in-definite-integrals` | Substitution in definite integrals | CH-12b | J:application; A:application; N:not_applicable | conditional | Transformed endpoints; reversed orientation; piecewise monotone substitution; Jacobian signs | Independent original/transformed integrals agree with correct limits and factors; reject reusing old bounds after substitution or losing a reversed sign |
| `maths\|8\|areas-bounded-by-curves` | Area under a simple curve in standard form | CH-12b | J:listed; A:listed; N:not_applicable | required | Curve and coordinate boundary; positive/negative lobes; multiple crossings; finite enclosed region | Independent intersection roots partition the region; integrate absolute height for geometric area; every filled point satisfies region inequalities; reject filling across a pole or unbounded enclosure |
| `maths\|8\|area-between-two-curves` | Area of the region bounded by two simple curves | CH-12b | J:listed; A:listed; N:not_applicable | required | Two or more intersections; upper/lower swaps; tangent contact; disconnected lobes; source-defined finite bounds | Enumerate all bounding intersections and integrate top-minus-bottom on each partition; independently verify region membership; reject missed crossings or an invented closed region |

### Core 13 — Differential Equations

Unit `maths\|9`; 8 topics assigned.

| Topic ID | Topic | Primary packet | Scope tags | Visual hypothesis | Required variants | Independent acceptance tests |
| --- | --- | --- | --- | --- | --- | --- |
| `maths\|9\|order-and-degree` | Ordinary differential equations, their order, and their degree | CH-13a | J:listed; A:application; N:not_applicable | text_only | Polynomial-in-derivatives equations; highest derivative; radical/nonpolynomial derivative forms; equivalent legal reduction | Independently identify derivative order and degree only where polynomial dependence is defined; a sine of y' has no polynomial degree; text-only classification needs no decorative curve |
| `maths\|9\|formation-of-differential-equation` | Formation of a differential equation by eliminating arbitrary constants | CH-13a | J:supplemental; A:listed; N:not_applicable | conditional | One/two-constant curve families; eliminate all independent constants; singular family members | Independent substitution of the full family into the derived ODE and parameter elimination verify the result; reject spurious solutions from dividing by a zero family factor |
| `maths\|9\|separation-of-variables` | Solution of differential equations by the method of separation of variables | CH-13a | J:listed; A:listed; N:not_applicable | conditional | dy/dx=f(x)g(y); constant equilibrium solutions; excluded zeros; legal intervals | Differentiate and substitute each displayed solution independently; recover equilibria lost by division; reject curves crossing a singular domain without justification |
| `maths\|9\|homogeneous-differential-equations` | Solution of homogeneous differential equations | CH-13a | J:listed; A:listed; N:not_applicable | conditional | First-order homogeneous y/x form; y=vx substitution; x=0 exclusions; branches | Independent rescaling homogeneity and substitution into the original ODE verify curves; reject a nonhomogeneous RHS or a branch crossing x=0 without a valid extension |
| `maths\|9\|linear-differential-equations` | Solution of linear differential equations of the type dy/dx + p(x)y = q(x) | CH-13b | J:listed; A:listed; N:not_applicable | conditional | y'+p(x)y=q(x); constant/variable coefficients; homogeneous/nonhomogeneous families; singular coefficients | Independent derivative substitution gives residual zero on the interval; nonlinear y^2 term rejects the linear contract; preserve the complete constant family |
| `maths\|9\|integrating-factor` | Integrating factor for a first-order linear differential equation | CH-13b | J:application; A:application; N:not_applicable | conditional | mu=exp(integral p dx); source interval; equivalent nonzero constant multiples | Independent product differentiation (mu*y)'=mu*q verifies the factor and solution; reject a zero or incorrectly signed integrating factor |
| `maths\|9\|initial-value-problems` | Particular solutions of differential equations with given conditions | CH-13b | J:application; A:application; N:not_applicable | required | One initial condition for first-order families; source point inside/outside domain; incompatible or nonunique singular conditions | Independent ODE residual and y(x0)=y0 establish the selected curve; uniqueness is claimed only under checked hypotheses; incompatible conditions reject rather than shift a plausible curve |
| `maths\|9\|rate-growth-and-decay` | Growth, decay, and other rate problems as differential equations | CH-13c | J:application; A:application; N:not_applicable | conditional | Explicit growth/decay y'=ky; signed k; initial stock; other stated separable/linear rate models | Independent y=y0*exp(k(x-x0)) or model-specific residual/initial condition verifies the curve; rate signs and units agree; unstated model assumptions reject |

### Core 14 — Matrices and Determinants

Unit `maths\|3`; 14 topics assigned.

| Topic ID | Topic | Primary packet | Scope tags | Visual hypothesis | Required variants | Independent acceptance tests |
| --- | --- | --- | --- | --- | --- | --- |
| `maths\|3\|matrices-and-types` | Types of matrices | CH-14a | J:listed; A:listed; N:not_applicable | conditional | Rectangular/square/row/column/zero/identity/diagonal matrices; explicit dimensions and entries; Advanced real-entry baseline | Check dimensions and defining entry conditions independently; reject a rectangular inverse or mislabeled diagonal matrix; unsupported type catalogues require their own scope decision |
| `maths\|3\|matrix-algebra` | Algebra of matrices, including multiplication | CH-14a | J:listed; A:listed; N:not_applicable | conditional | Equal/different dimensions; scalar/addition/product; rectangular products; AB unequal to BA | Compute each product entry as a row-column sum; reject incompatible dimensions; independently exhibit noncommutativity without inventing a geometric transform |
| `maths\|3\|transpose-symmetric-and-skew-symmetric` | Transpose and symmetric and skew-symmetric matrices | CH-14a | J:application; A:listed; N:not_applicable | conditional | Rectangular transpose; real symmetric/skew-symmetric matrices; diagonal zero requirement for skew symmetry | Check A^T entrywise, A=A^T or A=-A^T; a nonzero skew diagonal rejects; pure entry calculations may legitimately stay text-only |
| `maths\|3\|determinants-order-two-and-three` | Determinants and matrices of order two and three | CH-14b | J:listed; A:listed; N:not_applicable | conditional | 2x2/3x3 determinant grids; orientation and zero determinant; square-only domain | Independent expansion or permutation sum agrees for both orders; row exchange reverses sign; reject nonsquare determinant requests |
| `maths\|3\|determinant-evaluation` | Evaluation of determinants | CH-14b | J:listed; A:listed; N:not_applicable | conditional | Sparse/dense 2x2/3x3 entries; symbolic parameter zeros; different expansion rows | Compute by two independent expansions or exact small-case permutation sum; preserve sign and zero cases; unsupported order is not silently truncated |
| `maths\|3\|determinant-properties` | Properties of determinants | CH-14b | J:application; A:listed; N:not_applicable | conditional | Row swap/scaling/addition; repeated/proportional rows; determinant of product | Independent recalculation confirms sign/scaling/invariance and det(AB)=det(A)det(B); reject an operation ledger using column scaling as row addition |
| `maths\|3\|triangle-area-using-determinants` | Area of triangles using determinants | CH-14b | J:listed; A:application; N:not_applicable | required | Clockwise/counterclockwise triangles; translated vertices; collinear degeneration | Compare abs(det([x,y,1]))/2 with independent base-height or shoelace area; orientation changes signed determinant not area; collinear vertices give zero rather than a filled triangle |
| `maths\|3\|adjoint-and-inverse` | Adjoint of a square matrix | CH-14b | J:listed; A:listed; N:not_applicable | conditional | 2x2/3x3 cofactor-transpose grids; singular and nonsingular matrices | Check each signed minor and A*adj(A)=det(A)I independently; reject an untransposed cofactor grid labeled adjoint; singular matrices may still have an adjoint |
| `maths\|3\|inverse-of-a-square-matrix` | Inverse of a square matrix | CH-14b | J:listed; A:listed; N:not_applicable | conditional | 2x2/3x3 inverses; singular/near-singular cases; exact rational entries | Check both AA^-1 and A^-1A equal I using independent arithmetic; singular inverse rejects atomically; numerical near-singularity needs stated certification limits |
| `maths\|3\|singular-and-non-singular-matrices` | Singular and non-singular matrices | CH-14b | J:application; A:application; N:not_applicable | conditional | Zero determinant; dependent rows; invertible versus noninvertible examples; parameter thresholds | Independently compare determinant and nullspace witnesses; singularity is not inferred from a projected shape; reject a claimed inverse at a singular parameter |
| `maths\|3\|linear-systems-using-matrices` | Test of consistency of simultaneous linear equations in two or three variables | CH-14c | J:listed; A:application; N:not_applicable | required | Two/three variables; unique/infinite/no solutions; coincident/parallel lines and planes | Independent elimination and equation residuals establish solution set; rank(A) versus rank([A,b]) determines consistency; reject a unique-intersection drawing for inconsistent or dependent equations |
| `maths\|3\|solution-by-matrix-inverse` | Solution of linear systems using the inverse of a matrix | CH-14c | J:listed; A:application; N:not_applicable | conditional | Invertible two/three-variable systems; singular coefficient matrix; exact solutions | Compute x=A^-1b and verify Ax=b independently; singular inputs must use a separately justified consistency result or decline, never a fabricated inverse |
| `maths\|3\|cramers-rule` | Cramer's rule for linear systems | CH-14c | J:application; A:application; N:not_applicable | conditional | 2x2/3x3 systems; nonzero determinant; zero-determinant exceptional systems | Independent determinant ratios match direct elimination when det(A) is nonzero; zero denominator rejects Cramer use and does not imply no solutions by itself |
| `maths\|3\|elementary-operations-and-rank` | Elementary operations on matrices | CH-14c | J:application; A:listed; N:not_applicable | conditional | Elementary row/column transformations; augmented row operations; inverse reduction; bounded real matrices | Track each operation and independently verify the resulting entries; row operations on [A,b] preserve the solution set; column operations need variable tracking; explicit rank syllabus is not inferred from this ID |

### Core 15 — Sequence and Series

Unit `maths\|6`; 10 topics assigned.

| Topic ID | Topic | Primary packet | Scope tags | Visual hypothesis | Required variants | Independent acceptance tests |
| --- | --- | --- | --- | --- | --- | --- |
| `maths\|6\|arithmetic-and-geometric-progressions` | Arithmetic progressions | CH-15a | J:listed; A:listed; N:not_applicable | conditional | AP with positive/negative/zero difference; finite indexed points; missing-term reconstruction | Independent t_n=a+(n-1)d and consecutive differences agree; discrete points retain integer indices; reject an interpolating continuum claim |
| `maths\|6\|geometric-progression` | Geometric progressions | CH-15a | J:listed; A:listed; N:not_applicable | conditional | GP with positive/negative/zero/unit ratio; alternating signs; finite index range | Independent t_n=a*r^(n-1) and direct recurrence agree including r=0 convention; reject ratios inferred by dividing zero terms and an invented continuous curve |
| `maths\|6\|sum-of-ap-and-gp` | Sum of n terms of an AP and a GP | CH-15b | J:application; A:listed; N:not_applicable | conditional | Finite AP/GP partial sums; r=1 limit case; alternating GP; n=0 empty sum | Direct small summation agrees with AP/GP sum identities; r=1 uses S_n=na; reject zero-denominator formula use and noninteger term count |
| `maths\|6\|infinite-gp` | Sum of an infinite geometric progression | CH-15b | J:supplemental; A:listed; N:not_applicable | conditional | Convergent abs(r)<1; alternating ratio; r=1/-1 and abs(r)>1 divergence | Independently compare partial sums and limit a/(1-r) with a tail bound; divergent nonzero GP cannot receive a finite-sum label; zero-sequence exceptions are stated |
| `maths\|6\|insertion-of-means` | Insertion of arithmetic and geometric means between two given numbers | CH-15a | J:listed; A:listed; N:not_applicable | conditional | Specified number of inserted arithmetic/geometric means; positive endpoints; reversed endpoints; separately declared signed GP choices | Independent equal differences or ratios connect both endpoints with the correct index count; reject incompatible geometric-root/domain assumptions or missing sign branches |
| `maths\|6\|am-gm-relation` | Relation between A.M. and G.M. | CH-15c | J:listed; A:application; N:not_applicable | conditional | Two or finitely many positive entries; equality at equal entries; constrained product/sum | Independent arithmetic/geometric means obey AM>=GM and equality conditions; nonpositive entries reject the positive-domain inequality; text-only inequality work needs no decorative area |
| `maths\|6\|properties-of-ap-and-gp` | Standard term relations in AP and GP | CH-15a | J:application; A:application; N:not_applicable | conditional | Equidistant AP terms; GP term products; unknown first term/ratio; zero-term exceptions | Independent recurrence verifies each claimed relation and recovered parameters; reject extraneous solutions produced by division by zero |
| `maths\|6\|special-series-sums` | Sum up to n terms of special series such as Sn, Sn^2, and Sn^3 | CH-15b | J:supplemental; A:listed; N:not_applicable | conditional | Sums of first n natural numbers/squares/cubes; n=0/1; finite accumulation | Independent direct small sums and difference S_n-S_(n-1)=n^k verify formulas for k=1,2,3; reject interpreting Sn^2 label as square of sum without a declared meaning |
| `maths\|6\|arithmetico-geometric-progression` | Arithmetico-geometric progression | CH-15b | J:supplemental; A:supplemental; N:not_applicable | conditional | Supplemental finite sum of (a+kd)r^k; r=0/1; optional convergent infinite extension explicitly separate | Direct finite enumeration checks each sum; any infinite extension needs abs(r)<1 and a tail proof; general convergence-test coverage is not inferred |
| `maths\|6\|mixed-ap-gp-problems` | Mixed arithmetic and geometric progression problems | CH-15a | J:application; A:application; N:not_applicable | conditional | Shared terms satisfying AP and GP constraints; positive/signed choices; multiple or impossible solutions | Solve and independently substitute every candidate into both recurrences; enumerate all bounded branches and reject incompatible source constraints |

### Core 16 — Binomial Theorem and its Simple Applications

Unit `maths\|5`; 8 topics assigned.

| Topic ID | Topic | Primary packet | Scope tags | Visual hypothesis | Required variants | Independent acceptance tests |
| --- | --- | --- | --- | --- | --- | --- |
| `maths\|5\|binomial-theorem` | Binomial theorem for a positive integral index | CH-16a | J:listed; A:listed; N:not_applicable | conditional | Nonnegative integer exponent with n=0 boundary; positive-index baseline; symbolic a,b; bounded coefficient row | Independent polynomial multiplication matches every coefficient and substitution value; negative/fractional infinite expansion rejects this finite contract |
| `maths\|5\|general-and-middle-term` | General term in a binomial expansion | CH-16a | J:listed; A:application; N:not_applicable | conditional | T_(r+1) versus r indexing; exponent pairs; specified term or power; endpoint terms | Check C(n,r)a^(n-r)b^r against direct small expansion; reject off-by-one index or r outside 0..n; pure term calculation may stay text-only |
| `maths\|5\|middle-term` | Middle term in a binomial expansion | CH-16a | J:listed; A:application; N:not_applicable | conditional | Even n has one middle term; odd n has two; n=1/2 and larger bounded examples | Enumerate n+1 terms and verify central index/indices independently; reject presenting only one middle term for odd n |
| `maths\|5\|binomial-coefficient-properties` | Properties of binomial coefficients | CH-16b | J:application; A:listed; N:not_applicable | conditional | Symmetry; Pascal recurrence; adjacent coefficient ratio; endpoint coefficients | Independent combinatorial enumeration verifies C(n,r)=C(n,n-r) and Pascal addition; reject mismatched neighboring indices and coefficients outside the finite row |
| `maths\|5\|greatest-term-in-expansion` | Numerically greatest term in a binomial expansion | CH-16b | J:application; A:application; N:not_applicable | conditional | Positive numeric a,b; adjacent-term ratios; tied maxima; signed terms as separately defined magnitude problem | Compare all finite terms independently and verify ratio-based maximum; reject a greatest-positive-term claim based on absolute values without stating the convention |
| `maths\|5\|sum-of-binomial-coefficients` | Sum of binomial coefficients | CH-16b | J:application; A:application; N:not_applicable | conditional | All/even/odd/weighted coefficient sums; n=0 boundary; substitution at 1 and -1 | Direct finite summation agrees with independently substituted polynomial values; even/odd split handles n=0 separately; an infinite-row inference rejects |
| `maths\|5\|binomial-remainder-problems` | Divisibility and remainder problems using the binomial theorem | CH-16b | J:application; A:application; N:not_applicable | text_only | Integer bases/exponents; modular reductions; divisibility and stated remainder modulus | Independent modular exponentiation checks the binomial remainder; modulus must be a positive integer; text-only is legitimate for arithmetic with no structural figure obligation |
| `maths\|5\|simple-applications` | Simple applications of the binomial theorem | CH-16b | J:listed; A:application; N:not_applicable | conditional | Coefficient extraction in composed positive-index products; stated powers; bounded identities | Direct small polynomial convolution and substitution verify extracted coefficients; reject a term outside the polynomial degree and unsupported infinite series |

### Core 17 — Permutations and Combinations

Unit `maths\|4`; 9 topics assigned.

| Topic ID | Topic | Primary packet | Scope tags | Visual hypothesis | Required variants | Independent acceptance tests |
| --- | --- | --- | --- | --- | --- | --- |
| `maths\|4\|counting-principle` | Fundamental principle of counting | CH-17a | J:listed; A:application; N:not_applicable | conditional | Product-rule stages; disjoint sum-rule branches; dependent choices; zero available choices | Enumerate bounded tuples and compare sums/products; dependent stages use conditional branch counts; overlapping cases reject naive addition |
| `maths\|4\|permutations-and-combinations` | Permutations | CH-17a | J:listed; A:listed; N:not_applicable | conditional | Ordered r-selections of distinct n items; r=0/n; identity versus swapped order | Enumerate small ordered tuples and compare n!/(n-r)!; distinct orders stay distinct; invalid r or duplicated supposedly distinct items reject |
| `maths\|4\|combinations` | Combinations | CH-17a | J:listed; A:listed; N:not_applicable | conditional | Unordered r-subsets; empty/full selections; complement pairing | Enumerate subsets and compare n!/(r!(n-r)!); deduplicate orderings; reject duplicate elements and invalid selection rank |
| `maths\|4\|npr-and-ncr` | Meaning of P(n, r) and C(n, r) | CH-17a | J:listed; A:application; N:not_applicable | text_only | Integer n,r with 0<=r<=n; n=0; contrast ordered/unordered count-only expressions | Compare formulas with independent small enumeration and P(n,r)=r!C(n,r); justify text-only when no object-level choice is asked; invalid factorial inputs reject |
| `maths\|4\|circular-permutations` | Circular permutations | CH-17b | J:application; A:application; N:not_applicable | conditional | Labeled people on a circle; rotations equivalent; reflections equivalent only when stated; fixed seats as separate case | Enumerate cyclic rotation orbits for small n; (n-1)! applies only to free rotation; reject dividing by two without reflection equivalence; permutation cycle notation is not a seating proof |
| `maths\|4\|permutations-with-repetition` | Permutations with repetition | CH-17b | J:application; A:application; N:not_applicable | conditional | Repeated-symbol multiset arrangements versus repeated-choice slots; explicit multiplicities and length | Enumerate distinct words and compare n!/product(m_i!) or n^r for the appropriate model; reject conflating identical objects with replacement choices |
| `maths\|4\|combinations-with-restrictions` | Combinations with restrictions and complementary counting | CH-17b | J:application; A:application; N:not_applicable | conditional | At least/at most/exactly constraints; mandatory/forbidden elements; complementary counting | Enumerate feasible subsets independently; complement has a stated universe and no overlap; impossible constraints yield zero not invented selections |
| `maths\|4\|division-into-groups` | Division of objects into groups | CH-17b | J:application; A:application; N:not_applicable | conditional | Labeled/unlabeled equal or unequal groups; empty groups only if allowed; indistinguishable objects distinguished explicitly | Enumerate partitions and compare multinomial counts with the appropriate equal-group symmetry divisor; reject division by a symmetry factor for labeled groups |
| `maths\|4\|simple-applications` | Simple applications of permutations and combinations, including word and number formation | CH-17a | J:listed; A:application; N:not_applicable | conditional | Word/number formation; leading-zero exclusion; adjacent/nonadjacent conditions; no repeated digit versus replacement | Independent bounded enumeration obeys every stated restriction; counts with leading zero or duplicate forbidden words reject; a pure formula result may stay text-only |

### Core 18 — Three-Dimensional Geometry

Unit `maths\|11`; 14 topics assigned.

| Topic ID | Topic | Primary packet | Scope tags | Visual hypothesis | Required variants | Independent acceptance tests |
| --- | --- | --- | --- | --- | --- | --- |
| `maths\|11\|point-distance-and-section` | Coordinates of a point in space and distance between two points | CH-18a | J:listed; A:listed; N:not_applicable | required | Points in all octants; coincident points; world versus projected coordinates; common frame | Independent Euclidean 3D distance agrees in the world frame; presentation changes cannot alter it; mixed-frame coordinates reject |
| `maths\|11\|section-formula-in-space` | Section formula in space | CH-18a | J:listed; A:application; N:not_applicable | required | Internal/external division; signed ratios; midpoint; external denominator zero | Independent 3D affine combination and world collinearity/ratio checks agree; reject a finite external point at a zero denominator |
| `maths\|11\|direction-ratios-and-cosines` | Direction ratios and direction cosines | CH-18a | J:listed; A:listed; N:not_applicable | required | Positive/negative/axis-aligned direction triples; equivalent ratios; unit normalization | Independent l^2+m^2+n^2=1 and proportional direction ratios verify orientation; zero direction and mixed world frames reject |
| `maths\|11\|angle-between-intersecting-lines` | Angle between two intersecting lines | CH-18b | J:listed; A:listed; N:not_applicable | required | Intersecting acute/obtuse/perpendicular lines; opposite directions; specified directed/undirected convention | Independent world dot product normalized by lengths gives the angle; common-point incidence is verified when intersection is claimed; projection angle never certifies it |
| `maths\|11\|equation-of-a-line` | Equation of a line | CH-18a | J:listed; A:listed; N:not_applicable | required | Vector/parametric/symmetric forms; zero direction components; source point/direction; line versus ray | Independent substitution and collinearity verify sampled points; zero components become constant coordinates rather than division by zero; zero vector rejects |
| `maths\|11\|skew-lines` | Skew lines, the shortest distance between them, and its equation | CH-18b | J:listed; A:listed; N:not_applicable | required | Skew/intersecting/parallel/coincident pairs; shortest connector; feet and distance; nearly parallel limitation | Independent connector perpendicular to both directions and scalar triple distance agree for skew lines; parallel case uses its own formula; projected crossing cannot certify intersection |
| `maths\|11\|plane-equations` | Equations of a plane in different forms | CH-18c | J:supplemental; A:listed; N:not_applicable | required | Normal-point/general/intercept/three-point forms; axis-parallel plane; independent normal; collinear input points | Independent n dot (P-P0)=0 for source points and nonzero normal establishes plane identity; three collinear points or zero normal cannot determine a unique plane |
| `maths\|11\|angle-between-planes` | Angle between two planes | CH-18c | J:supplemental; A:listed; N:not_applicable | required | Parallel/perpendicular/oblique planes; normal sign reversal; acute versus directed convention | Independent normal dot products verify world angle; normal scaling/sign changes respect the declared convention; zero normal rejects |
| `maths\|11\|angle-between-line-and-plane` | Angle between a line and a plane | CH-18c | J:supplemental; A:listed; N:not_applicable | required | Line parallel/perpendicular/oblique to plane; direction-normal angle complement; common frame | Independent sin(theta)=abs(d dot n)/(norm(d)*norm(n)) gives inclination; reject using the complementary normal angle or fitted projection angle |
| `maths\|11\|distance-from-point-to-plane` | Distance of a point from a plane | CH-18c | J:supplemental; A:listed; N:not_applicable | required | On/off-plane point; signed side; perpendicular foot; scaled equation coefficients | Independent abs(n dot P+c)/norm(n), foot incidence and perpendicular connector agree; mixed frame or zero normal rejects |
| `maths\|11\|line-plane-intersection` | Intersection of a line and a plane | CH-18c | J:supplemental; A:application; N:not_applicable | required | Single contact; parallel disjoint; contained line; source parameter and world point | Independent solve of n dot (P0+t*d)+c=0 classifies one/none/infinite contacts; reject a finite unique intersection for a contained or parallel-disjoint line |
| `maths\|11\|coplanar-lines` | Coplanar lines | CH-18c | J:supplemental; A:listed; N:not_applicable | required | Intersecting/parallel/coincident coplanar lines versus skew pair; containing plane when unique | Independent (P2-P1) dot (d1 cross d2)=0 plus parallel-case handling verifies coplanarity; skew false claim rejects; coincident lines do not select an arbitrary unique plane |
| `maths\|11\|image-of-a-point-in-a-plane` | Image of a point in a plane | CH-18c | J:supplemental; A:application; N:not_applicable | required | Off/on-plane point; midpoint perpendicular foot; reflection involution; normal sign reversal | Independent P'=P-2*(n dot P+c)*n/(n dot n) satisfies equal opposite signed distances; midpoint lies in plane; wrong-sign reflection and mixed frames reject |
| `maths\|11\|intersection-of-two-planes` | Intersection of two planes | CH-18c | J:supplemental; A:application; N:not_applicable | required | Oblique pair yields a line; parallel disjoint; coincident planes; line direction and source point | Independent solve of both plane equations and n1 cross n2 direction verifies the line; parallel pair cannot emit a unique intersection line |

### Core 29 — Sets, Relations and Functions

Unit `maths\|1`; 10 topics assigned.

| Topic ID | Topic | Primary packet | Scope tags | Visual hypothesis | Required variants | Independent acceptance tests |
| --- | --- | --- | --- | --- | --- | --- |
| `maths\|1\|sets-and-operations` | Sets and their representation | CH-29a | J:listed; A:listed; N:not_applicable | conditional | Roster and property-defined sets; empty/finite/infinite sets; explicit universe and element membership | Compare roster membership with defining predicate on a bounded witness set; reject duplicate or contradictory memberships; justify text-only definition recall |
| `maths\|1\|union-intersection-complement` | Union, intersection, complement, and algebraic properties of sets | CH-29a | J:listed; A:listed; N:not_applicable | conditional | Two/three finite sets; disjoint/nested/overlapping sets; complement with stated universe; De Morgan and Advanced symmetric difference | Enumerate membership truth tables and compare selected regions; test missing universe for complement and negative exclusive counts; regions carry no metric-area claim |
| `maths\|1\|venn-diagrams-and-cardinality` | Venn diagrams and cardinality of unions and intersections | CH-29a | J:application; A:application; N:not_applicable | required | Two/three-set unions; zero-sized atoms; outside-union count; inclusive versus exclusive intersections | Independent inclusion-exclusion plus element enumeration; each displayed witness has the expected membership mask; inconsistent intersection counts reject atomically |
| `maths\|1\|power-set` | Power set | CH-29a | J:listed; A:application; N:not_applicable | conditional | Empty set and sets of 1-4 distinct elements; rank layers; empty/full subsets | Enumerate all 2^n subsets and rank counts C(n,r); edges add exactly one element; reject duplicate source elements; text-only count-only questions remain eligible for independent review |
| `maths\|1\|relations` | Relations and types of relations | CH-29a | J:listed; A:listed; N:not_applicable | conditional | Ordered pairs on finite A x B; domain/codomain retained; reflexive/symmetric/transitive versus counterexample relations | Enumerate ordered pairs and independently test each relation property; a missing self-loop or reverse edge must defeat the relevant claim; reject pairs outside A x B |
| `maths\|1\|equivalence-relations` | Equivalence relations | CH-29a | J:listed; A:listed; N:not_applicable | conditional | Equality/modular equivalence on finite domains; singleton/multiple classes; nontransitive near-miss | Check reflexivity/symmetry/transitivity by all finite triples; partition classes are disjoint and exhaustive; a cross-class link rejects a false equivalence claim |
| `maths\|1\|functions` | Functions: one-one and onto | CH-29b | J:listed; A:listed; N:not_applicable | conditional | Injective/onto/bijective maps; finite unequal-size domain/codomain; infinite-domain examples with restrictions | Every domain input has one image; enumerate preimages and image set; preserve unused codomain nodes; reject an inverse claim without bijectivity |
| `maths\|1\|into-and-many-one-functions` | Into and many-one functions | CH-29b | J:review; A:review; N:not_applicable | conditional | Into is explicitly listed; many-one is a mapping application; unused codomain values and collisions; constant function | Enumerate image/preimage counts to distinguish into from many-one; retain codomain; reject a one-one label after a collision; freeze mixed-label exam interpretation separately |
| `maths\|1\|number-of-relations-and-functions` | Number of relations and functions between finite sets | CH-29a | J:application; A:application; N:not_applicable | conditional | Finite m-element to n-element sets; empty-domain/empty-codomain cases; all relations versus all functions | Enumerate small cases and compare 2^(mn) and n^m with empty-set conventions; relation edges may be multivalued but function edges may not; count-only questions can be text-only |
| `maths\|1\|function-composition` | Composition of functions | CH-29b | J:listed; A:listed; N:not_applicable | conditional | g after f versus f after g; partially compatible domains; identity and invertible composition | Independently evaluate g(f(x)) on the legal domain; reject omitted intermediate values and wrong order; inverse composition equals identity only on the restricted domain |

### Core 30 — Complex Numbers and Quadratic Equations

Unit `maths\|2`; 14 topics assigned.

| Topic ID | Topic | Primary packet | Scope tags | Visual hypothesis | Required variants | Independent acceptance tests |
| --- | --- | --- | --- | --- | --- | --- |
| `maths\|2\|complex-number-representation` | Complex numbers as ordered pairs of reals and in the form a + ib | CH-30b | J:listed; A:application; N:not_applicable | conditional | Real/pure imaginary/general/zero numbers; ordered pair and a+ib correspondence | Check Re/Im coordinates independently and preserve i^2=-1; reject swapped axes or invented argument at zero; representation-only algebra may be text-only |
| `maths\|2\|argand-plane` | Argand diagram and representation of complex numbers in a plane | CH-30b | J:listed; A:listed; N:not_applicable | required | All quadrants; real and imaginary axes; translated display origin; explicit scale | Re/Im source values determine the point independently of display scale; axes and zero are retained; wrong-sign imaginary coordinates or physical-unit labels reject |
| `maths\|2\|complex-number-algebra` | Algebra of complex numbers | CH-30b | J:listed; A:listed; N:not_applicable | conditional | Sum/product/quotient/conjugate; rotations and translations; zero factors; nonzero divisor | Compare real/imaginary components with independent algebra; conjugation reflects the imaginary component; zero divisor rejects rather than creating a finite point |
| `maths\|2\|modulus-and-argument` | Modulus of a complex number | CH-30b | J:listed; A:listed; N:not_applicable | conditional | Modulus of general/real/pure imaginary/zero z; locus abs(z-a)=r | Compute sqrt(x^2+y^2) and check locus membership; reject negative radius or modulus label derived from display length; zero has modulus zero |
| `maths\|2\|argument-and-polar-form` | Argument of a complex number and polar form | CH-30b | J:review; A:listed; N:not_applicable | required | Main argument is explicit and polar form is its representation application; quadrant-sensitive principal argument; branch cut; zero z | Independently use atan2 and declared principal interval; verify r(cos(theta)+i sin(theta)); reject argument for z=0 and a quadrant-losing arctan(y/x); freeze the mixed Main label |
| `maths\|2\|de-moivre-and-nth-roots` | De Moivre's theorem and nth roots of a complex number | CH-30b | J:supplemental; A:supplemental; N:not_applicable | conditional | Supplemental integer powers and bounded general nth roots; distinguish Main quadratic and Advanced cube-unity overlaps | Each root satisfies w^n=z and nonzero z has n distinct roots; compare n=2/3 by direct algebra; reject noninteger/unbounded degree; general De Moivre is not a listed heading |
| `maths\|2\|cube-roots-of-unity` | Cube roots of unity | CH-30b | J:supplemental; A:listed; N:not_applicable | required | 1, omega, omega^2; rotated products; real versus nonreal roots | Enumerate exactly three roots of z^3=1; check 1+omega+omega^2=0 and 120-degree separation; reject a missing root or real-axis placement of nonreal roots |
| `maths\|2\|square-roots-and-triangle-inequality` | Square root of a complex number | CH-30b | J:application; A:application; N:not_applicable | conditional | Both square roots of positive/negative/general complex z; zero root multiplicity | Square each candidate and compare with z; nonzero z has two opposite roots; distinguish a chosen principal root from the complete pair; a single-root completeness claim rejects |
| `maths\|2\|triangle-inequality` | Triangle inequality for complex numbers | CH-30b | J:supplemental; A:listed; N:not_applicable | required | abs(z+w) bounds; aligned/opposed/perpendicular vectors; equality and zero cases | Independent modulus calculations check upper and reverse inequalities; equality requires the appropriate collinear directions; display-scaled lengths cannot establish the inequality |
| `maths\|2\|quadratic-equations` | Quadratic equations in real and complex number systems and their solutions | CH-30a | J:listed; A:review; N:not_applicable | conditional | Real coefficients with real/repeated/nonreal roots; Main complex-coefficient extension; Advanced restricted real coefficients | Substitute both roots into ax^2+bx+c and independently factor; a=0 is not quadratic; Advanced complex-coefficient scope needs freeze decision; nonreal roots never become real x-intercepts |
| `maths\|2\|roots-and-coefficients` | Relations between roots and coefficients | CH-30c | J:listed; A:listed; N:not_applicable | conditional | Vieta sums/products; real and conjugate roots; symmetric expressions in two roots | Check alpha+beta=-b/a and alpha*beta=c/a independently, then reduce symmetric expressions; reject a=0 and inconsistent supplied roots; algebra-only cases can be text-only |
| `maths\|2\|nature-of-roots` | Nature of roots of a quadratic equation | CH-30a | J:listed; A:application; N:not_applicable | conditional | Positive/zero/negative discriminant for real coefficients; multiplicity; coefficient sign variations | Independent discriminant matches root multiplicity and real intercept count; reject an ordering or sign claim for nonreal roots; no real-parabola interpretation for nonreal coefficients |
| `maths\|2\|quadratic-from-roots` | Formation of quadratic equations with given roots | CH-30a | J:listed; A:listed; N:not_applicable | conditional | Given distinct/repeated/conjugate roots; specified leading coefficient; compatible real-coefficient constraints | Expand a(x-alpha)(x-beta) independently; both roots satisfy the result; a nonconjugate nonreal pair rejects a real-coefficient claim; no diagram is required for pure expansion |
| `maths\|2\|common-roots-of-quadratics` | Common roots of two quadratic equations | CH-30c | J:application; A:application; N:not_applicable | conditional | One/two/no common roots; proportional quadratics; parameter-dependent shared root | Substitute the shared candidate into both equations and compare independently factored root sets; reject a candidate satisfying only one; proportional equations retain both roots |

### Core 31 — Vector Algebra

Unit `maths\|12`; 10 topics assigned.

| Topic ID | Topic | Primary packet | Scope tags | Visual hypothesis | Required variants | Independent acceptance tests |
| --- | --- | --- | --- | --- | --- | --- |
| `maths\|12\|vectors-and-scalars` | Vectors and scalars | CH-31a | J:listed; A:application; N:not_applicable | conditional | Scalar versus oriented vector; free/position vectors; zero vector; signed scalar multiple; 2D/3D | Independent components and units identify the object type; reject a direction or normalized unit vector for zero; classification-only questions may stay text-only |
| `maths\|12\|vector-addition` | Addition of vectors | CH-31a | J:listed; A:listed; N:not_applicable | required | Head-to-tail/parallelogram sums; subtraction; opposite vectors and zero sum; 2D/3D frames | Independent component addition verifies result and translated-arrow endpoints; zero sum uses a genuine zero marker; reject a display-length-based sum or mismatched frames |
| `maths\|12\|vector-components` | Components of a vector in two dimensions and three-dimensional space | CH-31a | J:listed; A:application; N:not_applicable | required | 2D/3D orthogonal basis; signed components; unit vectors; same vector under declared basis change | Independent reconstruction sum(v_i*e_i) and orthonormality checks agree; reject mixing basis coordinates or silently flattening a z component |
| `maths\|12\|scalar-and-vector-products` | Scalar product of two vectors | CH-31a | J:listed; A:listed; N:not_applicable | conditional | Positive/negative/zero dot products; angle; perpendicular vectors; zero-vector edge case | Independent component dot product and cosine identity agree for nonzero vectors; zero-vector angle is undefined; reject using arrow display lengths as source magnitudes |
| `maths\|12\|cross-product` | Vector product of two vectors | CH-31b | J:listed; A:listed; N:not_applicable | required | Right-handed 3D cross product; reversed order; parallel/antiparallel zero; source plane and page-normal display | Independent component determinant and orthogonality verify magnitude/orientation; a dot/cross page glyph cannot establish planar incidence; wrong handedness rejects |
| `maths\|12\|projection-of-a-vector` | Projection of a vector on another vector | CH-31a | J:application; A:application; N:not_applicable | required | Signed scalar/vector projections; oblique/perpendicular/antiparallel target; zero source and zero target | Independent (a dot b)/(b dot b)*b and perpendicular residual verify vector projection; zero target rejects; negative projection remains directed rather than absolute |
| `maths\|12\|triple-products` | Scalar triple product | CH-31c | J:supplemental; A:listed; N:not_applicable | required | Scalar triple determinant; cyclic/order reversal; signed volume; zero coplanar case | Independent 3x3 determinant equals a dot (b cross c); order swap reverses sign; noncoplanar volume cannot be certified from flattened area |
| `maths\|12\|vector-triple-product` | Vector triple product | CH-31c | J:supplemental; A:listed; N:not_applicable | required | a cross (b cross c) versus (a cross b) cross c; BAC-CAB identity; zero/parallel cases | Independent component cross products and b(a dot c)-c(a dot b) agree for the stated grouping; reject associative rewriting and wrong parentheses |
| `maths\|12\|collinear-and-coplanar-vectors` | Collinearity and coplanarity using vectors | CH-31c | J:review; A:application; N:not_applicable | required | Collinearity is a Main vector-product application; coplanarity uses Advanced triple products; zero-vector conventions | Independent cross-zero test and scalar-triple-zero test verify distinct relations; reject collinearity inferred from coplanarity; freeze the mixed Main row rather than marking all variants listed |
| `maths\|12\|area-and-volume-via-vectors` | Area of a triangle or parallelogram and volume of a parallelepiped using vectors | CH-31c | J:review; A:listed; N:not_applicable | required | Main cross-product area application; triangle factor 1/2; Advanced triple-product parallelepiped volume; signed orientation | Independent cross norm and abs(3x3 determinant) verify area/volume; reject treating volume as a Main listed demand or using projected areas as world volume |

### Core 32 — Statistics and Probability

Unit `maths\|13`; 12 topics assigned.

| Topic ID | Topic | Primary packet | Scope tags | Visual hypothesis | Required variants | Independent acceptance tests |
| --- | --- | --- | --- | --- | --- | --- |
| `maths\|13\|central-tendency-and-dispersion` | Calculation of mean, median, and mode for grouped and ungrouped data | CH-32a | J:listed; A:listed; N:not_applicable | conditional | Grouped/ungrouped mean/median/mode; unequal classes; tied modes; grouped interpolation versus exact raw data | Independent weighted sums/sorted raw values verify measures; grouped estimates disclose midpoint/interpolation assumptions; reject fabricated within-class raw values and empty-data means |
| `maths\|13\|standard-deviation-variance-and-mean-deviation` | Calculation of standard deviation and variance for grouped and ungrouped data | CH-32a | J:listed; A:listed; N:not_applicable | conditional | Population variance/standard deviation; grouped midpoint estimate; same mean with different spread; zero variance | Independent sum(f*(x-mean)^2)/sum(f) agrees with second-moment identity; std=sqrt(variance); reject negative frequencies or an unstated sample n-1 convention |
| `maths\|13\|mean-deviation` | Mean deviation for grouped and ungrouped data | CH-32a | J:listed; A:listed; N:not_applicable | conditional | Absolute deviations about mean or median as specified; raw/grouped values; translated data | Independent weighted absolute-deviation sum verifies result and chosen center; reject signed cancellation used as mean deviation and an unstated center |
| `maths\|13\|event-probability-and-theorems` | Probability of an event and the addition theorem of probability | CH-32b | J:listed; A:listed; N:not_applicable | conditional | Explicit finite sample space; impossible/certain/overlapping/disjoint events; nonuniform outcomes | Independent event enumeration/weight sums verify P(A union B)=P(A)+P(B)-P(A intersect B); reject assuming equal likelihood or double-counting overlap |
| `maths\|13\|multiplication-theorem-and-independence` | Multiplication theorem and independent events | CH-32b | J:listed; A:listed; N:not_applicable | conditional | Independent versus dependent stages; with/without replacement; mutually exclusive events | Independent P(A intersect B)=P(A)*P(B given A) and independence test agree; reject multiplying marginals for dependent draws and conflating independence with disjointness |
| `maths\|13\|conditional-probability` | Conditional probability | CH-32b | J:application; A:listed; N:not_applicable | conditional | Reduced sample space; nonuniform weights; zero-probability condition; conditional tree | Independent ratio P(A intersect B)/P(B) agrees with enumeration; P(B)=0 rejects the ratio; branches retain conditioning identities |
| `maths\|13\|total-probability` | Theorem of total probability | CH-32b | J:application; A:listed; N:not_applicable | conditional | Disjoint exhaustive conditioning partition; zero-weight branch; incomplete/overlapping partitions | Independent sum P(B_i)*P(A given B_i) agrees with joint enumeration; nonexhaustive or overlapping cases reject a complete-total claim |
| `maths\|13\|bayes-theorem` | Bayes' theorem | CH-32b | J:listed; A:listed; N:not_applicable | conditional | Prior/likelihood/posterior roles; two/multiple hypotheses; impossible evidence; zero prior | Independent joint/total-evidence ratio verifies posterior and normalization; zero evidence probability rejects; reversing conditionals without priors rejects |
| `maths\|13\|random-variable-distribution` | Probability distribution of a random variable | CH-32c | J:listed; A:application; N:not_applicable | required | Discrete outcome-to-value map; repeated values aggregated; zero probability; normalized mass plot | Independent sample-space pushforward produces all masses with sum one; reject negative mass, omitted outcomes, or a continuous-density curve substituted for discrete probabilities |
| `maths\|13\|mean-and-variance-of-a-random-variable` | Mean and variance of a discrete random variable | CH-32c | J:application; A:listed; N:not_applicable | conditional | Finite discrete distributions; equal means/different variances; constants; shifted/scaled variables | Independent E[X]=sum(xp) and Var(X)=E[X^2]-E[X]^2 verify moments; nonnormalized mass and negative variance beyond arithmetic tolerance reject |
| `maths\|13\|bernoulli-trials-and-binomial-distribution` | Bernoulli trials and binomial distribution | CH-32c | J:application; A:application; N:not_applicable | required | n independent identical Bernoulli trials; p=0/1; success count k=0..n; dependent/nonidentical counterexamples | Independent binary-outcome enumeration gives C(n,k)p^k(1-p)^(n-k) and total mass one; reject the binomial model for dependent or unequal-p trials without a new contract |
| `maths\|13\|binomial-mean-and-variance` | Mean and variance of a binomial distribution | CH-32c | J:application; A:application; N:not_applicable | conditional | Binomial n,p; endpoints; translated count comparisons; moments derived from finite distribution | Independent weighted pmf sums agree with np and np(1-p); illegal n,p or absent Bernoulli assumptions reject; formulas are applications, not separately enumerated syllabus headings |

### Core 33 — Trigonometry

Unit `maths\|14`; 10 topics assigned.

| Topic ID | Topic | Primary packet | Scope tags | Visual hypothesis | Required variants | Independent acceptance tests |
| --- | --- | --- | --- | --- | --- | --- |
| `maths\|14\|trigonometric-identities` | Trigonometrical identities | CH-33b | J:listed; A:application; N:not_applicable | conditional | Pythagorean/reciprocal/quotient identities; common domains; zero denominators | Independent algebra or angle addition proves identity on the common domain; invalid cancellation at sin/cos zeros rejects; pure identity manipulation may stay text-only |
| `maths\|14\|compound-and-multiple-angles` | Compound-angle and multiple-angle formulae | CH-33b | J:application; A:listed; N:not_applicable | conditional | Addition/subtraction; double/triple/half angles; sign of half-angle root by quadrant | Independent angle formula values and quadrant signs agree; reject missing +/- branch in half-angle recovery and extension across undefined denominators |
| `maths\|14\|sum-to-product-transformations` | Sum-to-product and product-to-sum transformations | CH-33b | J:application; A:application; N:not_applicable | conditional | Sum/difference of sine/cosine; reverse product-to-sum; radian inputs and phase signs | Independent expansion via addition formulas recovers both sides; reject swapped sum/difference signs and unstated domain cancellation |
| `maths\|14\|trigonometric-functions` | Trigonometrical functions | CH-33a | J:listed; A:listed; N:not_applicable | required | Unit circle; radian angle; sine/cosine/tangent graphs; periods; tangent poles; quadrants | Independent unit-circle coordinates and periodic equations verify graph values; no stroke crosses a tangent pole; degree/radian confusion and wrong quadrant signs reject |
| `maths\|14\|range-of-trigonometric-expressions` | Range of trigonometric expressions | CH-33a | J:application; A:application; N:not_applicable | required | a*sin(x)+b*cos(x); constrained intervals; rational trig expression with exclusions; attained versus limiting extrema | Independent amplitude bound plus equality/endpoint cases establishes the full image; reject a range endpoint requiring an excluded denominator or unstated all-real angle domain |
| `maths\|14\|trigonometric-equations` | Trigonometric equations | CH-33b | J:application; A:application; N:not_applicable | conditional | Finite-interval sin/cos/tan equations; extraneous roots after squaring; endpoints and pole exclusions | Independent substitution and complete period-by-period enumeration verify all solutions in the stated interval; reject missing or extraneous roots |
| `maths\|14\|general-solution-of-trigonometric-equations` | General solution of trigonometric equations | CH-33b | J:application; A:listed; N:not_applicable | required | Integer-indexed solution families; sine/cosine dual branches; tangent period; duplicate branch merger | Independent identity/period reasoning establishes completeness for all integer k; reject dropping one sine branch or including tangent-pole roots |
| `maths\|14\|inverse-trigonometric-functions` | Inverse trigonometrical functions and their properties | CH-33c | J:listed; A:listed; N:not_applicable | required | Principal arcsin/arccos/arctan branches; composition identities; multi-valued inverse relation distinguished | Independent sin/cos/tan of the returned principal value recovers the legal input and principal range; reject unrestricted inverse cancellation outside the selected branch |
| `maths\|14\|principal-values-of-inverse-trig` | Principal values, domain, and range of inverse trigonometric functions | CH-33c | J:application; A:listed; N:not_applicable | required | Domain/range endpoints; branch-restricted graphs; negative inputs; optional inverse sec/csc convention made explicit | Independent principal interval and forward-function checks verify the value; out-of-domain real input rejects and branch conventions are source-declared |
| `maths\|14\|heights-and-distances` | Heights and distances | CH-33c | J:application; A:application; N:not_applicable | required | Source-defined right triangles; elevation/depression; two observation stations; horizontal/sloped ground distinguished | Independent right-triangle tangent equations and angle relations verify heights/distances; reject invented ground-level or observer-height assumptions; pure trig syllabus does not explicitly enumerate this application |

## Documentation verification

The generated CSV was parsed against the Maths taxonomy: exact 15-column header; all 179 topic IDs, unit IDs and labels preserved; no missing/duplicate/extra primary rows; one defined packet per topic; all 38 used packets defined; per-chapter allocations sum to the exact taxonomy totals. Every row has `topic audit pending`, NEET `not_applicable`, nonempty source page/unit references, explicit variants/checks and S0 dependency. Markdown topic tables preserve 179 unique pipe-escaped IDs with seven cells per row. This validates documentation structure and assignment completeness, not mathematical execution, scene accuracy or official diagram obligation.
