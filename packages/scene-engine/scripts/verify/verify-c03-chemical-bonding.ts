/**
 * Chemical Bonding and Molecular Structure (chemistry unit 3).
 *
 * Expected counts below are written from valence, VSEPR class and the NCERT
 * MO filling order. They are not produced by calling the solver and pasting
 * its output back in.
 */
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import {
  dipoleAccount,
  fajanFactors,
  ionicAccount,
  metallicAccount,
  parseExamBondLine,
  type DipoleInput,
} from "../../src/chemistry/bondingFigures";
import { lewisStructure, buildLewisScene } from "../../src/chemistry/lewis";
import { buildMoScene, moConfiguration } from "../../src/chemistry/moDiagram";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { buildVseprScene, vseprGeometry } from "../../src/chemistry/vsepr";
import type { SceneDocument } from "../../src/types";

const failures: string[] = [];
function check(cond: boolean, message: string): void {
  if (!cond) failures.push(message);
}

const Z: Record<string, number> = { H: 1, He: 2, Li: 3, Be: 4, B: 5, C: 6, N: 7, O: 8, F: 9, Ne: 10, Na: 11, Cl: 17, S: 16, P: 15, Xe: 54 };
const VALENCE: Record<string, number> = { H: 1, B: 3, C: 4, N: 5, O: 6, F: 7, Na: 1, Cl: 7, S: 6, P: 5, Xe: 8 };

function valenceTotal(parts: readonly [string, number][], charge: number): number {
  return parts.reduce((sum, [symbol, count]) => sum + VALENCE[symbol]! * count, 0) - charge;
}

interface Compiled {
  labels: string[];
  xs: number[];
  ys: number[];
  tier: string | null;
  family: string | null;
  reveal: number;
  focusIds: string[];
}

function compileDoc(document: SceneDocument | null): Compiled | null {
  if (!document) return null;
  const validated = validateSceneDocument(document);
  if (validated.report.issues.some((issue) => issue.severity === "fatal")) return null;
  const result = compileSceneDocument(document);
  if (!result.ok || !result.renderScene) return null;
  const labels = result.renderScene.primitives.filter((primitive) => primitive.text).map((primitive) => primitive.text!);
  const xs = result.renderScene.primitives.flatMap((primitive) => primitive.points.map((point) => point.x));
  const ys = result.renderScene.primitives.flatMap((primitive) => primitive.points.map((point) => point.y));
  const focusIds = result.renderScene.timeline.filter((action) => action.action === "focus" || action.action === "reveal").map((action) => action.targetId);
  return {
    labels,
    xs,
    ys,
    tier: null,
    family: typeof document.source.chemistryFamily === "string" ? document.source.chemistryFamily : null,
    reveal: result.renderScene.revealGroups.length,
    focusIds,
  };
}

function zoneOk(drawn: Compiled | null): boolean {
  if (!drawn || drawn.xs.length === 0) return false;
  return drawn.xs.every((x) => x >= 400 && x <= 1160) && drawn.ys.every((y) => y >= 0 && y <= 700);
}

const SMOKE = "Using VSEPR theory, predict the shape and the approximate bond angles of SF4, ClF3 and XeF2.";

