/** Real Gibbs source-temperature ownership regressions; no provider calls. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";

const cases: readonly {id:string; question:string; expected:string; dG:number|null}[] = [
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
  }
];
const results: {id:string;passed:boolean;error?:string}[] = [];
function compiled(document: SceneDocument | null, expected: number | null): void {
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
    assert.equal(dG.unit, "kJ/mol");
    assert.ok(labels.some(label => label.replace(/\s+/g, "").includes(`ΔG=${expected.toFixed(1)}`)), JSON.stringify(labels));
    assert.ok(result.renderScene.caption?.includes(`ΔG=${expected.toFixed(1)} kJ/mol`), result.renderScene.caption);
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
      compiled(direct, row.dG); compiled(schematic, row.dG);
      assert.ok(ordinary); compiled(ordinary.document, row.dG);
      assert.equal(ordinary.document.source.question, row.question);
    }
    results.push({id:row.id,passed:true}); console.log(`PASS ${row.id}`);
  } catch (error) { results.push({id:row.id,passed:false,error:String(error)}); console.error(`FAIL ${row.id}: ${String(error)}`); }
}
const output = process.argv[2]; if (output) writeFileSync(output, JSON.stringify({cases:cases.length,passed:results.filter(row=>row.passed).length,results},null,2)+"\n");
console.log(`${results.filter(row=>row.passed).length}/${cases.length} Gibbs temperature ownership cases passed`);
process.exitCode = results.some(row=>!row.passed) ? 1 : 0;
