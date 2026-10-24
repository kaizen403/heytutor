/** Source certificate for the native single-species Lewis structure graph.
 *
 * The figure's counts (sigma bonds, pi bonds, lone pairs) are computed from
 * the formula by `lewisStructure`, not read from the planner. A plan rarely
 * restates them under the figure's quantity ids, so the generic TurnPlan
 * audit refused every Lewis figure. This certificate regenerates the graph
 * from the question, requires the submitted document to be exactly that
 * graph, and checks every planner scalar and count claim that names a Lewis
 * role (valence electrons of an atom, total valence electrons, bonding and
 * lone pairs or electrons, sigma and pi bonds, formal charge, atom count)
 * against the regenerated structure by species and atom. A matching scalar
 * is certified, a contradicting one rejects the figure, and a numeric plan
 * value with an unknown role declines it.
 */
import type { TurnPlanQuantityV3, TurnPlanV3 } from "../contracts/contractsV3";
import { displayedSceneQuantityTexts } from "../contracts/contractsV3";
import { compileSceneDocument } from "../compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import type { SceneDocument, SceneIssue } from "../types";
import { ELEMENTS, valenceElectrons, type ElementRecord } from "./elements";
import { buildLewisScene, isLewisStem, LEWIS_FAMILY, stemSpecies, type LewisAtom, type LewisResult } from "./lewis";
import { lewisClaimText, readLewisClaim } from "./lewisClaimReader";
import {
  claimVerdict, countUnit, declarationText, declaredFormulas, equalScalar, formulaKey, planClaims,
  graphMatches, mentionedElements, planIssue, planQuantities, type ChemistrySourceCertification,
} from "./sourceEvidenceShared";

type Role =
  | "formal_charge" | "total_valence" | "lone_pair_electrons" | "bonding_electrons"
  | "lone_pairs" | "bond_pairs" | "sigma" | "pi" | "valence" | "atom_count";

const ROLES: ReadonlyArray<[Role, RegExp]> = [
  ["formal_charge", /\bformal\s+charges?\b|\bfc\b/i],
  ["total_valence", /\btotal\s+(?:number\s+of\s+)?valence\b|\bvalence\s+electrons?\s+(?:in\s+)?total\b/i],
  ["lone_pair_electrons", /\b(?:lone[- ]pair|non[- ]?bonding)\s+electrons?\b/i],
  ["bonding_electrons", /\b(?:bond(?:ing|ed)?|shared)\s+electrons?\b/i],
  ["lone_pairs", /\blone[- ]pairs?\b|\bnon[- ]?bonding\s+pairs?\b/i],
  ["bond_pairs", /\b(?:bond(?:ing)?|shared)[- ]pairs?\b/i],
  ["sigma", /\bsigma\b|σ/i],
  ["pi", /\bpi\b|π/i],
  ["valence", /\bvalence\b/i],
  ["atom_count", /\batoms?\b|\bcount\b|\bnumber\s+of\b/i],
];

/** A more specific role subsumes the word it contains. */
const SUBSUMES: ReadonlyArray<[Role, Role]> = [
  ["total_valence", "valence"], ["lone_pair_electrons", "lone_pairs"], ["formal_charge", "atom_count"],
];

/** Bond notation (N-H, C=O) and FC(X) shorthand read as words, so neither
 * becomes an invented formula such as the nitride ion "N-". */
function lewisText(text: string): string {
  return declarationText(text)
    .replace(/\bFC\s*\(\s*([A-Z][a-z]?)\s*\)/g, "formal charge $1")
    .replace(/([A-Z][a-z]?)\s*[-–=≡]\s*(?=[A-Z])/g, "$1 ");
}

function rolesIn(text: string): Role[] {
  let roles = ROLES.filter(([, expression]) => expression.test(text)).map(([role]) => role);
  for (const [specific, general] of SUBSUMES) if (roles.includes(specific)) roles = roles.filter((role) => role !== general);
  return roles.length > 1 ? roles.filter((role) => role !== "atom_count") : roles;
}

function declaredRole(quantity: TurnPlanQuantityV3): Role | null {
  const symbolRoles = rolesIn(lewisText(quantity.symbol));
  if (symbolRoles.length === 1) return symbolRoles[0]!;
  if (symbolRoles.length > 1) return null;
  const sourceRoles = rolesIn(lewisText(quantity.sourceText ?? ""));
  return sourceRoles.length === 1 ? sourceRoles[0]! : null;
}

function unitFits(quantity: TurnPlanQuantityV3, role: Role): boolean {
  switch (role) {
    case "formal_charge": return countUnit(quantity, ["e", "charge"]);
    case "atom_count": return countUnit(quantity, ["atom", "atoms"]);
    case "sigma": case "pi": return countUnit(quantity, ["bond", "bonds"]);
    case "lone_pairs": case "bond_pairs": return countUnit(quantity, ["pair", "pairs"]);
    default: return countUnit(quantity, ["electron", "electrons", "e", "e-"]);
  }
}

