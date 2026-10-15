/** Real-source regressions for coordinator #137 re-review; no model calls. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { buildChemicalThermodynamicsScene } from "../../src/chemistry/chemicalThermodynamics";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { compileSceneDocument } from "../../src/compile/compiler";
import { inferChemistryFamilies } from "../../src/chemistry/router";
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
for (const hc of ["4e- eV nm", "1e999 eV nm", "unknown", "-1240 eV nm", "0 eV nm", "1240 kg", "1240 eV nm/s", "1240 eV nm; hc=1200 eV nm"])
  check("supplied damaged hc never becomes a fixed product: " + hc, () => {
    const question = `Light of wavelength 300 nm falls on a metal. Its work function is 2.0 eV. Take hc=${hc}. Find photoelectron kinetic energy.`;
    assert.equal(buildAtomicRadiationScene(question, [], false), null);
    assert.equal(synthesizeFamilyScene({ question }), null);
  });
for (const declaration of ["hc=unknown; hc=1240 eV nm", "hc=1240 eV nm; hc=unknown", "hc=; hc=1240 eV nm", "hc=1240 eV nm; hc=", "hc=1240 eV nm; hc=1240 eV nm"])
  check("each explicit hc owner must be resolved: " + declaration, () => {
    const question = `For the photoelectric effect wavelength is 300 nm and work function is 2 eV. ${declaration}. Find kinetic energy.`;
    assert.equal(buildAtomicRadiationScene(question, [], false), null);
    assert.equal(synthesizeFamilyScene({ question }), null);
  });
for (const hc of ["1000", "1200", "1500", "2000", "1241"])
  check("a supplied incompatible hc cannot replace the physical reference: " + hc, () => {
    const question = `For the photoelectric effect wavelength is 300 nm and work function is 2 eV. hc=${hc} eV nm. Find kinetic energy.`;
    assert.equal(buildAtomicRadiationScene(question, [], false), null);
    assert.equal(synthesizeFamilyScene({ question }), null);
  });
for (const [product, expected] of [["1239.84", "K=2.00 eV"], ["1240", "K=2.01 eV"]] as const)
  check("an admitted source hc rounding convention supplies the actual wavelength law: " + product, () => {
    const question = `For the photoelectric effect wavelength is 300 nm and work function is 2.128 eV. Take hc=${product} eV nm. Find kinetic energy.`;
    assert.ok(labels(buildAtomicRadiationScene(question, [], false)).includes(expected));
    assert.ok(labels(synthesizeFamilyScene({ question })?.document ?? null).includes(expected));
  });
check("SI source hc converts value and unit together", () => {
  const question = "For the photoelectric effect, wavelength is 300 nm and work function is 2 eV. Take hc=1.9864458571489286e-25 J m. Find kinetic energy.";
  assert.ok(labels(buildAtomicRadiationScene(question, [], false)).includes("K=2.13 eV"));
});
check("hc is not allowed to contradict explicitly stated h", () => {
  const question = "For the photoelectric effect, wavelength is 300 nm and work function is 2 eV. h=6.62607015e-34 J s and hc=1240 eV nm. Find kinetic energy.";
  assert.equal(buildAtomicRadiationScene(question, [], false), null);
  assert.equal(synthesizeFamilyScene({ question }), null);
});
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
check("current-main multiple-metal comparison retains its subject and honestly declines single-metal ink", () => {
  const question = "Two metals A and B have work functions 2.0 eV and 3.0 eV. Find a single incident wavelength that makes A’s maximum photoelectron kinetic energy twice B’s, with both emitting. Compute their stopping potentials and threshold wavelengths. At 500 nm determine which metal still emits. Use hc=1240 eV nm and the one-photon model.";
  assert.ok(inferChemistryFamilies(question).includes("chem_orbital"));
  assert.equal(buildAtomicRadiationScene(question, [], false), null);
  assert.equal(synthesizeFamilyScene({ question }), null);
});
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
    "id": "M13-a",
    "question": "The work function of potassium is 2.25 eV. Light of wavelength 300 nm falls on it (h = 6.626 × 10^-34 J s, c = 3 × 10^8 m/s). Find the kinetic energy of the photoelectrons.",
    "expectedK": null,
    "reason": "Unsupported photon-only chemistry ask or unchanged rounded h/c reference policy; honest chemistry decline"
  },
  {
    "id": "M13-b",
    "question": "The work function of potassium is 2.25 eV. Light of wavelength 300 nm falls on it (h = 6.626 × 10^-34 J s). Find the kinetic energy of the photoelectrons.",
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
  "Two metals A and B have work functions 2.0 eV and 3.0 eV. Find a single incident wavelength that makes A’s maximum photoelectron kinetic energy twice B’s, with both emitting. Compute their stopping potentials and threshold wavelengths. At 500 nm determine which metal still emits. Use hc=1240 eV nm and the one-photon model.",
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
// Every declaration must resolve before single-metal ink can claim its value.
// Readable duplicates retain the existing conservative ambiguity decline.
const workFunctionOwnerRows = [
  {
    "id": "WF-REPORTED-UNREAD-FIRST",
    "question": "Work function is unknown. The work function is 2 eV. Light of frequency 1e15 Hz falls on the metal. Draw the photoelectric diagram.",
    "questionSha256": "e370d8e9fbcec42830a0df1746905b75506c525f9b692c094f9a21b856daa3b0",
    "expected": "decline"
  },
  {
    "id": "WF-REPORTED-TWO-METALS",
    "question": "Metal A’s work function is unknown. Metal B’s is 2 eV. Light falls on metal A.",
    "questionSha256": "a023398c21662aee3691dec7caab265ee69fddc384a159c37c4ad088d2d1d619",
    "expected": "decline"
  },
  {
    "id": "WF-FRESH-UNREAD-LAST",
    "question": "For the photoelectric effect, the work function is 2 eV. The work function is unknown. Light of frequency 1e15 Hz is incident. Draw the energy balance.",
    "questionSha256": "d67d760ac2e5391c720e29e441d638547a31ed362a206985f6a1dce8f8f7582d",
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
    "id": "WF-FRESH-METAL-B-UNREAD",
    "question": "Metal A’s work function is 2 eV. Metal B’s work function is unknown. Light of frequency 1e15 Hz falls on metal B. Draw the photoelectric diagram.",
    "questionSha256": "257f6889f4b4ccd874fe2873a054dcff14efc633fd9233d8b56fbb669dbd7bdd",
    "expected": "decline"
  },
  {
    "id": "WF-SINGLE-EV",
    "question": "The work function is 2 eV. Light of frequency 1e15 Hz falls on the metal. Draw the photoelectric diagram.",
    "questionSha256": "5d89f6cebb1b1943f393e24cc95ec9c9a2ed80e6819058f60f3b1031283639b8",
    "expected": "draw"
  },
  {
    "id": "WF-SINGLE-J",
    "question": "The work function is 3.204353268e-19 J. Light of frequency 1e15 Hz falls on the metal. Draw the photoelectric diagram.",
    "questionSha256": "28cc37084af076316c84bcfa3b04975af65dfe112bc0cef2c499a81596cc21aa",
    "expected": "draw"
  },
  {
    "id": "WF-DUPLICATE-AGREE-EV",
    "question": "The work function is 2 eV. The work function is 2 eV. Light of frequency 1e15 Hz falls on the metal. Draw the photoelectric diagram.",
    "questionSha256": "f7ca9494c69900be7bc49808aa9ee326005193302fa19b9f5ba788ba2884c68a",
    "expected": "decline"
  },
  {
    "id": "WF-DUPLICATE-AGREE-J-EV",
    "question": "The work function is 2 eV. The work function is 3.204353268e-19 J. Light of frequency 1e15 Hz falls on the metal. Draw the photoelectric diagram.",
    "questionSha256": "030f5b7da3dc4fe6b7a7bfee716f75b1640c3083890507b0a069d4683998ae1c",
    "expected": "decline"
  },
  {
    "id": "WF-DUPLICATE-CONFLICT-EV",
    "question": "The work function is 2 eV. The work function is 3 eV. Light of frequency 1e15 Hz falls on the metal. Draw the photoelectric diagram.",
    "questionSha256": "62b219ce6dac71fe7f9556f7079de92e9f2e7f02f9c704a40446c244b835db7b",
    "expected": "decline"
  },
  {
    "id": "WF-DUPLICATE-CONFLICT-J-EV",
    "question": "The work function is 2 eV. The work function is 4.806529902e-19 J. Light of frequency 1e15 Hz falls on the metal. Draw the photoelectric diagram.",
    "questionSha256": "e5bb4c82682e955d71c11d37db346a61b44b457d905533f5463f821be3019dad",
    "expected": "decline"
  }
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
  {
    "id": "WF-REFERENCE-UNKNOWN",
    "question": "The work function is 2 eV. Light of frequency 1e15 Hz falls on the metal. Draw a photoelectric diagram showing the work function is unknown.",
    "questionSha256": "f8a55ca3fb5116a0d158ccb18c5f9a96cb043aa6aad25c6141af7e863e0cfb3e",
    "expected": "decline"
  },
  {
    "id": "WF-REFERENCE-NAMED-OWNER",
    "question": "The work function is 2 eV. Light of frequency 1e15 Hz falls on the metal. Draw a photoelectric diagram showing the work function of metal A.",
    "questionSha256": "93197f623e9694b02df83d9283fef01e0b844e20e4a8bf6989bfd4e65fb7a1bd",
    "expected": "decline"
  }
] as const;
for (const row of workFunctionReferenceRows) check("work-function diagram-reference role: " + row.id, () => {
  assert.equal(createHash("sha256").update(row.question).digest("hex"), row.questionSha256);
  const direct = buildAtomicRadiationScene(row.question, [], false);
  const schematic = buildAtomicRadiationScene(row.question, [], true);
  const ordinary = synthesizeFamilyScene({ question: row.question });
  if (row.expected === "decline") {
    assert.equal(direct, null, "an explicit unread or named owner cannot become a diagram-reference exemption");
    assert.equal(schematic, null, "schematic builder must retain the declaration boundary");
    assert.equal(ordinary, null, "ordinary family route must retain the declaration boundary");
    return;
  }
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

console.log(`verify-chemistry-rereview-photoelectric-hess: ${checks} checks passed / ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
