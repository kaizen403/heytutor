/**
 * Coordination names, Werner valence, and named applications.
 * Expected names are the NCERT mononuclear forms, checked against the
 * parser rather than copied out of the caption by assumption.
 */
import { parseComplex } from "../../src/chemistry/formula";
import { formulaFromIupac, iupacName } from "../../src/chemistry/coordinationAccounts";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function labels(question: string): string[] {
  const scene = synthesizeFamilyScene({ question });
  return (scene?.renderScene?.primitives ?? [])
    .filter((primitive) => primitive.kind === "label" && primitive.text)
    .map((primitive) => primitive.text!);
}

const hexammine = parseComplex("[Co(NH3)6]Cl3");
check(hexammine !== null && hexammine.oxidationState === 3 && hexammine.coordinationNumber === 6, "hexammine cobalt(III) is CN 6 and oxidation state +3");
check(iupacName(hexammine!) === "hexaamminecobalt(III) chloride", `name ${iupacName(hexammine!)}`);

const ferrate = parseComplex("K4[Fe(CN)6]");
check(ferrate !== null && ferrate.oxidationState === 2 && ferrate.charge === -4, "hexacyanidoferrate(II) charge is 4-");
check(iupacName(ferrate!) === "potassium hexacyanidoferrate(II)", `name ${iupacName(ferrate!)}`);
const reversed = formulaFromIupac("Name the complex potassium hexacyanidoferrate(II).");
const reversedComplex = reversed ? parseComplex(reversed) : null;
check(reversedComplex?.metal.symbol === "Fe" && reversedComplex.coordinationNumber === 6 && reversedComplex.oxidationState === 2, `reverse parse ${reversed}`);

const roundTrip = formulaFromIupac(iupacName(hexammine!)!);
const roundComplex = roundTrip ? parseComplex(roundTrip) : null;
check(roundComplex?.metal.symbol === "Co" && roundComplex.oxidationState === 3 && roundComplex.coordinationNumber === 6, `hexammine round trip ${roundTrip}`);

const board = "Werner's theory for [Co(NH3)6]Cl3. State primary and secondary valence.";
const drawn = labels(board);
check(drawn.includes("primary 3") && drawn.includes("secondary 6"), `Werner labels ${drawn.join(", ")}`);
check(synthesizeFamilyScene({ question: board })?.family === "chem_coordination", "Werner stays on the coordination family");

const application = "Nickel is detected with dimethylglyoxime in qualitative analysis.";
const applicationLabels = labels(application);
check(applicationLabels.includes("Ni-DMG") && applicationLabels.includes("no yield") && applicationLabels.includes("red ppt"), `DMG labels ${applicationLabels.join(", ")}`);

const site = synthesizeFamilyScene({ question: "Draw the active site of haemoglobin." });
check(site === null, "haemoglobin does not grow an invented active site");

const sulfato = parseComplex("[Co(NH3)5SO4]Br");
check(sulfato !== null && sulfato.oxidationState === 3 && sulfato.coordinationNumber === 6, "sulfato complex oxidation state");
check(synthesizeFamilyScene({ question: "Calculate the CFSE of [Co(NH3)5SO4]Br." }) === null, "an unranked sulfato ligand does not grow a spin diagram");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("verify-c12-coordination: ok");
