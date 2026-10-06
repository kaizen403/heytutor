# w1-section-fullir: bounded normal ProblemIR source repair

## Assignment and source contract

Worker: w1-section-fullir. Integration and runtime acceptance belong to the parent and Laplace.
Worktree: `/Users/kaizen/heytutor-cov-wt/w1-section-fullir`.
Branch: `cov/w1-section-fullir-20261006`. Reviewed base: `f459df7b`.
Date: 6 October 2026. Topic: `maths|10|section-formula`, JEE Main/Advanced coordinate geometry, bounded authored source contract plus the five captured audit cases. No native-bank or complete topic certification is claimed.

Read AGENTS.md, DIAGRAM_ENGINE_COVERAGE_PLAN.md, matrix index/progress/readiness, session-ownership, and coordination BRIEF.md/CHECKPOINT.md before implementation. The user's user-only authorship and bounded work instructions supersede the older BRIEF coauthor policy and publication instructions.

Fresh inputs: `/Users/kaizen/heytutor-claude-coord/runtime/w1-runtime-audit/section-fullir/manifest.json`, SF1/SF3/SF4/SF5/SF6 ProblemIR, source documents and missing-obligation records. All five actual IRs validate. On the base, normal synthesis returned null for all five. Source programs already compiled but did not satisfy A/B/P identity or Ax/Ay/Bx/By dimensions. The independent internal 3:2 fullIR case also declined on the base.

## Changed files and authority

- `packages/scene-engine/src/ir/sectionFormulaSource.ts`: accepts an optional validated full ProblemIR, binds the three point identities, anchors source coordinate annotations on those points, and carries only given literal scalars whose semantic roles, values and quoted coordinate evidence agree with the source. The anonymous requested result may take the single requested point's name, including P for an unnamed midpoint. Explicit source names cannot be changed. Section, graph and conceptual intents describing the same three source points are supported. No facts or intents are removed.
- `packages/scene-engine/src/synthesize/familyScene.ts`: passes the full IR to the source program and declines atomically when its binding fails. Existing demand and every visual obligation check remain active.
- `packages/scene-engine/src/synthesize/visualObligations.ts`: a readable section program checks dimension expression ID, source coordinate/ratio role, value, absence of a dimensional coordinate unit, and fact lineage. Equal numeric values cannot cover another dimension. Other programs retain the existing matcher. Named-body, connection, spatial-relation, required-entity and reveal checks are unchanged.
- `packages/scene-engine/scripts/verify/verify-w1-section-fullir.ts`: dedicated source, obligation, mutation and compatibility controls.
- `apps/tutor/scripts/verify/verify-w1-section-fullir.ts`: normal capability inference, representation selection, compiled board coordinates, live admission, canonical save and JSON/source lineage checks.
- This work log. Coordination status is outside the repository.

The three shared engine paths and both dedicated verification paths were announced before their first edits in the conversation and `coord/status/w1-section-fullir.md`. No app admission/persistence, compiler, label matcher, operator, ledger, count, root build, port or remote changes were made.

Anonymous nullIR source documents retain their original quantities, annotations and labels. Explicitly named requests now use their actual source name, as documented in the corrective review section below. Explicit controls also preserve old semantic scalar spellings such as Ax and an empty unit. Existing scalar correction logic is unchanged. It still corrects stale planner coordinates/ratios before narration. Source proof checks additionally reject forged coordinate-role scalars, swapped endpoint identities and contradictory endpoint coordinate annotations.

## Independent oracle and observed outcomes

| Case | Independently expected point | Directed parameter t | Expected AP/PB | Normal fullIR result |
| --- | --- | --- | --- | --- |
| SF1: A(2,3), B(8,9), internal 1:2 | (4,5) | 1/3 | 1/2 | exact_verified |
| SF3: A(1,2), B(4,5), external 2:1 | (7,8) | 2 | 2 | exact_verified |
| SF4: A(-2,4), B(6,-8), midpoint | (2,-2) | 1/2 | 1 | exact_verified |
| SF5: stated P(4,5), A(2,3), B(8,9) | (4,5) | 1/3 | 1/2 | exact_verified |
| SF6: stated P(1,1), A(2,3), B(5,9) | (1,1) | -1/3 | 1/4 | exact_verified |
| Independent internal 3:2: A(-3,7), B(7,-8) | (3,-2) | 3/5 | 3/2 | exact_verified |

