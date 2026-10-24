/** Source certificates for the native, formula-computed VSEPR shape graph.
 *
 * This is deliberately narrower than a chemistry-family exemption. A label
 * earns authority only on the complete graph regenerated from the actual
 * question, after each relevant planner scalar has been checked by chemical
 * role and species. In particular, a layout angle is never a measured angle.
 */
import type { TurnPlanQuantityV3, TurnPlanV3 } from "../contracts/contractsV3";
import { displayedSceneQuantityTexts } from "../contracts/contractsV3";
import { compileSceneDocument } from "../compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import type { SceneDocument, SceneIssue } from "../types";
import { parseFormula } from "./formula";
import { ELEMENTS, elementBySymbol, valenceElectrons } from "./elements";
import { buildVseprScene, isVseprStem, VSEPR_FAMILY, vseprSpecies, type VseprResult } from "./vsepr";
import {
  countUnit, declarationText, declaredFormulas, equalScalar, formulaKey, graphMatches, mentionedElements,
  type ChemistrySourceCertification,
} from "./sourceEvidenceShared";
import { chargeMarkersCarried } from "./chargeMarker";
import { certifyLewisSourceDocument } from "./lewisSourceEvidence";
import { certifyPeriodicSourceDocument } from "./periodicSourceEvidence";

export type VseprSourceCertification =
  | { status: "not_applicable" }
  | { status: "rejected"; issues: SceneIssue[] }
  | { status: "certified"; texts: readonly string[] };

type Role = "total_valence" | "valence" | "steric" | "lone_pairs" | "bond_pairs" | "bonded_atoms" | "angle";
const ROLES: ReadonlyArray<[Role, RegExp]> = [
  ["total_valence", /\btotal\s+(?:number\s+of\s+)?valence\b|\bvalence\s+electrons?\s+(?:in\s+)?total\b/i],
  ["valence", /\bvalence(?:\s+electrons?)?\b|\bouter[- ]shell\s+electrons?\b/i],
  ["steric", /\bsteric(?:\s+number)?\b|\belectron\s+domains?\b/i],
  ["lone_pairs", /\blone[- ]pairs?\b|\bnon[- ]bonding\s+pairs?\b/i],
  ["bond_pairs", /\bbond(?:ing)?[- ]pairs?\b/i],
  // "H atoms bonded", "bonded atoms": the atoms sigma-bonded to the centre.
  ["bonded_atoms", /\batoms?\b|\bligands?\b/i],
  ["angle", /\bbond\s+angle\b|\bangle\b|[θϑ]/i],
];

/** Context words never compete with a named count: "lone pairs on the N atom"
 * is a lone-pair count, and a total is not also a per-atom valence. */
function rolesIn(text: string): Role[] {
  const roles = ROLES.filter(([, expression]) => expression.test(text)).map(([role]) => role);
  const named = roles.length > 1 ? roles.filter((role) => role !== "bonded_atoms") : roles;
  return named.includes("total_valence") ? named.filter((role) => role !== "valence") : named;
}

/** A symbol names the claimed role; explanatory arithmetic may mention other
 * roles on the RHS. Without such a name, only one declared role is accepted.
 */
function declaredRole(quantity: TurnPlanQuantityV3): Role | null {
  const symbolRoles = rolesIn(declarationText(quantity.symbol));
  const sourceText = declarationText(quantity.sourceText ?? "");
  const sourceRoles = rolesIn(sourceText);
  if (symbolRoles.length === 1) {
    const declaredSourceRoles = ROLES.filter(([, expression]) =>
      new RegExp(`^(?:the\\s+)?(?:${expression.source})`, "i").test(sourceText)).map(([role]) => role);
    if (declaredSourceRoles.length === 1 && declaredSourceRoles[0] !== symbolRoles[0]) return null;
    return symbolRoles[0]!;
  }
  if (symbolRoles.length > 1) return null;
  return sourceRoles.length === 1 ? sourceRoles[0]! : null;
}

function compatibleUnit(quantity: TurnPlanQuantityV3, role: Role): boolean {
  const unit = (quantity.unit ?? "").trim().toLowerCase();
  if (role === "angle") return ["°", "deg", "degree", "degrees"].includes(unit);
  if (role === "valence" || role === "total_valence") return countUnit(quantity, ["electron", "electrons"]);
  if (role === "steric") return countUnit(quantity, ["domain", "domains"]);
  if (role === "bonded_atoms") return countUnit(quantity, ["atom", "atoms", "ligand", "ligands"]);
  return countUnit(quantity, ["pair", "pairs"]);
}

/** Valence electrons the whole species holds: atoms' valence shells less the charge. */
function totalValence(result: VseprResult): number | null {
  const parsed = parseFormula(result.formula);
  return parsed ? parsed.atoms.reduce((sum, atom) => sum + atom.count * valenceElectrons(atom.element), 0) - parsed.charge : null;
}

