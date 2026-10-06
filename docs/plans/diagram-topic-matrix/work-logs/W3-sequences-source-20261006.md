# Wave 3 bounded progression source admission — Sol lane, 6 October 2026

Disposition: **integration_pending; packet READY=0, accepted=0**. No ledger,
counter, readiness, shared operator, compiler, document contract, catalog,
capability, index/export, synthesis or application edits. Parent owns wiring
and student/lifecycle evidence. Chemistry excluded; Sol/Luna only, no Astral,
subagents or forks. Parent's Wave 2 blockers were not duplicated.

Worktree `/Users/kaizen/heytutor-cov-wt/w3-sequences-20261006`, branch
`cov/w3-sequences-20261006`, base
`192e78c86737da9951597de575fa5d3452ba0d42`. Commit author Rishi Vhavle
`rishivhavle21@gmail.com`; hooks disabled using `core.hooksPath=/dev/null`.

Read: AGENTS, coverage plan, topic index/progress/readiness, session ownership,
coordination `reviews/wave3-preflight-20261006.md`, and
`integration/wave3-native-cases-20261006.json` plus its notes. This is a bounded
candidate for `maths|6|arithmetic-and-geometric-progressions`,
`maths|6|geometric-progression`, `maths|6|sum-of-ap-and-gp`, and exact rational
insertion/recovery controls. It closes no complete topic row.

## Measured gap and reuse

At the pin, `indexedProgressionGeometry.ts` already evaluates exact AP/GP
terms, observations, recovery and rational real sign branches, with discrete
nonmetric table primitives. `finiteProgressionSets.ts` already implements
bounded integer AP sets and exact CRT. Neither module is edited or duplicated.
The new reader delegates terms/roots to the former and finite ordinal-domain
intersection/cardinality to the latter. Only exact rational aggregation for
finite sums and an AP-difference cumulative sequence is added.

The five admitted authored sources generate full documents, retain all actual
IR arrays and run through the standard local deterministic solver. Their
documents fail the pinned shared compiler with **`unsupported_operator`**:
the existing progression operator is not registered there. That is a measured
normal-path gap, not an offline exact scene certification. No metadata flag,
fixture ID, topic router, question template, numeric default, special compiler
waiver or partial-scene bypass was added.

## Owned files

- `packages/scene-engine/src/math/finiteProgressionSource.ts`: complete bounded
  source grammar, evidence/roles/asks, existing-operator delegation and exact
  finite aggregation; declines incomplete/unsupported source clauses.
- `packages/scene-engine/src/ir/finiteProgressionSourceProgram.ts`: actual
  ProblemIR validation/preservation, structural AST and constraint/role audit,
  actual TurnPlan binding, source-generated document, identical source proof
  for compile/live/save/read/restore, delegated table ink with source names and
  actual requested quantity IDs/units.
- `packages/scene-engine/scripts/verify/verify-w3-progression-source.ts`:
  standalone independent gate, not imported by another session's gate.
- `packages/scene-engine/scripts/verify/fixtures/w3-progression-source/authored-cases.json`:
  five explicitly authored sources, complete typed IR and plan, independent
  expected results. The native-related readable input is labeled an authored
  faithful transcription, never native.
- `packages/scene-engine/scripts/verify/fixtures/w3-progression-source/native-sources.json`:
  three verbatim sequence records from the supplied native manifest, including
  unchanged OCR/options, PDF/text provenance and hashes. Existing raw PDFs/text
  sources are untouched. All three question-block SHA-256 checks pass.
- This evidence log.

## Independent cases and numeric correction

| Authored source | Independent result |
| --- | --- |
| AP first 3, difference -2, indices 1..4 | 3, 1, -1, -3 |
| GP first 2, ratio -2, indices 1..4, finite sum | 2, -4, 8, -16; sum -10 |
| GP first 2, ratio 1, sums at 4 and 0 | 8 and 0 |
| AP differences a1=7, d=8; T1=3; T(n+1)-Tn=a_n | T20=1504, sum20=10510, T30=3454, sum30=35615 |
| One geometric mean between 2 and 8, all real branches | +4 and -4; both satisfy the endpoint product identity |

