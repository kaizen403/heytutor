# W2 T1 plan reload / 6 October 2026

Disposition: **integration_pending**. READY earned **0**; accepted-topic delta
**0**; FULLY-CERTIFIED earned **0**. No ledger or chapter counter changes.

Assigned worker: this Codex session. Integration owner: parent session.
Worktree `/Users/kaizen/heytutor-cov-wt/w2-plan-reload-20261006`, branch
`cov/w2-plan-reload-20261006`, clean base
`e7d63c549a6a306c5aea73b39b3146860bf540ba`.

Read AGENTS, root coverage plan, topic index, progress contract, session ownership,
and `/Users/kaizen/heytutor-claude-coord/reviews/w2-trust-acceptance-20261006.md`.
This is the exact blocking T1 source/plan trust correction, not a topic expansion
or syllabus acceptance packet. No new topic IDs or denominator are assigned.

## Bounded implementation

- New `apps/tutor/lib/scene/sourcePlanAdmission.ts` exports the pure synchronous
  `sourceBoundPlanIssues(document, question, rawPlan, rawProblemIR): SceneIssue[]`.
  Only the existing complete static-contact and optical-conjugate source readers
  select the supported profiles. Supplied plans must pass
  `validateTurnPlanV3(rawPlan, actualQuestion)`.
- Static contact regenerates with `staticContactTriangleDocument` and the
  validated actual plan plus unchanged complete caller IR. Its existing typed
  binding checks the AST, source roles, requested IDs and binding/unknown units.
  Optics regenerates with `opticalConjugateDocument`, checks known-row conflicts,
  checks ambiguous unknown identities and units. Parent's T2 factory owns
  unrecognized numeric/unknown roles; a fresh factory null is always fatal here.
- `storedSceneSource.ts` calls the helper in its source issues before raw
  document structural normalization. Stored read, restore and existing save raw
  guards consequently reject the stale plan. Existing raw scene source proof,
  trusted command filtering and `CLEAR` handling remain intact.
- Unsupported source profiles return `[]`. Legacy absence of a plan retains the
  existing source guards; an absent plan does not bypass those geometry/IR guards.
  No solver promise, DB, I/O or network occurs in the helper. Candidate metadata
  and cached `solverAuthority` are never read as authority. Fresh engine source
  regeneration provides the independent join, so no cached solver audit is needed.
- New dedicated gate and six frozen JSON fixtures retain the independent review's
  numeric contact, original foot-only IR and four optical device/kind documents.

No `sceneSaveAdmission.ts`, other existing app file, engine, index, capability,
registry or compiler edits. Parent owns the live helper call, T2 engine semantics,
optics numeric full IR and latest circle/section runtime fixes.

## Independent expectations and reproduction

Numeric contact: `sqrt(13^2 - 5^2) = 12 m`, preserving original `requestedH`,
given expressions, source entities, evidence and solve request. Changing only
requestedH to 999 or the unknown unit to s must reject helper/read/restore.
The baseline admitted both at read/restore; unknown-unit live admission was null.

Conceptual concave mirror: actual 0-expression/0-request IR, u=-30 cm,
f=-10 cm, v=-15 cm, magnification=-0.5. The other independent optical oracles are
convex mirror v=7.5 cm, m=0.25; convex lens v=15 cm, m=-0.5; concave lens
v=-7.5 cm, m=0.25. Correct plan values in mm/m remain accepted. Flipped v sign,
u=999 mm, unknown unit V and id v/symbol f reject before trusted ink.

The original review scripts were adapted **only** by replacing the worktree and
owned output paths. Outputs are in `/tmp/w2-plan-reload-20261006/`; original
review files were not changed. Prior source-program fixtures remain the original
read-only inputs. Before/after logs, mutated fixtures and JSON result files are
retained. `independent-before.log` reproduces 32 reload failures; the four
numeric contact observations are in `contact-plan-reload-before.log` and
`before-contact-plan-reload-results.json`.

## Commands and results

