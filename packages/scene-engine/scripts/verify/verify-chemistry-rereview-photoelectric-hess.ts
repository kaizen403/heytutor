/** Real-source regressions for coordinator #137 re-review; no model calls. */
import assert from "node:assert/strict";
import { readChemistryQuantity } from "../../src/chemistry/quantityReader";
import { createHash } from "node:crypto";
import { buildAtomicRadiationScene, isAtomicRadiationStem } from "../../src/chemistry/atomicRadiation";
import { buildChemicalThermodynamicsScene } from "../../src/chemistry/chemicalThermodynamics";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { compileSceneDocument } from "../../src/compile/compiler";
import { inferChemistryFamilies, isChemistryQuestion } from "../../src/chemistry/router";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";

let checks = 0;
const failures: string[] = [];
function labels(document: SceneDocument | null): string[] {
  assert.ok(document, "expected a source-grounded scene");
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene, "scene must compile");
  const text = compiled.renderScene.primitives.flatMap(mark => mark.text ? [mark.text] : []);
  assert.ok(!text.some(label => /NaN|Infinity/.test(label)));
  return text;
}
function check(name: string, run: () => void): void {
  try { run(); checks++; } catch (error) { failures.push(name + ": " + String(error)); }
}
// These retained label checks agree with main; supplied-hc authority is deferred to #166.
const sourceHcStems = [
  "Light of wavelength 300 nm falls on a metal of work function 2.0 eV. Take hc = 1240 eV nm. Find the stopping potential in volts.",
  "The work function of a metal is 2.0 eV. Light has wavelength 300 nm. Using hc=1240 eV nm, calculate the photoelectron kinetic energy.",
  "For the photoelectric effect, work function is 2.0 eV and wavelength is 300 nm. Given hc is 1240 eV nm, find maximum kinetic energy.",
  "The work function of sodium is 2 eV; wavelength is 300 nm. Find the stopping potential using hc = 1.240e3 eV nm.",
  "In the photoelectric effect light wavelength is 300 nm. The work function of the metal is 2 eV. Take hc = 1240 eV nm and calculate Kmax.",
  "For a metal the work function is 2 eV. Incident light wavelength is 300 nm. The product hc = 1240 eV nm is given. Determine the kinetic energy.",
];
for (const question of sourceHcStems) check("source hc supplies its wavelength law: " + question, () => {
  const direct = labels(buildAtomicRadiationScene(question, [], false));
  assert.ok(direct.includes("K=2.13 eV"));
  const synthesis = synthesizeFamilyScene({ question });
  assert.ok(synthesis);
  assert.equal(synthesis.document.source.chemistryFamily, "chem_orbital");
  assert.ok(labels(synthesis.document).includes("K=2.13 eV"));
});
// Photoelectric hc refusal promises move to #166; original inputs/assertions are preserved at cb226db9.
for (const [product, expected] of [["1239.84", "K=2.00 eV"]] as const)
  check("an admitted source hc rounding convention supplies the actual wavelength law: " + product, () => {
    const question = `For the photoelectric effect wavelength is 300 nm and work function is 2.128 eV. Take hc=${product} eV nm. Find kinetic energy.`;
    assert.ok(labels(buildAtomicRadiationScene(question, [], false)).includes(expected));
    assert.ok(labels(synthesizeFamilyScene({ question })?.document ?? null).includes(expected));
  });
check("SI source hc converts value and unit together", () => {
  const question = "For the photoelectric effect, wavelength is 300 nm and work function is 2 eV. Take hc=1.9864458571489286e-25 J m. Find kinetic energy.";
  assert.ok(labels(buildAtomicRadiationScene(question, [], false)).includes("K=2.13 eV"));
});
// The h/hc contradiction integration promise is archived for #166 with its observed main outcome.
for (const suffix of ["Options: (a) hc=unknown (b) hc=1240 eV nm", "Options: (a) h=0 J s (b) c=1 m/s", "Options: (a) hc=1200 eV nm (b) hc=1240 eV nm"])
  check("option-only constants cannot change body authority: " + suffix, () => {
    const defaultBody = "For the photoelectric effect wavelength is 300 nm and work function is 2 eV. Find kinetic energy. " + suffix;
    assert.ok(labels(buildAtomicRadiationScene(defaultBody, [], false)).includes("K=2.13 eV"));
    assert.ok(labels(synthesizeFamilyScene({ question: defaultBody })?.document ?? null).includes("K=2.13 eV"));
    const sourceBody = "For the photoelectric effect wavelength is 300 nm and work function is 2 eV. hc=1240 eV nm. Find kinetic energy. " + suffix;
    assert.ok(labels(buildAtomicRadiationScene(sourceBody, [], false)).includes("K=2.13 eV"));
    assert.ok(labels(synthesizeFamilyScene({ question: sourceBody })?.document ?? null).includes("K=2.13 eV"));
  });
