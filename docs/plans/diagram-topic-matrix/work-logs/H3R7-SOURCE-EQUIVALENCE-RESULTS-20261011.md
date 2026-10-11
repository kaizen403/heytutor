# H3R7: source-equivalence repair — not ready

Harness 3, 11 October 2026. **The completed first repeat fails the required-empty gate, and the second repeat stopped at 37/40 under the frozen budget guard.** No PR will be opened or reopened. PR #143 remains closed; there was no push, merge or production change. Accepted topic counts remain unchanged.

The measured runtime is local commit `054cdbad0ad0109e88947c4f886ce7d906f2ccb2`; MAIN is pinned to `216450fcf7e5a88d41341a9e79871e1b9d198c72`. Runtime source, builds, eval, examples and controls remained frozen after dispatch. Subsequent changes only save this report and evidence.

## Completed first repeat

All 40 required rows per arm remain in the denominator; all 80 outcomes classified as maths with strict strategy, with zero run errors. These are the complete first pair, analyzed as a separately frozen **secondary analysis**, rather than a completed two-repeat primary experiment.

| Judge | Main right / partial / wrong / required empty | Candidate right / partial / wrong / required empty | Drawn main → candidate | Gate |
| --- | --- | --- | --- | --- |
| First A | 1 / 22 / 16 / 1 | 18 / 17 / 1 / 4 | 39 → 36 | Fail |
| First B | 0 / 21 / 18 / 1 | 17 / 18 / 1 / 4 | 39 → 36 | Fail |
| Consensus | 0 / 21 / 18 / 1 | 18 / 17 / 1 / 4 | 39 → 36 | Fail |

Every first judge and consensus shows more right figures and fewer wrong figures, but required empties rise **1 → 4**. Readiness requires both complete repeats, each passing under A, B and consensus: right increases; wrong is at most 1/40 and no higher than main; required empty is no higher than main. There is no pooled rescue or dropped refusal row. MAIN scores differ from the historical H3R6 scores because fresh blind judges regraded the same immutable figures; the underlying MAIN captures were not regenerated or changed.

The aborted second candidate has **37 saved rows, 34 drawn and 3 required empties**. These are structural counts, not grades; its prefix remains ungraded. Even if the missing three rows drew, the existing three empties already exceed main's one. There is no full second score, run-to-run quality comparison, selected-row retry, resume or overwrite. The required two-repeat measurement is incomplete.

## What source matching actually rejected

The proposed spacing/Unicode/ordering/scaling explanation was tested and falsified for the old exact affine matcher: it already accepted spaces, `≤` versus `<=`, reordered terms and constraints, variables moved to the other side, and correctly oriented positive, negative and rational scaling. Minimal stored replays instead reproduced hyphenated prose such as `half-plane` entering a math span, objective wording/delimiters, named interval literals, and source point tuples being read as scalar equations.

The bounded source reader now accepts those supported language forms while preserving every oriented affine leaf, strictness, complete Boolean program, domains and objective sense. Changing a leaf still refuses even when the final union accidentally describes the same set. Unsupported symbols or mathematical continuations, dropped operands, extra comparisons, unknown variables/targets, contradictory objectives, changed coefficients/constants, incomplete feasible-region proposals and reversed coordinate axes fail closed. This is a class-wide parser/compiler repair, with no question-ID templates, validator bypass or example-library change.

The engine independently reads exact named scalar point tuples from the original question, expands the view to contain them, and emits source point labels and membership glyphs. Proof mutations reject missing, extra, renamed or changed point givens. Planner point coordinates cannot become authority. Canonical planar axis order is `["x","y"]`; term/constraint order can vary. Mixed named-interval/explicit-inequality Boolean programs and custom/reordered coordinate mappings remain conservatively unsupported.

Full and compact planner contracts now advertise `linear_region`, require one composite operator with the correct axis arity, preserve complete original expressions/domains/objectives, and assign axes, labels, shading and solved values to the operator. Existing prompt transport limits, solver authority, selection policy, timeouts and example library of 212 entries are unchanged.

Minimal stored source replay admits **58/58** first-repeat calls versus **18/58** under the old matcher, and **48/54** second-repeat calls. The six retained source refusals omit required constraints/objectives or one half of a singleton intersection. These isolated source-contract observations are not whole-candidate validity, adoption or figure-quality scores.

## Remaining failures and detailed messages

The three first-repeat candidate-invalid empties are whole-candidate ownership violations, not equivalent-inequality mismatches. All their proposed half-plane inequalities match the original source. The fatal message is **“Linear figure marks must all be emitted by verified linear operators”**, with a construction path and `solution` entity attribution. Every candidate attempt adds standalone axes and/or points beside the verified composite; repair attempts retain separate point marks after removing axes.

