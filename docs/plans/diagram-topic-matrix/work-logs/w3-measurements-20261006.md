# Wave 3 Units and Measurements source authority — 2026-10-06

The original Sol receipt below is historical. Its implementation claims are
superseded by the Luna bounded-hardening receipt at the end of this file.

Owner: Sol. Branch: `cov/w3-measurements-20261006`, base pin `9211b396`.

## Bounded implementation

The new `packages/scene-engine/src/ir/measurementSourceAuthority.ts` exposes
`readScrewGaugeSource(problem)` and
`verifyMeasurementSourceAuthority(problemRaw, planRaw, expectedQuestion?)`.
The reader accepts only a single source-complete screw-gauge measurement with
pitch, least count, true size, signed zero error, and a circular-division ask.
It derives the integer division count from pitch/least count, computes the main
scale mark, applies the stated zero-error sign (`observed = true + error`), and
checks that the requested AST has the exact linked formula shape. Units are
converted to millimetres before arithmetic. Extra numeric clauses and objects,
ambiguous signs, nonintegral division counts, invalid observed readings, and
unsupported or incomplete sources decline.

The authority audit validates and returns the complete `ProblemIR` unchanged,
including its facts, entities, expressions, constraints, representation
intents, and solve requests. A unique `evaluate` request binds the division ask
to a `TurnPlanV3` unknown and derived row. The binding must preserve the answer
unit, source facts, source-text quotes, role-specific given rows, and all four
dependencies. An incorrect bound plan value is corrected; downstream derived
rows and claims are withdrawn. Missing or incomplete authority returns
`declined`, with unsupported measurement rows and linked claims withdrawn where
identifiable.

The new `verify-w3-measurements.ts` gate exercises four finite authored source
cases and the one preserved native source extract. Authored cases cover negative
and positive zero error, a centimetre conversion with an independent oracle,
and a main-scale boundary. The native JEE Main 2021 item `6760331081` retains
the exact OCR wording, options, question-block SHA-256, source-text SHA-256,
and official PDF SHA-256 in `fixtures/w3-measurements-native.json`. Its
independent calculation is 39 circular divisions; the preserved source answer
is not treated as the oracle.

Ten fail-closed controls cover absent ask/request authority, scalar-only and
disconnected coincident ASTs, role collision, incompatible plan units, an
extra measured object, noninteger pitch/least-count ratio, unsigned zero error,
incompatible source units, and a nonpositive observed reading. The simple
arithmetic cases declare `visualRequirement: "none"`; no decorative instrument
figure is produced.

## Checks and boundary

- New source-authority gate: passed, 5 source cases and 10 negative controls.
- `@heytutor/drawing` build: passed from the frozen offline install.
- `@heytutor/scene-engine` typecheck, lint, and build: passed. Lint retains four
  existing warnings in DSA simulator files; the new authority adds none.
- Existing dimension-anchor and instrument-label gates: both passed with
  complete stdout captured before final cleanup and compared with final output;
  both stdout files are byte-identical. These existing shared modules and gates
  are unchanged in this worktree.
- Student-facing render/narration/WRITE/reveal, authenticated normal-path
  integration, save/reopen/replay, and independent review: **unrun**.

This submission is implementation evidence only: **READY 0, accepted-count
delta 0**. The authority is not registered in the shared synthesis/compiler or
normal tutor path. Parent integration can import
`verifyMeasurementSourceAuthority` directly from
`packages/scene-engine/src/ir/measurementSourceAuthority.ts`, after ProblemIR
and TurnPlan construction and before normal solver/teaching consumption. The
parent should preserve the returned full `problem`, use the returned `plan`
only when `status === "verified"`, and treat `declined` as no numeric second
opinion. The existing scene-engine package export barrel was intentionally not
changed because it is shared integration ownership.

Explicit open gaps: actual visual instrument-readout figures remain unsupported
and are not required for this arithmetic question; direct/vernier instruments,
measurement/error propagation, significant-figure rounding, dimensional
analysis, and other Units and Measurements variants are outside this bounded
authority. Native cases and holdouts beyond the one listed item, student
rendering, authenticated lifecycle, replay, and normal-path registration remain
open. No readiness ledger, accepted count, shared compiler, capability,
synthesis, contract, catalog, or existing gate was changed.


