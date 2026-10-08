# EM five-chapter handoff, 2026-10-07

## Identity

- Owned worktree: `/Users/kaizen/heytutor-cov-wt/em-five-20261007`
- Branch: `cov/em-five-chapters-20261007`
- Base HEAD: `834cbd6ad9dea29e5151da6314459be0104b91eb`
- Tested source: that HEAD plus the uncommitted diff in this worktree. Scene compile used a local `@heytutor/drawing` build. That dist is gitignored.
- Publication: uncommitted. No commit, push, or pull request.

## What the batch implements

`explicit_physical_model` is a source-declared solve request. The model name selects a standard case. Topic IDs are not dispatch keys. A grounded owned model returns a scene. An owned failure does not fall through to another family. A foreign prefix stays unclaimed.

Constants `k`, `mu0`, `eps0`, and `e` are explicit inputs. Display scale is not a measurement. Custom drawings are schematics.

Shared repairs these chapters needed:

- Current-element and magnetic-dipole observation points accept a constructed point, because family synthesis rewrites inline `at` / `through` / `start` / `end` into point anchors.
- Parallel branch current marks follow the branch lane, so equal parallel currents no longer share one arrow.
- AC impedance origins accept a constructed point for the same rewrite.

## Declared scope, not certification

| Chapter | Rows | Declared scope |
| --- | --- | --- |
| Current Electricity | 17 | standard cases present |
| Electrostatics | 24 | standard cases present |
| Magnetic Effects of Current and Magnetism | 23 | standard cases present |
| Electromagnetic Induction and Alternating Currents | 14 | standard cases present; ledger stays blocked |
| Electromagnetic Waves | 8 | standard cases present |

86 of 86 assigned rows have a standard case. Best declared scope across models: 74 solved, 11 qualitative, 1 text-only (`physics|13|definition-of-ampere`).

These three measures stay separate:

1. Declared integrated core support: 86/86 rows have a locally verified standard case. That is 86/521 of the primary Maths/Physics rows, about 16.5% of that list, and only the assigned share.
2. Student-runtime READY: unchanged. No lecture-lab smoke, no fresh auth, no reopen, no replay. Runtime is UNRUN.
3. Fully accepted: unchanged. No row was marked accepted. Chapter accepted counters in `progress.md` were not changed.

Ledger: 72 rows are `verification_pending`. The 14 Electromagnetic Induction rows stay `blocked` on the unaccepted CH-02a and CH-05a contracts. Compiled models do not clear that block. `accepted_by` and `accepted_at` are empty. Unrelated ledger rows are byte-identical to HEAD, including CRLF.

## Checks

- `packages/scene-engine` `./node_modules/.bin/tsx scripts/verify/em20261007/verify-em-five.ts` passed: 92 models, 86 topics, ordinary and altered literals, rejections, and the family consumer for every ordinary case.
- `./node_modules/.bin/tsx scripts/verify/verify-chapter-operators.ts` passed: 81 checks.
- `./node_modules/.bin/tsx scripts/verify/verify-ac-operators.ts` passed: 268 checks.
- `./node_modules/.bin/tsx scripts/verify/verify-problem-ir.ts` passed.
- `./node_modules/.bin/tsc --noEmit` passed.
- ESLint on the touched files: clean after unused-import removal.
- The full scene-engine verify suite was not run. Known baseline failures were not waived and were not re-measured.

## Render evidence

One ordinary SVG per chapter, written by the gate:

- `.context/em20261007/current-electricity.svg` (`dc.wheatstone`)
- `.context/em20261007/electrostatics.svg` (`ef.point`)
- `.context/em20261007/magnetism.svg` (`mm.lines`)
- `.context/em20261007/induction.svg` (`ind.faraday`)
- `.context/em20261007/em-waves.svg` (`emw.triad`)

## Still open

Each topic's remaining variants are in `topic-progress.csv` and the agent logs `em20261007-agent1.md` through `em20261007-agent8.md`. Representative parked cases: unbalanced Wheatstone current, non-ohmic curves without a declared characteristic, Earth declination and Curie numbers, radial leads on an arc, 3D helix, and production/application apparatus beyond the qualitative flags.

Next bounded work is one student-runtime smoke per chapter when lecture-lab can run without foreign services or a paid provider. That smoke still would not by itself make a row READY or accepted.

## Correction, 2026-10-07 evening

The sections above are the earlier claim. They are kept as history. They are not the corrected result.

Compilation, helper arithmetic, and a nonempty scene are not diagram coverage. `verify-em-five.ts` no longer treats a synthetic "explicit model" question as a family-consumer pass. That question is rejected. The old SVG writer no longer writes into another checkout's `.context/em20261007`.

### What the repair actually established