| Complete first-repeat row | Original inequality | Remaining cause |
| --- | --- | --- |
| `hp06-positive-strict-membership` | `x + 2y < 6` | Extra axes/point P outside composite |
| `hp07-negative-constant-membership` | `-3x + 4y <= -12` | Extra axes/points P and Q outside composite |
| `hp10-strict-boundary-point` | `x - y > 2` | Extra axes/points A and B outside composite |
| `sys07-negative-coefficients` | Two-line system | `fallback_suppressed`; solver contradiction with `value_type_mismatch` |

The ungraded second prefix retains `hp06` with the same ownership failure. Its `nl09-union-puncture` initially supplies chained comparisons and quantity references inside an individual inequality leaf: **“A linear source clause requires exactly one comparison”** (`invalid_linear_region`). Later repairs supply the correct union/intersection AST but attach an authored solved-membership narration annotation (`1 ∉ A ∪ B.` or `1 does not belong to A ∪ B.`); the refusal is **“Linear solution values and boundary semantics must be emitted by the verified operator”** (`untrusted_linear_claim`). `sys06-cbse10-unique` is suppressed with the same solver contradiction code as `sys07`.

The next contract work should explicitly describe the composite's source-point/membership output and prohibit duplicate membership annotations; a supported independently compiled whole-source representation could address planner contract misses. Ownership must stay enforced: stripping invalid fragments or allowing authored claims would weaken the authority boundary. Solver contradictions require a separate value-binding diagnosis. The captured solver summary has status, issue codes and projection availability, but lacks the full audit message, request/quantity IDs and actual value; these cannot be reconstructed from the preserved records. No additional repair was introduced after measurement.

Lab evidence retains full candidate rejection messages, severities, paths, entity IDs, attempt/lane/pass and operator argument attribution for **all 77 new captures**: 157 rejection records, 204 errors and 447 operator references. Explicit record-cap totals, field truncations and issue/error omissions are zero. Repeated issue occurrences are not distinct rejected-row counts. The portable rejection ledger keeps these full bounded records; original raw JSON/response captures remain hash-bound locally. The [remaining-rejection audit](../../../../data/diagram-eval/v1/reports/linear-source-equivalence-20261011/remaining-rejections.md) includes every affected attempt's exact arguments and message. This does not claim full solver audit logging.

Chosen committed planner definitions in the complete first repeat used `number_line_set` 10 times, `linear_half_plane` 7, `linear_feasible_region` **10**, and `linear_system` 1, with 8 generic paths and 4 empties. Thus feasible-region adoption is **10/10**, rather than the earlier 0/3, but adoption alone does not establish completeness or correctness. The partial second prefix uses number lines 9, half-planes 9 and feasible regions 10, with 6 generic paths and 3 empties; it contains no committed `linear_system`. These counts parse the selected raw definitions without parse errors; they are not independent visual grades.

The one newly wrong candidate is `sys04-coincident-negative-scale`. Its generic `axes` + `function_curve` path is marked **`exact_verified`**, with a `function_value` proof, rather than using the new system operator. Source `-2x + 3y = 6` / `4x - 6y = -12` and curve `(2*x+6)/3` are mathematically consistent. All three blind judges marked it wrong: A/B identified placement below the visible origin, contradicting its positive y-intercept 2 and negative x-intercept; C found the common line detached with no coordinate relationship. The scalar proof does not establish the curve's displayed position relative to separately constructed axes. This is evidence of a generic coordinate-registration/proof gap, not evidence that the repaired source matcher accepted a different inequality. No candidate rejection was logged for that committed path.

## Protocol, judgment and limits

Eval SHA256 remains `7dd247caaa637b076fe32998b831b759d28d15315932843f35a9b92a3f6ebe4f`: 40 required rows, 10 each for number lines, half-planes, LPP and systems, with 20 topic and 20 exam rows. The user's authorized diagnosis/tuning makes this a repeated development/regression cohort; there is **no fresh held-out claim**. Both original MAIN figuresets are reused unchanged, with a hash-bound 351-artifact reuse manifest. Main advances elsewhere do not substitute a different comparator.

The original primary protocol and helpers remain immutable. After the repeat-2 abort, and before any final image grades were read, a new secondary freeze selected the **entire completed first pair**: 40 reused MAIN + 40 new candidate outcomes. It does not authorize primary readiness. All 75 drawn cards show the full native diagram region (x=400, y=0, width=760, height=700); only the two known lab header lines are removed. Source/build identities, arm mapping, refusals, prior grades and implementation are withheld from three fresh source-naive agents. Root views no images.

