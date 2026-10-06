# Worker coordination handoff: CH-18–25 / HEY-85

## Current continuation — HEY-88 slot 2

Kaizen's implementation continuation supersedes the historical no-packet dispatch below for one named missing-foundation slice. Actual new owner approval read: `/Users/kaizen/heytutor/docs/plans/diagram-topic-matrix/work-logs/integrator-DCP05-12-HEY88-20261002.md`, SHA at approval `f09533e92b0966609ca80253046657abe43d1adf52a41049508c0628d5d266e5`. Sole global owner is HEY-88; slot 2 is explicitly released/assigned to HEY-85. S0 matrix tags/checksums/base unchanged; S1/S2/S3/S5 and complete topic acceptance remain unaccepted. CH-18 still exclusively HEY-84.

Only approved new runtime files were added in the existing isolated worktree:

- `packages/scene-engine/src/physics/bohrTransitionAuthority.ts`, source SHA `9411a87fe8afe1d882ee80cfc34dab682c990f398d54f47306a6022da6105da6`.
- `packages/scene-engine/scripts/verify/verify-bohr-transition-authority-hey85.ts`, gate SHA `5d1be58c156eb08d905a01f71312436f87a0a5553194b334af61cba791c3533f`.

Pure public `deriveBohrTransition` requires explicit one-electron `bohr_hydrogenic`, Z=1–10, ordered distinct n=1–64, supplied positive binding-energy/unit eV or J, **required own** `bindingEnergyConvention="hydrogen_reference"|"ion_ground"`, and a consistent optional photon direction. Every required field must be OWN. It deterministically derives bound levels, signed atomic delta and positive photon energy in source units/canonical joules; reference calibration applies Z², supplied actual-ion ground calibration does not double-apply it. No default binding scalar/convention, parser/router, diagram template, shared source edit, package-entry export, ledger/counter/Drive change or subworker. Numeric output is finite/normal and frozen; unresolved, wrong-model/order/unit/domain or stale computed-source fields reject before return.

Final revised gate passes 40,320 bounded ordered level/Z tuples under both explicit calibrations / 887,167 core checks and 257 synthetic variable-binding tuples under both calibrations / 5,654 holdout checks, including independent integer-rational and Rydberg laws. Distinguishing actual-He+ 54.4 eV vs reference-13.6 eV tests and an isolated prototype-default child regression pass. Standalone holdout also passes. Source and dedicated-gate typecheck/lint plus scene-engine build pass (four unchanged DSA warnings). This is synthetic bounded arithmetic evidence, not an exam cohort or full source/model/scene acceptance. Exact commands, raw artifact paths, review-driven amendments, numeric limits and four per-topic dispositions are in [CH-23a-HEY-85.md](CH-23a-HEY-85.md).

**Current foundation proposal: `integration_pending`.** Bohr-model and spectral-series rows receive only partial numeric evidence; Rutherford and radius/velocity remain blocked. No topic or prerequisite seam is accepted. HEY-88 owns serial source extraction/fallback/detection/compiler/label integration and the rendered/live/reveal/persistence/saved-replay checks. Changes remain uncommitted in the isolated worktree, ready for owner review/copy. No other CH-19–25 runtime packet is automatically assigned by this submission; the dependency map below remains the full outstanding scope record.

Independent revised-source recheck has now resolved both original calibration/own-field findings at the exact `9411a87...` source and `5d1be58...` gate snapshot, with unchanged hashes and passing dedicated gate plus separate public-seam probes. HEY-85 read HEY-83's revised main receipt `audit-bohr-transition-foundation-HEY83-20261002.md`; no shared-consumer or full lifecycle/topic acceptance is inferred from that review.

## Initial read-only audit (historical)

The following records the original blocked ownership handoff, before the HEY-88 foundation assignment above. It is retained as scope/history, not the current runtime permission or a topic-acceptance claim.

The unnamed local 6–10 integration session is not reachable through a known thread/contact. Its log scopes S0 to CH-06–10, not this assignment; no independently accepted DCP-01/02 source/evaluation profile for CH-18–25 is supplied. S2/S3 are existing seeds, not accepted complete prerequisite contracts. Three writing slots are asserted occupied. Implementation packet IDs, allowed paths, total budget and handoff have not been approved. No new implementation worker was started.

CH-18 is reserved to HEY-84 by direct peer agreement; no handoff or accepted work supplied, and HEY-85 will not implement it concurrently.

Exact CH-18 reserved IDs:
- `maths|11|point-distance-and-section` (CH-18a); J/A/N = listed/listed/not_applicable; all variant acceptance remains HEY-84/integrator-owned.
- `maths|11|section-formula-in-space` (CH-18a); J/A/N = listed/application/not_applicable; all variant acceptance remains HEY-84/integrator-owned.
- `maths|11|direction-ratios-and-cosines` (CH-18a); J/A/N = listed/listed/not_applicable; all variant acceptance remains HEY-84/integrator-owned.
- `maths|11|angle-between-intersecting-lines` (CH-18b); J/A/N = listed/listed/not_applicable; all variant acceptance remains HEY-84/integrator-owned.
- `maths|11|equation-of-a-line` (CH-18a); J/A/N = listed/listed/not_applicable; all variant acceptance remains HEY-84/integrator-owned.
- `maths|11|skew-lines` (CH-18b); J/A/N = listed/listed/not_applicable; all variant acceptance remains HEY-84/integrator-owned.
- `maths|11|plane-equations` (CH-18c); J/A/N = supplemental/listed/not_applicable; all variant acceptance remains HEY-84/integrator-owned.
- `maths|11|angle-between-planes` (CH-18c); J/A/N = supplemental/listed/not_applicable; all variant acceptance remains HEY-84/integrator-owned.
- `maths|11|angle-between-line-and-plane` (CH-18c); J/A/N = supplemental/listed/not_applicable; all variant acceptance remains HEY-84/integrator-owned.
- `maths|11|distance-from-point-to-plane` (CH-18c); J/A/N = supplemental/listed/not_applicable; all variant acceptance remains HEY-84/integrator-owned.
- `maths|11|line-plane-intersection` (CH-18c); J/A/N = supplemental/application/not_applicable; all variant acceptance remains HEY-84/integrator-owned.
- `maths|11|coplanar-lines` (CH-18c); J/A/N = supplemental/listed/not_applicable; all variant acceptance remains HEY-84/integrator-owned.
- `maths|11|image-of-a-point-in-a-plane` (CH-18c); J/A/N = supplemental/application/not_applicable; all variant acceptance remains HEY-84/integrator-owned.
- `maths|11|intersection-of-two-planes` (CH-18c); J/A/N = supplemental/application/not_applicable; all variant acceptance remains HEY-84/integrator-owned.

