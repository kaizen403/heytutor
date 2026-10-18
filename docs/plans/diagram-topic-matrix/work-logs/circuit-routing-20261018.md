# Circuit connector routing — 18 October 2026

Owner: circuit geometry worker; integration owner retains release acceptance.
Base: `7afb99772` on `main`.

## Scope and cause

This is a bounded engine geometry repair, not chapter certification. A
synthetic series circuit with a parallel voltmeter compiled successfully while
its return wire crossed both meter leads. Logical connectivity assertions alone
did not catch the misleading rendered connections.

The old connector router sampled obstacle vertices near a proposed line.
It missed intersections inside obstacle segments, then offset the line without
checking the new legs. Routing construction by construction also let a long,
unsafe return wire obstruct short local leads.

## Change

- Apply strict routing to connected port graphs containing a `symbol`, selected
  from construction topology rather than question wording or chapter names.
- Test complete obstacle segments, including overlap and contacts at bends.
- Keep source points and logical endpoints unchanged. An electrical contact
  requires a shared logical port; coordinate coincidence is insufficient.
- Route short local leads before long connectors against final component ink.
- Check each complete candidate path and reject the candidate atomically when
  the bounded routing search finds no safe path.
- Preserve the prior routing behavior for non-port geometry. In particular, a
  hydraulic fluid connector may intentionally cross its piston outline.

No quantity, solver result, battery cell interpretation, diagram tier, or
validation expectation was relaxed. The change does not add an English router,
per-question template, paid request, or production mutation.

## Evidence

Dedicated gate:

```sh
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-connector-routing.ts
```

Result: **2,687 counted checks passed**. Synthetic cases cover series circuits
with meter taps, mixed series/parallel and nested branches, open/closed switches,
mirroring/rotation/translation, reversed construction order, exact terminal and
netlist preservation, overlapping leads, legitimate shared terminals, distinct
ports at coincident coordinates, open arcs, derived geometric anchors, dense
obstacles, and an enclosed endpoint that must reject rather than cross ink.

The unmodified baseline compiler was copied into an ignored temporary module
with imports resolved back to the repository. Running the new gate against that
isolated old-router mutation exited **1** at the independent assertion
`Unrelated wire interiors must not cross`. Shared source was not mutated.

An existing saved scene was replayed locally without provider calls: it compiled
with no issues and 47 primitives. The image reviewer confirmed that the return
now passes below the circuit and outside the meter lead, without the original
crossing. Production text, identifiers, and raw artifacts remain in ignored
private storage. A separately generated synthetic after-image is available at
`.context/circuit-incident-2026-10-18/geometry/synthetic-circuit-after.png`.

Additional verification:

| Command within `@heytutor/scene-engine` | Result |
| --- | --- |
| `typecheck` | Passed |
| `exec eslint src/compile/compiler.ts src/compile/connectorRouting.ts` | Passed |
| `exec tsx scripts/verify/verify-scene-engine.ts` | Passed |
| `exec tsx scripts/verify/verify-family-synthesis.ts` | Passed |
| `exec tsx scripts/verify/verify-evaluation-compile.ts` | Passed, 34 questions |
| `exec tsx scripts/verify/verify-bank-family-compile.ts` | Skipped: corpus not built locally |
| `exec tsx scripts/verify/verify-ohm-ready.ts` | Functional cases passed up to a pre-existing static source-anchor failure at line 463; all four expected handler anchors are absent in the base revision |

The broader evaluation caught a hydraulic-connector regression during
development. Restricting strict routing to structural port graphs resolved it;
the unchanged evaluation gate subsequently passed. Package builds and final
integration checks belong to the integration owner.

## Limits and acceptance

The candidate search is bounded and can reject a routable but more complicated
layout. This work does not prove arbitrary circuit coverage, planner correctness,
numerical correctness of new network classes, successful live audio, or a full
student lesson. Provider-backed final measurement, if run, must be reported
separately from these free deterministic checks.

**No topic ledger rows or accepted chapter counts changed.**