for (const subject of ["a metal", "the metal", "sodium", "the sodium", "potassium"])
  check("whole work-function owner: " + subject, () => {
    const question = `In the photoelectric effect the work function of ${subject} is 4.0 eV. Photons of energy 2.0 eV are incident. Are electrons emitted?`;
    const direct = labels(buildAtomicRadiationScene(question, [], false));
    assert.ok(direct.includes("no emission"));
    assert.ok(!direct.some(label => label.startsWith("K=")));
    const synthesis = synthesizeFamilyScene({ question });
    assert.ok(synthesis);
    assert.ok(labels(synthesis.document).includes("no emission"));
  });
const hessStems = [
  "Using Hess's law, step 1 has ΔH = -394 kJ as written. Step 2 has ΔH = -283 kJ and is reversed. Draw the enthalpy sum.",
  "Using Hess's law, step 1 is the enthalpy of combustion and has ΔH = -394 kJ as written. Step 2 is the enthalpy of formation and has ΔH = -283 kJ and is reversed. Draw the enthalpy sum.",
  "For Hess's law step 1: ΔH=-394 kJ. Step 2: ΔH=-283 kJ reversed. Find total enthalpy.",
  "Draw the Hess sum. Step 1 has ΔH = -394000 J. Step 2 has ΔH = -283 kJ and is reversed.",
  "Apply Hess law: Step 1 has ΔH = -394 kJ. Step 2 has ΔH = -283000 J and is reversed. Draw the sum.",
];
for (const question of hessStems) check("Hess enthalpies belong to their own original steps: " + question, () => {
  const direct = labels(buildThermoGraphScene(question, [], false));
  assert.ok(direct.includes("net=-111 kJ"));
  assert.ok(direct.includes("-394 kJ"));
  assert.ok(direct.includes("rev +283 kJ"));
  const synthesis = synthesizeFamilyScene({ question });
  assert.ok(synthesis);
  assert.ok(labels(synthesis.document).includes("net=-111 kJ"));
});
check("Hess factor is independently source-grounded", () => {
  const question = "Using Hess's law, step 1 has ΔH = -100 kJ multiplied by 2. Step 2 has ΔH = +30 kJ as written. Draw the enthalpy sum.";
  assert.ok(labels(buildThermoGraphScene(question, [], false)).includes("net=-170 kJ"));
});
for (const value of ["4e- kJ", "1e999 kJ", "unknown", "20 kg", "20 kJ/mol"])
  check("step-owned invalid enthalpy cannot bypass validation: " + value, () => {
    const question = `Using Hess's law, step 1 has ΔH=-394 kJ. Step 2 has ΔH=${value} and is reversed. Draw the enthalpy sum.`;
    assert.equal(buildThermoGraphScene(question, [], false), null);
    assert.equal(synthesizeFamilyScene({ question }), null);
  });