const VSEPR_EXPECT: readonly { formula: string; bonds: number; lone: number; steric: number; electron: string; shape: string; hybrid: string; claim: "ideal" | "quoted" | "inequality" | "none" }[] = [
  { formula: "BeCl2", bonds: 2, lone: 0, steric: 2, electron: "linear", shape: "linear", hybrid: "sp", claim: "ideal" },
  { formula: "BF3", bonds: 3, lone: 0, steric: 3, electron: "trigonal planar", shape: "trigonal planar", hybrid: "sp2", claim: "ideal" },
  { formula: "CH4", bonds: 4, lone: 0, steric: 4, electron: "tetrahedral", shape: "tetrahedral", hybrid: "sp3", claim: "ideal" },
  { formula: "NH3", bonds: 3, lone: 1, steric: 4, electron: "tetrahedral", shape: "trigonal pyramidal", hybrid: "sp3", claim: "quoted" },
  { formula: "H2O", bonds: 2, lone: 2, steric: 4, electron: "tetrahedral", shape: "bent", hybrid: "sp3", claim: "quoted" },
  { formula: "PCl5", bonds: 5, lone: 0, steric: 5, electron: "trigonal bipyramidal", shape: "trigonal bipyramidal", hybrid: "sp3d", claim: "ideal" },
  { formula: "SF4", bonds: 4, lone: 1, steric: 5, electron: "trigonal bipyramidal", shape: "see-saw", hybrid: "sp3d", claim: "inequality" },
  { formula: "ClF3", bonds: 3, lone: 2, steric: 5, electron: "trigonal bipyramidal", shape: "T-shaped", hybrid: "sp3d", claim: "quoted" },
  { formula: "XeF2", bonds: 2, lone: 3, steric: 5, electron: "trigonal bipyramidal", shape: "linear", hybrid: "sp3d", claim: "none" },
  { formula: "SF6", bonds: 6, lone: 0, steric: 6, electron: "octahedral", shape: "octahedral", hybrid: "sp3d2", claim: "ideal" },
  { formula: "BrF5", bonds: 5, lone: 1, steric: 6, electron: "octahedral", shape: "square pyramidal", hybrid: "sp3d2", claim: "inequality" },
  { formula: "XeF4", bonds: 4, lone: 2, steric: 6, electron: "octahedral", shape: "square planar", hybrid: "sp3d2", claim: "ideal" },
  { formula: "IF7", bonds: 7, lone: 0, steric: 7, electron: "pentagonal bipyramidal", shape: "pentagonal bipyramidal", hybrid: "sp3d3", claim: "none" },
];

for (const row of VSEPR_EXPECT) {
  const got = vseprGeometry(row.formula);
  check(got !== null, `vsepr ${row.formula} resolved`);
  if (!got) continue;
  check(got.bondPairs === row.bonds, `${row.formula} bond pairs ${got.bondPairs} vs ${row.bonds}`);
  check(got.lonePairs === row.lone, `${row.formula} lone pairs ${got.lonePairs} vs ${row.lone}`);
  check(got.stericNumber === row.steric, `${row.formula} steric ${got.stericNumber} vs ${row.steric}`);
  check(got.electronGeometry === row.electron, `${row.formula} electron geometry ${got.electronGeometry}`);
  check(got.shape === row.shape, `${row.formula} shape ${got.shape}`);
  check(got.hybridisation === row.hybrid, `${row.formula} hybrid ${got.hybridisation}`);
  check(got.bondPairs + got.lonePairs === got.stericNumber, `${row.formula} domains add`);
  if (row.claim === "none") check(got.bondAngle === null, `${row.formula} has no single angle`);
  if (row.claim === "ideal") check(got.bondAngle === "180°" || got.bondAngle === "120°" || got.bondAngle === "109.5°" || got.bondAngle === "90°", `${row.formula} ideal angle ${got.bondAngle}`);
  if (row.claim === "inequality") check(got.bondAngle?.startsWith("<") === true, `${row.formula} inequality ${got.bondAngle}`);
  if (row.claim === "quoted") check(got.bondAngle !== null && !got.bondAngle.startsWith("<") && !["180°", "120°", "109.5°", "90°"].includes(got.bondAngle), `${row.formula} quoted angle ${got.bondAngle}`);
}

