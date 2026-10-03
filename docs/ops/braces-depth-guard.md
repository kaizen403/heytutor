# Temporary braces depth backport

`braces@3.0.3` is used by Tailwind's Chokidar watcher and by Micromatch / Fast
Glob in Tailwind and Next ESLint. Its recursive AST walkers can overflow the
JavaScript stack on an input below the existing 10,000-character limit.
There is no official patched release for
[GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

The checked-in `patches/braces@3.0.3.patch` backports the depth-bound approach
from [upstream PR #72](https://github.com/micromatch/braces/pull/72) onto the
published 3.0.3 artifact. Parsing bounds combined brace and parenthesis nesting
at 100; compile, expand, and stringify enforce the same bound for supplied ASTs.
Lower limits are allowed, fractional limits are rounded down, and larger or
non-finite limits cannot lift the safe ceiling. The original package name,
version, license, APIs and stringify parent semantics are preserved.

## What the gate permits

Run `pnpm verify:dependency-security`. It does not use `ignoreCves`, `ignoreGhsas`
or a renamed fork. It reads the unfiltered `pnpm audit --audit-level low --json`
report and prints the original advisory as `MITIGATED`, not absent.

The single temporary exception expires at **2026-11-02 00:00 UTC**. It is usable
only when:

- The checked-in patch matches its reviewed SHA-256.
- Every active braces resolution from the full workspace dependency tree is
  the original `braces@3.0.3`; aliases or other versions cannot inherit approval.
- Nine installed runtime/identity/license files match the reviewed source
  fingerprints, and public-API exploit and boundary regressions pass for each
  physical installation.
- The raw advisory ID, package and every affected version exactly match the
  exception, and the exception has not expired.
- The audit report is complete, its counts match its entries, and it contains
  no muted advisories. Errors and malformed inspection output fail closed.

Missing, edited or unapplied patch evidence fails the gate. Other advisories
remain failures regardless of severity or whether they also affect braces.
The policy file is `tools/security/bracesException.json`; changing its expiry
or fingerprints requires a new reviewed security decision.

## Verification

The dependency gate exercises deeply nested string inputs and supplied ASTs,
100/101 boundaries, combined nesting, fractional and oversized limits,
quoted/escaped/malformed inputs, ranges, and downward cyclic ASTs. It also
checks real Micromatch, Fast Glob and Chokidar consumers, including normal
Tailwind content patterns and Next ESLint's resolution.

The unchanged upstream release suite at tag `3.0.3` (commit
`74b2db2938fad48a2ea54a9c8bf27a37a62c350d`) passed all 764 tests both before and
after replacing its runtime files with the actual installed backport, on
checksum-verified Node 24.18.0. No upstream tests were edited or excluded.

`pnpm audit --audit-level low` intentionally still reports the published-version
advisory until upstream publishes an official fix. A passing guarded gate means
the exact reviewed backport mitigates this advisory; it is not a claim that the
registry has cleared the original version or that all possible glob attacks
have been solved.

## Retirement

When an official fixed release is available, verify its exploit rejection and
toolchain compatibility, upgrade the transitive dependency without changing its
public API, and remove the patch registration and temporary exception. Restore
the direct audit command in CI and this runbook, and remove the now-unused
exception wrapper and source fingerprints. Keep an appropriate regression for
the originally failing input. Do not extend the exception silently if the
deadline arrives before that release.