The independent construction uses P=A+t(B-A), with t=3/5 giving (-3,7)+(6,-9)=(3,-2). External 2:1 gives 2B-A=(7,8). App checks compare the actual compiled pixel points with these fixed world oracles through the drawn axes, check board bounds and coordinate LABEL commands, and retain required/reveal membership.

All six cases pass normal selection and live admission, both with native IR-derived planner IDs and with independent planner aliases `x_A/y_A/x_B/y_B` and `x1/y1/x2/y2`. Canonical server save recomputes the solver result and retains all ProblemIR facts/intents and quantity lineage. Aliased plans pass the same save boundary. `engineDerivedValues` is unchanged and still regenerates without ProblemIR; genuine source quantities pass the existing source-plan agreement. Forged endpoint coordinates are rejected live and by canonical save. Stale derived values are corrected by the existing source authority to the independent answers.

Negative controls include missing/renamed A/B/P; each missing coordinate dimension; equal-valued Ax/Ay with Ay removed; role swaps even when the wrong value is another source number; unsupported extra scalar with an existing source value; extra required Q; unsupported spatial relation; wrong body kind; evidence quoting only the ratio for an endpoint coordinate; forged units/lineage; swapped endpoint names; forged endpoint/derived coordinate annotations; moved source coordinates; external 1:1; inconsistent stated P; signed ratios. No residual supported obligation is exempted.

## Verification commands and results

All commands ran in the assigned worktree with offline frozen dependencies (`pnpm install --offline --frozen-lockfile --ignore-scripts`, exit 0). New scripts also run from their committed self-contained fullIR fixtures. `SECTION_FULLIR_AUDIT` only selects the captured JSON input files; no engine input cue, flag or nullIR shortcut is used.

| Command | Observed result |
| --- | --- |
| `SECTION_FULLIR_AUDIT=/Users/kaizen/heytutor-claude-coord/runtime/w1-runtime-audit/section-fullir pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w1-section-fullir.ts` | 6 normal cases and source/body/dimension controls pass |
| Same environment, `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-fullir.ts` | 6 captured/independent cases, planner aliases, graph/conceptual variants, canonical save, and 11 decline controls pass |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-section-formula-ready.ts` | 22 checks pass |
| `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-section-formula-ready.ts` | 7 cases, 8 declines, 138 checks pass |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-topic-section-formula.ts` | 37/37 pass, 0 gaps in that existing gate |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-visual-obligations.ts` | 299 checks pass |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-family-synthesis.ts` | pass |
| `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-live-save-parity.ts` | 6 figures, 22 checks pass |
| `pnpm --filter @heytutor/scene-engine typecheck` | pass |
| `pnpm exec tsc -p .w1-section-fullir.tsconfig.json --noEmit` | scoped source/script/imported app graph passes; temporary config removed before commit |
| Engine `eslint` on the three changed src files and its new script; app `eslint` on its new script | pass |
| Per-package `pnpm --filter @heytutor/drawing build`, scene-engine build, tutor-core build | ESM and declaration builds pass |
| `git diff --check` | pass |

Scoped TypeScript config extends `apps/tutor/tsconfig.json`, sets `incremental:false`, `baseUrl:./apps/tutor`, `typeRoots:[./apps/tutor/node_modules/@types]`, `types:[node]`, and includes only the two new scripts plus their imported source graph. No root build or app production build ran.

Local logs are `/tmp/w1-section-fullir-{engine,app,engine22,app138,topic37,obligations,family,live-save-parity,engine-tsc,scoped-tsc,engine-lint,app-lint,drawing-build,engine-build,core-build,install}.log`. They are scratch evidence, not runtime dependencies.

## Scope and honest gaps

Supported fullIR input: named decimal-coordinate endpoints, one consistent internal/external/midpoint or ratio-reading source, exactly three point identities in the chosen section/graph/conceptual intent, and given literal scalar IDs encoding their source role (Ax, A_x, xA, x_A and analogous named-point forms). The stated ratio may bind m/n roles. Point givens bind only when that point is actually stated. The audit's unitless coordinate meaning and fact IDs/quotes persist; invented dimensional units reject.

