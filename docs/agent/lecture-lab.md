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
`selectProductionScene` -> `buildVerifiedDiagramPresentation` -> the
teaching stream with continuations. The teaching prompt is not rebuilt here: it
comes from `features/tutor-session/lib/turn/turnTeachingPrompt.ts`, which the live
hook calls too, so the lesson graded is the lesson taught. What is dropped is
presentation only: Konva, TTS, persistence, cancellation.

FOCUS ids are resolved with `resolveVerifiedDiagramFocusTargets`, the same
function the board uses, so "the marker never moved" is a fact and not a guess.

## Shared production figure decision

Import `selectProductionScene` from
`apps/tutor/features/tutor-session/lib/scene/productionSceneSelection.ts`.
The live hook and lab call it for the final figure/text-only decision. The same
module exports `deriveSceneGate` for pre-request admission and
`validateProductionSceneCandidate` for the asynchronous planner/revalidation
callback. It preserves production's normalize/prune, quantity/source/proof,
compile, readable-ink, source-policy, exact-obligation and save-admission order.
No validator implementation, planner prompt or archetype slot rule is changed.

Inputs are the question, full turn plan, ProblemIR, capabilities and optional
visual-need decision (`null` means unavailable; omit only for an already-merged
plan). Raw candidates or shared callback validations, a fast representation,
solver contradiction, source policy and retry policy are explicit inputs.
`representation` is null for text-only; `reason` explains the decision, while
`selectionReason` retains the live artifact reason for backward compatibility.
`attemptedRepresentation` is diagnostics only and must never be drawn/saved.
The function performs no network, cache, persistence or environment reads.

The lab now also applies production's source-program gate, matrix-source
validation, solver block and save-admission guard; its old duplicated path did
not. Chemistry remains production-exempt from model scene planning in every
arm. Historical results are not rewritten. Execution identity records
`production-scene-selection/v2`, so old divergent-admission or pre-readable-label
rounds cannot be silently resumed with this policy. Scene-mode candidates for a
requested figure must carry readable label or dimension text before ranking;
valid text-only declines remain a separate outcome.

Specific catalogue role guidance requires detection score at least 3. Weaker
matches still admit planning; family guidance and operators remain available.
This is a confidence filter, not proof of semantic fit. Strong incorrect cues
and the picker's weak archetype hint remain outside this narrow correction.

New runs persist `diagram.plannerDeclined` only for a selected, validated
`text_only` document. Earlier rejected-attempt errors remain diagnostics. The
old synthetic `planner_declined_required_scene` marker also covered dropped
unlabelled scenes: without validated outcome evidence, historical marker-only
empties are `planner_no_output` (outcome unknown), not proven declines. Required
no-figure grading remains `empty_bad` regardless of the cause label.

`pnpm --filter @heytutor/tutor verify:production-selection` checks the shared
decision and the original six live/save figures plus both edited forgeries.

## Live visual-need parity (Part 14c)

Every new non-DSA lab turn calls the live `/api/visual-need` client beside the
turn planner, with the same 3,000 ms client and 2,400 ms server limits. Numeric
authority starts from the unmerged selected plan; Jev is merged by the shared
production gate before picker/scene admission. Records retain the selected
planner vote, typed Jev answer or unavailable reason, merged requirement,
policy/model provenance and separate Jev accounting. Unavailable is null, never
an explicit `none`. Live behaviour and default-off strict flags do not change.

The Jev-only audit uses no figure/teaching calls:

```bash
pnpm exec tsx scripts/lecture-lab/visual-need-audit.ts --eval sample.jsonl --round current=.lecture-lab/current --round planner_examples_strict=.lecture-lab/strict --max-usd 1 --yes --out .lecture-lab/visual-need-audit
```

The audit owns one stable lab trace (not a separate idle lesson slot per row)
and spaces dispatches by at least 650 ms, below the unchanged production IP
limit. Waiting occurs before the client's 3 s timer. A local HTTP denial stops
the audit and leaves that row and remaining rows untested; it is not a Jev answer.
Unresolved local denials persist through budget-blocked resumes. Legacy saved
HTTP-denial assessments stay pending until retried; their original call charges
remain in the ledger even after successful recovery. A key
limited to Gateway free credits can list Jev but receive an upstream 403;
Azure credits do not supply Vercel AI Gateway paid-model entitlement.

