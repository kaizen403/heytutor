# Verified Diagram Architecture

The shipped v4 design is documented in
[universal-illustration-engine-v4.md](universal-illustration-engine-v4.md). The
full-syllabus capability and certification roadmap is
[universal-syllabus-capability-plan-v5.md](universal-syllabus-capability-plan-v5.md).

## Authority

The semantic scene engine owns every diagram mark: geometry, topology, labels,
dimensions, directions, construction marks, layout, and reveal order. The
teaching model owns narration and equation writing in the left work area. It
never supplies diagram pixels or annotations.

There is no live topic-template registry, domain plugin router, regex diagram
matcher, pixel architect, or endpoint snap fallback.

## Turn Pipeline

1. `TurnPlanV3` extracts exact givens, unknowns, derived values, claims, laws,
   assumptions, and whether a visual is required.
   Two independent lanes are compared, explicit arithmetic is recomputed through
   its dependency chain, and a third bounded attempt is available when both
   initial plans are invalid. The runtime question and quantity provenance stay
   server-owned.
2. A source-grounded `ProblemIR/v1` planner binds supported solve requests to
   exact TurnPlan quantity IDs. The local deterministic solver independently
   evaluates those requests. Only scalar values with matching ID, symbol, unit,
   and proof may reconcile the plan; contradictions stop before speech. The
   boundary repairs only exact-source offsets and typed-schema aliases, removes
   ungrounded evidence, and drops ambiguous requests rather than guessing them.
3. The scene planner proposes coordinate-free `scene-document/v2` candidates.
4. Reusable constraint compilers canonicalize relationships which the planner
   asserted: closed routes, owner-bound dimensions, paraxial reflection, and
   coincident or retraced construction paths. These are law-level operators;
   they do not select a topic, recognize a question with regex, or contain
   board coordinates.
5. `@heytutor/scene-engine` validates references, dependencies, quantities,
   topology, assertions, label placement, and render coverage.
6. Invalid candidates may be replaced using structured validation errors. A
   failed or repairing candidate is never rendered.
7. `compileSceneDocument()` deterministically evaluates the construction graph,
   lays it out, and emits a `RenderScene` in the diagram viewport.
8. `verifiedScenePresentation.ts` converts render primitives to immutable
   whiteboard commands and reveal groups.
9. The complete verified scene is fixed before the teaching stream starts. Its
   narrated structure, direction, and detail reveals share one canvas
   transaction. Cancellation or execution failure rolls back every owned node;
   successful completion commits the intro as a unit.
10. `prepareVerifiedLessonSegments()` permits only work-area `WRITE` and `PAUSE`
   from the teaching model. A rejected marker command does not discard useful
   narration.

If exact planning fails, the selector commits a source-grounded non-metric scene
only when reusable operators can express meaningful structure, currently an
explicit function graph. It otherwise commits zero ink for optional visuals or
returns `retry_required` for required visuals. Question words are never rendered
as boxes, and a fallback cannot display derived claims.

## Generality

Coverage grows through reusable semantic entities, construction operators,
layout strategies, assertions, and render primitives. New work must not add a
topic plugin, chapter template, question regex, or fixed-pixel fixture to the
live path.

The current foundation supports geometric primitives, intersections,
projections, transformations, reflection, refraction, vector decomposition,
logical topology, audited two-terminal symbols, dimensions, and audited
continuous function curves. Generic normalization also handles contracted
connector paths and cycles, powered-loop closure, obstacle-aware connector
routing, common-origin and head-to-tail vector sums, coincident semantic aliases,
and semantic group callouts. Unsupported exact visuals fail closed. They become
a meaningful source-grounded operator scene when one exists, otherwise
text-only or `retry_required`, never authoritative-looking partial ink.

Constraint compilation is intentionally narrower than symbolic planning and
broader than a topic plugin. It deterministically realizes a reusable law only
after the accepted plan names the necessary semantic entities, quantities, and
claims. Missing evidence still fails closed; the compiler does not infer which
chapter the question belongs to.

## Numeric Authority

`TurnPlanV3` is the scene-facing numeric contract. For supported expression
families, `ProblemIR/v1` plus `SolverResult/v1` is an independent authority that
recomputes values before they enter that contract. The arithmetic reconciler
also evaluates sequential expressions with named bindings, adjacent symbols,
SI-unit case sensitivity, functions, angle conversion, and descriptive
assignment aliases. It prefers an exact arithmetic member of an equality chain
over a rounded scalar approximation. A scene cannot display a measurement
absent from the accepted plan, and narration cannot start with a stale planner
value that deterministic arithmetic can disprove.

## Teacher Choreography

Verified primitives are grouped into structure, direction, and detail phases.
Each small command batch has a narration cue, so the tutor explains the setup as
it appears. Later focus actions trace only existing verified geometry using a
thin transient stroke. The teaching model can request a semantic entity ID but
cannot invent a path or coordinate.

Bounded regions are filled beneath their compiled boundary, labels use the full
current diagram viewport, and nested mathematical WRITE/LABEL text is parsed as
one command. Speech uses a context per segment with provider-owned completion
and segment-relative alignment, preventing a connection-cumulative timestamp or
brief network gap from dumping ink or cutting narration short.

## Persistence

Before writing a turn, the server revalidates `TurnPlanV3`, recompiles the
accepted `SceneDocument`, reruns proof and quantity checks, deterministically
rebuilds non-metric fallbacks, preserves bounded exact-attempt degradation
codes, and recomputes supported solver results. Trusted
command envelopes are accepted only when every command exactly matches the
fresh server presentation. New legacy turns are normalized to text-only;
historical `visualStatus: "legacy"` values remain readable.

## Adding Capability

1. Add or extend a topic-neutral document contract or operator.
2. Implement deterministic evaluation with explicit failure modes.
3. Add executable assertions for the relationship being claimed.
4. Add positive, malformed, underspecified, mutation, and layout-collision
   corpus cases.
5. Verify that every required entity produces linked render primitives.
6. Keep teaching-model diagram ownership closed.

Do not weaken validation to improve diagram frequency. Improve the semantic
contract, deterministic engine, or planner repair feedback instead.

## Current Evidence And Limits

The deterministic evaluation corpus currently covers 21 questions across seven
physics domains plus calculus and mensuration families with adversarial
mutations. Live and captured-provider checks include an electromagnetic
induction route with an owner-bound rod dimension, a concave-mirror construction
with computed principal rays, and a bounded-parabola region whose exact area is
reconciled from the planner's equality chain. This is evidence of the
architecture, not a mathematical guarantee for every arbitrary syllabus
question. Planner transport, invalid JSON, unavailable solver authority, and
missing semantic operators can still reduce a turn to a non-metric source
representation. They cannot promote unproved geometry into the exact tier.