- **Opaque expression IDs such as expr1 are an explicit gap.** A full-question quote containing multiple coordinate roles cannot establish which role such an ID means. The program refuses instead of matching a number that happens to occur in the source. Narrower opaque-ID evidence is also outside this packet's contract.
- **Compound given roots, including binary division, decline explicitly.** Controls include correct 4/2 versus source Ax=2, contradictory 6/2, and correct 1/2 versus source Ax=0.5. No fact is silently skipped to admit such cases. The current generic derivation obligates bare number/constant roots, although its exported constant evaluator supports AST arithmetic; this packet does not weaken or broaden that derivation.
- Fractional coordinate syntax such as A(1/2,2), symbolic/missing/extra coordinates, missing source point roles, longer coordinate labels and other pre-existing reader limits remain outside the fullIR contract. Existing nullIR support and gates remain compatible.
- No student run, visual browser inspection, authenticated DB save/reopen or whole replay was run. Canonical save evidence above is a pure offline server check, not that lifecycle.
- No full scene-engine suite, native bank or holdout certification is claimed. Parent owns shared familyScene integration and collateral acceptance; Laplace runs the actual landed head.

## Per-topic outcome and handoff

| Topic | Disposition | Remaining |
| --- | --- | --- |
| maths\|10\|section-formula | integration_pending; bounded source-path repair, no READY claim | Parent review/integration; real student render and lifecycle on the landed head; opaque expression roles and compound given roots remain honest gaps |

User-only local commit requested. No push, PR, remote merge, stash, root build, ports, child workers, ledger or accepted/READY count changes. Integration-owner disposition is pending and this log does not certify the full topic.

## Corrective review: explicit requested-point identity

Resumed on clean `7443b2f9` after Sagan's finalized BLOCK, evidence commit `bec1a065bf47b6a1d6bbbcbb3dc654ddaacae42e`. Read the final coordination review and both independent strict scripts before editing. The initial patch incorrectly accepted IR result R for actual requested Q in three source forms: `Find coordinates of Q which divides...`, `Find the coordinates of Q dividing...`, and `Find Point Q which divides...`. Matching numbers (7,8) do not establish point identity. The lowercase `Find point Q...` control already declined R.

The corrective diff touches only `ir/sectionFormulaSource.ts`, the two owned `verify-w1-section-fullir.ts` scripts, and this log. The existing shared familyScene/visualObligations changes from 7443b2f9 are untouched. Coordination status remains in the previously authorized worker status path; reviewer gates are untouched.

The source reader now captures the named requested-point or dividing-subject role with an exact quote and offsets in the actual question, independently of the IR's name. Prose casing and whitespace do not change identity. A named stated divider also supplies a source witness. Conflicting names, a requested endpoint, or a free point identifier whose role cannot be read decline honestly. Only an anonymous source request can take the IR's result name. No fullIR facts/intents or residual obligations are removed, and no scalar role, unit or lineage checks are relaxed.

The same freshly read source witness checks submitted result entity labels and anchored coordinate annotations at the existing TurnPlan scene-proof boundary. Source-name failures also reject before the generic fallback for other section uses; an unreadable named request cannot submit an anonymously named result. Renaming Q to R in the entity, annotation, or both rejects even when R's coordinates remain the correct (7,8). Wrong Q coordinates reject too. Forged source-name metadata does not affect the witness. Correct Q passes normal section/graph/conceptual selection, compiled board coordinates, aliased live/save admission, canonical save and JSON revalidation. Anonymous IR result R remains allowed. Anonymous nullIR documents and their original scalar spellings still pass existing gates; named Q nullIR documents use Q and retain empty quantities/annotations.

Identity is bound before a mismatched fullIR can produce a section document for compilation. Submitted mutation checks assert the actual compile-plus-live path rejects and canonical save/JSON revalidation refuse the document. The generic low-level geometry compiler is unchanged: a mathematically correct tuple alone does not certify its source identity, which the source-program and admission proof boundaries enforce.

### Corrective checks

Sagan's committed scripts were executed from scratch copies in `/tmp/w1-section-identity-review-{engine,app}.mts` with import paths remapped to this worktree only. All oracles, mutations, expected results and strict assertions are unchanged. This avoids modifying the released reviewer worktree and tests the corrected source/built package rather than its old source. Before the fix the probes reproduced 3 engine name failures and 9 app name failures plus 3 classified baseline observations.

