# W3 F5 actual-plan field guard — 2026-10-06

Disposition: **integration_pending**. The finite-binomial actual TurnPlan field
gap is closed in this isolated worktree. This offline result does not establish
student readiness, topic acceptance, lifecycle qualification, or a ledger/count
change.

## Scope and implementation

- Worktree: `/Users/kaizen/heytutor-cov-wt/w3-plan-fields-fix-20261006`, branch
  `w3-plan-fields-fix-20261006`, based on `68bece24`.
- Production change is limited to
  `packages/scene-engine/src/ir/finiteBinomialPlanAuthority.ts`.
- New gate files are `scripts/verify/verify-w3-binomial-plan-fields.ts` and
  `scripts/verify/fixtures/w3-binomial-plan-fields/{gate.tsconfig.json,mutations.json}`.
- The lane now checks a closed finite-binomial TurnPlan envelope recursively
  through quantities, unknowns, claims, and their string-list members before
  the generic validator can canonicalize fields away. An unmodeled field makes
  Plan admission fatal. Early authority keeps the caller payload untouched,
  carries the complete raw Plan in `declinedPlanEvidence`, withdraws
  unproved givens/results/unknowns/claims from the plan it returns for use, and
  marks the figure for decline. Generic TurnPlan validation and other
  production files are unchanged.
- Four independent negative cases place `extraObligations` at the root, derived
  row, unknown row, and valid exponent given. Each fails structural validation,
  compile, central source authority, live admission, save, read, and restore.
  The exact positive control exercises the five core Plan contracts together with
  positive sign, source text, provenance, dependency, zero uncertainty, a
  source-proved sign claim, and the proved finite-algebra assumption.

## Verification

Own-worktree installation and sequential package builds used Node 24.21.0 and
pnpm 10.32.0. Frozen install passed. Drawing, design tokens, scene-engine,
tutor-core, and whiteboard builds passed; generated `dist` output is ignored
and confined to this worktree.

The new gate passed **22/22** against source and **22/22** against the built
public ESM entry. The dedicated TypeScript gate config passed. ESLint passed on
the production file and the new gate with no warnings. `git diff --check`
passed. The gate uses no DB, provider, browser, network, or server.

Commands (from the repository root):

```sh
pnpm --filter @heytutor/drawing build
pnpm --filter @heytutor/design-tokens build
pnpm --filter @heytutor/scene-engine build
pnpm --filter @heytutor/tutor-core build
pnpm --filter @heytutor/whiteboard build
pnpm --filter @heytutor/scene-engine exec tsx --tsconfig scripts/verify/fixtures/w3-binomial-plan-fields/gate.tsconfig.json scripts/verify/verify-w3-binomial-plan-fields.ts
pnpm --filter @heytutor/scene-engine exec tsx --tsconfig scripts/verify/fixtures/w3-binomial-plan-fields/gate.tsconfig.json scripts/verify/verify-w3-binomial-plan-fields.ts --esm
pnpm --filter @heytutor/scene-engine exec tsc --noEmit -p scripts/verify/fixtures/w3-binomial-plan-fields/gate.tsconfig.json
pnpm --filter @heytutor/scene-engine exec eslint src/ir/finiteBinomialPlanAuthority.ts scripts/verify/verify-w3-binomial-plan-fields.ts
git diff --check
```

The pre-existing suite's legacy no-Plan source-only red expectations were not
changed or reclassified. No student run, authenticated database persistence,
restart/reopen replay, topic READY claim, or accepted-count change is included.
