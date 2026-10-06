# Wave 3 Units and Measurements source authority — 2026-10-06

Owner: Sol. Branch: `cov/w3-measurements-20261006`, base pin `9211b396`.

## Bounded implementation

The new `packages/scene-engine/src/ir/measurementSourceAuthority.ts` exposes
`readScrewGaugeSource(problem)` and
`verifyMeasurementSourceAuthority(problemRaw, planRaw, expectedQuestion?)`.
The reader accepts only a single source-complete screw-gauge measurement with
pitch, least count, true size, signed zero error, and a circular-division ask.
It derives the integer division count from pitch/least count, computes the main
scale mark, applies the stated zero-error sign (`observed = true + error`), and
checks that the requested AST has the exact linked formula shape. Units are
converted to millimetres before arithmetic. Extra numeric clauses and objects,
ambiguous signs, nonintegral division counts, invalid observed readings, and
unsupported or incomplete sources decline.

The authority audit validates and returns the complete `ProblemIR` unchanged,
including its facts, entities, expressions, constraints, representation
intents, and solve requests. A unique `evaluate` request binds the division ask
to a `TurnPlanV3` unknown and derived row. The binding must preserve the answer
unit, source facts, source-text quotes, role-specific given rows, and all four
dependencies. An incorrect bound plan value is corrected; downstream derived
rows and claims are withdrawn. Missing or incomplete authority returns
`declined`, with unsupported measurement rows and linked claims withdrawn where
identifiable.

The new `verify-w3-measurements.ts` gate exercises four finite authored source
cases and the one preserved native source extract. Authored cases cover negative
and positive zero error, a centimetre conversion with an independent oracle,
and a main-scale boundary. The native JEE Main 2021 item `6760331081` retains
the exact OCR wording, options, question-block SHA-256, source-text SHA-256,
and official PDF SHA-256 in `fixtures/w3-measurements-native.json`. Its
independent calculation is 39 circular divisions; the preserved source answer
is not treated as the oracle.

Ten fail-closed controls cover absent ask/request authority, scalar-only and
disconnected coincident ASTs, role collision, incompatible plan units, an
extra measured object, noninteger pitch/least-count ratio, unsigned zero error,
incompatible source units, and a nonpositive observed reading. The simple
arithmetic cases declare `visualRequirement: "none"`; no decorative instrument
figure is produced.

## Checks and boundary

- New source-authority gate: passed, 5 source cases and 10 negative controls.
- `@heytutor/drawing` build: passed from the frozen offline install.
- `@heytutor/scene-engine` typecheck, lint, and build: passed. Lint retains four
  existing warnings in DSA simulator files; the new authority adds none.
- Existing dimension-anchor and instrument-label gates: both passed with
  complete stdout captured before final cleanup and compared with final output;
  both stdout files are byte-identical. These existing shared modules and gates
  are unchanged in this worktree.
- Student-facing render/narration/WRITE/reveal, authenticated normal-path
  integration, save/reopen/replay, and independent review: **unrun**.

This submission is implementation evidence only: **READY 0, accepted-count
delta 0**. The authority is not registered in the shared synthesis/compiler or
normal tutor path. Parent integration can import
`verifyMeasurementSourceAuthority` directly from
`packages/scene-engine/src/ir/measurementSourceAuthority.ts`, after ProblemIR
and TurnPlan construction and before normal solver/teaching consumption. The
parent should preserve the returned full `problem`, use the returned `plan`
only when `status === "verified"`, and treat `declined` as no numeric second
opinion. The existing scene-engine package export barrel was intentionally not
changed because it is shared integration ownership.

Explicit open gaps: actual visual instrument-readout figures remain unsupported
and are not required for this arithmetic question; direct/vernier instruments,
measurement/error propagation, significant-figure rounding, dimensional
analysis, and other Units and Measurements variants are outside this bounded
authority. Native cases and holdouts beyond the one listed item, student
rendering, authenticated lifecycle, replay, and normal-path registration remain
open. No readiness ledger, accepted count, shared compiler, capability,
synthesis, contract, catalog, or existing gate was changed.