// Multiple-metal photoelectric ownership remains a #166 promise; do not claim it fixed here.
const atomicLaneRows = [
  {
    "id": "M13-4",
    "question": "Calculate the energy of a photon of wavelength 500 nm (h = 6.626 × 10^-34 J s, c = 3 × 10^8 m/s).",
    "expectedK": null,
    "reason": "Unsupported photon-only chemistry ask or unchanged rounded h/c reference policy; honest chemistry decline"
  },
  {
    "id": "M13-5",
    "question": "Calculate the energy of a photon of wavelength 500 nm.",
    "expectedK": null,
    "reason": "Unsupported photon-only chemistry ask or unchanged rounded h/c reference policy; honest chemistry decline"
  },
  {
    "id": "M13-6",
    "question": "The work function of potassium is 2.25 eV. Light of wavelength 300 nm falls on it. Find the kinetic energy of the emitted electrons.",
    "expectedK": "K=1.88 eV",
    "reason": "Source wavelength and work function, no declared conflicting reference constants"
  },
  {
    "id": "M13-7",
    "question": "Calculate the de Broglie wavelength of an electron moving with a velocity of 2 × 10^6 m/s (h = 6.626 × 10^-34 J s, mass 9.1 × 10^-31 kg).",
    "expectedK": null,
    "reason": "Unsupported photon-only chemistry ask or unchanged rounded h/c reference policy; honest chemistry decline"
  },
  {
    "id": "M13-c",
    "question": "The work function of potassium is 2.25 eV. Light of wavelength 300 nm falls on it. Find the kinetic energy of the photoelectrons.",
    "expectedK": "K=1.88 eV",
    "reason": "Source wavelength and work function, no declared conflicting reference constants"
  }
] as const;
for (const row of atomicLaneRows) check("coordinator atomic lane: " + row.id, () => {
  const document = buildAtomicRadiationScene(row.question, [], false);
  if (row.expectedK) assert.ok(labels(document).includes(row.expectedK));
  else assert.equal(document, null, row.reason);
});
const thermoLaneRows = [
  {
    "id": "M9",
    "question": "The equilibrium constant of a reaction at 298 K is 1.8 × 10^-5. Calculate ΔG°."
  },
  {
    "id": "M9b",
    "question": "The equilibrium constant of a reaction at 300 K is 2.5 × 10^8. Calculate ΔG°."
  },
  {
    "id": "M9c",
    "question": "The equilibrium constant of a reaction at 298 K is 0.0045. Calculate ΔG°."
  },
  {
    "id": "M10",
    "question": "Draw the energy profile for a reaction with ΔH = −92.4 kJ/mol and Ea = 150 kJ/mol."
  },
  {
    "id": "M10b",
    "question": "Construct the Born Haber cycle for NaCl. Enthalpy of sublimation of Na = 108 kJ/mol, ionisation enthalpy of Na = 496 kJ/mol, bond dissociation enthalpy of Cl2 = 242 kJ/mol, electron gain enthalpy of Cl = −349 kJ/mol and enthalpy of formation of NaCl = −411 kJ/mol. Calculate the lattice enthalpy of NaCl."
  },
  {
    "id": "M10c",
    "question": "Construct the Born Haber cycle for MgO. Enthalpy of sublimation of Mg = 148 kJ/mol, ionisation enthalpy of Mg = 2189 kJ/mol, bond dissociation enthalpy of O2 = 498 kJ/mol, electron gain enthalpy of O = 657 kJ/mol and enthalpy of formation of MgO = −602 kJ/mol. Calculate the lattice enthalpy of MgO."
  },
  {
    "id": "M10d",
    "question": "For a reaction ΔH = 100000 kJ/mol and ΔS = 100 J K−1 mol−1. Draw ΔG vs T and find the temperature where ΔG = 0."
  },
  {
    "id": "M11",
    "question": "ΔH° = -92 kJ/mol and ΔS° = -199 J/(mol K). Draw ΔG vs T."
  },
  {
    "id": "M11b",
    "question": "For the reaction ΔH° = -92 kJ/mol and ΔS° = -199 J/(mol K). Draw ΔG vs T."
  },
  {
    "id": "M11c",
    "question": "Draw the energy profile for an exothermic reaction with Ea = 60 kJ/mol and ΔH° = −20 kJ/mol."
  },
  {
    "id": "M11d",
    "question": "For a reaction ΔH = 40 kJ/mol and ΔS = 100 J K−1 mol−1. Above what temperature will the reaction become spontaneous?"
  },
  {
    "id": "M17a",
    "question": "The activation energy for the reaction 2HI(g) → H2(g) + I2(g) is 209.5 kJ mol^-1 at 581 K. Calculate the fraction of molecules of reactants having energy equal to or greater than activation energy."
  },
  {
    "id": "M9-tiny",
    "question": "The equilibrium constant of a reaction at 298 K is 1.0 × 10^-30. Calculate ΔG°."
  },
  {
    "id": "M9-dg",
    "question": "The standard Gibbs energy change ΔG° = 10 kJ/mol at 300 K. Calculate the equilibrium constant."
  },
  {
    "id": "M9-dg-big",
    "question": "The standard Gibbs energy change ΔG° = 120 kJ/mol at 300 K. Calculate the equilibrium constant."
  },
  {
    "id": "M14-ea-this",
    "question": "The activation energy for this reaction is 75 kJ/mol and ΔH = -25 kJ/mol. Draw the energy profile diagram."
  },
  {
    "id": "M14-two-ea",
    "question": "Draw the energy profile. The activation energy without catalyst is 100 kJ/mol and with catalyst is 60 kJ/mol, ΔH = -20 kJ/mol."
  }
] as const;
const gibbsOracle: Record<string, { K: number; T: number; G: number }> = {
  M9: { K: 1.8e-5, T: 298, G: -8.314 * 298 * Math.log(1.8e-5) / 1000 },
  M9b: { K: 2.5e8, T: 300, G: -8.314 * 300 * Math.log(2.5e8) / 1000 },
  M9c: { K: 0.0045, T: 298, G: -8.314 * 298 * Math.log(0.0045) / 1000 },
  "M9-tiny": { K: 1e-30, T: 298, G: -8.314 * 298 * Math.log(1e-30) / 1000 },
  "M9-dg": { K: Math.exp(-10000 / (8.314 * 300)), T: 300, G: 10 },
  "M9-dg-big": { K: Math.exp(-120000 / (8.314 * 300)), T: 300, G: 120 },
};
const thermoQuantities: Record<string, Array<[string, number, string]>> = {
  M10: [["dH", -92.4, "kJ/mol"], ["Ea_forward", 150, "kJ/mol"]],
  M10b: [["lattice_enthalpy", -787, "kJ/mol"], ["formation_enthalpy", -411, "kJ/mol"]],
  M10d: [["dH", 100000, "kJ/mol"], ["dS", 100, "J/(mol K)"], ["T_eq", 1000000, "K"]],
  M11: [["dH", -92, "kJ/mol"], ["dS", -199, "J/(mol K)"], ["T_eq", 92000 / 199, "K"]],
  M11b: [["dH", -92, "kJ/mol"], ["dS", -199, "J/(mol K)"], ["T_eq", 92000 / 199, "K"]],
  M11c: [["dH", -20, "kJ/mol"], ["Ea_forward", 60, "kJ/mol"]],
  M11d: [["dH", 40, "kJ/mol"], ["dS", 100, "J/(mol K)"], ["T_eq", 400, "K"]],
  "M14-ea-this": [["dH", -25, "kJ/mol"], ["Ea_forward", 75, "kJ/mol"]],
};
for (const row of thermoLaneRows) check("coordinator thermochemistry lane: " + row.id, () => {
  if (["M10c", "M17a", "M14-two-ea"].includes(row.id)) {
    // MgO is outside the alkali-halide cycle; a Boltzmann fraction is not an
    // energy-profile ask; the implicit second catalyst role is unsupported.
    assert.equal(buildThermoGraphScene(row.question, [], false), null);
    assert.equal(synthesizeFamilyScene({ question: row.question }), null);
    return;
  }
  const direct = gibbsOracle[row.id]
    ? buildChemicalThermodynamicsScene(row.question, [], false)
    : buildThermoGraphScene(row.question, [], false);
  assert.ok(direct);
  const ordinary = synthesizeFamilyScene({ question: row.question });
  assert.ok(ordinary);
  for (const document of [direct, ordinary.document]) {
    const text = labels(document);
    const eq = gibbsOracle[row.id];
    if (eq) {
      const kLabel = text.find(label => label.startsWith("K="));
      const gLabel = text.find(label => label.startsWith("dGo="));
      assert.ok(kLabel && gLabel && text.includes("kJ/mol"));
      const k = Number(kLabel.slice(2));
      // Compare the displayed value at its own last decimal place. This is an
      // independent rounding oracle; a plain 0.02 label represents 0.015–0.025.
      const shown = kLabel.slice(2);
      const parts = /^([+-]?\d+(?:\.\d+)?)(?:e([+-]?\d+))?$/i.exec(shown);
      assert.ok(parts, "complete numeric K label");
      const decimals = parts[1]!.split(".")[1]?.length ?? 0;
      const quantum = 10 ** (Number(parts[2] ?? 0) - decimals);
      assert.ok(Number.isFinite(k) && k > 0 && Number.isFinite(quantum) && quantum > 0
        && Math.abs(k - eq.K) <= quantum / 2 + Math.abs(eq.K) * 1e-12);
      assert.ok(Math.abs(Number(gLabel.slice(4)) - eq.G) <= 0.00051);
      assert.ok(text.includes(`T=${eq.T} K`));
    } else {
      for (const [id, value, unit] of thermoQuantities[row.id] ?? []) {
        const quantity = document.quantities.find(q => q.id === id);
        assert.ok(quantity, id);
        assert.ok(typeof quantity.value === "number", id);
        assert.ok(Math.abs(quantity.value - value) <= 1e-8 * Math.max(1, Math.abs(value)), id);
        assert.equal(quantity.unit, unit);
      }
      assert.ok((thermoQuantities[row.id]?.length ?? 0) > 0, "every row must have an independent value oracle");
    }
  }
});
check("exact lane-D intensive and extensive wording preserves canonical energy", () => {
  const question = "The temperature 300 K is intensive and the internal energy is 10 kJ is extensive. The sample is doubled. Draw the distinction.";
  for (const document of [buildThermoGraphScene(question, [], false), synthesizeFamilyScene({ question })?.document ?? null]) {
    const text = labels(document);
    assert.ok(text.includes("T=300 K") && text.includes("U=20000 J"));
    assert.ok(text.includes("intensive") && text.includes("extensive"));
  }
});
check("exact lane-D Gibbs energy gives a dimensionless equilibrium constant", () => {
  const question = "ΔG° = -5.708 kJ/mol at 298 K. Find the thermodynamic equilibrium constant K. This is not a reaction rate.";
  const expected = Math.exp(5708 / (8.314 * 298));
  for (const document of [buildThermoGraphScene(question, [], false), synthesizeFamilyScene({ question })?.document ?? null]) {
    const text = labels(document);
    assert.ok(text.includes("dGo=-5.708") && text.includes("kJ/mol") && text.includes("T=298 K"));
    const kLabel = text.find(label => label.startsWith("K="));
    assert.ok(kLabel && Math.abs(Number(kLabel.slice(2)) - expected) <= .005 + expected * 1e-12);
  }
});
// Supplemental lane-D literal questions have their own ordinary-route oracles.
const laneDPhotoelectric = [
  "Light of wavelength 300 nm falls on a metal of work function 2.0 eV. Find the stopping potential in volts.",
  "Light of wavelength 300 nm falls on a metal of work function 2.0 eV. Take hc = 1239.84 eV nm. Find the stopping potential in volts.",
  "Light of wavelength 300 nm falls on a metal of work function 2.0 eV. Take hc = 1240 eV nm. Find the stopping potential in volts.",
];
for (const question of laneDPhotoelectric) check("exact lane-D source hc: " + question, () => {
  assert.ok(labels(buildAtomicRadiationScene(question, [], false)).includes("K=2.13 eV"));
  assert.ok(labels(synthesizeFamilyScene({ question })?.document ?? null).includes("K=2.13 eV"));
});
check("exact lane-D wave and particle wording retains its source-grounded photon panel", () => {
  const question = "Light of wavelength 500 nm gives Young fringes with slit separation 0.50 mm and screen distance 1.0 m. The same light falls on a metal of work function 2.0 eV. Using hc=1240 eV nm, find fringe width and maximum photoelectron energy; identify the wave and particle observations.";
  assert.ok(labels(buildAtomicRadiationScene(question, [], false)).includes("K=0.48 eV"));
  const ordinary = synthesizeFamilyScene({ question });
  assert.ok(ordinary);
  assert.equal(ordinary.document.source.chemistryFamily, "chem_orbital");
  assert.ok(labels(ordinary.document).includes("K=0.48 eV"));
});
const laneDUnsupported = [
  "A nonrelativistic particle has momentum 3.313×10^-24 kg m/s. Using h=6.626×10^-34 J s, find its de Broglie wavelength.",
];
for (const question of laneDUnsupported) check("exact lane-D unsupported physics ask declines honestly: " + question, () => {
  assert.equal(buildAtomicRadiationScene(question, [], false), null);
  assert.equal(synthesizeFamilyScene({ question }), null);
});
for (const question of [
  "The activation energy is 209.5 kJ/mol at 581 K. Calculate the fraction of molecules having energy greater than activation energy.",
  "At 600 K the activation energy is 200 kJ/mol. Find the fraction of molecules with energy above the activation energy.",
  "For molecules at 550 K with activation energy 150 kJ/mol, determine the fraction of molecules having enough energy to react.",
  "Compute the percentage of molecules with energy greater than activation energy 100 kJ/mol at 500 K.",
  "At 450 K, activation energy is 80 kJ/mol. What fraction of molecules has energy above the activation barrier?",
]) check("numeric fraction ask cannot become a two-temperature cartoon: " + question, () => {
  assert.equal(buildThermoGraphScene(question, [], false), null);
  assert.equal(buildThermoGraphScene(question, [], true), null);
  assert.equal(synthesizeFamilyScene({ question }), null);
});
for (const roles of [
  "The activation energy without catalyst is 100 kJ/mol and with catalyst is 60 kJ/mol",
  "Activation energy with a catalyst is 60 kJ/mol; activation energy without a catalyst is 100 kJ/mol",
  "The activation energy without the catalyst is unknown and with the catalyst is 60 kJ/mol",
  "The activation energy without catalyst is 100 kg and with catalyst is 60 kJ/mol",
  "Ea without catalyst is 100 kJ/mol and Ea with catalyst is 60 kJ/mol",
]) check("unread catalyst source roles cannot become qualitative: " + roles, () => {
  const question = "Draw the reaction energy profile. " + roles + ", ΔH=-20 kJ/mol.";
  assert.equal(buildThermoGraphScene(question, [], false), null);
  assert.equal(buildThermoGraphScene(question, [], true), null);
  assert.equal(synthesizeFamilyScene({ question }), null);
});
for (const question of [
  "Using the Maxwell Boltzmann distribution of molecular energies explain why the fraction of molecules with energy greater than the activation energy increases with temperature.",
  "Show with an energy profile diagram how a catalyst lowers the activation energy of an exothermic reaction without changing ΔH.",
]) check("qualitative explanation with no unsupported numeric roles is retained: " + question, () => {
  labels(buildThermoGraphScene(question, [], false));
  labels(synthesizeFamilyScene({ question })?.document ?? null);
});

