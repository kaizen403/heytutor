The original tutor gates stay in `apps/tutor/scripts/verify/gates.txt`, in their
existing order. Add feature gates as one command per line in a new file such as
`apps/tutor/scripts/verify/gates.d/my-feature.txt`. The runner executes every
`.txt` file there, in filename order, after the original list. Separate files
let independent PRs register gates without editing the same line or depending
on an unmerged feature branch. Keep a direct CI invocation in the feature PR
when its base predates this runner migration.

Use `pre-gates.txt` (and `pre-gates.d/`) only for work that must run in the
existing `preverify` phase. Scene-engine gates use the equivalent
`packages/scene-engine/scripts/verify/gates.txt` and `gates.d/` paths.

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
