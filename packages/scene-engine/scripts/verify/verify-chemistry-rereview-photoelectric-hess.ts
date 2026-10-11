/** Real-source regressions for coordinator #137 re-review; no model calls. */
import assert from "node:assert/strict";
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
for (const [wavelength, expected] of [[300, "K=2.00 eV"], [400, "K=1.00 eV"]] as const)
  check("source hc changes the computed number: " + wavelength, () => {
    const question = `For the photoelectric effect wavelength is ${wavelength} nm and work function is 2 eV. hc=1200 eV nm. Find kinetic energy.`;
    assert.ok(labels(buildAtomicRadiationScene(question, [], false)).includes(expected));
    const synthesis = synthesizeFamilyScene({ question });
    assert.ok(synthesis);
    assert.ok(labels(synthesis.document).includes(expected));
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
    const sourceBody = "For the photoelectric effect wavelength is 300 nm and work function is 2 eV. hc=1200 eV nm. Find kinetic energy. " + suffix;
    assert.ok(labels(buildAtomicRadiationScene(sourceBody, [], false)).includes("K=2.00 eV"));
    assert.ok(labels(synthesizeFamilyScene({ question: sourceBody })?.document ?? null).includes("K=2.00 eV"));
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
      assert.ok(k > 0 && Math.abs(k / eq.K - 1) <= 0.001);
      assert.ok(Math.abs(Number(gLabel.slice(4)) - eq.G) <= 0.00051);
      assert.ok(text.includes(`T=${eq.T} K`));
    } else {
      for (const [id, value, unit] of thermoQuantities[row.id] ?? []) {
        const quantity = document.quantities.find(q => q.id === id);
        assert.ok(quantity, id);
        assert.ok(Math.abs(quantity.value - value) <= 1e-8 * Math.max(1, Math.abs(value)), id);
        assert.equal(quantity.unit, unit);
      }
      assert.ok((thermoQuantities[row.id]?.length ?? 0) > 0, "every row must have an independent value oracle");
    }
  }
});
console.log(`verify-chemistry-rereview-photoelectric-hess: ${checks} checks passed / ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