const lonePairIons = ["[TeBr6]2-", "[BrF2]+", "SNF3", "[XeF3]-"].map((formula) => vseprGeometry(formula));
check(lonePairIons[0]?.lonePairs === 1 && lonePairIons[0].shape === "distorted octahedral" && lonePairIons[0].electronGeometry === "pentagonal bipyramidal", "TeBr6 2- has one lone pair");
check(lonePairIons[1]?.lonePairs === 2 && lonePairIons[1].shape === "bent" && lonePairIons[1].electronGeometry === "tetrahedral", "BrF2 + has two lone pairs");
check(lonePairIons[2]?.lonePairs === 0 && lonePairIons[2].shape === "tetrahedral", "SNF3 has no lone pair on S");
check(lonePairIons[3]?.lonePairs === 3 && lonePairIons[3].shape === "T-shaped" && lonePairIons[3].electronGeometry === "octahedral" && lonePairIons[3].bondAngle === "<90°", "XeF3 - is T-shaped with three lone pairs");
check(lonePairIons.reduce((sum, row) => sum + (row?.lonePairs ?? -10), 0) === 6, "the four central-atom lone pairs sum to 6");
const loneScene = compileDoc(buildVseprScene("Using VSEPR, find the lone pairs on the central atom of [TeBr6]2-, [BrF2]+, SNF3 and [XeF3]-.", [], false));
check(loneScene !== null && zoneOk(loneScene), "the four lone-pair species compile inside the diagram zone");

check(vseprGeometry("CH5") === null, "CH5 is not a VSEPR species");
check(vseprGeometry("CCl5") === null, "period-2 CCl5 cannot expand");
check(vseprGeometry("IF8") === null, "IF8 exceeds the domain table");
check(vseprGeometry("[Ni(CN)4]2-") === null, "a complex is not a VSEPR centre");
const cf4 = vseprGeometry("CF4");
const sf4 = vseprGeometry("SF4");
check(cf4?.shape === "tetrahedral" && sf4?.shape === "see-saw", "changing C for S changes the shape");

const smoke = synthesizeFamilyScene({ question: SMOKE });
check(smoke?.family === "chem_vsepr", `smoke family ${smoke?.family}`);
check(smoke?.tier === "qualitative_verified", `smoke tier ${smoke?.tier}`);
const smokeDrawn = compileDoc(smoke?.document ?? null);
check(smokeDrawn !== null, "smoke compiles");
check(zoneOk(smokeDrawn), "smoke ink stays inside x 400-1160 and y 0-700");
check(smokeDrawn?.reveal ? smokeDrawn.reveal > 0 : false, "smoke has reveal groups");
for (const label of ["SF_4", "ClF_3", "XeF_2", "see-saw", "T-shaped", "linear", "e: TBP", "inequality", "quoted"]) {
  check(smokeDrawn?.labels.includes(label) === true, `smoke label ${label}`);
}
check(smokeDrawn?.labels.includes("180°") !== true, "XeF2 does not print 180 as a measured angle");
check((smoke?.document.revealGroups ?? []).every((group) => group.entityIds.length > 0), "reveal groups name entities");

const ch4 = compileDoc(buildVseprScene("The shape of CH4 is", [], false));
check(ch4?.labels.includes("ideal") === true, "CH4 angle is marked ideal");
check(ch4?.labels.includes("109.5°") === true, "CH4 still shows the ideal number");
const ch4Doc = buildVseprScene("The shape of CH4 is", [], false);
const roles = ch4Doc?.entities.map((entity) => entity.role) ?? [];
check(roles.some((role) => role.includes("towards viewer")), "wedge means towards the viewer");
check(roles.some((role) => role.includes("away from viewer")), "dash means away from the viewer");

const h2o = compileDoc(buildVseprScene("The bond angle of H2O and its geometry are", [], false));
check(h2o?.labels.includes("quoted") === true && h2o.labels.includes("104.5°") === true, "water angle is a quoted value");
check(h2o?.labels.includes("e: tetrahedral") === true && h2o.labels.includes("bent") === true, "water separates electron geometry from shape");

