/**
 * p-Block connectivity. Expected counts are written here from the NCERT
 * structures, then checked on the compiled document. The builder's caption
 * is not the oracle.
 */
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { buildPBlockScene } from "../../src/chemistry/pBlock";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function roles(question: string): string[] {
  const document = buildPBlockScene(question, [], false);
  if (!document) return [];
  return document.entities.map((entity) => entity.role);
}

function labels(question: string): string[] {
  const scene = synthesizeFamilyScene({ question });
  const primitives = scene?.renderScene?.primitives ?? [];
  return primitives.filter((primitive) => primitive.kind === "label" && primitive.text).map((primitive) => primitive.text!);
}

const diborane = "Draw the structure of diborane, B2H6, including the bridging hydrogens.";
const diboraneRoles = roles(diborane);
check(diboraneRoles.filter((role) => role === "3c-2e bridge").length === 4, "diborane has four bridge links, two hydrogens to two borons");
check(diboraneRoles.filter((role) => role === "terminal B-H").length === 4, "diborane has four terminal B-H bonds");
check(!diboraneRoles.some((role) => role === "B-B"), "diborane has no direct B-B bond");
check(synthesizeFamilyScene({ question: diborane })?.family === "chem_pblock", "diborane stays off the one-centre VSEPR family");

const phosphorous = "How many acidic hydrogens does phosphorous acid H3PO3 have? Show the P-H bond.";
const phosphorousRoles = roles(phosphorous);
check(phosphorousRoles.filter((role) => role === "P-H").length === 1, "H3PO3 has one direct P-H");
check(phosphorousRoles.filter((role) => role === "O-H").length === 2, "H3PO3 has two acidic O-H");
check(labels(phosphorous).includes("2 acidic H"), "the board says two acidic hydrogens");
check(!labels(phosphorous).includes("3 acidic H"), "H3PO3 is not given three acidic hydrogens");

const phosphoric = "Draw phosphoric acid H3PO4 and count the acidic hydrogens.";
check(roles(phosphoric).filter((role) => role === "O-H").length === 3, "H3PO4 has three O-H");
check(roles(phosphoric).filter((role) => role === "P-H").length === 0, "H3PO4 has no P-H");

const peroxo = "Draw peroxodisulphuric acid H2S2O8 and show the peroxo bond.";
check(roles(peroxo).filter((role) => role === "peroxo O-O").length === 1, "H2S2O8 has one peroxo bond");
check(!roles(peroxo).some((role) => role === "S-S"), "the sulphur atoms are not directly bonded");

const borax = "Draw the borax anion and state how many boron atoms are tetrahedral.";
const boraxRoles = roles(borax);
check(boraxRoles.filter((role) => role === "B-OH").length === 4, "borax anion has four terminal OH");
check(boraxRoles.filter((role) => role === "bridge O").length === 10, "five bridging oxygens give ten B-O links");

const xenon = "The number of lone pairs on Xe in XeF2 and the shape of the molecule are:";
check(synthesizeFamilyScene({ question: xenon })?.family === "chem_vsepr", "XeF2 stays a one-centre VSEPR shape");

const medium = "The reaction is carried out in dilute sulphuric acid H2SO4.";
check(synthesizeFamilyScene({ question: medium })?.family !== "chem_pblock", "sulphuric acid as a medium is not a structure figure");

const zeolite = "Draw the structure of a zeolite.";
check(buildPBlockScene(zeolite, [], false) === null, "an unnamed zeolite framework is not invented");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("verify-c10-pblock: ok");