| Command / probe | Corrected result |
| --- | --- |
| Captured-input owned engine gate (`SECTION_FULLIR_AUDIT=...`, existing command above) | 6 fullIR cases; 5 explicit-Q casing/whitespace forms; section/graph/conceptual positives and wrong-name declines; subscripted/primed identities; entity/annotation renames; anonymous naming; original strict controls pass |
| Captured-input and standalone owned app gate | Original 6 cases, planner aliases and scalar controls pass; 12 decline controls; 5 explicit-Q forms; anonymous R; renamed result entity/annotation/both and wrong coordinates reject live/save/JSON restore |
| `SECTION_FULLIR_AUDIT=... pnpm --filter @heytutor/scene-engine exec tsx /tmp/w1-section-identity-review-engine.mts` (strict) | 61 observations, zero failures, exit 0 |
| `pnpm --filter @heytutor/tutor exec tsx --tsconfig /Users/kaizen/heytutor-cov-wt/w1-section-fullir/apps/tutor/tsconfig.json /tmp/w1-section-identity-review-app.mts` (strict) | 81 observations; zero requested-name failures; exit 1 solely for the 3 preserved baseline observations below |
| Existing engine section-ready / app section-ready / section-topic / visual-obligations gates | 22 / 138 / 37 of 37 / 299 pass |
| Scene-engine typecheck; scoped TypeScript on owned scripts/import graph; narrowed engine/app eslint | pass |
| `pnpm --filter @heytutor/scene-engine build` | ESM and declarations pass |
| `git diff --check` | pass |

The app observation count drops from 87 to 81 because rejected wrong-name selections no longer enter the conditional live/save checks. The residual strict failures are exactly `client-lineage:compiled-live-accepted`, `client-lineage:save-accepted`, and `client-omitted-equal-component:save`. Sagan independently reproduced these on both `f459df7b` and `7443b2f9`; they remain existing persistence-boundary gaps, outside this correction. False endpoint/derived annotations, changed actual question/restored IR, missing source, missing bodies/dimensions, scalar roles and units remain strict. No reviewer assertion or baseline classification was altered to obtain a green report.

Corrective scratch evidence: `/tmp/w1-section-identity-*.log` and `/tmp/w1-section-identity-review-{engine,app}-{before,after}.jsonl`. Scoped config is `/tmp/w1-section-identity.tsconfig.json`, with the same compiler settings as the earlier scoped check and absolute worktree paths. No dependency install, full three-package suite, student server, port, runtime acceptance, remote operation or READY/count change was performed in this correction. Existing opaque expression IDs, compound given roots including source fractions, and fractional coordinate syntax remain explicit gaps. Parent must resume Sagan on the clean corrective commit before integration; Laplace owns actual landed-head runtime verification.

## Parent correction: coordinate annotation identity

Sagan's clean independent review31802675 retained a BLOCK on90fd9830:
callout `R≈(7,8)` and badge `R: (7,8)` still passed for requested Q. The
non-label annotation scan recognized only equality and silently found no
tuple. Correct result coordinates do not certify a different point name.

The board annotation matcher now recognizes equality, approximation and
caption separators uniformly for result and endpoint annotations. The source
question grammar, source witness, numeric comparisons, IR obligations and
global compiler are unchanged. Correct Q coordinates pass in label/callout/
badge forms with each separator; R at the same coordinates and Q at false
coordinates reject live, canonical save and JSON revalidation. No source flag
or rewritten annotation grants admission. An unreadable source still declines.

The new owned gate reproduced the old rejection of a legitimate Q approximation
label before this correction. Sagan's separate false-R admission evidence
remains unchanged. Captured normal fullIR engine/app gates and their original
controls PASS after the correction. Existing section engine22, app138 and
visual-obligations299 PASS, as do engine/core builds, engine and scoped app
typechecks, narrowed engine/app lint and diff check. A first scoped check
identified an inferred test variable type; explicit SceneDocument typing fixes
it. One mistaken command used nonexistent verify-section-ready.ts; the actual
verify-section-formula-ready.ts commands above both passed. Neither setup
failure is treated as a test result.

