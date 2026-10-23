/** Third-review literal inventory gates. Public stems are oracles only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { buildUnitCellScene } from "../../src/chemistry/unitCell";
import { buildElectrochemScene, cellEmf, parseCellNotation } from "../../src/chemistry/electrochemistry";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";

interface Row {
  id: string;
  question: string;
  questionSha256: string;
  kind: "decline" | "electro-optional" | "electro-required" | "unit-edge" | "unit-radius" | "unit-optional" | "electro-observed";
  e0?: number;
  observed?: number;
  edgePm?: number;
  radiusPm?: number;
  molarMass?: number;
  z?: number;
}
const ROWS: readonly Row[] = [
  {
    "id": "REVIEW-EDGE-FOUND",
    "question": "In an fcc metal the edge length was found to be 400 pm and the atomic radius is 150 pm. Calculate the density (atomic mass 60 g/mol).",
    "questionSha256": "96ad84e38507245658c6e6b4068b503edc0e6d7f338856bef8fe7ad5d3c9d385",
    "kind": "unit-optional",
    "edgePm": 400,
    "radiusPm": 150,
    "molarMass": 60,
    "z": 4
  },
  {
    "id": "REVIEW-EDGE-COMES",
    "question": "In an fcc metal the edge length comes to 400 pm and the atomic radius is 150 pm. Calculate the density (atomic mass 60 g/mol).",
    "questionSha256": "ddf26ebd4d1ad1270ea89ff4d6905498bf4c8813a77bc42cd6f718ab8ccbf90c",
    "kind": "unit-optional",
    "edgePm": 400,
    "radiusPm": 150,
    "molarMass": 60,
    "z": 4
  },
  {
    "id": "REVIEW-EDGE-ROUGH",
    "question": "In a bcc metal the edge length, roughly, 287 pm and the atomic radius is 124 pm. Calculate the density (atomic mass 56 g/mol).",
    "questionSha256": "ac275aa90475834940f941b81a7b134192da8d45bc10626fe6c32dee87d3ea20",
    "kind": "unit-optional",
    "edgePm": 287,
    "radiusPm": 124,
    "molarMass": 56,
    "z": 2
  },
  {
    "id": "REVIEW-EDGE-BEING",
    "question": "An fcc crystal has atomic radius 144 pm. The edge length of its unit cell being 408.6 pm, calculate its density (atomic mass 108 g/mol).",
    "questionSha256": "4cea6f27e87c32968c1370d32fdbecd2c10d3ecd6331a1fec0ca16f6b5e224c7",
    "kind": "unit-optional",
    "edgePm": 408.6,
    "radiusPm": 144,
    "molarMass": 108,
    "z": 4
  },
  {
    "id": "REVIEW-EDGE-NM",
    "question": "In an fcc metal the edge length turns out to be 0.400 nm and the atomic radius is 150 pm. Calculate the density (atomic mass 60 g/mol).",
    "questionSha256": "a72fcad173f1f50a7f1b9f802911a35ede0b28f34833245b01ad484e6c60553b",
    "kind": "unit-optional",
    "edgePm": 400,
    "radiusPm": 150,
    "molarMass": 60,
    "z": 4
  },
  {
    "id": "REVIEW-RADIUS-FOUND",
    "question": "In an fcc metal the edge length is 400 pm and the radius of its atom was found to be 150 pm. Calculate the density (atomic mass 60 g/mol).",
    "questionSha256": "0e5b690deaea1cb9bbf9f86e64051047cbb624ea3e1d123631972b786da11cd8",
    "kind": "unit-optional",
    "edgePm": 400,
    "radiusPm": 150,
    "molarMass": 60,
    "z": 4
  },
  {
    "id": "REVIEW-CATION-METAL",
    "question": "An fcc unit cell edge length is 508 pm. If the radius of the cation is 110 pm, find the radius of the anion.",
    "questionSha256": "c0b4c0d85a23ab9be24bf5b184ba6e67c79e4b2d26056419a54a78a57be9a597",
    "kind": "decline"
  },
  {
    "id": "REVIEW-POTENTIAL-REDUCTION",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu given standard reduction potentials Zn = \u22120.80 V, Cu = +0.40 V.",
    "questionSha256": "db27c8588cc640d5a045ca9adc9ec5608275b56bd82a4316838ef1a7822b4b59",
    "kind": "electro-optional",
    "e0": 1.2
  },
  {
    "id": "REVIEW-STANDARD-ECELL0",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if E_cell^0 = 1.10 V.",
    "questionSha256": "1a4a120da540e046371efd4696abf2b3a81aa17c053f035431d98211268d3ad2",
    "kind": "electro-optional",
    "e0": 1.1
  },
  {
    "id": "REVIEW-STANDARD-POST-DEGREE",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if Ecell\u00b0 = 1.10 V.",
    "questionSha256": "5c0766ccacc1dae7097b04919ab9229e28d9941a2496a4e12621e9a332d24de5",
    "kind": "electro-optional",
    "e0": 1.1
  },
  {
    "id": "REVIEW-STANDARD-O-CELL",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if Eocell = 1.10 V.",
    "questionSha256": "02827457b470ffbaff80e62853c238964cb8e99ce343e47c7541338966195dad",
    "kind": "electro-optional",
    "e0": 1.1
  },
  {
    "id": "REVIEW-STANDARD-WORDS-STANDARD",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if E cell = 1.10 V under standard conditions.",
    "questionSha256": "e2ec87623bb95e52f0d6e4d641c2b995089c18da55faf263face63a0b2094854",
    "kind": "electro-optional",
    "e0": 1.1
  },
  {
    "id": "REVIEW-ELECTRODE-NAMES",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. The standard electrode potential of zinc is \u20130.80 V and that of copper is +0.40 V.",
    "questionSha256": "6b10666858a231e9b08c9cb95eb303c647a7f56a14c142bdcc65e03ca3aeb462",
    "kind": "electro-optional",
    "e0": 1.2
  },
  {
    "id": "REVIEW-ELECTRODE-COUPLES",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. Reduction potential of Zn2+/Zn is -0.80 V and that of Cu2+/Cu is 0.40 V.",
    "questionSha256": "d20e183c001d445265a830966bb83974f12386cbff890bb3ec9f1e77e82d3a62",
    "kind": "electro-optional",
    "e0": 1.2
  },
  {
    "id": "REVIEW-ELECTRODE-VALUES",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. E\u00b0 values: Zn2+/Zn, \u22120.80 V; Cu2+/Cu, +0.40 V.",
    "questionSha256": "9e9dbf6efc44c1bee763a2c4c6dfcd2b3b72500913824c1290980c13080a1694",
    "kind": "electro-optional",
    "e0": 1.2
  },
  {
    "id": "REVIEW-ELECTRODE-SYMBOLS",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. E\u00b0Zn = \u22120.80 V and E\u00b0Cu = +0.40 V.",
    "questionSha256": "48ee8f6ef0fa277afdc3a1cb87a8cb46e04fc06d2c7a7efd1c30ba4a317fbda5",
    "kind": "electro-optional",
    "e0": 1.2
  },
  {
    "id": "REVIEW-ELECTRODE-FOR-NAMES",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. The electrode potentials are \u22120.80 V for zinc and +0.40 V for copper.",
    "questionSha256": "fb6fe58edb00d932aa22e9d02bcd7b904777e2604be8b6be120e80a704eb21c0",
    "kind": "electro-optional",
    "e0": 1.2
  },
  {
    "id": "OWN-EDGE-1",
    "question": "In an fcc metal the edge length was surveyed as 400 pm, while its atomic radius is 150 pm. Calculate density for atomic mass 60 g/mol.",
    "questionSha256": "9406f1d036ecd92f6deb6d80ba3089109842b5fa2a0c4c6b3d69b03ceb086ad5",
    "kind": "unit-optional",
    "edgePm": 400,
    "radiusPm": 150,
    "molarMass": 60,
    "z": 4
  },
  {
    "id": "OWN-EDGE-2",
    "question": "An fcc metal has atomic radius 150 pm. Its lattice edge works out to 0.400 nm. Find density for atomic mass 60 g/mol.",
    "questionSha256": "633d59fc36f47fd6e3bc596e60065a8489ea0e9dab12f067ecca1738f23443df",
    "kind": "unit-optional",
    "edgePm": 400,
    "radiusPm": 150,
    "molarMass": 60,
    "z": 4
  },
  {
    "id": "OWN-EDGE-3",
    "question": "For an fcc metal, the unit-cell edge is reported as 4.00 \u00c5 and the atomic radius is 150 pm. Calculate density with atomic mass 60 g/mol.",
    "questionSha256": "e504422ef271ede6f5ca67ecea97c0a8a8a26ed03968d70900bb3e9553e40624",
    "kind": "unit-optional",
    "edgePm": 400,
    "radiusPm": 150,
    "molarMass": 60,
    "z": 4
  },
  {
    "id": "OWN-EDGE-4",
    "question": "An fcc metal sample has a length measurement of 400 pm and atomic radius 150 pm. Draw its unit cell and calculate density for atomic mass 60 g/mol.",
    "questionSha256": "cdaddfbd29e7ff401106125fd8bd056033b5d4c8ff297300df17fc447dec6e01",
    "kind": "decline"
  },
  {
    "id": "OWN-EDGE-5",
    "question": "The edge of an fcc cell is quoted as 4.00 \u00d7 10^-8 cm, with atomic radius 150 pm. Calculate density using atomic mass 60 g/mol.",
    "questionSha256": "31229fc23e7450181e0f83b19fd7b85705f1aaed81457fba94fde0e8b7913419",
    "kind": "unit-optional",
    "edgePm": 400,
    "radiusPm": 150,
    "molarMass": 60,
    "z": 4
  },
  {
    "id": "OWN-RADIUS-1",
    "question": "An fcc metal has cell edge 400 pm; the atomic radius came to 150 pm. Draw the unit cell and calculate density with atomic mass 60 g/mol.",
    "questionSha256": "58fc23e4d0b38d5cef6ca5c51265379a118162a048ff07a9249d86741cb40b90",
    "kind": "unit-optional",
    "edgePm": 400,
    "radiusPm": 150,
    "molarMass": 60,
    "z": 4
  },
  {
    "id": "OWN-RADIUS-2",
    "question": "The edge length of an fcc metal is 400 pm. The radius of its metal atom was observed as 0.150 nm. Find density for atomic mass 60 g/mol.",
    "questionSha256": "a0e4e5b7256ceb38140e52bde3bfa2c2aba93d256ad91fe53b689d7bfbea5504",
    "kind": "unit-optional",
    "edgePm": 400,
    "radiusPm": 150,
    "molarMass": 60,
    "z": 4
  },
  {
    "id": "OWN-RADIUS-3",
    "question": "For an fcc metal of atomic mass 60 g/mol, a = 400 pm and the atomic-radius estimate reads 1.50 \u00c5. Calculate density.",
    "questionSha256": "2d43b1e5256480e4fa6264df5db1e417b533b08590a644bef361d8033e41cffe",
    "kind": "unit-optional",
    "edgePm": 400,
    "radiusPm": 150,
    "molarMass": 60,
    "z": 4
  },
  {
    "id": "OWN-RADIUS-4",
    "question": "An fcc metal has edge length 400 pm. A measurement quoted for r_atom was 150 pm. Draw the cell and find density for atomic mass 60 g/mol.",
    "questionSha256": "23307db01c5152bb390faa34c9b1d27cc6493dc7530b2479cef3a181d0d30962",
    "kind": "unit-optional",
    "edgePm": 400,
    "radiusPm": 150,
    "molarMass": 60,
    "z": 4
  },
  {
    "id": "OWN-RADIUS-5",
    "question": "The fcc metal unit-cell edge is 508 pm and a cation radius is given as 110 pm. Draw the unit cell and state the metal atomic radius.",
    "questionSha256": "a08bb1ce690abc616e6001a8f7c0a9d6f5f3218d4d3443a338d08c3739bc3012",
    "kind": "decline"
  },
  {
    "id": "OWN-STANDARD-1",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu given E^0_cell = 1.10 V.",
    "questionSha256": "c0a9a401cbcc9f8d51eeed0a6f840dbea6acbd2d3e9d04564f42055ba724a7d1",
    "kind": "electro-optional",
    "e0": 1.1
  },
  {
    "id": "OWN-STANDARD-2",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu given E_(cell)\u00b0 = 1.10 V.",
    "questionSha256": "6ca67fcf8d6fd2ddf34099816b556950747f2493ea10a2733a39c45820fd9e3a",
    "kind": "electro-optional",
    "e0": 1.1
  },
  {
    "id": "OWN-STANDARD-3",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu given the cell potential E is 1.10 V in the standard state.",
    "questionSha256": "7fa9bfcf46299ad5d038d7e888d0d1330935beeb1b73f4643675711a5e8a6eab",
    "kind": "electro-optional",
    "e0": 1.1
  },
  {
    "id": "OWN-STANDARD-4",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu given E\u00b0 for the complete cell is quoted as 1.10 VOLTS.",
    "questionSha256": "344df7cc1f8cac3add0a061be3f02a9e596261d2db3d626c35d518717f0d8944",
    "kind": "electro-optional",
    "e0": 1.1
  },
  {
    "id": "OWN-STANDARD-5",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu given the standard cell voltage was found to be 1.10 volts.",
    "questionSha256": "9e4966626aca8784b4a497a4620920b67f88e1f8bd53ddbc90c09422610dd84c",
    "kind": "electro-optional",
    "e0": 1.1
  },
  {
    "id": "OWN-ELECTRODE-1",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. The standard reduction potentials are -0.80 V for Zn2+/Zn and +0.40 V for Cu2+/Cu.",
    "questionSha256": "7b084abc1d41924a8cad19b049c8675b296ef0591922c554147179b3b2b437da",
    "kind": "electro-optional",
    "e0": 1.2
  },
  {
    "id": "OWN-ELECTRODE-2",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. E\u00b0(zinc) was measured as \u22120.80 V; E\u00b0(copper) was measured as +0.40 V.",
    "questionSha256": "3bae8396ef6bc21dfa972bba8ff6de3fede55ab8c43bd74aa34e818fef4be4e0",
    "kind": "electro-optional",
    "e0": 1.2
  },
  {
    "id": "OWN-ELECTRODE-3",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. The Cu2+/Cu standard potential comes to +0.40 V and the Zn2+/Zn standard potential comes to -0.80 V.",
    "questionSha256": "a41c127bba0d3939f41a6e2a09720bd381080433eba40cc716e232dd1b8ff7d6",
    "kind": "electro-optional",
    "e0": 1.2
  },
  {
    "id": "OWN-ELECTRODE-4",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. For the zinc electrode, the reduction potential is -800 mV; for copper, it is +400 mV.",
    "questionSha256": "55c03bb68990781d541799198288fff0ff014d3ece7377f147d6d6634da0531a",
    "kind": "electro-optional",
    "e0": 1.2
  },
  {
    "id": "OWN-ELECTRODE-5",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. The standard reduction potentials are Zn2+/Zn = unknown and Cu2+/Cu = +0.40 V.",
    "questionSha256": "8eeaa00b632c22fd6e321d84dbf6c97d82820910212a4819cb7cbec206ed2815",
    "kind": "decline"
  },
  {
    "id": "CONTROL-EDGE-ONLY",
    "question": "An fcc metal has edge length a = 400 pm and atomic mass 60 g/mol. Draw the cell and calculate density.",
    "questionSha256": "9b370fa523344ca9d3bf5f36177dc91640aeb4b5a69eb11d1b4be49f290dcdc5",
    "kind": "unit-edge",
    "edgePm": 400,
    "molarMass": 60,
    "z": 4
  },
  {
    "id": "CONTROL-RADIUS-ONLY",
    "question": "An fcc metal has atomic radius r = 150 pm and atomic mass 60 g/mol. Draw its cell and calculate density.",
    "questionSha256": "89d7e72bd721e9a95ad90299c74e8345df1b6f1b490cf76ea88cfc2e34621d5f",
    "kind": "unit-radius",
    "radiusPm": 150,
    "molarMass": 60,
    "z": 4
  },
  {
    "id": "CONTROL-STANDARD",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. E\u00b0cell = 1.10 V.",
    "questionSha256": "d6c83a426e64f6651d1fcad403d376f505e2809174d170f802197719911561a4",
    "kind": "electro-required",
    "e0": 1.1
  },
  {
    "id": "CONTROL-DEFAULT",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu.",
    "questionSha256": "cc393c1cc4794aea83766ac654895e068bdefaf9b6a01b84232f84b2f87edca2",
    "kind": "electro-required",
    "e0": 1.1
  },
  {
    "id": "CONTROL-ELECTRODE",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. E\u00b0(Zn2+/Zn) = -0.80 V and E\u00b0(Cu2+/Cu) = +0.40 V.",
    "questionSha256": "1e24228ad8270a2f0081dde2ce2c787ed59a705f101cf102da715ce7c6ef8c56",
    "kind": "electro-required",
    "e0": 1.2
  },
  {
    "id": "REVIEWER-STANDARD-E298-UNOWNED",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if Ecell\u00b0 = 1.10 V at 298 K.",
    "questionSha256": "95f3d5e9b5c7f8c44742c93680baaa4b4ff3454574fb151ffc56e7e0aa32984b",
    "kind": "decline"
  },
  {
    "id": "REVIEWER-ELECTRODE-ZN298-UNOWNED",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu given Zn = -0.80 V at 298 K.",
    "questionSha256": "073b5f486f3a44f48ab7fff25f9e3726b6a3951252c999b19e6134f02d89fab8",
    "kind": "decline"
  },
{
  "id": "FOURTH-STANDARD-DECLINE-01",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if E nought is 1.10 V.",
  "questionSha256": "1e8bc3c7aea286b664b64b506069a5a0edb90c99a01ea55038c9ac6b98771186",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-02",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if E naught = 1.10 V.",
  "questionSha256": "1bdff4b4841a8cbf36a6b7013a1cc8ff9624b67e65342e14b1c0ec3362546dde",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-03",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu given that E zero of the cell is 1.10 V.",
  "questionSha256": "1febf1fc6d9da18546ebcd4a5b031feb890355600c5810461ccd5e11f826ed24",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-04",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if E not is 1.10 V.",
  "questionSha256": "7c788e9001e8cc92e962a496321cd00d79c62d460af71782ff23a34a4db226d7",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-05",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if the E-naught value is 1.10 V.",
  "questionSha256": "26334ea91d1d2bd69d8800a80772f301713f2b514d669d633e38e58c655560bf",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-06",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if Enaught = 1.10 V.",
  "questionSha256": "f7199e90e3a1827b8cadd140412cdb93a4c44e803b94a539683122446ad8ac5a",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-07",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if E cell nought is 1.10 V.",
  "questionSha256": "d425b91e6318c6480eee750b6ea92b460d4d8601a9122146ff905a7d39e941c0",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-08",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if E sub zero is 1.10 V.",
  "questionSha256": "04a86c996518df10efadcf7677b111dab11c0198b27a530c7c5918b697c715ef",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-09",
  "question": "Find the emf of the Daniell cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu when its E nought is 1.10 V.",
  "questionSha256": "4e10793cee129a12469c26d06158d0c5d9ce81f301e2b0f0cd888ca40757ea9c",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-10",
  "question": "What is the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu? The E nought of the cell is 1.10 V.",
  "questionSha256": "37f57cb7b97f5cd993815e1956f1f43777eb9a832f03658440b8556326cede0e",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-11",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if the cell's E nought is 1.10 V.",
  "questionSha256": "af645b76fcd8f7bfe29c57d0015db716ec47722f218c8d0e32c731162e1bea1c",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-12",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if E-cell-zero = 1.10 V.",
  "questionSha256": "62a0c90dc5532b5034cada9ea3635036782fc5df63cc3d9ef73a9dce81af2890",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-13",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if E nought is 1.20 V.",
  "questionSha256": "a2bbf53c7183e81052dc498def110aa37badebddd1d80902cf36e6fb997e4f29",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-14",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu where E-nought of the cell is 1.10 V.",
  "questionSha256": "f2ca559ac8fbda689f3f013370ae6e06c8fcd72c7c39a9fac9f70a2256e73cdd",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-15",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu given E naught for the cell = 1.10 V.",
  "questionSha256": "9ea596d5910c0582512f07ae9011536e8d566575db831f6e0f95834465aacdce",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-16",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu when E zero is 1.10 V.",
  "questionSha256": "965b3c5b59e10164e9dcb9b9cef90a1cf49a8523cb8a4f56b342334314a93f12",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-17",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if its E sub naught is 1.10 V.",
  "questionSha256": "4387190f81f2e95cff3f74891e0d8290f6c392f5565c80817d94b4bc247d2d07",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-18",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu? The value of E-zero is 1.10 V.",
  "questionSha256": "97a83bec0ce229884cdde37f9c111a3602ac4fc230c9f5db34c841eb4539034f",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-19",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if the reference value is 1.13 V.",
  "questionSha256": "7be2c628758f379563cdb7772d3a75a6e9b397f862748360a4fde22809367d88",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-20",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu given the calibration value is 1.13 V.",
  "questionSha256": "6d2a33ec7f83422c233de17150715faad016cbe929e6816c220ade894bcb36d0",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-21",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu when the instrument reading is 1.13 V.",
  "questionSha256": "804595ec4e95035644415fe46b3f5fe6c21bdc4e37658ef5e09ce4cd25e7d0b9",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-22",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu where the reference cell is 1.13 V.",
  "questionSha256": "232cd9c1bda9e76701c7009d41499ac75cecffe684cf09eb7986b9b46ab62e15",
  "kind": "decline"
},
{
  "id": "FOURTH-STANDARD-DECLINE-23",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu? The reference reading is 1.13 V.",
  "questionSha256": "903f8b5e47bbe4af9856fc95c10c8404bcf5faa72b1ec46cca4902e35f2a105a",
  "kind": "decline"
},
{
  "id": "FOURTH-OBSERVED-CONTROL-1",
  "question": "Draw Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu at 298 K. E°cell = 1.10 V. Given observed emf is 1.13 V.",
  "questionSha256": "edede27f617147bddb804b5cf802baf01c45408559ad0f79b138a8f66e2bf53c",
  "kind": "electro-observed",
  "observed": 1.13
},
{
  "id": "FOURTH-OBSERVED-CONTROL-2",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu given observed emf is 1.13 V.",
  "questionSha256": "32301e276cdc654f16295d3b7c425fd547c95c7cb9d96589b40e33dca344a2c3",
  "kind": "electro-observed",
  "observed": 1.13
},
{
  "id": "LOCAL-PLAIN-OBSERVED-1",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu given that the emf is 1.13 V.",
  "questionSha256": "6e0683f9e3ad7c44e48faa3106b1b157b0130b3b202dad62fc032564bb3a08d3",
  "kind": "electro-observed",
  "observed": 1.13
},
{
  "id": "LOCAL-PLAIN-OBSERVED-2",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if its emf is 1.13 V.",
  "questionSha256": "a594f5e2f5c3c5e3671a137acafca4011cc70b7af23bcc003de4992d909c5f06",
  "kind": "electro-observed",
  "observed": 1.13
},
{
  "id": "LOCAL-PLAIN-OBSERVED-3",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu where the cell potential = 1.13 V.",
  "questionSha256": "d97e6c1f59d503cd2b22268911c91894fb85aa4b9816617890a08aa0637ef6e5",
  "kind": "electro-observed",
  "observed": 1.13
},
{
  "id": "LOCAL-PLAIN-OBSERVED-4",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu when the voltage is 1.13 V.",
  "questionSha256": "ff46f00503c954bc717e074f11add6e5d96a076dfbe320f35fc0fc9541f9e37f",
  "kind": "electro-observed",
  "observed": 1.13
},
{
  "id": "LOCAL-PLAIN-OBSERVED-5",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu? The emf of the cell is 1.13 V.",
  "questionSha256": "b82578c80f7435eee7afeac4fa25ece85d7158c3e2464ac224d91e334e8aa680",
  "kind": "electro-observed",
  "observed": 1.13
},
{
  "id": "LOCAL-PLAIN-OBSERVED-6",
  "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu given that the potential of the cell is 1.13 V.",
  "questionSha256": "5c44bdceca1898aff9d0d396fd41f9b2ef4e03d805b0e723b4fc72224cc0824f",
  "kind": "electro-observed",
  "observed": 1.13
},
  {
    "id": "CONTROL-STANDARD-T298",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. E\u00b0cell = 1.10 V. The temperature is 298 K.",
    "questionSha256": "70f892cb60bfb70f7c63608da1a8e862b3801be3e59b658666db1110f280415c",
    "kind": "electro-required",
    "e0": 1.1
  },
  {
    "id": "CONTROL-DEFAULT-T298",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. The temperature is 298 K.",
    "questionSha256": "aa567053fb38a01e0bcfac895d4521375365aea52f72376b1392c23a8578a6fb",
    "kind": "electro-required",
    "e0": 1.1
  },
  {
    "id": "CONTROL-ELECTRODE-T298",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. E\u00b0(Zn2+/Zn) = -0.80 V and E\u00b0(Cu2+/Cu) = +0.40 V. The temperature is 298 K.",
    "questionSha256": "d0d2186aa0ba03611c7f3213484db73fc2673c97766073489c4555f455328886",
    "kind": "electro-required",
    "e0": 1.2
  },
];

interface Evidence {
  id: string;
  seam: "direct" | "schematic" | "ordinary";
  questionSha256: string;
  passed: boolean;
  disposition?: "honest-decline" | "source-correct-figure";
  error?: string;
}
const evidence: Evidence[] = [];
const near = (actual: unknown, expected: number): void => {
  assert.ok(typeof actual === "number" && Number.isFinite(actual), `Nonfinite/missing quantity ${actual}`);
  // scene-document serialization keeps six decimal places; independent math
  // remains full precision, rather than using the builder's own solver.
  assert.ok(Math.abs(actual - expected) <= 0.500001e-6, `${actual} != ${expected}`);
};
const compactText = (text: string): string => text.replace(/\s+/g, "").replace(/−|–/g, "-");

function checkedScene(scene: SceneDocument, question: string) {
  assert.equal(scene.source.question, question, "Original source question changed");
  const validated = validateSceneDocument(pruneDeadSceneEntities(scene as unknown as Record<string, unknown>));
  assert.ok(validated.document, JSON.stringify(validated.report.issues));
  const result = compileSceneDocument(validated.document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  const labels = result.renderScene.primitives.filter(p => p.kind === "label").map(p => {
    assert.ok(typeof p.text === "string", "Compiled label text required");
    return p.text;
  });
  const texts = [...labels, ...scene.annotations.map(a => a.text ?? "")];
  assert.ok(texts.every(text => !/NaN|Infinity/.test(text)), JSON.stringify(texts));
  assert.ok(scene.quantities.every(q => typeof q.value === "number" && Number.isFinite(q.value)), "Nonfinite source quantities");
  return { scene, labels, texts };
}

function verifyElectrochem(scene: SceneDocument, row: Row): void {
  assert.ok(row.e0 !== undefined);
  const result = checkedScene(scene, row.question);
  assert.equal(scene.source.chemistryFamily, "chem_electrochem");
  const spec = parseCellNotation(row.question);
  assert.ok(spec, "A drawn numeric cell needs original readable potential owners");
  assert.equal(spec.statedE, undefined, "No observed emf is supplied in these standard/couple fixtures");
  if (row.id.includes("STANDARD")) {
    near(spec.statedE0, row.e0);
  } else if (row.id.includes("ELECTRODE") || row.id.includes("POTENTIAL")) {
    near(spec.anode.e0, -0.80);
    near(spec.cathode.e0, 0.40);
    assert.equal(spec.anode.potentialSource, "stem");
    assert.equal(spec.cathode.potentialSource, "stem");
    for (const half of [spec.anode, spec.cathode]) {
      assert.ok(half.potentialSourceSpan && half.potentialSourceText);
      assert.equal(row.question.slice(half.potentialSourceSpan.start, half.potentialSourceSpan.end), half.potentialSourceText,
        "Electrode source span must be original question bytes");
    }
  }
  const e0 = scene.quantities.find(q => q.id === "E0_cell");
  const e = scene.quantities.find(q => q.id === "E_cell");
  assert.equal(e0?.unit, "V");
  near(e0?.value, row.e0);
  near(scene.quantities.find(q => q.id === "n_electrons")?.value, 2);
  assert.deepEqual(Object.values(spec.anode.concentrations), [0.1]);
  assert.deepEqual(Object.values(spec.cathode.concentrations), [0.01]);
  // The solver API keeps its documented reference-temperature calculation.
  // The emitter needs an actual source T/factor before presenting that as E.
  const reference = cellEmf(spec); assert.ok(reference);
  near(reference.q, 10); near(reference.n, 2);
  const expectedUnrounded = row.e0 - 0.0591 / 2 * Math.log10(0.1 / 0.01);
  const expectedE = Number(expectedUnrounded.toFixed(4));
  near(reference.e, expectedE);
  const labels = result.labels.map(compactText);
  assert.ok(labels.includes(`E°=${row.e0.toFixed(2)}V`), JSON.stringify(result.labels));
  if (spec.temperatureK === undefined && spec.nernstFactor === undefined) {
    assert.equal(e, undefined, "no unproved nonstandard emf without source temperature/factor");
    assert.ok(!labels.some(label => /^E=[+-]?\d/.test(label)), "no default-temperature E ink");
    assert.ok(!result.texts.some(text => /Nernst[^;]*(?:0\.0?59|E\s*=\s*[+-]?\d)/i.test(text)),
      "any retained Nernst relation must be general or conditional");
  } else {
    assert.equal(spec.temperatureK, 298);
    assert.equal(e?.unit, "V"); near(e?.value, expectedE);
    assert.ok(labels.includes(`E=${expectedE.toFixed(2)}V`), JSON.stringify(result.labels));
    assert.ok(result.texts.some(text => /Nernst/.test(text)), "source-temperature Nernst step missing");
  }
  assert.ok(result.texts.every(text => !/\bemf\s+[−–+]?\d+(?:\.\d+)?\s*V\s+as given/i.test(text)),
    "Standard/couple potential was presented as observed emf");
}

function verifyObserved(scene: SceneDocument, row: Row): void {
  const result = checkedScene(scene, row.question);
  assert.equal(scene.source.chemistryFamily, "chem_electrochem");
  const spec = parseCellNotation(row.question);
  assert.ok(spec && row.observed !== undefined, "Observed-emf control must have a readable local owner");
  near(spec.statedE, row.observed);
  assert.ok(result.labels.map(compactText).includes(`E=${row.observed.toFixed(2)}V`), JSON.stringify(result.labels));
  assert.ok(result.texts.some(text => text.includes(`emf ${row.observed!.toFixed(2)} V as given`)), "Observed caption missing");
}

function verifyUnitCell(scene: SceneDocument, row: Row): void {
  const result = checkedScene(scene, row.question);
  assert.equal(scene.source.chemistryFamily, "chem_unit_cell");
  assert.ok(row.molarMass !== undefined);
  const a = scene.quantities.find(q => q.symbol === "a" && q.unit === "pm");
  const r = scene.quantities.find(q => q.symbol === "r" && q.unit === "pm");
  const edge = row.edgePm ?? (4 * row.radiusPm! / Math.sqrt(2));
  near(a?.value, edge);
  if (row.radiusPm !== undefined) near(r?.value, row.radiusPm);
  else if (r) near(r.value, edge * Math.sqrt(2) / 4);
  assert.ok(row.z !== undefined);
  const density = row.z * row.molarMass / (6.022e23 * (edge * 1e-10) ** 3);
  const rho = scene.quantities.find(q => q.symbol === "ρ" && q.unit === "g/cm^3");
  near(rho?.value, density);
  assert.ok(result.texts.some(text => /\bpm\b/.test(text)), "Complete pm unit missing");
  assert.ok(result.texts.some(text => /g\/cm(?:³|\^3)/.test(text)), "Complete density unit missing");
}

for (const row of ROWS) {
  assert.equal(createHash("sha256").update(row.question).digest("hex"), row.questionSha256, "Frozen wording changed");
  for (const seam of ["direct", "schematic", "ordinary"] as const) {
    const item: Evidence = { id: row.id, seam, questionSha256: row.questionSha256, passed: false };
    try {
      const electro = row.kind.startsWith("electro") || row.id.includes("POTENTIAL") || row.id.includes("STANDARD") || row.id.includes("ELECTRODE");
      const scene = seam === "ordinary"
        ? synthesizeFamilyScene({ question: row.question })?.document ?? null
        : (electro ? buildElectrochemScene : buildUnitCellScene)(row.question, [], seam === "schematic");
      if (row.kind === "decline") {
        assert.equal(scene, null, "Unowned physical literal or ionic-as-metal radius must decline");
        item.disposition = "honest-decline";
      } else if ((row.kind === "electro-optional" || row.kind === "unit-optional") && scene === null) {
        // Explicit caller-owned fail-closed policy permits honest refusal only
        // for listed noncanonical role rows, never for supported controls.
        // If a reader resolves every original role, all stated values must survive.
        item.disposition = "honest-decline";
      } else {
        assert.ok(scene, "Supported source-owned control must draw");
        if (row.kind === "electro-observed") verifyObserved(scene, row);
        else if (row.kind.startsWith("electro")) verifyElectrochem(scene, row);
        else verifyUnitCell(scene, row);
        item.disposition = "source-correct-figure";
      }
      item.passed = true;
      console.log(`PASS ${row.id}/${seam} ${item.disposition}`);
    } catch (error) {
      item.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error(`FAIL ${row.id}/${seam}: ${item.error}`);
    }
    evidence.push(item);
  }
}
const result = {
  schema: "chemistry-c08-literal-inventory-gate/v1",
  questions: ROWS.length,
  checks: evidence.length,
  passed: evidence.filter(row => row.passed).length,
  failed: evidence.filter(row => !row.passed).length,
  rows: evidence,
};
const outIndex = process.argv.indexOf("--out");
if (outIndex !== -1) {
  const out = process.argv[outIndex + 1];
  assert.ok(out, "--out path required");
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
}
console.log(JSON.stringify(result));
if (result.failed) process.exitCode = 1;