A/B/C each froze 75 first grades before unblinding, with zero recovery grades. Consensus keeps A/B agreement; complete blind C resolves disagreement; three different verdicts would be conservative wrong. A/B agreed on 72 cards, disagreed on 3, with no three-way split. Three 24-card calibration streams also froze before final grading feedback; each matches all 24 synthetic reference verdicts. That is **synthetic consistency, not human accuracy**, and no judge was selected or rewritten based on the score. Figure-only model judgments do not certify a full lecture, narration, persistence/replay, global layout, production behavior or accepted syllabus coverage.

## Verification and spend

Nonpaid checks passed: 95 source-equivalence cases, 41 source-point cases, 361 exact kernel checks, 4,015 linear public compiler checks and the general scene-engine gate. Independent review refused all 31 focused unsafe cases and classified 134 exploratory probes (120 negative refusals, 14 valid admissions). The fresh candidate passed five sequential package builds and 19 checks. Workspace typecheck/lint passed all 12 packages and sequential build passed all seven tasks. Seven native development renders were inspected only by a subagent. Existing small-default-view system label clearance remains conservative; no global layout fix or completely green broad suite is claimed. Four unrelated broader-script failures reproduced on pinned main during H3R6.

The budget guard stopped repeat 2 at conservative exposure **$12.539283** versus the frozen **$12.50** admission threshold within the **$13** incremental allowance. The independent financial audit found no demonstrated double-counting defect. Exposure consists of the reconciled first-repeat Azure anchor $4.232566, second-repeat known response usage $3.677913, unresolved allowance $3.483072, and historical reservations $1.145732. The incomplete response allowance is uncertainty, not a measured charge.

Eight fresh stable deployment-counter observations plus an agreeing later confirmation settle the **new Azure token estimate at $8.391410** (2,214,635 input tokens at $2/M and 396,214 output at $10/M; cached input priced as uncached). Prior H3R6 $16.960470 gives a **cumulative estimate of $25.351880 / $30**, with nominal estimate remainder $4.648120. These are overlapping deployment/response estimates, not invoices. Known response usage is $7.470119; unresolved allowance $7.411516 is separately retained and never added to Azure usage. Native agent/CLI billing is unexposed. The finite admission guard does not permit continuing an incomplete arm merely because the final estimate is lower.

Five stale checkpoint reservations total $1.145732 after the abrupt outer stop; they are not five live requests, confirmed dispatches or extra charges. Their ledgers remain intact. Owned APIs on 3530/3533 and the owned watcher stopped after settlement; H4's foreign port 3600 and deployment were untouched. No new paid calls were made after the abort. No selected retries, source tuning, ledger clearing or guard relaxation occurred. H4 receives the updated operator example handoff; requests through 42 remain parked outside this scope.

## Durable evidence

The [portable evidence directory](../../../../data/diagram-eval/v1/reports/linear-source-equivalence-20261011/) contains first outcomes/grades/consensus, freezes, full rejection records and arguments, adoption counts, calibration consistency, abort/spend receipts and the independent financial audit. `python3 data/diagram-eval/v1/reports/linear-source-equivalence-20261011/recount.py` verifies its hashes, complete paired denominators, consensus rule and strengthened gate without images, private context or API calls. Original absolute paths in copied records are provenance only.

| Immutable evidence | SHA256 |
| --- | --- |
| Original preregistration | `071a6c9d731768b28d2d536463a470b29ba4fc434779cb948471e0dbd408d266` |
| Preserved repeat-2 abort | `562876e8b674302b564f9ea5e1242c59a85e5349a3c5d0f57bb7acfd4b7d5722` |
| Complete first-pair secondary result | `56b0361d7d7ab43bc6074dda31e16cd679a6943ba6f9ac41b1022c16b3785671` |
| First A grades (75) | `df8b34902e9308dea1df6d8e7b37e8923a448e47d072b363fa70f47292483757` |
| First B grades (75) | `a946d1958683525246c31138bca16a4d51d7817988a69cd18810cb026f7ccbec` |
| First C grades (75) | `277f1b0ad02f05ff8fddc66b261d9708ec159af3db2472d70fe5390916664475` |
| Consensus (75) | `574f54ffe9fc505e06b516fe106ef821244d4d1d4f71eeb85576b4fc4554120d` |
| All 77 raw diagnostic captures | `7233da5beea2683637116fb17bb393d12ed4209586011c297d105a3b50bf6a0e` |

Source repair evidence and pre-dispatch red/green checks are in [the integration log](H3R7-SOURCE-EQUIVALENCE-20261011.md) and the source worker's own log. Detailed raw artifacts, native crops and immutable controls remain in `.context/h3r7/source-equivalence/`; the financial audit binds the exact 18 helpers, 44 assets and both frozen builds. **The strengthened coverage gate still fails.**
