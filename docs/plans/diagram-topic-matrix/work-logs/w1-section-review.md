# w1-section-review: BLOCK

## Assignment and authority

Independent review only, 6 October 2026. Target `7443b2f91db1b6dd132159e005d4f20a40f6e3ec`, base `f459df7b53301437ba097969ca6949d47aa6ba9e`.
Worktree `/Users/kaizen/heytutor-cov-wt/w1-section-review`, branch `cov/w1-section-review-20261006`.
Topic `maths|10|section-formula`, bounded source/full ProblemIR path. Parent owns source fixes and integration; Laplace owns runtime on the landed head.

Read repo AGENTS.md, coverage plan, topic index/progress/readiness, session ownership, coordination BRIEF/CHECKPOINT, worker log and the SF1/SF3/SF4/SF5/SF6 manifest. The user's review-only scope and user-only authorship supersede the old coordination coauthor/publication instructions. No child agents, shared source changes, original gate edits, root build, full three-package suites, ports, real student, DB, ledger/count changes, stash, push, PR or remote merge.

Owned new paths were announced before edits in the conversation and coordination status: engine/app `scripts/verify/verify-w1-section-review.ts`, this work log, reviewer evidence log, and coordination `status/w1-section-review.md` / `reviews/w1-section-review.md`.

## Spec finding: P1, explicitly requested point becomes another point

**Do not adopt the patch as reviewed PASS.** In `packages/scene-engine/src/ir/sectionFormulaSource.ts:367`, the requested-name guard recognizes only lowercase `point` or `midpoint` immediately followed by the name. At lines 372–376 it then relabels the engine result from the IR, even when the question explicitly requests a different name through another ordinary wording.

Exact question:

```text
Find coordinates of Q which divides the join of A(1,2) and B(4,5) externally in the ratio 2:1.
```

The independent fixture has a **validated full ProblemIR**, points `endpointA`/A, `endpointB`/B, `answer`/R; section intent includes all three. Given expressions Ax=1, Ay=2 have the source A quote and Bx=4, By=5 have the source B quote. R references the requested fact. No special routing cue or nullIR input is used.

Observed on `7443b2f9`: normal selection `exact_verified`, source point labels A/B/R, board labels `A(1,2)`, `B(4,5)`, `R=(7,8)`. Compiled geometry is correct for external 2:1, but the certified and saved scene answers with R although the student requested Q. Live admission and canonical server save both accept. Two more cases reproduce: `Find the coordinates of Q dividing ...` and `Find Point Q which divides ...`. Lowercase `Find point Q ...` with IR R rejects. IR Q is accepted for all four spellings, so this is specifically an identity mismatch, not an unsupported numeric case.

**New regression:** identical validated fullIR wrong-name fixtures all decline in normal synthesis and app selection on `f459df7b`. They become drawable, exact and saveable on the patch. Fail closed when an explicit requested identity cannot be bound, or extend source identity reading while retaining the literal/fact/other-obligation checks. This reviewer makes no source fix.

## Standards assessment

The diff retains engine ownership, deterministic arithmetic and atomic failure. Other named-body, connection and spatial-relation obligation branches remain active; the new dimension branch checks exact IDs/roles/value/unit/fact IDs rather than numeric membership. No separate style-only blocker is reported. The P1 above also breaches AGENTS.md's complete, faithful verified-scene boundary; one correctness finding is counted once.

## Independent expected values and actual output

These fixtures are authored independently of the worker's gate. No worker fixture helpers are imported.

| Source | Independent calculation | Actual normal fullIR output |
| --- | --- | --- |
| A(1,2), B(4,5), external 2:1 | 2B−A = (7,8), t=2 | exact_verified, geometry/live/save pass |
| A(-4,5), B(11,-10), internal 2:3 | A+(2/5)(B−A) = (2,-1) | exact_verified, geometry/live/save pass |
| A(-6,4), B(2,-8), midpoint | (A+B)/2 = (-2,-2) | exact_verified, geometry/live/save pass |
| P(-2,-3), A(1,3), B(4,9), find ratio | t=-1, abs(t/(1−t))=1/2, external | exact_verified, geometry/live/save pass |

The probes invert the compiled axes to check actual world coordinates within 0.001 world units, check required/reveal membership, and inspect the actual LABEL commands offline. Plan aliases `x_A/y_A/x_B/y_B` and `x1/y1/x2/y2` pass live and canonical save for all four. JSON serialization followed by canonical server revalidation retains source facts/intents; this is a pure server check, not authenticated reopen/whole replay.

Captured SF1/SF3/SF4/SF5/SF6 each independently select exact_verified with their validated audit IR. The worker's captured fullIR engine/app gates also pass. This does not invalidate the naming adversary omitted by those gates.

