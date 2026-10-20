/**
 * The stated facts a floor figure may draw, and nothing else.
 *
 * A floor figure is the last honest picture after every planner candidate and
 * every computed figure failed. It draws the setup the question states and
 * never the analysis: values come from the question's own text (held to the
 * validated plan value), unknowns are "?", objects and connections come from a
 * ProblemIR whose every fact quotes the question. Nothing here solves, derives,
 * or reads a model-drawn scene.
 */
import {
  sameMeasuredQuantity,
  statedMeasurements,
  validateTurnPlanV3,
  type TurnPlanV3,
} from "../contracts/contractsV3";
import { validateProblemIR, type ProblemConstraint, type ProblemIR, type RepresentationIntent } from "../ir/problemIR";

export const FLOOR_FIGURE_VERSION = "floor-figure/v1" as const;

/** A given value exactly as the question wrote it, held to the plan's value. */
export interface FloorStatedValue {
  quantityId: string;
  symbol: string;
  /** Number and unit copied from the question, e.g. "4.7 kΩ" or "0.10". */
  valueText: string;
  value: number;
  unit?: string;
  /** Where the question states it. */
  sourceIndex: number;
  /** The question span that states it (plan source text, a ProblemIR quote, or the words around it). */
  context: string;
}

export interface FloorUnknown {
  quantityId: string;
  symbol: string;
}

export interface FloorObject {
  id: string;
  kind: ProblemIR["entities"][number]["kind"];
  /** The entity's name when the question itself uses it, else null. */
  name: string | null;
  quotes: string[];
}

export interface FloorFacts {
  version: typeof FLOOR_FIGURE_VERSION;
  question: string;
  plan: TurnPlanV3;
  /** The plan exactly as the turn holds it, for engine source readers that take it whole. */
  rawPlan: unknown;
  /** Scene families the live gate inferred; ordering hints for kinds that reuse engine readers. */
  families: readonly string[];
  values: FloorStatedValue[];
  unknowns: FloorUnknown[];
  /** Present only when the ProblemIR validated against this question. */
  problem: ProblemIR | null;
  objects: FloorObject[];
  constraints: ProblemConstraint[];
  intents: RepresentationIntent[];
}

const SYMBOL = /^[\p{L}][\p{L}\p{N}_′'₀-₉]{0,11}$/u;
const MAX_VALUES = 8;

/** Collapse whitespace and fold case for containment checks only. */
export function flattenText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** A short, clean symbol a board label can carry. */
export function boardSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().replace(/\s+/g, "");
  return SYMBOL.test(symbol) ? symbol : null;
}

function dimensionless(unit: unknown): boolean {
  if (unit === undefined || unit === null) return true;
  const text = String(unit).trim().toLowerCase();
  return text === "" || text === "1" || text === "dimensionless" || text === "none" || text === "unitless";
}

/**
 * Find the question's own spelling of a plan given. The span is searched first
 * in the plan's source text when the question really contains it, then in the
 * ProblemIR fact quotes, then in the whole question when the value appears
 * exactly once there. A value the question does not state has no spelling.
 */
function statedSpelling(
  question: string,
  given: TurnPlanV3["givens"][number],
  quotes: readonly string[],
): { text: string; index: number; context: string } | null {
  const flatQuestion = flattenText(question);
  const spans = [
    ...(typeof given.sourceText === "string" && given.sourceText.trim() &&
      flatQuestion.includes(flattenText(given.sourceText)) ? [given.sourceText] : []),
    ...quotes,
  ];
  const located = (span: string): number => flatQuestion.indexOf(flattenText(span));
  if (dimensionless(given.unit)) {
    for (const span of spans) {
      const numbers = [...span.matchAll(/(?<![\p{L}\p{N}_.])[+\-−]?(?:\d+(?:\.\d+)?|\.\d+)(?![\p{N}.]|\s*[\p{L}°%])/gu)];
      const matching = numbers.filter((match) => Number(match[0].replace(/−/g, "-")) === given.value);
      if (matching.length === 1) return { text: matching[0]![0], index: Math.max(0, located(span)), context: span };
    }
    return null;
  }
  for (const span of spans) {
    const matching = statedMeasurements(span).filter((found) =>
      sameMeasuredQuantity(found.value, found.unitText, given.value, given.unit));
    if (matching.length >= 1 && new Set(matching.map((found) => found.text)).size === 1) {
      return { text: matching[0]!.text.replace(/\s+/g, " "), index: Math.max(0, located(span)), context: span };
    }
  }
  const whole = statedMeasurements(question).filter((found) =>
    sameMeasuredQuantity(found.value, found.unitText, given.value, given.unit));
  if (whole.length >= 1 && new Set(whole.map((found) => found.text.replace(/\s+/g, " "))).size === 1) {
    const at = whole[0]!.index;
    return { text: whole[0]!.text.replace(/\s+/g, " "), index: at, context: question.slice(Math.max(0, at - 48), at + whole[0]!.text.length + 24) };
  }
  return null;
}

/** Generic nouns a source name may add to the question's own words ("dielectric slab"). */
const GENERIC_NOUNS = new Set([
  "slab", "block", "body", "object", "source", "supply", "point", "line", "surface", "ground", "wire",
  "plate", "plates", "circuit", "node", "junction", "region", "curve", "graph", "path", "segment", "trajectory",
]);

