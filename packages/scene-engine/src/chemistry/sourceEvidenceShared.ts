/** Helpers shared by the chemistry source certificates (VSEPR shape graph,
 * Lewis structure graph, periodic trend graph).
 *
 * A certificate regenerates the complete figure from the actual question,
 * requires the submitted document to be that exact graph, and checks every
 * planner scalar that names a chemical role against the regenerated source.
 * These helpers carry the parts that do not depend on the family.
 */
import type { TurnPlanQuantityV3, TurnPlanV3 } from "../contracts/contractsV3";
import { compileSceneDocument } from "../compile/compiler";
import { deferVerifiedAnswerLabels } from "../compile/answerLabels";
import type { SceneDocument, SceneIssue } from "../types";
import { formulaTokens, normalizeChemistryText, parseFormula } from "./formula";
import type { ElementRecord } from "./elements";

/** A certified figure: the displayed texts and the quantities its source graph
 * determines. Only the regenerated graph supplies either list. */
export type ChemistrySourceCertification =
  | { status: "not_applicable" }
  | { status: "rejected"; issues: SceneIssue[] }
  | {
    status: "certified";
    texts: readonly string[];
    quantities: ReadonlyArray<{ id: string; value: unknown; unit: unknown }>;
  };

export function declarationText(text: string): string {
  return normalizeChemistryText(text)
    // Split named scalar roles, not chemical tokens: a generic camel-case
    // splitter would corrupt ClF3 into Cl F3 and lose the target molecule.
    .replace(/\b(valence|steric|lone|bond)(?=Electrons?|Number|Pairs?|Angle)/g, "$1 ")
    // Case-sensitive lookahead: with /i, "electronegativity" became
    // "electron egativity" and "pairs" became "pair s".
    .replace(/\b([Vv]alence|[Ss]teric|[Ee]lectrons?|[Nn]umber|[Pp]airs?|[Aa]ngle)(?=[A-Z])/g, "$1 ")
    .replace(/_/g, " ");
}

export function formulaKey(formula: string): string | null {
  const parsed = parseFormula(formula);
  return parsed ? `${parsed.charge}:${parsed.atoms.map(({ symbol, count }) => `${symbol}:${count}`).sort().join(",")}` : null;
}

export function declaredFormulas(text: string): Set<string | null> {
  return new Set(formulaTokens(declarationText(text)).map(formulaKey));
}

export function mentionedElements(text: string, elements: readonly ElementRecord[]): ElementRecord[] {
  const declaration = declarationText(text);
  return elements.filter((element) => {
    const symbol = new RegExp(`(?<![A-Za-z0-9])${element.symbol}(?![A-Za-z0-9])`);
    const names = [element.name, ...(element.symbol === "S" ? ["Sulfur"] : [])];
    return symbol.test(declaration) || names.some((name) => new RegExp(`\\b${name}\\b`, "i").test(declaration));
  });
}

export function equalScalar(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected));
}

/** Count units a source count may carry. Anything else is not this count. */
export function countUnit(quantity: TurnPlanQuantityV3, accepted: readonly string[]): boolean {
  const unit = (quantity.unit ?? "").trim().toLowerCase();
  return ["", "1", "dimensionless", "count"].includes(unit) || accepted.includes(unit);
}

export function planIssue(kind: "givens" | "derived", index: number, code: string, message: string): SceneIssue {
  return { code, severity: "fatal", path: `turnPlan.${kind}[${index}]`, message };
}

export function planQuantities(plan: TurnPlanV3): Array<["givens" | "derived", number, TurnPlanQuantityV3]> {
  return [
    ...plan.givens.map((quantity, index) => ["givens", index, quantity] as ["givens", number, TurnPlanQuantityV3]),
    ...plan.derived.map((quantity, index) => ["derived", index, quantity] as ["derived", number, TurnPlanQuantityV3]),
  ];
}

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** The submitted document is the regenerated graph, apart from the
 * presentation fields the pipeline adds, each constrained or regenerated. */
export function graphMatches(document: SceneDocument, fresh: SceneDocument, plan: TurnPlanV3 | null): boolean {
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

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  no: 0, zero: 0, one: 1, a: 1, an: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
};

/** A small count written as digits or a word, or null. */
export function countWord(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  return NUMBER_WORDS[text.toLowerCase()] ?? null;
}

export const COUNT_PATTERN = "(\\d+|no|zero|one|an?|single|two|three|four|five|six|seven|eight|nine|ten|twelve)";

/** Claim text a qualitative claim asserts: the claim and a non-boolean expectation. */
export function claimTexts(plan: TurnPlanV3): string[] {
  return plan.qualitativeClaims.map((claim) =>
    `${claim.claim}${typeof claim.expected === "boolean" ? "" : `. ${claim.expected}`}`);
}
