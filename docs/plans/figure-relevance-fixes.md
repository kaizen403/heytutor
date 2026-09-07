# Wrong figures: measured causes and ranked fixes

Evidence: one lecture per hard probe across all 342 hard syllabus probes, run
through `apps/tutor/scripts/lecture-lab` on 4 Sep 2026, then reviewed by a
read-only lane that opened the transcripts group by group.

**152 of 342 lectures committed a figure that another unit's lecture also got.
About 87 of those are the wrong picture, 12 are marginal, 48 are legitimate
reuse.** The tutor almost never refuses one. The contract rule telling it to say
"the picture on the board does not show this setup" and teach in words is obeyed
in roughly 8% of the wrong cases, and only when the stem itself contains a
negation. Everywhere else it renames the drawn parts to fit: "q1 is the surface
point where depth is zero", "the thin lens is the vertical double-headed arrow"
pointing at a capacitor, "R1 and R2 are the two parallel plates of the
capacitor, and R3 is the voltage source".

## Root cause

The authored probe stems are "Draw <topic label> and mark any named directions,
levels, or components on the figure", plus one apparatus sentence appended per
unit by `topicCue` in
`packages/scene-engine/scripts/verify/generate-physics-unit-probes.ts`.

The topic half names no apparatus. The appended sentence is therefore the only
apparatus wording in the stem, and the family regexes and archetype cues fire on
it rather than on the topic:

| Appended cue | Sends to | Wrongly reaches |
|---|---|---|
| "Show the named charges and the electric field" | `point_field` two-charge document | gravitation, cyclotron, helical path, force on a moving charge, current loop |
| "Show the energy levels or the matter-wave along a line" | `bohrLevelDocument` | fission, Q value, nucleus, Rutherford, de Broglie, Davisson, photoelectric |
| "Draw the connected fluid and the named free surface or pipe" | one canned tanks-and-pipe document | calorimetry, latent heat, viscosity, Stefan, elasticity, thermal expansion |
| "or sketch the Maxwell speed curve" | `buildAnalyticCurve` schematic | every unit 8 and 9 stem, which then got bare axes |
| "Draw the circuit with named resistors and the source" | resistor chain | AC generator, transformer, eddy currents |

The cue also defeats guards written for exactly this. `sceneDemand` forbids
`bohr_levels` for a fission or photoelectric stem unless a level subject is
present, and the cue supplies the phrase "energy levels", so the veto never
fires. `buildEnergyLevel`'s own comment says those topics should teach text-only.

Two smaller mechanisms compound it. Plan `lawIds` leak into archetype detection,
so "Young-Laplace equation" scores `double_slit` for excess pressure and
capillary rise, and `kirchhoff_voltage_law` scores `two_loop_network` for a diode
I-V curve. And `FAMILY_PRIORITY` puts `analytic_curve` above `state_plot`, so a
thermodynamics stem reaches the axes-only schematic before the P-V builder is
ever asked.

## Ranked fixes

Counts are wrong figures removed, from the 342-probe sweep.

| # | Fix | Removes | Owner |
|---|---|---|---|
| 1 | Classify on the topic, not the appended cue. | ~60 | **the test-set half is landed**, see below |
| 2 | Never commit an axes-only document; degrade to text-only. Move `state_plot` ahead of `analytic_curve` for thermodynamic stems so the P-V schematic can draw, and add a Maxwell curve builder. | 19 | done for the commit half, see below |
| 3 | Split `buildFluidApparatus`: the connected-vessel document only for hydraulic, connected vessels, Pascal and pipe flow. Return null for calorimetry, expansion, elasticity, radiation, surface tension, viscosity and phase change until each has its own document. | 17 | **landed as a veto**, see below |
| 4 | Require an electrostatic subject for the `point_field` two-charge document, and extend `sceneDemand` to forbid point charges for any gravitation, magnetic, cyclotron, helical or Lorentz stem with no charge words. | 9 | **landed** |
| 5 | Add nucleus, fission, fusion, Q value, Rutherford, alpha, scattering, Davisson, de Broglie and photoelectric to the non-level list, and stop the bare phrase "energy levels" from satisfying the level subject when a non-level word is present. | 9 | **landed** |
| 6 | Archetype cue hygiene in `archetypes/detect.ts`: `/young/` must mean Young's double slit and not Young's modulus or Young-Laplace; a `kirchhoff` law id must not award `two_loop_network` without a stem cue; "circular loop" must not score `vertical_circle` when the stem is magnetic; an I-V stem must route to the state-plot builder. | 13 | **the Young and circular-loop cases are vetoed**; the rest is `archetypes/**` |
| 7 | Honour stem negations in archetype vetoes: "not a vertical circle", "not motion on an incline", "not 2D". | 5 | `archetypes/**` |
| 8 | The `buildCircuit` schematic must require resistor, ohm, series, parallel, battery, cell or emf. "Capacitor", "transistor" and "circuit symbols" alone must not draw resistors. | 4 | `synthesize/**` |

