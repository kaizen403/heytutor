# W2 circle domain / terminal decline — F1 + F4

Disposition: **integration_pending; READY=0; accepted=0; count delta=0**.
This is a bounded acceptance repair, not a topic certification or a ledger update.

## Ownership and contract

- Worker: Codex in the user-designated worktree only; integration owner: parent coordinator.
- Worktree: `/Users/kaizen/heytutor-cov-wt/w2-circle-domain-fix-20261006`.
- Base: `f83aa01f094c2977c0d242f484977d682b9b9699`; date: 6 October 2026.
- Specification: the user's F1/F4 assignment and findings 1/4 in
  `/Users/kaizen/heytutor-claude-coord/reviews/w2-section-circle-acceptance-20261006.md`.
- Read AGENTS, coverage plan, matrix index/progress contract, session ownership,
  review report and reproduction scripts. Announced shared synthesis and new verify
  ownership before editing. Standards/Spec review performed directly; no agents/forks.
- Owned changes: `src/ir/circleSourceMath.ts`, `src/ir/circleSourceProgram.ts`,
  `src/ir/sceneSourceAuthority.ts`, `src/synthesize/familyScene.ts` under scene-engine,
  new `scripts/verify/verify-w2-circle-domain-decline.ts`, and this worklog.
- F2 section whole-IR/native unary, F3 circle Plan correspondence and F5 source-only
  Plan persistence remain with other owners. No changes to their files, applications,
  tutor-core source, other math functions, shared gates or counters.

## Behavior and independent evidence

F1 validates the constant divisor and its nonzero value before iterating numerator
coefficients. The shared exact reducer now rejects zero-map divisions, variable
divisors, nested undefined divisions and domain loss through multiplication or
cancellation. Both source expressions and full caller IR take that reducer.
`0/7`, `(x-x)/(-2)` and `0/(x-x+3)` remain admitted.

F4 reads the whole circle program before older synthesis paths. `declined` returns
no normal or last-resort scene. The actual-question/full-IR source guard emits fatal
`circle_source_declined` independently of candidate metadata, provenance or IDs.
It rejects genuine base-generated partial documents, including markerless documents,
at compile, offline live admission, canonical save, stored read and restore.
Compile controls supply the actual caller question in `sourceAuthority`.

Reader scope now distinguishes exact noncircle conics and symbolic unsupported
conics from recognized circle programs. A generic circle plus a point or physics
quantity does not establish a Cartesian circle definition. Numeric Cartesian
arithmetic that fails before coefficient classification cannot escape via an absent
circle keyword. Undefined terms on both sides of an implicit equation are refused.
No topic router, source-surrogate IR, model ink, authority flag, layout override or
validator waiver was introduced.

The independent positive is:
`Find the centre and radius of circle K 3x^2+3y^2+12x-18y+12=0 and mark point J(1,3).`
Completing the square gives `(x+2)^2+(y-3)^2=9`: centre `(-2,3)`, radius `3`.
J is a physical source point `(1,3)` on K, with its own rendered identity/caption.
The independently constructed full IR binds all three coefficient-formula requests,
retains the identical caller object and remains unchanged. Extra undefined function
expressions reject the entire original graph, even while its scalar solve requests
are correct. Absent-IR direct source synthesis remains allowed without a surrogate.
Standard origin, translated, fractional-declaration and singleton positives pass.

Source suffix negatives include radius 4, duplicate J(2,3), tangent, area, extra line
and physical-unit clauses. Each reader declines; normal/last-resort synthesis cannot
fall through. Unrelated ellipse/hyperbola/symbolic-conic and generic circle-math
normal outputs are compared with the base and remain identical.

## Commands and receipts

Artifacts and external reproducible runners are owned in
[/Users/kaizen/heytutor-claude-coord/integration/w2-circle-domain-fix/](/Users/kaizen/heytutor-claude-coord/integration/w2-circle-domain-fix/).
Every command uses the requested PATH prefix:

```sh
PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
```

Node `v24.21.0`; pnpm `10.32.0`. Commands run from this worktree unless noted.
Final logs use `final-` where indicated. Earlier successful receipts are separate.
The initial symbolic-conic scope failure was corrected; that diagnostic log was
overwritten during refinement and is not represented as a final pass receipt.

