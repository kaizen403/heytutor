# Verified Diagram Architecture

This is the diagram design doc: authority, the turn pipeline, representation
tiers, operators, and how coverage grows. The topic checklist is the
[diagram topic matrix](../plans/diagram-topic-matrix/index.md).

## Goal

Produce a useful, honest illustration for every visualizable question without
chapter templates, topic plugins, model-authored pixels, or unverified marks.
Coverage grows by adding reusable operators, constraints, proof predicates, and
solver capabilities.

## Authority

The semantic scene engine owns every diagram mark: geometry, topology, labels,
dimensions, directions, construction marks, layout, and reveal order. The
teaching model owns narration and equation writing in the left work area. It
never supplies diagram pixels or annotations.

There is no live topic-template registry, domain plugin router, pixel
architect, or endpoint snap fallback. Family and archetype choice still fall
back to English cue tables when ProblemIR structure is missing
(`synthesize/familyClassification.ts`, `archetypes/detect.ts`,
`chemistry/classify.ts`). Their own headers call them a test oracle and a
fallback that must not grow into the live coverage mechanism; structure-derived
families win over them.

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
3. A fast deterministic family figure (`selectFastVerifiedRepresentation()`)
   is tried first. Only when it finds nothing does the scene planner propose
   coordinate-free `scene-document/v2` candidates (`planningOverlap.ts`; the
   speculative overlap with ProblemIR is off unless
   `NEXT_PUBLIC_SCENE_SPECULATION=1`).
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
10. `prepareVerifiedLessonSegments()` filters the teaching model's commands
   (`packages/drawing/src/protocol/commandPlacement.ts`). Work-area `WRITE`,
   `PAUSE`, `EMPHASIZE`, and the code-lesson `TYPE` and `FRAME` pass. `FOCUS`,
   `POINT` and `ANNOTATE` pass only when they resolve to verified entities, and
   a `FOCUS` is inferred for a figure part the step names aloud when the model
   tagged none. A `WRITE` row in Devanagari is dropped. A rejected marker
   command does not discard useful narration.

`selectVerifiedRepresentation()` in `representationFallback.ts` picks the
committed scene. A validated planner scene wins, except that a few source-owned
figures outrank it (circular motion, constant-velocity relative motion, a
complete mensuration figure, a metric-proved archetype). Without a surviving
planner scene it tries, in order: a matrix source program drawn from the
question, a synthesized family or archetype figure, a source-grounded
representation such as an explicit function graph, and a last-resort scene.
Each is compiled independently and commits at the tier it earns. When none
applies, the turn is text-only. A required visual that ends text-only records
`retry_required` as its status, and the lesson keeps teaching. Question words
are never rendered as boxes, and a fallback cannot display derived claims.

## Representation Tiers

The selector commits exactly one of these results:

1. `exact_verified`: metric geometry and derived values passed deterministic
   validation and proof checks.
2. `qualitative_verified`: only source-grounded relationships are shown. Layout
   is explicitly non-metric and no derived value is displayed.
3. `question_representation`: a deterministic operator visual of structure the
   submitted question states, such as an explicit function graph. Layout is
   non-metric.

Invalid exact candidates never leak into either fallback. A fallback is a
different honest representation, not a repaired fragment or an authoritative
partial diagram. A required visual that cannot be verified leaves the canvas
empty and still teaches. It never renders question tokens, fact cards, or
generic boxes merely to avoid an empty canvas.

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

## Operators

The scene engine provides data-driven primitives and construction operators for
geometry, topology, circuits, vectors, reflection and refraction, continuous
functions, bounded regions, parametric and polar curves, tangents and normals,
representative slices, solids of revolution, implicit curves, and mensuration
projections. Operators own coordinates and reject invalid domains, ordering,
references, discontinuities, topology, or output types.

Derived operators consume the same audited analytic geometry used by validation.
A bounded function region evaluates its two source curves directly at the
requested integration samples; it never re-interpolates their display
polylines, so render sampling cannot overturn an exact boundary proof. Likewise,
`on(point,function_curve)` evaluates the analytic expression at the point's
exact world x coordinate instead of measuring distance to sampled ink. Semantic
planner kinds such as `function_curve` and `function_region` are accepted only
as narrow aliases for their deterministic polyline and polygon render forms.

Verified bounded regions receive a translucent fill on the canvas highlight
layer beneath their compiled boundary. This is presentation metadata attached
to the verified semantic entity, not a teaching-model annotation.

The planner selects and parameterizes operators. It never creates pixels or a
new executable algorithm. A missing capability is added once at the semantic
operator layer and is then available across subjects.

Constraint compilers are mathematical laws, not chapter templates: the
closed-route compiler derives a circuit path from connectivity;
assertion-owned dimensions bind to the endpoints of the entity they measure;
and the paraxial-reflection compiler derives mirror, focus, centre, object,
image, and principal-ray geometry from signed quantities and reflection
constraints. The same inputs may have different names, sizes, orientations, or
planner construction order. No compiler contains a fixture for a particular
question or board position.

Canonicalization also removes redundant semantic outlines, rewires coincident
point aliases to their owned entity, promotes a verified incident path over a
freehand duplicate, and drops unmatched guessed ray pairs when a checked
transform owns the relationship. A ray which physically retraces its incident
path is emitted once rather than overdrawn twice.

