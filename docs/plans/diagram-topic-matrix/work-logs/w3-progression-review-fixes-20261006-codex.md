# W3 progression review fixes / 20261006-codex

Worker: Codex, this session; no subagents or forks. Integration disposition is pending owner review. No topic or chapter counter is changed.

Worktree: `/Users/kaizen/heytutor-cov-wt/w3-progression-review-fix-20261006`.
Base: `74824e9643030bd4f8ca596e43b2fa489bbba448` (progression integration plus staged measurement layer). Date: 2026-10-06.

The owner requested only R1/P1 and R2/P2 from `/Users/kaizen/heytutor-claude-coord/reviews/w3-progression-final-20261006/report.md`. Read AGENTS, coverage plan, topic index/progress and session ownership before editing. Announced the new verify path before its first edit. No old verify gate was edited or imported into the new gate.

Owned changes:

- `packages/scene-engine/src/ir/finiteProgressionSourceProgram.ts`
- `packages/scene-engine/scripts/verify/verify-w3-progression-review-fixes.ts`
- This unique worklog.

The optional math source helper was unnecessary. No compiler, core, app, binomial, measurement, solver, sourceQuantity, ledger, main, remote, environment file, provider, database, browser or stash modification/action was made. Existing measurement files belong to the base. The author for publication is Rishi Vhavle <rishivhavle21@gmail.com>; commit hooks are disabled for this explicit owned-file commit.

## Behavior and independent evidence

R1 binds each asserted fact statement to complete roles from the bounded source reader. Given quotes require whole role boundaries; supported paraphrases retain all explicit role text (`Given …`, `x_n is an arithmetic progression with …`). Requested statements may use Find/Compute/Evaluate and a complete list of supported ask tokens. Neither extra prose nor an equal numeric answer proves a premise. Semantic role coverage replaces raw evidence containment in entity/equation/expression/request dependencies. Every dependency in those groups must support the audited role, and every full-IR fact must participate in such a proved dependency; adding a fact only to an intent does not establish use. The caller's entire validated IR and Plan survive unchanged as data.

The new gate uses the review's independently authored external caller profiles with elementary AP/GP ASTs, equations, givens, quantity/request IDs and resolved same-ID unknown/derived Plan values. It never builds IR/Plan/expected answers with the production reader, program, geometry or solver. Frozen native fixtures are used only for raw-byte checks and honest declines.

Exact R1 question: `Let x_n be an arithmetic progression with x_1 = -4 and common difference 2. Find x_3, sum_{k=1}^4 x_k, sum_{k=1}^0 x_k.` Mutations independently set the model statement to `The common difference is 99, not 2.`, ask0 to `Find x_3 and prove convergence of the infinite series.`, or append `All terms are strictly positive and the common difference is 99.` as an unused given with original model evidence. Each attempts candidate regeneration from the mutated actual IR/unchanged external Plan. Each declines in admission and family; compiler/document admission and central/read/restore guards reject a payload holding the same mutated caller profile, returning zero ink.

Additional controls cover unused true quotes, intent-only padding, same-answer AST substitution, wrong role under a broad quote, equation dependency padding, an extra premise after a valid clause, equal-zero role substitution, clipped source quotes and branch swaps. Legitimate whole given quotes, broad requested evidence, one whole requested sentence for three asks and bounded role-preserving paraphrases remain admitted. Independent coherent AP zero/empty sum, zero-ratio GP, AP recovery and AP insertion callers compile, retain bindings and pass roundtrip authority checks.

R2 question: `Insert 3 geometric means between 2 and 32, using all_real ratio branches. Find sum_{k=1}^5 a_k[positive], sum_{k=1}^5 a_k[negative].`

Independent enumerations: positive `2,4,8,16,32` sums to 62; negative `2,-4,8,-16,32` sums to 22. Visible labels are `S_5(a;r>0)=62` and `S_5(a;r<0)=22`. Both are 13 characters. Ordinary compiler font is 24px (at least 19); the gate checks font, 1200×700 viewport/400–1160 diagram zone and pairwise handwriting ink clearance. Quantity IDs `answer0/answer1`, request IDs `request0/request1`, external Plan symbols and original source symbols remain unchanged. Single-branch sums preserve their existing notation.