It freezes identity-checked answers and writes an action-changed sample. Rerun
that sample with `run.ts --visual-need-replay <audit>/visual-need.jsonl` and
`--example-exclusions <original-full-sample.jsonl>` on both arms. Replay cannot
silently fall back to paid Jev calls; missing/changed questions, model, rubric,
policy or deadlines fail closed. Execution identity binds the frozen bytes and
full retrieval exclusions, so historical planner-only rounds cannot be resumed
under the new policy. Audit resumes retain unknown in-flight reservations.

Jev requests reserve before dispatch just like Azure, including concurrent
calls. Unknown dispatched usage consumes the full reservation; proved
missing-key/open-circuit non-dispatches cost zero. Summaries separately name
Vercel AI Gateway / `typesafe-ai/jev` and the Azure figure deployment. Historical
final planner requirements are only proxies for the old merge comparison: old
rows did not retain their initial raw vote. Missing historical rows remain
untested, not `none`. A stronger optional-to-required vote is reported but alone
does not prove changed figure admission. Changed reruns also inherit the new
shared production admission guards, so their outcomes cannot be attributed
solely to Jev. No lab result establishes production timing.

## Commands

The dev server must be up (`pnpm dev:tutor`); the lab talks to it exactly as the
browser does, cookie included. Every paid run requires `--max-usd`. Each planner,
teaching, and picker request reserves its full cost ceiling before dispatch,
including concurrent calls and Azure reasoning headroom. Measured usage releases
the unused reservation; unknown usage consumes it. Budget-interrupted rows are
untested, not empty-figure verdicts; their incurred cost remains in the ledger.
Proxy reservations cover two planner or three teaching upstream attempts. A
response reports its attempt count; earlier unmetered attempts retain their
per-attempt allowance. Direct picker requests have no automatic retry.
Resume into the same output folder with `--resume`, the full original sample,
and a total `--max-usd` (not a fresh allowance). Saved rows are skipped only for
execution, never for example leak filtering. The spend checkpoint carries
settled costs plus interrupted reservations forward and rejects a changed arm,
provider, figure-only mode, language/familiarity, example library, scene limit or
sample. A missing checkpoint or execution identity fails closed: verify the
original settings and spend before an explicit local migration. An allowance
alone cannot prove the original execution identity.
The checkpoint fingerprints all original row contents, not only IDs. Invalid
cost fields fail closed; legacy checkpoints without a fingerprint require an
explicit local migration after verifying the original sample.

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
# strict uses the same planner+examples path and teaches text-only if it fails.
# Every paid lab uses the configured provider and production 60 s budget.
pnpm exec tsx scripts/lecture-lab/run.ts --eval public.jsonl --eval private.jsonl --sample 20 --seed 7 --arm planner_examples_strict --model configured --scene-planner-limit-ms 60000 --figure-only --max-usd 5 --out .lecture-lab/eval-strict --yes
# rebuild the validated example library after exemplar branches are merged
pnpm exec tsx scripts/lecture-lab/build-diagram-exemplar-library.ts
# compare legacy and current top-three retrieval without model calls; this adds
# 100 chapter-balanced figure rows from the three eval branches to the round
pnpm exec tsx scripts/lecture-lab/retrieval-check.ts --round .lecture-lab/eval-planner-examples --before-ref <r3-baseline-commit> --sample 100 --seed 7 --out .lecture-lab/retrieval-check.json
# add --picker for the paid, question-only configured-provider top-three check
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

