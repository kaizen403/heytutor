# Circuit topology repair feedback, 20 October 2026

Scope: explain a parallel network's explicit nodes and branches and make a
refuted topology assertion repairable. Base `565cb1781350f47c55ca8cdc753e0dcba31fe26c`.
This is engine-side contract/diagnostic work; planner prompt changes belong to
Harness 1 and fallback selection belongs to Harness 4. No coverage counters or
accepted topic states change.

## Finding and change

The six recorded concept candidates remained invalid: five claimed two simple
paths in a graph with three, and one asserted that a series pair was parallel.
The count includes the source branch, not only loads. An assertion's free-form
reason could hide the measured error. The old count message omitted the terminal
nodes, source inclusion and concrete paths.

`symbol`/`connect` already express a conceptual network without inventing values:
use two named electrical nodes, and one source plus each load across those
nodes. The engine routes each branch in a distinct lane. The numerical
`kirchhoff_network` operator is unnecessary for this nonnumeric case. The
[contract](../../../architecture/circuit-topology-contract.md) records these
rules, including wire contraction and the absence of implicit coordinate joins.
No second renderer or operator was added.

Failed `pathCount` assertions now name the assertion and terminal nodes, retain
numeric expected/actual fields, explain that every symbol and connector edge
counts (including sources), and show at most four concrete paths. Failed
`sameTerminalPair` assertions name each component's effective terminal pair.
The diagnostics cannot be hidden by a planner-authored reason. Counting,
connectivity, resource limits and admission decisions are unchanged. Repair
must check the intended network; changing a count alone is not a safe repair of
a wrong drawing or an unsupported current arrow.

## Verification

- New gate `verify-circuit-topology-feedback.ts`: 40 checks. Full compilation of
  synthetic nonnumeric networks with two, three and five loads; all source/load
  lanes are distinct. The same three synthetic candidates also pass the current
  production candidate validation seam with no errors. It also checks omitted-source count refusal, diagnostic
  witnesses, wire joins versus coincident aliases, negative assertions, and a
  truncated witness list with the full count retained.
- Three mutations each turn that gate red: restore planner-reason masking,
  remove source-inclusion explanation, or remove concrete edge witnesses.
  Restoring the implementation passes again.
- Scene-engine typecheck, lint, build, golden-corpus and main scene-engine
  verification pass. Lint retains four existing unrelated DSA warnings.
- Frozen 1,709-candidate circuit replay: main 1,245 drawn, branch 1,245 drawn.
  Every admission status, fatal-code set and full render hash is identical.
- The 54 recorded Fireworks candidates replayed through current-main source
  parsing/normalization and the production candidate validator: main 19 valid,
  branch 19 valid; every admission status, code set and render hash is identical.
  All six original parallel candidates remain refused, with clearer feedback.

These diagnostics alone add no accepted figure and do not fill the conceptual
lesson's empty result; Harness 1 must supply a corrected candidate (or Harness 4
an independently admitted fallback). Three synthetic contract renders were
queued for independent blind review. They demonstrate existing expressiveness,
not a before/after coverage gain. Private replay payloads and judge artifacts
stay in the ignored workspace context; none are committed. No paid calls,
production changes or merges.
