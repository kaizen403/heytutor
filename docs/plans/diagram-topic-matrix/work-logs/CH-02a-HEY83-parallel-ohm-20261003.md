# CH-02a / parallel Ohm topic audit — 3 October 2026

This packet now includes the privately leased grounded adapter implementation for `physics|12|ohms-law-and-resistance`, not topic acceptance. HEY-83 coordinates, HEY-88 integrates shared seams, and HEY-90 owns runtime checks. The initial evidence-only audit below is retained as before evidence; the final implementation disposition is `integration_pending`. Accepted counts remain unchanged.

## Baseline and source contract

- Isolated destination: `/Users/kaizen/.capy/worktrees/jam_01M41BQ2CSZ4P6VAE53CMSGRMY/heytutor`, realpath verified before copying. Initial HEAD was `9218d38c9` (the environment reports remote main, not the requested local-main fork).
- Authorized source: `/Users/kaizen/.capy/work/HEY-89/matrix-closure-freeze04-20261003/bundle05/source`.
- Manifest: `/Users/kaizen/.capy/work/HEY-88/types-acceptance-pilot-20261003/freeze-source-caller-05/manifest.json`, SHA256 `1ce781ac96de9854c090c710717c97ea6e6793fce339c07c9946db9bd58ee372`. All 693 source/compiled/config entries were checked before overlay; destination paths were constrained to this worktree. All 693 remained byte-identical after checks.
- Matrix documents are absent from this checkout/bundle, so index, progress and the Physics CSV were read from MAIN without writing there. Their exact hashes and the reused implementation hashes are in the scratch `source-pins.json`.
- Authoritative row: explicit resistor terminals and DC voltage/current; verify V=IR and potential drop against netlist polarity; zero/infinite resistance require explicit ideal handling. Dependencies are S0 and S1; neither is represented as accepted by this packet.
- The complete MAIN `data/question-bank/questions.jsonl` was scanned: no qualifying exact classified records were found by the Current Electricity topic / “ohm” subtopic queries. This is not a claim that the bank contains no Ohm-related text. The full-file SHA256/query result is in `source-audit.json`. No exam question was shortened into a synthetic assertion or counted as passing.
- The independent physics review identified adjacent frozen text sources: JEE Advanced 2010 Paper 1 Q60 is compound experimental circuit selection, with graphical options absent from the extracted text; JEE Main 2026-04-05 shift 2 has the 10 V/5 A measurement question with 500 mV/200 mA least counts and incomplete/scrambled options. Both whole frozen source files and complete extracted question blocks including options/adjacent number metadata are preserved under scratch `adjacent-source-residuals/`, with hashes and source roles in `adjacent-source-residuals.json`. Neither is a clean ideal two-terminal oracle, so neither is counted as exact topic source credit. Actual graphical option recovery and measurement/compound role review remain visible residuals.
- Evaluation version: `ohm-contract-audit/v1`, authored full ideal-DC declaration documents only, not exam-bank acceptance. Checklist and independent expected constants are in the owned gate and `frozen-checklist.json`; that artifact is emitted before executing any solve. Every case retains its full question and source-span facts in `<case>.source.json`.

## Initial reuse audit and integration boundary (before source lease)

`src/ir/circuitNetwork.ts` already supports exact rational, source-bound positive finite resistors, voltage/current sources and explicit wire/open laws. `src/ir/solver.ts` consumes this network through the current `dc_network` request contract. Source value units, owner, complete assertion context and branch polarity are checked. A second Ohm numeric kernel would duplicate current functionality.

There is no current consumer contract for the proposed private `ohmTopicGeometry.ts`; it was not created. Existing compiler/schema/solver/family routes stayed read-only. The sole code addition is `packages/scene-engine/scripts/verify/verify-parallel-ohm-topic.ts`. Baseline overlay changes are not this packet's patch.

The reusable arithmetic is not adequate rendering coverage. With full ProblemIR, both exact and schematic family candidates are null for all nine positive cases, because generic candidates drop or invent source owners. This is safe rejection but no required-visual credit. Without ProblemIR, six cases return `question_representation` ink with an invented second resistor; voltage-driven cases also add a loop, unnamed intermediate nodes and a generic battery. The current-driven holdout loses its source. These are failed source-consistency diagnostics, never honest schematic passes. Remaining three unstructured candidates are null.

The full-question DC grammar is narrower than the topic: appending intact options rejects the whole context. A literal zero resistor is rejected rather than represented as an explicit ideal short, and literal infinity is unparsed. Explicit wire/open law cases do work numerically; this does not establish source-bound conversion from `R=0` or `R=∞`.