## Luna bounded hardening receipt — 2026-10-06

Owner: Luna worker. Worktree:
`/Users/kaizen/heytutor-cov-wt/w3-measurements-whole-fix-20261006`.
Base: `5babcadfaeddc843c01ce73811ef6dd2e4810e6c`.
Disposition: **integration_pending; READY 0; accepted-count delta 0**.
This is the bounded pre-integration measurement repair only, disjoint from the
parent's W2 trust and live fixes. No normal-path registration is included.

### Owned changes and contract

- `packages/scene-engine/src/ir/measurementSourceAuthority.ts`
- `packages/scene-engine/scripts/verify/verify-w3-measurements.ts`
- `packages/scene-engine/scripts/verify/verify-w3-measurements-hardening.ts`
- This work log.

The native JSON fixture is unchanged byte-for-byte. Its raw question, options,
question-block hash, PDF hash and OCR-text hash remain frozen. Both the source
and built-ESM controls execute the verbatim native question and obtain **39**;
changing metadata IDs also obtains 39, proving those identifiers are lexical
metadata rather than authority or dispatch keys.

Source acceptance now consumes the whole question: an optional complete native
MCQ header, an explicit pitch/least-count clause (native wording or the bounded
literal pitch dialect), one measured wire diameter, exactly one circular-scale
count ask with explicitly signed zero error, and optional numeric option pairs.
Hidden statements before/inside/after the stem, additional asks, arbitrary
metadata text and unconsumed option text decline. It no longer searches for a
matching clause and then trusts a numeric-token count.

The complete validated caller `ProblemIR` remains the same object. All actual
facts must be the four distinct givens and sole requested count with exact
source spans, role semantics and clause evidence. Every actual entity must be
the unique source wire or optional screw-gauge component with the correct
role/evidence. Every given/intermediate/result expression is joined by its
AST shape and exact role-premise set, then checked against independent
arithmetic. A coincident scalar, irrelevant cancellation AST or unrelated
expression cannot gain authority through evidence flags. Every equation must
join independently checked expressions of the same measurement role; other
constraints decline. Only a conceptual wire intent and a single bound
`evaluate` request are supported; all actual intents and requests are inspected.

The plan requires exactly four unique actual givens, with role-specific
symbols, signed metric values, source quotes, no uncertainty and no invented
given dependencies. The requested unknown and derived row must share the
explicit caller ID/symbol and a count unit. Their legitimate same-ID pair is
preserved. The result depends on exactly all four actual given IDs, with all
five source facts in its binding and evidence. Correction happens only after
the whole IR and plan join succeeds. The caller graphs are never mutated.
All other numeric outputs, unknowns and unsupported claims are withdrawn even
when the bound result is already correct; on decline every derived output,
unknown and claim is withdrawn, including malformed-plan cases. Withdrawals
are reported explicitly. A declined result has no numerical authority and
must not be consumed as a verified plan.

`observed = true + signed error` determines the sleeve/main-scale mark. Positive
and negative error crossings, exact boundaries, zero error and zero observed
reading are covered. mm/cm/m lengths retain case-sensitive unit authority;
division/divisions/1/dimensionless are the bounded count-unit spellings.
Nonintegral counts, negative observed readings and numerically ambiguous
quarter-division-or-greater roundoff bounds decline. Plain main-scale scalar
metadata no longer proves its origin: it requires the checked pitch-times-mark
AST and true/error/pitch premises. The original gate's intermediate main and
least-count fixture AST/evidence were updated to this real proof contract;
none of its source cases or independent answer oracles changed.

No diagram is produced by this module. Acceptance requires explicit
`visualRequirement: "none"`; optional/required visuals decline with
`visual_instrument_profile_gap`. Apparatus intents also decline explicitly.

### Independent repro and final gates

Own install: Node **v24.21.0**, pnpm **10.32.0**, zero downloads,
`pnpm install --offline --frozen-lockfile --ignore-scripts`. All artifacts are
built in this worktree; none were copied from another tree. Commands below
used the authorized Node-24 path:

