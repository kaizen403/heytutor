# W3 independent review R3/R4: whole binomial engine guards

Disposition: integration_pending. This is bounded engine repair and offline
lifecycle evidence. Parent integration and student acceptance remain pending.

## Ownership and frozen contract

- Worker: this single Codex session in the Sol/Luna lane; no delegated agents,
  forks or extra active slots. Date: 2026-10-06.
- Fresh own tree:
  `/Users/kaizen/heytutor-cov-wt/w3-binomial-whole-guards-fix-20261006`.
  Branch: `cov/w3-binomial-whole-guards-fix-20261006`.
  Repository: `/Users/kaizen/heytutor-cov-wt/w3-live-authority-20261006`.
  Frozen base: `c522dc028e998038e2f15d01efc48798e472e32a`.
- Read the pinned AGENTS, coverage plan, topic matrix index/progress, session
  ownership, prior binomial foundation/review contracts, progression's closed
  field audit, and the independent live-authority review's REPORT,
  R3-uncovered-ir-fields.json, R4-plan-obligations.json and plan-obligations.mts.
  Review directory:
  `/Users/kaizen/heytutor-claude-coord/reviews/w3-live-authority-final-20261006`.
- Scope: the existing finite rational coefficient/expansion grammar, including
  the preserved native 2014 Paper 2 Q43 source. This does not extend the topic's
  outstanding general/middle/greatest term, Laurent, symbolic or infinite cases.
- Owned product paths: only `src/ir/finiteBinomialProgram.ts` and
  `src/ir/finiteBinomialPlanAuthority.ts` under scene-engine. The new dedicated
  verify path was announced before editing; its fixtures and this log are owned.
  All existing gates remain untouched.
- R1/R2 delivery/normalization, R5 mandatory Plan join, contract/central/family
  seams, app/core and Ohm admission belong to the parent. The parent's later
  `fc6e721d` and dirty work are not included in this pinned validation. The
  parent's separate running native W2/UCM tree was not used or modified.

## Product behavior

R3 audits every actual IR record against its modeled keys after structural
validation and before source role certification: facts/evidence, entities,
expression wrappers and every AST descendant, constraints, intents, requests
and result bindings. It mirrors the progression guard's vocabulary and recursive
AST walk. Unsupported request kinds, fields or obligations decline. The original
IR remains intact; no metadata equality, projection or dropped field supplies
semantic proof. A regenerated document containing any of the seven reported
nested unknown obligations also fails every existing caller-Plan boundary.

R4 requires exact certainty for source numeric rows. Nonzero uncertainty rejects
an unchanged Plan. The early helper withdraws an uncertain coefficient together
with its unknown and any now-unbound claim; it does not erase uncertainty and
pretend that the same row was exact. Full-IR figure admission then declines the
missing requested output. Uncertain exponent givens are also withdrawn.

Supported qualitative propositions are `coefficient_positive`,
`coefficient_negative` and `coefficient_zero`, with a boolean expected value,
one explicit bound quantity ID, and no extra semantic fields/entity hints.
Both true and false expectations are compared to the sign of the freshly
computed exact rational numerator. All other claim keys or unbound/contradictory
claims reject. The early helper retains only independently proved assertions
whose requested row survived; unsupported assertions are withdrawn.

Supported complete assumption propositions are `Finite algebraic expansion`,
`Finite algebra only` and `Finite polynomial expansion` (case/outer whitespace
and one trailing period are immaterial). Their proof is the complete source AST's
successful bounded finite rational expansion: nonnegative integral powers and
constant nonzero denominators. Compound statements and all other assumptions
reject; the early helper removes them. It preserves the supported finite algebra
assumption. Cleaning a question-only Plan does not create IR or whole-IR proof;
unchanged original bad Plans reject at the later boundaries. An actual declined
IR withdraws numeric results/unknowns/claims and never gets rebound to a smaller
graph. The guard also checks any asserted coefficient sign against exact source
arithmetic.

## Dedicated gate and evidence

New gate: `packages/scene-engine/scripts/verify/verify-w3-binomial-whole-guards.ts`.
Fixtures: `scripts/verify/fixtures/w3-binomial-whole-guards/` contains independent
coefficient controls, complete captured R3/R4 review inputs, and a gate tsconfig.
Runtime app aliases point explicitly to this tree's built public bundles; the
same config resolves their declaration files for strict typechecking.

Independent coefficient controls are -720, 240, 35, 3/32 and an out-of-degree
zero. Their authored ASTs, source facts, exact rational result expressions and
actual ID/symbol/unit bindings are supplied independently of the source reader.
Selection/factorial arithmetic checks the five results. The native raw fixture
is unchanged and hash-checked; separate enumeration of `2a+3b+4c=11` gives 1113.
The source answer marker is not an oracle. These are authored full-IR controls,
not captured native planner outputs.

Both source and public ESM modes pass **511/511** observations with byte-identical
complete input/outcome records. Against the pinned baseline the same expanded
gate fails **171/511** observations in both modes, with identical records.
The gate includes all seven actual R3 mutations; deeper number/variable/unary
and operand mutations; request fields belonging to an unsupported request kind;
false negative/all-negative assertions; uncertainty 5; exact uncertainty 0;
supported and contradictory sign claims; unsupported false claims; unbound and
hidden claim fields; compound assumptions; and early withdrawal/figure decisions.

