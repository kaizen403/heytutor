# W3 bounded micrometer actual-question parser — 6 October 2026

Disposition: **integration_pending**, offline live-admission preparation only.
Worker: W3 / Sol. Parent owns registry, public index, tutor-core and app wiring.
No accepted-topic or readiness counters changed.

## Assignment and scope

Fresh worktree: `/Users/kaizen/heytutor-cov-wt/w3-measurement-source-parser-20261006`.
Branch: `cov/w3-measurement-source-parser-20261006`.
Exact base: `74824e9643030bd4f8ca596e43b2fa489bbba448`, created from the git
repository of `w3-live-authority-20261006`, without its uncommitted changes.
Read AGENTS, coverage plan, topic-matrix index/progress/ownership and the existing
measurement gates/native fixture. Preserved the complete-source and complete-IR
trust layer at `47897f8b` plus review hardening at `74824e96`.

Owned changes only:

- `packages/scene-engine/src/ir/measurementSourceAuthority.ts`
- `packages/scene-engine/scripts/verify/verify-measurement-question-parser.ts`
- This unique worklog.

This is a bounded arithmetic subset associated with `physics|1|least-count`
(CH-34c). Sign and rollover controls relate to `physics|20|screw-gauge-zero-error`
and `physics|20|screw-gauge` (CH-25a), without claiming completion of those rows.
The frozen native source is JEE Main 2021, question 6760331081, in the existing
2026 topic-matrix profile. Source block SHA-256 remains
`2d12b0d5c223fe9713f8a31a6fa8ce17dc6cd946fb4e88e446cce98895409f01`.

## Contract and change

`readScrewGaugeQuestion(question: string)` is pure and takes only the actual
caller question. It factors the previous complete whole-question grammar and
numeric evaluation, without constructing any ProblemIR or caller IDs:

- `none`: no screw-gauge/micrometer source recognition.
- `declined`: recognized instrument source with malformed/unsupported wording,
  metadata, numbers, hidden obligations or asks; issue only, no partial values.
- `ok`: eight role-tagged numeric values in mm/divisions and exact source
  evidence for pitch, least_count, true_reading, zero_error and circular_reading.
  Evidence has question-source UTF-16 start/end offsets and verbatim quotes,
  including OCR whitespace. The diameter role retains both previously accepted
  evidence extents. Native header/options IDs are metadata, never dispatch keys.

This result is **early source correction evidence**, never IR, solver or scene
certification. It has no fact IDs, numericalAuthority or replacement graph.
`readScrewGaugeSource(problem)` now joins actual complete distinct semantic facts
and their checked source spans onto the parsed result. Missing/malformed caller
facts cannot hide source eligibility from the parent pure-parser call. They
still fail the actual trust join or validated authority path.

On the parent follow-up, a main-scale number literal was admitted only when it
matches the independently computed source sleeve value and retains exact
pitch/diameter/zero-error premise joins. The full circular expression still
requires every source fact. Observed/count scalar coincidences remain rejected.
All whole-IR/entity/expression/constraint/ask/plan checks remain in
`verifyMeasurementSourceAuthority`. Caller identity and complete obligations
are retained. Scalar coincidence never proves source lineage. Existing decline
withdrawal and +0/-0 preservation remain unchanged.

Exported `SCREW_GAUGE_QUESTION_GUIDANCE` is 239 words for both TurnPlan and full
ProblemIR prompts, including symbols p/LC/d/e0, law micrometer_reading, no
assumptions, figure-ask limits, exact four-given/five-fact joins and shared actual
requested IDs. It describes general arithmetic AST
operators, exact premise/ask evidence and use of actual caller IDs. It contains
no question-ID, fixture, chapter or per-question dispatch. No planner was edited.

## Independent evidence

Five independent cores use literal expected results, independent of parsed
values:

| Core | Observed mm | Sleeve mm | Circular count | Instrument divisions |
| --- | ---: | ---: | ---: | ---: |
| Frozen native OCR | 2.695 | 2.5 | 39 | 100 |
| Negative error | 2.655 | 2.5 | 31 | 100 |
| Positive sleeve crossing | 1.04 | 1 | 4 | 50 |
| Negative sleeve crossing | 0.46 | 0 | 92 | 100 |
| Mixed cm/m/mm holdout | 2.37 | 1.6 | 77 | 80 |

Extra variants cover signed +0/-0 (count 35), exact sleeve boundary (count 0),
changed metadata IDs, native OCR whitespace/spans and fresh deterministic
results. Twenty-five pure decline controls cover missing premises, unsigned or
double-signed zero error, exponents, literal underflow/overflow, unit case,
nonpositive lengths, negative observed reading, fractional/unbounded divisions,
nonintegral readout, hidden prefix/middle/suffix/second ask, malformed header,
hidden options obligations and duplicate option IDs. Four unrelated sources
return none. Actual caller tests retain a complete graph and demonstrate missing
facts, noncanonical statements, span corruption, duplicates, assumptions and
malformed fact payloads cannot certify; a literal 39 AST also fails certification.
Four parent-follow-up controls accept the source-proven main literal only with
complete evidence, and reject wrong literals, missing premises and unrelated
main evidence.