/** Atoms bonded to the centre. A named terminal element counts only its own
 * ligands; without the word "bond" the count must also be that element's
 * formula count, so "3 I atoms" in I3- (two bonded) is not read as either.
 */
function bondedAtomsMatch(quantity: TurnPlanQuantityV3, result: VseprResult, declarations: readonly string[]): boolean {
  const atoms = parseFormula(result.formula)?.atoms ?? [];
  const mentioned = [...new Set(declarations.flatMap((text) => mentionedElements(text, ELEMENTS)))];
  if (mentioned.some((element) => !atoms.some((atom) => atom.element === element))) return false;
  if (result.ligands.some((ligand) => elementBySymbol(ligand.symbol) === null)) return false;
  const bonded = declarations.some((text) => /\bbond/i.test(declarationText(text)));
  const terminal = mentioned.filter((element) => element !== result.central);
  if (terminal.length > 1) return false;
  if (terminal.length === 0) return bonded && equalScalar(quantity.value, result.bondPairs);
  const element = terminal[0]!;
  const ligandCount = result.ligands.filter((ligand) => ligand.symbol === element.symbol).reduce((sum, ligand) => sum + ligand.count, 0);
  const formulaCount = atoms.find((atom) => atom.element === element)?.count ?? 0;
  if (!bonded && ligandCount !== formulaCount) return false;
  return ligandCount > 0 && equalScalar(quantity.value, ligandCount);
}

/** Each declaration must identify its target independently. A sourceText that
 * names another molecule/atom cannot borrow the symbol's otherwise valid ID.
 * A declaration naming no species binds only when the source has one.
 */
function quantityMatches(quantity: TurnPlanQuantityV3, role: Role, species: readonly VseprResult[]): boolean {
  if (!compatibleUnit(quantity, role)) return false;
  const declarations = [quantity.symbol, quantity.sourceText ?? ""];
  const knownKeys = new Set(species.map((result) => formulaKey(result.formula)));
  const formulaKeys = declarations.map(declaredFormulas);
  if (formulaKeys.some((keys) => [...keys].some((key) => !knownKeys.has(key)))) return false;
  const formulaTargets = formulaKeys.map((keys) => species.filter((result) => keys.has(formulaKey(result.formula))));
  if (formulaTargets.some((targets) => targets.length > 1)) return false;
  const formulaTarget = formulaTargets.flat()[0];
  if (formulaTarget && formulaTargets.flat().some((result) => result !== formulaTarget)) return false;
  const sole = species.length === 1 ? species[0]! : undefined;
  if (role === "bonded_atoms" || role === "total_valence") {
    const result = formulaTarget ?? sole;
    if (!result) return false;
    if (role === "bonded_atoms") return bondedAtomsMatch(quantity, result, declarations);
    const mentioned = declarations.flatMap((text) => mentionedElements(text, ELEMENTS));
    const atoms = parseFormula(result.formula)?.atoms ?? [];
    if (mentioned.some((element) => !atoms.some((atom) => atom.element === element))) return false;
    const total = totalValence(result);
    return total !== null && equalScalar(quantity.value, total);
  }
  const elements = [...new Map(species.flatMap((result) => parseFormula(result.formula)?.atoms ?? [])
    .map(({ element }) => [element.symbol, element])).values()];
  const atomTargets = declarations.map((text) => mentionedElements(text, ELEMENTS));
  if (atomTargets.some((targets) => targets.some((element) => !elements.includes(element)))) return false;
  if (atomTargets.some((targets) => targets.length > 1)) return false;
  const atomTarget = atomTargets.flat()[0];
  if (atomTarget && atomTargets.flat().some((element) => element !== atomTarget)) return false;
  if (role === "valence") {
    const valenceTargets = declarations.map((_, index) => atomTargets[index]![0] ?? formulaTargets[index]![0]?.central).filter((atom) => atom !== undefined);
    const atom = valenceTargets[0];
    if (!atom || valenceTargets.some((target) => target !== atom)) return false;
    if (formulaTargets.flat().some((result) => !parseFormula(result.formula)?.atoms.some((entry) => entry.symbol === atom.symbol))) return false;
    return equalScalar(quantity.value, valenceElectrons(atom));
  }
  const targets = formulaTarget ? [formulaTarget] : atomTarget
    ? species.filter((result) => result.central.symbol === atomTarget.symbol) : sole ? [sole] : [];
  if (targets.length !== 1) return false;
  const result = targets[0]!;
  if (atomTarget && atomTarget.symbol !== result.central.symbol) return false;
  const expected = role === "steric" ? result.stericNumber
    : role === "lone_pairs" ? result.lonePairs - (result.unpairedElectron ? 1 : 0)
    : role === "bond_pairs" ? result.bondPairs
    // A bound such as <90° proves no exact scalar, and drawnAngle is layout.
    : result.bondAngle && /^\d+(?:\.\d+)?°$/.test(result.bondAngle) ? Number.parseFloat(result.bondAngle) : null;
  return expected !== null && equalScalar(quantity.value, expected);
}

