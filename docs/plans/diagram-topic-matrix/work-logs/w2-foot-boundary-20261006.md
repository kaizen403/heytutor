# W2 public-compiler foot identity boundary — 6 October 2026

Base: `f741829c66824169bc61c0d0661f57060b63e7de`, clean at assignment.
Owned worktree: `/Users/kaizen/heytutor-cov-wt/w2-foot-boundary-20261006`.
Worker: this bounded foot-boundary session; integration owner: parent.
Topic: `maths|10|point-to-line-distance`, Coordinate Geometry maths/10,
JEE Main/Advanced 2026, authored bounded projection-request profile.
Disposition: **integration_pending; READY earned 0; accepted-topic delta 0**.
The submission commit contains the four code/gate files below and this log.

Read AGENTS, root coverage plan and packet contract, matrix index/progress/
readiness, continuation, session ownership and the previous W2 correction log.
Exact required review:
`/Users/kaizen/heytutor-claude-coord/reviews/w2-projection-acceptance-20261006.md`.
Read the selected repro scripts and reused the three exact forged documents in
`/Users/kaizen/heytutor-claude-coord/reviews/w2-projection-acceptance/` read-only.
The assigned verify path was announced before its first edit.
The user-authorized pin and bounded scope control this assignment; no remote
publication/baseline discovery or subsequent waves were undertaken.

## Initial defect and reusable fix

The review established that the whole-request reader correctly captured Q for
“Find the Perpendicular Foot Q of P(0,0) from 3x+4y-25=0.”, but public compile
accepted caller foot labels H, q and P. The old source guard compared captions
against the caller's mutable label instead of the source-owned requested name.
Independent oracle: Q=(3,4), P=(0,0), 3*3+4*4=25, Q-P is along normal (3,4), d=5.
No live/student observation or baseline reproduction is newly claimed here.

Changed files:

- `packages/scene-engine/src/ir/pointLineRequest.ts` (new): extract the existing
  successful whole-request grammar into a stateless, bounded reader accepting
  the existing exact source literals. No dependencies/import cycle. Keyword
  case is ignored; captured ASCII one/two-letter, optional digit/apostrophe
  names retain their original case. No second foot-keyword/name scan.
- `packages/scene-engine/src/ir/pointLineProgram.ts`: reuse that reader; retain
  certified projection, precision declines, source-name collision checks,
  complete full-IR obligations and quantity/annotation handling.
- `packages/scene-engine/src/ir/pointLineSource.ts`: independently bind every
  project output and auxiliary literal foot to the successful request's name,
  computed foot, given source point and bound infinite line. Each entity label,
  annotation text and transitive label-construction/entity caption is checked
  independently. A correct caption cannot excuse a wrong/missing entity label;
  caller IDs cannot supply visible identity. Reject given-point/line collisions.
  Require the requested foot's entity in required IDs and reveal groups. The
  named-request guard runs even without the distance producer, quantities,
  annotations, assertions or descriptive program roles. Literal point sources
  retain exact given-coordinate binding; composed analytic lines retain exact
  proportionality checks. Existing generic distance-only source controls remain.
- `packages/scene-engine/scripts/verify/verify-w2-point-line-identities.ts` (new):
  public source TS and built ESM controls, direct source-guard assertions,
  actual compiled requested-name ink checks and optional JSON receipts.
- This owned work log. No shared compiler/family/index/core/app/capability,
  triangle seam, ledger or counter edits.

## Evidence and preserved boundaries

Each final identity run has **445 assertions**, **29 positive documents** and
**106 negative documents**, including the exact saved review H/P/q forgeries.
Every negative has fatal source-guard issues, `ok:false` and `renderScene:null`.

Controls cover four keyword cases/forms and Q/q/Qa2'/q2', distance-plus-foot and
foot-plus-distance grammar, origin, true incidence, independent literal feet,
marker-free project-only/literal-only documents, arbitrary entity IDs and a
proportionally scaled composed `line_relation`. The geometry oracle above is
specified independently of scene-engine helpers.

Negatives cover changed/missing/fake plain labels, correct/wrong-name tuple
captions, wrong tuple coordinates, each independent annotation/label channel,
correct captions paired with wrong labels, Q/q case substitutions, source-point
and line collisions, origin/unnamed-given caller collisions, ID spoofing,
required/reveal omissions, missing foot producers, wrong literal coordinates,
and project-only wrong-source/wrong-line candidates. Full-IR foot-only uses
actualPoint/actualLine/actualFoot IDs and xQ/yQ evaluate requests; it remains
unchanged, compiles, and has **zero quantities and zero annotations**. It does
not invent a distance answer binding. A caller rename of that IR-derived foot
also rejects.

