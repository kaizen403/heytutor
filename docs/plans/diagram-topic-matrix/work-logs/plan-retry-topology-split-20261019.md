# Turn-plan retry and topology split — 19 October 2026

Extracted from reviewed PR #212 onto main `6ca8b616a`. Router changes are excluded.
Main's newer planner operator availability is preserved.

- The existing final plan retry receives typed validation reasons and at most
  12,000 characters of rejected model output, explicitly treated as untrusted.
  Call count, deadline, numeric authority and public diagnostics are unchanged.
- Component inventory and repeated connected membership cannot prove circuit
  cycles. Specialized topology guidance requires an explicit branch graph and
  preserves its declared source count, endpoints and open/closed state.
- The existing structure-driven fixture now supplies explicit branch endpoints;
  its original assertions remain unchanged.

Free verification on this main base: topology 25 checks; cross-package capability
4 checks; retry feedback; turn planner; 25 request-outcome scenarios; existing
structure-driven gate; engine/core typecheck, focused lint and serialized builds.
The new tests were mutation-proven in #212: removing feedback, restoring count
inference, or restoring invented-source wording turns the relevant gate red.

New gates are registered one per line: engine topology in
`packages/scene-engine/scripts/verify/gates.d/circuit-topology.txt`; the two
cross-package core checks in
`apps/tutor/scripts/verify/gates.d/plan-retry-topology.txt` (tutor-core has no
registered gate-list runner on this base). Original gate sequences are preserved.

The topology helper also feeds the `sceneDemand` rejection boundary. Planner
guidance uses only an explicit graph, while demand retains main's inventory
veto and ORs it with explicit multi-loop evidence. An inventory never authorizes
invented loop/source guidance, and missing or conflicting graph evidence never
removes the existing `resistor_chain` veto. Main's conservative false declines
for inventories such as series circuits with meters remain declines.

The review regression is covered by the owned `verify-circuit-demand-veto.ts`
gate: an independently drawable all-series candidate cannot replace a possible
multi-loop network. A private recorded production-selector reproduction is kept
outside the public repo; its known wrong chain changes from planner admission
to `picture_demand_unmet`. No student text or IDs are included here.

No diagram geometry or routing code changes. No new image judgments or live model acceptance gains are claimed. No paid
requests, production access, coverage acceptance changes or student data.
