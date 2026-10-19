/**
 * The diagram must follow the solve, not a second English reading of the stem.
 *
 * `familyScene` used to receive only the question text, so every fallback
 * picture was guessed from prose even when the solver had already worked out
 * the structure. These cases pin the contract: when ProblemIR is present it
 * leads the family order and sharpens the picture demand, and when it is absent
 * the English oracle behaves exactly as before.
 */
import {
  pictureFeatures,
  sceneDemand,
  synthesizeFamilyScene,
  type ProblemStructureView,
} from "../../src";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/* -- Physics: a solved two-loop network is never a single-path chain -------- */

const kirchhoffIR: ProblemStructureView = {
  entities: [
    { kind: "component", label: "E1" },
    { kind: "component", label: "E2" },
    { kind: "component", label: "R1" },
    { kind: "component", label: "R2" },
    { kind: "component", label: "R3" },
  ],
  representationIntents: [{ kind: "network" }],
  constraints: [
    { kind: "connected", entityIds: ["n1", "n2"] },
    { kind: "connected", entityIds: ["n1", "n2"] },
  ],
};

// Stem wording alone says nothing about loops; only the solve does.
const plainNetworkStem = "Find the current in the middle branch of the circuit.";
const withoutStructure = sceneDemand(plainNetworkStem);
const withStructure = sceneDemand(plainNetworkStem, kirchhoffIR);
assert(
  !withoutStructure.forbids.includes("resistor_chain"),
  "without a solve, a plain network stem has no chain demand to make",
);
assert(
  withStructure.forbids.includes("resistor_chain"),
  "a solved two-loop network must forbid the single-path chain picture",
);

/* -- Physics: solved structure leads the family order ----------------------- */

const opticsIR: ProblemStructureView = {
  entities: [{ kind: "component", label: "R1" }, { kind: "component", label: "R2" }],
  representationIntents: [{ kind: "network" }],
};
const ambiguous = "A 12 V source drives two 6 ohm elements. Find the current.";
const structured = synthesizeFamilyScene({ question: ambiguous, problemIR: opticsIR });
if (structured) {
  assert(
    structured.family === "circuit_network",
    `solved component structure must lead the family order, got ${structured.family}`,
  );
}

/* -- Maths: a solved river crossing must show its banks --------------------- */

const riverIR: ProblemStructureView = {
  entities: [{ kind: "body", label: "boat" }],
  facts: [
    { kind: "statement", statement: "the boat crosses the river to the opposite bank" },
    { kind: "statement", statement: "the current flows downstream at 3 m/s" },
  ],
};
const riverDemand = sceneDemand("Find the resultant velocity.", riverIR);
assert(
  riverDemand.requires.includes("river_banks")
    || riverDemand.requires.length + riverDemand.forbids.length === 0,
  "a solved river crossing must either demand banks or make no demand at all",
);

/* -- No ProblemIR: the English oracle is unchanged -------------------------- */

const conicStem = "Tangents are drawn to the hyperbola x^2/9 - y^2/4 = 1.";
const englishOnly = sceneDemand(conicStem);
assert(
  englishOnly.requires.includes("conic"),
  "without a solve the English oracle must still demand the named conic",
);
const conicScene = synthesizeFamilyScene({ question: conicStem, families: [] });
assert(conicScene, "a stated conic must still compile with no ProblemIR");
assert(
  conicScene.document.constructions.some((construction) =>
    construction.operator === "implicit_curve" || construction.operator === "circle"),
  "a stated conic must draw a conic, not a line lifted from the prose",
);

/* -- Structure never silently drops a family the stem demands --------------- */

const emptyIR: ProblemStructureView = { entities: [], constraints: [], facts: [] };
const withEmpty = synthesizeFamilyScene({ question: conicStem, problemIR: emptyIR });
assert(
  Boolean(withEmpty) === Boolean(conicScene),
  "an empty ProblemIR must not change the outcome the English oracle reached",
);

/* -- Subject vetoes measured against real syllabus stems -------------------- */

