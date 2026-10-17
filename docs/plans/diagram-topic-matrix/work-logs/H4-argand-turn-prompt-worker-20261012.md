# H4 Argand turn-plan prompt worker — 12 October 2026

Owner: `/root/r8_ship_blind_c`. Scope: request 44 in the yaren
`harness-4-requests.md` brief, restricted to `turnPlannerV3.ts`, one mock gate
and this log. The integration owner controls the shared gate command and
integration. Request 45's scene wording belongs to worker A; requests 46–52
remain pending outside this assignment. No topic acceptance counts change.

## Change

The planning and independent-audit prompts now say that `|z-a|` measures
distance to reference point `a`, while `|z+w|` measures distance to `-w`.
Point/centre components must describe that geometric reference role. Literal
`w` components may remain separately when needed; they cannot be named as the
distance reference. Literal source text and givens stay intact, and computed
sign changes are derived quantities rather than fabricated source quotations.
The alternate and fallback retry lanes inherit the same planning rule.

Existing redundant wording was compacted without changing schemas, finite
numeric answers, symbolic formula claims, unit/sign checks, quantity limits,
visual grounding or the output token cap. The primary prompt is 2,792 characters
against its unchanged 2,798-character gate (baseline 2,648 plus 150).

The recorded question's algebra is `|z|=2`, `|z+6−8i|=|z−(-6+8i)|`.
Thus the reference is `-6+8i`, its distance from the origin is 10, the greatest
distance is 12 at `z=6/5−8i/5`, and the least is 8 at `z=-6/5+8i/5`.
The mock fixtures preserve the literal `6,-8` components separately from the
derived reference `-6,8`; parenthesized addition/subtraction and Unicode-minus
neighbors exercise both signs.

## Verification

- `pnpm --filter @heytutor/tutor-core exec tsx scripts/verify/verify-turn-plan-argand-prompt.ts`
  passed 148 checks across 16 mocked requests. All fetches are replaced with
  local responses. Six literal forms cover both initial lanes, unchanged
  source/given values, derived reference roles, both extreme coordinates,
  fallback retry, independent audit and the original prompt/output caps.
- `pnpm --filter @heytutor/tutor-core exec tsx scripts/verify/verify-turn-planner-v3.ts`
  passed the existing planner contract and prompt-growth gate.
- `pnpm --filter @heytutor/tutor-core exec tsx scripts/verify/verify-symbolic-turn-plan.ts`
  passed the existing symbolic/numeric contract gate.
- `pnpm --filter @heytutor/tutor-core typecheck` and ESLint for the changed
  planner and new gate passed. Scoped `git diff --check` passed.
- The earlier shared scene-planner gate exposed worker A's pending repair
  prompt compaction at 27,671/27,000 characters. This worker changes no scene
  planner files or caps; the integration owner will rerun that gate after A's
  scoped commit.

## Evidence limits

This is a prompt-delivery and parse-contract gate with supplied mock answers,
not evidence of model compliance or deterministic numeric enforcement. No
ProblemIR, solver, source reader, diagram acceptance or rendering code changes.
Deterministic Argand numeric authority remains separate H1 scope.

Paid regions measurement stopped at frozen source `f2db27cb`. This follow-on
prompt change is **unmeasured** and used **zero API calls**. No images, paid
stock runs, new controllers, ledgers, production action or PR were created.
Comparison-budget completion and any future measurement remain with the
integration owner.

## Standalone draft validation on main — 12 October 2026

The prompt-only draft starts at `origin/main` `9e50dd3e12db6113de5dbd56520f944af4156058`;
this original worker evidence is retained above. The turn prompt and its mock
gate are unchanged from `554fc71c`. The standalone gate again passes 148
checks and 16 intercepted requests, with prompt length 2,792/2,798 characters
and the original 2,600-token output cap. Existing turn-planner V3 and
symbolic-turn-plan gates pass. No model-compliance or numeric-authority result
is inferred from mocked answers. No accepted-topic count changes.
