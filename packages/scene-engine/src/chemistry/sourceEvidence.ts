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
import { deferVerifiedAnswerLabels } from "../compile/answerLabels";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import type { SceneDocument, SceneIssue } from "../types";
import { formulaTokens, normalizeChemistryText, parseFormula } from "./formula";
import { ELEMENTS, valenceElectrons, type ElementRecord } from "./elements";
import { buildVseprScene, isVseprStem, VSEPR_FAMILY, vseprSpecies, type VseprResult } from "./vsepr";

export type VseprSourceCertification =
  | { status: "not_applicable" }
  | { status: "rejected"; issues: SceneIssue[] }
  | { status: "certified"; texts: readonly string[] };

type Role = "valence" | "steric" | "lone_pairs" | "bond_pairs" | "angle";
const ROLES: ReadonlyArray<[Role, RegExp]> = [
  ["valence", /\bvalence(?:\s+electrons?)?\b|\bouter[- ]shell\s+electrons?\b/i],
  ["steric", /\bsteric(?:\s+number)?\b|\belectron\s+domains?\b/i],
  ["lone_pairs", /\blone[- ]pairs?\b|\bnon[- ]bonding\s+pairs?\b/i],
  ["bond_pairs", /\bbond[- ]pairs?\b|\bbonded\s+atoms?\b/i],
  ["angle", /\bbond\s+angle\b|\bangle\b|[θϑ]/i],
];

function declarationText(text: string): string {
  return normalizeChemistryText(text)
    // Split named scalar roles, not chemical tokens: a generic camel-case
    // splitter would corrupt ClF3 into Cl F3 and lose the target molecule.
    .replace(/\b(valence|steric|lone|bond)(?=Electrons?|Number|Pairs?|Angle)/g, "$1 ")
    .replace(/\b(valence|steric|electrons?|number|pairs?|angle)(?=[A-Z])/gi, "$1 ")
    .replace(/_/g, " ");
}

/** A symbol names the claimed role; explanatory arithmetic may mention other
 * roles on the RHS. Without such a name, only one declared role is accepted.
 */
function declaredRole(quantity: TurnPlanQuantityV3): Role | null {
  const rolesIn = (text: string) => ROLES.filter(([, expression]) => expression.test(text)).map(([role]) => role);
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

function formulaKey(formula: string): string | null {
  const parsed = parseFormula(formula);
  return parsed ? `${parsed.charge}:${parsed.atoms.map(({ symbol, count }) => `${symbol}:${count}`).sort().join(",")}` : null;
}

function declaredFormulas(text: string): Set<string | null> {
  return new Set(formulaTokens(declarationText(text)).map(formulaKey));
}

function mentionedElements(text: string, elements: readonly ElementRecord[]): ElementRecord[] {
  const declaration = declarationText(text);
  return elements.filter((element) => {
    const symbol = new RegExp(`(?<![A-Za-z0-9])${element.symbol}(?![A-Za-z0-9])`);
    const names = [element.name, ...(element.symbol === "S" ? ["Sulfur"] : [])];
    return symbol.test(declaration) || names.some((name) => new RegExp(`\\b${name}\\b`, "i").test(declaration));
  });
}

function compatibleUnit(quantity: TurnPlanQuantityV3, role: Role): boolean {
  const unit = (quantity.unit ?? "").trim().toLowerCase();
  if (role === "angle") return ["°", "deg", "degree", "degrees"].includes(unit);
  if (["", "1", "dimensionless", "count"].includes(unit)) return true;
  if (role === "valence") return ["electron", "electrons"].includes(unit);
  if (role === "steric") return ["domain", "domains"].includes(unit);
  return ["pair", "pairs"].includes(unit);
}

function equalScalar(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected));
}

/** Each declaration must identify its target independently. A sourceText that
 * names another molecule/atom cannot borrow the symbol's otherwise valid ID.
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
    ? species.filter((result) => result.central.symbol === atomTarget.symbol) : [];
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
      if (!role && !namesRole && kind === "givens" && !/^(?:°|deg|degrees?|electrons?|pairs?|domains?)$/i.test(quantity.unit ?? "")) return;
      if (role && quantityMatches(quantity, role, species)) return;
      issues.push({ code: "vsepr_plan_fact_unverified", severity: "fatal", path: `turnPlan.${kind}[${index}]`,
        message: "VSEPR plan scalar lacks an unambiguous, matching species-and-role source fact" });
    });
  }
  return issues;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function graphMatches(document: SceneDocument, fresh: SceneDocument, plan: TurnPlanV3 | null): boolean {
  const expected = structuredClone(fresh);
  const source = document.source;
  // These are the only presentation additions; each value is constrained or
  // regenerated. Geometry, labels, owners, quantities and source facts remain
  // in the exact comparison, including all plan IDs and reveal membership.
  if (source.representationTier !== undefined) {
    if (typeof source.representationTier !== "string" || !["qualitative_verified", "question_representation"].includes(source.representationTier)) return false;
    expected.source.representationTier = source.representationTier;
  }
  if (source.nonMetric !== undefined) {
    if (source.nonMetric !== true) return false;
    expected.source.nonMetric = true;
  }
  if (source.diagramYieldPolicy !== undefined) {
    if (source.diagramYieldPolicy !== "verified_parts") return false;
    expected.source.diagramYieldPolicy = "verified_parts";
  }
  if (source.answerLabelEntityIds !== undefined || source.answerLabelAnnotationIds !== undefined) {
    const compiled = compileSceneDocument(expected);
    if (!compiled.ok || !compiled.renderScene) return false;
    // Without retained planner claims there are no planner-derived answers to
    // stage. Only empty staging arrays can accompany the exact native graph.
    const staged = plan ? deferVerifiedAnswerLabels(expected, plan, compiled.renderScene) : expected;
    for (const key of ["answerLabelEntityIds", "answerLabelAnnotationIds"] as const) {
      if (source[key] !== undefined) {
        if (stable(source[key]) !== stable(staged.source[key] ?? [])) return false;
        expected.source[key] = source[key];
      }
    }
  }
  return stable(document) === stable(expected);
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