All pnpm commands used Node v24.21.0 and pnpm 10.32.0 with:

```sh
export PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
pnpm install --offline --frozen-lockfile --ignore-scripts
```

Own installation: exit 0, 666 packages, downloads 0, no copied dependencies.
Own builds ran sequentially, each exit 0:

```sh
pnpm --filter @heytutor/design-tokens build
pnpm --filter @heytutor/drawing build
pnpm --filter @heytutor/scene-engine build
pnpm --filter @heytutor/tutor-core build
pnpm --filter @heytutor/whiteboard build
pnpm --filter @heytutor/tutor exec prisma generate
```

| Check | Exact command after the PATH export | Result |
| --- | --- | --- |
| Dedicated gate | `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-w2-plan-reload.ts` | 168 checks, 0 failures; exit 0 |
| Original independent review | `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json /tmp/w2-plan-reload-20261006/independent.mts` | 127 checks, 0 failures; exit 0; original S1/S2, CM/rad, contact and foot controls preserved |
| Original contact observation | `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json /tmp/w2-plan-reload-20261006/contact-plan-reload.mts` | All four TS/ESM read=`retry_required`, restore=false; exit 0 |
| Original boundaries | `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json /tmp/w2-plan-reload-20261006/boundaries.mts` | 48 checks, 4 remaining parent-owned T2 live failures; exit 1, preserved |
| Original final controls | `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json /tmp/w2-plan-reload-20261006/final-controls.mts` | 10 checks, 0 failures; exit 0 |
| Optics lifecycle | `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-w2-optics-lifecycle.ts` | 32 offline seams; exit 0 |
| Point-line lifecycle | `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-w2-point-line-lifecycle.ts` | 6 controls; exit 0 |
| Raw source seams | `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-w2-raw-source-seams.ts` | 137 checks, 0 failures; exit 0 |
| Turn persistence | `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-turn-scene-persistence.ts` | Passed; exit 0 |
| Tutor typecheck | `pnpm --filter @heytutor/tutor typecheck` | Passed; exit 0 |
| Changed TS lint | `pnpm --filter @heytutor/tutor exec eslint lib/scene/sourcePlanAdmission.ts lib/scene/storedSceneSource.ts scripts/verify/verify-w2-plan-reload.ts` | Passed without warnings; exit 0 |

Exact commands/exits are also in `gates.json` and `regression-gates.json` in the
owned output directory; install/build/Prisma logs are retained there. The initial
typecheck found an unknown-question narrowing error and a test WRITE parameter
type error; both were corrected before final verification.

The dedicated gate exercises TS and built ESM source inputs, fresh synchronous
helper rejection, read quarantine, restore refusal, cached verified/contradiction/
not_applicable flags, forged candidate metadata, whole-IR immutability, legitimate
conceptual not_applicable positives, legacy absence of plan, unrelated old source
profiles, and trusted-geometry filtering that preserves CLEAR/work-area WRITE.

## Handoff and limits

Parent must import and call `sourceBoundPlanIssues` in its owned live admission
before any trusted ink. The direct helper already rejects contact unknown unit s;
the unchanged live function still returns null for that exact mutation. No claim
is made that the parent integration has occurred. Parent must also finish T2
engine semantics and numeric full-IR optics; the original T2 live failures remain
visible on this pin. The final steering removed this sidecar's unrecognized-row
and unrequested-role logic and T2 assertions to avoid duplicating parent ownership.
Its forthcoming factory rejection is enforced automatically by this helper.

Offline source/helper/compiler, in-memory save, stored read and presentation
restore evidence only. No browser, student/Auth, providers, DB persistence, actual
reopen after restart, narration/TTS or whole replay run. No latest parent runtime
or circle/section work was touched. No agents, Astral, forks, remote operations,
main edits or stash. Required browser/render/live acceptance and shared integration
remain with the parent. The user authorized an owned-file commit as
Rishi Vhavle <rishivhavle21@gmail.com>, hooks disabled per commit, no coauthor.
