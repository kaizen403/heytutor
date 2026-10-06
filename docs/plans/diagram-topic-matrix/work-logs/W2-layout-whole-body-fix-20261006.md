# W2 generic layout narration: complete body bounds

Owner: W2 isolated fix worker. Scope: `W2-LAYOUT-01`, generic screen-placement
narration only. Status: **verification_pending** — worker P1 regression fixed;
fresh independent review and parent integration/student qualification pending.
No topic IDs or coverage denominator are assigned to this generic repair.

Base: `ba430af48bfc0a131b1ae717fe1cc61df6f4bb23`.
Worktree: `/Users/kaizen/heytutor-cov-wt/w2-layout-whole-body-fix-20261006`.
Evidence: `/Users/kaizen/heytutor-claude-coord/reviews/w2-layout-whole-body-fix-20261006/REPORT.md`.
Finding: `/Users/kaizen/heytutor-claude-coord/reviews/w2-layout-narration-final-review-20261006/handoff.md`.

Read AGENTS.md, coverage plan, matrix index, progress, session ownership,
layout conventions, fresh finding handoff and its immutable manifest. Validated
all 31 input hashes before work and after checks; previous evidence is untouched.

## Independent expectation and baseline

The real compiler's concentric A/B circles share one centre, and A's radius is
larger. Neither entire circle lies strictly left of or above the other. Summary
provenance on A's body nevertheless removes it from the cache; the remaining
label cache incorrectly supports `B is left of A` in the pinned helper.
Own source and own fresh public ESM reproduce that exact false claim, exit 1.

## Owned changes

- `apps/tutor/features/tutor-session/lib/scene/verifiedLayoutNarration.ts`:
  compute finite primitive envelopes, require every relevant body primitive
  (including summary geometry) and ordinary label anchor to agree with the
  cache, then compare conservative complete bounds. Unsupported/incomplete,
  nonfinite, forged partial, label-only and overlapping extents omit facts.
- `apps/tutor/scripts/verify/verify-layout-whole-body-20261006.ts`: unique gate
  with 42 checks; actual saved Ohm plus ten real-compiler rotations/scalings,
  independent body-extrema oracle, original transport comparisons, and negative
  cache/body/label/completeness cases. Existing gates/fixtures are unchanged.
- `apps/tutor/scripts/verify/fixtures/verified-layout-whole-body-concentric-20261006.json`:
  exact reviewer-authored source oracle; verify-only, never runtime routing.
- This unique work log.

## Checks and artifacts

Node 24.21.0 and pnpm 10.32.0 with the owner's supplied PATH prefix. Own frozen
offline install; own five dependency builds (`--cache=local:w`, zero cached);
no foreign environment, node_modules or dist. Own tutor production build,
sequential typecheck, scoped ESLint and diff whitespace checks pass.

From this worktree's `apps/tutor`:

```sh
pnpm exec tsx scripts/verify/verify-layout-whole-body-20261006.ts
```

Source gate and separately bundled public ESM gate each pass 42 checks. The
retargeted immutable whole-geometry oracle passes both lanes after the fix.
Eight relevant existing presentation/prompt/fallback/label/focus/transport gates
pass. Exact commands, results and public import identity are in REPORT.md.

Before/after concentric source, compiled geometry and compiler report match
exactly. Saved actual Ohm document, plan, IR and solver match immutable inputs;
its original exact 2 A authority is unchanged. Transport comparisons exclude
only promptAddon and preserve ink, intro, anchors, groups, timings and reveal.
The screen brief certifies no physical direction, location, scale or value.

## Remaining obligations

Fresh independent Sol/Luna review is required before the parent actual Ohm run.
No separate reviewer was available here and no agents were created. The parent's
original saved narration FAIL and role/tier trust limitations remain immutable.
Provider/student request, segments, FOCUS/write/reveal, save/reopen/whole-replay
qualification belong to the parent after review/integration. No READY/ledger,
engine/API/hook/teachingArithmetic, provider/Auth/PG or publication operation.
No chapter/topic acceptance or counter change is claimed.
