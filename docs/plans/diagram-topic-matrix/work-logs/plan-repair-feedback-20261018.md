# Rejected turn-plan feedback — 18 October 2026

Owner: incident integration lane. Base: `7afb99772` on `main`.

## Cause and change

The two initial turn-plan lanes could both fail deterministic arithmetic or
claim checks. The existing third attempt received only a generic instruction
to return a corrected plan, without the rejected draft or validation reasons.
A private replay reproduced repeated arithmetic/sign and linked-claim failures.

The existing final retry now receives the last rejected draft (at most 12,000
characters) and typed validation codes. It is instructed to recompute from the
original question, keep one unit/sign convention, and reconcile quantities and
linked claims. The draft is explicitly untrusted model output. The original
validators still decide admission; no additional calls or time budget are added.
Public request-outcome diagnostics still contain only codes and counts.

## Evidence

- `verify-turn-plan-repair-feedback.ts`: synthetic series-resistor fixture drives
  the actual HTTP, parse, validation and final retry path. It fails before the
  patch, passes after it, rejects an uncorrected final answer, asserts exactly
  three calls, and checks that raw draft content stays out of diagnostics.
- Mutation: removing the feedback from the final request makes that gate exit 1;
  the implementation was restored immediately afterward.
- `verify-turn-plan-outcomes.ts`: all 25 scenarios passed.
- `verify-turn-planner-v3.ts`: passed.
- Tutor-core typecheck and build passed; lint had only an existing unrelated
  unused-variable warning.
- App `verify-llm-provider.ts`: 20 groups passed, including Fireworks request
  parameters, lane selection, fallback selection, and isolation from Azure.
- App `verify-production-scene-selection.ts`: passed against rebuilt packages.
- Tutor production build: passed with isolated local service configuration.

No production question text, account identifiers, or raw traces are included.
The private replay establishes the failure cause, not proof that a fresh model
request will repair every invalid plan. This is not chapter certification and
changes no accepted topic count. Live circuit measurement is reported separately.
