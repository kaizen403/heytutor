# Universal Verified Illustration Engine v4

## Goal

Produce a useful, honest illustration for every visualizable question without
chapter templates, topic plugins, model-authored pixels, or unverified marks.
Coverage grows by adding reusable operators, constraints, proof predicates, and
solver capabilities.

## Authority Pipeline

```text
submitted question
  -> ProblemIR/v1 (facts, entities, typed expressions, constraints, intents)
  -> SolverProvider (local deterministic or pinned HTTPS service)
  -> SolverResult/v1 (exact/approximate values plus checked proof evidence)
  -> TurnPlanV3 and coordinate-free SceneDocument/v2
  -> structural, numeric, topology, label, and render validation
  -> one atomic representation commit
  -> narrated semantic reveal
```

The live turn now creates `TurnPlanV3`, then plans source-grounded `ProblemIR/v1`
against the exact quantity IDs in that plan. The deterministic solver runs in
parallel with scene planning; an explicit result binding may reconcile a scalar
arithmetic value, while formulation, symbol, unit, or topology conflicts stop
the turn. Unsupported solve kinds remain non-authoritative instead of being
guessed. `problemIR.ts`, `solver.ts`, and `remoteSolver.ts` define the safe
universal solver boundary: no generated code, `eval`, arbitrary process
execution, or unchecked provider response is allowed.

Explicit arithmetic is reconciled before scene planning and speech. The
audited evaluator follows named assignments and descriptive aliases (for
example, target `A` and assignment `Area = ...`), prefers an exact arithmetic
expression such as `32/3` over its rounded decimal, and rejects incompatible
units or symbols. A correct diagram therefore cannot be paired with a stale
scalar copied from a planner response.

The model boundary performs only provable structural normalization. Unique
exact question quotes may repair their own character offsets, common typed-AST
field aliases are canonicalized, and closed numeric bounds are evaluated by the
audited expression engine. Non-question evidence and underspecified solve
requests are dropped. Unknowns and their uniquely matching derived quantities
receive one stable ID before either solver or scene planning runs. The boundary
never invents a domain, law, expression, fact, or quantity binding. A planner
source label is wrapped with the submitted question for provenance; an explicit
conflicting `source.question` is preserved so the server can reject it.

## Representation Tiers

The selector commits exactly one of these results:

1. `exact_verified`: metric geometry and derived values passed deterministic
   validation and proof checks.
2. `qualitative_verified`: only source-grounded relationships are shown. Layout
   is explicitly non-metric and no derived value is displayed.
3. `question_representation`: a deterministic operator visual is shown only for
   structure explicit in the submitted question, currently explicit function
   graphs. Otherwise it is text-only with zero diagram ink.

Invalid exact candidates never leak into either fallback. A fallback is a
different honest representation, not a repaired fragment or an authoritative
partial diagram. A required visual returns `retry_required` when neither an exact
scene nor a meaningful source-grounded operator scene exists. It never renders
question tokens, fact cards, or generic boxes merely to avoid an empty canvas.

## General Capabilities

The scene engine provides data-driven primitives and construction operators for
geometry, topology, circuits, vectors, reflection/refraction, continuous
functions, bounded regions, parametric and polar curves, tangents and normals,
representative slices, solids of revolution, implicit curves, and mensuration
projections. Operators own coordinates and reject invalid domains, ordering,
references, discontinuities, topology, or output types.

Derived operators consume the same audited analytic geometry used by validation.
For example, a bounded function region evaluates its two source curves directly
at the requested integration samples; it never re-interpolates their display
polylines. Render sampling therefore cannot overturn an exact boundary proof.
Likewise, `on(point,function_curve)` evaluates the analytic expression at the
point's exact world x-coordinate instead of measuring distance to sampled ink.
Semantic planner kinds such as `function_curve` and `function_region` are
accepted only as narrow aliases for their deterministic polyline and polygon
render forms.

Verified bounded regions receive a translucent fill on the canvas highlight
layer beneath their compiled boundary. This is presentation metadata attached
to the verified semantic entity, not a teaching-model annotation. Label bounds
use the current full diagram viewport, so right-edge entities are not pulled
back into the legacy narrow layout.

The planner selects and parameterizes operators. It never creates pixels or a
new executable algorithm. A missing capability is added once at the semantic
operator layer and is then available across subjects.

