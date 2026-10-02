# Reusable diagram operator expansion — 25 chapters

This change extends `scene-document/v2` rather than adding chapter or question
templates. Each construction receives explicit mathematical inputs, computes
its geometry deterministically, and fails closed when those inputs are
infeasible or incomplete. Source quantities remain the numeric authority.

See the root [coverage plan and resume record](../../DIAGRAM_ENGINE_COVERAGE_PLAN.md)
for the publication baseline, remaining roadmap and full-coverage acceptance definition.

## Acceptance criteria

- Operators are registered in the canonical capability manifest, implemented
  by the compiler, and validated before any marks render.
- The tutor planner receives both the operator contracts and the relevant
  semantic family capabilities. No extra English classifier selects them.
- Coordinates come from mathematical constructions, never hard-coded board
  positions. Existing viewport fitting and label placement remain responsible
  for the 1200 by 700 board and its diagram zone.
- Each chapter owns a new verification gate. Independent equations, incidence,
  topology, and rejection checks establish accuracy, rather than an ink count.
- Tests vary dimensions, orientations, and quantity bindings. They reject
  non-finite values, degenerate geometry, missing references, and unbounded
  sampling requests. Invalid documents emit no partial render scene.
- Existing checks must introduce no regressions; pre-existing failures are
  reproduced against the starting code and recorded explicitly. Package builds
  make the new operators available to the tutor.

## Parallel ownership

The parent owns compiler dispatch, structural validation dispatch, the
capability manifest, planner integration, package scripts, and final review.
Chapter agents own their new mathematical modules and verification scripts.
The first wave covers fifteen chapters: statistics, trigonometry/triangles,
conic sections, probability, 3D geometry, electrostatics, circle geometry,
linear algebra, vector algebra, kinematics, calculus, waves, AC circuits,
thermodynamic graphs, and geometric optics. The runtime permits three workers
alongside the parent; chapter tasks therefore run in waves. Finished workers
are reused when the runtime refuses additional threads.

The requested extension adds complex numbers, sets/Venn diagrams, combinatorics,
simple harmonic motion, rotational mechanics, gravitation, magnetism,
electromagnetic induction, fluids and elasticity. These ten lanes use the same
source-math and atomic rejection standards while the original gates continue.

## Evidence

The working tree at the start already contained mensuration, label, chemistry,
and other changes. This session preserves those changes. New chapter gates
measure explicitly supported construction families; they do not claim a
percentage improvement for the whole question bank without a bank evaluation.

## Implemented coverage

The publication catalog grows from **60 to 127 operators** on current `main`.
The development workspace had 128 because it also contained another session's
uncommitted `solid_anchor`; that separate work is excluded from this PR. The
following **67 new operators** are mathematical constructions, not chapter
templates. Each is available to the live tutor planner and compiler.

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

## Shared accuracy improvements

- 3D predicates consume world metadata and frame identity. Projected
  collinearity, angle or length cannot certify a physical relation. Incompatible
  frames, mixed 2D/3D operands and non-finite distance ratios fail atomically.
- Generic 2D producers reject world inputs that would discard this authority.
  Use `space_segment`, `space_project` and the other typed space operators.
- Existing tangent/normal lines consume exact derivative callbacks. Calculus
  composes with motion, waves, PV, hydrostatic, SHM, induction and elasticity curves through
  bounded, memoized dependency replay with parameter-unit checks.
- Computed label validation runs before engine-owned label assignment. False
  values cannot be silently replaced by correct geometry while stale numeric
  text remains visible. Display scale never becomes a physical measurement.
- Length proofs and dimensions reject independently scaled physical arrows or
  plot ancestry. Generic descendants cannot erase that authority to add numeric
  claims. Checked typed source owners retain their legitimate physical labels.
- Nonmetric sets/discrete graphs cannot certify distances, angles, physical
  values or electrical-terminal topology. Page-normal glyphs cannot establish
  in-plane direction or incidence, including through generic descendants.
