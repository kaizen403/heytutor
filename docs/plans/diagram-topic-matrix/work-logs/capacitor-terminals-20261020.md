# Capacitor terminal contract, 20 October 2026

Base: main `e03960bda9724ea9559db9898529c759bc400ce0`. This slice strengthens the existing native capacitor interface; it does not add a second glyph or infer connectivity from plate positions.

## Measured cause and change

The six motivating recorded drafts used free plate segments instead of the existing two-terminal `symbol: capacitor`. Coincident or parallel plate strokes are not a component edge, so those drafts do not close their source loop. The existing compiler already owns two equal perpendicular plates, a positive gap, separate leads and the exact declared start/end ports.

Planner initial/repair guidance now explains that interface, and source-closure diagnostics identify the source terminal IDs and the required component/connector repair. Advice is conditional: a negative mention of a capacitor never instructs adding one. No positional plate rule, graph join, terminal rewrite, global pruning change or validator bypass was added.

Independent review also reproduced a server trust-boundary hole: a forged qualitative ready payload could save free plates or an incomplete circuit despite production candidate rejection. The existing engine closure proof is now exported and shared by live/save admission for every representation tier. It uses the actual request question plus validated plan facts. Intentional open-circuit policy remains supported; qualitative scenes do not inherit unrelated exact-tier obligations.

## Verification

- Engine/core builds and engine/core/tutor typechecks pass. Engine/core lint passes with five existing warnings.
- Native geometry/terminal gate: 289 checks across 18 rotations/reversals, fixed glyph invariants and four malformed free-plate arrangements. Collapsing the native plate gap or reverting the repair diagnostic fails the corresponding gate.
- Actual mocked planner initial/repair transport carries the contract within existing scoped budgets, without provider calls. The unscoped connectivity repair is 26,941/27,000 characters. The unrelated generic unscoped 27,611-character failure is identical on base main; no threshold changed or full-suite pass claimed.
- Actual production selection/save gate preserves a closed native loop and refuses six malformed alternatives. Actual server persistence gate has 43 checks: malformed qualitative payloads, all shared admission tiers, no-plan saves, actual-question authority, native and intentional-open controls. Removing the shared closure call makes the forged-save regression fail.
- Existing circuit topology feedback42, guidance25 and parallel-load-count576 checks pass.
- Recorded source replay: 1,709 historical circuit candidates retain 1,245 compilable/986 production-valid figures; 624 mixed candidates retain 405 compilable/346 production-valid. Zero status changes or retained render-hash changes; all 1,332 valid scenes remain saveable under the shared guard. Cohorts overlap and are not unique student/run counts. Most historical selection contexts are reconstructed; this is candidate/shared-save evidence, not a live production measurement.
- The 54 recorded Kimi candidates retain 20 valid/13 selected candidate outcomes with zero selection or render changes. All 18 native fixture renders match the final source exactly. A fresh blind judge graded all 18 native figures: 18 right, 0 partial, 0 wrong.

No recorded model coverage gain is claimed: the old free-plate drafts remain correctly refused. No paid calls, production changes or merge for this PR. Recorded questions, identities, payloads, images and blind keys remain private under ignored `.context`; committed fixtures are synthetic. No accepted-topic counter changed.

## Remaining boundary

A separate pre-existing global bypass-pruning weakness can erase evidence in synthetic cases. The measured recorded proof-loss cases contain no capacitor. This slice does not change global repair/pruning policy and does not claim all short/bypass scenarios are solved. A deliberately shorted or open circuit can also be the correct source question.
