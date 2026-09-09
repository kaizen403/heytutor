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
browser does, cookie included.

```bash
cd apps/tutor
# one hard probe from every physics unit
pnpm exec tsx scripts/lecture-lab/run.ts --difficulty hard --per-unit 1 --concurrency 4 --out .lecture-lab/round-01
# every hard probe in two units
pnpm exec tsx scripts/lecture-lab/run.ts --difficulty hard --units 16,11 --out .lecture-lab/optics
# one named probe
pnpm exec tsx scripts/lecture-lab/run.ts --only "physics|3|impulse|hard" --out .lecture-lab/one
# questions a student actually typed, one per line, instead of the probe bank
pnpm exec tsx scripts/lecture-lab/run.ts --ask questions.txt --out .lecture-lab/ask-01
# re-score a finished round after a rubric change, no LLM calls
pnpm exec tsx scripts/lecture-lab/regrade.ts .lecture-lab/round-01
# did the last change help? regrade both rounds first, or the diff measures the rubric
pnpm exec tsx scripts/lecture-lab/compare.ts .lecture-lab/round-01 .lecture-lab/round-02
```

Output per round: `runs/*.json` (the full record), `transcripts/*.md` (readable
lesson plus findings), `summary.json` (scores and finding counts). `summarize.ts`
owns that summary for both the runner and the regrader, so the two cannot drift.

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
# board frames as PNGs (headless Firefox; there is no Chrome on this machine)
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
