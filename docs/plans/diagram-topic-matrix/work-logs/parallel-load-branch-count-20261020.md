# Parallel load branches, 20 October 2026

Engine packet from main `565cb1781350f47c55ca8cdc753e0dcba31fe26c`. No accepted topic counts change. All public fixtures are synthetic; recorded questions, run identifiers, response payloads, renders and blind keys remain in ignored local evidence.

## Cause and contract

`pathCount` counts simple graph paths, including the battery branch. A battery with two parallel resistors therefore has three paths, while the recorded planner drafts used two to mean the passive load branches. Diagnostics alone did not resolve that difference.

The planner-visible `loadBranchCount` predicate accepts exactly two terminal node IDs and a nonnegative integer `expected`. It contracts ordinary wires, identifies one canonical battery/cell by its actual symbol, and counts direct resistor/lamp branches across the same two electrical nodes. Every symbol in that connected circuit must belong to this supported source/load topology. Series feeds, series load chains, bridges, switches, AC/unknown components, multiple sources, shorts and bypasses cannot receive this proof. Incorrect counts and unsupported queries are fatal regardless of planner-authored severity.

Existing successful `pathCount` assertions retain their graph meaning. Only a failed strict comparison may use the bounded compatibility interpretation: at least two actual loads, exactly one direct DC source, a qualitative nonmetric document without quantities, and a separate fatal, true `sameTerminalPair` assertion enumerating every load exactly once. A warning records both the strict path count and the accepted load count. This is not an unconditional subtraction of one.

Both new admission paths require canonical point/component/connector output kinds and identity-only labels. They refuse unproved current arrows, polarity marks/prose, ray-styled wire outputs, additional geometry, quantity-bound label annotations and automatic physical quantity-label expansion. Counting branches supplies no proof of current direction or scalar values. Ordinary identity labels such as `V`, `R1`, `R_1` and `R₂` remain usable. Numeric quantities that add no unproved ink remain available to the explicit count API.

## Frozen offline measurement

- All **1,709** recorded circuit candidates replayed against main and the final source: **1,709 identical** admission/full-render results (two already-refused rows add `parallel_topology_repaired`), **1,245 drawn**, zero gains or losses.
- All **54** recorded Kimi Fast candidates replayed through the production candidate validator and production selector with their recorded turn plans, source policy and solver context: **19 → 20 valid** and **12 → 13 selected candidate outcomes**. These are candidate outcomes, not counts of distinct lessons.
- The conceptual parallel-circuit lesson gains one valid planner figure, which passes production selection and the save guard. A second earlier gain is now refused because pruning removed original connectors. The other four candidates remain refused: three contain unproved current arrows and one has an incorrect series/bypass topology.
- The retained newly valid figure exactly matches its blind-judged render: **1 right, 0 partial, 0 wrong**. Two figures were originally judged right; one was subsequently refused by the stronger topology provenance guard. No existing valid render changes and no right figure is lost.

This establishes recovery of the recorded concept case. It does not measure a new provider response, a live lesson, arbitrary circuit networks or full chapter coverage.

## Verification

The synthetic topology gate exercises the pure measurement reader, assertion evaluator, actual compiler and normalized compiler path. Counterexamples cover wrong load counts, direct and multi-wire shorts, self-loops, bypasses, series/bridge graphs, absent/duplicate/unsupported sources, incomplete or downgraded independent proofs, malformed queries, physical annotation aliases, swapped polarity text, automatic quantity labels and noncanonical arrow-producing entity kinds. A separate gate captures mocked initial and repair requests to prove the new engine interface reaches the planner within the existing scoped request budgets. Both are registered in separate `gates.d` files.

Final source gate: **576 checks**. The initial nine deliberately broken safety mutations were caught; four additional isolated final provenance mutations were caught. Independent review additionally checked ten compiler counterexamples and confirmed the original polarity and ray-output findings are closed. Existing strict graph-path successes remain accepted for those same documents.

Engine/core builds, typechecks and lint pass; existing scene-engine, golden corpus, structure-driven and space-view gates pass. Scoped planner capability transport passes. The existing unscoped `verify-scene-planner-v2.ts` repair-size check is already failing on main (27,263 characters against 27,000); with the new interface it is 27,611. Its threshold is unchanged. No full verification-suite pass is claimed.

Spend **$0**. No paid calls or production changes. The later owner-authorized integration is recorded separately. Only the delegated blind judge viewed images; builds were serialized. Earlier queued PRs and the parked router PR are untouched.

## Final topology provenance hardening

Before any normalization helper, snapshot original canonical symbol/connector outputs. If any electrical branch is removed, retain monotone, content-free `source.circuitTopologyRepaired: true`. Both new load-count admission paths reject this with fatal `parallel_topology_repaired`; existing strict path-count successes keep their prior behavior. This prevents an erased short, extra load or extra source from establishing the original topology. It does not change global pruning behavior.

Actual production validation, selection and server-save probes cover two clean positives and sixteen repaired negatives across both count interfaces. Every negative stays text only and forged ready saves are refused. JSON round trips, repeated normalization, spoofed false metadata, early returns and point-only helper removal are gated. Independent review checked 86 additional outcomes. Fresh replay preserves all nineteen original valid Kimi candidates and all 1,709 circuit render/status hashes; the sole net new figure has the exact blind-reviewed hash.