// BEGIN PR137 unread work-function owners (public-source freeze 15 Oct 2026).
// Main-compatible controls retained after restoring main photoelectric behavior.
// Stronger unread/duplicate-owner contracts remain in the immutable #166 transfer archive.
const workFunctionOwnerRows = [
  {
    "id": "WF-REPORTED-UNREAD-FIRST",
    "question": "Work function is unknown. The work function is 2 eV. Light of frequency 1e15 Hz falls on the metal. Draw the photoelectric diagram.",
    "questionSha256": "e370d8e9fbcec42830a0df1746905b75506c525f9b692c094f9a21b856daa3b0",
    "expected": "decline"
  },
  {
    "id": "WF-FRESH-EMPTY-FIRST",
    "question": "For the photoelectric effect, the work function is ; the work function is 2 eV. Light of frequency 1e15 Hz is incident. Draw the diagram.",
    "questionSha256": "bc071b3e88bcfae8967f2c5937582f7115ea6e10f1c3cee1f28bb0cab9570f49",
    "expected": "decline"
  },
  {
    "id": "WF-FRESH-METAL-A-UNREAD",
    "question": "Metal A’s work function is unknown. Metal B’s work function is 2 eV. Light of frequency 1e15 Hz falls on metal A. Draw the photoelectric diagram.",
    "questionSha256": "3d91a5311b5f55e6cfd1713ee6aebcfe34e5dc43d076e7a85756cf82956eabd8",
    "expected": "decline"
  },
  {
    "id": "WF-SINGLE-EV",
    "question": "The work function is 2 eV. Light of frequency 1e15 Hz falls on the metal. Draw the photoelectric diagram.",
    "questionSha256": "5d89f6cebb1b1943f393e24cc95ec9c9a2ed80e6819058f60f3b1031283639b8",
    "expected": "draw"
  },
] as const;
// Independent SI constants and the source frequency, not a family-derived value.
const workFunctionPhotonEv = 6.62607015e-34 * 1e15 / 1.602176634e-19;
for (const row of workFunctionOwnerRows) check("original work-function owner: " + row.id, () => {
  assert.equal(createHash("sha256").update(row.question).digest("hex"), row.questionSha256);
  const direct = buildAtomicRadiationScene(row.question, [], false);
  const schematic = buildAtomicRadiationScene(row.question, [], true);
  const ordinary = synthesizeFamilyScene({ question: row.question });
  if (row.expected === "decline") {
    assert.equal(direct, null, "direct builder must decline every unresolved or ambiguous owner");
    assert.equal(schematic, null, "schematic builder must preserve the same owner boundary");
    assert.equal(ordinary, null, "ordinary family route must not draw a substituted work function");
    return;
  }
  assert.ok(ordinary?.renderScene, "single declaration must draw through the ordinary route");
  assert.equal(ordinary.family, "chem_orbital");
  for (const document of [direct, schematic, ordinary.document]) {
    assert.ok(document, "single declaration must retain direct and schematic figures");
    assert.equal(document.source.question, row.question);
    assert.equal(document.source.chemistryFamily, "chem_orbital");
    const text = labels(document);
    assert.ok(text.includes("phi=2.00 eV"), "work-function label must use the source value after J/eV conversion");
    for (const [symbol, expected] of [["phi", 2], ["E", workFunctionPhotonEv], ["K", workFunctionPhotonEv - 2]] as const) {
      const label = text.find(value => value.startsWith(symbol + "="));
      assert.ok(label, symbol + " label is required");
      const scalar = new RegExp("^" + symbol + "=([0-9]+\\.[0-9]{2}) eV$").exec(label);
      assert.ok(scalar, "complete two-decimal energy label: " + label);
      assert.ok(Math.abs(Number(scalar[1]) - expected) <= 0.005 + Math.abs(expected) * 1e-12,
        symbol + " must agree with the independent photoelectric value");
    }
  }
});
// END PR137 unread work-function owners.

