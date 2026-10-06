# Packet evidence: w1-live-review / 2026-10-06

Review only. Private branch `cov/w1-live-review-20261006`, base `437f9a62b9d2341b8b69a0c9f638a99767dd982c`, worktree `/Users/kaizen/heytutor-cov-wt/w1-live-review`. Candidate staging tip `2e75311c39f0e96ff2d0ead44d004aa58f8f1c6d`. All thirteen missing candidate/prerequisite commits were selected by ancestry and individual diff, then staged separately with original code unchanged. No cherry-pick conflicts. Earlier base documentation was preserved rather than applying broad branch diffs. Parent approved replay/optics prerequisites and exact shared paths were announced before writes. Every new commit is authored as Rishi Vhavle; inherited AI coauthor trailers were removed. No stash, root build, remote action, main mutation, ledger/counter edit or novel implementation fix.

## Per-patch verdicts

| Patch | Verdict | Gate evidence | Parent action |
| --- | --- | --- | --- |
| c8814e67 live-fallback | **BLOCK** | Author live-fallback 18 checks passes, circle standard/general gates pass; independent validated ProblemIR rejects contract breach in circle-obligations.ts; circle-boundary.mjs proves exact before/after | Keep blanket exemption out. Narrow equation-obligation discharge while enforcing residual objects and relations. |
| 49069cf2 + 0810b604 + d26a84d6 visual/matrix | **PASS, local review** | visual-need-null 35 checks; matrices-ready 1001; matrix-live.ts 33 checks with valid ProblemIR; V1 two load-bearing in-memory mutations; representation/persistence and type/lint comparisons | Parent may cherry-pick these three independently. No circle/optics dependency. |
| Replay 0d0126ad + 99133658 + c4224484 + 42f34c36 | **PASS, local review** | Real Whiteboard/production hooks: no-settle control 66 px offset plus wrapped continuation; with settle 9 correct rows and zero late restore rows. Replay, replay-ink, lecture-player, continuation, doubt, async, mobile and save checks unchanged green | Parent may cherry-pick full four-commit chain. Runtime immediate reopen/replay remains required for batch lifecycle. |
| Optics 00babeaf + daf3f509 + d0ec611a + 5fc8ed21 + 2400e4b4 | **BLOCK** | rev9 9/9 independent expected outcomes; author 78 rows, 18 recovered, 60 declined, 18 controls; optics-live.ts valid ProblemIR positive/stale/forged-document checks pass. Independent unbound-plan controls newly admit fabricated distances; optics-boundary.mjs proves baseline admission declines the same source/scene | Do not land final chain until normal source/solver bindings exclude invented planner inputs. Never adopt older 00babeaf/daf3f509 alone. |

These verdicts concern patches, not topic acceptance or READY. No real student session was launched by this reviewer. Parent/runtime owns integrated student renders and authenticated batch save/reopen/whole replay. Existing offline Konva race rendering is labelled offline.

## Circle blocker

Source: `Draw the circle x^2+y^2=25 and mark the point P(3,4) and the point Q(8,0).` The dedicated boundary probe supplies schema `problem-ir/v1`, exact source spans, entities circle/P/Q and a graph intent requiring all three, then validates it. Before the candidate exemption, family synthesis returns null. After it, synthesis selects `analytic_curve`, `qualitative_verified`, with labels `x²+y²=25` and `P(3,4)` only. Q(8,0) is absent. Selector/live-save probe reports no save failure. `circleSourceVerified` proves the circle equation but skips every supported visual obligation at the family loop; it does not prove completeness of extra bodies or relations. This is a validator bypass and a newly admitted partial scene. Q-only input is also renamed P(8,0); a line source loses its identity label. The two-point missing geometry is decisive and does not depend on strict label equality.

Repros: `pnpm exec tsx scripts/verify/probes/w1-live-review/circle-obligations.ts` exits 1 with missing-source-object assertions; `node scripts/verify/probes/w1-live-review/circle-boundary.mjs` exits 0 after proving the regression. Outputs: `patched-circle-obligations.log`, `patched-circle-boundary.log`. Boundary code modifies only an in-memory compilation; candidate implementation is unchanged.

## Optics blocker

Source: `Draw a ray diagram for a concave mirror M with an object O in front of it.` Full validated ProblemIR names O/M with exact source spans and contains no distance literals or solve requests. A structurally valid plan supplies invented u=-30 cm and f=-10 cm as givens, quoting only existing nonnumeric phrases. The candidate selects `exact_verified` u=-30, f=-10, v=-15 and liveSceneSaveFailure returns null. A derived u/f/v=-15 plan is also admitted. Derived u/f without v still refuses v, an informative control.

Fresh output says `slotSources={kind:stem,u:plan,f:plan}`. `engineDerivedValues.sourced` accepts `plan` without checking a numeric source witness; the derived-slots/sign-equivalence additions then authorize derived v and magnitude labels. Rebuilding with the same plan is not independent grounding. The stem-only belt has no numeric stem inputs to compare. Normal solver reconciliation only corrects explicitly bound solve results, so it does not remove these unbound givens or derived entries when there are no solve requests.