Each actual-Plan lifecycle case runs structural validation, public compiler
(with null render on rejection), source admission, shared live/save admission,
canonical save, guarded JSON read, and fresh JSON restore. The original bad
candidate is also regenerated with its complete mutated embedded graph and
rejected. Inputs are checked for immutability. All save/read/restore calls are
pure offline operations without DB access; no browser, audio, live provider,
authenticated session or native student acceptance was exercised.

Artifact root: `/tmp/w3-binomial-whole-guards-20261006`.
`final/{source,esm}.json` retains every assertion/input/document; `red-final/`
retains the baseline results. `compare.py` and `comparison.json` preserve the
unchanged-gate comparison. `*-actual-comparison.json` retains complete before/
after values for all three pre-existing failures. Gate capture scripts only
instrumented temporary copies; no original gate was edited.

## Reproducible commands

All commands use Node v24.21.0 and global pnpm 10.32.0, with:

```sh
export PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
pnpm install --offline --frozen-lockfile --ignore-scripts
pnpm exec turbo run build --filter=@heytutor/scene-engine --filter=@heytutor/tutor-core --filter=@heytutor/whiteboard --filter=@heytutor/design-tokens --force
pnpm --filter @heytutor/scene-engine typecheck
pnpm --filter @heytutor/scene-engine lint
pnpm --filter @heytutor/scene-engine exec eslint src/ir/finiteBinomialProgram.ts src/ir/finiteBinomialPlanAuthority.ts scripts/verify/verify-w3-binomial-whole-guards.ts
pnpm exec tsc -p packages/scene-engine/scripts/verify/fixtures/w3-binomial-whole-guards/gate.tsconfig.json
```

From `apps/tutor`, run:

```sh
pnpm exec tsx --tsconfig ../../packages/scene-engine/scripts/verify/fixtures/w3-binomial-whole-guards/gate.tsconfig.json ../../packages/scene-engine/scripts/verify/verify-w3-binomial-whole-guards.ts --artifact=/tmp/w3-binomial-whole-guards-20261006/final
pnpm exec tsx --tsconfig ../../packages/scene-engine/scripts/verify/fixtures/w3-binomial-whole-guards/gate.tsconfig.json ../../packages/scene-engine/scripts/verify/verify-w3-binomial-whole-guards.ts --esm --artifact=/tmp/w3-binomial-whole-guards-20261006/final
```

Own frozen offline installation reused packages, downloaded none and changed no
lockfile. Five forced package builds succeeded with zero cached tasks; the final
engine build also passed after the expanded red/green controls. Product and
gate typechecking/owned lint passed. Package lint has only the same four existing
DSA warnings. Plain Node24 public ESM import computed 240 and rejected all seven
R3 and three R4 captured inputs. No dependency, build or environment copies;
no remotes/main, DB, provider, browser, hook execution or coauthor operations.

The first gate incorrectly expected a decimal board label for 3/32; its oracle
was corrected to the exact rational. An app runtime configuration initially
resolved workspace sources, then import-only exports rejected a CJS app import.
Explicit built-bundle aliases fixed the runtime join. Extensionless built paths
also resolved strict declaration types. These were gate/tool configuration
corrections; no product or shared contract workaround was introduced.

## Untouched gates: compare actual outputs and failing values

All **19** complete gate outputs match before/after (only trailing whitespace
and the one pnpm filter failure-wrapper footer are excluded). Sixteen pass in
both states; three retain the same failure and complete captured actual values:

- Progression source: recovery admission is `{status:"declined", reason:
  "fact statement has contradictory or unsupported source obligations"}`.
- Family synthesis: the variable-diameter circle question has both `family:null`
  and `fallback:null`, at the original line 945 assertion.
- W1 source trust: corrected car radius 50 and acceleration 8 remain unchanged;
  `carScene:null`, `actual:null`, `expected:true` at the original assertion.

Passing unchanged gates: binomial review 72, foundation 236, integration TS/ESM
341 each; progression integration 2286 and review 1552; measurement hardening
69, review controls and Plan registry 56; ProblemIR/local solver, scene engine,
operator primitives, operator authority 319, derived labels 220, visual
obligations 299, and W3 app live authority 455. Exact commands, actual outputs
and exit codes are stored in `baseline/results.json` and `final/results.json`.
The aggregate scene-engine/app suites were not substituted for these focused
checks or reported as passing.

## Handoff

The patch is confined to the two owned engine leaves, dedicated gate, three
fixture/config files and this worklog. Review checked the closed-field walk,
exact sign evidence, unchanged original Plan rejection, withdrawal and input
preservation against the requested R3/R4 contract. No additional bounded finding.
Parent must apply the patch to its R1/R2/R5 integration and run its boundary gate
and student lifecycle acceptance on that combined tree. The local commit is
authored only as RishiVhavle <rishivhavle21@gmail.com>, with
`core.hooksPath=/dev/null`.