// BEGIN PR137 work-function diagram-reference controls (separate source freeze).
const workFunctionReferenceRows = [
  {
    "id": "WF-REFERENCE-BARE",
    "question": "The work function is 2 eV. Light of frequency 1e15 Hz falls on the metal. Draw a photoelectric diagram showing the work function.",
    "questionSha256": "370d111a0b48903c03e24b41e807eabcfc95300849223cdc283327be115f543a",
    "expected": "draw"
  },
] as const;
for (const row of workFunctionReferenceRows) check("work-function diagram-reference role: " + row.id, () => {
  assert.equal(createHash("sha256").update(row.question).digest("hex"), row.questionSha256);
  const direct = buildAtomicRadiationScene(row.question, [], false);
  const schematic = buildAtomicRadiationScene(row.question, [], true);
  const ordinary = synthesizeFamilyScene({ question: row.question });
  assert.ok(ordinary?.renderScene, "a bare diagram reference must retain the single declared value");
  assert.equal(ordinary.family, "chem_orbital");
  for (const document of [direct, schematic, ordinary.document]) {
    assert.ok(document);
    assert.equal(document.source.question, row.question);
    assert.equal(document.source.chemistryFamily, "chem_orbital");
    const text = labels(document);
    assert.ok(text.includes("phi=2.00 eV"), "bare reference must retain the original work-function label");
    for (const [symbol, expected] of [["phi", 2], ["E", workFunctionPhotonEv], ["K", workFunctionPhotonEv - 2]] as const) {
      const label = text.find(value => value.startsWith(symbol + "="));
      assert.ok(label, symbol + " label is required");
      const scalar = new RegExp("^" + symbol + "=([0-9]+\\.[0-9]{2}) eV$").exec(label);
      assert.ok(scalar, "complete two-decimal energy label: " + label);
      assert.ok(Math.abs(Number(scalar[1]) - expected) <= 0.005 + Math.abs(expected) * 1e-12,
        symbol + " must agree with the independent photoelectric value");
    }
  }
});
// END PR137 work-function diagram-reference controls.

