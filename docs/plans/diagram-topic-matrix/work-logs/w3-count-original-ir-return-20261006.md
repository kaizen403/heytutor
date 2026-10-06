# Count original IR return contract

The bounded own-data capture introduced at 1704af6d remains the sole input to
measurement proof. Successful verification and structurally valid declines now
return the complete original caller IR object, restoring the existing reference
contract without selecting or removing graph obligations. Invalid or unsafe
caller data still return null. No gate, fixture, Plan pruning policy or accepted
coverage ledger was changed in this repair.

Parent Node 24.21.0 and pnpm 10.32.0: unchanged measurement hardening 69/69,
review fixes (three decline controls and signed zero), and question parser 51/51
pass in source and a freshly built own measurement ESM artifact. The new signed
actual-capture gate passes in source and the own public engine ESM build. Engine
typecheck passes. Evidence is under the coordinator reviews directory with the
prefixes `w3-count-original-ir-*` and `w3-count-signed-parent-*`.

Initial old-gate `--built` attempts failed because their separate
`dist/w3/measurementSourceAuthority.js` artifact had not been built; those logs
are preserved, followed by the explicit own-artifact build and passing runs.
Root ESLint invocation had no executable; the app-scoped invocation is retained
separately. This repair grants no student, replay or READY credit and does not
close the separate review findings about original unsupported Plan outputs,
accessors before API serialization, or apparatus fallback selection.
