/**
 * A chemistry topic ask that names no species ("explain hybridisation") has
 * nothing for a family to compute. The turn plan may name the one example the
 * lesson teaches with; the engine then computes that species from its formula
 * with the existing builders, checks the plan's claim against the result, and
 * captions the figure as an example. There is no default species anywhere:
 * no plan example, no figure.
 */
import { elementByName } from "./elements";
import { formulaTokens, normalizeChemistryText, parseFormula } from "./formula";
import { namedSpeciesMentions } from "./namedSpecies";
import { isChemistryQuestion } from "./router";
import { buildVseprFigure, compositionKey, isVseprStem, vseprClaimFacts, vseprSpecies } from "./vsepr";
import type { ParsedFormula } from "./formula";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import type { SceneDocument } from "../types";

export const PLAN_EXAMPLE_PROVENANCE = "plan_example" as const;

export interface PlanExampleSource {
  formula: string;
  claim: string;
  /** The question with the example appended, read by the existing family builders. */
  stem: string;
  caption: string;
}

export type PlanExampleReading =
  | { status: "none" }
  | { status: "declined"; reason: string }
  | { status: "accepted"; source: PlanExampleSource };

/** True when the question already names a species, an element, or a formula of its own. */
export function questionNamesSpecies(question: string): boolean {
  const text = normalizeChemistryText(question);
  if (namedSpeciesMentions(text).length > 0) return true;
  if (formulaTokens(text).some((token) => parseFormula(token) !== null)) return true;
  return (text.toLowerCase().match(/[a-z]+/g) ?? []).some((word) => word.length > 2 && elementByName(word) !== null);
}

function claimNamesSpecies(text: string, species: ParsedFormula): boolean {
  const key = compositionKey(species);
  const normalized = normalizeChemistryText(text);
  const formulas = [...formulaTokens(normalized), ...namedSpeciesMentions(normalized).map((mention) => mention.formula)];
  const keys = new Set(formulas.flatMap((formula) => {
    const parsed = parseFormula(formula);
    return parsed ? [compositionKey(parsed)] : [];
  }));
  // A claim naming several species cannot be bound to one computed result,
  // the same rule the VSEPR plan check applies to comparisons.
  return keys.size === 1 && keys.has(key);
}

/** The plan's example, accepted only on a chemistry question that names no species. */
export function readPlanExample(question: string, turnPlan: unknown): PlanExampleReading {
  const raw = typeof turnPlan === "object" && turnPlan !== null ? (turnPlan as { exampleSpecies?: unknown }).exampleSpecies : undefined;
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return { status: "none" };
  if (!Array.isArray(raw) || raw.length !== 1) return { status: "declined", reason: "plan names more than one example" };
  const entry = raw[0] as { formula?: unknown; claim?: unknown };
  if (typeof entry?.formula !== "string" || typeof entry.claim !== "string" || !entry.claim.trim()) {
    return { status: "declined", reason: "plan example lacks a formula or a claim" };
  }
  if (!isChemistryQuestion(question)) return { status: "declined", reason: "not a chemistry question" };
  if (questionNamesSpecies(question)) return { status: "declined", reason: "the question names its own species" };
  const formula = entry.formula.trim();
  const tokens = formulaTokens(formula);
  if (tokens.length !== 1 || tokens[0] !== formula || !parseFormula(formula)) {
    return { status: "declined", reason: "plan example formula does not parse as one species" };
  }
  return { status: "accepted", source: {
    formula, claim: entry.claim.trim(), stem: `${question.trim()} (example: ${formula})`, caption: `example: ${formula}`,
  } };
}

export type PlanExampleDocument =
  | { status: "none" }
  | { status: "declined"; reason: string }
  | { status: "built"; document: SceneDocument; source: PlanExampleSource; family: "chem_vsepr" };

/**
 * The example figure, or why there is none. Only the VSEPR family has claim
 * checks today, so only a VSEPR topic draws: the claim must state at least one
 * fact about this species and every stated fact must hold.
 */
export function buildPlanExampleDocument(question: string, turnPlan: unknown): PlanExampleDocument {
  const reading = readPlanExample(question, turnPlan);
  if (reading.status !== "accepted") return reading;
  const { source } = reading;
  if (!isVseprStem(source.stem)) return { status: "declined", reason: "no figure family with claim checks reads this topic" };
  const species = vseprSpecies(source.stem);
  const parsed = parseFormula(source.formula)!;
  if (species.length !== 1 || compositionKey(parseFormula(species[0]!.formula)!) !== compositionKey(parsed)) {
    return { status: "declined", reason: "the VSEPR family cannot compute this species" };
  }
  const checked = vseprClaimFacts({ claim: source.claim, expected: true }, species[0]!);
  if (checked.scopeError || checked.facts.length === 0) return { status: "declined", reason: "plan example claim states no checkable fact about the species" };
  const wrong = checked.facts.find((fact) => !fact.truth);
  if (wrong) return { status: "declined", reason: `plan example claim contradicts the computed ${wrong.property}` };
  // Every other plan claim about this species alone must agree with it too.
  // A claim about the idea in general ("lone pairs repel more strongly")
  // describes no species and is the teaching's, not the figure's.
  const claims = Array.isArray((turnPlan as TurnPlanV3).qualitativeClaims) ? (turnPlan as TurnPlanV3).qualitativeClaims : [];
  for (const claim of claims) {
    if (!claimNamesSpecies(`${claim.claim} ${typeof claim.expected === "string" ? claim.expected : ""}`, parsed)) continue;
    const facts = vseprClaimFacts(claim, species[0]!);
    if (facts.scopeError) return { status: "declined", reason: `plan claim ${claim.id} has unsupported compound boolean scope` };
    const conflict = facts.facts.find((fact) => fact.truth !== (claim.expected !== false));
    if (conflict) return { status: "declined", reason: `plan claim ${claim.id} contradicts the computed ${conflict.property}` };
  }
  // The caption uses the family's own compact formula, as the title does.
  source.caption = `example: ${species[0]!.label}`;
  const figure = buildVseprFigure(source.stem, [], false, { exampleCaption: source.caption });
  if (!figure) return { status: "declined", reason: "the VSEPR family declined the example" };
  const document = figure.document;
  document.source = { ...document.source, figureProvenance: PLAN_EXAMPLE_PROVENANCE, exampleSpecies: source.formula };
  return { status: "built", document, source, family: "chem_vsepr" };
}
