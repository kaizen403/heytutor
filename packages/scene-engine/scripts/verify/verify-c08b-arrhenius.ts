/**
 * Arrhenius temperature pair, log10 slope, and collision requirements.
 * Ea = ln(3) * 8.314 / (1/290 - 1/300) is computed here.
 */
import { compileSceneDocument } from "../../src/compile/compiler";
import { buildArrheniusCollisionScene, claimsArrheniusCollision } from "../../src/chemistry/arrheniusCollision";

const failures: string[] = [];
function check(cond: boolean, message: string): void {
  if (!cond) failures.push(message);
}

const eaJ = Math.log(3) * 8.314 / (1 / 290 - 1 / 300);
const eaKj = eaJ / 1000;
check(eaKj > 79 && eaKj < 80, `Ea in kJ/mol is ${eaKj}`);

function labelsOf(question: string): string[] | null {
  check(claimsArrheniusCollision(question), `not claimed: ${question.slice(0, 64)}`);
  const document = buildArrheniusCollisionScene(question, [], false);
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
  check(labels?.some((label) => label.includes(text)) === true, `missing ${text}; got ${labels?.join(" | ")}`);
}

const pair = "Find the activation energy when the rate constant triples from 290 K to 300 K. R = 8.314 J/mol/K. Plot ln k versus 1/T.";
const pairLabels = labelsOf(pair);
has(pairLabels, "slope=-Ea/R");
has(pairLabels, "basis ln");
has(pairLabels, `Ea=${eaKj.toPrecision(3)}`);

const log10 = "Sketch log10 k versus 1/T. The slope is -Ea/(2.303 R). Do not invent an activation energy. The figure is schematic.";
const logLabels = labelsOf(log10);
has(logLabels, "slope=-Ea/2.303R");
has(logLabels, "basis log10");
has(logLabels, "schematic");

const collision = "Collision theory for bimolecular gases A and B needs both partners, a favourable orientation, and a threshold energy. Not every collision reacts. Do not calculate a rate.";
const collisionLabels = labelsOf(collision);
has(collisionLabels, "A and B");
has(collisionLabels, "orient");
has(collisionLabels, "threshold");
has(collisionLabels, "not all react");
has(collisionLabels, "schematic");
const collisionDocument = buildArrheniusCollisionScene(collision, [], false);
const collisionBlob = JSON.stringify(collisionDocument);
check(collisionDocument !== null && !collisionBlob.includes('"id":"axes"'), "a collision sketch is not an unlabelled graph");
check(!/"bond"/i.test(collisionBlob), "the two partners are not drawn as an existing bond");
check(collisionBlob.includes("A approaching") && collisionBlob.includes("B approaching"), "both partners are shown approaching across a gap");

const celsius = "Find the activation energy from 25 celsius to 35 celsius if the rate constant triples. Plot ln k versus 1/T.";
check(claimsArrheniusCollision(celsius), "celsius pair is claimed");
check(buildArrheniusCollisionScene(celsius, [], false) === null, "celsius temperatures decline");

const doubling = "The rate of a reaction doubles when the temperature is raised from 300 K to 310 K. R = 8.314 J/mol/K. Find the activation energy.";
check(!claimsArrheniusCollision(doubling), "300 K to 310 K doubling stays on kinetics.ts");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`verify-c08b-arrhenius: ok Ea=${eaKj.toPrecision(4)} kJ/mol`);