- Ungrounded planner inputs do not validate and do not emit a scene. An owned miss does not fall through.
- A grounded Wheatstone question emits only `dc.wheatstone`. The solver recomputes the bound source current. The detector is a ring, not a wire. Internal resistance and galvanometer resistance are explicit inputs. The source path does not cross the detector.
- Bar-magnet field lines leave the north face and enter the south face. The bar label is `N-S`.
- `emw.triad` and `emw.amplitude` label E, B, and k. B is a ring plus an inner dot, out of the page, with E up and k to the right.
- Nine Current Electricity law models have source bindings and compiled label or axis checks: drift, current density, power, Joule heating, resistivity, resistance, temperature, cell, and the ohmic characteristic. `ce.iv_declared` draws axes but is not source-admitted.

### Counts, each topic once

| Measure | Count | Meaning |
| --- | --- | --- |
| Assigned topics | 86 | unchanged |
| Models that still compile | 92 | not coverage |
| Source-admitted standard cases | 10 | 9 law models plus `dc.wheatstone` |
| Topics with that admission and a visual check on the admitted case | 8 full, 2 partial | the 8 law topics above; `iv-characteristics` and `wheatstone-and-metre-bridge` still have an unadmitted sibling model |
| Gallery structural pass | 5 models | wheatstone, bar magnet, triad, amplitude, ampere definition |
| Gallery not independently reviewed | 87 models | compiled and rasterized, then failed closed |
| Student-runtime READY | unchanged | UNRUN |
| Accepted | unchanged | `accepted_by` and `accepted_at` empty |
| Induction rows | 14 blocked | CH-02a and CH-05a still unaccepted. Compiled models do not clear this. |

Declared integrated core support is the 8 law topics whose admitted standard case passed both the source gate and a compiled label or axis check. It is not 86. The other 78 assigned topics stay candidate, partial, or blocked.

### Evidence

- Pre-repair snapshot: `/Users/kaizen/heytutor-cov-wt/em-five-pre-repair-20261007`
- Reproduction: `/Users/kaizen/heytutor-cov-wt/em-five-repair-diag-20261007/findings.json`
- Gallery: `/Users/kaizen/heytutor-cov-wt/em-five-repair-gallery-20261007/index.html`
- The gallery uses `renderSceneSvg`, the existing compiled-primitive board writer. It keeps vector heads, circles, and labels on a 1200×700 board. It is not a Konva screenshot and is not READY.

Agents 2–8 did not land depiction patches. Their standard cases remain unreviewed. The next bounded step is those patches, then one ordinary-question smoke per chapter only if it needs no new paid provider.

## Pilot repair, not a Claude review

Grok 4.7 reproduced two further defects and patched the seams. This is not an independent Claude review. Claude Opus was not available from this session, so those images are not marked PASS.

- Wheatstone: source current is positive from the left terminal to the right, and the right terminal is the higher potential. The long battery plate was on the left. `branchGlyph` now puts the long plate toward the `to` terminal when emf is positive, and flips it when emf is negative. Solved currents were not reversed.
- Bar-magnet curves: compiled primitives still have 25 vertices, but both `renderSceneSvg` and `buildVerifiedDiagramPresentation` drew only the first and last points. Both now stroke the full curve and put the arrowhead on the last segment.
- Checks that passed after the patch: `verify-pilot-defects.ts`, `verify-source-admission.ts`, `verify-em-five.ts`, `verify-chapter-operators.ts`, and `apps/tutor/scripts/verify-pilot-presentation.ts`.
- New images: `/Users/kaizen/heytutor-cov-wt/em-five-pilot-20261008/rasters/`. The earlier collapsed gallery at `/Users/kaizen/heytutor-cov-wt/em-five-repair-gallery-20261007/` was left in place.
- A 1200×700 PNG rasterizer was not available in this environment. The review package is SVG until the owner or Claude can rasterize it. Do not treat that SVG as a Konva capture. Quick Look later wrote 1200×1200 thumbnails; they clip the figure and are not board captures.

## Packet patches integrated, still not Claude-reviewed

Worker snapshots `em-repair-a3` through `em-repair-a8` had passing self-tests. Their packet modules and `verify-agentN.ts` files were copied into this worktree. Shared network files were not copied, so the polarity glyph stayed. Agent 2's snapshot never wrote a file. `verify-agent2.ts` in this tree locks the detector ring and the long-plate side.

Re-run in this worktree after the copy:

- `verify-pilot-defects.ts` passed
- `verify-source-admission.ts` passed
- `verify-em-five.ts` passed (92 models, 86 topics)
- `verify-agent1.ts` through `verify-agent8.ts` passed, except that agent 2's script covers only the Wheatstone detector and source polarity, not the other DC networks

These scripts are the workers' own checks. They are not an independent Claude review and they do not make a topic READY or accepted. The 14 induction rows stay blocked.
