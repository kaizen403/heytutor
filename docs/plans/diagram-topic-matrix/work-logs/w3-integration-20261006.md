# W3 finite binomial normal engine integration — 6 October 2026

Disposition: **verification_pending; READY=0; accepted=0; countdelta=0**.
This receipt establishes bounded engine integration, not student lifecycle or
live-planner acceptance. The parent owns numeric reconciliation, source quantity
cleanup, tutor-core capabilities and app/DB/runtime integration.

## Ownership and frozen scope

- Worktree: `/Users/kaizen/heytutor-cov-wt/w3-integration-20261006`.
- Branch: `cov/w3-integration-20261006`.
- Pinned base: `296b7e824351da1870bf768727777a5550a532b7`; initially clean.
- Read `AGENTS.md`, `DIAGRAM_ENGINE_COVERAGE_PLAN.md`, the topic matrix index,
  progress contract, session ownership, worker log
  `w3-binomial-20261006.md`, original types/catalog and finite worker APIs.
- The exact shared paths, new contract/gate and this log were announced in the
  session before edits. No agents, forks or Astral. Only this worktree changed.
- The worker's original foundation modules, fixture and evidence log remain
  unchanged. Its historical unwired compiler evidence is preserved in that log.
  Only its two normal compiler assertions now require reviewed source-authorized
  acceptance with all required entities rendered; no mathematical check waived.
- Source version remains the worker's bounded finite rational polynomial v1
  profile. Authored full-IR fixtures are not captured live planner outputs.

## Exact changed paths

All engine paths below are relative to `packages/scene-engine/`:

1. `src/index.ts`: public normal-index exports for kernel, source program,
   pure geometry adapters and the engine source contract.
2. `src/capability/capabilityManifest.ts`: canonical executable/planner-visible
   `finite_polynomial_expansion`. Existing entity kinds are strings; the two
   exact output kinds are exported by the new contract and enforced by complete
   canonical source comparison and the worker construction validator.
3. `src/contracts/finiteBinomialContract.ts` (new): detect finite claims only
   to demand proof; regenerate the entire document from actual caller authority.
4. `src/document/validation.ts`: optional caller `sourceAuthority`, raw candidate
   proof before generic normalization, and normal construction validation.
5. `src/compile/compiler.ts`: normal source-authorized dispatch; normalized
   primitives, measured glyph extents in viewport fitting, exact nonmetric
   metadata, pinned measured label placement against other ink/work obstacles,
   readable-font bounds and atomic decline when layout cannot fit.
6. `src/ir/sceneSourceAuthority.ts`: canonical finite source/full-IR document and
   quantity proof on the callable engine source boundary.
7. `src/synthesize/familyScene.ts`: whole source-program candidate, actual full
   IR preserved, caller authority passed through normal validation/compile and
   all visual obligations. Exact coefficient tier with explicitly nonmetric
   table spacing. Raw question whitespace is preserved for source spans.
8. `src/synthesize/visualObligations.ts`: complete source document proof before
   finite obligations; source-proved polynomial identity joins rather than a
   label/metadata waiver. Missing rows/reveals remain fatal even for unlabelled IR.
9. `scripts/verify/verify-w3-binomial-integration.ts` (new): normal boundaries,
   independent coefficients, mutations, source TS and built public-index ESM.
10. `scripts/verify/verify-w3-binomial.ts`: two reviewed normal compile assertions
    replace unwired expectations; historical log is untouched.

The eleventh changed path is this unique work log. No app, tutor-core,
progression, measurement-worker, ledger/readiness/counter, provider/environment,
DB/browser, main/stash/remotes or generated artifacts changed.

## Authority and rendering contract

Every finite candidate requires `sourceAuthority: {question, problemIR}` from
its actual caller. The raw candidate is compared with an independently rebuilt
whole document before schema normalization can remove a forgery. Neither
`document.source`, construction inputs, provenance, stored geometry nor an
approval flag can supply authority. Inputs must match the actual question/full
IR, not merely produce the same answer. All source outputs, quantities, exact
rationals, result bindings, entities, required IDs, reveal groups and timeline
must remain canonical. Absence of caller authority declines atomically.

