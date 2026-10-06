# W3 measurement review fixes — 6 October 2026

Owned scope for this worktree, pinned at `b6e91990281531af85fa74f0165521653caa4758`:

- `packages/scene-engine/src/ir/measurementSourceAuthority.ts`
- `packages/scene-engine/scripts/verify/verify-w3-measurement-review-fixes.ts` (new, owned verifier)
- This worklog.

No shared gates, runtime adapters, solver, index, ledger, app, or integration
registration are owned here. The work addresses the two P2 findings in
`/Users/kaizen/heytutor-claude-coord/reviews/w3-measurements-final-20261006/REPORT.md`:
reject a decimal nonzero zero-error literal before `Number` underflows it, and
decline malformed entity labels or plan source-text fields without throwing.

Verification and commit evidence will be appended after implementation.

## Implementation and verification

The source reader now verifies that each matched decimal lexeme converts to a
finite number and that lexical nonzero digits do not convert to zero. Literal
`+0` and `-0` remain valid. The authority entry point checks entity labels and
given/derived `sourceText` runtime types before any source normalization. Bad
fields return the existing decline result, preserve the full caller IR, and
withdraw every derived row, unknown and qualitative claim; the new independent
verifier checks those properties and caller immutability.

Environment: Node `v24.21.0`, pnpm `10.32.0`; frozen offline install completed
with zero downloads. Drawing, scene-engine, and standalone authority ESM plus
declarations were built in this worktree. No build output was copied in.

Checks passed:

- New independent repro gate: `verify-w3-measurement-review-fixes.ts` passed
  all 3 decline controls and explicit `+0`/`-0` preservation against TypeScript
  source and the fresh standalone ESM.
- Existing original gate: 5 source cases and all 10 fail-closed controls
  passed, including the frozen native wording and 39-division oracle.
- Existing hardening gate: 69/69 checks passed in TypeScript source and 69/69
  against the fresh built ESM.
- Scene-engine package typecheck, ESLint on the owned module and verifier,
  strict standalone TypeScript checking of the verifier, and `git diff --check`
  passed.
- Native fixture SHA-256 remains
  `6e72d2114809bf989114521af075f8acd4e680b88ff1bb84c3d581d06bd5f90f`; its
  exact question block SHA-256 remains
  `2d12b0d5c223fe9713f8a31a6fa8ce17dc6cd946fb4e88e446cce98895409f01`.

File SHA-256 at verification:

| File | SHA-256 |
| --- | --- |
| `packages/scene-engine/src/ir/measurementSourceAuthority.ts` | `7e91b392db65d104832bd067d49043c54d691ed2c51e30dbc6c491b3c843058c` |
| `packages/scene-engine/scripts/verify/verify-w3-measurement-review-fixes.ts` | `0168736f237481b10d7e8aede3c0f6d1c5e01b49a6d053fa99a3acd93ceb2e7c` |
| Fresh standalone `dist/w3/measurementSourceAuthority.js` (untracked build output) | `80cd125460eb3c8bcd357cc7b58798e847a2a2e24eaf4081f7f66b8eef26bebf` |

Only the two owned code paths and this worklog are in scope. No shared gate,
runtime adapter, solver, index, ledger, application, or integration path was
edited. The scoped commit is authored and committed as Rishi Vhavle
`<rishivhavle21@gmail.com>`; its repository hash is included in the completion
receipt.