`optics-boundary.mjs` compiles the exact base `437f9a62` sceneSaveAdmission source in memory against the same concept figure and plan. Base refuses v and magnitude labels; candidate returns null. This is a new admission, not an old unchecked decline. Fix by checking numeric source/solver bindings or honestly declining the unsupported numeric figure, never by trusting planner provenance. No fix written.

Repros: `pnpm exec tsx scripts/verify/probes/w1-live-review/optics-unbound-plan.ts` exits 1 on two admitted unbound controls; `pnpm exec tsx scripts/verify/probes/w1-live-review/optics-boundary.mjs` exits 0 proving base decline/candidate admission. Outputs: `patched-optics-unbound-plan.log`, `patched-optics-boundary.log`.

## Positive and mutation evidence

- Matrix normal live inputs: AB product C with c11=2; source 1/3 with exact double restatement; A order/cell question with a11=19. Each has valid full ProblemIR and ordinary validated TurnPlan. Null verdict permits a complete source program, required survives null, explicit none stands. Equal entries draw and pass live/save. Differing entries decline. Changing the source document cell to -999 cannot compile under unchanged binding. 33 checks, exit 0.
- V1 mutation: removing the derived exception rejects equal 19 on ownership. Removing only the exact value check admits 18 for source 19. Both exact messages/outcomes logged, no reliance on exit alone. Mutants compile in memory and temporary bundles are deleted; source is unchanged. Exit 0 with completion sentinel.
- Circle authority: captured realistic plan r=3 becomes sqrt(7); centre stays (1.5,-2); linked wrong-radius claim withdrawn. Both live-shaped ProblemIR and null controls pass live/save and canonical persistence in the author's 18-check gate. This positive does not close the completeness blocker.
- Optics rev9: both u=40 and u=-40 against stem 30 draw u=-30,f=-10,v=-15 and refuse admission; the correct signed v and allowed magnitude plans admit; stale/unsigned/aliased v and at-C controls refuse. All 9 output records were compared to independent expected values and admit/decline booleans; six reject, three admit. Author corpus 78/18/60 and 18 controls unchanged.
- Optics realistic source-bound full ProblemIR: faithful signed u/f/v admitted, stale object/image values refused, client-forged derivedSlots/signConvention/planAliases cannot authorize wrong v. Exit 0.
- Replay gate holds a real restore WRITE across Replay. Without settle it demonstrates late rows, offset and wrap; with settle it compares row texts and coordinates, zero late restore writes. All affected collateral hooks/persistence gates passed.

## Commands, failure output and limits

Run commands from this private tree, dependencies installed locally via `pnpm install --offline --frozen-lockfile --ignore-scripts`. Built drawing, scene-engine, tutor-core, design-tokens and whiteboard per package. Rebuilt scene-engine after staging. Generated local Prisma client before tutor tsc; no DB connection or production credentials.

| Check | Outcome | Baseline comparison |
| --- | --- | --- |
| `pnpm --filter @heytutor/scene-engine verify` | exit 1, collision_line chemistry-demand only | same failure digest `0f76ce483f9f` |
| All remaining scene verification commands after first red + `pnpm verify:coverage` | green except documented archetype-point-ownership collision | same point-ownership digest `c85a7c23dee4`; coverage digest unchanged |
| 25 focused tutor collateral commands | 24 pass; visual-need-policy Jev context failure only | all exits and failure digests identical, red `d31065d4e71d` |
| Scene-engine and tutor-core tsc | pass | unchanged |
| Tutor tsc, rerun after all reviewer probes | only `_c03-select.ts(14,64)` TS2339 family | identical digest `9982fd4d81a0` |
| ESLint all candidate TS/TSX paths and reviewer probes | zero errors | existing unused `cancellableDelay` warning in useReplay; engine lint clean |
| Dedicated author gates | live-fallback 18; visual-need-null 35; matrices-ready 1001; optics 78 rows/18 controls; replay race | all complete, exit 0; independent blockers remain |

The 57 directly paired command comparisons all match baseline exits and normalized failure-output digests, recorded in `failure-comparison.json`. Full logs are bounded externally rather than committed. The bank-family-compile gate skips because the corpus is not built locally on both trees; no native-bank completeness claim. Existing full tutor chain outside this role was not rerun; relevant 25 collateral gates plus dedicated gates were rerun. Existing DSA entries were executed only as part of the required scene suite; no DSA implementation work. First baseline chain's known red was followed by an initially redundant front-half run; that repeat was stopped, then the uncompleted tail and coverage completed. No missing gate is represented as pass.

Logs: `/Users/kaizen/heytutor-claude-coord/reviews/w1-live-review-logs/`. Manifests record exact argv, exits, messages/digests and log paths. `baseline-scene-tail-manifest.json`, `patched-scene-manifest.json`, `baseline-/patched-tutor-manifest.json`, `baseline-/patched-types-manifest.json`, `failure-comparison.json`, `rev9-comparison.json`, and `staged-map.json` are the machine-readable handoff. New failing dedicated probes intentionally reproduce BLOCK findings and are not added to package verify chains.

