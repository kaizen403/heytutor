# W3 finite binomial: bounded independent-review fixes / 20261006

Disposition: **integration_pending**. Both reported P2 engine findings are fixed
within the assigned boundaries. Topic acceptance and parent integration remain
with the coordinator; no ledger or counter was changed.

## Assignment and frozen source contract

- Worker: Codex, working directly; no delegated agents or forks. Integration
  owner: parent coordinator. Commit authorship: RishiVhavle
  `<rishivhavle21@gmail.com>`.
- Worktree: `/Users/kaizen/heytutor-cov-wt/w3-binomial-review-fix-20261006`.
  Base: `47897f8ba5d80661ea254d86ffb0ec2d209862d5`, initially clean;
  date: 2026-10-06. Combined W3 progression/measurement dependencies retained.
- Bounded repair of the finite rational coefficient/expansion engine for
  `maths|5|binomial-theorem`, including JEE Advanced 2014 Paper 2 Q43. This is
  not an audit of all CH-16 variants or a new capability/coverage allocation.
- Read AGENTS.md, coverage plan, topic matrix/index and binomial rows, progress
  contract/template, session ownership, review instructions and the independent
  report plus focused/render repro sources at
  `/Users/kaizen/heytutor-claude-coord/reviews/w3-binomial-final-20261006`.
  Owned verify path was announced before its first edit.
- Allowed files: the request-span clause in
  `packages/scene-engine/src/ir/finiteBinomialProgram.ts`; the finite binomial
  label-fit block and its required shared typography import in
  `packages/scene-engine/src/compile/compiler.ts`; new
  `packages/scene-engine/scripts/verify/verify-w3-binomial-review-fixes.ts`;
  this unique worklog. All other product/gate files remain untouched.

## Reproduction, changes and independent expectations

1. `Coefficient of x^3 in the expansion of x^3 is`: old source reader emitted
   `Coefficient of`; complete caller IR declined while the shortened requested
   fact admitted. Request prefixes now use the start offset of the polynomial
   capture in the anchored grammar (`d` regex indices), for both request forms.
   Raw question, caller facts, evidence spans, ASTs and all six IR arrays are
   preserved. Complete repeated `x`, `x^3`, and numbered/whitespace `x^7`
   profiles admit; shortened requested facts reject through admission, solver,
   source document and compiler boundaries.
2. Raw Q43 at 650×200 previously compiled at 13 px and `(2-x)^15` at 650×180
   at 14 px. Board snapping makes both 19 px; independent handwriting bounds
   reproduce overlaps, including `690`/`[1113]`, `-1863680`/`2795520` and `8`/`9`.
   The finite-binomial loop now starts at shared `boardFontSize("label")` and
   advances using `nextSmallerBoardFontSize`: 24 then 19. It measures the chosen
   board font and declines with an invalid report and **null renderScene** when
   the minimum cannot fit. Existing report primitive counts describe attempted
   compilation and are not rendered ink. Progression/matrix fitting is unchanged.

The new gate authors complete caller facts and ASTs independently of the reader.
Controls include parenthesized and sum payloads, signed `(3-2x)^5` coefficient
`-720`, rational `(2/3-x/4)^3` coefficients `8/27,-1/3,1/8,-1/64`, and factorial
choice enumeration of every coefficient of `(2-x)^15`. Native coefficients are
enumerated from `2a+3b+4c=k`; the requested coefficient is **1113**. The source
answer marker is preserved and is not the oracle.

Frozen Q43 block SHA256 remains
`e914d105c08c8919cd5be7b55449853dc4c1da4400448aee46d244ddc36f2f6b`;
the actual raw extraction SHA256 remains
`91ca517fdd00714d9a121cb32acd8c3a96c2ccb0773f80785e1d40a75b271a69`.
The gate asserts exact raw inclusion and both hashes. No OCR/fixture edits.

Defaults and 650×500 compile clear at 24 px. Power-15 at 650×250 and Q43 at
650×300 compile clear at 19 px. Q43 at 650×200/250 and power-15 at 650×180
decline. All successful scenes are checked for exact independent coefficients,
required source/header/answer marks, actual board-font equality, handwritten ink
containment/non-overlap, reveal groups, full-IR correspondence, caller
immutability and deterministic fresh JSON recompilation.

## Commands and evidence

All commands ran in this worktree after:

```sh
export PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
```

Node `v24.21.0`; global `/opt/homebrew/bin/pnpm`, version `10.32.0`.
`pnpm install --frozen-lockfile` passed, lockfile unchanged. Own dependency and
package outputs only; no copied node_modules/dist or environment files.
`pnpm --filter @heytutor/scene-engine... build` passed before and after edits.

```sh
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-binomial-review-fixes.ts --artifact=/tmp/w3-binomial-review-fix-20261006-evidence/final
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w3-binomial-review-fixes.ts --esm --artifact=/tmp/w3-binomial-review-fix-20261006-evidence/final
```

Both passed **72/72**; complete source/public-ESM input/output snapshots match.
The same final gate against the old public bundle reproduced 19 failures
(47/66 checks, with further layout checks unavailable for declined monomial
profiles). Baseline source repros also reproduced the two defects.

Artifact root: `/tmp/w3-binomial-review-fix-20261006-evidence`.
`run-checks.py baseline` and `run-checks.py final` contain the exact 18 check
commands; `baseline-checks.json`, `final-checks.json` and every corresponding
raw log retain commands, exits and outputs. `compare.py` asserts **byte-for-byte
output equality**, including both failures; all 18 `compare-*.diff` files are
empty. No path/timing/stack normalization was needed.

| Check | Result, baseline and final |
| --- | --- |
| Engine typecheck / lint | pass; same 4 existing lint warnings |
| Scene engine / ProblemIR and deterministic solver / primitives | pass |
| Derived labels / operator authority / visual obligations | pass; 220 / 319 authority checks |
| Existing W3 binomial foundation / integration TS / integration ESM | pass; 236 / 341 / 341 |
| W3 progression source / integration TS / independent ESM | pass; 260 / 2286 / 301 |
| W3 measurement source / whole-input hardening | pass; 5 source cases + 10 controls / 69 checks |
| Family synthesis | same thin-lens failure at line 307 |
| Source trust | same `assert.ok(carScene)` failure at line 38 |

The new gate also passes standalone ESLint and an expanded TypeScript check
using the artifact `gate-tsconfig.json`; the package config ordinarily excludes
verify scripts. The first artifact-only config omitted Node typings and failed;
adding this installation's existing Node typeRoots made the check pass, with no
dependency/product edits. Both check logs are retained.

`dispatch-snapshot.mjs` captures the old and new **public ESM** progression
source program, full compile result, family result and cross-lane source-reader
declines. `baseline-dispatch.json` / `final-dispatch.json` are byte-identical,
SHA256 `9c4bf65f34cd41a1c64a56f1e927b768fe45f2fdaaacaaa07a7733993b6b6257`.
Existing measurement `--scene-output` uses the respective own public bundle;
all seven measured/instrument render scenes match byte-for-byte, SHA256
`54095af7e3fb6abdae1f86bf6b1282e9e886e2bff275f39a79bd2283110c1acf`.
Twelve complete default/650×500 binomial input/document/compile snapshots for
the six previously supported controls also match exactly. See `comparison.json`.

`final/{source,esm}-review-results.json` and `*-review-scenes.json` retain every
actual input, compile/report output and board-font audit. Reviewed offline
handwriting PNG/SVG pairs: `final/esm-native_q43`, `final/esm-power15`,
`final/esm-native_q43-floor19` and `final/esm-power15-floor19`.
These render all canonical engine labels with the board's own handwriting at
the absolute LABEL origin. They are not browser, app presentation or saved
replay evidence. The successful 19 px views were inspected and clear.

## Review and remaining parent obligations

Standards check: shared board font helpers determine every attempted binomial
size, measured ink matches the emitted size, failure returns no scene. Spec
check: grammar-capture offsets restore the complete requested role, exact raw
spans and caller graph survive, and shortened-role inputs fail. Scope check:
only the four assigned files changed; all other gates and compiler progression
blocks retain their original bytes. No additional finding in this bounded fix.

Actual TurnPlan reconciliation and the app's source-label drop remain
**parent-owned pending**. Live narration/voice, authenticated save/read/restore,
fresh reopen and replay were not exercised; no browser, DB, remote operation,
main change, stash or publication occurred. No acceptance claim follows from
these offline fixes. Commit uses explicit owned paths, the requested user
identity and `core.hooksPath=/dev/null`, with no co-author trailer.