function dipole(formula: string, central: string, centralEn: number | null, bonds: number, lone: number, ligand: string, en: number, count: number): DipoleInput {
  return { formula, label: formula, central, centralEn, bondPairs: bonds, lonePairs: lone, ligands: [{ symbol: ligand, en, count }] };
}
const dipoleExpect: readonly [DipoleInput, string][] = [
  [dipole("CH4", "C", 2.55, 4, 0, "H", 2.2, 4), "cancels"],
  [dipole("CO2", "C", 2.55, 2, 0, "O", 3.44, 2), "cancels"],
  [dipole("BF3", "B", 2.04, 3, 0, "F", 3.98, 3), "cancels"],
  [dipole("XeF4", "Xe", null, 4, 2, "F", 3.98, 4), "cancels"],
  [dipole("XeF2", "Xe", null, 2, 3, "F", 3.98, 2), "cancels"],
  [dipole("NH3", "N", 3.04, 3, 1, "H", 2.2, 3), "with lp"],
  [dipole("H2O", "O", 3.44, 2, 2, "H", 2.2, 2), "with lp"],
  [dipole("NF3", "N", 3.04, 3, 1, "F", 3.98, 3), "opposes lp"],
  [dipole("SF4", "S", 2.58, 4, 1, "F", 3.98, 4), "opposes lp"],
];
for (const [input, sense] of dipoleExpect) {
  const account = dipoleAccount(input);
  check(account?.sense === sense, `${input.formula} dipole ${account?.sense} vs ${sense}`);
  if (!account) continue;
  const flipped = dipoleAccount({ ...input, centralEn: input.centralEn, ligands: input.ligands.map((ligand) => ({ ...ligand, en: input.centralEn === null ? ligand.en : input.centralEn - (ligand.en - input.centralEn) })) });
  if (account.cancels) check(flipped?.cancels === true, `${input.formula} inversion keeps cancellation`);
}
const dipoleScene = compileDoc(buildVseprScene("Arrange NH3, NF3, H2O and CH4 in increasing order of dipole moment. Why does NF3 have a much smaller dipole moment than NH3 although both molecules are pyramidal?", [], false));
check(dipoleScene !== null && zoneOk(dipoleScene), "dipole scene compiles inside the board");
for (const label of ["cancels", "with lp", "opposes lp", "not measured"]) check(dipoleScene?.labels.includes(label) === true, `dipole label ${label}`);
check(dipoleScene?.labels.some((label) => /debye|\d+(\.\d+)?\s*D\b/i.test(label)) !== true, "no Debye value is drawn");

const fajanStem = "How many of the following factors affect the percent covalent character of an ionic bond? (A) Polarising power of the cation (B) Extent of distortion of the anion (C) Polarisability of the anion (D) Polarising power of the anion";
const factors = fajanFactors(fajanStem.toLowerCase());
check(factors.find((factor) => factor.label === "anion power")?.effect === "no", "anion polarising power is not a Fajan factor");
check(factors.filter((factor) => factor.effect === "yes").length === 3, "three listed factors increase covalent character");
const fajanScene = compileDoc(buildVseprScene(fajanStem, [], false));
check(fajanScene?.labels.includes("no") === true && fajanScene.labels.includes("no ionic pm") === true, "Fajan figure marks the reject and refuses an ionic radius");
const saltScene = compileDoc(buildVseprScene("Using Fajan's rule compare the covalent character of NaCl and MgCl2.", [], false));
check(saltScene?.labels.includes("charge only") === true, "salt comparison uses charge only");
check(saltScene?.labels.some((label) => /pm/.test(label)) !== true, "no picometre radius is printed");

