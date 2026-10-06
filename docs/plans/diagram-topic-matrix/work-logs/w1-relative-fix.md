# w1 relative source authority repair

Owner: `w1-relative-fix`. Date: 6 October 2026.
Worktree: `/Users/kaizen/heytutor-cov-wt/w1-relative-fix`.
Branch: `cov/w1-relative-fix-20261006`. Base: `2574fd08013bff9089c0693adda66c5ac28b762d`.
Disposition: `integration_pending`, bounded implementation submitted for independent review.

This continues the user-authorized nine-topic READY queue. It repairs source numeric
authority for `physics|2|relative-velocity` and the existing river crossing reader
and authority. It neither declares a topic READY nor sets any row accepted.
The inherited syllabus denominator, topic ledger, readiness counts and validators
are unchanged. The coverage plan, topic index, progress contract, readiness policy,
worktree AGENTS.md, coordination brief/checkpoint and independent physics review
were read before reporting completion.

## Owned changes

- `packages/scene-engine/src/physics/motionPlanAgreement.ts`
- `packages/scene-engine/src/physics/riverCrossingSource.ts`
- `packages/scene-engine/scripts/verify/verify-w1-relative-authority.ts` (new)
- This work log.

Implementation and verify ownership were announced before edits and recorded in
`/Users/kaizen/heytutor-claude-coord/status/w1-relative-fix.md`.
No existing gate or validator was altered. Compiler, index, familyScene,
relativeMotionScene, sourceQuantityAuthority, live/save admission and stored source
validation are outside this worker's write set.

## Root cause and repair

The old checker accepted any stated given literal before joining its named role,
and accepted any allowed value of the same dimension before joining derived roles.
Thus a wrong `v_AB=20 m/s` survived because 20 was A's ground speed; reversed
`v_A=54` and `v_B=72 km/h` survived because both literals appeared in the stem.
Named targets now precede both shortcuts. Pair velocities have signed bindings;
observer and reverse observer pair velocities bind to their own source values.
The existing positive body-speed magnitude convention remains supported.

A known symbol with a wrong or unsupported unit is a typed conflict. It is
withdrawn rather than falling back to membership in another dimension. This
includes `v_AB=20 s`, `v_AB=100 m`, `v_AB=20 kg` and acceleration units on a
velocity symbol. An uncorrected plan with these rows declines the figure. Truly
unbound intermediate lengths remain unjudged and intact. Correction is pure,
retains compatible planner units and tolerates existing rounded values.

The private river digit regex read fractions from their denominator. The reader
now uses `STEM_NUMBER`, `parseStemNumber` and `prepareStem` for both speeds and
widths. Full supported fractions, mixed numbers, vulgar fractions, scientific
notation and grouped widths are read whole. Unsupported expressions, repeated
or unreadable widths, unsupported speed/width units, nonpositive boat speed and
negative current speed decline. Extra unreadable quantities cannot disappear
beside supported ones. River boat/current, single requested crossing time and
explicit downstream/upstream speed roles use the same binding-first checker.

## Independent expectations and controls

The new gate has 54 independent groups. Every authority call uses a validated full
ProblemIR with source facts/evidence, source entities, representation intent and
all schema arrays. Entity labels identify source-visible names (A, B, O, boat),
not invented descriptive proper names. River context is retained in the IR; the
boat representation intent and normal scene demand require the boat and banks.
Supported positive cases also compile on the normal family path.

- Trains: `72/3.6=20`, `54/3.6=15`, `v_AB=5 m/s`, `t=100/5=20 s`,
  `x_meet=20*20=400 m`. Swapped givens, role values equal to another body's
  speed, and bound time/position equal to other allowed literals are corrected.
- West-positive frame: `v_A=-12`, `v_B=18`, `v_AB=-30`, `v_BA=30`,
  `t=5 s`, `x_meet=-60 m`. Correct km/h, minute and kilometre values survive.
- Head-on: `v_A=10`, `v_B=-15`, `v_AB=25`, `v_BA=-25`, `t=20 s`.
  A slower pursuer also keeps `v_AB=-5`, `v_BA=5`; wrong signs are corrected.
- Observer O at 15 m/s: `v_AO=20-15=5`, `v_BO=10-15=-5`,
  `v_AB=10`; frame boost does not change encounter time.
- Fractional river: `v_b=5/2=2.5`, `v_c=1/2=0.5`, width 120 m.
  Shortest time is 48 s and drift is 24 m. Correct 48 is never rewritten to 60.
  Shortest path normal speed is `sqrt(6)`, time `120/sqrt(6)` and upstream
  heading `asin(1/5)`. Degrees and radians survive authority unchanged.
  Along-stream speeds are 3 downstream and 2 upstream, including swapped-role
  rejection/correction controls.
- Whole expression, invalid unit, ambiguous role, mixed unit and impossible
  straight-crossing controls decline. Unknown velocity/time withdrawals also
  remove corresponding unknown rows. Input immutability and idempotence are checked.

## Commands and evidence

