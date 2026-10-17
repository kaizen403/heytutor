# Production lesson reliability repairs

This change prevents an audio permission block from silently losing a teaching
step, prevents undelivered work from being marked complete, and repairs several
source-to-diagram admission failures. Deployment now builds outside the serving
directory and verifies the new release before accepting activation.

## Behavior and regression boundaries

| Trigger | Result | Regression |
|---|---|---|
| Native audio playback is permission-blocked | Retain the clip and current beat; show Enable audio and suspend its startup/playback budgets until the gesture, cancellation, or replacement | Actual runner/native player with strict Chrome autoplay and a synthetic local WAV; deterministic pause/cancel controls |
| Playback is blocked after the verified diagram appears | Keep the recovery action visible in drawing/speaking phases without covering the existing board | Actual shell/overlay rendering plus compiled intro, blocked teaching beat, recovery WRITE and cancellation |
| A beat fails after recovery is exhausted | Stop with delivered work retained and the unfinished sentence available to Continue; do not skip ahead and report complete | Actual runner → queue → save registry, failed middle/only beat, successful and resumed controls |
| An obsolete speech/draw task fails | Leave successor audio and narration state alone | Stale timeout, late rejection and draw cleanup cases |
| An older client submits complete with no canonical teaching | Save the attempt as stopped, retaining its checkpoint state | Actual checkpoint handler; narration-only browser speech remains complete without uploaded audio |
| Reciprocal arithmetic includes an inverse unit | Remove the unit exponent with the unit, rather than applying it to the number | Correct equivalent-resistance equations pass; incorrect equations fail |
| A resistor network explicitly nests series/parallel groups | Accept only a unique complete grouping, bounded to four resistors and three levels | Source authority, selection and canonical save; independent nodal solve of emitted wires/symbols; ambiguous and excessive inputs decline |
| Circuit branches are declared across several sentences | Resolve complete branch declarations and preserve source-bound component identities and intermediate resistances | Captured synthetic ProblemIR through solver, reconciliation, selection, reveal and save; varied topology and ambiguous-source controls |
| A projectile question supplies gravity | Bind that gravity into the trajectory and derived range | Supplied gravity reaches figure and canonical save; stale range remains blocked |
| Launch height, speed and gravity disagree with planner values | Bind each quantity by its source role; reject stale cached geometry at selection and save | A 45 m cliff stays 45 m despite nearby 20 m/s; changed values, reordered wording and removed-tag controls |
| Optics plan uses distance magnitudes | Reconcile the magnitude convention with signed Cartesian geometry when values agree | Unsigned and signed controls; wrong distance/sign/magnification rejected |
| A concave mirror plan omits inputs or confuses object and image regions | Recompute source distances, height and region claims; supply these facts to the teaching prompt | Object between F and C, image beyond C; changed object distance and prompt-handoff mutation |
| A moving incline block has an incorrect friction sign | Derive kinetic friction from current velocity before solving the force balance; compile apparatus and both free-body diagrams | Captured incorrect formulation is corrected before arithmetic; reversed motion and unsupported extra-force controls |
| Double-slit film data use SI units or mention a zero-order fringe | Preserve source quantity bindings, compute optical path/phase/shift and prove the film covers the stated slit | Captured formulation through save; upper/lower film and changed-value controls; chemistry routing negatives |
| Planner candidate cannot be admitted under strict policy | Live and lab may independently regenerate and verify source-grounded family/archetype geometry | Source match, demand, compilation, quantity/save checks and solver-block controls; caller-provided fast geometry gets no exception |
| Two explicitly stated hybrid orbitals lack a figure | Compute a two-center schematic; parallel-p overlap is conditional and no whole molecule or bond order is guessed | Source syntax variants, actual family/compile path, unsupported/ambiguous/negated source refusals |
| Save admission rejects fields or quota | Log a fixed reason code, never submitted error text, while keeping existing response codes | Allowlist and privacy controls at the rejection function |
| Build is killed or activation health fails | Preserve or restore the prior release, service and assets | Actual shell/filesystem/archive tests with fake service boundaries; HTTP readiness and lazy-import controls |

The chemistry representation uses explicit hybridization and atomic identities.
Its angular outlines are qualitative, not quantitative radial probability
contours or proof of an actual pi bond. The hybridization model is described in
[OpenStax, Hybrid Atomic Orbitals](https://openstax.org/books/chemistry/pages/8-2-hybrid-atomic-orbitals).
It declines unsupported/ambiguous inputs rather than choosing a molecule.

## Validation

Run `pnpm verify:production-reliability` after shared packages are built. This
gate is required in the PR workflow. It uses authored synthetic fixtures and
does not call model or speech providers. Existing storage-admission,
save/reopen, speech/continuity, scene selection/parity, security, and arithmetic
checks cover adjacent behavior. Deployment checks are
`python3 deploy/aws/verify-ssm-deploy.py` and
`node deploy/aws/verify-release.test.mjs`.

The included `pnpm verify:physics-audit` gate replays five authored physics
questions with captured or empty plans and unavailable or invalid scene-planner
responses (20 combinations). Each must reach verified geometry, board reveal
commands and canonical save. Circuit, incline and interference additionally
replay their captured synthetic ProblemIR through the actual planner/solver
boundary. These are local production-code tests; the follow-up does not make
fresh paid narration calls. Source-computed teaching facts constrain the prompt
but do not independently certify every sentence a model may generate.

The accounting implementation already remeasures legacy fixed estimates and
retains failed saves for retry. These protections are verified here; historical
quota rejection alone does not justify relaxing quota limits or discarding
unverified storage charges.

## Rollout and limits

- No production changes are part of this patch. Follow the bootstrap and
  rollback instructions in [the deploy runbook](ci-cd.md). The old installed
  SSM launcher must be replaced with the reviewed launcher before deployment;
  it otherwise resets the active checkout before loading the new driver.
- Builds fail safely when host memory is insufficient. This prevents damage
  to the live release; it does not manufacture additional build capacity.
  Migrations must remain compatible with application rollback.
- PR #176 separately owns durable failed-turn Sentry events and admin links.
  This patch corrects generic runtime identity, production-only emission and
  intentional socket-teardown noise. Review the integration before deployment.
- Browser permissions still require the user's Enable audio gesture. The
  repair retains the pending step instead of starting a second blocked speech
  transport. The historical browser's exact permission trigger is unknown.
- Nonempty saved rows are not a universal delivery attestation for old clients.
  The current client enforces beat integrity; the server independently prevents
  empty completion. Historical saved data is not rewritten.
- Compiled geometry alone does not certify whole-lesson quality. These tests
  cover the repaired mechanisms, not every question or browser.
- A historical molecular-geometry failure does not reproduce on current main;
  this patch does not claim its cause is established. Historical quota balances
  are also unavailable. Slow first-audio latency still needs measured follow-up.

Raw production evidence, question text, and real identifiers are excluded from
this document, fixtures, and the pull request.
