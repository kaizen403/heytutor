# Circuit branch and node contract

`symbol` and `connect` already describe numeric and nonnumeric circuit topology.
Use them for a conceptual network; `kirchhoff_network` requires physical values
and solves branch currents, so it is not needed to explain what parallel means.
The engine chooses branch lanes and draws every symbol and lead.

## Explicit connectivity

- A `point` output names a terminal or junction.
- `symbol` takes `symbol`, `start`, and `end`; its output is a component edge.
- `connect` takes `start` and `end`; its output is a wire edge. Wires join their
  named endpoints into one electrical node.
- Two loads are parallel when their two terminal pairs match, allowing wire
  contraction. Use `sameTerminalPair` with the load **component output ids**.
- Coincident point coordinates do not declare a join. Use the same point id or an
  explicit wire. Do not add duplicate wires along an existing terminal pair.

For example, declare points `a` and `b`, then three `symbol` constructions:

| Output | Symbol | Start | End |
| --- | --- | --- | --- |
| `supply` | `battery` | `a` | `b` |
| `load_1` | `resistor` | `a` | `b` |
| `load_2` | `resistor` | `a` | `b` |

`sameTerminalPair([load_1, load_2]) = true` proves the loads share both nodes.
`pathCount([a, b]) = 3` proves there are three simple paths in the **whole** graph:
`supply`, `load_1`, and `load_2`. The source branch counts. `loadBranchCount([a,b]) = 2`
separately proves that there are two direct passive load branches. This example requires no current,
resistance, voltage, arbitrary numeric answer, or current-direction arrow.

`pathCount` is the number of simple node paths, not a synonym for the number of
components, loads, independent loops, or branches after wire contraction. In a
larger graph with cross-links, these quantities can differ. For load parallelism,
assert the terminal pair directly and use `loadBranchCount` for a supported
direct parallel network rather than guessing a graph path count.

`loadBranchCount` contracts ordinary wires and requires one canonical battery/cell
with every other symbol a direct resistor/lamp across the same two queried nodes.
It rejects shorted/bypassed loads, unsupported symbols, series feeds and bridges.
Wrong counts remain fatal regardless of an assertion's declared severity. This
proof establishes topology, not numeric values, current direction or polarity.

Legacy `pathCount` first retains every successful strict graph comparison. Only
a mismatch may be interpreted as loads: at least two actual loads, one direct DC
source, qualitative nonmetric provenance, no quantities, and a separate fatal,
true `sameTerminalPair` proof listing all loads exactly once. Canonical output
kinds and identity-only ink are also required. Acceptance emits
`path_count_load_branch_compatibility` with both `graphPaths` and `loadBranches`;
it never silently subtracts a source from an arbitrary network. Without that
independent proof, the example's `pathCount = 2` remains false.

## Repair feedback and authority

A failed `pathCount` reports its assertion id, requested terminal nodes, expected
and actual count, and up to four concrete edge paths. All paths still count;
limiting the diagnostic witnesses does not change the proof or its resource
limits. A failed `sameTerminalPair` reports the effective node pair of each
requested component after contracting wire-connected nodes. Planner-authored
reasons cannot replace these measured diagnostics.

Use the diagnostic to repair the intended graph or the assertion. Do not change
a count merely to make validation pass. Source topology, component bypass,
source closure, numeric and geometry checks still apply. Neither this contract
nor its diagnostics select a diagram, suppress a failed assertion, infer an
undeclared electrical junction, or fix an unsupported current arrow.

The synthetic regression is
`packages/scene-engine/scripts/verify/verify-circuit-topology-feedback.ts`.