Paid lab runs load `.env.local` and require a fully configured provider.
Use `--model configured` (the default), the production 60,000 ms scene limit,
and a positive `--max-usd` on every run. Azure lanes use the configured
deployment; Azure fallback is rejected before dispatch. On Fireworks, the
authenticated standard-evaluation header pins planner, ProblemIR and teaching
to standard Kimi K3 by default; the picker uses the configured cheap model.
`--model fast` (Fireworks only) omits that header and runs production's routing:
the Kimi K3 Fast router (`accounts/fireworks/routers/kimi-k3-fast`) in planner,
ProblemIR and teaching at Fast rates ($4.5 input, $0.45 cached, $22.5 output per
million). The server advertises a separate Fast lab profile and preflight
compares it exactly; any Fast lane override fails before a paid call.
The supported Fireworks picker identities are standard K3 and DeepSeek Flash.
Authenticated preflight compares the effective lane models and prices between
server and runner. Unknown model/price identities fail before paid dispatch.
Use effective local price overrides when the published rates change; do not
reprice historical runs or change production settings for a measurement.
For Fireworks credit-capped probes use the higher DeepSeek Flash rates:
`FIREWORKS_DEEPSEEK_FLASH_INPUT_USD_PER_1M=0.30` and
`FIREWORKS_DEEPSEEK_FLASH_OUTPUT_USD_PER_1M=1.20`, supplied to **both** CLI and
dev-server processes before the round. K3 rates are $3 input, $0.30 cached and
$15 output per million tokens. Do not edit `.env.local` during a round: the
server may reload a different model or price after preflight.
By default (`--spend-mode conservative`), unknown usage is charged conservatively
with server output headroom and proxy retry bounds included. Server-prepared
picker catalogue and scene-example additions also reserve input headroom.
The exact model/rate profile, server caps and input bounds are recorded in
summary/row execution identity and must match on resume, including when the
Fireworks deployment is null. Every completed planner call retains its actual
model and measured usage. `--model standard` remains a
compatibility alias for the configured provider. The offline picker has a 15 s
bound so Azure reasoning can finish.

The exported `assertLabBudgetPreflight` and `labRequestBudgetDecision` in
`apps/tutor/scripts/lecture-lab/run.ts` own the actual runner's per-request
reservation policy. The latter is pure: it uses the captured endpoint, profile
prices and server bounds, not fresh environment lookups. Query-string chat
requests cannot bypass the cap; picker and scene additions keep their input
bounds, and teaching reserves all three upstream attempts. The offline
`verify-lab-request-budget.ts` gate checks those outcomes and the main wiring,
including five mutation controls. Use conservative mode for these probes;
`response_usage` below is not a hard provider-bill cap.

For provider-metric reconciled experiments, opt into `--spend-mode response_usage
--max-usd 10`. This is a cap on the known response-usage subtotal, priced at the
configured rates, not proof of a hard cap on the provider bill when usage is
missing. Planner JSON, final teaching SSE usage chunks and every direct picker
attempt settle measured tokens, including cached input and output reasoning.
The existing lab visual-need meter follows the selected mode too. Known service
usage is priced by its existing token/reported-cost evidence; missing-key and
circuit-open answers prove zero dispatch. Other missing usage stays unresolved.
Response-mode visual-need admission waits for occupied headroom, while the
conservative default and frozen replay behavior stay unchanged.

Earlier proxy retries without usage remain unresolved; unused retry slots never
become measured spend. Missing or incomplete usage is unknown, not measured zero.
Dispatch still reserves the full concurrent in-flight ceilings (including proxy
retry limits); callers wait for existing responses to settle when they need
headroom. No dispatch occurs when known settled cost plus those ceilings would
exceed the allowance. A cap can stop with a small unused balance because the
next call needs its full ceiling. Unresolved historical calls release dispatch
headroom while their estimated exposure remains visible, so they can put the
actual bill above the known-usage cap. Reconcile Azure ProcessedPromptTokens and
GeneratedTokens before and after each controlled phase, stop to investigate
unresolved usage, and give separate rounds only the remaining aggregate budget.