// BEGIN PR137 complete decimal work-function scalar controls.
const workFunctionDecimalRows = [
  {
    "id": "WF-DECIMAL-E-EXPONENT",
    "question": "The work function is 2.e0 eV. Light of frequency 1e15 Hz falls on the metal. Draw the photoelectric diagram.",
    "questionSha256": "bcfe29494af99804232df335fdad25b8a4ceaddf4ed858705012b00ddeae139a",
    "expected": "draw"
  },
  {
    "id": "WF-DECIMAL-TIMES-EXPONENT",
    "question": "The work function is 2.×10^0 eV. Light of frequency 1e15 Hz falls on the metal. Draw the photoelectric diagram.",
    "questionSha256": "272a8dbd73b18db40426bf512b7354695ed21c08b2c814bde47755427c8ab5b8",
    "expected": "draw"
  }
] as const;
for (const row of workFunctionDecimalRows) check("complete decimal work-function scalar: " + row.id, () => {
  assert.equal(createHash("sha256").update(row.question).digest("hex"), row.questionSha256);
  const source = readChemistryQuantity({ question: row.question, after: /work function/, dimension: "energy", targetUnit: "eV" });
  assert.ok(source.ok, "the public quantity reader must accept the complete decimal scalar");
  assert.equal(source.reading.value, 2, "both complete source scalars independently equal 2 eV");
  const ordinary = synthesizeFamilyScene({ question: row.question });
  assert.ok(ordinary?.renderScene, "a complete decimal scalar must retain the ordinary figure");
  assert.equal(ordinary.family, "chem_orbital");
  for (const document of [buildAtomicRadiationScene(row.question, [], false), buildAtomicRadiationScene(row.question, [], true), ordinary.document]) {
    assert.ok(document, "a complete decimal scalar must retain direct and schematic figures");
    assert.equal(document.source.question, row.question);
    assert.equal(document.source.chemistryFamily, "chem_orbital");
    const text = labels(document);
    assert.ok(text.includes("phi=2.00 eV"), "both complete decimal scalar spellings state exactly 2 eV");
    for (const [symbol, expected] of [["phi", 2], ["E", workFunctionPhotonEv], ["K", workFunctionPhotonEv - 2]] as const) {
      const label = text.find(value => value.startsWith(symbol + "="));
      assert.ok(label, symbol + " label is required");
      const scalar = new RegExp("^" + symbol + "=([0-9]+\\.[0-9]{2}) eV$").exec(label);
      assert.ok(scalar, "complete two-decimal energy label: " + label);
      assert.ok(Math.abs(Number(scalar[1]) - expected) <= 0.005 + Math.abs(expected) * 1e-12,
        symbol + " must agree with the independent photoelectric value");
    }
  }
});
// END PR137 complete decimal work-function scalar controls.