## Landed in `sceneDemand.ts`

Fixes 4 and 5, both in `packages/scene-engine/src/synthesize/sceneDemand.ts`,
which only ever rejects a candidate: when a rejection leaves no family standing
the turn teaches text-only, which is the documented honest outcome.

- The magnetic veto knew only about solenoids, coils and "current-carrying"
  wording, so the cyclotron, a helical path, force on a moving charge, a current
  loop as a magnetic dipole and Earth's magnetic elements all sailed past it into
  the two-point-charge figure. It now reads magnetic field, dipole, moment,
  element and flux, plus cyclotron, helical path, Lorentz, moving charge, current
  loop and Earth's magnetic. "dipole moment" in the electrostatic exemption is
  guarded against "magnetic dipole moment", which was cancelling its own veto.
- Gravitation now forbids the two-charge figure outright. It was reaching
  "acceleration due to gravity and its variation with altitude" and the same with
  depth.
- A charge spread along a wire, rod, line, sheet, plate or cylinder forbids it
  too. A sphere or shell deliberately does not: outside a uniform shell the field
  really is a point charge's, and `verify-family-synthesis` requires the point
  field for a numeric "field outside a shell" stem.
- The level veto accepted the bare phrase "energy levels" as evidence of a level
  subject. Every unit 17 and 18 stem carries that phrase in its appended drawing
  cue, so the veto never fired once on the ten stems it was written for. A
  non-level stem is now rescued only by a real level subject: Bohr, hydrogen atom
  or spectrum, a spectral series, an excited or ground state, Lyman, Balmer,
  Paschen, or binding energy per nucleon.

Three more vetoes followed, all in the same file, because the enforcement point
(`demandRejection`) is generic: both the demand and the feature reader live here,
so a wrong picture can be refused without editing the builder that draws it.

- **The connected-vessel document** (two tanks joined by a pipe) was reaching
  elasticity and heat. A stress-strain topic is not a tank, and neither is a
  calorimeter, a conducting rod or a cooling curve. Young's modulus, bulk
  modulus, Poisson's ratio, thermal expansion, calorimetry, heat transfer and the
  two specific-heat practicals now decline. Pascal's law, hydraulics, buoyancy,
  Bernoulli, Stokes, viscosity, terminal velocity and capillary rise keep it.
- **The double slit rig** was reaching Young's modulus, because the archetype
  detector reads "Young". An elasticity stem now forbids the slit pattern.
- **The vertical-circle figure**, a mass on a string with its weight and tension,
  was reaching Biot-Savart because the stem says "circular loop"; the lesson then
  called its velocity arrows "the current arrows v_A and v_B". Any magnetic,
  electrostatic or non-level atomic stem now forbids it, while a pendulum, a
  projectile and an angular-impulse stem keep it. That feature is gated against a
  document the gate builds itself, not against a live archetype, whose entity set
  changes while that layer is being worked on.

`verify-structure-driven-scene.ts` now carries eighteen verbatim syllabus stems
that must veto and six that must keep their figure, since a rule that only
rejects fails by over-rejecting. Seventeen of the eighteen veto; the shell stem
is the deliberate exception above. The whole scene-engine chain is green.

## Already landed in the app layer

- **A figure that carries no readable text is never committed.** Of 329 committed
  figures in the sweep, every one with eight or more primitives carried a label
  and every unlabelled one had seven or fewer, so drawn text is a safe proxy for
  "this is a real figure". This covers the commit half of fix 2. Re-running units
  7, 8 and 9 with it: mean score 63 to 89, every lecture passing, unlabelled
  figures 33 to 0 and empty figures 18 to 0. The cost is that 36 of those 50
  lectures now teach with no figure at all, which fixes 2, 3 and 5 would buy back.