In this mode, `chargedUsd` and `knownUsageUsd` are the measured subtotal;
`reservedUsd`/`inFlightCalls` are temporary dispatch headroom.
`unresolvedCalls[]` identifies trace, lane, model, attempt count, reason and
`allowanceUsd`; `unresolvedAllowanceUsd` is their total estimated exposure, not
paid cost. Per proxy `modelCalls[]` records `measuredCostUsd: null` when unknown,
plus unresolved attempts/allowance. Picker rows record `knownUsageUsd`,
`unresolvedUsageCalls` and `unresolvedAllowanceUsd`. Thus the known subtotal plus
unresolved allowances describes the accounting range, subject to the request
ceiling estimates; provider metrics remain the independent evidence. Checkpoints
and row execution identities carry the mode, response pricing and server caps. Legacy checkpoints are conservative
and cross-mode resume is rejected. In-flight calls from an interrupted
response-usage checkpoint become explicit unresolved checkpoint evidence on
resume, never measured charges; its `attempts` counts interrupted requests whose
upstream attempt counts are unknown. `--resume-extra-usd` cannot add an unmetered
allowance to this mode. The offline gate uses zero network/model calls and is included in the retained
lab checks: `pnpm --filter @heytutor/tutor verify:lab`.

The `planner_examples` arm reads `data/diagram-eval/v1/exemplars/_library.jsonl`.
The shared picker catalogue keeps exact library IDs (including curated subject
slashes), deduplicates figure descriptions and stays below 6,000 estimated
tokens. On overflow, it packs a deterministic question/turn-plan shortlist;
`omittedEntries` counts budget omissions. It never includes source questions or
raises the live picker's 4-second deadline. Ordinary lab arms rebuild an
overflowed catalogue per turn rather than reusing a global truncated shortlist.
Synthesized entries are keyed by `depicts`: plain family/archetype language,
construction and entity kinds, relations, and readable labels extracted from
the validated document. Their source questions are neither stored nor prompted;
human-curated entries retain their checked question pairing. A round builds one
deduplicated catalogue of `<id> | <figure kind> | <depicts>` lines, with each
description capped at 16 words and the whole catalogue held below roughly 6,000
tokens. The configured provider selects up to three exact ids with strict JSON
and a 60-token content cap (Azure also reserves reasoning headroom). It starts
beside ProblemIR with a 15-second offline deadline (four seconds live); failure
or timeout invokes the explicitly named word
fallback, while a valid empty selection remains empty. Weak word matches also
remain empty instead of padding the planner with unrelated examples. Each run
records picker method, status, latency, critical-path time, tokens, actual cost,
fallback reason, and selected ids. Literal point coordinates and engine-only
metadata are still stripped from the examples sent to the scene planner.

Live subject opt-in: `DIAGRAM_STRICT_SUBJECTS=maths` (empty by default) applies
strict planner/examples selection only to ordinary maths lessons. The server
returns the allowed subjects with the begin-turn grant; the existing TurnPlanV3
calls classify the subject only when this opt-in is set. Unknown or disagreeing
peer subjects stay current. Eval rows supply their labelled subject through the
same `maths` / `physics` / `chemistry` vocabulary. No new classifier call or
keyword-to-figure router is added. Chemistry, code/DSA and doubts/resumes retain
their exemptions. The older percentage/actor allowlist is independent and still
assigns global strict when explicitly enabled. Leave all flags off in production.

To measure that production maths opt-in rather than a forced strict eval arm,
add `--production-strict-subjects maths` to a `planner_examples_strict` run.
This uses the existing turn planner's actual subject consensus, the live subject
policy and the live four-second `/api/chat` picker without word fallback. Rows
classified as unknown or non-maths stay current, recorded in
`productionStrategy`; corpus subject labels never override that decision.
`--production-strict-subjects maths,physics` puts physics on the same strict
path (a candidate production setting); `maths` keeps physics on the current
production path. The list is recorded in the run's execution config.
Like the live client, the picker request carries the classified subject. Physics
and chemistry turns see only their own subject's examples, and IDs from another
subject are never admitted for those turns. Maths keeps the whole library, as do
turns classified `other` and old clients that send no subject.
Picked IDs must also survive the lab's full-sample exemplar exclusions. The
picker is pinned to the configured lab origin's `/api/chat`, even if a public
API origin is set, so it cannot bypass authentication or hard-cap accounting.
The CLI normalizes HTTP(S) origins once for both transport and accounting,
including trailing slashes and default ports; credentials, paths, queries and
fragments are rejected without echoing their contents.
Picker proxy usage is included in planner accounting, not charged again in its picker
record. Resume identity binds this profile; omitting the flag preserves the
existing evaluation behaviour. This option does not set any live environment
flag. With Jev disabled, use identity-checked unavailable replay evidence on
both arms: no Jev vote is not an explicit `none`, and turn-planner visual need
remains authoritative.

