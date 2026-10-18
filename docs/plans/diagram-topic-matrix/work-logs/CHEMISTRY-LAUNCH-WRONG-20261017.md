# Chemistry launch: refuse four wrong baseline figures

Scope: owner brief `17 Oct 20:00 (launch)`, step 1. Base: `c9fa0eca2918fa5425715d45a59b3571068681d2` (`main`). This is a bounded correctness fix; no topic acceptance counters change and no new visual coverage is claimed.

## Cause and resulting behavior

The frozen 80-stem baseline ran twice. Four wrong executions cover three questions:

- **XI-003, both rounds:** alpha scattering was not classified as chemistry. Coulomb law hints admitted an unrelated two-point-charge diagram labelled `q1`, `q2`, `d`.
- **XI-001, second round:** the hydrogen transition comparison tied chemistry evidence against `wavelength` and entered scene planning. Its model-authored level positions did not encode `E_n = -13.60/n²`; numeric annotation labels were displaced from the intended levels.
- **XII-010, second round:** iron corrosion had no recognized subject cue and admitted a model-authored scene. Its correct raw reaction `Fe²⁺ + 2OH⁻ → Fe(OH)₂` became the incorrect visible `Fe²⁺ + 2OH⁻ → Fe` when generic callout compaction split at the product parenthesis.

Recognize corrosion/rusting and coherent scattering apparatus requests as chemistry subject evidence. Resolve a hydrogen/wavelength subject tie only for a comparison containing multiple explicit transition pairs. A single-transition physics question retains its shared route; physics-dominated questions retain their existing precedence. These changes select the existing deterministic chemistry lane. Since no existing family can honour these full requests, production selection declines them and ignores their recorded foreign scene candidates. No model-authored marks or new geometry templates are introduced. The shared callout compiler is unchanged.

## Reproduction and gates

`apps/tutor/scripts/verify/fixtures/chemistry-launch-wrong.json` retains six question/plan projections (both rounds for each question) and their original selected scene response objects, when present. Fixture SHA-256: `839b68b5a4cc21fdd453b0e5d6f0ade43c0b3dbc12913875cbf2ee83cd03ca41`.

The original full ProblemIR and original complete TurnPlanV3 are absent. `run.plan` is a lossy projection, so the gate explicitly reconstructs and validates schema, question, derived provenance and claim text. Lost claim hints cannot be recovered. This is a production-selection reproduction with reconstructed plans, not an identical replay of the original full IR. All six reconstructed plans validate. Before the fix, production selection reproduces all four wrong figures, plus the first-round partial corrosion figure; the first-round hydrogen deadline case remains empty. After the fix, all six decline without runtime errors.

Run `pnpm --filter @heytutor/tutor verify:chemistry-launch-wrong`. The owned gate is also in the tutor verify chain. **24 checks pass**: six recorded executions, nine nearby chemistry requests, six full production physics neighbours, one closest-approach subject negative, and two complete/overlong corrosion callout variants. The initial red run had 17 failures and four passing physics neighbours. Gates test selected production output and rendered labels, rather than primitive counts.

An older Lewis cue independently reads `head-on` as orbital overlap. The exact closest-approach negative therefore asserts that the new subject classifier supplies no chemistry evidence; this PR does not claim to repair that pre-existing family cue.

## Offline evidence and limits

- Own installed packages built serially. No borrowed `dist` or dependency tree.
- Both frozen 1,667-row physics/maths route maps compared with clean current-main baselines: original corpus **60 captured**, current corpus **90 captured**, **zero new, removed, or changed routes** on each.
- Final scene-engine verify sweep: **99 passed / 3 inherited failures / 0 new failures** across102 commands including the package build. The failures are `verify-archetype-pictures`, `verify-geometric-optics-operators`, and `verify-archetype-point-ownership`; their complete stdout/stderr match an independently installed and built clean-main c9fa worktree after normalizing only its absolute path.
- Final engine and tutor **typecheck/lint pass**. The24-check owned gate and `verify-production-scene-selection` pass. The existing tutor `verify-chemistry-lane` suggestion for Le Chatelier/Haber still fails; complete failure stderr matches clean main after its own Prisma generation. This pre-existing missing cue remains visible.
- **604 recorded family replays are completely unchanged**:218 drawn,386 declined,0 exceptions/nonfinite. This checks deterministic family output, not original complete-IR or student-board quality. The six actual wrong-output fixtures separately reproduce all four bad executions before the fix and decline after it.
- Local `pnpm exec prisma generate` completed after the offline `--ignore-scripts` install. Both candidate and clean-main consumer checks use their own generated client; no database or provider access was needed.
- Local red/green JSON and logs, original wrong-output provenance, and both route-map results are preserved in `.context/chem/launch-20261017-v1/wrong-builder/`. The immutable paid baseline remains in `.context/chem/measurement-main-20261017-v1/`.
- No new model calls or spend; no production changes or merges. The graded rerun and broader coverage remain separate work.

## Shared hydrogen-series review repair

Greptile found that the new singular hydrogen-atom cue also captured the supported Humphreys-series request. Restore the original plural strong cue; singular hydrogen adds subject evidence only when the source explicitly contains at least two transitions. The same comparison predicate owns the wavelength tie and debug evidence. No series-name registry was added.

Six new real-wording controls (Lyman, Balmer, Paschen, Brackett, Pfund, Humphreys) fail on the prior head and pass after rebuilding. Each keeps the shared physics lane and actually selects the energy-level family. All30 focused controls pass, retaining the four original wrong-execution declines. Independent QA compares each complete native selection to clean c9fa main and finds byte-equivalent JSON, including geometry/labels/gates; five additional fresh classifier neighbours pass. Own engine build, engine typecheck, scoped ESLint and diff check pass. Evidence: `.context/chem/launch-20261017-v1/wrong-series-*` and `empty-ranker/wrong-series-review.{md,json}`. Final clean-head route/replay receipts are recorded separately; the earlier full99/3 inherited sweep belongs to the earlier validated runtime head. No new model calls.
