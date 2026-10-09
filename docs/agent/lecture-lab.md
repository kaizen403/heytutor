# Lecture lab

An offline bench for the thing the product is actually judged on: the lesson a
student receives for one question.

The admin playground can already run many lectures, but it answers only "did the
turn finish". Everything worth grading lives inside a React turn, so it was
invisible to every script. `apps/tutor/scripts/lecture-lab` replays that turn
without a browser and writes down what happened.

## What it runs

`lecturePipeline.ts` reproduces the non-DSA path of
`useQuestionHandler`: `planTurnV3` -> `planAndSolveProblemV1` ->
`planSceneDocumentWithRepair` -> `finalizeScenePlanAfterAuthority` ->
`selectVerifiedRepresentation` -> `buildVerifiedDiagramPresentation` -> the
teaching stream with continuations. The teaching prompt is not rebuilt here: it
comes from `features/tutor-session/lib/turn/turnTeachingPrompt.ts`, which the live
hook calls too, so the lesson graded is the lesson taught. What is dropped is
presentation only: Konva, TTS, persistence, cancellation.

FOCUS ids are resolved with `resolveVerifiedDiagramFocusTargets`, the same
function the board uses, so "the marker never moved" is a fact and not a guess.

## Commands

The dev server must be up (`pnpm dev:tutor`); the lab talks to it exactly as the
browser does, cookie included. Every paid run requires `--max-usd`; provider
usage is accumulated as calls finish, unknown usage is charged at the request
ceiling, and no new row starts after the cap is reached.

```bash
cd apps/tutor
# one hard probe from every physics unit
pnpm exec tsx scripts/lecture-lab/run.ts --difficulty hard --per-unit 1 --concurrency 4 --max-usd 5 --out .lecture-lab/round-01
# every hard probe in two units
pnpm exec tsx scripts/lecture-lab/run.ts --difficulty hard --units 16,11 --max-usd 5 --out .lecture-lab/optics
# one named probe
pnpm exec tsx scripts/lecture-lab/run.ts --only "physics|3|impulse|hard" --max-usd 1 --out .lecture-lab/one
# questions a student actually typed, one per line, instead of the probe bank
pnpm exec tsx scripts/lecture-lab/run.ts --ask questions.txt --max-usd 5 --out .lecture-lab/ask-01
# deterministic diagram evaluation; repeat --eval to combine corpora. Private
# real-student rows are always retained when --sample selects the public rows.
pnpm exec tsx scripts/lecture-lab/run.ts --eval public.jsonl --eval private.jsonl --sample 20 --seed 7 --arm current --figure-only --max-usd 5 --out .lecture-lab/eval-current
# planner-first is an evaluation-only ordering; the student default is unchanged
pnpm exec tsx scripts/lecture-lab/run.ts --eval public.jsonl --eval private.jsonl --sample 20 --seed 7 --arm planner_first --figure-only --max-usd 5 --out .lecture-lab/eval-planner-first --yes
# planner-with-examples uses the same ordering plus up to three cheap-model-picked examples
pnpm exec tsx scripts/lecture-lab/run.ts --eval public.jsonl --eval private.jsonl --sample 20 --seed 7 --arm planner_examples --figure-only --max-usd 5 --out .lecture-lab/eval-planner-examples --yes
# rebuild the validated example library after exemplar branches are merged
pnpm exec tsx scripts/lecture-lab/build-diagram-exemplar-library.ts
# compare legacy and current top-three retrieval without model calls; this adds
# 100 chapter-balanced figure rows from the three eval branches to the round
pnpm exec tsx scripts/lecture-lab/retrieval-check.ts --round .lecture-lab/eval-planner-examples --before-ref <r3-baseline-commit> --sample 100 --seed 7 --out .lecture-lab/retrieval-check.json
# add --picker for the paid, question-only DeepSeek Flash top-three check
node --env-file-if-exists=.env.local --import tsx scripts/lecture-lab/retrieval-check.ts --round .lecture-lab/eval-planner-examples --before-ref <r3-baseline-commit> --sample 100 --seed 7 --picker --out .lecture-lab/retrieval-picker.json
# correct stored empty-cause labels without issuing model requests
pnpm exec tsx scripts/lecture-lab/regrade-empty-causes.ts .lecture-lab/eval-current .lecture-lab/eval-planner-first
# re-score a finished round after a rubric change, no LLM calls
pnpm exec tsx scripts/lecture-lab/regrade.ts .lecture-lab/round-01
# did the last change help? regrade both rounds first, or the diff measures the rubric
pnpm exec tsx scripts/lecture-lab/compare.ts .lecture-lab/round-01 .lecture-lab/round-02
# put the same evaluation row's two figures next to each other
pnpm exec tsx scripts/lecture-lab/compare.ts --gallery .lecture-lab/eval-current .lecture-lab/eval-planner-first
```