/**
 * The name an entity carries on the board: a ProblemIR label whose every word
 * is the question's own (a plural or a generic noun such as "slab" aside) and
 * whose digits are all stated values. A label that renames or re-describes the
 * object ("concave" for a convex mirror) is not a name the floor may write.
 */
function questionName(question: string, label: string | undefined, values: readonly FloorStatedValue[]): string | null {
  if (!label) return null;
  const name = label.replace(/\s+/g, " ").trim();
  if (!name || name.length > 28) return null;
  let rest = name;
  for (const value of values) rest = rest.split(value.valueText).join(" ");
  if (/[0-9]/.test(rest)) return null;
  const words = flattenText(question).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const own = rest.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (own.length === 0) return name;
  const stated = (word: string) => words.some((candidate) => candidate === word ||
    (candidate.startsWith(word) && candidate.length - word.length <= 2) ||
    (word.startsWith(candidate) && word.length - candidate.length <= 2 && candidate.length >= 3));
  // Every word is the question's own or a generic noun; a name of generic nouns only ("trajectory") claims nothing.
  return own.every((word) => stated(word) || GENERIC_NOUNS.has(word)) ? name : null;
}

/**
 * The plan's givens and unknowns when the whole plan does not validate (a
 * derived value's arithmetic, a claim's wording). The floor reads only stated
 * givens, each re-checked against the question text, and unknown symbols, so
 * a plan error elsewhere cannot reach the figure.
 */
function structuralPlan(raw: unknown): TurnPlanV3 | null {
  if (typeof raw !== "object" || raw === null) return null;
  const plan = raw as Record<string, unknown>;
  if (!Array.isArray(plan.givens) || !Array.isArray(plan.unknowns)) return null;
  const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
  const givens = plan.givens.filter((given): given is TurnPlanV3["givens"][number] => record(given) &&
    typeof given.id === "string" && typeof given.symbol === "string" && typeof given.value === "number" &&
    Number.isFinite(given.value) && (given.unit === undefined || typeof given.unit === "string") &&
    (given.sourceText === undefined || typeof given.sourceText === "string") && given.provenance === "given");
  const unknowns = plan.unknowns.filter((unknown): unknown is TurnPlanV3["unknowns"][number] => record(unknown) &&
    typeof unknown.id === "string" && typeof unknown.symbol === "string" &&
    (unknown.unit === undefined || typeof unknown.unit === "string"));
  return {
    schemaVersion: "turn-plan/v3",
    question: typeof plan.question === "string" ? plan.question : "",
    givens,
    unknowns,
    derived: [],
    qualitativeClaims: [],
    lawIds: [],
    assumptions: [],
    visualRequirement: plan.visualRequirement === "required" || plan.visualRequirement === "optional" ? plan.visualRequirement : "none",
  };
}

/**
 * Read the facts a floor figure may use. Returns null without a valid plan.
 * A ProblemIR that does not validate against this exact question is ignored,
 * never repaired.
 */
export function readFloorFacts(input: {
  question: string;
  turnPlan: unknown;
  problemIR?: unknown;
  families?: readonly string[];
}): FloorFacts | null {
  const question = input.question.trim();
  if (!question) return null;
  const plan = validateTurnPlanV3(input.turnPlan, question).plan ?? structuralPlan(input.turnPlan);
  if (!plan) return null;
  const validated = input.problemIR ? validateProblemIR(input.problemIR, question) : null;
  const problem = validated?.valid ? validated.problem : null;
  const quotes = problem?.facts.filter((fact) => fact.kind === "given").map((fact) => fact.evidence.quote) ?? [];

  const values: FloorStatedValue[] = [];
  const usedSymbols = new Set<string>();
  for (const given of plan.givens) {
    if (given.provenance !== "given" || !Number.isFinite(given.value)) continue;
    const symbol = boardSymbol(given.symbol);
    if (!symbol || usedSymbols.has(symbol)) continue;
    const spelling = statedSpelling(question, given, quotes);
    if (!spelling) continue;
    usedSymbols.add(symbol);
    values.push({
      quantityId: given.id, symbol, valueText: spelling.text, value: given.value,
      ...(given.unit ? { unit: given.unit } : {}), sourceIndex: spelling.index, context: spelling.context,
    });
    if (values.length >= MAX_VALUES) break;
  }
  values.sort((a, b) => a.sourceIndex - b.sourceIndex);

  const unknowns: FloorUnknown[] = plan.unknowns.flatMap((unknown) => {
    const symbol = boardSymbol(unknown.symbol);
    return symbol && !usedSymbols.has(symbol) ? [{ quantityId: unknown.id, symbol }] : [];
  });

  const objects: FloorObject[] = (problem?.entities ?? []).map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    name: questionName(question, entity.label, values),
    quotes: entity.evidenceFactIds.flatMap((id) => {
      const fact = problem!.facts.find((candidate) => candidate.id === id);
      return fact ? [fact.evidence.quote] : [];
    }),
  }));

  return {
    version: FLOOR_FIGURE_VERSION,
    question,
    plan,
    rawPlan: input.turnPlan,
    families: input.families ?? [],
    values,
    unknowns,
    problem,
    objects,
    constraints: problem?.constraints ?? [],
    intents: problem?.representationIntents ?? [],
  };
}
