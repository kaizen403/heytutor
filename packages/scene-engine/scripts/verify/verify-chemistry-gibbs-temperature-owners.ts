/** Real Gibbs source-temperature ownership regressions; no provider calls. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";

const cases: readonly {id:string; question:string; expected:string; dG:number|null; unit?:string}[] = [
  {
    "id": "GREPTILE-4244042438",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "GIBBS-REFUSE-1",
    "question": "The temperature is unknown; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "GIBBS-REFUSE-2",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). The temperature is 299 K. Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "GIBBS-REFUSE-3",
    "question": "T = 298 kg; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "GIBBS-REFUSE-4",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). T is unreadable. Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "GIBBS-REFUSE-5",
    "question": "At -1 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at -1 K.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "GIBBS-SUPPORT-1",
    "question": "T = 298 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "GIBBS-SUPPORT-2",
    "question": "At 25 °C, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298.15 K.",
    "expected": "required-compile",
    "dG": -10.185000000000002
  },
  {
    "id": "GIBBS-SUPPORT-3",
    "question": "At 300 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). T is 300 K. Draw ΔG versus T and calculate ΔG at 300 K.",
    "expected": "required-compile",
    "dG": -10.0
  },
  {
    "id": "GIBBS-SUPPORT-4",
    "question": "At 298 K, ΔH = 40 kJ/mol and ΔS = 100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": 10.2
  },
  {
    "id": "GIBBS-SUPPORT-5",
    "question": "At 300 K, ΔH = -40 kJ/mol and ΔS = 100 J/(mol K). Draw ΔG versus T and calculate ΔG at 300 K.",
    "expected": "required-compile",
    "dG": -70.0
  },
  {
    "id": "OWN-SUPPORT-1",
    "question": "The temperature equals 298 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T; calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-SUPPORT-2",
    "question": "At 3e2 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 300 kelvin.",
    "expected": "required-compile",
    "dG": -10
  },
  {
    "id": "OWN-SUPPORT-3",
    "question": "T IS 300 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 300 K.",
    "expected": "required-compile",
    "dG": -10
  },
  {
    "id": "OWN-SUPPORT-4",
    "question": "The temperature is 298.15 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 25 °C.",
    "expected": "required-compile",
    "dG": -10.185
  },
  {
    "id": "OWN-SUPPORT-5",
    "question": "At 310 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Temperature: 310 K. Draw ΔG versus T and calculate ΔG at 310 K.",
    "expected": "required-compile",
    "dG": -9
  },
  {
    "id": "OWN-REFUSE-1",
    "question": "At unreadable K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFUSE-2",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at unknown.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFUSE-3",
    "question": "Temperature = 298 K; temperature = unknown. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFUSE-4",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). T = 298 K/kg. Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFUSE-5",
    "question": "At 0 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 0 K.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFUSE-6",
    "question": "At 3e- K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFUSE-7",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). The temperature is 25 °C. Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFUSE-8",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at ? K.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ABSENT-1",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and show the equilibrium temperature.",
    "expected": "graph-only",
    "dG": null
  },
  {
    "id": "OWN-ABSENT-2",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T at all temperatures.",
    "expected": "graph-only",
    "dG": null
  },
  {
    "id": "OWN-OPTIONS-1",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K. Options: (a) at 0 K (b) T=unknown",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "HS-UNREAD-1",
    "question": "ΔH = unknown; ΔH = -40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "HS-UNREAD-2",
    "question": "ΔH = -40 kJ/mol. ΔS = unknown; ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "HS-UNREAD-3",
    "question": "ΔH = -40 kJ/mol; ΔH is unreadable. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "HS-UNREAD-4",
    "question": "ΔH = -40 kJ/mol. ΔS = -100 J/(mol K); ΔS is unreadable. At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "HS-UNREAD-5",
    "question": "ΔH = unknown; ΔH = -40 kJ/mol. ΔS = unknown; ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-1",
    "question": "ΔH of the reaction is unknown, then ΔH of the reaction is -40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-2",
    "question": "The enthalpy change for the reaction is unreadable; the enthalpy change is -40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-3",
    "question": "ΔH = -40 kg; ΔH = -40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-4",
    "question": "ΔH = -40 kJ/mol. ΔS = -100 kg; ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-5",
    "question": "ΔH = -40 kJ/mol; ΔH remains unknown. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-6",
    "question": "ΔH = -40 kJ/mol. ΔS remains unknown; ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-7",
    "question": "ΔH for the reaction is unknown, ΔH for the reaction is -40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-8",
    "question": "ΔH = -40 kJ/mol. Entropy change is unknown, entropy change is -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-SUPPORT-1",
    "question": "ΔH of the reaction is -40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-HS-SUPPORT-2",
    "question": "Enthalpy change for the reaction is -40 kJ/mol. Entropy change = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "GIBBS-FORMULA-SUPPORT-1",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Plot ΔG = ΔH - TΔS versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-FORMULA-SUPPORT-2",
    "question": "At 298 K, enthalpy change = -40 kJ/mol and entropy change = -100 J/(mol K). Draw ΔG versus T using ΔH - TΔS and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-FORMULA-SUPPORT-3",
    "question": "At 298 K, ΔH = 40 kJ/mol and ΔS = 100 J/(mol K). Calculate ΔG from ΔG = ΔH - TΔS and draw ΔG versus T.",
    "expected": "required-compile",
    "dG": 10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-FORMULA-SUPPORT-4",
    "question": "At 300 K, ΔH = -40 kJ/mol and ΔS = 100 J/(mol K). Draw the line ΔG = ΔH - TΔS against T and calculate ΔG at 300 K.",
    "expected": "required-compile",
    "dG": -70,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-FORMULA-SUPPORT-5",
    "question": "At 298 K, ΔH = -40 kJ and ΔS = -100 J/K. Draw ΔG = ΔH - TΔS versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ"
  },
  {
    "id": "GIBBS-THRESHOLD-SUPPORT-1",
    "question": "At what temperature is ΔG zero? ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T.",
    "expected": "graph-only",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-THRESHOLD-SUPPORT-2",
    "question": "At which temperature does the reaction reach equilibrium? ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw the Gibbs energy line versus T.",
    "expected": "graph-only",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-UNREAD-QUALIFIED-1",
    "question": "The temperature remains unknown; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-UNREAD-QUALIFIED-2",
    "question": "The temperature which is unreadable is stated; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-UNREAD-QUALIFIED-3",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at an unknown temperature.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "OWN-THRESHOLD-1",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and determine at what temperature the reaction becomes spontaneous.",
    "expected": "graph-only",
    "dG": null
  },
  {
    "id": "OWN-THRESHOLD-2",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At which absolute temperature is ΔG zero? Draw ΔG versus T.",
    "expected": "graph-only",
    "dG": null
  },
  {
    "id": "OWN-REFERENCE-1",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Plot ΔG(T) = ΔH − T × ΔS versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-REFERENCE-2",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Use ΔH and ΔS to calculate ΔG and draw ΔG versus T.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-TEMPERATURE-OF",
    "question": "The temperature of the reaction is 298 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-TEMPERATURE-FOR-UNREAD",
    "question": "The temperature for the reaction is unknown; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFERENCE-NOT-READABLE",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). With ΔH not readable, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFERENCE-UNKNOWN",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Use ΔH = unknown to calculate ΔG and draw ΔG versus T.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFERENCE-REDECLARATION",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG = ΔH - TΔS, ΔH is unknown; calculate ΔG at 298 K.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-TEMP-T-UNKNOWN",
    "question": "T was unknown; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  }
];
const results: {id:string;passed:boolean;error?:string}[] = [];
function compiled(document: SceneDocument | null, expected: number | null, unit = "kJ/mol"): void {
  assert.ok(document, "required original Gibbs scene missing");
  assert.equal(document.source.chemistryFamily, "chem_thermo");
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  const dG = document.quantities.find(quantity => quantity.id === "dG");
  const labels = result.renderScene.primitives.flatMap(mark => mark.text ? [mark.text] : []);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(document)));
  if (expected === null) {
    assert.equal(dG, undefined, "graph-only source cannot invent an evaluation point");
    assert.ok(document.quantities.some(quantity => quantity.id === "T_eq" && quantity.value === 400));
  } else {
    assert.ok(dG && typeof dG.value === "number");
    assert.ok(Math.abs(dG.value - expected) <= 1e-10, `${dG.value} != ${expected}`);
    assert.equal(dG.unit, unit);
    assert.ok(labels.some(label => label.replace(/\s+/g, "").includes(`ΔG=${expected.toFixed(1)}`)), JSON.stringify(labels));
    assert.ok(result.renderScene.caption?.includes(`ΔG=${expected.toFixed(1)} ${unit}`), result.renderScene.caption);
  }
}
for (const row of cases) {
  try {
    const direct = buildThermoGraphScene(row.question, [], false);
    const schematic = buildThermoGraphScene(row.question, [], true);
    const ordinary = synthesizeFamilyScene({question: row.question});
    if (row.expected === "decline") {
      assert.equal(direct, null, "invalid supplied temperature cannot render direct graph");
      assert.equal(schematic, null, "invalid temperature cannot render schematic graph");
      assert.equal(ordinary, null, "invalid temperature cannot fall through to another family");
    } else {
      compiled(direct, row.dG, row.unit); compiled(schematic, row.dG, row.unit);
      assert.ok(ordinary); compiled(ordinary.document, row.dG, row.unit);
      assert.equal(ordinary.document.source.question, row.question);
    }
    results.push({id:row.id,passed:true}); console.log(`PASS ${row.id}`);
  } catch (error) { results.push({id:row.id,passed:false,error:String(error)}); console.error(`FAIL ${row.id}: ${String(error)}`); }
}
const output = process.argv[2]; if (output) writeFileSync(output, JSON.stringify({cases:cases.length,passed:results.filter(row=>row.passed).length,results},null,2)+"\n");
console.log(`${results.filter(row=>row.passed).length}/${cases.length} Gibbs temperature ownership cases passed`);
process.exitCode = results.some(row=>!row.passed) ? 1 : 0;