- **A plan that asks for no figure no longer gets a fallback one**, when the
  deterministic stem filter agrees. That is fix 9 from the review.
- The tutor is now told what construction it has been handed, and is told to
  refuse one that is not this question's setup. Measured obedience is about 8%,
  which is why the fixes above are the real answer rather than more prompt text.

## The probe cue, fixed

`topicCue` in `generate-physics-unit-probes.ts` was a first-match cascade with
broad branches early, and the sentence it produced became the only apparatus
wording in the stem, which is what the family regexes read. It has been rewritten
against the real taxonomy labels on two rules: specific branches before broad
ones, and no cue at all for a topic no branch actually describes, because an
invented apparatus sentence is worse than a bare "Draw <topic>".

What changed, and what each topic asked for before and after:

| Topic | Was asked for | Now asked for |
|---|---|---|
| Mean free path | a P-V diagram or a Maxwell curve | nothing |
| Nuclear fission, fusion, Q value, nuclear composition | the n = 1 and n = 2 energy levels | nothing |
| AC generator, eddy currents | a circuit with named resistors | the coils or the rod-and-rails setup |
| Carnot, isothermal, adiabatic | a P-V diagram **or** a Maxwell curve | a P-V diagram |
| Maxwell speed distribution, rms speed | the same either-or | the Maxwell speed curve |
| Capillary rise, excess pressure, drops and bubbles | a connected fluid and a pipe | the liquid surface, contact angle and named height |
| Calorimetry, latent heat, thermal expansion, Stefan | a connected fluid and a pipe | the temperature graph, both axes labelled |
| Young's modulus, bulk modulus, Poisson's ratio | a connected fluid and a pipe | the stress-strain graph with its named limits |
| Photoelectric effect and graphs | energy levels or a matter-wave | the photoelectric graph, both axes labelled |
| Rutherford scattering | energy levels or a matter-wave | the incident path, the nucleus, the scattering angle |
| Using a metre scale by moments | circuit symbols and labelled terminals | nothing |
| Transistor as a switch, identifying an IC | a circuit with named resistors | nothing |
| Rolling friction | a rod hinged at one end | nothing |

`data/syllabus-probes/*.json` is regenerated: 14 of 20 files changed, 1026
questions, and `verify-syllabus-probes` is green.

The cost is honest and visible. `verify-physics-unit-probe-visuals` now reports
two capped buckets instead of a single pass: 48 probes whose subject the engine
deliberately vetoes, and 54 whose subject has no builder at all. Those 54 used to
satisfy the gate by drawing something else. The subjects with no builder are an
AC generator coil, an AC waveform, a reactance phasor, a transistor as a switch,
a metre scale on a pivot, a meniscus, a drop, and a photon's energy and momentum.
Fixes 3, 6, 7 and 8 below are what would give several of them a real figure.

## One more thing the measurement turned up

The connected-vessel document draws no text at all: its entities are `left`,
`pipe`, `right`, `tank1`, `tank2` and nothing is labelled. The app-layer guard
therefore refuses it even for the topics it is right for, so Pascal's law,
buoyancy, Bernoulli, Stokes and viscosity all teach text-only today. Labelling
that document is a small change with a direct payoff: five or six topics get
their figure back immediately, and it is the same fix as splitting it, only
cheaper.

## The rest of fix 1

In production a question carries no appended cue, so the remaining half of fix 1
is the engine-side rule the review named: a family regex hit that comes only from
a generic apparatus phrase, with no apparatus named by the question itself, must
not commit a figure. That still lives in `synthesize/**`.

## What the test set fix does not cover

Correcting the cue stops the stem from pointing at the wrong builder. It does not
give a subject a builder it never had, and it does not touch the archetype
detector's own cue hygiene: `/young/` still matches Young's modulus and the
Young-Laplace equation as well as Young's double slit, a `kirchhoff` law id still
awards the two-loop network to a diode I-V stem, and a stem that says "not a
vertical circle" is still not heard. Those are fixes 6 and 7 above and they live
in `archetypes/detect.ts`.

Re-running any round against the regenerated probes measures a different question
set from every round before it, so the earlier baselines in `.lecture-lab` are
comparable to each other but not across the regeneration.