## Exact checks

Commands below ran in the fresh tree with this PATH prefix and global pnpm:

```sh
PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
```

Node was v24.21.0; pnpm was 10.32.0. Own dependencies were installed from cache
with `pnpm install --offline --frozen-lockfile --ignore-scripts`; no dependency
copying, downloads, lockfile edits or provider calls.

| Command | Result |
| --- | --- |
| `pnpm --filter @heytutor/drawing build` | PASS, own dependency ESM/declarations |
| `pnpm --filter @heytutor/scene-engine typecheck` | PASS after dependency build |
| `pnpm --filter @heytutor/scene-engine lint` | PASS, 4 existing unrelated warnings |
| `pnpm --filter @heytutor/scene-engine exec eslint src/ir/measurementSourceAuthority.ts scripts/verify/verify-measurement-question-parser.ts` | PASS, zero diagnostics |
| `pnpm --filter @heytutor/scene-engine build` | PASS, ESM/declarations |
| `pnpm --filter @heytutor/scene-engine exec tsup src/ir/measurementSourceAuthority.ts --format esm --dts --out-dir dist/w3` | PASS, standalone module ESM/declarations |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-measurement-question-parser.ts` | **51/51 PASS**, 5 independent cores |
| Same parser command with `--built` | **51/51 PASS** |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-measurements-hardening.ts` | **source 69/69 PASS** |
| Same hardening command with `--built` | **ESM 69/69 PASS** |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-measurement-review-fixes.ts` | PASS, 3 decline controls and +0/-0 preservation |
| Same review command with `--built` | PASS, same controls |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-measurements.ts` | PASS, original 5 source cases and 10 fail-closed controls |
| `pnpm --filter @heytutor/scene-engine exec tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --allowImportingTsExtensions --typeRoots ../../node_modules/.pnpm/@types+node@22.20.0/node_modules/@types scripts/verify/verify-measurement-question-parser.ts` | PASS, new standalone gate types |
| `git diff --check` | PASS |

Initial package typecheck failed because fresh local drawing declarations had
not been built. Building that dependency fixed it. An extra standalone script
check initially lacked Node types at scene-engine's package root; selecting its
already installed Node type root fixed it without dependency/config edits.

Pinned before/after comparison used only the owned module's baseline contents
in this fresh tree and restored the worker contents in a `finally` block.
Both versions built successfully. Complete built hardening transcripts are
byte-identical, SHA-256
`b853b9e893906a1ef1e1c9d1fdcf5e824957f332369c1c655dc4d81ac7bd338e`.
The existing hardening gate's `--scene-output` compiled four measurement
segments and three instrument archetypes. Full render-scene JSON (primitives,
anchors, witnesses, labels and layout) is byte-identical, SHA-256
`54095af7e3fb6abdae1f86bf6b1282e9e886e2bff275f39a79bd2283110c1acf`.
This is offline output preservation, not a browser/render inspection receipt.
No existing gate was modified.

Local comparison/build logs are in
`/tmp/w3-measurement-question-parser-20261006/`: baseline/current build and
module-build logs, baseline/current ESM69 transcripts, baseline/current scenes,
current source/built parser and built review logs. Generated artifacts are
ignored and excluded from the commit. The gate itself is the durable evidence.

## Exact gaps and parent handoff

1. Parent must wire source eligibility using the actual question, independently
   of IR validity or canonical fact statements. `ok` supplies early correction
   evidence; `declined` must not become positive admission. Source recognition
   cannot certify incomplete/malformed actual facts or a failed solver graph.
2. Parent owns `sourceQuantityAuthority`, public index exports, registry,
   tutor-core planner and app integration. None is included in this change.
   The new gate is standalone; no parent package-script registry was edited.
3. Only the existing two complete source dialects, explicit signed zero error,
   mm/cm/m lengths, bounded integral scale counts and one circular-count ask
   are supported. Unsupported wording, other instrument programs, exponent
   literals, extra asks or hidden obligations remain explicit declines.
4. There is no verified instrument-readout scene profile. Apparatus/required or
   optional visual requests remain a visual gap, never silently text-only.
5. Live/provider admission, narration, browser, persistence, replay and DB gates
   were not run. No end-to-end or full-topic acceptance is claimed.
6. Full least-count/vernier variants, sheet measurements and other CH-25a/34c
   obligations remain outside this bounded wire arithmetic evidence. All shared
   counts and existing denominator/source boundaries remain unchanged.

Integration-owner disposition: pending independent registry/core/app review and
live lifecycle checks. Commit publication is locally authorized by the user;
no push, remote, main, subagent, Astral or shared-tree mutation was performed.