Part 15 decline experiment (lab only): `--scene-decline-policy
qualitative_setup_v1` clarifies faithful nonmetric concept setups, without
relaxing operator/source/proof gates. Keep `--model configured`, the production
`--scene-planner-limit-ms 60000`, and a hard `--max-usd` cap. Subsample rounds
can preserve their original full-sample leak guard with `--example-exclusions
<full-sample.jsonl>`; resume rejects changed experiment or exclusions. Private
run artifacts retain raw candidate responses separately from deterministic
fallback diagnostics. `physicsHybrid.ts <output.json>` computes the read-only
counterfactual over previously judged Part 11/12/14 artifacts, with no API calls.

## Reference picture step

`--reference-picture` (off by default) replays the live reference picture tier
(`docs/architecture/reference-pictures.md`) against the dev server's real
`POST /api/reference-picture`, which must run with `DIAGRAM_REFERENCE_PICTURE=on`
(a 404 stops the round). `labReferencePicture.ts` makes the hook's three moves
in its order: an early start right after the merged visual requirement for
every subject outside the chemistry lane whose turn wants a figure; a start at
the text only point otherwise (no verified figure, requirement not `none`, not
DSA); a 25 s wait plus the asset preload (image and stroke plan);
an abort when a verified figure wins. A shown picture gives the teaching prompt
the presentation's `promptAddon` and the marker its `reference_picture` target,
while every engine field stays text only, as live.
`--reference-picture-part-focus` also builds the picture's part and key focus
targets (live begin-turn `referencePicturePartFocus`); start the dev server with
`REFERENCE_PICTURE_PART_FOCUS=on` too, since the server strips `parts` from
records when its flag is off.

Use `--production-strict-subjects` for production parity (now allowed with
`--ask` on the strict arm, with the same leak-filtered example library): it is
what makes the planner classify the subject the request carries and the
strict policy reads. Set `DIAGRAM_YIELD_POLICY` on the CLI
to match production; the lab reads it from its own environment.

The route bills its own reservation and returns no usage, so every request
reserves $0.40 before dispatch (the query plus two rounds of three Ember-1
judges at the route's own ceilings, $0.379; $0.13 more when an image provider
is configured) and settles to it. Only a refusal before the route reserves (a
4xx, `missing_key`) is a proved zero. Ready answers that cost a cent still
charge $0.40, and so does an early request a verified figure aborts, so the
ledger overstates picture spend by design.

Each row records `referencePicture` (attempted, speculative, status, reason,
subject, `startedAtMs`, `requestMs`, `waitMs` past scene planning, the route's
answer and `cached`, picture id, title, source, licence, labels, the saved
image under `pictures/`, accounting) and `timings.firstTeachingTokenMs` (turn
start to the first teaching token). The transcript gains a Reference picture
section with planner, ProblemIR, scene planning, picture and total timings;
`summary.json` gains `referencePictures` (shown on engine failures, wait p50
and p90) and `referencePictureCalls`. The route's `steps` (search and judge
trail) and a numbered picture's `legend` are kept per row and printed in the
transcript. The offline gate is
`verify-lab-reference-picture.ts`, inside `verify:lab`.

```bash
cd apps/tutor
DIAGRAM_YIELD_POLICY=verified_parts caffeinate -i pnpm exec tsx scripts/lecture-lab/run.ts --ask questions.txt --model fast --arm planner_examples_strict --production-strict-subjects maths,physics --reference-picture --concurrency 2 --max-usd 6 --out .lecture-lab/pictures-01
```