The supplied native 2022 Paper 1 Q10 block asks which options are true. Its
original A=1604 and D=35610 remain verbatim in the raw artifact, but are **false**
under the stated recurrence. B=10510 and C=3454 are true. Independent integer
enumeration uses `t=3, a=7, sum=0`, then for each n records t and adds it to sum,
updates `t += a`, `a += 8`. A separate Python direct recurrence produced
`20 1504 10510` and `30 3454 35615`. The requested A/D numbers cannot be
certified merely because they are printed in a multiple-choice source.

Controls include full actual signed observation recovery with every observation
retained; inconsistent observations; distant AP recovery/sum; exact fractions;
zero difference/ratio; alternating ratio and maximum index 64; empty sums;
small nonzero decimals versus stale zero; both real insertion branches; omitted
branches; nonrational roots; missing coefficients; extra clauses and continuum
requests; noninteger/out-of-bound indices. Full-IR controls reject extra bodies,
expressions, unsupported constraints/graph intents, wrong entity evidence,
reversed recurrence, strict/equality mutations of the source index domain,
forged quotes/spans, missing requests, invented plan IDs,
wrong units/symbols and same-answer replacement ASTs. Payload controls reject
changed marks/labels/quantities, required/reveal/timeline omissions and stored
IR forgery. JSON round-trip and JSONB key reordering pass the same proof.

## Exact checks and stdout

All commands ran only in the assigned worktree, with Node **v24.21.0** and
pnpm **10.32.0**, prefixing PATH with
`/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin`.