All commands below ran from the assigned worktree. Dependencies were installed
fresh with `pnpm install --offline --frozen-lockfile --ignore-scripts` (exit 0,
pnpm 10.32.0, no downloads). Workspace links stay inside this worktree; no
cross-worktree node_modules symlinks were introduced. No root build was run.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @heytutor/drawing build` | PASS |
| `pnpm --filter @heytutor/scene-engine build` | PASS, including declarations |
| `pnpm --filter @heytutor/tutor-core build` | PASS, including declarations |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w1-relative-authority.ts` | PASS, 54/54 independent groups |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-relative-velocity-ready.ts` | PASS, 322 checks |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-kinematics-operators.ts` | PASS, 738 checks |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-stem-numbers.ts` | PASS, 63 checks |
| `pnpm --filter @heytutor/tutor-core exec tsx scripts/verify/verify-mechanics-probe-visuals.ts` | PASS |
| `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-suvat-ready.ts` | PASS, 2,206 checks |
| `pnpm --filter @heytutor/scene-engine typecheck` | PASS |
| `pnpm --filter @heytutor/scene-engine lint` | PASS, four unchanged DSA warnings, zero errors |
| `pnpm --filter @heytutor/scene-engine exec eslint src/physics/motionPlanAgreement.ts src/physics/riverCrossingSource.ts scripts/verify/verify-w1-relative-authority.ts --max-warnings 0` | PASS, zero owned-file warnings/errors |
| `git diff --check` | PASS |

Final local logs use `/tmp/w1-relative-fix-{gate-final,relative-ready-final,typecheck-final,lint-final,lint-owned-final,scene-build-final}.log`.
Other check logs and build logs use the same prefix. The earliest new-gate run
against the original code failed the four reported controls and most added
expression controls (`/tmp/w1-relative-fix-before.log`).

### Mutation proof and baseline comparison

Each original source file was restored temporarily from the assigned HEAD, the
filtered dedicated gate was run, then the candidate bytes were restored in a
`finally` block. These are actual defect reintroductions, not weakened assertions.

- Original motion checker:
  `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w1-relative-authority.ts 'bound relative velocity|swapped named givens|named wrong-dimension v_AB'`.
  Exit 1, 0/6 groups passed. Both requested wrong-unit controls retain their bad
  values on the base and fail; the named value collision and swapped givens fail.
- Original river reader:
  `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w1-relative-authority.ts 'river fractions read'`.
  Exit 1, 0/1 passed, because fractions are truncated.

Artifacts: `/tmp/w1-relative-fix-mutations.json` and
`/tmp/w1-relative-fix-mutation-{motion,river}.log`. The final complete gate runs
after restoring the candidate and includes all mutation controls.

An extra historical gate,
`pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-parallel-suvat-topic.ts`,
ran 618 checks and exited 1 with two compiler gaps: contradictory supplied
position omitted by the construction, in source text and in a source quantity.
Its default invocation refreshed historical artifacts in
`/Users/kaizen/.capy/work/HEY83-parallel-topics/suvat-equations`; this was an
artifact side effect, not a source/gate edit. Subsequent baseline execution used
an isolated copy of its freeze in `/tmp/w1-relative-fix-suvat-isolated`:
`pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-parallel-suvat-topic.ts /tmp/w1-relative-fix-suvat-isolated`.
With both source files temporarily at the base, the same two failures and check
count remain. Normalized `{checks,gaps}` SHA-256 for both runs:
`83645bd9b58589aef986ac3d7d0e6deb52ba718d7327d58d98a8141077c52789`.
Evidence: `/tmp/w1-relative-fix-suvat-digest.json`. No gate expectation changed.

### Read-only parent probe

Exact command:

```sh
W1_REVIEW_ROOT=/Users/kaizen/heytutor-cov-wt/w1-relative-fix W1_REVIEW_RELATIVE=1 W1_REVIEW_OUTPUT=/tmp/w1-relative-fix-independent.json pnpm --filter @heytutor/scene-engine exec tsx --tsconfig /Users/kaizen/heytutor-cov-wt/w1-relative-fix/apps/tutor/tsconfig.json /Users/kaizen/heytutor-cov-wt/w1-physics-review/packages/scene-engine/scripts/verify/verify-w1-physics-review.ts
```

All four reported relative/fraction regressions PASS. Overall result on this
assigned base plus the repair: 19 PASS, 8 BLOCK. Seven relative controls pass;
the remaining relative control is shared live/save admission. The other blocks
are Ohm/UCM/source trust findings outside this write set. This run does not
include the parent's later source-trust commits. The parent subsequently reports
those controls corrected, including relative marker removal in `d7ec3143`.
Their integration, independent review and full integrated verify remain parent-owned.

## Remaining scope and gaps

- This worker ran offline engine/authority checks. No real student render,
  authenticated save, restart, reopen or full replay was performed here.
- Shortest-path fractional inputs can choose the legacy symbolic river scene
  instead of the typed river archetype, even with a time-only correct plan.
  Authority still preserves the independently correct numbers. The new gate
  explicitly tests that authority without claiming this rendering path repaired.
  Repro: river flows at `1/2 m/s`, boat rows at `5/2 m/s`, width `3/25 km`,
  request the time by the shortest path; with `v_b=2.5`, `v_c=0.5`,
  `t=120/sqrt(6)` the source can be `synthesizedFamily` with symbolic vb/vc/vr.
- Adding correct `alpha=asin(0.2) rad` to that plan exposes a separate existing
  legacy unit conversion defect: its internal theta is recorded as
  `0.2013579207903308 degree` rather than converting radians. Read-only
  diagnostic evidence: `/tmp/w1-relative-fix-path-diagnostic.log`.
  The renderer/family path is outside this worker's source ownership.
- River role grammar remains bounded to one independently named boat speed,
  one current speed and a unique supported width. Mixed speed units and
  arbitrary expression evaluation are not newly supported.
- Algebraic/past encounter roots, multiple river strategies and unsupported
  planner symbols are not assigned a newly guessed named binding.
- No ledger edits, remote landing, stash, push, PR, main checkout mutation,
  co-author trailer or additional agent was used. Parent integrates only after
  independent review; READY is distinct from acceptance.
