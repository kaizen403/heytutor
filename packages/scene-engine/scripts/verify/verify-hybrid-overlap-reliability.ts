import assert from "node:assert/strict";
import { compileSceneDocument, synthesizeFamilyScene } from "../../src/index";
import { buildOrbitalScene } from "../../src/chemistry/orbitalBox";

// Authored analogues; no production text or identifiers.
for (const question of [
  "Describe bonding between an sp^2 hybridized nitrogen atom and an sp^2 hybridized carbon atom.",
  "Describe bonding between an sp² hybridised C atom and an sp² hybridised N atom.",
  "Describe bonds between N(sp^2) and C(sp^2).",
]) {
  const document = buildOrbitalScene(question, [], true);
  assert(document, "explicit two-center hybrid orbitals must not fall through the chemistry lane");
  assert.equal(document.source.question, question);
  const compiled = compileSceneDocument(document);
  assert.equal(compiled.report.valid, true, JSON.stringify(compiled.report.issues));
  const labels = document.entities.map(entity => entity.label ?? "").join(" ");
  assert.match(labels, /sigma/i);
  assert.match(labels, /possible pi/i, "source does not establish an actual pi bond");
  assert.match(labels, /not to scale/i);
  const family = synthesizeFamilyScene({ question });
  assert(family?.validationReport.valid, "real family selection must retain the independently compiled figure");
  assert.equal(family.family, "chem_orbital");
}
for (const question of [
  "Describe bonding between an sp3 hybridized C atom and an sp3 hybridized N atom.",
  "Describe bonding between an sp hybridized C atom and an sp hybridized N atom.",
]) {
  const document = buildOrbitalScene(question, [], true);
  assert(document);
  assert(compileSceneDocument(document).report.valid);
  if (question.includes("sp3")) assert.doesNotMatch(JSON.stringify(document), /possible pi/i);
}
for (const question of [
  "Draw the pi-only bond between C(sp3) and N(sp3).",
  "Draw a π bond between C(sp2) and N(sp3).",
  "Show bonding through side-on overlap between C(sp3) and N(sp2).",
  "Show bonding through side on overlap between C(sp2) and N(sp3).",
  "Compare hybridization of carbon and nitrogen.",
  "An sp2 hybridized C atom bonds to an atom of unspecified hybridization.",
  "Describe sp3d hybridization in a coordination complex.",
  "An sp2 hybridized C atom is bonded to an sp2 hybridized N atom and an sp2 hybridized O atom.",
  "An atom is not sp2 hybridized carbon; compare bonds to sp2 hybridized nitrogen.",
  "Compare bonding between C(sp2) and N(sp2) with perpendicular p orbitals.",
  "Explain why no bonding occurs between an sp2 hybridized carbon atom and an sp2 hybridized nitrogen atom.",
  "An sp2 hybridized carbon atom and an sp2 hybridized nitrogen atom do not form a bond.",
  "Describe bonding between an sp2 hybridized carbon atom and an sp2 hybridized nitrogen atom whose p orbitals are not parallel.",
]) assert.equal(buildOrbitalScene(question, [], true), null, "incomplete, unsupported or ambiguous source must decline");
console.log("PASS: source-bound two-center hybrid overlap, ordinary compile/family path, and refusal controls");
