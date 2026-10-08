# Electromagnetic Waves packet evidence — 9 October 2026

Disposition: **integration_pending; not accepted**. Eight exact topic rows remain
in the frozen eight-row denominator. This packet does not change the ledger or
accepted counters, and does not claim student-runtime readiness.

Continuation disposition: the four previously logged offline visual gaps are
closed and inspected in complete frames. The packet now exports its own exact
source-admission metadata; registering/enforcing it in shared paths and proving
the student lifecycle are still pending. Final focused gate: 8 models,
257 numeric/negative/atomic checks and 60 complete frames; scene-engine tsc PASS.

## Assignment and source contract

- Worker: `/root/emwaves_packet`; integration owner: `/root`.
- Receipt: the parent requested GPT-6.1 SOL with xhigh reasoning. The worker
  received that task, but the available runtime/tool metadata does not expose a
  trustworthy actual model/reasoning receipt. Do not label the requested
  configuration as independently verified.
- Worktree: `/Users/kaizen/heytutor-cov-wt/em-five-20261007`, branch
  `cov/em-five-chapters-20261007`, HEAD
  `834cbd6ad9dea29e5151da6314459be0104b91eb`; shared, already dirty checkout.
- Frozen source/evaluation profile:
  `.context/em-five-acceptance-20261009-v1/row-obligation-checklist.md`, the
  2026 Physics matrix and agent8 assignment. Characteristics, transverse nature,
  spectrum, applications and displacement are listed/shared at the matrix's
  stated exam grain; speed, energy and production retain their application tags.
- Read: `AGENTS.md`, root coverage plan, matrix index/Physics rows/progress
  contract, session ownership, row checklist, agent8 assignment and prior log,
  current module/gate, consume/model contract, and round-05 audit
  `/Users/kaizen/.capy/work/physics-round05-audit-20261009-GyIkBn/{REVIEW.md,probe-presentation.mts,presentation-results.json}`.
- Owned edits only:
  `packages/scene-engine/src/physics/em20261007/agent8-em-waves.ts`,
  `packages/scene-engine/scripts/verify/em20261007/verify-agent8.ts`, this log.
  Shared admission/IR/solver/compiler/planner/presentation/protocol/execution,
  persistence/replay and counters remain integration-owner responsibilities.
- Reuse: existing generic point/vector/circle/polyline/rectangle constructors,
  real document validation/atomic compiler, label layout, and the existing
  complete-board SVG writer. There is no chapter/question dispatch lookup and
  no English routing layer. Physical frame/sample data is separate from
  independently normalized display geometry.

## Initial defects and TDD evidence

The old gate only checked a fixed E-up/B-out/k-right triad, simple scalar
examples, and named spectrum points. It did not establish shared wave phase,
reversed orientations, medium wavelength/frequency, energy conventions,
application contexts, antenna emission, or conduction/displacement continuity.
Its opaque B dot used `fillRole:region`; the audit reproduced opaque SVG versus
translucent production-highlight semantics.

The pre-agreed seam was the public `consumePhysicalModel` model boundary,
followed by real `validateSceneDocument`/`compileSceneDocument`; no collaborators
were mocked. The TDD skill caused a red-before-green sequence for these slices:

1. Dot gate failed the region highlight; model changed to explicit opaque ink.
2. Worked plane-wave phase case failed on unsupported inputs; physical shared
   E/B samples and normalized curves were added.
3. Isotropic-medium worked example failed; speed/index/frequency/wavelength
   authority and consistency checks were added.
4. Peak-average/reflection example failed; explicit energy conventions and
   normal-incidence pressure were added.
5. Antenna example failed; declared dipole/far-zone source and directions added.
6. Source limits and X-ray use context failed; interval/ordering and factual
   band-use relationships added.
7. Dielectric continuity failed; signed surface currents and constitutive checks
   added.
8. Real compile assertions exposed verbose labels and the compiler's correct
   two-point `line` primitive for crosses. Labels became compact (full semantics
   remain in source/entity data); cross checks accept actual line strokes.
9. Independent overlapping source intervals failed; complete Min/Max groups
   added without converting overlaps to disjoint universal classifications.
