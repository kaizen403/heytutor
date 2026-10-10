# Experimental physics selection policy

The physics hybrid is **off by default**. It chooses between existing current
and strict selection, not new geometry. It does not change the planner prompt,
quantity authority, proof gates, archetype slots, save admission or text-only
fallback. Invalid and partial scene candidates still cannot render.

## Contract

The app and lecture lab call `liveDiagramStrategyDecision` in
`apps/tutor/features/tutor-session/lib/scene/diagramStrategy.ts` with the existing
production scene gate's `families` and `archetypeId`. Subject comes from the
existing turn-planner classification, never the evaluation topic or chapter.
No question-keyword router is added. Missing or unknown subject does not opt in.

Existing chemistry, code, DSA and doubt exemptions take precedence. An explicit
strict cohort assignment or strict subject opt-in takes precedence over hybrid.
Otherwise, classified physics in hybrid mode uses current for the frozen
measurement/SHM/wave/resistive-circuit/magnetic archetypes and optical families
listed in that module; every other physics signal uses strict. A family or
archetype match is a selection hint, **not** a correctness certificate.

This rule approximates a retrospective development-cohort result. It cannot
exactly reproduce an evaluation-chapter rule or an oracle that knows which
individual figures were right. Its versioned signal set must not be tuned on
held-out outcomes and then reported as unseen evidence.

## Opt-in and rollback

Activation requires explicit deployment approval, not just a green PR:

```dotenv
DIAGRAM_STRICT_SUBJECTS=maths
DIAGRAM_PHYSICS_MODE=hybrid
```

Do not also list physics in `DIAGRAM_STRICT_SUBJECTS` if intending hybrid:
explicit physics strict would override it. Unset `DIAGRAM_PHYSICS_MODE` to return
physics to its existing behavior without changing maths. Unknown values stay
off. The begin-turn response carries only the parsed mode; the client does not
read a public environment flag or independently enable it.

Watch admin's `diagram_subject`, `diagram_physics_mode`, effective/assigned
`diagram_strategy`, `diagram_strategy_reason`, `diagram_hybrid_signal`, and
`diagram_hybrid_policy`, together with figure source, empty cause, errors and
`turn_save_rejected.code`. Save/reopen and visible correctness still require
real lesson checks. Lab intervals are not production timing evidence.

## Production-matching lab profiles

Use the same frozen visual sample, full retrieval exclusions, configured Azure
provider, 60 s scene limit and Jev-off evidence for every arm. The current
physics profile keeps maths strict; it must still load examples if the planner
classifies an actual row as maths. Corpus labels never override classification.

- Current: `--arm current --production-strict-subjects maths`.
- Strict: `--arm planner_examples_strict --production-strict-subjects maths,physics`.
- Hybrid: `--arm planner_examples_strict --production-strict-subjects maths --production-physics-mode hybrid`.

The internal strict arm name enables the live picker/library for hybrid; the
production profile and final recorded strategy distinguish the measured arms.
Every paid command requires a finite positive `--max-usd`. Execution identity
binds the profile, mode and policy versions; run records retain the picker
decision and final-IR strategy/reason. Compare actual Azure deployment-filtered
token metrics separately from the conservative cap ledger.

Gates: `scripts/verify/verify-physics-hybrid.ts`,
`scripts/verify/verify-lab-production-profile.ts`,
`scripts/verify/verify-diagram-strategy.ts` (registered in tutor `preverify`),
and the existing production selection/parity,
authority, restoration and save/reopen gates. No production setting is changed
by these tests or the evaluation.