Output per round: `runs/*.json` (the full record), `transcripts/*.md` (readable
lesson plus findings), `summary.json` (scores and finding counts), and, for
diagram evaluations, `gallery.html` plus PNGs under `frames/`. `summarize.ts`
owns that summary for both the runner and the regrader, so the two cannot drift.

Paid lab runs load `.env.local` and require a fully configured Azure provider.
Use `--model configured` (the default), the production 60,000 ms scene limit,
and a positive `--max-usd` on every run. All planner, ProblemIR, teaching, and
example-picker calls use the configured deployment. Azure fallback to Fireworks
is rejected before dispatch. Preflight and measured usage price `gpt-6-1-sol`
at US$2 input, US$0.10 cached input, and US$10 output per million tokens.
Unknown usage is charged conservatively with Azure reasoning headroom included.
Every summary and row records provider and deployment; every completed planner
call retains its actual model and measured usage. `--model standard` remains a
compatibility alias for the configured provider. The offline picker has a 15 s
bound so Azure reasoning can finish.

The `planner_examples` arm reads `data/diagram-eval/v1/exemplars/_library.jsonl`.
Synthesized entries are keyed by `depicts`: plain family/archetype language,
construction and entity kinds, relations, and readable labels extracted from
the validated document. Their source questions are neither stored nor prompted;
human-curated entries retain their checked question pairing. A round builds one
deduplicated catalogue of `<id> | <figure kind> | <depicts>` lines, with each
description capped at 16 words and the whole catalogue held below roughly 6,000
tokens. DeepSeek V4.1 Flash selects up to three exact ids with strict JSON,
temperature 0, and a 60-token output cap. It starts beside ProblemIR and has a
two-second deadline; failure or timeout invokes the explicitly named word
fallback, while a valid empty selection remains empty. Weak word matches also
remain empty instead of padding the planner with unrelated examples. Each run
records picker method, status, latency, critical-path time, tokens, actual cost,
fallback reason, and selected ids. Literal point coordinates and engine-only
metadata are still stripped from the examples sent to the scene planner.

## Judging a round

Run `judge-prep.ts <round>` to decide no-figure rows by rule, crop the diagram
zone to roughly 700 px, and split drawn figures into `judge-batches/` files of
ten. Give each batch to a Codex or Claude subagent with only the verdict rules
from the batch prompt; it opens every cropped PNG once and appends its compact
JSONL verdicts to `judgments.jsonl`. Then run `judge-apply.ts <round>` to write
`verdicts.csv`, prefill and prioritize the gallery, add the Needs human filter,
and record judge counts in `summary.json`.

- `right`: every `must_show` item is present and no `must_not_show` item appears.
- `partial`: it is the right kind of figure, but something is missing.
- `wrong`: a forbidden item appears or the figure belongs to another topic.

Paste this one line into an agent chat for a future round:

> Judge `<round>`: run `pnpm --filter @heytutor/tutor exec tsx scripts/lecture-lab/judge-prep.ts <round>`, judge only `judge-batches/*.jsonl` with Codex or Claude subagents in parallel batches of 10 using the right/partial/wrong rules in this section and `by` set to the actual agent, then run `pnpm --filter @heytutor/tutor exec tsx scripts/lecture-lab/judge-apply.ts <round>`; never open rule-decided or full-board images.

**Never build a package or run a verify chain while a round is in flight.** The
Next dev server watches `packages/*/dist`, so a `pnpm --filter ... build`
restarts it and every turn already talking to `/api/chat` dies with
`TypeError: fetch failed`. It cost 51 of 81 turns in one measurement round and
looked exactly like a product regression. Let the round finish first.

A turn that dies before the tutor speaks (the dev server or the upstream model
timing out under concurrency) is recorded as a `transport_failure`, kept out of
the pass rate and the mean, and counted separately. Five concurrent lectures
against one dev server produced about two per hundred; scoring those as teaching
failures turns a throughput problem into a fake quality regression.

## The rubric

`grade.ts` only asserts things provable from the transcript: budget, board
coverage, figure committed and labelled, marker resolution, forbidden ink,
repeated or dropped rows, meta leaks, truncation. Whether the physics is right
and whether the explanation teaches is a reviewer's job, not a regex's.

Rubric edits are free to iterate: grading is pure over the stored run, so
`regrade.ts` re-scores every past round and the trend line stays comparable.

## Review lanes

The rubric saturates: a lesson can score 100 and still teach a double slit rig
during a capillary rise question. After each round, five read-only reviewers go
over the transcripts, one lane each: physics correctness, figure fidelity,
teaching quality, board and voice coupling, and question coverage. Ranked
findings from them drive the next fix; the rubric only keeps the fixed things
fixed.