117 physics rows across 22 packets were read for prerequisite triage. No packet has approved implementation paths or complete source/evaluation profile. Only CH-23a received additional source-to-family diagnostic reproduction; its dedicated packet log is [CH-23a-HEY-85.md](CH-23a-HEY-85.md). All other rows below remain unaudited at full variant level; their dependency blockers are not proof of missing runtime capability.

| Packet | Rows | Dependencies | Proposed disposition |
| --- | --- | --- | --- |
| CH-19a | 5 | S0; S2; S3; S5 | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-19b | 10 | S0; S1; S2; S3; CH-03a | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-19c | 4 | S0; S3; CH-19b | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-19d | 8 | S0; S2; S5 | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-20a | 4 | S0; S1 | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-20b | 5 | S0; S2; CH-20a | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-20c | 3 | S0; S1; S2; CH-20a; CH-20b | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-21a | 5 | S0; S2; S3; CH-20a; CH-20b | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-21b | 2 | S0; CH-20a | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-21c | 4 | S0; S2; CH-21a | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-22a | 2 | S0; S1; S2; S5 | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-22b | 3 | S0; S2; CH-22a | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-22c | 3 | S0; S2; S3; CH-22b | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-23a | 4 | S0; S2; S3 | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-23b | 6 | S0; S2; S5 | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-23c | 2 | S0; S2; S5; CH-23a; CH-23b | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-24a | 9 | S0; S1; S2; CH-02a | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-24b | 3 | S0; S1; S2; S5; CH-24a; CH-02a | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-24c | 2 | S0; S1 | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-25a | 6 | S0; S1; S5; CH-34a; CH-34b; CH-34c; CH-07b; CH-19a | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-25b | 9 | S0; S1; S2; S5; CH-27a; CH-27b; CH-19b; CH-19c; CH-19d | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |
| CH-25c | 18 | S0; S1; S2; S5; CH-02a; CH-02b; CH-02c; CH-05c; CH-10a; CH-10b; CH-24a; CH-24b; CH-24c | blocked on owner/source/path/budget and unaccepted dependencies; no accepted topic claim |

The main mutable ledger still has 131 scoped CH-18–25 rows planned with blank owners at the audit read. This conflicts with inferring approved implementation ownership from chapter allocation; no central row was edited. HEY-83 confirmed it is not the global owner and cannot approve on behalf of the unnamed local session; HEY-84 reported the same limitation.

- `cd ~/.capy/drive/project-heytutor/diagram-coverage-plan && shasum -a 256 -c SHA256SUMS`: all 18 entries pass.
- `shasum -a 256 data/question-bank/syllabus-taxonomy.json /Users/kaizen/heytutor/data/question-bank/syllabus-taxonomy.json`: both `2d2a65ff89f4ce6aae9016c3a607dfb3d1f06a259a2313d1cf47db07a51a7510`.
- `export PATH=/opt/homebrew/bin:$PATH; pnpm install --frozen-lockfile --offline --ignore-scripts`: exit 0, pnpm 10.32.0, Node v26.7.0; no dependency-manifest/lock changes.
- `cd packages/scene-engine && pnpm exec tsx scripts/verify/verify-elasticity-operators.ts`: exit 0, 360 checks.
- `cd packages/scene-engine && pnpm exec tsx scripts/verify/verify-fluid-operators.ts`: exit 0, 288 checks.
- `cd packages/scene-engine && pnpm exec tsx scripts/verify/verify-thermodynamics-operators.ts`: exit 0, 496 checks.
- `cd packages/scene-engine && pnpm exec tsx scripts/verify/verify-instrument-labels.ts`: exit 0; caption/scale-label geometry, not full experimental method certification.
- `pnpm --filter @heytutor/drawing build && pnpm --filter @heytutor/scene-engine typecheck && pnpm --filter @heytutor/scene-engine lint && pnpm --filter @heytutor/scene-engine build`: exit 0; lint has four pre-existing DSA unused-variable warnings, no errors. DSA was not edited or separately verified.

These are read-only baseline/reuse checks on eec2d36, not new packet gates, frozen source cohorts, holdout passes, topic acceptance or full tutor validation.

Concrete CH-23a source mismatch and owner-only correction proposal are in [CH-23a-HEY-85.md](CH-23a-HEY-85.md). No new code or packet gate was added; all log changes are uncommitted. Dependencies were installed and ignored baseline package builds produced local dist artifacts. Scratch harness/output are outside the repository. The user must supply the actual global owner contact plus packet/path/S0/concurrency approval before coding can proceed.

## Assignment and source contract

Worker HEY-85, detached isolated eec2d36b1, audit 2026-10-02 UTC (2026-10-03 local). 2026 Main Paper 1/Advanced/NEET source references and tags below are retained from the current main physics.csv; Maths has no NEET scope. Only this log and the dedicated CH-23a log were added. Template is read from main work-logs/TEMPLATE.md. Main and Drive were read only, no central artifacts copied into this checkout. Accepted dependencies/implementation paths: none for this workstream.

