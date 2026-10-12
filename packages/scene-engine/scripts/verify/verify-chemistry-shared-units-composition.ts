/** Shared original units and semantic composition words; fixtures are source oracles only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { buildChemicalThermodynamicsScene } from "../../src/chemistry/chemicalThermodynamics";
import { buildSolutionsGraphScene, raoultLines } from "../../src/chemistry/solutionsGraphs";
import { readChemistryLiteral, type ChemistrySpan } from "../../src/chemistry/quantityReader";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";

interface Row {
  id: string; question: string; questionSha256: string; family: "thermo" | "solutions";
  kind: "heat" | "raoult" | "graph" | "decline"; capacity?: number; delta?: number; heat?: number;
  t1?: number; t2?: number; firstScalarSpan?: ChemistrySpan; secondScalarSpan?: ChemistrySpan;
  sharedUnit?: "K" | "°C"; sharedUnitSpan?: ChemistrySpan; deltaScalarSpan?: ChemistrySpan; xA?: number;
}
const ROWS: readonly Row[] = [
  {
    "id": "REVIEW-HEAT-SHARED-K",
    "question": "The heat capacity of a sample is 20 J/K. It is heated from 300 to 310 K with no phase change. Find q.",
    "family": "thermo",
    "kind": "heat",
    "capacity": 20,
    "delta": 10,
    "heat": 200,
    "t1": 300,
    "t2": 310,
    "firstScalarSpan": {
      "start": 59,
      "end": 62
    },
    "secondScalarSpan": {
      "start": 66,
      "end": 69
    },
    "sharedUnitSpan": {
      "start": 70,
      "end": 71
    },
    "sharedUnit": "K",
    "questionSha256": "532e30ce8fd14cab922f4474a26fd40df9ec6fc057bbf0fbdf46d8d4e616402f"
  },
  {
    "id": "OWN-HEAT-WARMED",
    "question": "The heat capacity of a sample is 20 J/K. It is warmed from 300 to 310 K with no phase change. Determine the heat q.",
    "family": "thermo",
    "kind": "heat",
    "capacity": 20,
    "delta": 10,
    "heat": 200,
    "t1": 300,
    "t2": 310,
    "firstScalarSpan": {
      "start": 59,
      "end": 62
    },
    "secondScalarSpan": {
      "start": 66,
      "end": 69
    },
    "sharedUnitSpan": {
      "start": 70,
      "end": 71
    },
    "sharedUnit": "K",
    "questionSha256": "96b16a46e82cbe9a72cfa6ebd787da6d3b02bc2cc4a2f3104fbc7531a9330180"
  },
  {
    "id": "OWN-HEAT-TEMPERATURE-CHANGE",
    "question": "The heat capacity of a sample is 20 J/K. Its temperature changes from 290 to 300 K with no phase change. Calculate q.",
    "family": "thermo",
    "kind": "heat",
    "capacity": 20,
    "delta": 10,
    "heat": 200,
    "t1": 290,
    "t2": 300,
    "firstScalarSpan": {
      "start": 70,
      "end": 73
    },
    "secondScalarSpan": {
      "start": 77,
      "end": 80
    },
    "sharedUnitSpan": {
      "start": 81,
      "end": 82
    },
    "sharedUnit": "K",
    "questionSha256": "8b56216941dd671d617c53cdaaf7edbe4c71233fd034f6f1a0ab248d81946da8"
  },
  {
    "id": "OWN-HEAT-KELVIN",
    "question": "The heat capacity of a sample is 20 J/K. Heating takes the sample from 280 to 290 kelvin with no phase change. Find q.",
    "family": "thermo",
    "kind": "heat",
    "capacity": 20,
    "delta": 10,
    "heat": 200,
    "t1": 280,
    "t2": 290,
    "firstScalarSpan": {
      "start": 71,
      "end": 74
    },
    "secondScalarSpan": {
      "start": 78,
      "end": 81
    },
    "sharedUnitSpan": {
      "start": 82,
      "end": 88
    },
    "sharedUnit": "K",
    "questionSha256": "2e3e57670f7f400949961cf825efd6d4db3153cde7c469075c0f80fe2a9229f0"
  },
  {
    "id": "OWN-HEAT-CELSIUS-SHARED",
    "question": "The heat capacity of a sample is 20 J/K. It is heated from 20 to 30 °C with no phase change. Find q.",
    "family": "thermo",
    "kind": "heat",
    "capacity": 20,
    "delta": 10,
    "heat": 200,
    "t1": 293.15,
    "t2": 303.15,
    "firstScalarSpan": {
      "start": 59,
      "end": 61
    },
    "secondScalarSpan": {
      "start": 65,
      "end": 67
    },
    "sharedUnitSpan": {
      "start": 68,
      "end": 70
    },
    "sharedUnit": "°C",
    "questionSha256": "3d1082fb83cda4348ec4f72d40540c7c7e952a67e16be9e89cf4b08ff36dfa20"
  },
  {
    "id": "OWN-HEAT-CELSIUS-WORD",
    "question": "The heat capacity of a sample is 20 J/K. The sample is warmed from 25 to 35 Celsius with no phase change. Determine q.",
    "family": "thermo",
    "kind": "heat",
    "capacity": 20,
    "delta": 10,
    "heat": 200,
    "t1": 298.15,
    "t2": 308.15,
    "firstScalarSpan": {
      "start": 67,
      "end": 69
    },
    "secondScalarSpan": {
      "start": 73,
      "end": 75
    },
    "sharedUnitSpan": {
      "start": 76,
      "end": 83
    },
    "sharedUnit": "°C",
    "questionSha256": "a74999a903186cc981c0eb1d9f909005340ee945a21adc813652421d0d7192cc"
  },
  {
    "id": "CONTROL-HEAT-EXPLICIT-K",
    "question": "The heat capacity of a sample is 20 J/K. It is heated from 300 K to 310 K with no phase change. Find q.",
    "family": "thermo",
    "kind": "heat",
    "capacity": 20,
    "delta": 10,
    "heat": 200,
    "t1": 300,
    "t2": 310,
    "firstScalarSpan": {
      "start": 59,
      "end": 62
    },
    "secondScalarSpan": {
      "start": 68,
      "end": 71
    },
    "questionSha256": "38da59c4c30e6da22ed9f273bb39e29289b685f0e513fe13707e28bb3a143d74"
  },
  {
    "id": "CONTROL-HEAT-EXPLICIT-C",
    "question": "The heat capacity of a sample is 20 J/K. It is heated from 20 °C to 30 °C with no phase change. Find q.",
    "family": "thermo",
    "kind": "heat",
    "capacity": 20,
    "delta": 10,
    "heat": 200,
    "t1": 293.15,
    "t2": 303.15,
    "firstScalarSpan": {
      "start": 59,
      "end": 61
    },
    "secondScalarSpan": {
      "start": 68,
      "end": 70
    },
    "questionSha256": "05bfa07b4b5b2c05475b67df7976b5e02189e9f9a599736f36e484ffd25870a0"
  },
  {
    "id": "CONTROL-HEAT-MIXED-ABSOLUTE-UNITS",
    "question": "The heat capacity of a sample is 20 J/K. It is heated from 300 K to 36.85 °C with no phase change. Find q.",
    "family": "thermo",
    "kind": "heat",
    "capacity": 20,
    "delta": 10,
    "heat": 200,
    "t1": 300,
    "t2": 310,
    "firstScalarSpan": {
      "start": 59,
      "end": 62
    },
    "secondScalarSpan": {
      "start": 68,
      "end": 73
    },
    "questionSha256": "ca6eae68d28a1ad3a64301a5503871088a270916ee19b9e79740054bc28e315a"
  },
  {
    "id": "CONTROL-HEAT-DELTA-C",
    "question": "The heat capacity of a sample is 20 J/K. The temperature rise is ΔT = 10 °C with no phase change. Find q.",
    "family": "thermo",
    "kind": "heat",
    "capacity": 20,
    "delta": 10,
    "heat": 200,
    "deltaScalarSpan": {
      "start": 70,
      "end": 72
    },
    "questionSha256": "0549a49f2cd312bbe9f1464e09a61d70c642af761dfdaa5df661ce170358ddbf"
  },
  {
    "id": "CONTROL-HEAT-DELTA-K",
    "question": "The heat capacity of a sample is 20 J/K. The temperature rise is ΔT = 10 K with no phase change. Find q.",
    "family": "thermo",
    "kind": "heat",
    "capacity": 20,
    "delta": 10,
    "heat": 200,
    "deltaScalarSpan": {
      "start": 70,
      "end": 72
    },
    "questionSha256": "79bc9edfddc8a1abe37f47a92ec653682ec7a5fc2baa16f8aba23dafe609c648"
  },
  {
    "id": "CONTROL-HEAT-COOLING-SHARED",
    "question": "The heat capacity of a sample is 20 J/K. It is cooled from 310 to 300 K with no phase change. Find q.",
    "family": "thermo",
    "kind": "heat",
    "capacity": 20,
    "delta": -10,
    "heat": -200,
    "t1": 310,
    "t2": 300,
    "firstScalarSpan": {
      "start": 59,
      "end": 62
    },
    "secondScalarSpan": {
      "start": 66,
      "end": 69
    },
    "sharedUnitSpan": {
      "start": 70,
      "end": 71
    },
    "sharedUnit": "K",
    "questionSha256": "334edf3d886305db0c50d6cdfb8dfa710461134c508603bcb5adfef54a888f3f"
  },
  {
    "id": "REFUSE-HEAT-NO-UNIT",
    "question": "The heat capacity of a sample is 20 J/K. It is heated from 300 to 310 with no phase change. Find q.",
    "family": "thermo",
    "kind": "decline",
    "questionSha256": "c6c50b564be6c830899c1d69503c4a71fc808da41c452042244371b003f14a22"
  },
  {
    "id": "REFUSE-HEAT-FIRST-WRONG-UNIT",
    "question": "The heat capacity of a sample is 20 J/K. It is heated from 300 kg to 310 K with no phase change. Find q.",
    "family": "thermo",
    "kind": "decline",
    "questionSha256": "f58353e3f9e86653e7c8d1f005f856f475f19079497f11eb94645b4827812198"
  },
  {
    "id": "REFUSE-HEAT-SECOND-WRONG-UNIT",
    "question": "The heat capacity of a sample is 20 J/K. It is heated from 300 to 310 kg with no phase change. Find q.",
    "family": "thermo",
    "kind": "decline",
    "questionSha256": "2d8aec9698b927d1b3ff969f0551bfb9473d9bf629335f545336a2ae4076dff7"
  },
  {
    "id": "REFUSE-HEAT-FIRST-SCIENTIFIC",
    "question": "The heat capacity of a sample is 20 J/K. It is heated from 1e- to 310 K with no phase change. Find q.",
    "family": "thermo",
    "kind": "decline",
    "questionSha256": "a49fd0208ea5ebfee81a89db500bb4832f00102acdf153699f446c9e48638a2c"
  },
  {
    "id": "REFUSE-HEAT-SECOND-SCIENTIFIC",
    "question": "The heat capacity of a sample is 20 J/K. It is heated from 300 to 1e- K with no phase change. Find q.",
    "family": "thermo",
    "kind": "decline",
    "questionSha256": "7e80b0bec54b48bda68e2d3cc4f97f698316bdc7033cc34181d19ea91b7d8c30"
  },
  {
    "id": "REFUSE-HEAT-FIRST-UNKNOWN",
    "question": "The heat capacity of a sample is 20 J/K. It is heated from unknown to 310 K with no phase change. Find q.",
    "family": "thermo",
    "kind": "decline",
    "questionSha256": "a27e98e7cb50fe5120cba48181bf2450750bb849152d6ebfd457c091e4773b93"
  },
  {
    "id": "REFUSE-HEAT-SECOND-UNKNOWN",
    "question": "The heat capacity of a sample is 20 J/K. It is heated from 300 to unknown K with no phase change. Find q.",
    "family": "thermo",
    "kind": "decline",
    "questionSha256": "a2aafaf5387b8110e63f6e571e6bacfc059493eb493c66e35a7e4d67c7bb1c4e"
  },
  {
    "id": "REFUSE-HEAT-SUFFIX-DAMAGE",
    "question": "The heat capacity of a sample is 20 J/K. It is heated from 300 to 310 Kfoo with no phase change. Find q.",
    "family": "thermo",
    "kind": "decline",
    "questionSha256": "dbaeed17a8e9e1f451ad7a4f29e9df1a7b1050d3b07cc8e749d4ca703377e460"
  },
  {
    "id": "REFUSE-HEAT-CAPACITY-WRONG-UNIT",
    "question": "The heat capacity of a sample is 20 J. It is heated from 300 to 310 K with no phase change. Find q.",
    "family": "thermo",
    "kind": "decline",
    "questionSha256": "d9cf0a2ca69fd758bda3c87d51305e4af4e9bf4a18f85953fe3f6cb797217a5b"
  },
  {
    "id": "REFUSE-HEAT-CAPACITY-MALFORMED",
    "question": "The heat capacity of a sample is 1e- J/K. It is heated from 300 to 310 K with no phase change. Find q.",
    "family": "thermo",
    "kind": "decline",
    "questionSha256": "ea1334e58aebde71ee66dfa69d852d656ffafbfba4176906daf58d7b9df55f56"
  },
  {
    "id": "REVIEW-RAOULT-EQUIMOLAR",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 torr. Equimolar liquids form an ideal solution. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "raoult",
    "xA": 0.5,
    "questionSha256": "53ef2f6eb7a934dd2bd94f26564a31b1f1856bc025223dd046749ef3f1ee419a"
  },
  {
    "id": "OWN-RAOULT-UPPER",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 torr. EQUIMOLAR liquids form an ideal solution. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "raoult",
    "xA": 0.5,
    "questionSha256": "1e729a1d1e060f7ad760f82787e55db58b7968713ee6752dd6259f90aa4f4ce2"
  },
  {
    "id": "OWN-RAOULT-MIXED-CASE",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 torr. eQuImOlAr liquids form an ideal solution. Draw the Raoult graph and calculate total pressure.",
    "family": "solutions",
    "kind": "raoult",
    "xA": 0.5,
    "questionSha256": "50bd392010c459ec7bc9fd326d3b84292b939fbd338effeaa2cc1dfff752b662"
  },
  {
    "id": "OWN-RAOULT-TITLE-INSIDE",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 torr. An Equimolar ideal solution is made from liquids A and B. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "raoult",
    "xA": 0.5,
    "questionSha256": "d5cebe73f8f65b2f76e309f6baa6e8b37e04582568e8cc416cdc47567523cc84"
  },
  {
    "id": "OWN-RAOULT-CASE-COMPOSITION",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 torr. A and B make an EQuiMOLar ideal liquid mixture. Plot the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "raoult",
    "xA": 0.5,
    "questionSha256": "bc418d957e7bec90cb838166e4cfc52669cd8bfdb8aef778141b51cad07119b0"
  },
  {
    "id": "OWN-RAOULT-CASE-MIX",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 torr. Mix the liquids in an EQuimolar ideal solution. Draw the Raoult graph and calculate its total pressure.",
    "family": "solutions",
    "kind": "raoult",
    "xA": 0.5,
    "questionSha256": "a668723ea7d93a6b3e3ba460765ae6dbb59d53b02da8614b8548314a1ffe6270"
  },
  {
    "id": "CONTROL-RAOULT-LOWER",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 torr. equimolar liquids form an ideal solution. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "raoult",
    "xA": 0.5,
    "questionSha256": "647c75fdeab4156d1624ebc36086bf7c7952606cb9a0f1c20f3fa1045a2b3863"
  },
  {
    "id": "CONTROL-RAOULT-EXPLICIT-HALF",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 torr. The liquids form an ideal solution with x_a = 0.5. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "raoult",
    "xA": 0.5,
    "questionSha256": "11f356912921ddc3735aab6452c900154fc1545805af17fe087820d37429e9a6"
  },
  {
    "id": "CONTROL-RAOULT-EXPLICIT-QUARTER",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 torr. The liquids form an ideal solution. The mole fraction of a is 0.25. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "raoult",
    "xA": 0.25,
    "questionSha256": "a76fd8543dca74d9d1cb570ef823d2f166309be477c5b3f6ee829fbe038f5fed"
  },
  {
    "id": "CONTROL-RAOULT-WHOLE-WORD",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 torr. The liquids form an unequimolar ideal solution. Draw only the Raoult pressure graph.",
    "family": "solutions",
    "kind": "graph",
    "questionSha256": "1e1cc5c86ed1c1c509c2734c5f9ac58f6d0b2947ff2ad9d9b6c3b87b09c0cd39"
  },
  {
    "id": "REFUSE-RAOULT-UNSUPPORTED-UNIT",
    "question": "Vapour pressures of pure A and B are 200 psi and 100 psi. Equimolar liquids form an ideal solution. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "decline",
    "questionSha256": "582a9213a3c9854a2bf1fc153bcaef15d7a75b984ae5a627001c300a7ccdd849"
  },
  {
    "id": "REFUSE-RAOULT-FIRST-WRONG-UNIT",
    "question": "Vapour pressures of pure A and B are 200 K and 100 torr. Equimolar liquids form an ideal solution. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "decline",
    "questionSha256": "27654ff046e80b2f21a60ddca7b870c8bb12422766b2e86a2ef6ab9f282cf4db"
  },
  {
    "id": "REFUSE-RAOULT-SECOND-WRONG-UNIT",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 K. Equimolar liquids form an ideal solution. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "decline",
    "questionSha256": "b8bed082778af94f114ab9b2d56804e2223d2224b5f62ecb97943275ab9a74d1"
  },
  {
    "id": "REFUSE-RAOULT-FIRST-SCIENTIFIC",
    "question": "Vapour pressures of pure A and B are 1e- torr and 100 torr. Equimolar liquids form an ideal solution. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "decline",
    "questionSha256": "0d042b9bf45fc2e086ee61c0cb5833da0eb2c2029d1f0d36ec1a1274acde7525"
  },
  {
    "id": "REFUSE-RAOULT-SECOND-SCIENTIFIC",
    "question": "Vapour pressures of pure A and B are 200 torr and 1e- torr. Equimolar liquids form an ideal solution. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "decline",
    "questionSha256": "eb98b2f52c7533f1dcc8a7221a286d669f1ee24367d7e345a17d99afba9e04a2"
  },
  {
    "id": "REFUSE-RAOULT-UNIT-SUFFIX",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 torrfoo. Equimolar liquids form an ideal solution. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "decline",
    "questionSha256": "c42f86a3181daf89310db97e8686f3357f77f5f2c1f5f2494fd996e0cfabefd3"
  },
  {
    "id": "REFUSE-RAOULT-FIRST-UNKNOWN",
    "question": "Vapour pressures of pure A and B are unknown torr and 100 torr. Equimolar liquids form an ideal solution. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "decline",
    "questionSha256": "f68d174ed100bda607df6651b5cab7ca2d52a152da986a6d3c3dea60f0d3801c"
  },
  {
    "id": "REFUSE-RAOULT-SECOND-UNKNOWN",
    "question": "Vapour pressures of pure A and B are 200 torr and unknown torr. Equimolar liquids form an ideal solution. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "decline",
    "questionSha256": "96cbd873bd1d0c5f6f9af6a73ede41d2f2d3c4ebd6487d5d6c95c1a480d44756"
  },
  {
    "id": "CONTROL-RAOULT-NEGATED-NOT",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 torr. These liquids are not Equimolar; they form an ideal solution. Draw only the Raoult pressure graph.",
    "family": "solutions",
    "kind": "graph",
    "questionSha256": "ecfdc6f933b3be3a11b3967e037bc9ef4dcb8458d995a24ee43fcd01361bd9fd"
  },
  {
    "id": "CONTROL-RAOULT-NEGATED-NON",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 torr. The liquids form a non-Equimolar ideal solution. Draw only the Raoult pressure graph.",
    "family": "solutions",
    "kind": "graph",
    "questionSha256": "850418bacc47e09304747a513d5af1a295b3319c0e4747cabb7c9b86a2f0c2de"
  },
  {
    "id": "CONTROL-RAOULT-EXPLICIT-NEGATED-PRIORITY",
    "question": "Vapour pressures of pure A and B are 200 torr and 100 torr. These liquids are not Equimolar. Their ideal solution has x_a = 0.25. Draw the Raoult graph and find total pressure.",
    "family": "solutions",
    "kind": "raoult",
    "questionSha256": "aab05e5be5dd9611112245b6a775774cd3fda3915553662adb456398c7928d50",
    "xA": 0.25
  }
];

interface Evidence { id: string; questionSha256: string; seam: string; passed: boolean; error?: string }
const evidence: Evidence[] = [];
const compact = (text: string): string => text.replace(/\s+/g, "").replace(/−|–/g, "-");
function near(actual: unknown, expected: number, tolerance = 0.500001e-6): void {
  assert.ok(typeof actual === "number" && Number.isFinite(actual), `Missing/nonfinite numeric value: ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}
function stored(scene: SceneDocument, value: number, unit: string): void {
  assert.ok(scene.quantities.some(q => typeof q.value === "number" && Number.isFinite(q.value)
    && Math.abs(q.value - value) <= 0.500001e-6 && typeof q.unit === "string" && q.unit === unit),
  `Source quantity ${value} ${unit} missing: ${JSON.stringify(scene.quantities)}`);
}
function checked(scene: SceneDocument, row: Row) {
  assert.equal(scene.source.question, row.question);
  assert.equal(scene.source.chemistryFamily, row.family === "thermo" ? "chem_thermo" : "chem_solutions");
  const validated = validateSceneDocument(pruneDeadSceneEntities(scene as unknown as Record<string, unknown>));
  assert.ok(validated.document, JSON.stringify(validated.report.issues));
  const compiled = compileSceneDocument(validated.document);
  assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  const labels = compiled.renderScene.primitives.filter(p => p.kind === "label").map(p => {
    assert.ok(typeof p.text === "string", "Compiled label text required");
    assert.ok(!/NaN|Infinity/.test(p.text));
    return compact(p.text);
  });
  return { labels, render: compiled.renderScene };
}
function originalReading(row: Row, span: ChemistrySpan, dimension: "temperature" | "temperature_delta", expected: number, shared = false): void {
  const convention = shared && row.sharedUnit && row.sharedUnitSpan
    ? { unit: row.sharedUnit, sourceSpan: row.sharedUnitSpan } : undefined;
  const result = readChemistryLiteral({ question: row.question, scalarSpan: span, dimension, targetUnit: "K",
    ...(convention ? { unitConvention: convention } : {}) });
  assert.ok(result.ok, JSON.stringify(result));
  near(result.reading.value, expected, 1e-12);
  assert.equal(result.reading.source.kind, "stem_given");
  assert.equal(row.question.slice(result.reading.source.span.start, result.reading.source.span.end), result.reading.source.text);
  assert.equal(result.reading.source.span.start, span.start);
}
function heatEvidence(scene: SceneDocument, row: Row): void {
  assert.ok(row.capacity !== undefined && row.delta !== undefined && row.heat !== undefined);
  if (row.t1 !== undefined && row.t2 !== undefined) {
    assert.ok(row.firstScalarSpan && row.secondScalarSpan);
    originalReading(row, row.firstScalarSpan, "temperature", row.t1, !!row.sharedUnit);
    originalReading(row, row.secondScalarSpan, "temperature", row.t2);
    near(row.t2 - row.t1, row.delta, 1e-12);
    stored(scene, row.t1, "K");
    stored(scene, row.t2, "K");
  } else {
    assert.ok(row.deltaScalarSpan);
    originalReading(row, row.deltaScalarSpan, "temperature_delta", row.delta);
  }
  near(row.capacity * row.delta, row.heat, 1e-12);
  stored(scene, row.capacity, "J/K");
  stored(scene, row.delta, "K");
  stored(scene, row.heat, "J");
  const result = checked(scene, row);
  assert.ok(result.labels.includes(`q=${row.heat}J`), JSON.stringify(result.labels));
  assert.ok(result.labels.includes("q=C*dT"), "Existing heat law must survive");
}
function point(scene: SceneDocument, id: string, x: number, y: number): void {
  assert.ok(scene.entities.some(e => e.id === id && e.kind === "point"), `Source point ${id} missing`);
  const construction = scene.constructions.find(c => c.operator === "point" && c.outputs.includes(id));
  assert.ok(construction, `Original point construction ${id} missing`);
  near(construction.inputs.x, x);
  near(construction.inputs.y, y);
}
function raoultEvidence(scene: SceneDocument, row: Row): void {
  // Independent unscaled pressures, then inspect the actual producer's scaled
  // source constructions, mixture assertion and compiled ink, not math alone.
  const raw = raoultLines(200, 100);
  near(raw.pA0, 200, 1e-12);
  near(raw.pB0, 100, 1e-12);
  point(scene, "pure_a", 1, 0.6);
  point(scene, "pure_b", 0, 0.3);
  const result = checked(scene, row);
  assert.ok(result.labels.includes("p(torr)"), "Original pressure display unit must remain complete");
  if (row.kind === "graph") {
    assert.ok(!scene.entities.some(e => e.id === "mix_point" || e.id === "mix_foot"), "Substring of equimolar cannot invent composition");
    assert.ok(!scene.assertions.some(a => a.id === "total_at_mix"));
    return;
  }
  assert.ok(row.xA !== undefined);
  const total = 200 * row.xA + 100 * (1 - row.xA);
  near(raw.pTotal(row.xA), total, 1e-12);
  const y = (0.6 / 200) * total;
  point(scene, "mix_point", row.xA, y);
  point(scene, "mix_foot", row.xA, 0);
  const proof = scene.assertions.find(a => a.id === "total_at_mix");
  assert.ok(proof && proof.predicate === "function_value" && proof.entities.includes("p_total"));
  assert.ok(typeof proof.expected === "object" && proof.expected !== null && "x" in proof.expected && "y" in proof.expected);
  near(proof.expected.x, row.xA);
  near(proof.expected.y, y);
  assert.ok(result.render.primitives.some(p => p.entityId === "mix_point" && p.kind !== "label"), "Compiled mixture-point ink missing");
  assert.ok(result.labels.includes(`x_A=${row.xA}`), JSON.stringify(result.labels));
  assert.ok(result.labels.includes(`p_total=${total}`), JSON.stringify(result.labels));
  assert.ok(result.labels.includes(`p_A=${200 * row.xA}torr`), JSON.stringify(result.labels));
  assert.ok(result.labels.includes(`p_B=${100 * (1 - row.xA)}torr`), JSON.stringify(result.labels));
  const captions = scene.annotations.map(a => a.text ?? "").map(compact);
  assert.ok(captions.some(text => text.includes(`Atx_A=${row.xA}:`) && text.includes(`p_total=${total}torr`)), "Source answer caption must include original composition and total");
}

for (const row of ROWS) {
  assert.equal(createHash("sha256").update(row.question).digest("hex"), row.questionSha256);
  for (const seam of ["direct", "schematic", "ordinary"] as const) {
    const record: Evidence = { id: row.id, questionSha256: row.questionSha256, seam, passed: false };
    try {
      const builder = row.family === "thermo" ? buildChemicalThermodynamicsScene : buildSolutionsGraphScene;
      const scene = seam === "ordinary" ? synthesizeFamilyScene({ question: row.question })?.document ?? null
        : builder(row.question, [], seam === "schematic");
      if (row.kind === "decline") assert.equal(scene, null, "Unread original input cannot become partial/default figure");
      else {
        assert.ok(scene, "Supported source-bound figure must draw");
        if (row.kind === "heat") heatEvidence(scene, row);
        else raoultEvidence(scene, row);
      }
      record.passed = true;
      console.log(`PASS ${row.id}/${seam}`);
    } catch (error) {
      record.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error(`FAIL ${row.id}/${seam}: ${record.error}`);
    }
    evidence.push(record);
  }
}
const result = { schema: "chemistry-shared-units-composition/v1", questions: ROWS.length, checks: evidence.length,
  passed: evidence.filter(row => row.passed).length, failed: evidence.filter(row => !row.passed).length, rows: evidence };
const outIndex = process.argv.indexOf("--out");
if (outIndex !== -1) {
  const out = process.argv[outIndex + 1];
  assert.ok(out, "--out path required");
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
}
console.log(JSON.stringify(result));
if (result.failed) process.exitCode = 1;
