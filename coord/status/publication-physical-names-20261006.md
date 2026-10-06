# publication-physical-names-20261006

Owner: bounded publication physical-source-names worker (2026-10-06).
Worktree: /Users/kaizen/heytutor-cov-wt/publication-physical-names-20261006
Branch/base: fix/publication-physical-names-20261006 / 8f19eab8.

Exact implementation ownership (announced before cherry-pick/edits):
- packages/scene-engine/src/archetypes/generators/mechanics.ts
- packages/scene-engine/src/archetypes/document.ts (only if needed)
- packages/scene-engine/src/synthesize/visualObligations.ts (only if needed)
- packages/scene-engine/scripts/verify/verify-publication-symbolic-figure.ts (new)

Parent owns specialized derivedValueLabels, sectionFormulaSource and app publication gate.
Task: preserve full actual ProblemIR, render exact source physical identities honestly,
exercise unchanged fast app authority gate and isolated positive/negative controls.
No runtime/ports/push/PR/other agents. No accepted-topic counter changes.
Required coverage plan, matrix/progress and session ownership read. Partial commit
2a25c3e6 inspected. Parent status file not present in this worktree or main at first read;
searching other worktrees for the requested evidence.

## Evidence and disposition

Disposition: **partial repair / blocked exact-name publication**, not topic acceptance.
No topic IDs were assigned to this infrastructure task. Matrix denominator,
accepted counters and all source fixtures remain unchanged. No live reveal,
persistence, replay, runtime, ports, push or PR was attempted.

Cherry-picked 2a25c3e6 as 6483fbd3 (user author, no coauthors).
That partial adds launch-clause angle grounding and compact physical labels in
mechanics.ts; it does not resolve long exact source names.

This worker adds structural physical identity checks in visualObligations.ts:
source points cannot match text/curves, source paths cannot match text/points,
and physical objects cannot match synthetic label/group/measurement geometry.
Exact spelling and one-to-one consumption remain mandatory. Analytic straight
lines rendered as sampled function curves remain compatible; the unchanged
region regression verifies this. The new isolated verifier retains the actual
captured ProblemIR byte-for-byte. Its hand-authored exact-label document is
explicitly a matching oracle only, never reported as compiled/live success.
It reports every failing check and exits 1 instead of concealing blockers.

### Commands and results

All commands used Node v24.21.0 from the user-specified frozen-deps bin PATH:
`/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin`.

- `pnpm install --frozen-lockfile --ignore-scripts`: PASS; lockfile unchanged.
- `pnpm --filter @heytutor/drawing build`: PASS (own tree).
- `pnpm --filter @heytutor/scene-engine build`: PASS (own tree, rebuilt after guard).
- `pnpm --filter @heytutor/tutor-core build`: PASS (own tree, rebuilt before app gate).
- `pnpm --filter @heytutor/scene-engine typecheck`: PASS, rerun after final guard.
- `pnpm --filter @heytutor/scene-engine lint`: PASS, four existing unused-variable
  warnings in DSA simulators; no DSA files changed.
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-visual-obligations.ts`:
  PASS, 299 checks. Initial stricter line-kind compatibility rejected the honest
  region's sampled straight line; corrected and reran unchanged gate successfully.
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-scene-annotations.ts`:
  PASS, all listed annotation kinds.
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-archetype-point-ownership.ts`:
  FAIL: `collision must retain every physical body and meaningful label: undefined`.
  Collision implementation is untouched; baseline attribution was not independently run.
- `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-fast-figure-authority.ts`:
  FAIL unchanged, first assertion at line 137: actual `null`, expected
  `qualitative_verified/contact_body`, check `not_applicable authority keeps the
  fast projectile figure`. Actual full ProblemIR passed through app; no IR override
  or fixture modification. Later checks are unexecuted because this gate stops
  on its first failure. Reproduced before and after own final package builds.
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-publication-symbolic-figure.ts`:
  FAIL, **11 passed / 5 failed**, all outcomes below.
- `git diff --check`: PASS.

### Isolated full-source controls: every outcome

PASS exact source identity matching (document oracle only).
PASS missing physical body.
PASS wrong identity despite direct source id.
PASS unknown source name cannot match by role.
PASS two equal names require two bodies.
PASS wrong target kind cannot carry exact name.
PASS synthetic text geometry cannot consume physical obligation.
PASS competing synthetic text leaves real body available.
PASS unattached or wrong-target callout cannot satisfy missing identity.
PASS unrelated wind/wall angles leave launch symbolic.
PASS numeric launch angle remains source bound (30 degrees).

FAIL full actual IR exact positive through synthesis: returns null.
FAIL long exact names survive live pruning/normalization: misses body:traj
(`parabolic trajectory`) and body:proj (`projectile (point mass)`).
FAIL long exact names render even without live pruning: direct validation retains
both names and satisfies identity matching, but compile reports fatal
`label_too_long` for O and trajectory. It also reports cascading `label_unattached`
for label_O, label_velocity, assert_label_O, assert_label_apex,
assert_label_landing and assert_label_apex_foot, plus verbose label warnings.
FAIL exact attached projectile callout: full text absent; compact prefix rendered.
FAIL exact attached trajectory callout: full text absent from attached primitives;
`parabolic trajectory` appears only in the scene caption.

### Remaining bounded blockers and integration handoff

The allowed builder/generator files cannot by themselves provide the requested
honest long-label renderer contract:
- `document/validation.ts` compact-label normalization in live pruning strips
  physical names longer than 16 characters (around lines 1971–1975).
- `labels/labelEngine.ts` rejects owner.text longer than maxLabelChars (around
  lines 391–401). Bypassing pruning still fails this independent renderer guard.
- `compile/compiler.ts` compactCalloutLabel (around line 862) reduces
  `projectile (point mass)` to `projectile`; an uncompactable trajectory callout
  becomes a caption through compileSceneCaption (around line 4684).
- `archetypes/index.ts` currently gives generators question/slots/sources/plan
  quantities, not ProblemIR entities. A general source/IR identity projection
  would need this seam and GeneratorContext, also outside worker ownership.

Those files are not edited. No aliases, role-only identity matches, truncation
presented as exact identity, unknown-name matches, synthetic identity markers,
IR dropping, templates, routers, source-gate weakening or parent-owned helper
changes were introduced. Owner must expand the renderer/context assignment for
an honest exact-name solution; current app gate remains red. Parent status file
`coord/status/publication-symbolic-figure-20261006.md` was unavailable in main,
this worktree, the prior worker worktree, and the publication worktree search.

Changed paths across both worker commits:
- packages/scene-engine/src/archetypes/generators/mechanics.ts
- packages/scene-engine/src/synthesize/visualObligations.ts
- packages/scene-engine/scripts/verify/verify-publication-symbolic-figure.ts
- coord/status/publication-physical-names-20261006.md

`src/archetypes/document.ts` was read only. Parent must independently review
and integrate; accepted topic counts do not change from this evidence.