### Global owner disposition received

Latest owner amendment independently read after HEY-83's CH-14a integration notice: slots 1 and 2 are free but **unassigned**, and slot 3 remains allocated to CH-14a `verification_pending`. The owner explicitly states no HEY-85 packet/gate or released slot and no permission to fill an unnamed slot. This supersedes the historical three-occupied-slots statement below, not the S1/S2/S3/S5 or topic-dependency blockers. Free budget alone creates no ready, approved packet; all HEY-85 runtime writes remain prohibited.

Kaizen supplied the response and HEY-85 read `/Users/kaizen/heytutor/docs/plans/diagram-topic-matrix/work-logs/integrator-ch11-ch25-handoff.md`. This owner-written record explicitly extends Cursor `b10f1489-5216-4a2d-9b0a-9b2ca6f2de33` global integration ownership and S0 `2026-10-02-topic-matrix-v1` to chapters 11–25. Full base `eec2d36b151cf4950c9fcfadd7840f53b26415ec`, taxonomy and Maths/Physics checksums match the audited values. S0 freezes matrix IDs, tags, variants and independent checks, not a question cohort/holdout or accepted diagram-need/text-only decisions. This resolves the earlier identity/S0-extension blockers in this log; those passages are the initial audit history.

S1, S2, S3 and S5 remain explicitly unaccepted. All 22 Physics packets below remain blocked by the named graph and **no HEY-85 packet is approved**. CH-23a's shared Bohr defect is confirmed, not delegated: HEY-85 may not change synthesis/detection or add any gate. CH-18 stays exclusively HEY-84 and is blocked on S3. CH-14a is approved to HEY-84 only, with no runtime start permission yet; it is not an HEY-85 ready alternative.

Writing cap is one owner plus three workers, all occupied by CH-06a/07a/08a. CH-08a's 983-check submission and `integration_pending` proposal do not free the slot. No additional workers or runtime writes are permitted. To resume this workstream, the owner must amend its handoff with a specifically approved HEY-85 packet, disjoint paths, accepted prerequisite code/contracts, and `SLOT RELEASED` naming the packet. No current ready packet may be inferred from a slot release or a seed-module baseline alone.

Owner-only acceptance remains serial shared integration in main plus independent/render/reveal/persistence/replay evidence. Worker logs stay uncommitted and proposed pending/blocked; Kaizen relays worktree paths. Main ledger, counters and Drive stay owner-controlled. All 117 Physics rows remain blocked; no accepted count changes. HEY-83/84 were notified of the disposition and actual handoff path.

### Owner contact update

Kaizen subsequently identified the 6–10 global owner as Cursor session `b10f1489-5216-4a2d-9b0a-9b2ca6f2de33`; HEY-83 handles 0–6. Read-only inspection of that exact Cursor transcript confirms it wrote `integrator-ch06-ch10-s0.md` and retained shared compile/validation/capability integration. The initial unnamed-owner passages above describe the earlier audit state, not a continuing identity question. Latest recorded turn ended successfully, but this does not establish current worker activity or available budget.

There is no discovered external Cursor message endpoint; its CLI starts/resumes agents rather than providing a message-only send to this IDE conversation. No resume/new agent, session-state mutation or IDE send was attempted. The request must be relayed by Kaizen to the identified owner, with its reply returned here. Approval of S0 extension, prerequisites, disjoint files and total concurrency remains missing. HEY-83/84 have the same contact information; CH-18 stays reserved to HEY-84.

## Changes and checks

Exact baseline commands/results are above and CH-23a reproduction is in its dedicated log. No source-cohort positive/edge/invalid/mutation/holdout acceptance, inspected packet render, live reveal, persistence or replay is established. Baseline existing gates do not satisfy these obligations; full lifecycle acceptance is explicitly pending.

## Per-topic outcomes and remaining variants

Every following row is proposed blocked, not accepted, and remains unchanged in the central ledger. J/A/N scope order is preserved. This lists exact matrix obligations without inventing case outcomes.