// BEGIN PR137 public physics asked work-function ownership controls.
// Asking to infer a work function supplies no declaration for chemistry ink.
const askedWorkFunctionPhysicsRows = [
  {
    "id": "physics|17|photoelectric-effect-and-observations|q2",
    "question": "A metal emits photoelectrons with stopping potential 0.50 V under 500 nm illumination. Infer its work function and threshold wavelength. Predict stopping potential under 400 nm light. If intensity doubles at 500 nm with fixed absorption and collection efficiency, describe the saturated current and stopping potential. Use hc=1240 eV nm, with electronvolts for energies.",
    "questionSha256": "15fec9163349c562e92e9b91998a9d0b7bc5b504ecf4917a68b0ef1461a73242"
  },
  {
    "id": "physics|17|photoelectric-graphs-and-stopping-potential|q2",
    "question": "A metal has stopping potentials 0.40 V and 1.20 V at frequencies 6.0e14 Hz and 8.0e14 Hz. Assume Einstein’s one-photon equation and a straight-line graph of stopping potential against frequency. Infer h/e, work function in eV and threshold frequency. Predict the stopping potential at 7.0e14 Hz and explain how the graph changes if the beam intensity alone triples.",
    "questionSha256": "e7783213243bb458d62eb1b0b717474d9b4639670f78df2103d70da9c2398c61"
  }
] as const;
for (const row of askedWorkFunctionPhysicsRows) check("public physics asked work-function role: " + row.id, () => {
  assert.equal(createHash("sha256").update(row.question).digest("hex"), row.questionSha256);
  assert.equal(isAtomicRadiationStem(row.question), false, "an asked work function without a supplied declaration must retain physics ownership");
  assert.ok(!inferChemistryFamilies(row.question).includes("chem_orbital"), "an asked work function cannot select the chemistry orbital family");
});
// END PR137 public physics asked work-function ownership controls.

