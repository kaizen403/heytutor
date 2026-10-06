# Independent matrix WRITE parser review — 2026-10-06

Role: `w1-live-review`. Verdict: **PASS** for parser candidate
`74bcee883d52d9e08f1540b6c39eccccb14f37c7` only. No READY or runtime acceptance
claim. The parent owns adoption and the subsequent real student rerender.

Target `/Users/kaizen/heytutor-cov-wt/w1-matrix-write` was clean at the exact
candidate before review. It was read and executed through source imports only;
this reviewer did not mutate it. Our private branch was
`cov/w1-live-review-20261006` at `12b6e9719243f99a33ec34896d1cd58b6f683a14`.
No implementation cherry-pick, novel fix, main checkout mutation, ledger edit,
remote action, or full repository suite was performed for this review.

## Scope and provenance

The candidate changes exactly:

- `packages/drawing/src/protocol/drawingProtocol.ts`: choose a coordinate suffix
  outside mathematical square brackets; track parentheses nested within those
  brackets; retain mixed interval endpoint and unmatched evaluation-bar behavior;
  prevent incomplete WRITE/LABEL from using the generic partial-tag scanner.
- `packages/drawing/scripts/verify-drawing-protocol.ts`: author controls.
- `docs/plans/diagram-topic-matrix/work-logs/w1-matrix-write.md`: author evidence.

Independent reviewer writes are this log and
`apps/tutor/scripts/verify/probes/w1-live-review/matrix-write-parser-review.ts`.
Owned coordination paths were announced before edits: status `w1-live-review.md`,
review `w1-live-matrix-write-review.md`, logs `w1-live-matrix-write-review-logs/`.
All drawing source files on the private baseline match the candidate's parent
(`git diff HEAD 74bcee8^ -- packages/drawing/src` empty). The probe also asserts
byte-for-byte equality of the baseline scanner and the candidate's parent and
pins the target HEAD. Thus behavior differences use the same inputs and the
actual source, without relying on another checkout's built exports.

## Independent gates and comparison

The probe completed with **1,819 explicit checks**, additional deep comparisons,
14 mathematical cases, **584 two-chunk boundaries**, and character-by-character
checks that no command emits before the outer closing bracket. Cases cover the
actual 3x4 matrix, 2x2 matrix, vector LABEL with font, ordinary and unmatched
evaluation bars, `[0,1)`, `(0,1]`, `[0,1]`, `(0,1)`, interval unions, nested
function parentheses, inner vectors, symbolic matrix entries and decimal/negative
coordinates. Inline, structured-step, speech and streaming paths agree.

Adjacent WRITE, FOCUS, EMPHASIZE and WRITE tags survive in order with clean
speech at chunk sizes 1, 2, 3, 7, 31 and full input. These parser controls do not
change the teaching-stream diagram ownership filters.

Only `savedTurn.rawResponse` was inspected from the large actual capture:
`coord/runtime/runs/2026-10-05T1955-w1-matrix-f459-2f095e3c/evidence/w1-matrix-case1-live.json`.
Raw-response SHA-256:
`dbc8af25100415b5578daf1a60d19281f293d6ad4fa582c70e373e67ca0b0ae2`.
Baseline reproduces first WRITE text `A = [[2,5` with parameters `[19,-7]`.
Candidate returns complete text
`A = [[2,5,19,-7],[35,-2,2.5,12],[1.5,1,-5,17]]` at `[90,145]`.
All 20 authored steps and 20 WRITE commands survive. Speech exactly matches
the authored prose after protocol removal, including streaming chunk sizes
1, 2, 5, 17, 64, 257 and full response. No raw matrix tail or coordinates leak.
This is an offline replay of a real captured response, not a new student render.

Six malformed inputs, up to 1,300 characters (including 128 repeated WRITE
headers), complete without exceptions and emit no partial WRITE. Inline scanning
recovers valid following tags. The paired outputs show an existing limitation:
an unterminated short tag can swallow its later siblings in incremental parsing
until flush, and malformed text remains in narration. Baseline also exhibits
that streaming swallowing and malformed narration; the candidate removes the
baseline's partial or combined WRITE commands. This PASS does not certify
general malformed-response speech sanitization or unbounded parser inputs.

Probe-only TypeScript (`tsc --noEmit --skipLibCheck --target es2022 --module
nodenext --moduleResolution nodenext --esModuleInterop <probe>`) and ESLint pass.
The reviewer did not repeat the parent's eight drawing gates, package build,
or the handoff's three full suites and failure-digest comparisons.

## Reproduction and remaining work

From this private checkout's `apps/tutor`, run:
`pnpm exec tsx scripts/verify/probes/w1-live-review/matrix-write-parser-review.ts [target-root] [capture-json]`.
The default target must remain pinned to the reviewed candidate. Raw paired
results and targeted lint/typecheck logs live under
`/Users/kaizen/heytutor-claude-coord/reviews/w1-live-matrix-write-review-logs/`.

No blocking regression was found in this bounded parser review. Parent may adopt
the candidate independently of the prior blocked circle and optics chains.
Circle and optics remain **BLOCK**; this review changes neither verdict.
Real student rerender and runtime acceptance remain with the parent/runtime lane.
Do not integrate the entire private branch: its earlier staged tip includes
blocked candidates; only this reviewer evidence commit is newly produced here.
