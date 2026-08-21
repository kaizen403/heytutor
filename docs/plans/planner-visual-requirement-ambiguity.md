# Plan: Planner Visual-Requirement Ambiguity (LLM Grounding for the ~344 Stems)

Status: not started
Owner: delegate to a coding agent
Effort: focused, prompt + measurement work

## Objective

The deterministic pre-filter in `packages/tutor-core/src/planners/turnPlannerV3.ts`
(`questionRequiresVisual`) decides whether a question REQUIRES a diagram before
any LLM call. It is now precise on keyword-rich stems (figure references, conic
terms). What remains is the set of stems with **no lexical cue at all** — a bare
noun in prose — where only the LLM's own `visualRequirement` judgment can decide.
This task improves THAT judgment via prompt grounding, not more regex.

## Current state (verified facts)

- Pre-filter: `packages/tutor-core/src/planners/turnPlannerV3.ts`
  - `explicitDiagramRequest` (~line 226): "draw / show / sketch" verbs.
  - `referencesFigure` (~line 231): "in the figure / as shown / the diagram".
  - `isQualitativeConceptQuestion` (~line 236): pure-definition guard.
  - `questionRequiresVisual` (~line 240): OR of the above (+ conic terms),
    gated so qualitative questions only require a visual on explicit request.
  - `visualRequirement: questionRequiresVisual(q) ? "required" : "optional"`
    (~line 222) feeds the TurnPlanV3 prompt.
- Corpus measurement (harness `planner_readiness` classifier,
  `packages/scene-engine/scripts/verify/verify-syllabus-corpus.ts` lines ~1425–1440):
  `constructive` = has a construction verb; `qualitative` = definition-ish;
  `ambiguous` = neither.
- Latest report `planner_readiness` totals: **ambiguous 813, constructive 509,
  qualitative 88**. After the pre-filter, the deterministic layer catches the
  cued ones; the residual **~344 truly-ambiguous diagram-worthy stems** (bare
  noun, no figure/conic keyword) are the target of this task.
- Escalation safety net already live:
  `apps/tutor/features/tutor-session/hooks/turn/useQuestionHandler.ts` escalates
  a diagram-worthy stem that produced no validated scene to `retry_required`.

## Hard constraints (non-negotiable)

1. **Prompt size budget is a release gate.** The scene planner prompt is capped:
   `verify-scene-planner-v2.ts` asserts `initialSystemPrompt.length <= 800` and
   `serializedPromptChars <= 19_000`. Any TurnPlanV3 prompt addition must be
   SMALL (tens of chars of guidance, not paragraphs) and must not push the
   scene planner prompt over budget. Measure before/after.
2. **No regex routing of diagram CHOICE** (AGENTS.md rule 2/6). Adding a cue to
   decide *whether a visual is required* is acceptable (the pre-filter already
   does this); adding a cue that picks *which* diagram is FORBIDDEN.
3. **Deterministic pre-filter stays deterministic.** Do not move the 344-stem
   decision into the pre-filter by adding fragile noun lists. The fix belongs in
   the LLM's `visualRequirement` reasoning, grounded in TurnPlanV3's
   quantities/entities.
4. Keep `pnpm verify` green for `@heytutor/tutor-core` and `@heytutor/scene-engine`.

## What to build

### Step 1 — Measure the residual precisely

Produce a concrete list of the ambiguous diagram-worthy stems the current
pipeline leaves as `visualRequirement: "optional"`. Extend (or add a small
script alongside) the harness planner-readiness classifier to emit, for the
~344 stems: unit, stem text (truncated), and which cues fired. Output to
`data/question-bank/reports/planner-ambiguous-residual-<date>.json`. This list
is the oracle for the change — do not hand-pick examples.

### Step 2 — Ground the LLM's visualRequirement in quantities/entities

In `turnPlannerV3.ts`, the TurnPlanV3 prompt already asks for `quantities`,
`claims`, `laws`, and `visualRequirement`. Add a SHORT guidance line (target
< ~120 chars) telling the planner: if the question names a geometric/physical
object that must be located, oriented, or related in space (a point on a curve,
two vectors at an angle, a ray through a medium, a circuit loop), set
`visualRequirement: "required"` even without an explicit "draw" verb. Keep it
abstract — name NO topics. Verify the scene-planner prompt stays ≤ 19,000 chars.

### Step 3 — Regression assertions

Extend `packages/tutor-core/scripts/verify/verify-turn-planner-v3.ts` with fixtures:
- a bare-noun ambiguous stem that SHOULD now be judged `required` by the
  grounded prompt (use a mock planner to keep it deterministic);
- a qualitative definition stem that must remain `optional` unless an explicit
  draw verb is present (guard against over-calling);
- confirm `referencesFigure` / `explicitDiagramRequest` behavior unchanged.

### Step 4 — Re-measure

Re-run the harness planner-readiness measurement against the corpus and record
the new ambiguous-residual count in the report. Success = the ~344 count drops
materially WITHOUT the qualitative false-positive count rising (currently ~14).

## How to verify

```bash
pnpm --filter @heytutor/tutor-core verify     # planner + capability + prompt budget
pnpm --filter @heytutor/scene-engine verify   # harness re-measurement
pnpm typecheck
```

Confirm the scene planner prompt budget check in `verify-scene-planner-v2.ts`
still passes (it is part of `tutor-core verify`).

## Done criteria

- [ ] Residual ambiguous diagram-worthy list generated from the corpus (oracle, not hand-picked).
- [ ] Short, abstract visualRequirement grounding added to the TurnPlanV3 prompt.
- [ ] Scene planner prompt still ≤ 19,000 chars; system prompt ≤ 800.
- [ ] New regression assertions in `verify-turn-planner-v3.ts` pass.
- [ ] Re-measured residual count dropped; qualitative false-positives did not rise.
- [ ] No per-question or per-topic routing added.

## Reference files

- `packages/tutor-core/src/planners/turnPlannerV3.ts` — pre-filter + TurnPlanV3 prompt (edit target).
- `packages/tutor-core/scripts/verify/verify-turn-planner-v3.ts` — planner regression tests.
- `packages/tutor-core/scripts/verify/verify-scene-planner-v2.ts` — prompt budget gate (lines ~148–168).
- `packages/scene-engine/scripts/verify/verify-syllabus-corpus.ts` — planner_readiness classifier (~1425–1440).
- `apps/tutor/features/tutor-session/hooks/turn/useQuestionHandler.ts` — escalation net.
- `docs/architecture/tutor-sync-architecture.md` — where visualRequirement feeds the turn pipeline.