// BEGIN PR137 cb226db9 regression rows (coordinator review pr-137-delta4.md, set A). Head, main and
// fadbe137 pass all 35; the cb226db9 work function reader fails all 35. #166 must keep these outcomes.
const PLANCK_J_S = 6.62607015e-34, ELEMENTARY_CHARGE_C = 1.602176634e-19, LIGHT_SPEED_M_S = 299792458;
const photonEv = (kind: "f" | "nm", value: number): number => kind === "f" ? PLANCK_J_S * value / ELEMENTARY_CHARGE_C : PLANCK_J_S * LIGHT_SPEED_M_S / (value * 1e-9) / ELEMENTARY_CHARGE_C;
const pr137DeclineRows = ["Metal A has work function 2 eV. Metal B has unknown work function. Light falls on metal B. Draw the photoelectric diagram.", "Metal A has work function 2 eV while metal B has an unknown work function. Light falls on metal B.", "Work function 2 eV for metal A; work function unknown for metal B. Light falls on metal B.", "Metal A has work function 2 eV. Metal B has a larger work function. Light falls on metal B. Draw the photoelectric diagram.", "A metal has work function 2 eV. Draw the photoelectric energy diagram and mark the work function.", "A metal has work function 2 eV. Explain why light below the threshold cannot eject electrons even though it is intense, by comparing photon energy with the work function.", "Sodium has work function 2.3 eV. Draw an energy diagram showing the work function and explain the threshold.", "A surface with work function 4.2 eV is illuminated. Draw the photoelectric energy diagram and label the work function.", "Caesium has a work function of about 2.1 eV. Explain why caesium is used in photocells, comparing its work function with other metals.", "A metal of work function 2.0 eV is used. Find the threshold wavelength and explain the meaning of the work function.", "A metal with work function 2.0 eV is used in a photocell. Find the threshold frequency. Why does the work function differ between metals?", "Photoelectric effect: work function 2 eV. Explain the role of the work function.", "A metal of work function 2 eV and another metal of unknown work function are illuminated. Draw the photoelectric diagram for the second metal."] as const;
for (const [index, question] of pr137DeclineRows.entries()) check(`cb226db9 regression A${index}: unread or unbound work function declines in chemistry`, () => {
  assert.equal(isAtomicRadiationStem(question), true);
  assert.equal(isChemistryQuestion(question), true);
  assert.equal(synthesizeFamilyScene({ question }), null, "no fabricated photoelectric figure");
});
const pr137PhysicsRouteRows = ["If the work function of the metal is doubled, what happens to the stopping potential? Draw the stopping potential versus frequency graph.", "What happens to the stopping potential if the work function is increased? Draw the graph.", "Explain why the work function is different for different metals.", "The work function is the minimum energy needed to remove an electron from a metal surface. Explain the photoelectric effect with a diagram.", "Work function: define it and draw the photoelectric energy diagram.", "The work function is directly proportional to the threshold frequency. Draw the graph of stopping potential against frequency.", "The work function equals the photon energy at threshold. Draw the photoelectric energy diagram.", "Explain how stopping potential depends on frequency when the work function is fixed. Draw the graph.", "The work function was measured for sodium using a photocell. Draw the graph of stopping potential against frequency.", "The work function of caesium is low, so it is used in photocells. Explain with a diagram.", "Work function: the minimum energy needed to free an electron from a metal. Draw the photoelectric energy diagram.", "State Einstein's photoelectric equation. The work function is the intercept of which graph?"] as const;
for (const [index, question] of pr137PhysicsRouteRows.entries()) check(`cb226db9 regression A${index + 13}: conceptual work function stem keeps physics ownership`, () => {
  assert.equal(isAtomicRadiationStem(question), false);
  assert.equal(isChemistryQuestion(question), false);
  assert.ok(!inferChemistryFamilies(question).includes("chem_orbital"));
});
const pr137DrawRows: ReadonlyArray<readonly [string, number, "f" | "nm", number]> = [
  ["The work function of a metal is 2 eV. Light of frequency 1e15 Hz falls on it. Find the kinetic energy and compare it with the work function.", 2, "f", 1e15],
  ["The work function of a metal is 2 eV. Light of frequency 1e15 Hz falls on it. Explain what happens if the work function were larger.", 2, "f", 1e15],
  ["The work function of a metal is 2 eV. Light of frequency 1e15 Hz falls on it. Label the work function on the diagram.", 2, "f", 1e15],
  ["The work function of a metal is 2 eV. Light of frequency 1e15 Hz falls on it. Draw a diagram and show the work function.", 2, "f", 1e15],
  ["The work function of a metal is 2 eV. Light of frequency 1e15 Hz falls on it. Show the work function on an energy diagram.", 2, "f", 1e15],
  ["The work function of a metal is 2 eV. Light of frequency 1e15 Hz falls on it. Draw a diagram showing the work function of the metal.", 2, "f", 1e15],
  ["The work function of a metal is 2 eV. Light of frequency 1e15 Hz falls on it. Draw a diagram showing the work function (φ).", 2, "f", 1e15],
  ["The work function of a metal is 2 eV. Light of frequency 1e15 Hz falls on it. Draw a diagram showing the work function, φ.", 2, "f", 1e15],
  ["The work function of caesium is 2.14 eV. Light of frequency 6e14 Hz is incident on the metal surface. Find the maximum kinetic energy and the stopping potential. How would the answer change if the work function were higher?", 2.14, "f", 6e14],
  ["A metal with work function 2 eV is illuminated by light of wavelength 300 nm. Find the kinetic energy of the photoelectrons. Explain why no electrons are emitted if the photon energy is less than the work function.", 2, "nm", 300],
];
for (const [index, [question, phi, kind, value]] of pr137DrawRows.entries()) check(`cb226db9 regression A${index + 32}: supplied work function draws its own values`, () => {
  const synthesis = synthesizeFamilyScene({ question });
  assert.ok(synthesis, "the supplied declaration must draw");
  assert.equal(synthesis.document.source.chemistryFamily, "chem_orbital");
  const energy = photonEv(kind, value);
  const text = labels(synthesis.document);
  for (const expected of [`phi=${phi.toFixed(2)} eV`, `E=${energy.toFixed(2)} eV`, `K=${(energy - phi).toFixed(2)} eV`]) assert.ok(text.includes(expected), `${expected} in ${text.join(" | ")}`);
});
// END PR137 cb226db9 regression rows.

// Main-compatible original photo controls remain; all deferred desired assertions and exact source
// are preserved by cb226db9 and the #166 transfer ledger. Genuine reviewer128 parity is a separate proof.
console.log(`verify-chemistry-rereview-photoelectric-hess: ${checks} checks passed / ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
