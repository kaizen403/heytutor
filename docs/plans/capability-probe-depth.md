# Plan: Capability Probe Depth (Composite / Multi-Difficulty Scenes)

Status: not started
Owner: delegate to a coding agent
Effort: multi-day, incremental per unit

## Objective

Today every diagram-led syllabus unit has exactly ONE passing compile probe in
`packages/scene-engine/scripts/verify-syllabus-corpus.ts` (the `PROBE_SCENE` map).
That proves "the operator exists and one happy-path scene compiles + proves."
It does NOT prove the operator holds up on harder geometry.

Grow **probe depth** per unit toward the difficulty matrix in
`docs/universal-syllabus-capability-plan-v5.md`: each diagram-led unit should
carry scenes at multiple difficulty levels (easy / medium / hard / composite),
each with its own adversarial mutations. The goal is to surface real capability
gaps ("operator exists but fails on a composite scene") before a live student
question does.

## Why this is the highest-value remaining task

- Coverage breadth is done: 17/17 units, 1,410/1,410 measured diagram-worthy
  rows, `missing_operator=0`, `missing_predicate=0`.
- Robustness on the happy path is done: 36/36 adversarial mutations rejected.
- The open risk is **depth**: one scene per unit means a composite question
  (two forces + angle + constraint; a circuit with a parallel branch inside a
  series loop; a function with two asserted points AND a tangent) is untested.

## Hard constraints (non-negotiable)

1. **Corpus is an oracle only** (AGENTS.md rule 6). NEVER add per-question
   templates, per-exam fixtures, or a registry keyed by question text. Every new
   probe must exercise a *reusable* operator/predicate, and any gap must be
   closed by growing that reusable operator — not by special-casing the probe.
2. **Deterministic only.** No network, no LLM, no `fetch` in the harness. The
   script must run offline and exit non-zero on failure.
3. **Invalid candidates never render** (rule 5): a composite scene that fails
   compile must fail cleanly with a fatal `assertion_failed` / topology code —
   the harness asserts this, it does not repair fragments.
4. **Do not weaken existing gates.** Tier A (name-check), Tier A+ (compile),
   Tier A++ (adversarial) all stay green. New depth tiers ADD to the report;
   they must not relax the 19,000-char planner prompt budget or the pinned
   capability contract in `verify-scene-capabilities.ts`.
5. Canvas is 1200×700, origin top-left, diagram zone x 400–900 (rule 1). New
   probe scenes must respect these coordinates.

## Current state (verified facts)

- Harness: `packages/scene-engine/scripts/verify-syllabus-corpus.ts` (1,768 lines).
  - `UNIT_DEMAND` (line ~97): per-unit demanded operators + proof predicates.
  - `PROBE_SCENE` (line ~348): `Record<unitId, candidate>` — ONE scene per unit.
  - `runCompileProbe` (line ~890): validate + compile one candidate.
  - `ADVERSARIAL_MUTATIONS` (line ~1335) + `runAdversarialMutations` (~1362).
  - Report sections: `totals`, `by_unit`, `planner_readiness`, `compile_probe`,
    `adversarial`.
- Probe builders in the same file: `probeScene(unit, stem, spec)`,
  `cartesianProbeScene(...)`, `vectorProbeScene(...)`.
- Pipeline APIs: `validateSceneDocument(raw)` then
  `compileSceneDocument(document)` → `{ ok, report.issues[] }` with fatal
  `code` values (`assertion_failed`, `unsupported_assertion`, topology codes).
- Unit volume ranking (from
  `data/question-bank/reports/syllabus-capability-coverage-2026-08-16.json`
  `by_unit`, sorted by diagram-worthy total desc) — work in THIS order:
  `physics|16` (383), `physics|11` (267), `maths|10` (166), `physics|14` (164),
  `physics|13` (102), `maths|8` (80), `physics|12` (75), then the rest.

## What to build

### Step 1 — Generalize the probe registry to depth levels

Refactor `PROBE_SCENE` from `Record<unitId, candidate>` to a depth-keyed
structure, e.g. `Record<unitId, { easy: candidate, medium?: candidate,
hard?: candidate, composite?: candidate }>`. Keep the existing single scene as
`easy` so nothing regresses. Update `runCompileProbe` to iterate levels and
report per-level `outcome`. Keep `ADVERSARIAL_MUTATIONS` keyed per (unit, level)
so each new scene gets its own mutations.