## The DSA lane

`lecturePipeline.ts` replays the physics path. A LeetCode question takes a
different lane entirely, and `dsaPipeline.ts` replays that one: the classifier,
the algorithm detector, the code planner with the board context, the compiled
walk-through, the teaching prompt, and the conductor that turns `[FOCUS]` and
`[TYPE]` tags into frame advances and block reveals. It records what the
student would actually see and hear, beat by beat, and writes every frame of
the figure as an SVG.

```bash
cd apps/tutor
# routing and figures only, no model calls, every frame rendered
pnpm exec tsx scripts/lecture-lab/dsa-run.ts --offline --out .lecture-lab/dsa-offline
# the whole lesson, against the dev server
pnpm exec tsx scripts/lecture-lab/dsa-run.ts --concurrency 3 --out .lecture-lab/dsa-01
pnpm exec tsx scripts/lecture-lab/dsa-run.ts --only "lc|1|two-sum|easy" --familiarity new --out .lecture-lab/one
# replay a question asked in the product, without editing the corpus
pnpm exec tsx scripts/lecture-lab/dsa-run.ts --question 'Explain merge sort on [8, 3, 5, 4, 7, 6, 1, 2]' --pattern merge_sort --out .lecture-lab/merge-sort
# board frames as PNGs (cached Playwright chrome-headless-shell over CDP)
node scripts/lecture-lab/svg2png.mjs .lecture-lab/dsa-01/frames
```

The corpus is `data/leetcode-probes/*.json`: 84 real LeetCode statements across
six lanes plus 20 textbook asks ("explain bubble sort on [5, 1, 4, 2, 8]").
Each probe carries the family its canonical solution uses in `pattern`.

Whether a simulator exists is asked of the catalog at run time, never of the
file: `inCatalog` is a copy of that answer and goes stale the moment a family
lands. Fifty-seven probes carried `inCatalog: false` purely because nothing
drew them yet, and each one silently became a miss reported as a correct
decline. The one hand-maintained signal is `catalogNote`, which says a probe
must draw nothing and why. `verify-dsa-routing` reads it the same way, so a
lane adding a family for a noted probe has to remove the note in the same
change.

`dsaGrade.ts` asserts only what the transcript proves: whether the question
reached the code lane at all, whether the board drew a real trace or a static
picture, whether the example is the student's own, whether the walk-through's
values match the drawn text at every address, whether every block was typed and
every frame shown, and whether the narration read code aloud, leaked machinery
words, or repeated itself. Whether the explanation teaches well is a reviewer's
job.

## Semantic review

`assess.ts` reads a finished round and asks Jev whether the explanation is
incomplete, contradicts the stored facts, or describes the wrong figure. It
writes `assessments/` next to the round. It does not change `summary.json` or
the deterministic grade, and a Jev pass is not a release approval.

```bash
cd apps/tutor
# write the requests, do not call a provider
pnpm exec tsx scripts/lecture-lab/assess.ts .lecture-lab/round-01
# send public corpus text. Requires AI_GATEWAY_API_KEY.
pnpm exec tsx scripts/lecture-lab/assess.ts .lecture-lab/round-01 --live --limit 20
```

`--no-zdr` turns off zero data retention. Use it only for public or synthetic
text. Leave it off for anything that came from a student.

**The dev server needs Postgres.** Without it `/api/chat` answers 401 and every
turn is recorded as a transport failure in under a second, which looks exactly
like the model being down. `docker compose up -d postgres` first.

## Rules of thumb learned here

- The runtime lays work rows out sequentially (`findWorkTextSlot`), so the `y`
  the model sends is advisory. Grading the row ladder measures nothing.
- Figure text comes from annotations far more often than from `entity.label`.
  Count the compiled `label`/`dimension` primitives, which is the ink that lands.
- `[STEP]` markers are the contract's format, not the board's requirement: the
  streaming parser segments on tags either way. Grading a marker-less response
  as a dead turn measured the markup, not the teaching.
- A relevance check that scores a figure by how many of its drawn symbols appear
  in the question does not work. `R1`, `S1` and `q1` are naming conventions, so
  it flagged the correct Atwood and resistor figures beside the wrong ones. What
  does work is the corpus-level check in `summarize.ts`: two different units that
  compile to the same entity id list have at least one wrong figure between them.
  Across 158 hard probes one figure of two point charges served eight unrelated
  topics, from Gauss's law to the cyclotron.
- Do not flag a dash on the board without checking it is not a minus sign. An
  earlier rubric reported six dash violations in a round that contained none.
- `questionStatesValue` treats a power-of-ten rescaling as stated, because
  0.5 mm and 0.0005 m are the same given. A fixture value that happens to be a
  rescaling of a number in the question will therefore look grounded.
