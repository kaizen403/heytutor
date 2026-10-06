# Wave 2 teaching arithmetic admission — 6 October 2026

Disposition: **integration_pending**. This is a bounded offline arithmetic
helper, not an integrated student-path result or a topic acceptance claim.

## Assignment and baseline

- Assigned tree: `/Users/kaizen/heytutor-cov-wt/w2-teaching-arithmetic-20261006`.
- Branch: `cov/w2-teaching-arithmetic-20261006`.
- Frozen base: `a8a1e9c6d3963264a24cb139035a3f5394d00434`; tree initially clean.
- Worker: this Codex session. Sol/Luna selection is not exposed by callable
  tools in this session. No child agent, fork or Astral was used. Independent
  Sol review remains with the parent.
- Integration owner: parent coverage session; exports, live buffer, retry and
  WRITE/TTS ordering remain parent-owned.
- Assigned scope is reusable teaching arithmetic, not a syllabus topic packet.
  No ledger, denominator or topic state is changed.
- Read AGENTS, root coverage plan, topic matrix index/progress/readiness,
  continuation, wave-one report, ownership, handoff and work-log contract.
  Applied git-workflow-and-versioning and test-driven-development skills.
- Reuse audit: read unchanged
  `apps/tutor/scripts/lecture-lab/boardArithmetic.ts` and its existing
  `scripts/verify/verify-board-arithmetic.ts`. The old 2% threshold leaves the
  two stone errors unflagged; its circle checksum detection already works.
  The old checker remains unchanged and is not imported into the new runtime.

## Owned files and contract

Only these three new files are committed:

- `packages/tutor-core/src/text/teachingArithmetic.ts` — pure bounded rational
  parser, row verdicts, explicitly bound restatements and buffered admission.
- `packages/tutor-core/scripts/verify/verify-w2-teaching-arithmetic.ts` — frozen
  independent expected values plus rejection, bounds and holdout controls.
- This evidence log.

API (parent must add exports itself):

```ts
evaluateTeachingArithmetic(expression: string): TeachingArithmeticEvaluation
checkTeachingArithmeticRow(row: TeachingArithmeticRow,
  priorRows?: readonly TeachingArithmeticRow[]): TeachingArithmeticVerdict
admitTeachingArithmetic(rows: readonly TeachingArithmeticRow[],
  priorRows?: readonly TeachingArithmeticRow[]): TeachingArithmeticAdmission
```

`TeachingArithmeticRow` is a string or
`{ text: string, binding?: { scopeId: string, roleId: string } }`.
The parent supplies the binding from a known quantity and calculation scope;
model-authored labels alone are not bindings. Caller-provided prior rows must
be previously admitted rows of the same turn/step.

- `supported`: a fully evaluated numeric computation assigned to a label,
  without a further checkable equality. It supplies independent expected value
  and rational bounds; it does not prove the label's source meaning.
- `correct`: the explicit arithmetic comparisons match the documented policy.
- `false`: a proved disagreement, with `proof.row`, `left`, `right`, `relation`,
  independently computed `expected`, `expectedExact`, `expectedBounds`,
  `claimed`, and optional `roundedExpected` / `sourceRow`.
- `unsupported`: explicit abstention with reason. It never becomes a false-row
  accusation. Unsupported content is not certified by `admitted: true`.

Call `admitTeachingArithmetic` once on every complete buffered segment before
scheduling either WRITE or that segment's TTS. On `admitted: false` and
`falseRows.length > 0`, discard the entire buffer and send `retryProof` with the
model retry request. The model must regenerate narration and writing together;
do not play the rejected speech while patching ink. Oversized buffers also
return `admitted: false`, with a split-buffer reason and no invented false row.
The helper neither invokes a model nor edits text or schedules audio/ink.

## Numeric and rounding policy

All numeric literals on the LHS mean the exact printed number, not an inferred
measurement interval. Decimal/scientific RHS literals round to their printed
last place with ties away from zero. Braces, parentheses and unary signs retain
literal precision. Bare integer `=` is exact; integer `≈` permits rounding to
the integer place. No relative/percentage tolerance is used.

Independent frozen oracles:

| WRITE | Independent computation | Disposition |
| --- | --- | --- |
| `2.513^2 = 6.316` | `6315169/1000000 = 6.315169`, rounded to 3 places `6.315` | false |
| `2.513^2 = 6.315` | same exact fraction | correct |
| `6.316 / 0.8 = 7.896` | `1579/200 = 7.895` | false |
| `6.316 / 0.8 = 7.895` | same exact fraction | correct |
| `2.25+4-4.5-8+2.75 = 0` | `-7/2 = -3.5` | false |
| `1/3 ≈ 0.333` | exact `1/3`, printed quantum `.001` | correct |
| `pi ≈ 3.14` | bounded independent pi constant, quantum `.01` | correct |
| `2.51² ≈ 6.30` | `63001/10000 = 6.3001`, quantum `.01` | correct |
| `2.51² ≈ 6.32` | same computation; no implicit LHS uncertainty | false |

Supported operators: numeric addition/subtraction/multiplication/division,
signed scientific literals, integer powers with normal unary precedence and
right association, parentheses/braces, braced LaTeX fractions, Unicode powers,
and unambiguous juxtaposition. Pi uses consecutive rational decimal bounds;
interval arithmetic propagates those bounds through operators. Chains compare
every printed answer to the original computation, not a rounded intermediate.