The compiler uses the worker's normalized `finiteBinomialPrimitives`; measured
text extents join normal viewport fitting. It measures all table labels with
the existing label engine/handwriting bounds, checks other ink and the protected
work column, and records font/ink/collision bounds. The engine emits only exact
nonmetric labels, with source-owned entity/group membership. It does not draw
curves, subset topology, invented dimensions or per-question pixel templates.
The existing `finiteBinomialGeometryValue` is invoked on recomputed geometry;
only the selected requested coefficient has a scalar value, including zero.

Changing a caller's actual quantity binding is valid: a cached old document
rejects, while a fresh candidate uses that actual new ID. No fixture quantity ID
is imposed as authority. An extra expression/entity/ask/constraint, changed
source span, same-answer wrong AST, reduced graph or stale scalar is declined,
not silently removed or repaired into a surrogate IR.

## Cases and meaningful controls

Ten normal-path cases: Pascal `(1+x)^4`, signed requested coefficient 216,
rational `1/8,1/4,1/6,1/27`, composite requested coefficient 2, preserved native
2014 Paper 2 Q43 requested coefficient 1113, out-of-degree coefficient zero,
power-zero constant, complete cancellation, 16-row `(1+x)^15` table and raw
question whitespace. Independent expected coefficients are constants/hand
expansion, with the worker gate retaining independent native enumeration
`7+140+462+504=1113`, raw source SHA256 and mathematical controls.

The new gate checks normal structural/source validation, compile, family,
obligations, original SolverResult/result binding, all required/reveal marks,
exact labels, measured bounds/nonoverlap, deterministic fresh JSON compile and
no mutation of source/full IR. It rejects twenty-one candidate forgeries and eight
actual-full-IR mutations, absent/wrong authority, cached own authority, lost
roles, omitted marks, changed reveal order/ownership, metric claims, extra ink,
cycles, normalization-away duplicates and unreadable viewport. A second valid
viewport changes coordinates. Reordered JSONB object keys rederive correctly.
In-memory restore controls are not DB save/reopen/replay acceptance.

## Reproduction and results

Commands ran here with Node v24.21.0 and pnpm 10.32.0, using:

```sh
export PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
pnpm install --offline --frozen-lockfile --ignore-scripts
pnpm --filter @heytutor/drawing build
pnpm --filter @heytutor/scene-engine typecheck
pnpm --filter @heytutor/scene-engine lint
pnpm --filter @heytutor/scene-engine build
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-binomial-integration.ts --artifact
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-binomial-integration.ts --esm
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-binomial.ts
pnpm --filter @heytutor/scene-engine exec tsup src/math/finitePolynomialExpansion.ts src/ir/finiteBinomialProgram.ts src/compile/binomialExpansionGeometry.ts --format esm --dts --out-dir dist/w3-binomial
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-binomial.ts --esm
pnpm --filter @heytutor/scene-engine exec tsc --noEmit --module ESNext --moduleResolution Bundler --target ES2022 --skipLibCheck --strict --typeRoots ../../node_modules/.pnpm/@types+node@22.20.0/node_modules/@types scripts/verify/verify-w3-binomial-integration.ts scripts/verify/verify-w3-binomial.ts
pnpm --filter @heytutor/scene-engine exec eslint src/index.ts src/compile/compiler.ts src/document/validation.ts src/capability/capabilityManifest.ts src/ir/sceneSourceAuthority.ts src/synthesize/familyScene.ts src/synthesize/visualObligations.ts src/contracts/finiteBinomialContract.ts scripts/verify/verify-w3-binomial-integration.ts scripts/verify/verify-w3-binomial.ts
git diff --check
```

All final commands above exited 0. Fresh offline install: all ten workspaces,
666 added, 660 reused, downloaded0, lockfile unchanged; no artifact copies.
Drawing and scene-engine ESM/DTS builds succeeded. The normal public bundle
exports and builds the worker modules; separate worker build is only for its
original standalone ESM gate. Run the separate build after the normal clean
build. Package lint has the four existing DSA warnings and zero errors; owned
files lint and strict gate typecheck have no diagnostics. DSA files are unchanged.

Complete focused gate summaries:

```text
W3 finite binomial normal engine integration (source TS): 341 checks PASS; READY=0 accepted=0; authored fullIR profile, lifecycle acceptance pending
W3 finite binomial normal engine integration (built ESM public index): 341 checks PASS; READY=0 accepted=0; authored fullIR profile, lifecycle acceptance pending
Wave3 finite binomial foundations verified (source): 236 checks; 4 authored core cases + preserved native2014P2Q43; READY=0 countdelta=0 (live/save/reopen acceptance pending)
Wave3 finite binomial foundations verified (built ESM): 236 checks; 4 authored core cases + preserved native2014P2Q43; READY=0 countdelta=0 (live/save/reopen acceptance pending)
Node24 plain ESM normal public index: native coefficient=1113; normal compile/synthesis/source proof, absent-authority, stale quantity and extra-fullIR controls PASS
```

The plain Node control imported only this worktree's freshly built normal
`dist/index.js`, created a complete actual native IR, and called the actual
compiler, validator, source proof, solver and synthesis. No tsx or copied builds.
Scratch evidence: `/tmp/w3-integration-20261006-evidence/scenes.json` contains
all ten compiled scenes with measured ink/collision bounds; it is an offline
engine artifact, not visual student review. Baseline/final gate outputs are in
that same directory. No browser, student render, narration/TTS or DB lifecycle
was exercised.

An intermediate typecheck caught a missing compiler type import; corrected.
The new gate caught its own mistaken expectation that a changed actual result
binding must make fresh synthesis fail; corrected to require old-candidate
rejection and fresh actual-binding preservation. A strict typecheck caught a
nonexistent constraint kind in a negative fixture; it now uses the real
`tangent` contract. These were test/integration corrections, not relaxed source
admission or mathematical bounds.

## Comparison with the pinned current base

Before edits and after integration, each command below ran as
`pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/<gate>.ts`.
Full outputs compared with `diff -q`: all seven byte-for-byte identical.

| Gate | Base / final | Exact summary or unchanged failure |
| --- | --- | --- |
| `verify-scene-engine` | 0 / 0 | scene-engine verification passed |
| `verify-visual-obligations` | 0 / 0 | ok (299 checks); fixtures=3; mutations and live pure-engine controls unchanged |
| `verify-discrete-structures` | 0 / 0 | all checks passed |
| `verify-combinatorics-operators` | 0 / 0 | 7379 exact graph/count checks |
| `verify-derived-value-labels` | 0 / 0 | 220 source-math/claim and atomic rejection checks |
| `verify-operator-accuracy` | 0 / 0 | 319 checks |
| `verify-family-synthesis` | 1 / 1 | `Error: thin lens topic figure must compile`, unchanged at line307 |

The existing thin-lens failure was reproduced before edits; it is retained,
not fixed or waived. Full aggregate engine/app/tutor-core gates were not run.
No other session's W2 or pending sequence/measurement gate was loaded.

## Remaining gaps and handoff

- `maths|5|binomial-theorem`: bounded normal engine integration is verified;
  captured actual planner full-IR profiles, broader source dialects/holdouts,
  student render, teaching/reveal, authenticated save/fresh reopen and whole
  replay remain pending with the parent.
- `maths|5|simple-applications`: only bounded rational finite coefficient products
  have this foundation; symbolic parameters, Laurent forms and equation/inequality
  applications remain gaps.
- General/middle/greatest terms, arbitrary identities, requested coefficient sums
  or modular remainders, infinite/generalized series remain unsupported. No
  topic-level acceptance follows from Pascal identity controls or this operator.
- The unchanged worker admission deliberately rejects extra obligations instead
  of reducing the actual graph. Live profiles outside its reviewed role joins
  remain honest gaps. No claim that the planner already emits this profile.
- Parent must pass actual caller authority at every app validation/compile and
  save/read/restore boundary, use the original SolverResult with actual bindings,
  reconcile planner/narrated scalars and finish its own capability/runtime lane.
- Sequence and measurements are still pending separate integration and were
  not part of this work. W2 optics/runtime stays with the parent.

Local publication only: explicit owned paths, hooks disabled per commit command,
authored by Rishi Vhavle <rishivhavle21@gmail.com>, no coauthor or IDE files.
READY=0; accepted=0; no shared progress/count transition.