```sh
export PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
pnpm --filter @heytutor/drawing build
pnpm --filter @heytutor/scene-engine typecheck
pnpm --filter @heytutor/scene-engine lint
pnpm --filter @heytutor/scene-engine build
pnpm --filter @heytutor/scene-engine exec tsup src/ir/measurementSourceAuthority.ts --format esm --dts --out-dir dist/w3
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-measurements.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-measurements-hardening.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-measurements-hardening.ts --built
pnpm --filter @heytutor/scene-engine exec eslint scripts/verify/verify-w3-measurements.ts scripts/verify/verify-w3-measurements-hardening.ts
pnpm --filter @heytutor/scene-engine exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --strict --skipLibCheck --typeRoots ../../node_modules/.pnpm/@types+node@22.20.0/node_modules/@types --types node --allowImportingTsExtensions scripts/verify/verify-w3-measurements.ts scripts/verify/verify-w3-measurements-hardening.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-dimension-anchors.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-instrument-labels.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-measurements-hardening.ts --scene-output
```

- Original authority: old 5-source/10-negative gate passed. Independent initial
  controls failed **41/47** in both source and our original bundled ESM.
  The expanded controls, still using that original ESM artifact, failed
  **60/67**. These failures include hidden entities, unused expressions,
  unmatched asks, false equations, fact roles, zero-error signs, crossed main
  marks, incomplete dependencies and residual unsupported unknowns/claims.
- Hardened authority: original gate still passes **5 source cases + 10 negative
  controls**; independent gate passes **69/69 source and 69/69 built ESM**.
  Final review added two independently failing controls for negative and
  over-end source spans (67/69 before their bounds fix, 69/69 afterward).
  Exact quoting also requires valid source bounds, without JavaScript slice
  clamping or negative-index aliases.
  The new gate independently creates its IR/plan and does not import the old
  gate's builder. It asserts actual returned values, complete IR identity,
  safe plan cleanup and caller immutability, rather than exit codes alone.
- Drawing build, scene-engine typecheck/lint/build, standalone authority ESM
  plus declarations, and strict typecheck/lint of both owned gates: passed.
  Package lint retains the same four existing simulator warnings, no errors;
  owned module/gates add none. The first auxiliary gate typecheck needed the
  already-installed Node type root; no dependency or configuration was added.
- Existing dimension-anchor and instrument-label gates: passed before and
  after, with complete stdout byte-identical by `cmp`. SHA-256:
  dimension `9d8c5fcb618bfdb40695127d98d145b3816dab98bf4cc33b098a43a79dbb41b0`;
  instrument `ad888d494fed7092fc524a825f9cc30e725b8d491ce484ba3bdc4983f0daaf80`.
- Additional compiled-output comparison: **7 scene records / 262 primitives**
  (four dimension orientations and the three existing instrument-label
  questions), including full geometry/provenance/label output. Captured from
  the unchanged shared engine before the final rebuild and after the final
  rebuild: **65,899 bytes, byte-identical**; SHA-256
  `54095af7e3fb6abdae1f86bf6b1282e9e886e2bff275f39a79bd2283110c1acf`.
  The snapshot helper uses the existing source generator API and built ESM
  validation/compiler; it neither edits nor registers those shared paths.

Local reproducible stdout and scene artifacts are ignored under
`tmp/w3-hardening/`; generated `dist/` artifacts are not committed. The first
snapshot helper attempted a non-exported generator API and failed; its final
version uses the existing generator module and produces the checked records.
This is offline output regression evidence, not a student browser/live smoke.

### Integration boundary and remaining gaps

Parent may directly import the owned module after full caller IR/plan
construction and before numeric consumption. Use the returned whole `problem`
and cleaned `plan` only with `status === "verified"`; a source read alone is
not the complete authority audit. Rebuilding the package barrel does not expose
this module automatically. Parent owns any later normal-path registration.

Conservative limits remain intentional: narrow source wording, exact quoted
spans, role symbols, supported AST order/proof forms and same-role equations;
unrecognized paraphrases, additional stated division premises, rods/other
objects, extra source asks/assumptions, other constraints and solve kinds
honestly decline. Instrument visual profiles, direct/vernier readings,
uncertainty/error propagation, significant figures, dimensional analysis and
whole-chapter coverage remain open. Normal tutor integration, student
render/narration/WRITE/reveal, auth, persistence/reopen/replay, other native
holdouts and independent parent review remain **unrun**. No shared registration,
compiler/core/app, ledger or accepted counter changed; no environment-file/provider,
DB, browser, remote, main, stash, agent/fork or publication operation was used.