### Step 2 — Author medium/hard/composite scenes per unit, in volume order

For each unit, add 2–3 new scenes that stress the demanded operators. Use the
unit's real stem shapes from the corpus (`by_unit` sample stems) as INSPIRATION
for the geometry, but encode them as reusable scenes. Examples of the kind of
depth to add (author the actual scenes by reading each unit's `UNIT_DEMAND`):

- `physics|16` (optics): medium = refraction through a slab with two interfaces;
  composite = mirror + lens in one scene with a shared axis and `converges` +
  `snells_law` both asserted.
- `physics|11` (mechanics): composite = two non-collinear forces with
  `vector_sum` + `equal_length` + an `angle_between`, plus a constraint.
- `maths|10` (lines): hard = three collinear points + a perpendicular bisector,
  asserting `collinear` + `perpendicular` + `equal_length` together.
- `physics|14` / `physics|12` (circuits): composite = series loop containing a
  parallel branch; assert `path`, `pathCount`, `sameTerminalPair`, `degree`.
- `maths|8` (functions): composite = two asserted `function_value` points plus
  a `root` on the same curve.
- `physics|13`: vector with `perpendicular` + `parallel` components asserted
  against a reference axis.

Each new scene MUST compile green via `runCompileProbe`. If a scene cannot be
made to compile with existing operators, that IS a capability gap — record it
as `outcome: "not_implemented"` and surface it in the report; do NOT fake it.

### Step 3 — Adversarial mutations for every new scene

Follow the existing pattern in `ADVERSARIAL_MUTATIONS` and
`verify-optics-operators.ts` (structuredClone → mutate a quantity/coordinate so
a demanded predicate breaks → assert `ok === false` with the expected fatal
code). Every new scene needs at least one mutation per predicate it asserts.

### Step 4 — Report

Add a `compile_probe_depth` (or extend `compile_probe`) report section:
per-unit, per-level outcome, and a totals roll-up `{ levels, passed, failed,
not_implemented }`. Console output mirrors this. Exit 0 while gaps are being
s surfaced, but print a clear `GAPS` line listing any `not_implemented`
(unit, level) so they are visible (same convention as the adversarial tier).

## How to verify

Run from `packages/scene-engine`:

```bash
pnpm exec tsx scripts/verify-syllabus-corpus.ts            # exit 0, depth section printed
pnpm exec tsc --noEmit                                     # clean
pnpm verify                                                # full suite green, exit 0
```

Then persist the report:

```bash
pnpm exec tsx scripts/verify-syllabus-corpus.ts \
  --report ../../data/question-bank/reports/syllabus-capability-coverage-2026-08-16.json
```

Also run repo-wide gates from the root:

```bash
pnpm typecheck
pnpm --filter @heytutor/tutor-core verify   # must stay green (capability contract)
pnpm --filter @heytutor/tutor verify
```

## Done criteria

- [ ] `PROBE_SCENE` generalized to depth levels; existing scenes preserved as `easy`.
- [ ] At least `medium` (and ideally `composite`) scenes for the top 7 units by
      volume, each compiling green.
- [ ] Adversarial mutations for every new scene, all correctly rejected.
- [ ] Any real capability gap surfaced as `not_implemented` with a `GAPS` line
      (and a follow-up note — do NOT close it with a per-question template).
- [ ] Report section added and persisted; full `pnpm verify` + `pnpm typecheck` green.
- [ ] No drift introduced into `verify-scene-capabilities.ts` pinned lists or the
      19,000-char planner prompt budget.

## Reference files

- `packages/scene-engine/scripts/verify-syllabus-corpus.ts` — the file to extend.
- `packages/scene-engine/scripts/verify-optics-operators.ts` — mutation pattern reference.
- `packages/scene-engine/src/capabilityManifest.ts` — operator/predicate registry.
- `packages/scene-engine/src/compiler.ts` — assertion evaluators (add here ONLY if a
  genuinely reusable predicate is missing; that is a separate review).
- `data/question-bank/reports/syllabus-capability-coverage-2026-08-16.json` — unit volumes.
- `docs/universal-syllabus-capability-plan-v5.md` — the difficulty matrix target.
- `AGENTS.md` — rules 1, 5, 6 are binding.
