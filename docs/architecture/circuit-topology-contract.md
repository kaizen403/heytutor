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
`supply`, `load_1`, and `load_2`. The source branch counts. `pathCount = 2` is false
for this graph, even though it has two loads. This example requires no current,
resistance, voltage, arbitrary numeric answer, or current-direction arrow.

`pathCount` is the number of simple node paths, not a synonym for the number of
components, loads, independent loops, or branches after wire contraction. In a
larger graph with cross-links, these quantities can differ. For load parallelism,
assert the terminal pair directly rather than guessing a graph path count.

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