// Every stem below is verbatim from `data/syllabus-probes`, and every one of
// them committed the picture named beside it in a 342-probe sweep on 4 Sep 2026.
// Two mechanisms did it. The magnetic veto only knew about solenoids and
// "current-carrying" wording, so a cyclotron, a helical path and Earth's
// magnetic elements sailed past into a two-point-charge figure; and the level
// veto accepted the bare phrase "energy levels" as evidence of a level subject,
// which every unit 17 and 18 stem carries in its appended drawing cue, so the
// veto never fired on a single one of them.
const MUST_VETO: [feature: "point_charges" | "bohr_levels", stem: string][] = [
  ["point_charges", "Draw Acceleration due to gravity and its variation with altitude and mark any named directions, levels, or components on the figure. Show the orbit and the gravitational field."],
  ["point_charges", "Draw Variation of acceleration due to gravity with depth and mark any named directions, levels, or components on the figure. Show the orbit and the gravitational field."],
  ["point_charges", "Draw Circular motion in a magnetic field and the cyclotron and mark any named directions, levels, or components on the figure."],
  ["point_charges", "Draw Helical path of a charge in a magnetic field and mark any named directions, levels, or components on the figure."],
  ["point_charges", "Draw Earth's magnetic field and magnetic elements and mark any named directions, levels, or components on the figure."],
  ["point_charges", "Draw Force on a moving charge in uniform magnetic and electric fields and mark any named directions, levels, or components on the figure. Show the named charges and the electric field."],
  ["point_charges", "Draw Current loop as a magnetic dipole and its magnetic dipole moment and mark any named directions, levels, or components on the figure. Show the current-carrying wire and the magnetic field."],
  ["point_charges", "Draw Gauss's law for an infinitely long uniformly charged straight wire and mark any named directions, levels, or components on the figure. Show the named charges and the electric field."],
  ["bohr_levels", "Draw Nuclear fission and mark any named directions, levels, or components on the figure. Show the n = 1 and n = 2 energy levels, or the scattering path if named."],
  ["bohr_levels", "Draw Nuclear fusion and mark any named directions, levels, or components on the figure. Show the n = 1 and n = 2 energy levels, or the scattering path if named."],
  ["bohr_levels", "Draw Q value of a nuclear reaction and mark any named directions, levels, or components on the figure. Show the n = 1 and n = 2 energy levels, or the scattering path if named."],
  ["bohr_levels", "Draw Composition and size of the nucleus and atomic masses and mark any named directions, levels, or components on the figure. Show the n = 1 and n = 2 energy levels, or the scattering path if named."],
  ["bohr_levels", "Draw Alpha-particle scattering experiment and Rutherford's model of the atom and mark any named directions, levels, or components on the figure. Show the n = 1 and n = 2 energy levels, or the scattering path if named."],
  ["bohr_levels", "Draw Davisson-Germer experiment and mark any named directions, levels, or components on the figure. Show the energy levels or the matter-wave along a line."],
  ["bohr_levels", "Draw de Broglie wavelength of an electron and mark any named directions, levels, or components on the figure. Show the energy levels or the matter-wave along a line."],
  ["bohr_levels", "Draw Dual nature of radiation and mark any named directions, levels, or components on the figure. Show the energy levels or the matter-wave along a line."],
  ["bohr_levels", "Draw Photoelectric effect and the observations of Hertz and Lenard and mark any named directions, levels, or components on the figure. Show the energy levels or the matter-wave along a line."],
];
for (const [feature, stem] of MUST_VETO) {
  assert(
    sceneDemand(stem).forbids.includes(feature),
    `"${stem.slice(0, 60)}..." must forbid ${feature}; it committed that picture before this veto existed`,
  );
}

// These rules only ever reject, so over-rejection is the failure mode to guard.
// A stem whose subject really is two charges, or really is a level transition,
// must keep its figure.
const MUST_ALLOW: [feature: "point_charges" | "bohr_levels", stem: string][] = [
  ["bohr_levels", "Draw Bohr model and energy levels and mark any named directions, levels, or components on the figure. Show the n = 1 and n = 2 energy levels, or the scattering path if named."],
  ["bohr_levels", "Draw Radius and speed of an electron in a Bohr orbit and mark any named directions, levels, or components on the figure. Show the n = 1 and n = 2 energy levels, or the scattering path if named."],
  ["bohr_levels", "Draw Hydrogen spectrum and spectral series and mark any named directions, levels, or components on the figure. Show the n = 1 and n = 2 energy levels, or the scattering path if named."],
  ["point_charges", "Draw Coulomb's law for two point charges and mark any named directions, levels, or components on the figure. Show the named charges and the electric field."],
  ["point_charges", "Draw Electric dipole and dipole moment in a uniform field and mark any named directions, levels, or components on the figure."],
  ["point_charges", "Draw Forces between multiple charges, superposition principle, and continuous charge distribution and mark any named directions, levels, or components on the figure. Show the named charges and the electric field."],
  // Outside a uniform shell the field is a point charge's, which is why
  // `verify-family-synthesis` requires the point field for a numeric shell stem.
  ["point_charges", "Apply Gauss's law to a uniformly charged thin spherical shell of radius 10 cm carrying 2 uC. Find the electric field outside."],
];
// A field question is not a mass on a string. The archetype detector was giving
// Biot-Savart the vertical-circle figure because the stem says "circular loop",
// and the lesson then called its velocity arrows "the current arrows v_A and
// v_B". The feature is asserted against a document built here rather than
// against a live archetype, whose entity set changes as that layer is worked on.
{
  const hanging = {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "test" },
    source: {},
    quantities: [],
    entities: [
      { id: "bob", kind: "point", role: "particle" },
      { id: "T", kind: "vector", role: "tension at the top" },
      { id: "W", kind: "vector", role: "weight" },
    ],
    constructions: [],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: [],
    revealGroups: [],
    teachingTimeline: [],
  } as unknown as Parameters<typeof pictureFeatures>[0];
  assert(
    pictureFeatures(hanging).has("suspended_body"),
    "a document drawing a tension or a weight must report the suspended-body feature",
  );

  const biotSavart =
    "Draw Biot-Savart law and its application to a current-carrying circular loop and mark any named directions, levels, or components on the figure. Show the current-carrying wire and the magnetic field.";
  assert(
    sceneDemand(biotSavart).forbids.includes("suspended_body"),
    "a magnetic-source stem must forbid the mass-on-a-string figure",
  );
  const pendulum =
    "Draw Simple pendulum and its time period and mark any named directions, levels, or components on the figure. Draw a spring-block oscillator and mark the amplitude.";
  assert(
    !sceneDemand(pendulum).forbids.includes("suspended_body"),
    "a pendulum really is a mass on a string and must keep that figure",
  );
}

