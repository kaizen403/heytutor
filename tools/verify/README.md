Add a new tutor gate as one command on its own line in
`apps/tutor/scripts/verify/gates.txt`. Use `pre-gates.txt` only for work that must
run in the existing `preverify` phase. Scene-engine gates belong in
`packages/scene-engine/scripts/verify/gates.txt`.

Commands run sequentially from the package directory, using the existing pnpm
script environment. The first failure stops the list and preserves its exit
code. Blank lines and full-line `#` comments are ignored.

`gates-baseline.json` freezes the pre-migration commands from the recorded main
commit. Keep it unchanged when adding gates. The runner rejects a missing or
reordered original gate; new gates may be inserted. CI also checks package
wiring, every listed command's execution, duplicate preservation, and failure
propagation with real subprocesses.

Run the structural checks with `node --test tools/verify/run-gates.test.mjs`.
Use `node ../../tools/verify/run-gates.mjs scripts/verify/gates.txt --list` from
a package directory to inspect its checked execution order without running it.
