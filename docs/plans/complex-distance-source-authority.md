# Numeric complex-distance reference authority

An explicitly declared distance reference for `|z+c|` must be `-c`, not the
correctly plotted literal `c`. Scalar quantity agreement alone cannot prove
that role. The engine exports `parseComplexDistanceExpression` and
`validateComplexDistanceSourceInputs` from `src/ir/complexDistanceSource.ts`.
Candidate and final/save admission apply the same source guard. Evaluation
identity is `production-scene-selection/v5`; do not resume older rounds into it.

The bounded complete-expression parser supports one complex variable with
coefficient +1 and finite numeric real/imaginary sums, signs, parentheses,
decimals and fractions. Private reduced rationals preserve decimal/fraction
cancellation before a final bounded Number conversion (512-bit capacity;
48-character literals and exponent magnitude at most96). Exact nonzero final
components must have magnitude from1e−12 to1e12; small nonzero offsets never
become a certified zero. Literal/term/intermediate capacity and range bounds
can reject an otherwise representable final result. This is not exact-decimal
geometry: equivalent expressions may share the same final Number, and scene
components retain the existing scale-relative comparison tolerance. Source
binding and display-frame identity do not use that tolerance.

Unsupported expressions, ambiguous unbound references
and unresolved/non-dimensionless point inputs are declined, never guessed or
repaired. Source authority comes from the caller's trusted question, not the
scene's editable `source.question`. Complex components are recomputed by the
existing engine evaluator, never recovered from display pixels. Source-labelled
paths require endpoint-only inputs and one identical computed display frame
for both endpoints; a direction override or independently shifted/scaled frame
cannot silently change the reference. Standalone reference roles do not infer
an unrelated path frame.

This is not topic routing or an extra scene compiler. It checks only explicit
distance-reference point roles and source-modulus-claiming segment/vector/
dimension outputs with one explicitly named variable endpoint. A path opts in
through a complete supported affine-modulus label, or explicit arithmetic label
containing the declared complex-variable token, with an explicitly complex
variable endpoint; an arithmetic label tied to a single-symbol point backed by
an existing complex construction; a source-modulus role; an
explicitly expression-bound complex-distance role, or
`semantic.complexDistanceExpression`. Ordinary bar notation such as `|AB|` or
vector magnitude `|v|`, generic path distance roles and complex fixed-point
producers alone do not opt a path in. Endpoint labels and variable roles must
have one unambiguous identity; neither overrides a conflicting name. An unbound generic point-reference role
requires a complex producer; a qualified or expression-bound reference role
requires source proof. Generic world-coordinate reference points remain outside
this complex-source audit.
Unsupported explicit source claims still require proof rather than bypassing
the guard. Role, semantic and label source bindings must agree. A true literal
`w` or origin-to-`w` vector is not reclassified as a wrong given. Literal-only
relevance failures still require separate prompt/representation obligations;
this change does not claim the historical sign/relevance incident fully fixed
or add an extrema solver. Planner prompts, quantity validators and archetype
slots are unchanged.

Free regression command (build packages first):

```sh
pnpm --filter @heytutor/tutor verify:numeric-source
```

The complex gate exercises source and compiled exports, candidate/final/save
boundaries, independent addition/subtraction oracles and held-out constants,
unsupported/ambiguous cases, trusted-source spoof controls and nonmutation.
The Coulomb gate verifies a baseline and 28 correct notation/unit variants and
rejects five genuine contradictions. The historical Coulomb planner/IR payload
was not retained: its refusal is not reproduced or claimed fixed. Safeguards
are not relaxed to make the incident disappear. These are synthetic regression
checks, not topic-coverage or production-latency evidence.