## Frozen independent expectations

For finite passive loads, current is positive from the declared `from` terminal to `to`, so V(from)-V(to)=IR. A current source across the same terminal pair has opposite passive-load current. No display lengths are numeric evidence.

| Case | Complete source setup | Expected V(A)-V(B), load current |
| --- | --- | --- |
| finite | Source A→B 12 V; R A→B 6 ohm | 12 V, 2 A |
| negative-polarity | Source A→B -9 V; R A→B 3 ohm | -9 V, -3 A |
| reversed-reference | Source A→B 12 V; R B→A 6 ohm | 12 V, -2 A |
| prefix | Source A→B 12000 mV; R A→B 0.006 kΩ | 12 V, 2 A |
| zero-voltage-finite | Source A→B 0 V; R A→B 6 ohm | 0 V, 0 A |
| ideal-open | Source A→B 12 V; explicit R law I(A→B)=0 A | 12 V, 0 A |
| ideal-short-current-drive | Source A→B 2 A; explicit R wire law V(A)-V(B)=0 V | 0 V, -2 A |
| holdout-current-drive | Source A→B -3 A; R A→B 7 ohm | 21 V, 3 A |
| holdout-rational | Source A→B 7 V; R A→B 3 ohm | 7 V, 7/3 A |

Five negatives: short across 12 V → `incompatible_network`; short across 0 V → `underdetermined_network` (individual parallel source/wire currents are not fixed); open across 2 A → `incompatible_network`; literal R=0 → `invalid_network_resistance`; literal R=Infinity → `unsupported_source_context`. All produced failed solver results with no values.

Five mutations: stale resistance expression, wrong source orientation, wrong value owner, missing connection and full intact appended options. All rejected atomically with empty solver values. The options case documents a support residual, not a desirable end-user rejection.

## Commands and results

All commands ran with `PATH=/opt/homebrew/bin:$PATH` because the non-interactive shell did not expose Node. Dependencies are read-only MAIN symlinks; `scene-engine/dist` and `drawing/dist` realpaths are private worktree paths. No shared build output, server, TTS, clean, commit, branch, push or PR was used.

Evidence root: `/Users/kaizen/.capy/work/HEY83-parallel-topics/ohms-law-and-resistance/`.

1. `node /Users/kaizen/heytutor/node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs packages/scene-engine/scripts/verify/verify-parallel-ohm-topic.ts`: passed nine direct numeric cases, five ideal/domain negatives, five mutations; each positive also checks the current LocalDeterministicSolverProvider exact value. Final log: `gate.log`.
2. `packages/scene-engine/node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --esModuleInterop --typeRoots /Users/kaizen/heytutor/node_modules/.pnpm/@types+node@20.19.43/node_modules/@types packages/scene-engine/scripts/verify/verify-parallel-ohm-topic.ts`: passed. Initial invocation without explicit Node type roots failed only on missing Node declarations; corrected final invocation is recorded in `typecheck.log`.
3. From `packages/scene-engine`, `node /Users/kaizen/heytutor/node_modules/.pnpm/eslint@9.39.4_jiti@2.7.0/node_modules/eslint/bin/eslint.js scripts/verify/verify-parallel-ohm-topic.ts`: passed, `lint.log`.
4. `packages/scene-engine/node_modules/.bin/tsup packages/scene-engine/scripts/verify/verify-parallel-ohm-topic.ts --format esm --out-dir /Users/kaizen/.capy/work/HEY83-parallel-topics/ohms-law-and-resistance/private-build`: passed, no clean, output is private, `build.log`.
5. `node /Users/kaizen/.capy/work/HEY83-parallel-topics/ohms-law-and-resistance/private-build/verify-parallel-ohm-topic.mjs /Users/kaizen/.capy/work/HEY83-parallel-topics/ohms-law-and-resistance/compiled-execution`: passed the same frozen cases including the two holdouts, `compiled-execution.log`.
6. Rasterized the engine SVG output through installed Sharp into 23 private PNGs: nine structured null boards, nine unstructured diagnostic boards and five rejected-result boards. Initial Sharp entrypoint lookup was corrected to the installed package export; final rasterization succeeded. `contact-sheet.png` and all six nonempty unstructured boards were visually inspected. No source-consistent diagram passed. Blank boards are evidence of null output, not successful illustrations.

`owned-gate.diff` contains the complete owned code patch; `source-pins.json` pins reused source/documents. Evidence-only status does not turn diagnostic `question_representation` labels into honest tier credit. No unchanged gate was rerun or claimed as new acceptance evidence.

