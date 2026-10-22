# Chemistry launch: complete molecular neighbourhood comparisons

Owner packet: 17 Oct 20:00 (launch), first organic slice. Base runtime commit:
`5c3d894b995dc4c3bf12253bfb5fa7266d1e1ccb`. No accepted topic counts changed.

## Review repair status: source boundary only

The donor's 13-check result below is historical. Independent review found two
P1 defects: a suffix after a list delimiter could hide another molecule or an
unsupported diagram obligation, and a halide on an allylic sp3 carbon was
labelled alkyl without its allylic modifier. This repair has source proof;
it is not integrated, rebuilt-package proof or accepted syllabus coverage.

`organic/neighbourhood.ts` now consumes the complete question with the existing
complete-name parser and a closed vocabulary of structural capabilities the
panel actually supplies. Names after with/as, semicolons or later drawing
sentences remain part of the requested set. Every unconsumed name or property
refuses the whole request. Formula, sigma/pi-count and boiling-order labels are
not supplied by this operator and therefore refuse the whole request. The
closed grammar is intentionally bounded; unrecognized free wording also
refuses rather than silently ignoring an argument. It adds no classifier,
router, compiler, native admission or numeric authority exception.

Allylic classification is computed from the whole graph: the sp3 halogen-bearing
carbon is adjacent to a nonaromatic carbon participating in a nonaromatic C=C
bond. Degree is retained. Saturated, vinylic, aryl, benzylic, homoallylic and dual
benzylic/allylic controls are distinct. The site inventory counts every target
motif before choosing a supported candidate, so an unsupported second motif
cannot disappear behind a single accepted halide, alcohol or carbonyl site.
Neutrality, complete connectivity, valence and the one-site limit remain gates.

Only `neighbourhood.ts` changes at runtime relative to the six-file donor
handoff. The owned gate is additive: the original 13 checks remain unchanged.
The first new 50-check source RED had 25 passes and 25 failures; a subsequent
four-motif inventory RED had 50 passes and four failures. Final source checks
pass 54/54, including all three original real wordings and fresh member-order,
unknown-member, unsupported-obligation, graph-neighbour and mutant controls.
Own source typecheck, changed-file ESLint and diff checks pass.

The source-public dispatcher and actual native selector pass 28/28 deterministic
fixtures using source aliases, valid conservative fallback plans and null
ProblemIR. Supported later members are present in the rendered groups; unknown
members and unsupported obligations refuse. The two carbonyl diagnostics still
compile at the family layer but refuse natively for unverified `120 deg`.
These are source diagnostics, not original-record replay or live/reopened board
measurements. No numeric guard was relaxed.

Evidence is in `.context/chem/coverage95/organic-review-repair-v1/`:
`pre-edit-handoff.json`, `original-13-gate.ts`, `red/summary.json`,
`motif-red/summary.json`, `source54/summary.json`, `source-native-result.json`,
`typecheck-command.json`, `lint-command.json` and `source-freeze54.json`.
The donor's existing `4e1564dc...` dist remains stale and is explicitly not used
as proof of this repair. Independent review, a serialized own package build,
current-composition native/board checks and clean integration gates remain
pending with the integration owner. No provider, database, production or git
mutation was performed for this review repair.

## Scope and result

The existing molecular name parser already resolved the three target lists,
but the ordinary organic renderer supplied structures without the requested
local classifications/hybridisation. Its mention extraction could also draw
supported names while omitting an unsupported member.

This slice resolves every literal name in a one-to-three-member structural
comparison, checks the complete connected neutral molecular graph, and derives
the halide, alcohol or carbonyl carbon's neighbourhood from bonds. One ambiguous
site, unsupported name, larger list, unsupported extra task or unreadable panel
declines the whole comparison. There are no question IDs, topic templates or
runtime chapter registry. Existing organic drawing calls retain their defaults.

Three frozen training-target wordings now compile complete figures:

- XII024: aryl/primary-benzylic/secondary-benzylic C–Cl sites, sp2/sp3, correct
  ring/side-chain connectivity and full source names.
- XII027: primary/secondary/tertiary alcohols with every directly neighbouring
  carbon explicitly labelled, with the class computed from that neighbourhood.
- XII034: complete six-carbon aldehyde and ketone graphs, explicit C/O/H
  carbonyl neighbours, planar approximately 120-degree directions, correct
  aldehyde/ketone and carbonyl-H/two-C-substituent labels.

