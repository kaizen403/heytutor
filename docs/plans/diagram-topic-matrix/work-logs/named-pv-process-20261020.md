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

At this evidence draft, old thermodynamics accuracy passes 496 checks, native
engine refusals cover direct/normalized/yield paths, and actual native
admission/selection/save passes 33 checks. Original reusable capability gates
pass 33 requests and 76 contracts. Scoped PV transport fits existing budgets.
The pre-existing unscoped repair budget failure (27,611 > 27,000 on the base)
remains separately reported; no threshold is raised.

Final source replay, mutations, blind native review and package builds are
recorded by the integration owner before publication. They are not implied by
the algebra tests or by this draft log.