- SI prefix case is significant throughout source quantities, wrappers, units
  and labels. Nonzero literals and poorly conditioned subnormal operations cannot
  become certified zero or change a normalized arrow's represented direction.
- Generic physical-curve derivatives cannot accept an unrelated planner scalar
  as physical authority; numeric givens/results belong on their typed source
  owner. Source-derived text anchors participate in fitting, so count/scalar
  labels and leaders stay within the diagram zone without fake member dots.
- Lens outlines reject thicknesses that make their two surfaces cross. Labels
  on infinite paths anchor to the visible clipped stroke inside the viewport.
- Scoped planner requests retain full operator contracts. The complete catalog
  retains all input/output shapes within the existing initial/repair prompt
  budgets; combined semantic families compact when needed, and repairs retain
  full contracts for their actual operators. Conditional output kinds/orders and
  required source assumptions survive compaction.

## Reproduction

```sh
pnpm --filter @heytutor/scene-engine build
pnpm --filter @heytutor/tutor-core build
pnpm --filter @heytutor/scene-engine verify:coverage
pnpm --filter @heytutor/tutor-core verify:coverage
```

The engine coverage command runs all twenty-five chapter gates, shared authority
regressions, and a thirty-two-example SVG gallery. The gallery defaults to
`/tmp/heytutor-operator-coverage/index.html`; every primitive is checked against
the diagram viewport on the 1200 by 700 board. Each chapter gate uses source
equations and independent oracles plus live atomic-rejection tests. Planner
verification checks all 67 new contracts, their semantic capability access and
actual initial/repair transport budgets.

## Limits

This extends expressible deterministic scenes; it does not certify every
question in these chapters or measure a new question-bank coverage percentage.
Source measurements, signs, units, topology and physical assumptions must be
explicit. Ambiguous SSA, coincident/parallel intersection ambiguity, unsupported
or non-differentiable derivatives, singular electrical/optical states, mixed
units, undersampled waves and numerically uncertifiable geometry fail closed.
The derivative validator conservatively rejects an `abs` node at zero even if
a larger expression could be differentiable there. AC topology uses existing
verified symbols and connections; phasors alone do not imply a circuit.
Optical anchors do not infer surface geometry or a ray path. Thermodynamic
processes do not infer heat, temperature or an adiabatic exponent.

Verification results and remaining repository-wide blockers are recorded below
after the final review fixes.


## Verification scope

The chapter/operator gates, planner transport budgets, engine bank/corpus gates,
typecheck, lint, builds and tutor diagram integration gates are rerun after final
integration. Gallery SVGs are rasterized and visually inspected; this is offline
render validation, not a live browser or voice synchronization test.

The initial tree already failed two tutor-core gates: the hard vertical-circle
work-energy case and the physics decline threshold. A comparison of all 846
physics probes reproduced 63 declines before and after the twenty-five-chapter
expansion, with zero regressions. The threshold is not raised to hide the baseline.
The full tutor verify command also needs DATABASE_URL for its trace-ownership
test; the offline diagram gates can run independently.

An active development server shares the tutor's .next directory, so the ordinary
production build can race on trace files after compilation succeeds. Production
build validation uses a separate temporary source tree with isolated artifacts.


Development-workspace results for this expansion (publication results are recorded
in the root coverage plan):

| Check | Result |
| --- | --- |
| Full scene-engine verify | Passed, including existing bank/corpus gates and all 25 chapter gates. |
| Planner capability/transport gate | 25 requests and 67 new contracts passed; 128 canonical operators were accessible in the development workspace; publication has 127. |
| Tutor-core gates run independently | 41/43 passed; the two reproduced baseline failures remain. |
| Tutor diagram integration | All 12 offline integration gates passed. |
| Repository typecheck/lint | Both passed; existing lint warnings remain. |
| Production builds | Shared packages/landing passed; isolated tutor build compiled, checked types and generated all 46 static pages. |
| Physics baseline comparison | 846 probes; 63 declines in both versions, zero regressions. |
| Visual review | 32 verified SVG compositions, checked against the viewport and inspected as raster images. |