10. Continuation assertions required student-visible frequency/wavelength,
    S/surface, outgoing B and inverse spectrum arrows rather than accepting
    metadata alone. Complete required entities and actual compiled label/vector/
    circle/cross assertions now cover those marks; deleting each new required
    component independently fails atomically with no render scene.
11. The gate required a serializable packet-exported source contract and scalar
    evaluator. Conditional role/unit/assumption metadata now covers peak/RMS,
    vacuum/material, Hz/m band limits, far-zone antenna and current surfaces.

## Public variant contracts and numeric/display boundary

All physical inputs must be finite, unsupported keys reject, and optional
physical groups must be complete. Unsupported/incompatible requests return a
rejection with no partial document. Physical products/ratios reject nonfinite
or uncertifiable nonzero-underflow results. Angles are bounded to one turn;
wave phase at the origin is bounded to `|phase| <= 1e9` for trigonometric
evaluation. These limits are supported-model bounds, not source exclusions.

| Model | Required base | Explicit extensions and outputs |
| --- | --- | --- |
| `emw.triad` | `crossed=1` | Complete `kSign,eSign,theta`; signs ±1, radians. Source physical right-handed xyz frame; E/B/k are checked in that frame, not by apparent projected angle. Positive Bz uses a dot, negative Bz a two-stroke cross. Static triad certifies no scalar. |
| `emw.amplitude` | positive `c,B`, `crossed=1` | Output `E=cB`. Optional complete `lambda,phase,time` requires full orientation; positive wavelength, phase radians, time seconds. Computes `f=c/lambda`, 97 physical samples over two wavelengths with shared `kSign*2πs/lambda-2πft+phase`. Source `planeWave` stores world fields; the two plotted heights are normalized independently and cannot prove E/B magnitude ratio. |
| `emw.speed` | positive `mu0,eps0` | Legacy vacuum output `c=1/sqrt(mu0*eps0)`. Extended vacuum: `medium=0,f>0`. Medium: `medium=1,isotropic=1,lossless=1,muR>0,epsR>0,f>0`; outputs `c,n,f,lambda`, with `n=sqrt(muR*epsR)`. Optional supplied lambda must agree. Extended frames mark source f on a normalized wave trace and source lambda on a one-period bracket, plus vacuum/medium. No metric pixel conversion or invented f/lambda in the legacy variant. Dispersive/lossy/anisotropic/negative-index media are outside this model. |
| `emw.energy` | positive `eps0,c`, nonnegative field magnitude `E` | Legacy instantaneous outputs `u,momentum`. Any extension requires `convention`: 0 instantaneous, 1 sinusoidal peak/cycle average, 2 RMS/cycle average. Outputs additionally `intensity,uElectric,uMagnetic,B`. Optional `mu0` checks vacuum constitutive consistency; optional `reflection` is 0 absorber/1 reflector at normal incidence and adds pressure. Optional complete orientation supplies Poynting world direction. S is visibly marked along physical k, and a declared absorber/reflector is drawn normal to incident S. Zero field/flux draw zero markers, not nonzero arrows. Material-medium momentum and oblique incidence are outside this model. |
| `emw.production` | nonzero `q,a` | Complete `farField=1,dipole=1,axisAngle,outgoingAngle` establishes the stated electric-dipole far-zone approximation and observation ray. Optional antenna additionally requires `antenna=1,length>0,frequency>0`. E follows the charge-signed transverse projection of acceleration; B follows n×E. Non-null far-zone frames visibly mark B radiation with an opaque out-of-page dot or into-page two-stroke cross. Exact dipole-axis null draws a null marker, with no fabricated outgoing arrow or nonzero field glyph. No power/angular intensity/wavelength is invented. |
| `emw.spectrum` | `shown=1` | Optional `order=±1`; every frame visibly marks increasing f radio→gamma and increasing lambda oppositely. Bounds require `boundUnit=1` Hz or `2` m plus all `edge0..edge7`, or all `radioMin,radioMax,...,gammaMin,gammaMax`. Adjacent edges follow the unit's order; independent positive Min<Max intervals may overlap, with nominal centres ordered by the stated bands. Source limits remain exact in metadata; long numbers use visibly approximate compact labels. Equal spacing does not imply metric/log band width. This is a representation of supplied classifications, not a universal numerical membership oracle; authoritative source-band review remains an integration obligation. |
| `emw.applications` | explicit 0/1 flags for all seven bands, at least one selected | Source use variant requires `sourceContext=1,useCode`; optional `useCode2` composes two uses. Codes: 1 radio broadcast, 2 microwave oven heating, 3 X-ray imaging, 4 infrared thermal imaging, 5 visible vision, 6 UV disinfection, 7 gamma radiotherapy, 8 microwave radar. Every selected band must have a matching supplied context; contradictions, unknown/duplicate uses and omitted context reject. Legacy band-only selection is only a representation. Removed the non-solved `certified.bands` scalar: all variants now carry `certified:{}`. |
| `emw.displacement` | positive `eps0`, signed `dPhi` | Output `id=eps0*dPhi`. Complete dielectric group `dielectric=1,epsR>0,linear=1,homogeneous=1` changes constitutive factor to eps0*epsR. Complete `area>0,dE,uniform=1` independently checks dPhi=area*dE. Complete `conduction,continuity=1` checks ic=id and adds `ic`; wire surface has conduction and gap surface displacement, with no gap conduction. Zero dPhi only accepts explicit steady continuity with zero conduction. Cut-surface circles and arrow lengths are schematic. |

