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
import {
  claimTexts, COUNT_PATTERN, countUnit, countWord, declarationText, declaredFormulas, equalScalar, formulaKey,
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

/** The source value a declaration names, or null when its role or target is
 * not one value of the regenerated structure. */
function expectedValue(quantity: TurnPlanQuantityV3, role: Role, result: LewisResult): number | null {
  const declarations = [quantity.symbol, quantity.sourceText ?? ""].map(lewisText);
  const key = formulaKey(result.formula.text);
  if (declarations.some((text) => [...declaredFormulas(text)].some((formula) => formula !== key))) return null;
  const present = (element: ElementRecord) => result.formula.atoms.some((atom) => atom.element === element);
  const mentioned = declarations.map((text) => mentionedElements(text, ELEMENTS));
  if (mentioned.flat().some((element) => !present(element))) return null;
  // The symbol names the atom; arithmetic in the source text may mention others.
  const symbolAtoms = mentioned[0]!;
  const sourceAtoms = mentioned[1]!;
  const central = /\bcentral\b/i.test(declarations[0]!) ? centralAtom(result) : null;
  if (/\bcentral\b/i.test(declarations[0]!) && !central) return null;
  const named = symbolAtoms.length === 1 ? symbolAtoms[0]! : symbolAtoms.length === 0 && sourceAtoms.length === 1 ? sourceAtoms[0]! : null;
  const unpaired = result.unpairedElectrons > 0;
  switch (role) {
    case "valence":
      return named && symbolAtoms.length <= 1 ? valenceElectrons(named) : null;
    case "atom_count": {
      if (!named || symbolAtoms.length > 1) return null;
      return result.formula.atoms.find((atom) => atom.element === named)?.count ?? null;
    }
    case "formal_charge": {
      if (symbolAtoms.length > 1) return null;
      const target = central ? [central] : symbolAtoms[0] ? atomsOf(result, symbolAtoms[0]) : result.atoms;
      return perAtom(target, (atom) => atom.formalCharge);
    }
    case "total_valence":
      return result.totalValenceElectrons;
    case "sigma": case "pi":
      // A bond-type count (C-H sigma bonds) is not the molecular total.
      if (symbolAtoms.length > 0) return null;
      return role === "sigma" ? result.sigmaBonds : result.piBonds;
    default: {
      if (symbolAtoms.length > 1) return null;
      const target = central ? [central] : symbolAtoms[0] ? atomsOf(result, symbolAtoms[0]) : null;
      if (unpaired && (role === "lone_pairs" || role === "lone_pair_electrons")) return null;
      const read = (atom: LewisAtom): number => role === "lone_pairs" ? atom.lonePairs
        : role === "lone_pair_electrons" ? 2 * atom.lonePairs
        : role === "bond_pairs" ? bondOrderAt(result, atom) : 2 * bondOrderAt(result, atom);
      if (target) return perAtom(target, read);
      const shared = result.bonds.reduce((sum, bond) => sum + bond.order, 0);
      // Untargeted counts are the molecule's totals, as the figure writes them.
      return role === "lone_pairs" ? result.lonePairs
        : role === "lone_pair_electrons" ? 2 * result.lonePairs
        : role === "bond_pairs" ? shared : 2 * shared;
    }
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

function elementIn(text: string): ElementRecord | null {
  const found = mentionedElements(text, ELEMENTS);
  return found.length === 1 ? found[0]! : null;
}

const ATOM = "([A-Z][a-z]?|[a-z]{3,12}|central atom)";

/** Count claims the planner narrates: lone pairs on an atom, valence
 * electrons (an atom's or the total), formal charges. A claim that names a
 * count the structure contradicts rejects the figure; other prose is left
 * to the teaching text. */
function claimIssues(plan: TurnPlanV3, result: LewisResult): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const fail = (index: number, what: string) => issues.push({ code: "lewis_plan_claim_conflict", severity: "fatal",
    path: `turnPlan.qualitativeClaims[${index}]`, message: `Lewis plan claim contradicts the source-derived ${what}` });
  const resolve = (word: string): LewisAtom[] | null => {
    if (/^central atom$/i.test(word)) { const atom = centralAtom(result); return atom ? [atom] : null; }
    const element = elementIn(word);
    return element && result.formula.atoms.some((atom) => atom.element === element) ? atomsOf(result, element) : null;
  };
  claimTexts(plan).forEach((raw, index) => {
    const text = lewisText(raw);
    const lonePairClaims = [
      ...[...text.matchAll(new RegExp(`\\b${COUNT_PATTERN}\\s+lone[- ]pairs?\\s+(?:of\\s+electrons\\s+)?(?:on|around)\\s+(?:the\\s+|each\\s+)?${ATOM}`, "gi"))]
        .map((match) => [match[1]!, match[2]!] as const),
      ...[...text.matchAll(new RegExp(`\\b(?:each\\s+)?${ATOM}(?:\\s+atoms?)?\\s+has\\s+${COUNT_PATTERN}\\s+lone[- ]pairs?`, "gi"))]
        .map((match) => [match[2]!, match[1]!] as const),
    ];
    for (const [count, atom] of lonePairClaims) {
      const atoms = resolve(atom);
      const value = countWord(count);
      if (!atoms || value === null || result.unpairedElectrons > 0) continue;
      const source = perAtom(atoms, (entry) => entry.lonePairs);
      if (source !== null && source !== value) fail(index, "lone-pair count");
    }
    for (const match of text.matchAll(new RegExp(`\\b${ATOM}(?:\\s+atom)?\\s+has\\s+${COUNT_PATTERN}\\s+valence\\s+electrons?`, "gi"))) {
      const element = elementIn(match[1]!);
      const value = countWord(match[2]!);
      if (element && value !== null && result.formula.atoms.some((atom) => atom.element === element) && value !== valenceElectrons(element)) fail(index, "valence electron count");
    }
    for (const match of text.matchAll(new RegExp(`\\b${COUNT_PATTERN}\\s+total\\s+valence\\s+electrons?|\\btotal\\s+(?:of\\s+)?${COUNT_PATTERN}\\s+valence\\s+electrons?`, "gi"))) {
      const value = countWord(match[1] ?? match[2]!);
      if (value !== null && value !== result.totalValenceElectrons) fail(index, "total valence electron count");
    }
    if (/\ball\s+(?:the\s+)?formal\s+charges\s+are\s+(?:zero|0)\b/i.test(text) && result.atoms.some((atom) => atom.formalCharge !== 0)) fail(index, "formal charges");
    for (const match of text.matchAll(new RegExp(`\\bformal\\s+charge\\s+(?:on|of)?\\s*(?:the\\s+|each\\s+)?${ATOM}(?:\\s+atom)?\\s*(?:is|=|:)\\s*([+\\-−]?\\d|zero)\\b`, "gi"))) {
      const atoms = resolve(match[1]!);
      const value = /zero/i.test(match[2]!) ? 0 : Number(match[2]!.replace("−", "-"));
      const source = atoms ? perAtom(atoms, (atom) => atom.formalCharge) : null;
      if (source !== null && source !== value) fail(index, "formal charge");
    }
  });
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