const lewisExpect: readonly { formula: string; electrons: number; charge: number; sigma?: number; pi?: number; deficient?: boolean; expanded?: boolean }[] = [
  { formula: "CO2", electrons: valenceTotal([["C", 1], ["O", 2]], 0), charge: 0, sigma: 2, pi: 2 },
  { formula: "BF3", electrons: valenceTotal([["B", 1], ["F", 3]], 0), charge: 0, deficient: true },
  { formula: "PCl5", electrons: valenceTotal([["P", 1], ["Cl", 5]], 0), charge: 0, expanded: true },
  { formula: "SO4^(2-)", electrons: valenceTotal([["S", 1], ["O", 4]], -2), charge: -2 },
  { formula: "NO3-", electrons: valenceTotal([["N", 1], ["O", 3]], -1), charge: -1 },
  { formula: "NH4+", electrons: valenceTotal([["N", 1], ["H", 4]], 1), charge: 1 },
  { formula: "XeF4", electrons: valenceTotal([["Xe", 1], ["F", 4]], 0), charge: 0, expanded: true },
];
for (const row of lewisExpect) {
  const got = lewisStructure(row.formula);
  check(got !== null, `lewis ${row.formula}`);
  if (!got) continue;
  check(got.totalValenceElectrons === row.electrons, `${row.formula} valence ${got.totalValenceElectrons} vs ${row.electrons}`);
  const formal = got.atoms.reduce((sum, atom) => sum + atom.formalCharge, 0);
  check(formal === row.charge, `${row.formula} formal charges sum to ${formal}`);
  if (row.sigma !== undefined) check(got.sigmaBonds === row.sigma && got.piBonds === row.pi, `${row.formula} sigma/pi ${got.sigmaBonds}/${got.piBonds}`);
  if (row.deficient) check(got.electronDeficient === true, `${row.formula} is electron deficient`);
  if (row.expanded) check(got.expandedOctet === true, `${row.formula} expands the octet`);
}
const ozone = lewisStructure("O3");
check(ozone !== null && ozone.resonanceCount >= 2, "ozone has more than one resonance form");
if (ozone && ozone.resonanceForms.length >= 2) {
  const [first, second] = ozone.resonanceForms;
  const samePlaces = first!.atoms.every((atom, index) => atom.symbol === second!.atoms[index]?.symbol && atom.x === second!.atoms[index]?.x && atom.y === second!.atoms[index]?.y);
  const orders = (form: typeof first) => form!.bonds.map((bond) => `${bond.a}-${bond.b}:${bond.order}`).join(",");
  check(samePlaces, "ozone resonance keeps one skeleton");
  check(orders(first) !== orders(second), "ozone resonance changes bond orders");
  check(first!.atoms.reduce((sum, atom) => sum + atom.formalCharge, 0) === 0, "ozone formal charges sum to zero");
}
const co = lewisStructure("CO");
check(co?.atoms.find((atom) => atom.symbol === "C")?.formalCharge === -1, "CO carbon formal charge is -1");
check(co?.atoms.find((atom) => atom.symbol === "O")?.formalCharge === 1, "CO oxygen formal charge is +1");
check(lewisStructure("SO4")?.formula.charge !== -2, "SO4 without a charge is not sulphate");
check(lewisStructure("[Fe(CN)6]3-") === null, "a complex is not a Lewis octet drawing");
check(lewisStructure("NO3") === null, "neutral NO3 is not forced into the nitrate ion");

const ionic = ionicAccount("NaCl");
check(ionic?.cationCharge === 1 && ionic.anionCharge === -1 && ionic.electronsTransferred === 1, "NaCl transfers one electron");
check(ionicAccount("CaF2")?.electronsTransferred === 2 && ionicAccount("CaF2")?.anionCount === 2, "CaF2 transfers two electrons onto two fluorides");
check(ionicAccount("NaCl^+") === null, "a charged NaCl token is not the neutral salt");
check(ionicAccount("FeCl3") === null, "a d-block salt is not this ionic figure");
check(ionicAccount("BeCl2") === null, "BeCl2 stays covalent");
const ionicScene = compileDoc(buildLewisScene("Show the electron transfer in the formation of the ionic bond in NaCl.", [], false));
check(ionicScene !== null && zoneOk(ionicScene), "NaCl transfer compiles");
for (const label of ["Na", "Cl", "Na^(+)", "Cl^(-)", "e-", "neutral", "3s1", "3s2 3p5"]) check(ionicScene?.labels.includes(label) === true, `ionic label ${label}`);