## Planner evidence

Every new run initializes `diagram.plannerDeclineReason` (selected candidate,
or null), `plannerDeclines` (all parsed text-only responses, including discarded
speculation), and `rejectedOperatorCalls` (all calls in every failed candidate,
including repair and authority revalidation). Arguments come from the original
raw JSON, not normalized geometry. Each `rawArguments` and reason string is
limited to 2048 UTF-8 bytes, with original byte length and a truncation flag.
Path/entity matches are diagnostic hints; `candidate_rejected` does not mean
that each suboperator independently failed. These private records never change
validation, prompts, selected scenes, or call counts. Historical missing text
and arguments cannot be reconstructed from fallback reason strings.

## Judging a round

Run `judge-prep.ts <round>` to decide no-figure rows by rule, crop the diagram
zone to roughly 700 px, and split drawn figures into `judge-batches/` files of
ten. Give each batch to a Codex or Claude subagent with only the verdict rules
from the batch prompt; it opens every cropped PNG once and appends its compact
JSONL verdicts to `judgments.jsonl`. Then run `judge-apply.ts <round>` to write
`verdicts.csv`, prefill and prioritize the gallery, add the Needs human filter,
and record judge counts in `summary.json`.

Every later comparison is judged in one session across all arms. Include the 40
reference cards in that session, then run
`pnpm diagram:judge-check <session-judgments.jsonl>` to report agreement with
the local, gitignored `data/diagram-eval/v1/anchors.jsonl`. References marked
`owner` or `codex-reference` are accepted and their provenance is printed. A
Codex reference score measures judge consistency between sessions, not human
accuracy. Never commit the reference JSONL or `anchor-images/`: they may contain
real student questions and figures.

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

## The doubt lane

`doubt-run.ts` asks a doubt on the page a lesson left: the measurement for
"figures at any point" (`.context/plans/figures-any-time-brief.md`, section 5).
The set is `data/doubt-probes/doubts-v1.jsonl`, 40 lesson and doubt pairs
written from the subject, never from engine output. Each row names the part a
teacher would point at (`expect.point`, with `pointTerms`: the marks a teacher
would write on it), or the new figure a teacher would draw (`expect.newFigure`),
or neither. A row may circle a figure part or a work row first (`mark`,
`markTerms`). DSA rows may pick the frame on the board (`dsaFrame`, negative
counts from the end; the default is the last).

| Lane | Rows | Point | New figure | Neither |
|---|---|---|---|---|
| `physics_maths` (hand coded families) | 14 | 8 | 6 | 0 |
| `chemistry` | 8 | 5 | 3 | 0 |
| `dsa` | 8 | 7 | 1, out of scope: must draw nothing | 0 |
| `reference_picture` | 6 | 6 | 0 | 0 |
| `control` | 4 | 0 | 0 | 4 |

Per row, the runner:

1. builds the lesson. Physics, maths, chemistry and picture rows run
   `runLecture` once per distinct lesson question (rows sharing a question share
   it), saved under `lessons/`; `--lessons <round>` reuses a prior round's at
   $0. Picture rows run the reference picture step, so the dev server needs
   `DIAGRAM_REFERENCE_PICTURE=on` (and `REFERENCE_PICTURE_PART_FOCUS=on` with
   `--reference-picture-part-focus`). DSA rows build the walk-through offline
   with `resolveDsaFrames`;
2. lays the lesson's rows out with the live slot finder, so `workColumnRows`
   and `workColumnRoom` hand the prompt the rows and room the board would;
3. asks the doubt as live does: `buildDoubtPrompt`, or `buildMarkedDoubtPrompt`
   with a mark built from `collectMarkCandidates`; `buildDoubtTeachingPrompt`;
   the dev server's `/api/chat` with the continuation loop; then per segment
   `prepareVerifiedLessonSegments`, the streamed FOCUS fold and `doubtSegment`
   with the arm's pointing policy;
4. resolves every FOCUS and ANNOTATE that survived with
   `resolveVerifiedDiagramFocusTargets`;