Parent reused the released author tree on cov/w1-section-annotation-20261006;
reviewer's source tree and immutable probes were not edited. Independent
re-review is required before this three-commit chain lands. No student render,
lifecycle, READY, ledger or remote change is claimed by this correction.

### Fail closed on unreadable coordinate claims

Parent self-audit reproduced source-proof vacuity for callout `R~(7,8)` on
518c047b. Sagan independently confirmed eight source/raw-live failures for
tilde and LaTeX approximation across callout/badge; generic compile/save/JSON
already refuse those particular strings, so no wrong rendered ink is claimed
from that probe. Initial inline scratch setup used CommonJS against an ESM
package and failed before running; the owned module gate is the actual red.

Named result and named endpoint annotations now require all coordinate-like
parenthesized comma claims to be covered by the supported point tuple matcher.
Unknown separators, fractional/symbolic/extra coordinates, a bare tuple and a
mixed valid-plus-unreadable tuple decline honestly. Actual parsed names and
numbers still must agree. Equality, Unicode approximation and colon matching
positives remain; zero-pair AP:PB ratio captions remain source-compatible.
Question reading and its numeric syntax are unchanged. This closes the empty
match escape, rather than treating a new separator as proof of identity.

The owned red control is retained at /tmp/w1-section-unparsed-red.log.
Captured fullIR engine/app gates, existing engine22/app138, engine/core builds,
scoped typecheck/import graph, narrowed lint and diff check PASS on the complete
correction. Reviewer probes/evidence stay immutable. Parent will pin this
follow-up for independent re-review before landing the four-commit chain.

### Share the compiler's coordinate grammar

Sagan's immutable62 probe caught the remaining square tuple: `R≈[7,8]`
passes compile/live/save/JSONB for source Q on9e7ecfca. Evidence4abebe37.
The earlier parenthesis detector and literal matcher both ignored the square
pair. This is real incorrect identity admission; that chain remains unlanded.

Source binding now reads coordinate claims through the existing compiler's
derived-label parser, via a small wrapper exposing the raw name, two values
and unit. The existing numeric parser and compiler validation do not change.
Named source identities retain case/underscore/prime spelling, independently
of generic parser key normalization. Both parentheses and square tuples bind
the freshly read actual name and exact coordinates; unknown/unreadable claims
decline and extra units or concatenated claims cannot hide a second identity.
Legacy A(1,2) endpoint labels and zero-pair prose retain compatibility.

New matching Q square controls compile/admit/save/revalidate; wrong R and
false Q square coordinates reject across all annotation kinds. Captured
fullIR engine/app gates, builds, engine/scoped app typecheck and narrowed lint
PASS. Existing derived-value/section checks are recorded in the final review.
The owned square red is /tmp/w1-section-square-red.log; reviewer62 remains
immutable. Parent announced the new shared compile file before editing.
Independent re-review and real student evidence still required; no READY or
ledger claim follows from these offline repairs.

### Cover the label-construction channel

Parent's owned red and Sagan's independent120 probe confirm35b4d3e3 still
admits a separate label construction targeting Q with text `R≈[7,8]`.
All target/at/point aliases compile, admit, save and revalidate; board output
contains wrong R next to Q. This is the same source-identity contract across
the third channel checked by generic derived-label validation.

Source checks now gather those constructions' input text and output entity
labels for named endpoints and results, alongside entity/annotation labels.
They use the shared compiled coordinate parser and actual question witness.
Plain zero-pair descriptive captions keep their previous treatment. Owned
target/at/point positive Q and wrong R/false-coordinate controls pass; wrong
R rejects live/save/JSON. Captured fullIR engine/app, builds, scoped typecheck,
narrow lint and diff pass. Parent red is /tmp/w1-section-label-channel-red.log.
All independent prior probes remain unchanged and the35 BLOCK stays recorded.

Shared-parser source checking also deliberately declines concatenated tuple
claims as unsupported, consistent with the generic compiler. Two immutable62
raw-source/live expectations remain visible as stricter capacity observations,
not incorrect rendering or suppressed failures. This source program binds
one complete coordinate claim per label; native/exhaustive completion remains
separate. Independent final review and real student rerender are still needed.