Source constants in simple arithmetic fixtures are declared hypothetical values,
not a claim that SI vacuum constants can vary. The SI vacuum holdout uses
`mu0=1.25663706212e-6`, `eps0=8.8541878128e-12`, independently expecting about
299792458 m/s. Likewise the synthetic spectrum interval fixtures test faithful
transport/order, not a real measured wavelength classification.

## Independent expectations and source references

The gate uses worked literals, world dot/cross residuals, source interval facts,
and independent holdouts. Example: c=8, B0=0.5, lambda=4, t=1/16 gives f=2;
E_y(0)=-2.8284271247461903 and B_z(0)=-0.3535533905932738, both reversing at
s=lambda/4. At one full period all selected x samples repeat. Four propagation/
polarization sign combinations and a quarter-turn rotation have independently
specified world E/B/k vectors. Reversed propagation changes both phase travel
and handedness; reversing polarization changes both fields.

Other holdouts include n=1.5/v=2/3/lambda=1/3 in a declared medium; instantaneous,
peak-average and RMS energy; normal absorption versus reflection; a wave→energy
composite; a zero field; accelerating charge and dipole-axis null; frequency and
wavelength bounds (including overlapping intervals); all seven principal band
uses; signed dielectric continuity (-18 A); vacuum continuity; steady zero
current. Negatives include mechanical-wave and near-field wrong families,
partial source groups, longitudinal claims, singular/invalid values, overflow,
nonzero underflow, wrong wavelength, false convention/surface model, swapped
application band, wrong continuity sign, bad constitutive assumptions, missing
source evidence through the real IR/family seam, and required-B removal through
the atomic compiler.

References checked on 9 October 2026:

- [NCERT Physics XII chapter 8](https://ncert.nic.in/textbook/pdf/leph108.pdf):
  Maxwell displacement/production, shared plane-wave phase and spectrum/use
  sections 8.2–8.4.7; the source explicitly notes overlapping classifications.
- [OpenStax energy transport](https://openstax.org/books/university-physics-volume-2/pages/16-3-energy-carried-by-electromagnetic-waves)
  and [radiation momentum/pressure](https://openstax.org/books/university-physics-volume-2/pages/16-4-momentum-and-radiation-pressure)
  independently support the vacuum energy convention and normal absorber/
  reflector relationship. Equations are re-derived; no source prose/image is
  reproduced in the model.

## Machine-readable source-admission handoff

Export path: `packages/scene-engine/src/physics/em20261007/agent8-em-waves.ts`.
API: `emWaveSourceAdmissions: readonly EmWaveSourceAdmission[]` (eight entries,
schema `em-wave-source-admission/v1`) and
`emWaveScalar(name, inputs): Readonly<Record<string, number>>`; exported types
are `EmWaveSourceAdmission`, `EmWaveSourceRole`, `EmWaveSourceRule`.

Each entry includes required `roles`, `optionalRoles`, all-or-none
`optionalGroups`, base affirmative `assumptions`, `resultKind` scalar versus
representation, `closedInputs:true`, conditional source rules, possible output
units/meanings and diagram claims. Scalar models are amplitude, speed, energy
and displacement. Triad, production, spectrum and applications are explicitly
representations and return no solved scalar record. The evaluator calls the
actual packet model and returns only that variant's finite certified outputs;
it rejects invalid/partial/inconsistent requests rather than copying equations
into shared registration. Possible output descriptions do not authorize absent
variant values.

Required integration semantics: rule predicates are conjunctive; key presence
is not truthiness. Enforce `requiredKeys`, `forbiddenKeys` and
`requiredAnyGroup`, add the active rule's assumptions, and apply `roleOverrides`
before source role checking. `sourceValues` binds declaration/selection codes
to meaningful source statements, not numeric 0/1 tokens. Energy E changes role
for peak versus RMS conventions. Spectrum `unitByInput` resolves boundUnit=1
to Hz or boundUnit=2 to m; never use the default Hz unit for wavelength limits.
Default orientation, vacuum gap/material assumptions, source antenna/far-field
and oriented current surfaces are explicit. A shared flat metadata adapter
that omits these fields is not complete admission for the extended variants.
No shared adapter/registration/planner was edited by this worker.

## Commands and results — first handoff

Run from `packages/scene-engine`, unless otherwise stated:

- `./node_modules/.bin/tsx scripts/verify/em20261007/verify-agent8.ts` — PASS:
  8 models, 217 numeric/negative/atomic checks, 52 compiled complete frames.
  This count excludes many additional structural/label assertions; it is not a
  question/topic percentage or proof that every rendered frame was reviewed.
- `./node_modules/.bin/tsc --noEmit` — PASS, exit 0.
- `./node_modules/.bin/tsx scripts/verify/em20261007/verify-em-five.ts` — FAIL
  in the concurrently changing tree: 108 cases versus 92 stale oracles;
  `ce.iv_declared` certified records changed and sixteen new CE/DC models lacked
  aggregate oracles. No EM model failure was printed. Integrator owns expansion.
- `EM_WAVES_RENDER_DIR=/tmp/heytutor-emwaves-20261009-lG9tQ3 ./node_modules/.bin/tsx scripts/verify/em20261007/verify-agent8.ts`
  — PASS, writes 52 SVGs and `manifest.json` at the complete 1200×700 board size.
- Root `node --input-type=module -e ...` using installed Sharp from
  `node_modules/.pnpm/sharp@0.35.4_@types+node@20.19.43/node_modules/sharp`
  via `createRequire` transformed all 52 SVGs to corresponding full 1200×700
  PNGs without cropping. Initial attempts to resolve Sharp as an app direct
  dependency / obsolete `lib/index.js` failed; the package-root load succeeded.
- Viewed complete PNG frames `00-emw.amplitude-plane-wave-curves.png`,
  `23-emw.spectrum-overlapping-source-limits.png`, and
  `32-emw.displacement-signed-dielectric-continuity.png`: shared-phase traces and
  the opaque dot are present, bounds are in separate readable columns, signed
  current arrows agree and surface types remain distinguishable. The remaining
  49 frames were generated, not individually visually reviewed. All are offline
  SVG rasterizations, not Konva captures.
- No package build, lint, full verify, live turn, audio, paid provider, fresh
  auth, persistence or replay was run by this worker. No commit/publication.

## Commands and results — visual/metadata continuation

Run from the same shared checkout on 9 October 2026:

- Scene-engine `EM_WAVES_RENDER_DIR=/tmp/heytutor-emwaves-visual-20261009-KwIQl6 ./node_modules/.bin/tsx scripts/verify/em20261007/verify-agent8.ts`
  — PASS, exit 0: eight models, 257 counted numeric/negative/atomic checks,
  60 compiled complete frames. All eight new required-mark removals reject
  atomically. Contract JSON serialization, exact role/unit/group coverage,
  reflector assumptions, wavelength unit resolution, scalar-free applications
  and an independent evaluator lambda holdout are checked.
- Root `pnpm --filter @heytutor/scene-engine typecheck` — PASS, exit 0
  (`tsc --noEmit`). The earlier speed certified-record type issue is closed.
- The same installed Sharp command as above rasterized all 60 SVGs to full
  1200×700 PNGs, no cropping. Complete frame manifest:
  `/tmp/heytutor-emwaves-visual-20261009-KwIQl6/manifest.json`.
- Individually inspected all eight affected PNGs below. The other 52 current
  PNGs are generated, not individually reviewed in this continuation. These
  are complete offline SVG rasterizations, not Konva/lifecycle captures.

| Visual obligation closed offline | Compiled assertions and inspected complete PNGs in that directory |
| --- | --- |
| Student-visible speed f/lambda | `01-emw.speed-visible-frequency-and-wavelength.png`: f=0.25 Hz, lambda=2 m on a one-cycle bracket, normalized trace, medium and v. Real label text/polyline assertions; required trace/marker deletion fails atomically. |
| S plus source-declared surface | `02-emw.energy-reflector-with-reversed-S.png`, `03-emw.energy-absorber-with-forward-S.png`: S follows reversed/forward k; labeled vertical surface normal to incident S. Real vector direction, label and surface geometry assertions; S/surface deletion fails atomically. |
| Marked outgoing B radiation | `04-emw.production-antenna-B-into-page.png`, `05-emw.production-charge-B-out-of-page.png`: labeled B radiation ring with both cross strokes or concentric opaque dot. Physical n×E holdout plus actual primitive/provenance assertions; ring/cross deletion fails atomically. |
| Visible inverse spectrum cues | `06-emw.spectrum-ordinary-inverse-cue.png`, `07-emw.spectrum-reversed-inverse-cue.png`, `08-emw.spectrum-bounded-inverse-cue.png`: f increases radio→gamma, lambda increases oppositely; bounded cues avoid label columns. Real arrow-dot-product and exact label assertions; either cue deletion fails atomically. |

No aggregate oracle edits or rerun were required by this continuation: parent
explicitly owns the shared aggregate expansion. The earlier aggregate failure
remains a historical observation, not a claim about the latest shared state.
No package build, lint, live turn, paid provider, audio, persistence or replay;
no commit. Shared opaque-dot execution/protocol/save/replay remain root's work.

## Exact per-topic obligations and dispositions

All rows below are proposed `integration_pending`. Offline authority tests are
evidence for supported model variants; they do not establish source-grounded
student `exact_verified` or `qualitative_verified` output by themselves.

| Exact topic ID | Frozen obligations exercised | Offline tier / remaining obligations |
| --- | --- | --- |
| physics\|15\|displacement-current | Charging plates/gap, signed Id law; source conduction vs displacement surfaces; uniform area/field check; vacuum and explicit linear homogeneous dielectric; changing, reversed and steady states; bad sign/flux/constitutive inputs reject. | Question representation with deterministic id/ic data. Source-role/unit/topology admission, independent full-frame review, real reveal/save/replay pending. |
| physics\|15\|electromagnetic-waves-and-characteristics | Source-defined plane wave E/B/k, E=cB, shared phase at multiple x,t and full-period repeat, source f/lambda, amplitude/domain changes; mechanical wave and omitted/incomplete source reject. | Question representation with deterministic E and physical samples. Static triad alone receives no full-wave credit. Shared source/solver/planner transport and student lifecycle pending. |
| physics\|15\|transverse-nature | World E·k=B·k=E·B=0; E×B along k, all four sign combinations, rotated/reversed direction and polarization; longitudinal/singular/partial cases reject. | Qualitative relation at model seam; no projection-angle proof. Source admission and current production dot/cross/reveal/replay equivalence pending. |
| physics\|15\|speed-of-electromagnetic-waves | Vacuum c0, independently expected SI control, declared isotropic lossless medium n/v; visible f/lambda trace/bracket and supplied-wavelength consistency; wrong/omitted medium and singular products reject. | Deterministic values plus honest normalized propagation frame; f/lambda visual gap closed offline. Source-role/conditional medium admission, planner transport and actual student lifecycle remain pending. |
| physics\|15\|energy-and-momentum-of-em-waves | Instantaneous/peak-average/RMS amplitudes, equal field halves, energy flux, vacuum momentum, reversed Poynting direction, visible S and normal absorber/reflector with pressure, zero field and wave→energy composite; wrong conventions/constants reject. | Deterministic data plus complete E/B/k/S/surface schematic; S/surface gap closed offline. Convention-dependent E role and surface assumptions require shared source admission; full production/reveal/save/replay remain pending. |
| physics\|15\|electromagnetic-spectrum | All seven bands ordered with visibly inverse frequency/wavelength arrows; reversed strip; all supplied edges and independent overlapping Min/Max limits; omitted/invalid limits and decay wrong-family reject. | Qualitative source representation; direction-cue gap closed offline and categorical widths remain nonmetric. Real source-band factual review, unit-dependent admission and live/replay remain pending. No decay/Moseley scope inferred. |
| physics\|15\|applications-of-electromagnetic-waves | Communication/heating/imaging and the seven principal named band-use contexts, two-use composite, selected-band completeness, wrong association/flag/omitted context reject. | Source-context qualitative relationship; band-only legacy requests are representations. Recall-only text decisions stay separate. Affirmative source-context binding and live/replay remain pending. |
| physics\|15\|production-of-electromagnetic-waves | Accelerated nonzero charge, declared oscillating antenna/frequency, transverse far-zone outgoing E and marked B directions, charge/acceleration signs, dipole-axis null; stationary/zero/source-incomplete/near-field cases reject. | Qualitative approximation, no quantitative angular power/pattern; B visual gap closed offline. Source mechanism, signed axes, dipole/far-zone admission and live/replay remain pending. |

## Shared integration handoff

1. **Opaque dot semantics:** producer entity uses exactly
   `provenance: { inkRole: "opaque_dot" }`; no `fillRole:"region"`. The real
   compiler already transports it to `RenderPrimitive.provenance`. Carry this
   through typed drawing visual style and presentation into circle execution:
   foreground ink fill, opacity 1, preserving the ring as unfilled. SVG must use
   the same role; ordinary region highlighting must retain its own translucent
   semantics. Do not special-case `magnetic-dot` entity IDs. Gate verifies model
   and compiled provenance; production command/save/replay equivalence is yours.
   Latest inspected SVG already shows an opaque dot after concurrent shared work;
   this is not evidence of production execution.
2. **Admission/IR/solver/planner:** ground each actual selected variant's fields,
   roles, units, signs and affirmative assumptions from source spans. All groups
   above are explicit; source enum flags must bind meaningful affirmative source
   statements, not literal 1 tokens or generated fact prose. Numeric wavelength,
   field amplitude, physical constants and phase/time cannot be approved merely
   because a complete model request was produced. Model identity cannot confer
   source authority. Unadmitted and missing-source requests remain silent/reject.
3. **Aggregate oracle:** applications now has `{}` for both ordinary and altered,
   replacing `{bands:2}` / `{bands:1}`. The parent approved this correction and
   applied the shared oracle adjustment. Other ordinary EM scalar oracles remain
   unchanged. Aggregate additions in other packets are the integrator's work.
4. **Source classification and labels:** synthetic band interval tests establish
   faithful handling only. Verify real supplied band definitions independently;
   permit their documented overlaps without treating band names as a universal
   classifier. The compact-label contract remains enforced, with approximate
   display rounding explicit and full values preserved in source metadata.
5. **Remaining lifecycle work:** all four named offline visual gaps are now
   closed. Register and enforce the packet source contract (including conditional
   units/roles/assumptions), preserve independent solver authority and all model
   metadata through planner/IR/presentation, complete independent review of the
   remaining full-frame variants, and prove actual Konva reveal, persistence,
   reopened replay and scalar authority. These are integration prerequisites,
   not permission to count model-seam frames as accepted student coverage.

## Integration-owner disposition

Pending. Accepted IDs: none. Ledger/counter updates by this worker: none. Files
remain uncommitted. No other packet module/gate or shared production path was
edited by this worker.
