# Matrix writing: outer command suffix

Parent packet in isolated `cov/w1-matrix-write-20261006`, base `f459df7b`.
Normal student matrix case1 rendered and saved its correct verified table with
ProblemIR, but its first WRITE became `A = [[2,5`. The remaining matrix rows and
protocol coordinates were spoken. The nearest numeric `,x,y]` scanner confused
the numbers at the end of a matrix row with command parameters.

The text-command scanner now accepts a coordinate suffix only outside nested
mathematical brackets. Nested function parentheses and mixed interval endpoints
retain their text semantics, as do unmatched closing evaluation bars. A rejected
incomplete text command cannot fall through to the generic scanner as a partial
WRITE. This changes text parsing only, not figure ownership or source admission.

Added production-shaped 3x4 and 2x2 matrix, vector LABEL, mixed interval and
nested function controls across inline, structured, speech and incremental
parsing. Streaming asserts no command is emitted when only a matrix row/body
has closed, then asserts exactly one complete command and the outer coordinates.
The new gate fails on the original scanner with `matrix inline: every row and
entry survives`, then passes with the fix. All eight drawing verify commands,
drawing typecheck, lint and build pass.

Also reparsed the actual captured student case1 raw response through production
structured/speech parsing: complete first matrix WRITE, all 20 authored steps retained,
no matrix suffix or coordinate leak. This is offline re-parsing of a real capture,
not a new student render. Runtime rerender and batch lifecycle remain required
after review and integration. Evidence logs are under coordinator integration
`w1-matrix-write-*`; the original student capture remains intact.

No READY increment, accepted ledger edit, main write or remote action.
