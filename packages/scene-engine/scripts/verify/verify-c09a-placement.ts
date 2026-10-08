/**
 * Placement from the element table: helium, chromium, and the modern law.
 * Expected groups and blocks are read from elements.ts, not from the builder.
 */
import { compileSceneDocument } from "../../src/compile/compiler";
import { elementBySymbol } from "../../src/chemistry/elements";
import { buildPeriodicPlacementScene, claimsPeriodicPlacement } from "../../src/chemistry/periodicPlacement";

const failures: string[] = [];
function check(cond: boolean, message: string): void {
  if (!cond) failures.push(message);
}

const he = elementBySymbol("He");
const cr = elementBySymbol("Cr");
const cu = elementBySymbol("Cu");
check(he?.group === 18 && he.block === "s" && he.period === 1 && he.z === 2, "helium table row");
check(cr?.block === "d" && cr.group === 6 && cr.z === 24, "chromium table row");
check(cu?.block === "d" && cu.group === 11 && cu.z === 29, "copper table row");

function labelsOf(question: string): string[] | null {
  check(claimsPeriodicPlacement(question), `not claimed: ${question.slice(0, 64)}`);
  const document = buildPeriodicPlacementScene(question, [], false);
  if (!document) {
    check(false, `drew nothing: ${question.slice(0, 64)}`);
    return null;
  }
  const compiled = compileSceneDocument(document);
  check(compiled.ok, `compile failed: ${question.slice(0, 48)}`);
  if (!compiled.ok || !compiled.renderScene) return null;
  return compiled.renderScene.primitives.flatMap((primitive) =>
    primitive.kind === "label" && primitive.text ? [primitive.text] : [],
  );
}

function has(labels: string[] | null, text: string): void {
  check(labels?.includes(text) === true, `missing ${text}; got ${labels?.join(" | ")}`);
}

const helium = "Where is helium placed? Give its block, group, period, and configuration 1s2.";
const heliumLabels = labelsOf(helium);
has(heliumLabels, "He grp 18");
has(heliumLabels, "block s");
has(heliumLabels, "period 1");
has(heliumLabels, "Z=2");

const chromium = "Chromium is written 4s1 3d5. Classify its block. Do not classify only by the last configuration term.";
const chromiumLabels = labelsOf(chromium);
has(chromiumLabels, "Cr block d");

const law = "State the modern periodic law. Mendeleev ordered by atomic mass. The modern law orders by atomic number, not mass.";
const lawLabels = labelsOf(law);
has(lawLabels, "by Z");
has(lawLabels, "not mass");

const fBlock = "An f-block element is not given a group number.";
const fLabels = labelsOf(fBlock);
has(fLabels, "f not group");

const mass = "The modern periodic law is atomic mass order.";
check(claimsPeriodicPlacement(mass), "wrong modern law is claimed");
check(buildPeriodicPlacementScene(mass, [], false) === null, "mass as the modern law declines");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("verify-c09a-placement: ok");