function planIssues(plan: TurnPlanV3, species: readonly VseprResult[]): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const [kind, quantities] of [["givens", plan.givens], ["derived", plan.derived]] as const) {
    quantities.forEach((quantity, index) => {
      const role = declaredRole(quantity);
      // Unused, unrelated givens retain the normal plan audit. Unknown derived
      // numeric claims fail closed: they could be stale chemistry narration.
      const namesRole = ROLES.some(([, expression]) => expression.test(declarationText(quantity.symbol))
        || expression.test(declarationText(quantity.sourceText ?? "")));
      if (!role && !namesRole && kind === "givens" && !/^(?:°|deg|degrees?|electrons?|pairs?|domains?|atoms?)$/i.test(quantity.unit ?? "")) return;
      if (role && quantityMatches(quantity, role, species)) return;
      issues.push({ code: "vsepr_plan_fact_unverified", severity: "fatal", path: `turnPlan.${kind}[${index}]`,
        message: "VSEPR plan scalar lacks an unambiguous, matching species-and-role source fact" });
    });
  }
  return issues;
}

/** Certify only the existing native molecular-shape graph. Dipole/Fajan
 * scenes sharing the family name retain their existing admission path.
 * Unknown/ambiguous derived scalar roles intentionally decline this slice.
 */
export function certifyVseprSourceDocument(document: SceneDocument, question: string, plan: TurnPlanV3 | null): VseprSourceCertification {
  // An untrusted candidate cannot opt out by stripping its provenance. Reuse
  // the existing family's cue on the actual question, then regenerate its
  // graph. Ordinary physics stems do not become chemistry from formula alone.
  const sourceApplies = isVseprStem(question);
  const claimsFamily = document.source.chemistryFamily === VSEPR_FAMILY || document.source.archetype === VSEPR_FAMILY;
  if (!sourceApplies && !claimsFamily) return { status: "not_applicable" };
  const raw = sourceApplies ? buildVseprScene(question, [], false) : null;
  const isShape = (scene: SceneDocument | null) => scene?.entities.some((entity) => entity.role === "molecular shape") === true;
  if (!isShape(raw) && !isShape(document)) return { status: "not_applicable" };
  const reject = (message: string): VseprSourceCertification => ({ status: "rejected", issues: [{
    code: "vsepr_source_graph_mismatch", severity: "fatal", message,
  }] });
  if (!raw || !isShape(raw)) return reject("actual source does not regenerate this native VSEPR shape graph");
  const issues = plan ? planIssues(plan, vseprSpecies(question)) : [];
  if (issues.length) return { status: "rejected", issues };
  const fresh = validateSceneDocument(pruneDeadSceneEntities(raw as unknown as Record<string, unknown>)).document;
  const submitted = validateSceneDocument(document).document;
  if (!fresh || !submitted || !graphMatches(submitted, fresh, plan)) return reject("native VSEPR graph differs from its regenerated source evidence");
  const compiled = compileSceneDocument(fresh);
  if (!compiled.ok || !compiled.renderScene) return reject("regenerated VSEPR graph does not compile cleanly");
  return { status: "certified", texts: displayedSceneQuantityTexts(fresh) };
}

/** Every native chemistry source certificate, in one place for save admission:
 * the VSEPR shape graph, the single-species Lewis graph, and the periodic
 * trend graph read from the element table. A certificate regenerates the
 * whole figure from the question and checks every role-bearing plan scalar
 * against that source; a contradiction rejects the figure. A question that
 * writes a charge no regenerated species carries earns no certificate.
 */
export function certifyChemistrySourceDocument(document: SceneDocument, question: string, plan: TurnPlanV3 | null): ChemistrySourceCertification {
  // A regenerated figure is only the builder's own reading of the stem, and
  // some builders read a spaced or sign first charge (SO3 2-, NO2 -, O2+1) as
  // the neutral species. Every charge the question writes must be on a
  // regenerated species, or the figure keeps the generic audit.
  const vsepr = certifyVseprSourceDocument(document, question, plan);
  if (vsepr.status === "rejected") return vsepr;
  if (vsepr.status === "certified") {
    if (!chargeMarkersCarried(question, vseprSpecies(question).map((species) => species.formula))) return { status: "not_applicable" };
    return { status: "certified", texts: vsepr.texts, quantities: [] };
  }
  const lewis = certifyLewisSourceDocument(document, question, plan);
  if (lewis.status !== "not_applicable") return lewis;
  const periodic = certifyPeriodicSourceDocument(document, question, plan);
  // A periodic trend graph plots neutral elements only.
  if (periodic.status === "certified" && !chargeMarkersCarried(question, [])) return { status: "not_applicable" };
  return periodic;
}
