# Independent coordinate persistence source review — HEY-83

HEY-89 identified a potential source-input bypass; HEY-83 independently executed the same five controlled source cases through actual compile/presentation/canonicalization consumers with its own scratch output paths. This is **not** a database write, live Konva screenshot, actual saved-turn persistence or saved replay. It is a trust-boundary finding in the actual metadata canonicalizer that precedes storage.

## Stable source identities and exact command

- `apps/tutor/lib/scene/turnScenePersistence.ts`: `f62654e2dcf7ce25e8a70fca1862554ffed092e9774717bc42bfa24ddcb836db`.
- `packages/scene-engine/src/compile/analyticLineGeometry.ts`: `92d1a77ffa9d8d41266ffad45fa7e5831e312c37767f7ccb6790f8f5786fbf06`.
- `packages/scene-engine/src/contracts/contractsV3.ts`: `24ba4b6c1fd6d3769a82a86451a32c649f8af0c7f21c36bc3131d3e4458a132f`.
- `packages/scene-engine/src/compile/compiler.ts`: `7cd4dd7744a1ba70d28febbb568868d1105684d21bec301900258cf4bb11120b`.

Own probe/artifacts: `/Users/kaizen/.capy/work/diagram-topic-matrix/audits/coordinate-persistence-source-review.{mts,json,log}`. Exact successful command from `/Users/kaizen/heytutor`: `PATH=/opt/homebrew/bin:$PATH pnpm --filter @heytutor/tutor exec tsx --tsconfig /Users/kaizen/heytutor/apps/tutor/tsconfig.json <own-probe.mts>` — exit 0. The explicit app tsconfig maps source imports. The first invocation without it failed with a package CJS/import export error; that was auditor invocation friction, not a product result.

## Confirmed high finding and controls

Complete question: “In Cartesian coordinates, A=(0,0), B=(3,4). Show the distance AB.” The TurnPlanV3 retains exact given coordinates, validates with no issues, and remains unchanged in every case. Source-correct distance is 5.

| Case | Scene compilation | Canonicalization |
| --- | --- | --- |
| Correct inline B=(3,4), no declared quantities | passes | passes |
| Inline B=(6,4), no declared quantities | passes | **passes despite source contradiction** |
| Correct quantity references, declared bx=3/by=4 | passes | passes |
| References with declared bx=6 against source-plan bx=3 | passes | rejects with `scene_quantity_mismatch` |
| Inline B=(6,4) plus all correct declared source quantities bx=3/by=4 | passes | **passes despite source contradiction** |

Actual compiled primitives, not an inferred label: correct-reference case has `kind: label`, `text: d=5`; inline mutation with correct declared quantities has `kind: label`, `text: d=7.211` and changed vector geometry. The simple console probe filtered `kind: text`, so its empty `renderLabels` list is not evidence of absent labels; the full captured renderScene was independently inspected. No screenshot or actual DB record is claimed.

The canonicalizer accepts a source-wrong construction because agreement checks the declared quantity table, not all actual source-bearing numerical construction inputs; a missing solver envelope is also allowed. Merely requiring a nonempty table cannot fix it—the last control has all correct declared values but bypasses them with an inline coordinate.

The finding and exact artifacts were sent to HEY-88, the sole shared-runtime owner, for a generic source-input/source-authority fix with the correct-reference and corrupted-declared-quantity controls retained. No runtime/persistence code was modified by HEY-83/89. This one proof does not establish that all 21 compiled rows are defective. All accepted-topic/source/lifecycle counters remain unchanged by this review.