5. saves it in process: `doubtFigureRefFor` and `doubtTurnScene` build the
   artifacts, and `canonicalizeTurnSceneMetadata` runs with an in-memory
   `loadPageFigure` that returns the lesson's figure.

Arms run on the same rows and the same lesson: `today` grants nothing,
`pointing` grants `DIAGRAM_DOUBT_POINTING` (the begin-turn `doubtPointing`),
`figures` also grants `DIAGRAM_DOUBT_FIGURES` (phase 2). `--doubt-pointing` and
`--doubt-figures` add those arms. The lab builds the grant itself, as live
builds it from begin-turn, so a server that knows neither flag is unaffected.

What differs from live: no hedged first request and no startup retry reason;
the doubt is asked after the lesson finished, never mid lesson; a DSA board
has no code plan (the panel is hidden, so its text is never quoted); a long
WRITE row takes one row, not its wrapped lines; and the page figure the save
checks against is the lesson's own presentation, not one restored from a
saved row (the loader rules are `verify-doubt-figure-pointing`'s job).

Grades (`doubtGrade.ts`, pure, so `--regrade` rescores a round):

- pointing: `right_part` when a pointed part carries a `pointTerms` mark,
  `wrong_part` (sent to a human), `no_pointer`, or `no_figure` when the lesson
  drew nothing to point at; a row expecting no point records
  `pointed_unasked` if it pointed anyway;
- new figure: `none_when_needed`, `drawn_when_not_needed`, `drawn_unjudged`
  until a judge says right or wrong, and `ok_out_of_scope` or
  `drawn_out_of_scope` for the DSA row;
- wrong pins: a `|keep` ring on a part that is not the expected one, or any
  ring on a row expecting no point;
- saved equals live: every live FOCUS id survives the save (a dropped ANNOTATE
  is reported apart: the save drops a withheld answer label by design).

The bar per arm: 0 wrong figures, 0 wrong pins, saved equals live on every
row, and p50 time to first word on doubts that drew no figure within 0.5 s of
the `today` arm.

Rows the rule cannot settle go to `judge-queue.jsonl`. A judge (a human, or a
subagent with the row's transcript) appends one line per row to
`judgments.jsonl`: `{"id","arm","pointing"?,"newFigure"?,"pins"?,"by","reason"}`,
with `pointing` one of `right_part | wrong_part | no_pointer`, and `newFigure`
and `pins` one of `right | wrong`. Then `--regrade` rewrites `grades.jsonl`
and `summary.json`. A human reviews every `wrong`.

```bash
cd apps/tutor
# offline: parse the set, print the plan and spend estimate, smoke the doubt
# path on real DSA frames and a fixture figure with scripted answers
pnpm exec tsx scripts/lecture-lab/doubt-run.ts --dry-run
# synthetic checks of the grades
pnpm exec tsx scripts/lecture-lab/doubt-run.ts --check
# the paid round: both arms, live cap (default $5), concurrency 2 (default)
DIAGRAM_YIELD_POLICY=verified_parts caffeinate -i pnpm exec tsx scripts/lecture-lab/doubt-run.ts --max-usd 5 --out .lecture-lab/doubts-01
# the pointing rows only, reusing that round's lessons at $0
pnpm exec tsx scripts/lecture-lab/doubt-run.ts --lessons .lecture-lab/doubts-01 --lanes physics_maths,chemistry,dsa --max-usd 2 --out .lecture-lab/doubts-02
pnpm exec tsx scripts/lecture-lab/doubt-run.ts --regrade .lecture-lab/doubts-01
```

Spend: every chat, visual need and picture request reserves its worst case
before it is sent and settles after (conservative mode, the pieces `run.ts`
uses). A request that would pass `--max-usd` is never sent, and its row is
listed as untested, not graded. A picture lesson reserves the route's full
ceiling ($0.40, or $0.80 with an image provider), so the six picture rows alone
can take most of a $5 cap: run them as their own `--lanes reference_picture`
round, or reuse recorded lessons. An output directory with a
`spend-checkpoint.json` is never reused. Never build while a round runs.

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