Controls pass for extra Q in a separate intent, an unrepresented connection to Q, an unsupported-to-this-scene perpendicular obligation, wrong role/value, IR fact reference to the other endpoint, wrong scalar unit/role, missing named body, changed actual question, changed restored ProblemIR question, forged endpoint annotation, forged derived-point annotation and an equal-valued coordinate omitted from scene obligations. Unrelated non-section dimension matching remains active. Legacy nullIR section programs retain their zero quantities/annotations and compile on both versions. Existing section/obligation gates also remain green.

## Existing boundary gaps, not patch regressions

The obligation layer rejects forged scalar lineage and omitted equal-valued components. Pure live admission and canonical persistence do not recheck all fullIR visual obligations: changing Ax's evidenceFactIds to sourceB still compiles and saves; deleting Ay also saves while the submitted IR still requires it.

To classify causality, the **same complete head-generated submitted document** and two mutations were sent through each revision's canonical server boundary. Both `f459df7b` and `7443b2f9` accept both mutations. These are existing trust-boundary gaps, reported separately, not extra new-regression findings. The normal patched selection does enforce these obligations. The new name mismatch alone determines BLOCK.

A direct call to live admission accepts a forged derived coordinate annotation, but compiler rejection prevents that invalid document from reaching the normal live path, and canonical save rejects it. The final reviewer probe checks compile plus admission and does not count the utility-only observation as a defect. An initial probe omitted the question when resubmitting canonical metadata; the probe was corrected to supply the separately stored question. Proper JSON revalidation passes in all four cases. Neither probe mistake is reported as a product regression.

## Commands and results

Dependencies: `pnpm install --offline --frozen-lockfile --ignore-scripts`, exit 0. Per-package drawing, scene-engine and tutor-core ESM/declaration builds pass. No root or Next build.

```sh
SECTION_FULLIR_AUDIT=/Users/kaizen/heytutor-claude-coord/runtime/w1-runtime-audit/section-fullir pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w1-section-review.ts --report
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-review.ts --report
```

Reviewer report mode exits 0 to print all observations, not to assert PASS. Engine: 61 observations, 3 wrong-name failures. App: 87 observations, 9 wrong-name failures across selection/live/save, plus 3 observations of the separately classified existing boundary gaps. Both scripts exit 1 without `--report`, intentionally enforcing the unresolved rejection contract. Engine observations include the five captured cases; without the optional environment variable the primary repro and four independent supported cases remain self-contained.

| Bounded check | Result |
| --- | --- |
| Worker captured fullIR engine/app gates | pass, 6 cases and controls each |
| Engine verify-section-formula-ready | 22 checks pass |
| Engine verify-topic-section-formula | 37/37 pass |
| Engine verify-visual-obligations | 299 checks pass |
| App verify-section-formula-ready | 7 cases, 8 declines, 138 checks pass |
| App verify-live-save-parity | 6 figures, 22 checks pass |
| App verify-turn-scene-persistence | pass, offline |
| Engine typecheck | pass |
| Scoped TypeScript on both reviewer scripts and imported app/source graph | pass |
| ESLint on 3 changed engine source files and both reviewer scripts | pass |
| git diff --check | pass |

Scoped config extends apps/tutor/tsconfig.json with incremental=false, baseUrl=./apps/tutor, typeRoots=./apps/tutor/node_modules/@types, types=[node], and includes only the two reviewer scripts. Temporary config removed. Root app typecheck was not run; known `_c03-select` baseline remains outside this bounded review.

Baseline isolation: `git archive f459df7b packages/scene-engine/src` extracted into a temporary directory, the base engine package.json supplies its ESM mode, and node_modules symlinks point only to this reviewer's frozen dependencies. The independent engine script runs against those base sources. App baseline uses a temporary tsconfig preserving all app aliases as absolute paths and mapping only @heytutor/scene-engine to the archived base index. No worktree source file was swapped. App/core source is unchanged between base and patch except the worker's dedicated new gate. Initial missing ESM/alias errors were fixed in this temporary runner before collecting baseline evidence.

Raw logs: `/tmp/w1-section-review-{engine,app,engine-base,app-base,boundary-head,boundary-base}.jsonl`, build/check/strict logs under `/tmp/w1-section-review-*`. Temporary archived base path is recorded in `/tmp/w1-section-review-base-path.txt`; these are scratch, not runtime dependencies. Durable compact observations are in [w1-section-review-evidence.json](w1-section-review-evidence.json).

## Handoff and limits

Disposition **BLOCK**, integration_pending review evidence only. Repair the requested identity mismatch and rerun these dedicated probes before adoption. Parent owns familyScene/physics integration; Laplace must run the actual adopted head. Opaque expression IDs, compound given roots and fractional coordinate grammar remain the worker's declared honest gaps. No native exam bank, holdout, full-suite certification, visually inspected real student, authenticated save/reopen, whole replay, READY or FULLY-CERTIFIED claim is made. Ledger counts remain unchanged.

Committed files are only the two new reviewer scripts, this log and its compact evidence JSON, authored as Rishi Vhavle <rishivhavle21@gmail.com> without coauthors. Coordination status/review live outside the repository.