An external harness also reads the review's original complete JSON caller profiles directly (not these test builders): `exact-review-boundaries.mjs`. On the independently built base all three regenerated R1 mutations compile with 11 primitives and exact family tier; on the fix they decline and emit zero primitives. Head source TS and public ESM structured JSON are byte-identical. The original R2 IDs/symbols are unchanged across base/head.

## Commands and output comparison

Own head and tracked-source base extraction each installed with:

```sh
export PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
node --version  # v24.21.0
pnpm --version  # 10.32.0
pnpm install --offline --frozen-lockfile --ignore-scripts
pnpm --filter @heytutor/drawing build
pnpm --filter @heytutor/scene-engine build
```

Both installs added 666 packages with zero downloads. No dependency or build artifact was copied. ESM and DTS builds passed. Head `pnpm typecheck` and `pnpm exec eslint src/ir/finiteProgressionSourceProgram.ts scripts/verify/verify-w3-progression-review-fixes.ts` passed. `git diff --check` passed. The new gate also passes standalone strict TypeScript checking using the Node ambient definitions from this tree’s frozen install: `pnpm exec tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --strict --skipLibCheck --allowImportingTsExtensions --types node --typeRoots ../../node_modules/.pnpm/@types+node@22.20.0/node_modules/@types scripts/verify/verify-w3-progression-review-fixes.ts`. The initial standalone command lacked Node ambient types; no package manifest was changed to address that tooling configuration.

New gate commands (from packages/scene-engine):

```sh
pnpm exec tsx scripts/verify/verify-w3-progression-review-fixes.ts
node --experimental-strip-types scripts/verify/verify-w3-progression-review-fixes.ts --esm
```

Both pass 1,552 checks with byte-identical stdout. The second is plain Node loading the freshly built public ESM bundle; it does not load a TS engine or old gate.

Base/head old-source outputs were compared, not merely exit codes. Exact commands and stdout/stderr receipts: `/Users/kaizen/heytutor-claude-coord/reviews/w3-progression-fixes-20261006/run-gates.mjs`, `final-checks.mjs`, `output/gate-receipts.json`. Checks 2286/301/9290/848025 and core/ProblemIR retain identical source output bytes. The old 260-check source gate is red on head for the R1 reason below.

| Check | Base/head exit | Head output SHA-256 | Comparison |
| --- | --- | --- | --- |
| review-ts | — / 0 | `e10b0a917d4148417109aa6802477bf5306c417f5a0f946cb44309984a4e4d06` | head-only |
| review-esm | — / 0 | `e10b0a917d4148417109aa6802477bf5306c417f5a0f946cb44309984a4e4d06` | head-only |
| integration-ts | 0 / 0 | `96e1415e3a4defd556255d9bc3209dfa4022dff436a70f9a5019b9aa2aa4b177` | identical stdout bytes |
| integration-esm | 0 / 0 | `4c4803690579a7cdf73f5fa67d2ead6f238542bf1ee3e4783c27ee408c6fb4dd` | identical stdout bytes |
| indexed | 0 / 0 | `7c9ac0f424cb8722d40ddbc4d10f18e9a26b69c35d5f72d0cf64323be99ce5b7` | identical stdout bytes |
| sets | 0 / 0 | `089c1e2494c9fb662e0e3723ccb23135bc65dec3e8ba20e44e732e4f18930d08` | identical stdout bytes |
| source | 0 / 1 | `5d73a553b9c24f67c1802933d07599c06cb7d2f5733c3ea447285740a8a735b5` | different outputs; see source failure below |
| problem-ir | 0 / 0 | `3193767a4af4acb107bdb81ca2da870a8917596cd730a6c9c53aaa0854a96b9f` | identical stdout bytes |
| scene | 0 / 0 | `8fb3dcb001c0bfdd32c30695667685116bb9c54476afc7b1d08261cbd8f3e2ea` | identical stdout bytes |
| family | 1 / 1 | `8f72c0fbcc2e71af0234076af43ad30950d8449487dfe690e3c9157def9ccce6` | path-normalized identical failure |