| Exact ID | Packet | Scope J/A/N | Required variants still unresolved | Independent authority/check still required |
| --- | --- | --- | --- | --- |
| physics\|7\|elasticity-and-moduli | CH-19a | listed/listed/listed | Tension/compression; linear regime and source-supplied measured stress-strain curve | Check stress=F/A, strain=ΔL/L and linear slope; yield/plastic curves require observed material data |
| physics\|7\|youngs-modulus | CH-19a | listed/listed/listed | Uniform wire lengths/areas and tensile loads | Verify Y=FL/(AΔL); reject missing geometry or deformation outside declared linear model |
| physics\|7\|bulk-modulus-and-modulus-of-rigidity | CH-19a | listed/listed/listed | Hydrostatic compression and tangential shear | Check bulk and shear definitions with sign/convention; a uniaxial Young modulus cannot certify either independently |
| physics\|7\|poissons-ratio | CH-19a | supplemental/supplemental/supplemental | Axial and lateral strain; positive and auxetic supplied materials | Verify ν=-εtrans/εaxial and declared isotropic model; measured ratio cannot be invented |
| physics\|7\|elastic-potential-energy | CH-19a | application/application/application | Uniform stretched wire and unloading in elastic regime | Independently integrate stress-strain energy density and check U=FΔL/2; plastic unloading is outside linear authority |
| physics\|7\|fluid-pressure-and-pascals-law | CH-19b | listed/listed/listed | Open/closed fluid column; multiple depths and density layers | Check p=p0+∫ρg dh and pressure continuity; no negative absolute pressure without a declared model |
| physics\|7\|pascals-law-and-hydraulics | CH-19b | listed/listed/listed | Two hydraulic pistons and different areas | Check pressure equality and force/displacement work balance; connected fluid volume must remain accounted for |
| physics\|7\|gravity-effect-on-fluid-pressure | CH-19b | listed/application/listed | Vertical versus tilted vessel; changing g | Recompute pressure from vertical depth, not path length; zero-g and reversed axis conventions must be explicit |
| physics\|7\|buoyancy-and-archimedes-principle | CH-19b | application/listed/application | Floating, fully submerged and layered displacement | Check buoyancy=displaced-fluid weight and body equilibrium; submerged volume cannot exceed body volume |
| physics\|7\|viscosity-and-stokes-law | CH-19b | listed/listed/listed | Newtonian shear profile; velocity gradient and area | Verify τ=ηdv/dy and viscosity units; non-Newtonian curves need an explicit supplemental constitutive law |
| physics\|7\|stokes-law-and-terminal-velocity | CH-19b | listed/listed/listed | Falling sphere; initial acceleration and terminal state | Check mg-buoyancy-6πηrv=0 at terminal speed and Stokes assumptions; outside creeping flow cannot certify the law |
| physics\|7\|streamline-turbulent-and-bernoulli | CH-19b | listed/review/listed | Horizontal/vertical pipe; venturi and tank outflow; streamlined versus turbulent depiction | Check Bernoulli along an admissible streamline and continuity; lossless law cannot certify a dissipative turbulent path |
| physics\|7\|equation-of-continuity | CH-19b | application/listed/application | Changing pipe area; branched incompressible flow | Verify ΣQin=ΣQout with Q=Av; compressible flow needs density-weighted mass balance |
| physics\|7\|critical-velocity | CH-19b | listed/supplemental/listed | Pipe transition with supplied material/diameter and critical criterion | Check vcritical dimensions and given threshold; Advanced streamline scope is not a named turbulence requirement |
| physics\|7\|reynolds-number | CH-19b | application/supplemental/application | Laminar/transitional examples with supplied geometry | Compute Re=ρvD/η independently; reject a universal numerical cutoff without a declared geometry criterion |
| physics\|7\|surface-tension-basics | CH-19c | listed/listed/listed | Wetting/non-wetting contact; interfaces and surface-energy change | Verify contact-angle convention and ΔE=γΔA; count each liquid-film surface |
| physics\|7\|excess-pressure-across-curved-surface | CH-19c | listed/application/listed | One and two principal curvature radii; planar limit | Check Young-Laplace Δp=γ(1/R1+1/R2); missing interface count cannot yield exact pressure |
| physics\|7\|drops-and-bubbles | CH-19c | listed/listed/listed | Liquid drop, air bubble in liquid and soap bubble | Check 2γ/r versus 4γ/r with correct surface count; reversed pressure direction rejects |
| physics\|7\|surface-tension-applications | CH-19c | listed/listed/listed | Capillary rise/depression; radius and contact angle variants | Check h=2γcosθ/(ρgr) and meniscus orientation; negative cosθ means depression |
| physics\|7\|heat-temperature-and-thermal-expansion | CH-19d | listed/listed/listed | Rod expansion, temperature change and constrained expansion | Check ΔL=αLΔT under small-strain model; Celsius difference is not absolute thermodynamic temperature |
| physics\|7\|area-and-volume-expansion | CH-19d | listed/application/listed | Plate area; vessel/liquid volume; apparent expansion | Verify β≈2α and γ≈3α only for isotropic small expansion; account for expanding container |
| physics\|7\|specific-heat-and-calorimetry | CH-19d | listed/listed/listed | Hot/cold solid-liquid mixtures; calorimeter correction | Check independent heat balance and final-temperature bounds; unknown heat capacity cannot be fabricated |
| physics\|7\|change-of-state-and-latent-heat | CH-19d | listed/listed/listed | Melting/boiling plateaus; mixed phase at final equilibrium | Check Q=mcΔT plus mL and phase amounts; heat added during plateau cannot raise temperature in that ideal model |
| physics\|7\|heat-transfer | CH-19d | listed/listed/listed | Single and layered slabs; steady one-dimensional heat conduction | Check equal steady heat flow and thermal resistances; Advanced scope remains one-dimensional |
| physics\|7\|convection-and-radiation | CH-19d | listed/listed/listed | Convection circulation and radiation between supplied bodies | Check qualitative heat direction and source-provided radiation model; schematic convection arrows are not measured velocities |
| physics\|7\|stefans-law | CH-19d | supplemental/listed/supplemental | Blackbody and greybody emission; net exchange with surroundings | Verify εσA(T⁴-Ts⁴), kelvin units and ε bounds; Main/NEET radiation heading does not explicitly name Stefan's law |
| physics\|7\|newtons-law-of-cooling | CH-19d | supplemental/listed/supplemental | Cooling curve under small temperature excess; ambient asymptote | Check dT/dt=-k(T-Ta) and model validity; supplied heating or drifting ambient cannot use constant-ambient cooling silently |
| physics\|8\|thermal-equilibrium-temperature-and-zeroth-law | CH-20a | listed/application/listed | Two systems and thermometer; transitive thermal equilibrium | Check equal temperatures and equilibrium assumptions; pure zeroth-law recall may remain text-only |
| physics\|8\|heat-work-and-internal-energy | CH-20a | listed/listed/listed | Piston boundary; heat in/out and compression/expansion sign | Verify ΔU=Q-Wby with declared convention; heat and work are path transfers rather than state labels |
| physics\|8\|first-law-of-thermodynamics | CH-20a | listed/listed/listed | Heating, compression and adiabatic energy transfer for an ideal gas | Independently close Q-Wby-ΔU=0; Advanced numeric applications stay ideal-gas-only |
| physics\|8\|isothermal-and-adiabatic-processes | CH-20b | listed/listed/listed | Ideal-gas expansion/compression at fixed temperature | Check PV constant, ΔU=0 and W=nRT ln(V2/V1); missing gas amount/temperature cannot certify heat |
| physics\|8\|adiabatic-processes | CH-20b | listed/listed/listed | Reversible ideal-gas adiabatic expansion/compression | Check PV^γ constant and Q=0; an irreversible adiabatic path cannot inherit the reversible curve |
| physics\|8\|isobaric-and-isochoric-processes | CH-20b | application/application/application | Constant-pressure and constant-volume heat transfers | Verify W=PΔV or zero and ΔU from given heat capacity; distinguish isobaric from isothermal |
| physics\|8\|work-on-pv-diagrams | CH-20b | application/application/application | Open paths and clockwise/anticlockwise closed cycles | Independently integrate ∫P dV and cycle sign; a plotted area cannot invent a missing physical pressure scale |
| physics\|8\|cp-cv-and-mayers-relation | CH-20a | application/listed/application | Monoatomic/diatomic ideal gas; molar versus total heat capacities | Check Cp-Cv=R only for molar ideal-gas values; reject unit/model mismatch |
| physics\|8\|second-law-and-process-reversibility | CH-20c | listed/listed/listed | Hot/cold reservoirs; proposed cyclic heat transfers | Check first-law closure and second-law admissibility; one-reservoir complete heat-to-work cycle rejects |
| physics\|8\|reversible-and-irreversible-processes | CH-20b | listed/listed/listed | Quasistatic reversible path versus irreversible expansion | Check defining equilibrium states and admissible endpoints; do not draw a unique reversible PV path for an unspecified irreversible process |
| physics\|8\|carnot-engine-and-efficiency | CH-20c | supplemental/listed/supplemental | Four Carnot legs; reservoir temperatures and efficiency | Verify η=1-Tc/Th and cycle energy closure; temperatures must be absolute and 0<Tc<Th |
| physics\|8\|refrigerator-and-heat-pump | CH-20c | supplemental/application/supplemental | Reversed-cycle refrigerator and heat pump; declared work input | Check COPR=Qc/W and COPHP=Qh/W=COPR+1 and Carnot bound; not a named Main/NEET standalone requirement |
| physics\|9\|perfect-gas-equation-and-compression-work | CH-21a | listed/listed/listed | P,V,T,n state changes; particle number versus mole count | Verify PV=nRT=NkBT with kelvin and matching units; zero/negative absolute temperature rejects |
| physics\|9\|work-in-compression-of-a-gas | CH-21a | listed/application/listed | Quasistatic compression; isothermal versus supplied process law | Check negative work by gas and positive work on gas; source-free process path cannot determine work |
| physics\|9\|kinetic-theory-assumptions-and-pressure | CH-21a | listed/application/listed | Elastic wall collision; random isotropic ensemble | Check momentum transfer and p=Nm<v²>/(3V); illustrative particles cannot certify a measured microstate |
| physics\|9\|temperature-and-rms-speed | CH-21c | listed/application/listed | Temperature changes and molecular-mass comparison | Verify vrms=sqrt(3kBT/m); distinguish RMS from mean and most probable speed |
| physics\|9\|average-and-most-probable-speed | CH-21c | supplemental/listed/supplemental | Mean, RMS and most-probable speeds for Maxwell equilibrium gas | Independently check sqrt(8kBT/(πm)) and sqrt(2kBT/m) ordering; Advanced listing is Chemistry States of Matter, not Physics enumeration |
| physics\|9\|maxwell-speed-distribution | CH-21c | supplemental/application/supplemental | Two-temperature Maxwell distributions on speed≥0 | Check normalized probability density and independent moments; Advanced Chemistry speed list is a teaching application, not an explicit Maxwell-plot heading |
| physics\|9\|degrees-of-freedom-and-equipartition | CH-21b | listed/application/listed | Monoatomic/diatomic accessible translational and rotational modes | Check f kBT/2 per molecule and stated frozen modes; classical equipartition cannot silently include quantum-suppressed vibration |
| physics\|9\|specific-heat-capacities-of-gases | CH-21b | listed/listed/listed | Cv,Cp,γ for monoatomic and diatomic ideal gases | Verify Cv=fR/2, Cp=Cv+R and γ; reject molar-versus-mass-specific unit confusion |
| physics\|9\|mean-free-path-and-avogadros-number | CH-21c | listed/application/listed | Molecular diameter, density and collision-path schematic | Check λ=1/(sqrt(2)πd²nN) under hard-sphere assumptions; schematic segments are not an exact collision history |
| physics\|9\|avogadros-number | CH-21a | listed/application/listed | Mole-to-particle conversion and supplied gas amount | Check N=nNA with the defined constant; scalar counting alone earns a documented text-only decision |
| physics\|9\|mixture-of-ideal-gases | CH-21a | application/application/application | Two ideal species; common T,V and partial pressures | Independently sum niRT/V and energy with declared heat capacities; species cannot share a mass-dependent speed value |
| physics\|17\|dual-nature-of-radiation | CH-22b | listed/application/listed | Interference evidence versus photoelectric particle evidence | Check which source observation supports which model; a generic wave sketch is not evidence for photoelectric emission |
| physics\|17\|photoelectric-effect-and-observations | CH-22a | listed/review/listed | Photoelectric source, emitter, collector and Hertz/Lenard observations | Check apparatus polarity and threshold observations; Advanced lists effect but not both named observation inventories, so mixed label is review |
| physics\|17\|photoelectric-graphs-and-stopping-potential | CH-22a | application/application/application | Photocurrent-voltage curves; varying intensity/frequency and stopping polarity | Verify saturation/threshold trends and eVstop=Kmax; voltage axes and collection direction cannot swap |
| physics\|17\|einsteins-photoelectric-equation | CH-22b | listed/application/listed | Threshold, subthreshold and above-threshold photons | Independently check Kmax=hf-φ with nonnegative emission condition; subthreshold intensity cannot create emitted electrons in this model |
| physics\|17\|photon-energy-and-momentum | CH-22b | application/application/application | Photon frequency/wavelength; absorption or reflection momentum | Verify E=hf=hc/λ and p=E/c; scalar-only conversion may be independently text-only |
| physics\|17\|matter-waves-and-de-broglie-relation | CH-22c | listed/listed/listed | Matter wavelength for several masses and momenta | Check λ=h/p with stated nonrelativistic/relativistic model; p=0 cannot produce finite wavelength |
| physics\|17\|de-broglie-wavelength-of-an-electron | CH-22c | application/application/application | Accelerating potential and supplied electron kinetic energy | Verify λ=h/sqrt(2meV) only in nonrelativistic regime; high voltage needs the explicitly stated relativistic relation |
| physics\|17\|davisson-germer-experiment | CH-22c | supplemental/supplemental/supplemental | Electron diffraction target, detector angle and supplied lattice spacing | Check de Broglie wavelength and declared diffraction relation; experiment is not a separately named current official heading |
| physics\|18\|rutherford-scattering-and-model | CH-23a | listed/application/listed | Alpha source, collimator, foil and detector; impact-parameter trajectories | Verify repulsive scattering direction and supplied Rutherford relation if quantitative; schematic atom is not a literal size measurement |
| physics\|18\|bohr-model-and-hydrogen-spectrum | CH-23a | listed/listed/listed | Bohr hydrogen and hydrogen-like ions; allowed level transitions | Check En=-13.6Z²/n² eV under Bohr model and state domain; classical orbit model labels must be explicit |
| physics\|18\|bohr-orbit-radius-and-velocity | CH-23a | application/application/application | Allowed orbit radii/speeds for hydrogen-like ions | Independently check rn∝n²/Z and vn∝Z/n; orbits are model schematics, not literal electron paths |
| physics\|18\|hydrogen-spectral-series | CH-23a | listed/application/listed | Lyman/Balmer/Paschen examples; emission/absorption and limits | Check transition ΔE=hf and independent Rydberg relation; no upward transition may be labelled spontaneous emission |
| physics\|18\|nucleus-composition-size-and-masses | CH-23b | listed/application/listed | Nuclide proton/neutron counts; radius scaling and atomic versus nuclear mass | Check A=Z+N and R=r0A^(1/3) only with supplied r0; atomic masses need electron convention |
| physics\|18\|mass-energy-relation-and-mass-defect | CH-23b | listed/application/listed | Free nucleons versus bound nucleus; atomic-mass correction | Verify Δm c² and consistent mass convention; charge/electron mismatch cannot certify binding energy |
| physics\|18\|binding-energy-per-nucleon | CH-23b | listed/review/listed | Binding energy per nucleon at supplied A values; peak and fusion/fission trend | Check BE/A numerically and measured curve data; Advanced lists binding calculation, not the complete plotted mass-number inventory |
| physics\|18\|q-value-of-a-nuclear-reaction | CH-23b | application/listed/application | Balanced nuclear reaction; masses before/after and exo/endothermic Q | Check nucleon/charge conservation and Q=(mi-mf)c²; inconsistent mass conventions reject |
| physics\|18\|nuclear-fission-and-fusion | CH-23b | listed/listed/listed | Source-defined fission channel and emitted neutrons | Independently balance A,Z and energy from supplied masses; an unbalanced illustrative split cannot be exact |
| physics\|18\|nuclear-fusion | CH-23b | listed/listed/listed | Source-defined fusion channel and products | Check A,Z and Q values with complete product set; unspecified neutrinos/photons cannot silently disappear |
| physics\|18\|radioactive-decay-and-half-life | CH-23c | supplemental/listed/supplemental | Parent exponential decay; half-life and several elapsed intervals | Verify N=N0exp(-λt) and t½=ln2/λ; Main/NEET nuclear-unit wording does not explicitly enumerate decay |
| physics\|18\|activity-and-decay-law | CH-23c | supplemental/listed/supplemental | Activity, decay constant and mean life; parent versus daughter counts | Check Aactivity=λN and τ=1/λ with units; a daughter growth/chain law requires an explicit supported model |
| physics\|19\|semiconductors | CH-24a | listed/supplemental/listed | Semiconductor versus conductor/insulator qualitative behaviour | Check source-supported carrier/temperature relationships; electronics is unlisted as an Advanced standalone lane |
| physics\|19\|energy-bands | CH-24a | application/supplemental/application | Valence/conduction bands and gaps for supplied materials | Verify occupancy/gap ordering against supplied facts; no material-specific gap value may be invented |
| physics\|19\|intrinsic-and-extrinsic-semiconductors | CH-24a | application/supplemental/application | Intrinsic pair generation versus donor/acceptor doping | Check charge neutrality and carrier identities; qualitative doping cannot certify a carrier density without data |
| physics\|19\|n-type-and-p-type-semiconductors | CH-24a | application/supplemental/application | Donor/acceptor level and majority/minority carriers | Independently count charges and label electrons/holes; n-type is not negatively charged bulk material |
| physics\|19\|pn-junction-and-diode-iv | CH-24a | listed/supplemental/listed | p-n depletion region; forward/reverse bias; supplied diode I-V | Check terminal polarity and source-defined current model; qualitative depletion widths are not exact measurements |
| physics\|19\|diode-as-rectifier | CH-24a | application/supplemental/application | One-diode half-wave circuit; load polarity and waveform | Independently evaluate conduction each half-cycle under declared ideal/threshold model; disconnected return path rejects |
| physics\|19\|full-wave-rectifier | CH-24a | application/supplemental/application | Bridge and centre-tapped full-wave rectifiers | Check active diode pairs, load polarity and output period; secondary centre tap cannot be guessed from a generic transformer |
| physics\|19\|special-purpose-diodes-and-solar-cell | CH-24b | listed/supplemental/listed | LED, photodiode, solar cell and Zener roles with terminal orientation | Check device identity, bias and source of energy independently; a single generic diode cannot replace all four devices |
| physics\|19\|iv-characteristics-of-special-devices | CH-24b | listed/supplemental/listed | LED forward knee; illuminated photodiode/solar curve; Zener breakdown | Compare to supplied curves and bias axes; no real-device threshold/breakdown constants without source evidence |
| physics\|19\|zener-voltage-regulator | CH-24b | listed/supplemental/listed | Reverse Zener, series resistor and explicit load; regulation limits | Independently check KCL, Iz range and dissipated power; below breakdown or overloaded circuit cannot be labelled regulated |
| physics\|19\|transistor-characteristics-common-emitter | CH-24a | supplemental/supplemental/supplemental | Common-emitter input/output curves and three terminals | Check Ic/Ib and declared transistor operating regions; retained supplemental topic is not current Main/NEET electronics scope |
| physics\|19\|transistor-as-switch-or-amplifier | CH-24a | supplemental/supplemental/supplemental | Cutoff/saturation switch and active-region amplifier; supplied load line | Verify terminal topology and operating point independently; unsupported gain or output waveform cannot be fabricated |
| physics\|19\|logic-gates | CH-24c | listed/supplemental/listed | OR, AND, NOT, NAND and NOR symbols with all input states | Independently enumerate truth tables and terminal arity; reversed negation bubble or floating input rejects |
| physics\|19\|nand-and-nor-universal-gates | CH-24c | application/supplemental/application | NAND-only and NOR-only implementations of basic gates | Exhaustively compare composed network truth table to target; universal-gate application is not a separately listed official heading |
| physics\|20\|vernier-callipers | CH-25a | listed/listed/listed | Internal/external jaws and depth rod; several observed scale alignments | Independently compute reading and least count with units; wrong jaw/depth method or missing scale image cannot certify measurement |
| physics\|20\|vernier-zero-error | CH-25a | application/application/application | Positive/negative vernier zero error and corrected specimen reading | Check corrected reading=observed-zeroError; missing zero observation cannot justify a correction |
| physics\|20\|screw-gauge | CH-25a | listed/listed/listed | Thin wire and sheet; pitch and circular scale readings | Compute least count=pitch/divisions and diameter independently; pitch must not be inferred from instrument resemblance |
| physics\|20\|screw-gauge-zero-error | CH-25a | application/application/application | Positive/negative screw-gauge zero error; full-turn crossings | Verify signed correction and main-scale rollover; a reversed correction rejects |
| physics\|20\|simple-pendulum-amplitude-squared-vs-time | CH-25b | listed/supplemental/listed | Pendulum amplitude observations; A² versus time and dissipation | Check energy∝A² in small-angle model and declining source observations; Main/NEET list this, Advanced g experiment is different |
| physics\|20\|simple-pendulum-l-t-squared-graph | CH-25b | review/review/review | Preserved L-T² dissipation label; g-from-period alternate interpretation | Editorial decision must separate T²=4π²L/g from A²-time dissipation; L-T² data cannot certify energy loss under the exact retained label |
| physics\|20\|metre-scale-principle-of-moments | CH-25a | listed/application/listed | Metre rule fulcrum, known/unknown masses and rule COM | Check clockwise/anticlockwise moments including rule mass; Advanced rigid-body application is not a named General activity |
| physics\|20\|youngs-modulus-of-wire | CH-25a | listed/listed/listed | Wire loading, length, radius and measured extension; reference-wire correction where supplied | Verify Y=FL/(πr²ΔL) and observation units; apparatus curve alone cannot invent wire radius |
| physics\|20\|surface-tension-by-capillary-rise | CH-25b | listed/listed/listed | Capillary radius, meniscus height and contact angle | Check γ=hρgr/(2cosθ) with source correction assumptions; wrong meniscus orientation rejects |
| physics\|20\|effect-of-detergents-on-surface-tension | CH-25b | listed/listed/listed | Same apparatus before/after detergent; supplied rise observations | Independently compare inferred surface tensions holding controlled variables; qualitative detergent trend is not a measured numeric ratio |
| physics\|20\|viscosity-of-given-liquid | CH-25b | listed/application/listed | Liquid viscosity experiment; method and observations supplied | Check method-specific law and units; generic viscosity label cannot automatically establish terminal-speed apparatus |
| physics\|20\|terminal-velocity-method-for-viscosity | CH-25b | listed/application/listed | Sphere fall markers, terminal plateau, density and radius | Verify η=2r²(ρsphere-ρliquid)g/(9vt) in Stokes regime; Advanced Stokes application is not a named General experiment |
| physics\|20\|speed-of-sound-resonance-tube | CH-25b | listed/listed/listed | Resonance tube first/second resonance; open and water-closed boundary | Check v=2f(L2-L1) with consistent end correction; pressure/displacement node labels cannot swap |
| physics\|20\|specific-heat-capacity-by-mixtures | CH-25b | listed/application/listed | Heated solid, liquid, calorimeter and final mixture temperature | Independently close heat balance including calorimeter; Advanced General explicitly names liquid specific heat, not solid method |
| physics\|20\|specific-heat-capacity-of-a-liquid | CH-25b | listed/listed/listed | Liquid specific heat; mixtures for Main/NEET and source-specified calorimeter for Advanced | Check heat balance, masses and water equivalent; one method's observations cannot certify another method silently |
| physics\|20\|resistivity-using-metre-bridge | CH-25c | listed/listed/listed | Metre bridge null lengths and wire area; Advanced post-office-box alternative | Check balance ratio and ρ=RA/L; post-office-box resistance-arm topology and plug ratios require their own observations |
| physics\|20\|metre-bridge-end-correction | CH-25c | application/application/application | Both gap placements; supplied contact/end resistance corrections | Independently solve corrected bridge ratios and compare swapped gaps; zero correction cannot be assumed from ideal wire geometry |
| physics\|20\|resistance-of-wire-using-ohms-law | CH-25c | listed/listed/listed | Voltmeter parallel, ammeter series; observed V-I pairs | Check connection topology and slope R; Advanced Ohm verification is not automatically every resistance-measurement method |
| physics\|20\|galvanometer-resistance-half-deflection | CH-25c | listed/supplemental/listed | Half-deflection shunt switch and external resistance | Derive exact galvanometer resistance from both circuit states; RG≈shunt only under its stated large-series-resistance approximation |
| physics\|20\|galvanometer-figure-of-merit | CH-25c | listed/supplemental/listed | Half-deflection plus known current and angular divisions | Check figure of merit=I/deflection with calibrated units and exact circuit current; resistance measurement alone does not certify sensitivity |
| physics\|20\|emf-internal-resistance-and-potential-difference-of-cell | CH-25c | application/application/application | Open-circuit and loaded cell observations; ε,r,Vterminal | Check V=ε-Ir and measurement loading; broad cell topic is a circuit-law application, not an enumerated U20 activity |
| physics\|20\|focal-length-by-parallax-method | CH-25c | listed/application/listed | Concave mirror parallax pins for Main/NEET; u-v observations for Advanced | Independently check no-parallax coincidence, sign law and u-v focal calculation; one method cannot count as evidence for the other |
| physics\|20\|focal-length-convex-mirror-parallax | CH-25c | listed/supplemental/listed | Convex mirror parallax using an auxiliary real image | Verify optical order and virtual-image contact/sign convention; Advanced General lists concave mirror, not convex-mirror focal experiment |
| physics\|20\|focal-length-convex-lens-parallax | CH-25c | listed/application/listed | Convex lens no-parallax image for Main/NEET; u-v pairs for Advanced | Check coincidence and 1/f=1/v-1/u with signs; retain distinct method observations and uncertainty |
| physics\|20\|distance-and-magnification-for-convex-lens | CH-25c | application/application/application | Supplied lens distances and magnifications; signed real/virtual branches | Check m=v/u and lens equation from observed pairs; this graph is an application rather than a named current experiment |
| physics\|20\|prism-deviation-vs-incidence | CH-25c | listed/application/listed | Incidence/deviation observations on both sides of minimum | Verify prism geometry and minimum-deviation law from measured pairs; source-free smooth curve cannot certify measured minimum |
| physics\|20\|refractive-index-of-glass-slab | CH-25c | listed/supplemental/listed | Travelling microscope top/bottom/apparent-bottom readings | Check refractive index=true/apparent thickness with reading differences; parallax-pin observations cannot replace the microscope method |
| physics\|20\|pn-junction-diode-characteristic-curves | CH-25c | listed/supplemental/listed | Forward and reverse diode bias; ammeter range and observed I-V pairs | Check circuit polarity, axes and measured points; reverse-current resolution cannot be inferred from a generic scale |
| physics\|20\|zener-diode-characteristic-curves | CH-25c | listed/supplemental/listed | Zener reverse-bias sweep and observed breakdown knee | Check terminal polarity and independently identify breakdown from source data; a guessed voltage cannot become a measurement |
| physics\|20\|identify-basic-electronic-components | CH-25c | listed/supplemental/listed | Mixed diode, LED, resistor and capacitor specimens/source images | Check identifying features against referenced component evidence; appearance alone cannot infer numerical rating or polarity when unmarked |
| physics\|20\|identify-transistor-and-ic | CH-25c | supplemental/supplemental/supplemental | Transistor pinout and identified IC markings from supplied specimens | Match versioned component facts and terminal topology; current U20 mixed collection does not enumerate transistor/IC identification |
| physics\|20\|transistor-characteristic-curves-and-current-gain | CH-25c | supplemental/supplemental/supplemental | CE bias circuit; measured input/output curves and current gain | Recompute gain and operating point from observations; supplemental activity cannot silently become U20 coverage |
| physics\|20\|logic-gate-identification-and-truth-tables | CH-25c | application/application/application | Named five gates; all supplied input/output states | Exhaustively verify truth table and symbol terminal count; application of U19 logic is not an enumerated U20 experiment |

