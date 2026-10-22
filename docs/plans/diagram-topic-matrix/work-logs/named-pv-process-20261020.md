# Named P-V process operator — 20 October 2026

Scope: one reusable, sealed `pv_process` operator from merged main
`e03960bda9724ea9559db9898529c759bc400ce0`. This is operator evidence, not topic
acceptance. No topic ledger or accepted chapter count changes.

The operator accepts complete named states and isobar/isochor/isotherm/adiabat
edges, owns one shared plot and reuses the thermodynamic law/work kernel. The
[contract](../../../architecture/named-pv-process.md) records physical flat
quantity references, explicitly nonmetric ideal-gas representatives, numerical
and display bounds, sealed scene ownership and the bounded actual-source
grammar used by shared live/save admission.

Test-first development recorded these failures before their fixes:

- Unsupported conceptual isobar; then absent nonlinear law support.
- Physical n=0 rejected by a positive-only kernel scalar adapter.
- Unowned output labels/metadata and visible annotations.
- Uniform sampling exceeded a quarter-pixel final-screen chord tolerance.
- Literal physical coordinates bypassed plan quantity agreement; object-valued
  quantities then bypassed that agreement despite exact references.
- Colliding subscript identities and overlapping process geometry.
- Native plot labels lacked screen-space placement evidence.
- An unrelated point/label could add `gamma=1.4` beside a conceptual plot.
- Independent review found source laws and state roles could be changed while
  retaining internally correct math and plan values. The shared source reader
  closes those live/save counterexamples and refuses unsupported source scope.

Owned gates:

```sh
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-pv-process.ts
pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-pv-process-admission.ts
pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-pv-source-binding.ts
pnpm --filter @heytutor/tutor-core exec tsx scripts/verify/verify-pv-process-contract.ts
```

Source-only development uses the app's source aliases for package imports until
the integration owner serially builds the packages. The planner transport is
mocked; no paid or provider calls, images, deployment or production writes are
part of these gates.

Pre-edit recorded baseline, with frozen core normalizer tree
`5af72f175ed0d619b7c5625efc3b53b5bb5fd79d14bcf2d059bd7ab542f430b0`:
149 development candidates compile 57; 74 explicitly excluded validation
candidates compile 48. All six motivating raw drafts remain refused. These
counts are compilation counts, not correctness grades. Excluded sources do not
supply the design or development examples; question overlap means this is not
an independent holdout claim. Replay and synthetic native artifacts remain
private, with source/manifests/render hashes; no private questions or blind
verdicts are committed.

## Final verification

Serialized engine/core package builds and engine/core/tutor typechecks pass.
Engine/core lint passes with five existing warnings; focused changed app files
also pass lint. The engine gate has 216 strict direct/yield/normalized refusals
plus positive controls for all four laws, both directions, units, work, model
separation and display accuracy. Existing thermodynamics accuracy passes 496
checks. Actual production/selection/save passes 33 checks; source binding adds
187 source/production/selection/server checks. Independent review confirms 21
source-scope negatives and six original wrong-state/law/overlay counterexamples
are refused while a supported physical control still selects and saves.

Eight isolated operator mutations fail actual assertions: remove the endpoint
law check; replace curves with chords; reverse ink direction; admit physical
literals; ignore units; leak conceptual SI work; remove the ideal-gas caption;
remove scene sealing. Two additional mutations fail the source/save gate:
skipping named-state value agreement and removing only the shared server-save
source check. No frozen runtime source was edited for these mutations.

Mocked scoped planner transport is 20,828/11,776 characters (initial/repair), below
the unchanged 24,500/27,000 budgets. Original reusable capabilities pass 33
requests and 76 contracts. Five existing state-plot cards retain complete full
shapes while using coarse compact input shapes, preserving room for the new
operator. Golden corpus, structure-driven scenes and all 31 space-view checks
pass.

The final recorded thermodynamics replay has exactly zero status, phase,
fatal-code or full-render-hash differences: 149 development candidates retain
57 compilable figures; 74 separate validation candidates retain 48. Both use
the same frozen normalizer as the pre-edit baseline. The six malformed motivating
drafts remain refused. The circuit nonregression replay also has zero changes:
1,709 historical circuits retain 1,245 compilable/986 production-valid candidates;
624 mixed candidates retain 405 compilable/346 production-valid candidates.
These overlapping cohorts are not distinct student or run counts.

The new native matrix has 32 synthetic programs, all production-admitted and
selected, with 31 distinct render hashes. A blind judge viewed every distinct
figure: **31 right, 0 partial, 0 wrong**. This covers both modes/directions,
all four laws, shared comparisons, cycles, equivalent units, alternate fit,
steep curves, adjacent segments and representative exponents near one/at 64.
At screen resolution, a near-one adiabat can resemble an isotherm; an initially
flagged verdict was withdrawn after the judge recognized that unspecified gamma
cannot establish a false curve. A steep adiabat can similarly resemble an
isochor while retaining visible volume change. Physical plots show units and
state names without numeric ticks or state-value text. No complete arbitrary
prose coverage or new recorded-model gain is claimed.

Two baseline core-suite failures remain explicit. Generic unscoped repair size
is 27,597 versus base 27,611, both over the unchanged 27,000 limit. The old
capability gate's proof-enum expectations are synchronized with main's existing
loadBranchCount; beyond that stale fixture, the photoelectric expectation still
asks for energy_level while both base main and this branch infer chem_orbital.
That unrelated family-routing behavior is unchanged. No full-suite pass claimed.

All fixtures committed here are synthetic. Recorded questions, IDs, payloads,
images and blind keys stay in ignored private evidence. $0; no paid/provider
calls, manual production change or merge for this PR. No accepted-topic counter
changed. The merge agent owns integration after review.