The approximate 120-degree caption follows ideal trigonal-planar geometry;
the question does not state a numeric angle. It is **not** an independently
approved quantity source. All numeric/source admission guards are unchanged.

## Evidence

Evidence directory, relative to the honolulu workspace:
`.context/chem/launch-20261017-v1/structures-builder/`.

| Check | Result | Evidence |
| --- | --- | --- |
| Initial source regression gate, before implementation | 1 pass, 12 fail | `red.log`, `red/summary.json` |
| Final dedicated gate | 13 pass, 0 fail | `green-final.log`, `green-final/summary.json` |
| Six final SVGs and PNGs, independently rasterized | 6/6 inspected by builder | `green-final/*.{svg,png,render.json}`, `rasterize.log` |
| Own initial dependency/package build | pass | `initial-build.log` |
| Own final scene-engine build | pass | `build-final.log` |
| Scene-engine typecheck | pass | `typecheck.log` |
| Changed source and gate ESLint | pass | `lint.log` |
| Original 1,667 physics/maths route map | 60 captures, zero changed/new/removed | `original1667-intermediate.{json,log}` |
| Current-main 1,667 physics/maths route map | 90 captures, zero changed/new/removed | `current1667-intermediate.{json,log}` |

The gate uses the three complete real wordings, fresh alcohol/bromide/carbonyl
compounds, six atomic refusals, and independent graph-isomorphism mutants.
It checks exact atom/bond connectivity against independent SMILES, source name
and classification labels on each panel, computed local carbon/H counts and
hybridisation, explicit rendered neighbour anchors, actual 120-degree carbonyl
angles, complete reveal groups, viewport bounds and all label collisions.
It does not accept a primitive-count-only result.

The route receipts are explicitly intermediate dirty-source probes using the
worktree's own compiled engine and core. Their source diff/module fingerprints
are retained; the integrator runs the strict clean-head route gate after commit.

## Native diagnostic — WITHOUT ORIGINAL IR

`native-probe.{mts,json,log}` checks the three full wordings using a valid
conservative fallback plan and validated reconstructions of both saved lossy
plan projections. The original complete TurnPlan/ProblemIR was not recorded;
these are **IR-null diagnostics**, not native/live parity or board grades.

- XII024 and XII027 select `chem_organic` on all six IR-null diagnostic paths.
- XII034 compiles a correct family scene, then all three native diagnostic
  selections refuse `displayed_quantity_unverified` for the two `120 deg`
  captions, absent from TurnPlanV3. Keep that guard. A later source-bound
  computed-ideal-geometry authority integration must justify the quantity.

Thus this packet has three correct compiled target figures and two selected
IR-null diagnostic figures. It makes no paid rerun, student-board success or
blind holdout coverage claim. The private 203-row probe holdout was not read.

## Bounds and remaining work

Supported graphs have at most 24 heavy atoms and one unambiguous requested site,
with neutral C/O/F/Cl/Br/I atoms. Alcohols here have saturated OH-bearing carbon
with one to three carbon neighbours. Carbonyl panels support one simple aldehyde
or ketone site. Multiple OH/carbonyl/halide sites, charged/radical graphs, other
elements, unknown names and richer reaction/stereo/projection requests decline.
Carbon-bound H follows skeletal notation; the aldehyde H is drawn explicitly.

Condensed-branch parsing/IUPAC longest chains, formula-isomer enumeration and
nitrogen pyramids are outside this first PR. F2 native source authority and a
new graded two-round capture remain separate. Integration should add
`tsx scripts/verify/verify-organic-neighbourhood-panels.ts` to the chemistry
verification chain; this worker did not edit the shared package script.

Commands were run serially with the one-build token: `pnpm --filter
@heytutor/scene-engine build`, `pnpm --filter @heytutor/scene-engine typecheck`,
and from that package `pnpm exec eslint src/chemistry/organic/{index,render,
neighbourhood,neighbourhoodPanel}.ts scripts/verify/verify-organic-neighbourhood-panels.ts`.
The focused gate was run with `--out` pointing to the evidence directory.
Dependency setup used `pnpm install --offline --frozen-lockfile --ignore-scripts`.
No provider calls, secret reads, database calls, commits, pushes, merges or
production changes were made by this builder.