function atomsOf(result: LewisResult, element: ElementRecord): LewisAtom[] {
  return result.atoms.filter((atom) => atom.symbol === element.symbol);
}

/** One value for every atom of an element, or null when they differ. */
function perAtom(atoms: readonly LewisAtom[], read: (atom: LewisAtom) => number | null): number | null {
  const values = atoms.map(read);
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return values.every((value) => value === values[0]) ? values[0]! : null;
}

function bondOrderAt(result: LewisResult, atom: LewisAtom): number {
  return result.bonds.filter((bond) => bond.a === atom.id || bond.b === atom.id).reduce((sum, bond) => sum + bond.order, 0);
}

function centralAtom(result: LewisResult): LewisAtom | null {
  return result.skeleton === "central" ? result.atoms.find((atom) => atom.id === result.centralAtom) ?? null : null;
}

const CHAIN = /\b[A-Z][a-z]?(?:·[A-Z][a-z]?)+(?![A-Za-z0-9])/g;

/** Bond types a declaration names in bond notation (N-H, C=O), as symbol pairs. */
function bondTypes(text: string): Array<[string, string]> {
  return [...text.matchAll(CHAIN)].flatMap((match) => {
    const symbols = match[0].split("·");
    return symbols.slice(1).map((symbol, index) => [symbols[index]!, symbol] as [string, string]);
  });
}

/**
 * The source value a declaration names, or null when its role or owner is
 * not one value of the regenerated structure. Symbol and source text are
 * read together: an atom named in either (the symbol "lone pairs" with the
 * source "lone pairs on carbon") is the owner, two different owners decline,
 * and a bond type (3 N-H bonds) names bonds, never an owner atom. A molecular
 * total under a bond type is read only when every bond is of that type.
 */
function expectedValue(quantity: TurnPlanQuantityV3, role: Role, result: LewisResult): number | null {
  const declarations = [quantity.symbol, quantity.sourceText ?? ""].map(lewisClaimText);
  const types = declarations.flatMap(bondTypes);
  const plain = declarations.map((text) => text.replace(CHAIN, " "));
  const key = formulaKey(result.formula.text);
  if (plain.some((text) => [...declaredFormulas(text)].some((formula) => formula !== key))) return null;
  const present = (element: ElementRecord) => result.formula.atoms.some((atom) => atom.element === element);
  if (types.flat().some((symbol) => !result.formula.atoms.some((atom) => atom.symbol === symbol))) return null;
  const mentioned = plain.map((text) => mentionedElements(text, ELEMENTS));
  if (mentioned.flat().some((element) => !present(element))) return null;
  const symbolAtoms = mentioned[0]!;
  const owners = [...new Set(mentioned.flat())];
  const centralNamed = plain.some((text) => /\bcentral\b/i.test(text));
  const central = centralNamed ? centralAtom(result) : null;
  if (centralNamed && (!central || owners.some((element) => element.symbol !== central.symbol))) return null;
  const allOfType = types.length === 0 || result.bonds.every((bond) => {
    const a = result.atoms.find((atom) => atom.id === bond.a)?.symbol;
    const b = result.atoms.find((atom) => atom.id === bond.b)?.symbol;
    return types.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  });
  const unpaired = result.unpairedElectrons > 0;
  switch (role) {
    case "total_valence":
      // A total is molecular; its arithmetic may name every element present.
      return symbolAtoms.length === 0 && !central && types.length === 0 ? result.totalValenceElectrons : null;
    case "valence": {
      const atom = central?.element ?? (owners.length === 1 ? owners[0]! : null);
      return atom && owners.length <= 1 && types.length === 0 ? valenceElectrons(atom) : null;
    }
    case "atom_count":
      return owners.length === 1 && !central && types.length === 0 ? result.formula.atoms.find((atom) => atom.element === owners[0])?.count ?? null : null;
    default:
      break;
  }
  if (owners.length > 1) return null;
  const target = central ? [central] : owners[0] ? atomsOf(result, owners[0]) : null;
  if (role === "formal_charge") return types.length ? null : perAtom(target ?? result.atoms, (atom) => atom.formalCharge);
  if (unpaired && (role === "lone_pairs" || role === "lone_pair_electrons")) return null;
  if (types.length && (role === "lone_pairs" || role === "lone_pair_electrons" || (target && role !== "sigma" && role !== "pi"))) return null;
  const incident = (atom: LewisAtom) => result.bonds.filter((bond) => bond.a === atom.id || bond.b === atom.id);
  if (target) {
    switch (role) {
      case "lone_pairs": return perAtom(target, (atom) => atom.lonePairs);
      case "lone_pair_electrons": return perAtom(target, (atom) => 2 * atom.lonePairs);
      case "bond_pairs": return perAtom(target, (atom) => bondOrderAt(result, atom));
      case "bonding_electrons": return perAtom(target, (atom) => 2 * bondOrderAt(result, atom));
      // A typed count on an atom (C-H sigma bonds of carbon) is not read.
      case "sigma": return types.length ? null : perAtom(target, (atom) => incident(atom).length);
      case "pi": return types.length ? null : perAtom(target, (atom) => incident(atom).reduce((sum, bond) => sum + bond.order - 1, 0));
      default: return null;
    }
  }
  if (!allOfType) return null;
  const shared = result.bonds.reduce((sum, bond) => sum + bond.order, 0);
  switch (role) {
    case "lone_pairs": return result.lonePairs;
    case "lone_pair_electrons": return 2 * result.lonePairs;
    case "bond_pairs": return shared;
    case "bonding_electrons": return 2 * shared;
    case "sigma": return result.sigmaBonds;
    case "pi": return result.piBonds;
    default: return null;
  }
}

