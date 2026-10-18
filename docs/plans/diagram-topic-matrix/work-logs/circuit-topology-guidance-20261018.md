# Circuit topology guidance — 18 October 2026

Owner: circuit geometry worker; integration owner retains release acceptance.
Base: `7afb99772` on `main`.

## Evidence and cause

A final, separately authorized local Fireworks measurement produced no admitted
diagram before the conservative spend limit stopped the run. Offline inspection
found an engine-generated instruction that called a one-source component
inventory a multi-loop circuit and asked for both sources and a shared branch.
The submitted synthetic setup did not justify that instruction.

`circuitTopologyFromProblemStructure` inferred multiple loops from any of:

- Two source-labelled entities and at least three components.
- Five or more components, including measuring instruments.
- Repeated membership in coarse `connected` constraints.

None establishes an edge graph or a cycle. The erroneous result affected
specialized planner guidance and the demand that rejected a series-chain
picture. It was therefore an engine-originated misleading instruction, in
addition to the malformed assertions and incorrect netlists in model replies.
Removing the instruction does not itself prove that the model will now succeed.

## Bounded correction

Inventory continues to identify the circuit family. Specialized topology now
requires an explicit `dc_network` branch graph with declared nodes and branch
endpoints. Independent cycles are counted as `E - V + 1` separately in each
connected component. Repeated solve requests for the same network are not
summed; inconsistent graphs, unknown endpoints, self-loops, duplicate nodes or
branch IDs, and malformed structural arrays do not prove topology.

The result describes the **displayed branch graph**, including open branches.
It does not claim current flows, conducting cycles, exactly two sources, or a
particular shared branch. Planner guidance preserves the supplied nodes,
endpoints and states, and explicitly prohibits inventing additional sources.
Existing prose-based Kirchhoff/bridge support remains unchanged; no new keyword
router or per-question template was introduced.

## Free verification

```sh
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-circuit-topology-guidance.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-structure-driven-scene.ts
pnpm --filter @heytutor/scene-engine typecheck
pnpm --filter @heytutor/scene-engine exec eslint src/synthesize/familyClassification.ts
```

The dedicated guidance verifier passed **25 checks** covering component-only
series/meter inventory, long series inventory, two-source series circuits,
explicit multi-cycle networks, repeated network outputs, disconnected cycles,
open branches, unknown endpoints, self-loops, inconsistent networks, and malformed
array/object shapes. It failed on the original implementation at the inventory
assertion before the fix.

An isolated copy of the original classifier was subsequently used as a mutation:
the same new assertion failed with exit 1. Shared source was not temporarily
modified. Evidence is in ignored local audit storage.

The existing structure-driven gate passed with its original assertions intact.
Its fixture now supplies explicit branch endpoints for its claimed two-loop
Kirchhoff network, replacing component count as the evidence for that assertion.
Source typecheck and focused lint passed after the final defensive shape checks.

The new cross-package integration gate is:

```sh
pnpm --filter @heytutor/tutor-core exec tsx scripts/verify/verify-circuit-topology-capabilities.ts
```

It was red against stale scene-engine output at the series/meter guidance
assertion, demonstrating that the built package boundary matters. The integration
owner reran it after serialized scene-engine and tutor-core builds: all four
checks passed. Both new gates are included in their package verification commands.
The final tutor production build and production scene-selection/provider gates
also passed. The broader scene-capabilities verifier reaches an existing
photoelectric classification failure (`chem_orbital` instead of `energy_level`);
isolated baseline copies of both changed classification/capability modules
reproduce it. That broader gate is not reported as green.

## Limits

The paid run was **failed/budget-interrupted**, not a successful circuit lesson.
Rejected candidates were inspected offline; they were never admitted by relaxing
validation or presented as successful rendered scenes. No paid measurement was
rerun after this topology correction. Live lesson, audio, arbitrary circuit
coverage, and full chapter acceptance remain unproven by this change.

**No topic ledger rows or accepted chapter counts changed.**