## HEY-88 proposal and remaining obligations

1. Extend the existing grounded network-to-scene consumer, not a topic router: draw exactly the declared node/component set from current `dc_network` structure, preserve branch endpoint orientation and source roles, and require source-bound voltage/current/value labels and reveal groups. Use existing generic symbols only where they faithfully represent the element law; do not infer a source or loop from resistance.
2. Preserve full source question/options while validating fact assertions; explicitly reconcile ideal R=0/∞ source declarations with wire/open laws. Keep incompatible and underdetermined cases without fabricated finite results. Do not weaken the current owner/span/unit checks.
3. Until a faithful network consumer exists, reject the generic invented second-resistor fallback even when a caller lacks full ProblemIR. Full-IR rejection already prevents these diagnostic candidates here; live caller routing was not tested.
4. Obtain and independently freeze real topic source questions under S0/S1, then run source consistency, all polarity/ideal variants, proper tier versioning and actual layout/reveal checks. Offline contract declarations do not substitute for this cohort.
5. Queue final student submission/reveal, save, reopen and replay through HEY-90 after HEY-88 independently integrates the shared seam. No runtime or storage check was attempted here.

Initial disposition: `blocked` for full row acceptance; reusable deterministic arithmetic qualified offline for the finite/explicit wire-open subset. This finding led to the private source lease below. Work is uncommitted. Integration-owner disposition and shared counters are intentionally untouched.

## Privately leased implementation and final after evidence

HEY-83 approved `compile/ohmTopicGeometry.ts`, the grounded adapter import/selection hunk in `synthesize/familyScene.ts`, and only generic `symbolPaths()` cases for `dc_current_source`, `wire`, and `open` in `compile/compiler.ts`. After actual image inspection exposed the orientation/lane bug, HEY-83 additionally approved only the final offset assignment in `computeParallelLaneOffsets()`. All edits remain in this isolated worktree; MAIN and other workers' checkouts were never written.

The named module is immediately consumed by the existing family scene entry point. It validates the full ProblemIR against the submitted question, requires consistent existing `dc_network` requests, exactly two declared nodes, one resistor/wire/open load and at most one explicitly supplied DC source, and exactly the grounded node/component entity set. It reuses `solveDcNetwork()` without adding a numeric kernel. Numeric labels are exact, oriented, owner-bound values from that solution or the original resistor law quote; long labels fail the unchanged 16-character label contract instead of truncating source identity. The admitted DC path returns null on failure and cannot fall through to the invented legacy two-resistor scene.

The actual caller contract was read, not inferred: `useQuestionHandler.ts` around 1330 passes `problemAuthority?.problemIR` to `selectVerifiedRepresentation()`, and `representationFallback.ts` at 117/179 passes that full input onward to both family methods. These callers remain unchanged. Existing foreign-planner scene priority and the higher-level non-family fallback path are outside this lease; HEY-88 must independently check those selection boundaries. A null grounded family result is not a claim that every higher-level caller or a turn with absent authority is now safe/live verified.

The document records `groundedSchematic: two-terminal-dc/v1` and remains `question_representation`, `nonMetric: true`. Geometry is a terminal-relative schematic, not a length/scale-based physical claim. It preserves physical node/component IDs and source fact references, retains all explicit sources, exposes signed current references and voltage differences, and creates only label helpers. Existing validation, demand, visual-obligation, compiler, label-layout and reveal machinery remain in force. Reveal order is terminals → components → source-bound values.

Generic open geometry is two separated leads, not an invented switch arm; a wire is a continuous lead; a current source is a circle with an oriented reference arrow. Existing resistor/battery shape cases are unchanged. The negative-voltage battery uses the true positive plate orientation by reversing symbol terminals; the canonical terminal direction now controls parallel lane offset signs so reversed battery/resistor branches remain separate. Actual inspection found this failure before the correction; failed images remain in `after-initial-lane-failure/`, and the red regression log is `lane-regression-failed.log`.

### Final owned gate and commands

The original nine numeric cases and five ideal/domain negatives remain intact. All nine now compile faithful structured scenes through both existing exact/fallback entry points, with assertions for exact grounded owner/terminal sets, source voltage/current symbol orientation, signed load labels, complete three-stage reveal membership, visible value labels and non-overlapping branch body lanes. All five domain/ideal rejections and the original five mutations still produce null scenes and empty solver values. A sixth mutation adds a complete contradictory supplied current residual (`I(R)=1 A`); it also rejects, rather than silently extracting a favorable subset.