| Command | Result / receipt |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | Exit 0, fresh own install, 666 packages, 0 downloads; `install.log` |
| `pnpm --filter @heytutor/drawing build`, then scene-engine, tutor-core, whiteboard separately | Four exits 0, own sequential builds; `build-{drawing,scene,core,whiteboard}.log`; scene-engine rebuilt after its final source change |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-circle-domain-decline.ts` | Exit 0, **460 checks**, TS + own built ESM; `final-domain.log` |
| Same gate with `--api <artifacts>/base-index.mjs --math <artifacts>/base-circleSourceMath.mjs` | Expected exit 1, **241 checks / 105 failed expectations**; `final-domain-base.log`; repeated expectations are not distinct defects |
| `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json <artifacts>/lifecycle.ts` | Exit 0, **61 rows / 305 boundary checks**; `final-lifecycle.log`, `lifecycle-results.json`; uses unchanged app helpers and own ESM |
| scene-engine `tsx scripts/verify/verify-w2-circle-source.ts` | Exit 0, **352** existing full-IR/source controls; `final-circle-source.log` |
| scene-engine `tsx scripts/verify/verify-w2-source-identity-joins.ts` | Exit 0, **8** shared whole-source binding controls; `final-binding-core.log` |
| scene-engine `tsx scripts/verify/verify-circle-operators.ts` | Exit 0, **580** metric/rejection checks; `gate-circle-operators.log` |
| scene-engine `tsx scripts/verify/verify-problem-ir.ts` | Exit 0, local deterministic solver/ProblemIR gate; `gate-problem-ir.log` |
| scene-engine `tsx scripts/verify/verify-visual-obligations.ts` | Exit 0, **299** controls; `gate-visual-obligations.log` |
| scene-engine `tsx scripts/verify/verify-w2-section-matrix.ts` | Exit 0, existing section/matrix gate; `gate-point-line.log`; no new section assertions |
| tutor `tsx scripts/verify/verify-w2-circle-lifecycle.ts` | Exit 0, **24** existing offline lifecycle controls; `gate-circle-lifecycle-existing.log` |
| scene-engine and tutor-core `typecheck`, `lint` separately | Four exits 0; inherited lint warnings 4 / 1, no errors; `final-{typecheck,lint}-scene-engine.log`, `{typecheck,lint}-tutor-core.log` |
| scene-engine `eslint scripts/verify/verify-w2-circle-domain-decline.ts` | Exit 0; `final-new-gate-lint.log` |
| `node <artifacts>/build-base.mjs` | Exit 0; independently bundles base git source using this worktree's dependencies, no checkout or copied build; `build-base.log` |
| `node <artifacts>/compare.mjs` | Exit 0; meaningful base/fixed outputs agree; `comparison.json`, `final-comparison.log` |

Base/fixed failure comparison preserves actual outputs, not merely exit codes:

- `verify-archetype-pictures`: both **KNOWN FAIL**, same `probes=114 scenes=94
  exact=30 generators=75`, same 12 failure rows. Normalized meaningful-output hashes
  match in `comparison.json`.
- `verify-archetype-point-ownership`: both **KNOWN FAIL**, same error
  `collision must retain every physical body and meaningful label: undefined`.
- tutor-core `verify-scene-capabilities`: both **KNOWN FAIL**, same
  `modern-easy-photoelectric: expected family energy_level, got ["chem_orbital"]`.
  Base core gate was independently bundled from git source; import-meta fixture
  paths point to unchanged fixtures in this own tree.
- The unrelated uniform-circular helper control rejects with the same complete
  `ucm_source_mismatch` issue list. This is a bounded old-failure reproduction;
  the full `verify-parallel-circle-standard-topic` requires its external frozen
  checklist and is not claimed run or passed.

## Review and handoff

Direct Standards/Spec review: all edits stay inside the declared ownership;
denominator validation precedes coefficient iteration; terminal decline is driven
by whole actual source rather than candidate marks; none stays available to unrelated
sources; complete caller IR is retained; no acceptance-counter changes. `git diff
--check` passes. Commit only these six explicit paths, as Rishi Vhavle
`<rishivhavle21@gmail.com>`, with hooks disabled for the commit command.

Remaining evidence: no full app/repository build, online provider, environment-file
loading, DB, browser, actual student live run, restart/reopen/replay or screenshot
certification. Offline trust helper calls are not student acceptance. F2/F3/F5 and
parent integration/runtime work are outside this repair. Integration owner must
review and merge this layer; no topic IDs or READY/accepted rows are proposed.