The old source gate's five primary authored cases print identical answers on base/head. Base finishes 260 checks. Head stops at line 171: its recovery test changes question/evidence from the signed AP to a GP recovery but retains the old AP fact statements (including old requested tokens). The new audit correctly refuses that inconsistent complete IR. This gate is unchanged, and no output-identity/pass claim is made for it. The new gate has a coherent external recovery profile. Later old-gate tiny-AP shorthand is outside the explicit statement grammar; arbitrary contextual shorthand is not silently promoted to a complete asserted premise.

The family gate fails at `thin lens topic figure must compile` on both revisions; replacing the respective absolute checkout roots with `<TREE>` makes their entire outputs identical. Raw output hashes differ due to paths.

## Preserved gaps and frozen source

The independent combined positive GP profile (`a_2[positive]`, `a_2[negative]`, both branch sums for three inserted means) remains admitted but fails normal compilation with the original `result_0/result_1` pinned overlap. Family is null and returned renderScene is null. Its complete issue array is identical to base; the worker fix does not resolve or worsen this profile's overlap. Compiler stats count 45 internal candidate primitives even on failure; returned ink is zero. This is tested explicitly as a coverage gap, not counted as a positive verified scene. No layout/scale waiver or compiler change was added.

All three raw native blocks and their stored hashes remain unchanged and declined. Frozen 2019 OCR remains a declared gap; no transcription is counted as native admission. The current tracked manifest includes the separately identified readable 2022 recurrence block; its independent values remain T20=1504, sum20=10510, T30=3454, sum30=35615. False printed values 1604/35610 cannot authorize actual Plan results. A separate direct recurrence in the new gate reconfirms T20 and sum30.

Parent Plan propagation, solver/sourceQuantity/cached-payload integration, authenticated save/restart/reopen/replay and actual student narration/WRITE/FOCUS/reveal are outside this offline review-fix scope. General natural language/OCR, unproved equivalent statement/AST forms, infinite sums/convergence, arbitrary long-label capacity and mixed AP/GP solving remain unclaimed.

| Exact topic ID | Bounded evidence | Proposed state | Remaining obligations |
| --- | --- | --- | --- |
| maths\|6\|arithmetic-and-geometric-progressions | complete AP role statements, signed/zero/empty source asks | integration_pending | native/OCR and parent/live/persistence/replay |
| maths\|6\|geometric-progression | zero ratio and signed real branches | integration_pending | remaining full topic variants and lifecycle |
| maths\|6\|sum-of-ap-and-gp | finite partial sums, branch labels, empty sum | integration_pending | whole topic audit and lifecycle |
| maths\|6\|insertion-of-means | independently inserted AP/GP means | integration_pending | combined GP pinned overlap and remaining variants/lifecycle |

This bounded fix does not change the chapter denominator (10) or accept any topic. Infinite GP and mixed AP/GP rows are not closed. Integration owner should review the two product/gate files, the intentional old source-gate incompatibility and the unchanged layout gap before reconciling their own evidence; ledgers are untouched.

## File and artifact hashes

- Product file SHA-256: `ab8fcdd06a8a7c2debbb5febec847b8506351128e3e04878f96466833dc4c9ca`.
- New gate SHA-256: `be56b70cccbb8606d3f734e8474dc4af8c1573348b7ec4f7b8f1d01340174b89`.
- Unchanged lockfile, base/head exact bytes: `a2f9c3fffb1ea3d1cfb646808820afaf9ef807e092bee11bf4acfd5f48cd5427`.
- Unchanged native manifest, base/head exact bytes: `75366995db6042ff810b77c83d63ba0deb6e4620873cf7dc3794b63947f0316f`.
- New TS/ESM stdout: `e10b0a917d4148417109aa6802477bf5306c417f5a0f946cb44309984a4e4d06`.
- Exact review base ESM JSON: `8079fa79ad2592f778037385d076f22cefc233b8dccb62433481e8fdc5b08c7c`.
- Exact review head TS/ESM JSON: `ec81262e9ae958099271ac8001875ed7ed3cfcadd8c3a847e89cdbfd2dc5e871`.

Publication: explicit owned-file commit authorized by the user; final commit hash and this log's file hash are recorded in the external fix report after committing. No push.