// An LC circuit is not a block on a spring, however alike the mathematics is.
// The spring-block document was drawn for LC oscillations and the lesson taught
// the whole circuit off the mechanical analogy, marker on the block and the wall.
{
  const springBlock = {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "test" },
    source: {},
    quantities: [],
    entities: [
      { id: "body", kind: "object", role: "block" },
      { id: "sp0", kind: "polyline", role: "spring coil point" },
    ],
    constructions: [],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: [],
    revealGroups: [],
    teachingTimeline: [],
  } as unknown as Parameters<typeof pictureFeatures>[0];
  assert(
    pictureFeatures(springBlock).has("spring_block"),
    "a document drawing a spring must report the spring-block feature",
  );
  assert(
    sceneDemand("Draw LC oscillations and mark any named directions, levels, or components on the figure.")
      .forbids.includes("spring_block"),
    "an LC oscillation stem must forbid the spring-block figure",
  );
  assert(
    !sceneDemand("Draw Oscillations of a spring and mark any named directions, levels, or components on the figure. Draw a spring-block oscillator and mark the amplitude.")
      .forbids.includes("spring_block"),
    "a spring stem really is a spring and must keep that figure",
  );
}

// The connected-vessel document is one canned pair of tanks joined by a pipe,
// and the fluid family's keyword list reached elasticity and heat with it. A
// stress-strain topic is not a tank, and neither is a calorimeter or a cooling
// curve. Young's modulus was worse still: the archetype detector reads "Young"
// and offered it a double slit rig.
const MUST_NOT_DRAW_FLUID: string[] = [
  "Draw Young's modulus and mark any named directions, levels, or components on the figure. Sketch the stress-strain graph and mark the named limits.",
  "Draw Bulk modulus and modulus of rigidity and mark any named directions, levels, or components on the figure. Sketch the stress-strain graph and mark the named limits.",
  "Draw Poisson's ratio and mark any named directions, levels, or components on the figure. Sketch the stress-strain graph and mark the named limits.",
  "Draw Heat, temperature, and linear thermal expansion and mark any named directions, levels, or components on the figure. Sketch the temperature graph named by the topic and label both axes.",
  "Draw Specific heat capacity and calorimetry and mark any named directions, levels, or components on the figure. Sketch the temperature graph named by the topic and label both axes.",
  "Draw Heat transfer by conduction and mark any named directions, levels, or components on the figure. Sketch the temperature graph named by the topic and label both axes.",
];
for (const stem of MUST_NOT_DRAW_FLUID) {
  assert(
    sceneDemand(stem).forbids.includes("connected_fluid"),
    `"${stem.slice(0, 56)}..." must forbid the connected-fluid picture`,
  );
}
assert(
  sceneDemand(MUST_NOT_DRAW_FLUID[0]).forbids.includes("slit_pattern"),
  "Young's modulus must forbid the slit rig; the detector reads \"Young\" and offers it a double slit",
);

// The fluid family still has real work. Over-rejecting here would take the
// figure away from the topics it was built for.
const MUST_STILL_DRAW_FLUID: string[] = [
  "Draw Pascal's law and hydraulic applications and mark any named directions, levels, or components on the figure. Draw the connected fluid and the named free surface or pipe.",
  "Draw Buoyancy and Archimedes' principle and mark any named directions, levels, or components on the figure. Draw the connected fluid and the named free surface or pipe.",
  "Draw Streamline flow, turbulent flow, and Bernoulli's principle with applications and mark any named directions, levels, or components on the figure. Draw the connected fluid and the named free surface or pipe.",
  "Draw Stokes' law and terminal velocity and mark any named directions, levels, or components on the figure. Draw the connected fluid and the named free surface or pipe.",
];
for (const stem of MUST_STILL_DRAW_FLUID) {
  assert(
    !sceneDemand(stem).forbids.includes("connected_fluid"),
    `"${stem.slice(0, 56)}..." is genuinely a fluid figure and must keep it`,
  );
}

for (const [feature, stem] of MUST_ALLOW) {
  assert(
    !sceneDemand(stem).forbids.includes(feature),
    `"${stem.slice(0, 60)}..." is genuinely about ${feature} and must keep its figure`,
  );
}

console.log("verify-structure-driven-scene: ok");
console.log(
  `  cases=6 (two-loop demand, family order, river banks, english fallback, empty IR)` +
    ` + ${MUST_VETO.length} syllabus stems vetoed, ${MUST_ALLOW.length} kept` +
    `, ${MUST_NOT_DRAW_FLUID.length} kept off the fluid figure, ${MUST_STILL_DRAW_FLUID.length} kept on it`,
);