function planIssues(plan: TurnPlanV3, result: LewisResult): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const [kind, index, quantity] of planQuantities(plan)) {
    const role = declaredRole(quantity);
    // Unrelated givens keep the normal plan audit; an unknown derived value
    // fails closed, as it could be stale narration beside the figure.
    if (!role && kind === "givens" && !/^(?:electrons?|pairs?|atoms?|bonds?)$/i.test(quantity.unit ?? "")) continue;
    const expected = role && unitFits(quantity, role) ? expectedValue(quantity, role, result) : null;
    if (expected !== null && equalScalar(quantity.value, expected)) continue;
    issues.push(planIssue(kind, index, "lewis_plan_fact_unverified",
      "Lewis plan scalar lacks an unambiguous, matching species-and-role source fact"));
  }
  return issues;
}

/** Count claims the planner narrates beside the structure. One fail closed
 * rule (`claimVerdict`): every count next to a Lewis role must be read and
 * checked by species, atom or bond, and a claim the plan marks false must be
 * false against the structure. */
function claimIssues(plan: TurnPlanV3, result: LewisResult): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const claim of planClaims(plan)) {
    const verdict = claimVerdict(claim, readLewisClaim(claim.text, result));
    if (verdict === "conflict") issues.push({ code: "lewis_plan_claim_conflict", severity: "fatal",
      path: `turnPlan.qualitativeClaims[${claim.index}]`, message: "Lewis plan claim contradicts the source-derived structure" });
    if (verdict === "unread") issues.push({ code: "lewis_plan_claim_unverified", severity: "fatal",
      path: `turnPlan.qualitativeClaims[${claim.index}]`, message: "Lewis plan claim has a count, owner or expectation the structure reader cannot check" });
  }
  return issues;
}

/** Certify the plain single-species Lewis graph. Resonance, overlap, ionic,
 * hydrogen-bond, metallic, topology and multi-species scenes keep the
 * generic audit (not_applicable). */
export function certifyLewisSourceDocument(document: SceneDocument, question: string, plan: TurnPlanV3 | null): ChemistrySourceCertification {
  const claimsFamily = document.source.chemistryFamily === LEWIS_FAMILY || document.source.archetype === LEWIS_FAMILY;
  if (!claimsFamily || !isLewisStem(question)) return { status: "not_applicable" };
  let raw: SceneDocument | null;
  try {
    raw = buildLewisScene(question, [], false);
  } catch {
    return { status: "not_applicable" };
  }
  const species = stemSpecies(question);
  if (!raw || species.length !== 1) return { status: "not_applicable" };
  const result = species[0]!;
  const computed: Record<string, number> = { sigma_bonds: result.sigmaBonds, pi_bonds: result.piBonds, lone_pairs: result.lonePairs };
  if (raw.quantities.map((quantity) => quantity.id).join(",") !== Object.keys(computed).join(",")
    || raw.quantities.some((quantity) => quantity.value !== computed[quantity.id])) return { status: "not_applicable" };
  const fresh = validateSceneDocument(pruneDeadSceneEntities(raw as unknown as Record<string, unknown>)).document;
  const submitted = validateSceneDocument(document).document;
  if (!fresh || !submitted || !graphMatches(submitted, fresh, plan)) return { status: "not_applicable" };
  const issues = plan ? [...planIssues(plan, result), ...claimIssues(plan, result)] : [];
  if (issues.length) return { status: "rejected", issues };
  const compiled = compileSceneDocument(fresh);
  if (!compiled.ok || !compiled.renderScene) return { status: "not_applicable" };
  return {
    status: "certified",
    texts: displayedSceneQuantityTexts(fresh),
    quantities: fresh.quantities.map((quantity) => ({ id: quantity.id, value: quantity.value, unit: quantity.unit })),
  };
}
