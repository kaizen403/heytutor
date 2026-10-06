# W2 matrix product prompt guidance — 6 October 2026

Scope: bounded prompt-only guidance for complete literal matrix inputs and ordered binary products, implemented in an isolated worktree at `fd0cbde2`.

The sidecar reuses `readMatrixProductSourceProgram`, carries every original matrix cell and independently computed requested product cell into ordinary TurnPlan guidance, and gives each output cell its complete row/column input dependencies. It declines the whole profile when the parser cannot account for the complete question. Guidance requires the original ProblemIR to retain all literal and ordered-request facts, keeps the initial product-only graph channels empty, and explicitly preserves additional asks for independent whole-IR audit. No IR, solver, source-authority validator, or runtime substitution is performed.

The focused gate covers rectangular signed/fractional A/B values, both AB and BA outputs, exact unchanged question and literal quotes, all source/product cells, ordered unknowns, dependency sets, determinant-request decline, and guidance presence in both ordinary TurnPlan prompt lanes. This is implementation evidence only; it does not establish topic READY or FULLY-CERTIFIED status.

Checks passed in this worktree using the frozen lockfile and offline dependency store: drawing, scene-engine, and tutor-core builds; tutor-core typecheck; ESLint on the two owned planner files and focused gate; and `verify-matrix-product-planning-guidance.ts`. The gate confirms the AB/BA exact tables, source cell inventory and quotes, plan identities, deduplicated dependencies (including repeated operands), unsupported determinant decline, and source guidance in both ordinary TurnPlan lanes.

This log records implementation evidence only. No topic readiness or ledger status is claimed.