The inherited 196-check N1/N2 precision gate remains green, including its exact
binary64/source-precision regressions and full-IR distance binding. It retains
recomputed value 5 under `actualPlanDistance`, with the existing supported unit,
requested evidence and exactly one distance quantity-backed annotation.
The unchanged W2 source gate retains composed-line controls, five complete
programs, full-IR/eight rejects, and F1/F2/F3 controls. The old five-case/19-control
**113-check** gate and **553-check** analytic line regressions remain green.

One initial test expectation was corrected: a numeric tuple on a generic
`project` descendant is already rejected by the inherited display-derived-claim
validator, although the new source guard accepts its correct identity/value.
Correct tuple positive controls therefore use independently computed literal
feet, an admitted existing channel. That independent compiler rule was not
changed or bypassed. This patch does not certify generic project numeric labels,
new source grammars, arbitrary composed points or non-analytic projections.

## Exact commands and local receipts

Receipt root: `tmp/w2-foot-boundary-20261006/` in the owned tree (ignored).
Identity artifacts: `identities-source.json`, `identities-built.json`, each
containing whole positive documents/scenes and negative issues.
Precision artifacts: `precision/`, including the existing authored whole-IR
quantity-binding document and five compiled-scene SVG/JSON outputs.
No visual/student inspection is newly claimed; compiled-ink checks are offline.

All commands used:

```sh
export PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
```

Node v24.21.0; pnpm 10.32.0. Each final command below exited 0.

| Command | Result / receipt relative to receipt root |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | 666 own packages, zero downloads; `install.log`; lockfile unchanged |
| `pnpm --filter @heytutor/drawing build` | own ESM/declarations; `build-drawing.log` |
| `pnpm --filter @heytutor/scene-engine build` | own ESM/declarations; `build-engine.log` |
| `pnpm --filter @heytutor/scene-engine typecheck` | `tsc --noEmit`; `typecheck.log` |
| `pnpm --filter @heytutor/scene-engine lint` | 0 errors, four inherited unused-variable warnings in DSA misc/sorting/stackAndMap; `lint.log` |
| `pnpm --filter @heytutor/scene-engine exec eslint src/ir/pointLineSource.ts src/ir/pointLineProgram.ts src/ir/pointLineRequest.ts scripts/verify/verify-w2-point-line-identities.ts` | 0 errors/warnings; `lint-owned.log` |
| `pnpm --filter @heytutor/scene-engine exec tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --typeRoots ../../node_modules/.pnpm/@types+node@22.20.0/node_modules/@types scripts/verify/verify-w2-point-line-identities.ts` | strict owned gate typecheck; `typecheck-gate.log` |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-point-line-identities.ts ../../tmp/w2-foot-boundary-20261006 --repros=/Users/kaizen/heytutor-claude-coord/reviews/w2-projection-acceptance` | source TS, 445 checks/29 positives/106 negatives; `gate-identities-source.log` |
| Same identity command with `--built` | own freshly built ESM, 445 checks/29 positives/106 negatives; `gate-identities-built.log` |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-projection-precision.ts ../../tmp/w2-foot-boundary-20261006/precision` | 5 cores/196 checks; `gate-precision.log` |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-point-line.ts` | all four unchanged control groups; `gate-point-line.log` |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-point-line-ready.ts` | 5 cases/19 controls/113 checks; `gate-ready113.log` |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-ch06a-line-operators.ts` | 553 independent metric/rejection checks; `gate-ch06a553.log` |
| `git diff --check`, staged diff review/check | clean whitespace and owned scope |

## Parent handoff and remaining work

Proposed state for `maths|10|point-to-line-distance`: **integration_pending**.
The bounded requested-foot compiler defect is fixed locally and the original
forged documents reject in both source and built ESM. Independent acceptance
re-review remains parent-owned. N1 numeric implementation and N3 parent
arithmetic/Ohm/triangle/capability work are unchanged.

Normal application/TurnPlan/serialized solver integration, real student
geometry/narration/WRITE/FOCUS/reveal, authenticated save/restart/fresh reopen/
whole replay, native/holdout certification, full suites and frozen failure-digest
comparisons are **UNRUN**, not PASS. Other source grammars, 3D, word/two-point/
intersection lines and arbitrary derived-point scopes remain outside this fix.
Foot-only persistence admission remains a parent obligation. No topic row is
accepted and no readiness/counter file is edited: **READY 0; count delta 0**.

Commit author/committer: Rishi Vhavle <rishivhavle21@gmail.com>, no coauthors,
`core.hooksPath=/dev/null`. No agents/forks/Astral, providers, browser/runtime,
DB, environment-key reads, remotes, stash, other-tree or main edits. Only own
ignored dependencies/builds/receipts and these five allowed tracked files were
written. Stop after this bounded submission; no subsequent work is started.
