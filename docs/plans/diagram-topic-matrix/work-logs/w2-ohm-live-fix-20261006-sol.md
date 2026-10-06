# W2 actual Ohm runtime diagnosis and bounded repair — Sol, 6 October 2026

Disposition: **integration_pending**. Three original runtime captures pass the bounded full-IR path offline. The complete new gate remains **RED** on four parent-owned whole-source admission variants. No READY/accepted/FULLY-CERTIFIED counts or shared ledger changed. Parent owns integration and the new runtime render/reopen/replay.

## Assignment and source contract

- Worker: Sol / Codex; integration owner: coordinating parent session.
- Worktree: `/Users/kaizen/heytutor-cov-wt/w2-ohm-live-fix-20261006`; branch: `cov/w2-ohm-live-fix-20261006`.
- Requested base: `c9b48d2d932703b8b60b62b303c21dd1722ee1ad`, from `/Users/kaizen/heytutor-cov-wt/w2-integration-20261006`.
- Exact assigned topic: `physics|12|ohms-law-and-resistance`, CH-02a, existing J/A/N 2026 matrix scope. This is a bounded repair receipt, not a new denominator or topic acceptance.
- Read AGENTS, coverage plan, matrix/index/progress and Physics row, ownership, prior Ohm contracts and the work-log template. Announced the new verification path before editing.
- Owned implementation: **only** `packages/scene-engine/src/ir/statedCircuitAuthority.ts` and `statedCircuitProblemBinding.ts`. Added only the dedicated gate, three actual-capture fixtures and this unique log. Parent-owned source quantity/scene admission, core, app and synthesis modules are unchanged.
- No DB, remote provider calls, browser, environment-key reads, dependency copying, remotes, main changes, ledger/count changes, subagents or other worker runtime changes. Installed dependencies in this worktree from the frozen lockfile; built its packages. The install's standard postinstall generated the local Prisma client without connecting to a DB.

Original runtime: `/Users/kaizen/heytutor-claude-coord/runtime/runs/2026-10-06T0645-w2-63a9863c/evidence`. Manifest: `/Users/kaizen/heytutor-claude-coord/runtime/w2-ohm-live-cases-20261006.json`. Parent reports all three original runs closed, saved HTTP 200 within 120 seconds, `retry_required`, no figure. That original receipt is preserved; no new runtime claim is made here.

The committed fixtures store exchange index 3's exact response body and compact raw IR, the **original canonical plan actually supplied to that IR call** (extracted from `VALIDATED TURN PLAN V3`), the normalizer/binder-produced complete canonical IR, original path/status/base and SHA-256 provenance. Source exchange hashes still match the closed files. No figure cue was added to the questions. Model planning responses had optional/none visual decisions; the captured canonical plans already required a figure. Their derivations are not substituted for source authority.

## Reproduction and diagnosis

Initial command: `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-ohm-live-fix-20261006.ts`. Original red output is retained externally as `initial-actual-red.log`.

All three complete IRs normalized and validated. Single/parallel had `source=false`; tree had `source=true` but full binding declined. Targeted probes identified:

1. Single: the complete source grammar accepted resistor-first supply placement, not battery-first commutation.
2. Parallel: the explicit identical-load declaration needed multiplicity, member identity and a source count operand; one literal could not authorize three anonymous leaves.
3. Tree: exact source spans distinguish the two 3 Ω actors. Literal label-substring matching, unique-by-value entity/AST joins and anchored fact productions rejected the model's ordinary `series/parallel resistor is ...` phrases and bare 6 Ω quote.
4. Tree/parallel requests: actual statements omit the article in `current ... from battery`; their evidence quotes contain it. A closed article alias suffices; extra clauses still decline.

## Bounded implementation

- Normalize only complete source productions for battery/resistor commutation and explicit equal-load expansion. Keep the submitted IR and original source spans unchanged. The canonical source clause still passes the existing whole-source grammar, detector, generator and exact nodal solver. No runtime fixture lookup, per-question template or model-authored geometry.
- Bind each fact to source owners first, then join entities/expressions by actual fact IDs and source span. Numbered equal resistors have distinct one-to-one physical identities; repeated scalar equality alone never supplies them. Connection qualifiers refer to a leaf's immediate source series/parallel parent, not an arbitrary ancestor.
- Compare the full source-derived circuit formula structurally. Repeated equal resistance operands can share a typed literal class, while equal raw scalars with different dimensions, prefixes or count roles decline. Only an explicit identical-load declaration licenses `R/n` or `n*R`; the count cannot be replaced by a solved resistance scalar.
- Preserve the shared per-load `R` given as a `resistor_set` owner only under that explicit source declaration. Keep it distinct from network equivalent resistance, with all actual member IDs and transitive dependency checks.
- Preserve every entity, fact, constraint, representation intent, request and original unknown/derived ID. Check evidence ownership on connected constraints and intents. Body names, source signs/SI prefixes, all asks and the canonical scene comparison remain checked. No generic visual-obligation exemption was introduced.

Independent expectations:

| Original capture | Resistance | Battery current | Branch currents / drops |
| --- | --- | --- | --- |
| single: 12 V, 6 Ω | 6 Ω | 2 A | 2 A / 12 V |
| tree: 3 + (6 parallel 3), 10 V | 3 + 18/9 = 5 Ω | 2 A | 2, 2/3, 4/3 A / 6, 4, 4 V |
| three identical 6 Ω parallel, 12 V | 6/3 = 2 Ω | 6 A | each 2 A / 12 V |

## Checks and retained reds

All final commands use Node **v24.21.0**, pnpm **10.32.0**, with PATH prefix `/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin`.

The complete new gate command is:

```sh
pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json \
  ../../packages/scene-engine/scripts/verify/verify-w2-ohm-live-fix-20261006.ts \
  --report /Users/kaizen/heytutor-claude-coord/reviews/w2-ohm-live-fix-20261006/actual-gate-receipt-final.json
```

The tutor tsconfig is necessary for its normal package aliases when importing the pure app lifecycle functions. Initial copied-gate CJS/ESM/URL and external Node-type-resolution harness errors remain in earlier logs; final retargeted commands use the current owned tree and correct tsconfig. No failure was relabelled as a product pass.

| Check | Final result |
| --- | --- |
| Three untouched raw IR/canonical plan captures through normal normalization, plan-ID binding, source quantity authority, whole-IR obligations, compiler, family synthesis and deterministic solver agreement | PASS; complete input arrays retained; original plans/IR unmutated |
| The three generated scenes through live admission and offline JSON save/read/restore | PASS; no authenticated runtime or actual DB save claim |
| Actual bad-IR and scene mutations through compiler/live/save/read/restore | **58 reject controls PASS**; wrong signs/units/roles/counts, missing asks/source owners/entities, unsupported constraints/intents, wrong nested aliases, same-scalar wrong AST, cross-dimension ambiguity, topology/annotation/reveal mutations |
| Source-only parameter/commutation/count/nesting/sign/residual/limit controls | PASS; six positive source variants, seven invalid variants; four-parallel remains a separately recorded generator gap |
| Complete new gate including whole-source boundary audit | **RED, exit 1: four parent-owned admission gaps**, detailed below |
| Retargeted unchanged `verify-w2-ohm-fullir` (all inherited authored/protected cases, no deletions) | PASS, 60 checks |
| Retargeted unchanged `verify-w2-ohm-corrections` | PASS, 73 checks, including F1–F5/source and transitive-dependency negatives |
| Retargeted unchanged cardinality / unknown-binding gates | PASS, 11 / 6 checks |
| Retargeted independent acceptance controls / findings | PASS, 9 / 13 checks |
| Retargeted parallel Ohm / DC-network gates | PASS, 9 numeric + 5 domain negatives + 6 mutations; DC source oracles + 9 mutations + 40 holdouts |
| Retargeted acceptance supplemental gate | Retained RED, 65/66: `actual-seriesParallelCircuit` generic group obligations without passing full IR; same exact assertion at requested base |
| Retargeted unchanged Ohm-ready | RED: line 81 `drawn` now stops at the first battery-first source-only call (no ProblemIR). The exact base passes the first three and stops at tree. Recognizing battery-first now enters the existing synthesis full-IR requirement; the actual full-IR case passes. This earlier decline is an explicit compatibility change, not byte-identical inherited output. The historical line 463 receipt is not substituted for this newer base |
| `pnpm --filter @heytutor/scene-engine typecheck`, `lint`, `build` | PASS; lint retains the same four DSA warnings, zero errors; ESM and declarations built |
| Dedicated gate TypeScript check with the owned external config and existing Node types | PASS |
| `git diff --check` | PASS |

External artifacts: `/Users/kaizen/heytutor-claude-coord/reviews/w2-ohm-live-fix-20261006/`. Original reports/reproductions were not overwritten. Every copied import, fixture root, URL and output destination was retargeted. `baseline-node24/` reruns the **requested exact pin** using temporary restoration of only the two owned modules, restored in `finally`; no other checkout or dependency tree was modified. `inherited-checks.json`, `checks.json` and the comparison receipt preserve commands, exits and hashes. Earlier Node-26 baseline harness observations are retained separately and are not the authoritative comparison.

### Parent-owned admission gap — required follow-up

`packages/scene-engine/src/ir/sceneSourceAuthority.ts:30` invokes the circuit guard only when `readStatedCircuitProblemSource(question)` succeeds. The source-quantity authority and family selection have corresponding recognized-source conditions. A question containing an extra material clause/ask correctly returns null from the owned whole-source reader/binder, but generic admission can then accept a previously valid candidate.

The new gate preserves four exact red witnesses: single/parallel, each with (a) a bypass-wire clause before Find or (b) an additional power ask. These are negative mutations, not added figure cues or original runtime questions. Observed acceptance at each seam:

| Compiler | Live admission | Offline save | Stored read | Restore |
| --- | --- | --- | --- | --- |
| accepts incorrectly | accepts incorrectly | rejects | accepts incorrectly | accepts incorrectly |

The two analogous tree mutations reject at all seams. The owned guard independently rejects **all** these sources; no null source is called valid and no obligation is dropped. The full new gate exits 1 until shared admission enforces a source decline. Parent should establish this guard from actual complete caller source/IR and physical candidate correspondence, retaining generic/full-IR checks; a submitted provenance marker must not confer permission. No shared patch was applied by Sol.

## Per-topic outcome and handoff

| Exact topic ID | Scope checked | Tier / disposition | Remaining |
| --- | --- | --- | --- |
| `physics\|12\|ohms-law-and-resistance` | Three original common runtime captures plus bounded source/fact/identity/AST controls | Offline `question_representation`; **integration_pending** | Parent shared admission fix, independent review, runtime rerender, authenticated save/fresh reopen/replay and broader native/holdout variants |

Parent can cherry-pick the owned commit, rebuild packages, rerun the complete new gate after closing the shared conditional gap, and rerender the same manifest without adding question cues. Original runtime evidence stays frozen. Internal resistance, arbitrary/ambiguous network grouping, unsupported meter arrangements, four-parallel generation, incomplete/ambiguous typed expression operands and unrecognized whole-source clauses remain honest declines. No live/render acceptance or topic-count increase is claimed.

Commit is explicitly authorized as Rishi Vhavle `<rishivhavle21@gmail.com>`, hooks disabled for that command, no coauthor; no push/merge/deployment. Integration-owner acceptance remains pending.
