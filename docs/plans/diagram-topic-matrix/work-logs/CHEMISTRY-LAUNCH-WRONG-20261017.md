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
- Chemistry sweep, scene-engine typecheck, focused engine/new-gate lint, and production-selection gate passed before the final apparatus narrowing. The integration owner runs the full final verify sweep and recorded-run replay before publication.
- Chemistry-lane gate needs local `pnpm exec prisma generate` after the offline `--ignore-scripts` install; its initial attempt stopped on the missing generated Prisma client, before any assertions. No database or provider access is needed to generate it.
- Local red/green JSON and logs, original wrong-output provenance, and both route-map results are preserved in `.context/chem/launch-20261017-v1/wrong-builder/`. The immutable paid baseline remains in `.context/chem/measurement-main-20261017-v1/`.
- No new model calls or spend; no production changes or merges. The graded rerun and broader coverage remain separate work.