Between planning and layout, reusable constraint compilers convert asserted
relationships into canonical geometry. They are mathematical laws, not chapter
templates: the closed-route compiler derives a circuit path from connectivity;
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
path is emitted once rather than overdrawn twice. These rules prevent a valid
semantic plan from turning into doubled strokes, disconnected dimensions, or
labels attached to narration-only quantities.

Planner-shape recovery is likewise operator-level rather than topic-specific.
Visible construction outputs omitted from entity ownership are recovered with
explicit provenance; deliberately declared unowned ink is still rejected.
Three-dimensional vector directions are projected into the 2D board vocabulary
(`×`/`•` for page-normal fields), proof-asserted contact endpoints override
contradictory free directions, and labels aimed at semantic medium groups attach
to a unique verified interface. Blank and explicit dimensionless units compare
as the same scalar, while displayed numeric labels may use honest rounding
without weakening exact stored quantities.

## Teaching Choreography

The complete selected scene is compiled before narration starts. It is revealed
in small structure, direction, and detail batches; every batch carries spoken
narration. The whole intro owns one canvas transaction: cancellation or command
failure removes every node from that intro, including nodes created by late
animation callbacks. Only a completed intro is committed. Later teaching may
request `[FOCUS:entity_id]`, which traces existing verified geometry with a thin
transient stroke. The teaching model cannot draw, label, erase, circle,
scribble, or supply focus coordinates.

For non-metric representations the runtime prompt forbids inference from visual
scale and forbids describing omitted relationships or solved values as visible.

Worked notation is also runtime-owned. Before speech begins for a segment, the
board allocator assigns its final left-column row, measures the actual font,
wraps or shrinks long symbolic expressions, and reserves the occupied bounds.
When that column is full, the runtime starts a persisted board epoch with a
`CLEAR` command. Model-supplied text coordinates cannot enter the diagram
viewport, and replay uses the same resolved coordinates as the live turn.
WRITE and LABEL tags use one nested-aware scanner in inline, structured, and
incremental parsing, so evaluation bars and bracketed expressions cannot be
truncated into narration.

## Safety And Timing

- Total required-illustration deadline: 60 seconds; 45 seconds remains the target.
- Provider input and output are versioned JSON with runtime cross-reference and
  source-evidence validation.
- Remote solver endpoints must be HTTPS except loopback development, have a
  pinned provider identity, bounded response size, and an abortable deadline.
- Only locally validated proof results may become metric scene quantities.
- The canvas receives one committed scene, never streamed candidate geometry.
- Each spoken segment uses an independent ElevenLabs multi-context stream. The
  relay waits for the provider's context-final event instead of treating a short
  network silence as completion, and connection-relative character alignments
  are rebased on a copied per-segment timeline before driving the pen.
- Persistence recompiles the accepted document, rebuilds non-metric fallbacks,
  retains only bounded allowlisted exact-attempt degradation telemetry,
  recomputes supported solver results, and compares every trusted replay command
  with the server-generated presentation. A client boolean cannot grant trusted
  geometry status.

## Release Evidence

```bash
pnpm --filter @heytutor/scene-engine verify
pnpm --filter @heytutor/tutor-core verify
pnpm --filter @heytutor/whiteboard verify
pnpm --filter @heytutor/tutor verify
pnpm typecheck
pnpm lint
pnpm build
```

The gates include golden scenes, a 21-question physics capability corpus, a
calculus/mensuration corpus with adversarial mutations, a 33-question universal
fallback-representation run, ProblemIR and solver proof tests, remote-provider
and persistence trust-boundary tests, canvas rollback tests, label collision
checks, and deterministic compiler mutation tests. Corpus fixtures are test
oracles only and are never selected by the live runtime.

## Adding Coverage

1. Reproduce the failure as a capability fixture and a mutation.
2. Extend an existing general operator or add one reusable operator/predicate.
3. Add deterministic evaluation and proof obligations with explicit failure
   codes.
4. Add malformed, wrong-domain, swapped-role, fabricated-label, and collision
   tests.
5. Update the planner contract with semantics, never example coordinates.
6. Measure repeated-run exact-tier rate separately from representation
   availability.

Do not add a chapter registry, per-question template, regex routing rule,
freehand teaching exception, or validator bypass to increase apparent coverage.