## Staging map and exact files

| Original candidate | Private staged commit | Files |
| --- | --- | --- |
| c8814e67 | 040a89bb10d3c7a0b9414f78a1c0a65bf3512baa | `apps/tutor/features/tutor-session/hooks/turn/useQuestionHandler.ts`, `apps/tutor/scripts/verify/fixtures/live-fallback/gf-fractional-turnplan.batch6a.json`, `apps/tutor/scripts/verify/fixtures/live-fallback/point-line-diagram-turnplan.batch4.json`, `apps/tutor/scripts/verify/fixtures/live-fallback/point-line-plain-turnplan.batch3b.json`, `apps/tutor/scripts/verify/verify-live-fallback.ts`, `packages/scene-engine/src/index.ts`, `packages/scene-engine/src/ir/circleSourceAuthority.ts`, `packages/scene-engine/src/synthesize/familyScene.ts` |
| 49069cf2 | d5c6b4976a672875be823c25ef9ff848eb05a649 | `apps/tutor/features/tutor-session/hooks/turn/useQuestionHandler.ts`, `apps/tutor/features/tutor-session/lib/scene/visualRequirement.ts` |
| 0810b604 | c90a74c44cbea743fe33aa960664ad4fa6f1a560 | `apps/tutor/scripts/verify/verify-visual-need-null.ts` |
| d26a84d6 | 9401e559d15d4869aca6a870606e0c98f5723661 | `apps/tutor/scripts/verify/verify-matrices-ready.ts`, `packages/scene-engine/src/compile/matrixSourceBinding.ts` |
| 0d0126ad | ed85619f220fbb495fc6676b9beeec5a1f5d6328 | `apps/tutor/scripts/verify/fixtures/replay/circle-s3-turn.json`, `apps/tutor/scripts/verify/verify-replay-work-column-origin.ts` |
| 99133658 | 2613811903d796af5ce793f846ec747716fd823b | `apps/tutor/features/tutor-session/TutorSessionShell.tsx`, `apps/tutor/features/tutor-session/hooks/useBoardSession.ts`, `apps/tutor/features/tutor-session/hooks/useReplay.ts` |
| c4224484 | 15ac9faad577a743880a91bfe1f17cc8bbc7c52f | `apps/tutor/scripts/verify/verify-replay-work-column-origin.ts` |
| 42f34c36 | 1b869a8e37aed9ea795512e8b2847552817bf395 | `apps/tutor/scripts/verify/verify-replay-work-column-origin.ts` |
| 00babeaf | 94fc9891f5abcf1d50665355dac4ef628673de96 | `packages/scene-engine/src/archetypes/generators/optics.ts` |
| daf3f509 | 0860934a66b76ead9ba139f6cccbc85cc90bd79c | `apps/tutor/lib/scene/sceneSaveAdmission.ts`, `apps/tutor/scripts/verify/fixtures/optics/shared-fixes-optics-rows.json`, `apps/tutor/scripts/verify/verify-optics-provenance.ts` |
| d0ec611a | 0e4dbb5d40d052275c472095f2c8ba5861687482 | `packages/scene-engine/src/archetypes/detect.ts` |
| 5fc8ed21 | 3cca649269e6c4f47f30c32f0671b462c637e819 | `apps/tutor/lib/scene/sceneSaveAdmission.ts`, `packages/scene-engine/src/archetypes/generators/optics.ts` |
| 2400e4b4 | 2e75311c39f0e96ff2d0ead44d004aa58f8f1c6d | `apps/tutor/scripts/verify/verify-optics-provenance.ts` |

## Integration and unresolved work

Parent alone integrates into `/Users/kaizen/heytutor-claude-handoff`. Cherry-pick only the visual/matrix and full replay mappings above as presently cleared. Never merge the complete private staged tip: it intentionally contains both blocked candidates for review. Circle narrower completeness and optics source-binding fixes require parent ownership or a separately agreed edit scope. Potential later conflicts: familyScene circle/physics completeness, useQuestionHandler source authority/wiring, and sceneSaveAdmission physics/optics provenance. Private staging had none. Runtime needs integrated matrix student render and immediate replay lifecycle. Source-program reporting for non-matrix lanes, 3-second client timeout policy, optics lens-maker medium detection, native/holdout obligations and historical point-line source gap remain outside these candidate changes. No counters or accepted rows changed.


## Parent disposition, reported 6 October 2026

Parent reported cherry-picking only the cleared visual/matrix and replay chains into handoff `f459df7b`, with no conflicts. Blocked circle and optics are kept out. Parent per-package builds and subset checks are in progress; this reviewer does not claim their completion. Laplace owns real matrix/replay student runs on the integrated head. Review slot is released after the evidence/probe commit; there are no novel fixes in this review branch.
