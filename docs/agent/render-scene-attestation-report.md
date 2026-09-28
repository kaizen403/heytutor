# Render-scene attestation

Scope: `apps/tutor/features/tutor-session/lib/scene/representationFallback.ts` and `apps/tutor/scripts/verify/verify-render-scene-attestation.ts`. This is a safety slice for caller-exact render, report, and document structure. It does not change the scene engine, compiler, or package verify chains.

An exact candidate must carry a complete current-engine validation report that matches a fresh compilation. Selected ink, labels, bounds, timeline, and report come from that compilation, not the caller's `renderScene` or report. Structural comparison tolerates reordered object keys. It also tolerates the undefined `count`, `pointStyle`, and `transient` children that annotation-style normalization writes for omitted fields, including when one side omits that key. It rejects changed issue arrays, other hidden or undefined payloads, exotic or inherited array prototypes, and documents whose actions or operands validation would normalize away. Existing demand and source-question checks stay in place.

**Semantic limit:** This attests representation consistency, not question-to-scene correctness. A document plotting `y=3*x` with a self-consistent `function_value` proof at `(2, 6)` and `source.question` forged as `Sketch y=x^2 and evaluate it at x=2.` may still select as `exact_verified`. Source operand ownership needs a separate proof and is not added here.