| Command | Actual result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | Own dependencies; 666 packages, downloaded 0; lockfile unchanged |
| `pnpm --filter @heytutor/drawing build` | ESM and DTS success, required local prerequisite |
| `pnpm --filter @heytutor/scene-engine build` | ESM and DTS success |
| `pnpm --filter @heytutor/scene-engine exec tsup src/ir/finiteProgressionSourceProgram.ts src/math/finiteProgressionSource.ts --format esm --dts --out-dir /tmp/w3-sequences-owned-build` | Both new entrypoints build with declarations; parent index/export remains untouched |
| `pnpm --filter @heytutor/scene-engine typecheck` | `tsc --noEmit`, no diagnostics |
| `pnpm --filter @heytutor/scene-engine lint` | 0 errors, four warnings in untouched DSA simulator files |
| `pnpm --filter @heytutor/scene-engine exec eslint src/ir/finiteProgressionSourceProgram.ts src/math/finiteProgressionSource.ts scripts/verify/verify-w3-progression-source.ts` | No output, no diagnostics |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-progression-source.ts` | Five authored source cases, **250 checks**; shared compiler `unsupported_operator`; READY=0 accepted=0 |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-indexed-progression-operators.ts` | **9290** checks, actual stdout identical to pre-edit baseline |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-finite-progression-sets-hey84.ts` | **848025** checks, actual stdout identical to pre-edit baseline |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-problem-ir.ts` | `problem-ir and local deterministic solver verification passed`; identical stdout after local drawing prerequisite was built |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-scene-engine.ts` | `scene-engine verification passed` |

Shared gate stdout was compared as bytes, not exit status. SHA-256 receipts:

- Indexed: `7c9ac0f424cb8722d40ddbc4d10f18e9a26b69c35d5f72d0cf64323be99ce5b7`.
- Sets: `089c1e2494c9fb662e0e3723ccb23135bc65dec3e8ba20e44e732e4f18930d08`.
- IR/local solver: `3193767a4af4acb107bdb81ca2da870a8917596cd730a6c9c53aaa0854a96b9f`.

An initial IR gate before building this worktree's drawing package failed with
`ERR_MODULE_NOT_FOUND` for its local drawing `dist/index.js`; building the own
dependency resolved it. No copied dependencies, environment/provider/DB,
browser, remote, main or stash operations were used. No repository-wide tutor
build, authenticated student run, live narration/WRITE/reveal, saved lecture,
server/DB restart, fresh reopen or whole replay was run.

## Parent wiring APIs

Import from the two new modules (parent owns public exports/registration).

1. `readFiniteProgressionSource(question)` returns `ok/source` or a conservative
   `declined/reason`. It reads the complete source; no planner coefficients or
   fixture/catalog metadata are authoritative.
2. `finiteProgressionSourceProgram(question, actualProblemIR, actualTurnPlan,
   {origin, displayScale})` returns `ok` with the preserved full actual IR/plan,
   source-derived bindings and candidate `document`, or declines atomically.
   Placement is engine configuration; it is not a source coefficient. Exact
   binding results supply actual request/quantity IDs, symbols, units and values.
3. `validateFiniteProgressionSourceDocument(document, trustedQuestion,
   actualProblemIR, actualTurnPlan, placement)` returns fatal issues or `[]`.
   Invoke this same proof at admission/compile, live, save, read and restore.
   It regenerates and compares the complete mathematical document, including
   required/reveal obligations, using externally trusted source/IR/plan. Do not
   obtain trust by passing the document's self-declared metadata back to it.
4. `finiteProgressionSourceTablePrimitives(document, trustedQuestion,
   actualProblemIR, actualTurnPlan, placement)` runs the source proof and reuses
   `indexedProgressionPrimitives`; it retains the actual source sequence name
   and attaches actual quantity IDs/units to requested indexed-value ink.
   Parent still uses the normal compiler's point/label path for result summaries.

Parent must register the **existing** progression operators/kind/renderer and
their existing structural validator, add full-IR source selection/admission
and this source proof at all trust boundaries, run standard solve authority,
compile/proof/layout and commit atomically, then narrate/WRITE/reveal. Cached
render payload authority is a parent lifecycle responsibility, not established
by this document proof. Raw multi-option native admission needs its own honest
source/ask handling, not a native-ID exemption or an OCR relabeling.

## Remaining scope and acceptance gaps

- Normal compiler/live path and public exports are not wired in this worker.
  None of the five is TOPIC-READY before parent/student review. No acceptance
  counter or full topic row changes.
- The reader supports a complete explicit bounded grammar: named `a_n`-style
  progression declaration/first/parameter and `Find` indexed terms or finite
  `sum_{k=1}^N` asks; exact observation recovery; bounded mean insertion with
  explicit sign policy; AP-difference cumulative recurrence. It does not claim
  arbitrary prose, LaTeX/OCR rewriting, source option truth classification or
  alternative algebraically equivalent AST normal forms. Source spelling and
  actual role evidence are preserved; unmatched clauses decline.
- Raw native sources: **0/3 admitted**, all three preserved as native obligations.
  Q10's separately labeled readable transcription is supported; the two mixed
  AP/GP native questions remain outside this bounded solver. No bank/native
  coverage gain is claimed.
- Indices are integral, terms 1..64, sums 0..64; at most 16 asks/visible table
  indices and existing insertion/observation/precision bounds. All declared
  real branches must be requested. Additional recovery observation capacity,
  model-specific special property asks, insertion beyond existing bounds and
  algebraic root/irrational branches remain unsupported.
- Infinite-GP convergence/divergence inference, arithmetico-geometric/mixed
  solving, general special sums, AM-GM/property solving, irrational coefficients
  or indices, and noninteger indices are explicit gaps. Ratio ±1 or magnitude
  above 1 is admitted only for bounded finite requests; it never certifies an
  infinite sum.
- Actual units must be explicitly dimensionless; given quantities need exact
  source-role text, all requested quantities need one-to-one actual result
  bindings. Uncovered actual entities/facts/expressions/constraints/intents,
  plan assumptions/qualitative claims and extra unknowns decline, rather than
  projecting the submitted IR to a smaller private schema.
- Student render including source names/labels, narration and work-area WRITE,
  normal reveal, source-specific persistent payload, authenticated save/restart/
  fresh reopen and whole replay remain unrun and parent-owned. No separate
  infrastructure lifecycle acceptance or visual inspection is inferred from
  JSON round-trip or offline table primitive checks.
