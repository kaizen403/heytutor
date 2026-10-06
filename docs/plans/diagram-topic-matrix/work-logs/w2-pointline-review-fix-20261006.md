# W2 point-line fresh-review repair — 6 October 2026

Disposition: **integration_pending**. Worker: Codex, single concrete worker;
integration owner: parent W2 session. Topic: `maths|10|point-to-line-distance`,
CH-06a, J/A listed, N not applicable. This log records the finite caller repair;
ledger, accepted counts and readiness states are unchanged.

## Frozen source and ownership

Base: `e82d7211e6f1ce27f248ad072be1b4d984b82d73`. Worktree:
`/Users/kaizen/heytutor-cov-wt/w2-pointline-review-fix-20261006`; branch
`fix/w2-pointline-review-fix-20261006`. Read AGENTS, coverage plan, matrix/progress,
session ownership, code-review and diagnosing-bugs. Shared-path ownership was
announced before the new gates and minimal app selection edits.

The immutable review is
`/Users/kaizen/heytutor-claude-coord/reviews/w2-pointline-fresh-review-20261006/report.md`.
Its complete repro cases are copied byte-for-byte into the test-only fixture
`packages/scene-engine/scripts/verify/fixtures/point-line-fresh-review-20261006.json`.
Both new gates pin that fixture's SHA-256
`d0e2349920c1ef7b3502c1b975cd2eefe517683d25d23ab656db27d88073daf1`
and the untouched original full-caller fixture's SHA-256
`17b3a62cf0eceebfc20815ef42eaa60e6c032cff5c8a63c2954b9b3d622e18ac`.
The immutable review's entire SHA256SUMS check passed after the work.

## Repair and proof

- F1: `pointLineCallerAuthority.ts` parses complete closed arithmetic into a
  bounded temporary AST. Each identifier occurrence must bind to independently
  audited source/derived values before evaluation. Free variables reject inside
  zero products, cancellation, calls, tuples and affine vector expressions.
  Whitespace retains token boundaries: `x _P` cannot become `x_P`. Evaluation
  consumes a variable-free AST; it never assigns a free curve variable zero.
- F2: line actor hints and exact-line assumptions cite only given fact IDs owned
  by the uniquely audited line entity. Point and requested evidence cannot
  acquire line authority through the `line ` prefix.
- F3: `representationFallback.ts` makes the engine's whole point-line refusal
  terminal before exact candidates and all family/source/last-resort fallbacks.
  Fast selection also refuses, and direct source fallback refuses when it lacks
  complete caller authority. Empty refusal documents retain the whole question.

Existing full original IR formula checks, constraint proofs, operators,
request grammar, units and caller raw-evidence retention are reused. Production
never imports the fixtures. Original Plans/IR are neither pruned nor rewritten;
all three unsimplified bindings and cPerp[P,F,L] remain. The parent circle
`942e39c5` import/append seams in sceneSourceAuthority/problemPlanner/turnPlanner
are outside this diff, so both layers remain available for later integration.

## Verification

Node v24.21.0 and pnpm 10.32.0 use the user-specified PATH. The worktree has its
own frozen install and own drawing/engine/core/design-tokens/whiteboard builds;
tutor production build, engine/core/app typechecks and lints pass. Lints retain
four engine, one core and nine app warnings, none in changed code.

The tight initial gate went red on all five frozen negatives (32 boundary
assertions). A later whitespace attack independently went red on seven boundary
assertions. Final gates pass:

| Gate | Evidence |
| --- | --- |
| New engine review gate | 51 checks, source and own public ESM |
| New ordinary API/app review gate | 669 checks, source engine/core and own public ESM |
| Existing full-caller engine/API gates | 140 / 67 checks, source and public ESM |
| Existing W2 point-line / identities / point-line-ready | pass (identities 436; ready 113) |
| Existing problem IR / labels / accuracy / visual obligations | pass (labels 220; accuracy 319; obligations 299) |
| Existing turn/problem planners / compact / differential IR | pass |
| App representation fallback / coordinate source persistence / verified scene recovery | pass |
| Diff whitespace and immutable review fingerprints | pass |

The new gate retains both original captured Plans and frozen originals, adds
17 independent malicious callers, and exercises five independent geometric
oracles through ordinary API and normal app selection (default/inferred scope,
with/without an exact candidate). It checks every original scene actor and full
lifted IR, not ink count alone. Oracle feet/distances: oblique (7/25,26/25),6/5;
vertical (5,3),7; horizontal (4,2),5; negative oblique (3,-3),sqrt(18); incidence
(3,4),0. Incidence retains distinct point/foot identities and invents no angle.
Extra-query versions of each entire original source decline without ink,
including the missing-caller path. API declines preserve raw original wire/Plan.

Three older app gates fail identically at the pinned parent and final fix:
`verify-point-line-scalar-admission.ts` and
`verify-point-line-source-persistence.ts` use the source with trailing Options
outside the complete request grammar; `verify-fast-figure-authority.ts` expects a
symbolic projectile contact-body figure but gets null. Baseline comparison used
only temporary parent bytes of the two changed production files in this isolated
worktree, restored in finally; no fork, stash/reset or shared-workspace edit.
These gates and their fixtures are unchanged. The initial app batch's public-ESM
NODE_OPTIONS caused a handwriting JSON loader error; app gates were then run
with their normal configuration. All outcomes are retained externally.

## Handoff

F1–F3 are fixed in the frozen offline scope; independent review is pending.
Full chapter/native-bank, symbolic, 3D, multiple-point/line and arbitrary prose
coverage remains outside this finite contract. Student voice/WRITE/reveal,
authenticated save/reopen and persisted replay were not run. The two inherited
point-line persistence gates remain unresolved; in-memory coordinate controls
are not student lifecycle evidence.

External commands, full original API receipts, scenes, red/green evidence,
inherited failures and baseline comparison:
`/Users/kaizen/heytutor-claude-coord/reviews/w2-pointline-review-fix-20261006/REPORT.md`.
The user authorized a local user-authored commit only. Integration owner must
review/cherry-pick this layer with the separately reviewed circle layer and
perform independent/live/lifecycle acceptance before any ledger transition.