## Handoff

- CH-18 stays exclusively HEY-84-owned. CH-23a source diagnostics demonstrate a concrete wrong-series/wrong-direction gap; they do not establish any accepted topic.
- All 117 Physics rows retain their full negative/mutation/holdout and required-source/render/live/reveal/persistence/replay obligations. Diagram need/source exclusions remain unapproved, not silently text-only.
- Earliest priority candidates CH-19a/19d need S5. CH-19b needs S1 and CH-03a; CH-19c follows accepted CH-19b. CH-20/21, CH-22 and CH-24/25 remain blocked by listed seams/chapter contracts. A bounded CH-23a ordered-level diagnostic/fix slice is only a proposal, requiring agreed S0/S2/S3 and the owner's shared integration; no fourth writing slot is assumed.
- Ask the actual global owner for identity/contact, scope/profile and source cohort, exact accepted dependency code/versions, disjoint packet implementation/gate paths, total writer budget, and serial integration/lifecycle acceptance handoff. HEY-83/84 cannot grant these.
- Publication: uncommitted logs only; no new runtime code, dedicated gate, commit, branch, push, PR, merge or extra workers.

## Integration-owner disposition

Pending actual global owner. No accepted IDs, acceptance timestamps, topic-progress.csv edits, chapter-counter transitions or shared Drive/root updates made by HEY-85.