Planner-shape recovery is operator-level too. Visible construction outputs
omitted from entity ownership are recovered with explicit provenance;
deliberately declared unowned ink is still rejected. Three-dimensional vector
directions are projected into the 2D board vocabulary (`×`/`•` for page-normal
fields), proof-asserted contact endpoints override contradictory free
directions, and labels aimed at semantic medium groups attach to a unique
verified interface. Blank and explicit dimensionless units compare as the same
scalar, while displayed numeric labels may use honest rounding without
weakening exact stored quantities.

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

The model boundary performs only provable structural normalization. Unique
exact question quotes may repair their own character offsets, common typed-AST
field aliases are canonicalized, and closed numeric bounds are evaluated by the
audited expression engine. Non-question evidence and underspecified solve
requests are dropped. The boundary never invents a domain, law, expression,
fact, or quantity binding. `problemIR.ts`, `solver.ts`, and `remoteSolver.ts`
define the solver boundary: no generated code, `eval`, arbitrary process
execution, or unchecked provider response is allowed.

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

The teaching model cannot draw, label, erase, circle, scribble, or supply focus
coordinates. For non-metric representations the runtime prompt forbids
inference from visual scale and forbids describing omitted relationships or
solved values as visible.

Worked notation is runtime-owned. Before speech begins for a segment, the board
allocator assigns its final left-column row, measures the actual font, wraps
long expressions at the row's fixed size (`boardTypography.ts`), and reserves
the occupied bounds. When that column is full, the runtime starts a persisted
board epoch with a `CLEAR` command. Model-supplied text coordinates cannot enter
the diagram viewport, and replay uses the same resolved coordinates as the live
turn. WRITE and LABEL tags use one nested-aware scanner in inline, structured,
and incremental parsing, so evaluation bars and bracketed expressions cannot be
truncated into narration.

## Safety And Timing

- The scene planning budget is 60 seconds (`SCENE_PLANNER_TIMEOUT_MS`).
- Provider input and output are versioned JSON with runtime cross-reference and
  source-evidence validation.
- Remote solver endpoints must be HTTPS except loopback development, have a
  pinned provider identity, bounded response size, and an abortable deadline.
- Only locally validated proof results may become metric scene quantities.
- The canvas receives one committed scene, never streamed candidate geometry.
- Each spoken segment has its own provider context. The relay waits for the
  provider's final event instead of treating a short network silence as
  completion, and alignments are rebased onto a per-segment timeline before
  they drive the pen.
- A client boolean cannot grant trusted geometry status (see Persistence).

## Persistence

Before writing a turn, the server revalidates `TurnPlanV3`, recompiles the
accepted `SceneDocument`, reruns proof and quantity checks, deterministically
rebuilds non-metric fallbacks, preserves bounded exact-attempt degradation
codes, and recomputes supported solver results. Trusted
command envelopes are accepted only when every command exactly matches the
fresh server presentation. New legacy turns are normalized to text-only;
historical `visualStatus: "legacy"` values remain readable.

## Adding Capability

1. Reproduce the failure as a capability fixture and a mutation.
2. Extend an existing general operator, or add one reusable operator, contract,
   or predicate. Keep it topic-neutral.
3. Implement deterministic evaluation and proof obligations with explicit
   failure codes.
4. Add positive, malformed, underspecified, wrong-domain, swapped-role,
   fabricated-label, mutation, and layout-collision cases.
5. Verify that every required entity produces linked render primitives.
6. Update the planner contract with semantics, never example coordinates.
7. Measure the repeated-run exact-tier rate separately from representation
   availability.
8. Keep teaching-model diagram ownership closed.

Do not weaken validation to improve diagram frequency. Improve the semantic
contract, deterministic engine, or planner repair feedback instead. Do not add
a chapter registry, per-question template, regex routing rule, freehand
teaching exception, or validator bypass to increase apparent coverage.

## Current Evidence And Limits

```bash
pnpm --filter @heytutor/scene-engine verify
pnpm --filter @heytutor/tutor-core verify
pnpm --filter @heytutor/whiteboard verify
pnpm --filter @heytutor/tutor verify
```

The gates include golden scenes, ProblemIR and solver proof tests,
remote-provider and persistence trust-boundary tests, canvas rollback tests,
label collision checks, and deterministic compiler mutation tests. Corpus
fixtures are test oracles only and are never selected by the live runtime.

The evaluation corpora in `packages/scene-engine/fixtures/evaluation/` are
`jee-physics-core-v1` (21 questions across seven physics domains),
`math-visual-core-v1` (13 calculus, mensuration and coordinate questions with
adversarial mutations), `optics-syllabus-v1` (45), `typed-maths-v1` (119), and the frozen
`coverage-eval-v1` baseline. `verify-syllabus-corpus.ts` and
`verify-bank-family-compile.ts` run the live family layer over the local
question bank. Live and captured-provider checks include an electromagnetic
induction route with an owner-bound rod dimension, a concave-mirror construction
with computed principal rays, and a bounded-parabola region whose exact area is
reconciled from the planner's equality chain. This is evidence of the
architecture, not a mathematical guarantee for every arbitrary syllabus
question. Planner transport, invalid JSON, unavailable solver authority, and
missing semantic operators can still reduce a turn to a non-metric source
representation. They cannot promote unproved geometry into the exact tier.