Additional controls pass: submitted-question mismatch; multi-load bounded-scope exact/fallback rejection; 15 generic terminal-relative symbol positives across horizontal, vertical and reversed directions; 30 unknown-symbol/degenerate-terminal negatives with no partial scene. Seven same-direction render scenes are byte-equivalent before/after the lane correction, recorded in `same-direction-regressions.json`. Both negative-polarity battery reversal and reversed-resistor-reference cases have separate body lanes after the correction.

The final commands reuse the exact executables recorded earlier, with these changed arguments/paths:

- Owned gate: `.../tsx/dist/cli.mjs packages/scene-engine/scripts/verify/verify-parallel-ohm-topic.ts /Users/kaizen/.capy/work/HEY83-parallel-topics/ohms-law-and-resistance/after-grounded-adapter`; passed, `after-gate.log`.
- Targeted TypeScript: the same explicit `--typeRoots` command over the gate's leased-source/direct-consumer import graph; passed, `after-typecheck.log`. An initial new test object literal needed a typed ProblemIR variable to satisfy the existing loose `ProblemStructureView` input type; final source was rechecked.
- ESLint: `src/compile/ohmTopicGeometry.ts src/compile/compiler.ts src/synthesize/familyScene.ts scripts/verify/verify-parallel-ohm-topic.ts`; passed, `after-lint.log`.
- Private gate build: same no-clean tsup command with `--out-dir .../after-private-build`; passed, `after-build.log`.
- Compiled gate execution: `node .../after-private-build/verify-parallel-ohm-topic.mjs .../after-compiled-execution`; passed including all holdouts/negative/symbol controls, `after-compiled-execution.log`.
- Actual package entry build, from `packages/scene-engine`: `node_modules/.bin/tsup src/index.ts --format esm --dts --out-dir /Users/kaizen/.capy/work/HEY83-parallel-topics/ohms-law-and-resistance/after-private-package`; JavaScript and declarations passed with no clean, `after-package-build.log`.
- Actual private built package export consumer: imported `synthesizeFamilyScene` and `synthesizeLastResortScene` from that built `index.js`; nine serialized positive scenes equal source execution, five negative exact/fallback results stay null, `after-package-consumer.log`. The private output's drawing dependency points to this worktree's pinned drawing dist. The read-only MAIN drawing dist used for source execution has the identical SHA256 `42be1e6aa1625d02cefdd31f946080a7b21542c7d3eb97d9667cc26e44f4425f`. An initial raw-to-JSON comparison failed because undefined object fields are omitted by JSON; JSON-normalized comparison then passed. Node emitted an ESM detection warning for the scratch `.js` output; no configuration was changed.

Final after SVGs were rasterized to 23 PNGs under `after-grounded-adapter/`: all nine structured source-consistent scenes, their nine unstructured legacy diagnostics, and five rejected boards. Every final structured variant was read at 1200×700 and the full contact sheet inspected. All nine structured variants preserve the actual two-terminal source/load layout and signed labels, including visible open gap, explicit short/current source, and separated reversed-reference branches. The six legacy unstructured invented-two-resistor diagnostics remain failures and were not concealed or given topic credit. Before, initially failed after, and corrected after artifacts are retained separately.

### Patch handoff and remaining obligations

Actual changed implementation paths are `src/compile/ohmTopicGeometry.ts`, `src/synthesize/familyScene.ts` and `src/compile/compiler.ts`; owned gate and this unique log are also changed. `grounded-ohm-shared-seams.patch` contains only the narrow leased shared hunks, not whole-file replacement. `grounded-ohm-owned-files.patch` contains the new private module/gate/log. The initial manifest now differs only for the two explicitly leased shared source files; its other 691 paths remain byte-identical. The immutable IR solver/schema, visual obligations and family builders were not edited. The circle worker's compiler import/preflight and circle-builder hunks are untouched and absent from this patch.

Final proposed state: `integration_pending` for the privately implemented explicit-network subset, not `accepted`. HEY-88 must independently apply/review the narrow patch and validate integration. Literal `R=0/∞` source conversion, full natural/native question/options admission, genuine experimental circuit option recovery and instrument measurement/error roles remain explicit unimplemented source-contract obligations. Long source names/value labels beyond the current compact-label limit reject honestly. The current adapter does not supply wider network/chapter support or upgrade legacy unstructured fallback honesty.

Final student submission/reveal, save/reopen/replay and storage checks remain queued through HEY-90; none was attempted. S0/S1 source-cohort acceptance and full independent integration remain outstanding. Accepted count remains unchanged. No commit, branch, push, PR, merge, server or TTS session was created.