Cross-row restatements require matching explicit scope and role, identical
labels, and a numeric computation within six rows. The latest matching binding
must be a single numeric computation; a symbolic reassignment, differing label,
already-restated/compound row, malformed row or units invalidates that lookup.
No algebraic substitution or bare-symbol matching is performed.

Limits are exported as `TEACHING_ARITHMETIC_LIMITS`: 1024 input characters,
256 tokens, 32 parser frames, 40 literal digits, scientific exponent magnitude
100, integer power magnitude 64, 256 reduced rational digits, 8 chain sides,
64 segment rows and 32 prior rows. Binding strings are capped at 128 characters.
Complexity failures abstain; oversized segment/history rejects admission for
the caller to split. No `eval`, `Function`, provider, environment key or I/O is
used by the helper.

## Exact commands and outcomes

All commands below ran in the assigned root with the following prefix for
pnpm/node (the abbreviated `PATH` below denotes exactly this shell assignment):

```sh
PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
```

Node: **v24.21.0**. Dependencies are this tree's own node_modules;
`pnpm install --frozen-lockfile --ignore-scripts` passed using pnpm10.32.0,
666 packages, no lockfile changes. No foreign node_modules was linked.

| Command after that PATH assignment | Actual outcome |
| --- | --- |
| `pnpm --filter @heytutor/tutor-core exec tsx scripts/verify/verify-w2-teaching-arithmetic.ts` | Initial red: missing new module. Later red controls caught loss of parenthesized RHS precision and inappropriate rejection of `pi≈22/7`. Final PASS: 1510 logical checks; 37 correct, 19 false, 51 unsupported frozen rows, binding/admission/immutability/serialization controls, 128 adversarial samples and 1250 bounded integer holdout/mutations. |
| `pnpm --filter @heytutor/tutor-core exec tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck src/text/teachingArithmetic.ts scripts/verify/verify-w2-teaching-arithmetic.ts` | PASS, including the new gate. |
| `pnpm --filter @heytutor/tutor-core exec eslint src/text/teachingArithmetic.ts scripts/verify/verify-w2-teaching-arithmetic.ts` | PASS, no warnings/errors in owned TS. |
| `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-board-arithmetic.ts` | PASS unchanged: 8 expressions and 16 honest rows. |
| `pnpm --filter @heytutor/tutor-core typecheck` | First attempt exit2: missing fresh-tree drawing/scene-engine declarations and cascading types. After local dependency builds: PASS. |
| `pnpm --filter '@heytutor/tutor-core^...' build` | PASS, built local drawing and scene-engine JS/declarations in dependency order. |
| `pnpm --filter @heytutor/tutor-core lint` | PASS, zero errors; existing warning `givenValueIntro.ts:453` unused `questionMentions`. |
| `pnpm --filter @heytutor/tutor-core build` | PASS ESM and declarations. Shared index intentionally excludes the new helper until parent exports it. |
| `pnpm --filter @heytutor/tutor-core exec tsup src/text/teachingArithmetic.ts --format esm --dts --out-dir dist/w2-teaching-arithmetic --clean` | PASS standalone new entry ESM and declarations, after final helper edits. Ignored local build artifacts only. |
| `git diff --check` and final `git diff --cached --check` | PASS. |

Old-checker reproduction command (same PATH):

```sh
pnpm --filter @heytutor/tutor exec tsx -e 'import {checkBoardArithmetic} from "./scripts/lecture-lab/boardArithmetic.ts"; console.log(JSON.stringify(checkBoardArithmetic(["2.513^2 = 6.316", "6.316 / 0.8 = 7.896", "2.25+4-4.5-8+2.75=0"])));'
```

Output contained **only** the circle issue, with claimed0 and actual-3.5;
neither stone row was flagged. This is offline evidence, not a new student run.

Compiled artifact smoke command (same PATH):

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { admitTeachingArithmetic } from './packages/tutor-core/dist/w2-teaching-arithmetic/teachingArithmetic.js';
const rows = Object.freeze(['2.513^2 = 6.316', '6.316 / 0.8 = 7.896', '2.25+4-4.5-8+2.75=0']);
const result = admitTeachingArithmetic(rows);
assert.equal(result.admitted, false);
assert.deepEqual(result.falseRows.map(({ proof }) => proof.expected), [6.315169, 7.895, -3.5]);
assert.doesNotThrow(() => JSON.stringify(result));
console.log('compiled ESM: 3 independent expected values and JSON proof serialization passed');
JS
```

PASS with that output. No browser, DB, server, port, remote, stash, provider or
environment-key operations were performed. Full unrelated suites were not run.

## Limitations and parent action

All unit-bearing rows, SI prefixes, conversions, comma/separator rows,
symbolic arithmetic, noninteger powers, unbraced fractions, unknown LaTeX
commands and ambiguous division/juxtaposition abstain. `pi≈22/7` and other
approximate expression answers without literal precision abstain unless exactly
equal; pi interval equality/cancellation may also abstain. Equality expression
RHS values are exact. No inferred input uncertainty or significant-figure rules
for intermediate operands are added.

The guard establishes arithmetic only. It cannot establish source correctness,
the truth of arbitrary narration, physical units, diagram correctness or which
quantity a label denotes. Parent owns exports, stable caller bindings, full
buffer coverage, retry budget/termination and atomic WRITE/TTS release. Parent
also owns independent Sol review, normal student checks and affected lifecycle.
Live reveal, saved-turn replay and provider results are **unrun** in this packet.

Local commit is authorized as Rishi Vhavle only, without coauthors. Parent can
cherry-pick the branch; publication and topic disposition remain with the parent.