const born = "Construct the Born Haber cycle for NaCl. Enthalpy of sublimation of Na = 108 kJ/mol, ionisation enthalpy of Na = 496 kJ/mol, bond dissociation enthalpy of Cl2 = 242 kJ/mol, electron gain enthalpy of Cl = −349 kJ/mol and enthalpy of formation of NaCl = −411 kJ/mol. Calculate the lattice enthalpy of NaCl.";
const upward = 108 + 496 + 242 / 2 + -349;
const lattice = -411 - upward;
check(lattice === -787, `independent lattice enthalpy ${lattice}`);
const thermo = buildThermoGraphScene(born, [], false);
const thermoU = thermo?.quantities.find((quantity) => quantity.id === "lattice_enthalpy");
check(thermoU?.value === lattice, `Born-Haber U ${thermoU?.value}`);
const thermoPath = synthesizeFamilyScene({ question: born });
check(thermoPath?.family === "chem_thermo", `lattice family ${thermoPath?.family}`);

const moZ = (head: string): [number, number, boolean] => {
  const hetero = head === "CO" ? ["C", "O"] : head === "NO" ? ["N", "O"] : null;
  if (hetero) return [Z[hetero[0]!]!, Z[hetero[1]!]!, false];
  const symbol = head.replace("2", "");
  return [Z[symbol]!, Z[symbol]!, symbol === "H" || symbol === "He"];
};
const MO_EXPECT: readonly { species: string; charge: number; bo: number; unpaired: number; order: string; config: string }[] = [
  { species: "H2", charge: 0, bo: 1, unpaired: 0, order: "period1", config: "σ1s^2" },
  { species: "H2+", charge: 1, bo: 0.5, unpaired: 1, order: "period1", config: "σ1s^1" },
  { species: "He2", charge: 0, bo: 0, unpaired: 0, order: "period1", config: "σ1s^2 σ*1s^2" },
  { species: "He2+", charge: 1, bo: 0.5, unpaired: 1, order: "period1", config: "σ1s^2 σ*1s^1" },
  { species: "Li2", charge: 0, bo: 1, unpaired: 0, order: "n2", config: "σ2s^2" },
  { species: "Be2", charge: 0, bo: 0, unpaired: 0, order: "n2", config: "σ2s^2 σ*2s^2" },
  { species: "B2", charge: 0, bo: 1, unpaired: 2, order: "n2", config: "σ2s^2 σ*2s^2 π2p^2" },
  { species: "C2", charge: 0, bo: 2, unpaired: 0, order: "n2", config: "σ2s^2 σ*2s^2 π2p^4" },
  { species: "N2", charge: 0, bo: 3, unpaired: 0, order: "n2", config: "σ2s^2 σ*2s^2 π2p^4 σ2p^2" },
  { species: "O2", charge: 0, bo: 2, unpaired: 2, order: "o2", config: "σ2s^2 σ*2s^2 σ2p^2 π2p^4 π*2p^2" },
  { species: "F2", charge: 0, bo: 1, unpaired: 0, order: "o2", config: "σ2s^2 σ*2s^2 σ2p^2 π2p^4 π*2p^4" },
  { species: "Ne2", charge: 0, bo: 0, unpaired: 0, order: "o2", config: "σ2s^2 σ*2s^2 σ2p^2 π2p^4 π*2p^4 σ*2p^2" },
  { species: "O2+", charge: 1, bo: 2.5, unpaired: 1, order: "o2", config: "σ2s^2 σ*2s^2 σ2p^2 π2p^4 π*2p^1" },
  { species: "O2-", charge: -1, bo: 1.5, unpaired: 1, order: "o2", config: "σ2s^2 σ*2s^2 σ2p^2 π2p^4 π*2p^3" },
  { species: "O2^(2-)", charge: -2, bo: 1, unpaired: 0, order: "o2", config: "σ2s^2 σ*2s^2 σ2p^2 π2p^4 π*2p^4" },
  { species: "N2+", charge: 1, bo: 2.5, unpaired: 1, order: "n2", config: "σ2s^2 σ*2s^2 π2p^4 σ2p^1" },
];
for (const row of MO_EXPECT) {
  const head = row.species.replace(/[+\-^(].*$/, "");
  const [z1, z2, period1] = moZ(head);
  const total = z1 + z2 - row.charge;
  const valence = period1 ? total : total - 4;
  const got = moConfiguration(row.species);
  check(got !== null, `mo ${row.species}`);
  if (!got) continue;
  check(got.totalElectrons === total, `${row.species} electrons ${got.totalElectrons} vs ${total}`);
  check(got.valenceElectrons === valence, `${row.species} valence ${got.valenceElectrons} vs ${valence}`);
  check(got.bondOrder === row.bo, `${row.species} bond order ${got.bondOrder} vs ${row.bo}`);
  check(got.unpairedElectrons === row.unpaired, `${row.species} unpaired ${got.unpairedElectrons} vs ${row.unpaired}`);
  check(got.order === row.order, `${row.species} order ${got.order}`);
  check(got.configuration === row.config, `${row.species} config ${got.configuration}`);
  const bonding = got.levels.filter((level) => level.kind === "bonding").reduce((sum, level) => sum + level.electrons, 0);
  const antibonding = got.levels.filter((level) => level.kind === "antibonding").reduce((sum, level) => sum + level.electrons, 0);
  check((bonding - antibonding) / 2 === row.bo, `${row.species} bond-order identity`);
  for (const level of got.levels) {
    check(level.electrons <= level.capacity && level.boxes.reduce((sum, box) => sum + box, 0) === level.electrons, `${row.species} ${level.name} Pauli`);
    check(level.boxes.every((box) => box <= 2), `${row.species} ${level.name} box capacity`);
    if (level.degeneracy === 2 && level.electrons === 2) check(level.boxes[0] === 1 && level.boxes[1] === 1, `${row.species} ${level.name} Hund`);
  }
}
const mixedOff = moConfiguration("C2", { mixing: "off" });
check(mixedOff?.order === "o2" && mixedOff.unpairedElectrons === 2 && mixedOff.bondOrder === 2, "C2 without mixing is paramagnetic with bond order 2");
check(moConfiguration("Cl2") === null && moConfiguration("O3") === null && moConfiguration("Na2") === null, "period-3 and polyatomic species are outside the MO table");
const o2Scene = compileDoc(buildMoScene("Draw the molecular orbital diagram of O2 and find its bond order and magnetic character.", [], false));
check(o2Scene !== null && zoneOk(o2Scene), "O2 diagram compiles");
check(o2Scene?.labels.includes("not measured") === true && o2Scene.labels.includes("BO = 2") === true, "O2 diagram marks spacing and bond order");
check(o2Scene?.labels.some((label) => /eV|kJ/.test(label)) !== true, "O2 diagram has no numeric energy");

const line = parseExamBondLine("How many sigma bonds and how many pi bonds are present in acrylonitrile, CH2=CH-C≡N? Which carbon-carbon bond in it is the shortest?");
check(line?.sigma === 6 && line.pi === 3 && line.shorterCarbonCarbon !== null, `acrylonitrile sigma/pi ${line?.sigma}/${line?.pi}`);
const lineScene = compileDoc(buildLewisScene("How many sigma bonds and how many pi bonds are present in acrylonitrile, CH2=CH-C≡N? Which carbon-carbon bond in it is the shortest?", [], false));
check(lineScene !== null && zoneOk(lineScene), "acrylonitrile compiles");
check(lineScene?.labels.includes("sigma 6") === true && lineScene.labels.includes("pi 3") === true && lineScene.labels.includes("higher order") === true && lineScene.labels.includes("not measured") === true, "acrylonitrile labels order, not a length");
const quoted = compileDoc(buildLewisScene("The C=C bond length in ethene is 134 pm and the C-C bond length in ethane is 154 pm. Compare CH2=CH2 and CH3-CH3.", [], false));
check(quoted?.labels.includes("134 pm") === true && quoted.labels.includes("154 pm") === true, "stated lengths are copied as quoted values");

const overlap = compileDoc(buildLewisScene("Describe the head-on and sideways overlap in ethene.", [], false));
check(overlap?.labels.includes("sigma") === true && overlap.labels.includes("pi") === true && overlap.labels.includes("sp^2") === true, "ethene overlap shows sigma, pi and sp2");
check(compileDoc(buildLewisScene("Describe the sideways overlap in methane.", [], false)) === null, "methane has no sideways overlap to draw");

const sea = metallicAccount("explain metallic bonding in sodium");
check(sea?.charge === 1 && sea.electrons === 3, "three sodium cations need three delocalised electrons");
const seaScene = compileDoc(buildLewisScene("Explain metallic bonding in sodium using the electron sea model.", [], false));
check(seaScene !== null && zoneOk(seaScene), "sodium sea compiles");
check(seaScene?.labels.includes("Na^(+)") === true && seaScene.labels.includes("e- sea") === true && seaScene.labels.includes("3 e-") === true && seaScene.labels.includes("neutral") === true, "sodium sea is neutral");
check(compileDoc(buildLewisScene("Explain metallic bonding in iron.", [], false)) === null, "a d-block metal is outside the elementary sea");

const hb = compileDoc(buildLewisScene("o-Nitrophenol is steam volatile but p-nitrophenol is not. Explain this difference in terms of intramolecular and intermolecular hydrogen bonding.", [], false));
check(hb !== null && zoneOk(hb), "nitrophenol hydrogen bonds compile");
check(hb?.labels.includes("intra") === true && hb.labels.includes("no intra") === true && hb.labels.includes("inter") === true, "ortho and para hydrogen bonds are distinguished");
check(hb?.labels.includes("+") === true && hb.labels.includes("-") === true, "nitro formal charges are marked");
const hf = compileDoc(buildLewisScene("Show the intermolecular hydrogen bond in hydrogen fluoride.", [], false));
check(hf?.labels.includes("inter") === true && hf.labels.includes("HF") === true, "HF hydrogen bond");
const ammonia = compileDoc(buildLewisScene("Show the intermolecular hydrogen bond in ammonia.", [], false));
check(ammonia?.labels.includes("NH_3") === true && ammonia.labels.includes("inter") === true, "ammonia hydrogen bond uses N");
check(compileDoc(buildLewisScene("Explain hydrogen bonding in methane.", [], false)) === null, "methane is not a hydrogen-bond donor");
check(compileDoc(buildLewisScene("Explain hydrogen bonding in HCl.", [], false)) === null, "chlorine is not the N/O/F acceptor used here");

const physics = synthesizeFamilyScene({ question: "Find the dipole moment of an electric dipole made of two point charges separated by 2a." });
check(physics?.family !== "chem_vsepr" && physics?.family !== "chem_lewis", `point-charge dipole stays out of chemistry (${physics?.family})`);
const orbital = synthesizeFamilyScene({ question: "Draw the shape of the d_z2 orbital." });
check(orbital?.family !== "chem_vsepr", `orbital shape is not VSEPR (${orbital?.family})`);

const lost = synthesizeFamilyScene({ question: "The shape of SF, according to VSEPR is" });
check(lost?.document === undefined || !(compileDoc(lost.document)?.labels ?? []).includes("SF_4"), "a lost subscript is not drawn as SF4");

if (failures.length > 0) {
  console.error(`C-03 chemical bonding: ${failures.length} failed`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("C-03 chemical bonding: all checks passed");
