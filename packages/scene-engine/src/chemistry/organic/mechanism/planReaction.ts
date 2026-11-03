/**
 * The turn plan's example reactions for a topic ask that names no species:
 * "Teach me SN1 and SN2 reactions ... Draw the reaction mechanism".
 *
 * The question is read closed, as the phase 1 source reader learned to:
 * every word must be an ask or teaching word that puts no condition on the
 * species or the outcome. A word outside the list ("tertiary", "water",
 * "faster", "not", a number, a symbol) declines, because the figure could
 * then answer something the question did not ask. Words that state a
 * property ("is", "unimolecular", "all", "both") are not ask words; a
 * kind word ("substitution", "elimination") must be true of every named
 * class; and only a closed set may follow a class name, so "SN2'" (the
 * allylic mechanism) and "the SN1 molecule" decline. The question must name
 * one or two of SN1, SN2 and E2 (never E1, which no operator draws), and
 * the plan must give exactly one example for each named class and none
 * other. Each example equation must read, run under its class's checked
 * arrows, and give exactly its stated products; one failing example
 * declines the whole figure.
 */
import type { SceneDocument } from "../../../types";
import { questionNamesSpecies } from "../../planExample";
import { isChemistryQuestion } from "../../router";
import { mechanismClassesNamed, withoutMechanismNames } from "./source";
import { substitutionFromEquation, type SubstitutionClass } from "./substitution";
import { buildSubstitutionFigure, type SubstitutionReaction } from "./substitutionFigure";

export type PlanReactionDocument =
  | { status: "none" }
  | { status: "declined"; reason: string }
  | { status: "built"; document: SceneDocument; equations: string };

const CLASSES: ReadonlySet<string> = new Set(["SN1", "SN2", "E2"]);
const MAX_EQUATION = 80;

/**
 * Ask and teaching words that put no condition on the species. Built from
 * the production ask (bcf546ce) and ordinary topic asks; anything else
 * declines. Class names stand as "zclass".
 */
const ASK_WORDS: ReadonlySet<string> = new Set([
  // asking
  "teach", "me", "us", "explain", "show", "draw", "illustrate", "describe", "tell", "help", "understand", "learn", "discuss", "give", "use", "using",
  "please", "can", "could", "you", "i", "want", "would", "like", "let", "s", "what", "how",
  // joining words
  "the", "a", "an", "and", "or", "of", "on", "in", "with", "to", "for", "from", "about", "by", "each", "also", "then", "very", "few", "some", "its", "their",
  // the lesson
  "basics", "simple", "simply", "english", "patient", "teacher", "chemistry", "organic", "whiteboard", "board", "diagram", "diagrams",
  "structures", "structure", "molecules", "molecule", "arrows", "arrow", "curly", "electron", "electrons", "movement", "flow", "aloud",
  "mechanism", "mechanisms", "reaction", "reactions", "substitution", "substitutions", "elimination", "eliminations", "nucleophilic", "nucleophile", "nucleophiles",
  "lone", "pair", "pairs", "bond", "bonds", "compare", "comparison", "difference", "differences", "between", "vs", "versus",
  "example", "examples", "finish", "viva", "questions", "question", "quiz", "detail", "detailed", "clearly", "beginner", "beginners", "introduction", "overview", "notes", "concept", "concepts",
  "zclass",
]);
/**
 * Words that say what kind of reaction a class is: true only of SN1 and SN2
 * ("substitution", "nucleophilic") or only of E2 ("elimination"). Each may
 * stand only when every class the question names is of that kind, so "the
 * SN1 elimination" or "E2 is a nucleophilic substitution" declines.
 */
const SUBSTITUTION_WORDS: ReadonlySet<string> = new Set(["substitution", "substitutions", "nucleophilic", "nucleophile", "nucleophiles"]);
const ELIMINATION_WORDS: ReadonlySet<string> = new Set(["elimination", "eliminations"]);
/**
 * What may follow a class name: a closed set of words, a comma or a
 * sentence end. "SN2′" and "SN2'" (the allylic mechanism) and "the SN1
 * molecule" decline. The kind words ("SN2 nucleophilic substitution", "E2
 * elimination") may follow because the kind rule above holds them to the
 * classes they are true of.
 */
const AFTER_CLASS = /^\s*(?:(?:reactions?|mechanisms?|and|or|with|substitutions?|nucleophilic|eliminations?|step[ -]by[ -]step)(?![\p{L}\p{N}'’′])|[.,?!](?=\s|$)|$)/iu;
/** Outside the class names, letters, digits, spaces and plain sentence marks only. */
const ASK_CHARACTERS = /^[\p{L}\p{N}\s.,;:?!'’]*$/u;

/** The classes a question asks about, or why its wording declines. */
export function readReactionAsk(question: string): { ok: true; classes: Set<SubstitutionClass> } | { ok: false; reason: string } {
  const blanked = withoutMechanismNames(question);
  // Each blanked run is one class name; E1 is named but has no operator.
  const runs = [...blanked.matchAll(/ +/g)].filter((match) => question.slice(match.index!, match.index! + match[0].length).trim());
  const classes = new Set<SubstitutionClass>();
  for (const run of runs) {
    const span = question.slice(run.index!, run.index! + run[0].length);
    const named = mechanismClassesNamed(span);
    if (named.size !== 1) return { ok: false, reason: `"${span.trim()}" names a class no checked operator draws` };
    if (!AFTER_CLASS.test(question.slice(run.index! + run[0].length))) return { ok: false, reason: `"${span.trim()}" is followed by "${question.slice(run.index! + run[0].length).trim().slice(0, 12)}", which may name another mechanism or species` };
    classes.add([...named][0]!);
  }
  if (!classes.size) return { ok: false, reason: "the question names none of SN1, SN2 and E2" };
  if (classes.size > 2) return { ok: false, reason: "the question names more than two classes" };
  let text = "";
  let at = 0;
  for (const match of blanked.matchAll(/ +/g)) {
    if (!question.slice(match.index!, match.index! + match[0].length).trim()) continue;
    text += `${blanked.slice(at, match.index!)} zclass `;
    at = match.index! + match[0].length;
  }
  text += blanked.slice(at);
  if (!ASK_CHARACTERS.test(text)) return { ok: false, reason: "a symbol outside plain sentence marks" };
  const all = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // "What is an SN1 reaction?": the one frame "is" or "are" may stand in, at the very start; "how SN2 is unimolecular" still declines.
  const framed = /^(?:what (?:is|are) (?:an? |the )?zclass\b)/.test(all.join(" ")) ? all.slice(2) : all;
  // "step" only as "step by step" or "each step": "SN2 with steps" would say a one step mechanism has several.
  const words = framed.join(" ").replace(/\b(?:step by step|each step)\b/g, " ").split(" ").filter(Boolean);
  const outside = words.find((word) => !ASK_WORDS.has(word));
  if (outside) return { ok: false, reason: `the question says "${outside}", which may put a condition on the species the example would not meet` };
  const every = (test: (mechanism: SubstitutionClass) => boolean): boolean => [...classes].every(test);
  const kindWord = words.find((word) => (SUBSTITUTION_WORDS.has(word) && !every((mechanism) => mechanism !== "E2")) || (ELIMINATION_WORDS.has(word) && !every((mechanism) => mechanism === "E2")));
  if (kindWord) return { ok: false, reason: `"${kindWord}" is not true of every class the question names` };
  return { ok: true, classes };
}

export function buildPlanExampleReactionDocument(question: string, turnPlan: unknown): PlanReactionDocument {
  const raw = typeof turnPlan === "object" && turnPlan !== null ? (turnPlan as { exampleReactions?: unknown }).exampleReactions : undefined;
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return { status: "none" };
  if (!Array.isArray(raw) || raw.length > 2) return { status: "declined", reason: "the plan gives more than two example reactions" };
  const entries: Array<{ mechanism: SubstitutionClass; equation: string }> = [];
  for (const entry of raw as unknown[]) {
    const { mechanism, equation } = (entry ?? {}) as { mechanism?: unknown; equation?: unknown };
    if (typeof mechanism !== "string" || !CLASSES.has(mechanism) || typeof equation !== "string" || !equation.trim() || equation.length > MAX_EQUATION) {
      return { status: "declined", reason: "a plan example lacks a class (SN1, SN2, E2) or an equation" };
    }
    entries.push({ mechanism: mechanism as SubstitutionClass, equation: equation.trim() });
  }
  if (new Set(entries.map((entry) => entry.mechanism)).size !== entries.length) return { status: "declined", reason: "the plan gives two examples of one class" };
  if (!isChemistryQuestion(question)) return { status: "declined", reason: "not a chemistry question" };
  if (questionNamesSpecies(question)) return { status: "declined", reason: "the question names its own species" };
  const ask = readReactionAsk(question);
  if (!ask.ok) return { status: "declined", reason: ask.reason };
  const planned = new Set(entries.map((entry) => entry.mechanism));
  if (planned.size !== ask.classes.size || [...planned].some((mechanism) => !ask.classes.has(mechanism))) {
    return { status: "declined", reason: "the plan's examples are not exactly one for each class the question names" };
  }
  const reactions: SubstitutionReaction[] = [];
  for (const entry of entries) {
    const read = substitutionFromEquation(entry.mechanism, entry.equation);
    if (!read.ok) return { status: "declined", reason: `${entry.mechanism} example ${entry.equation}: ${read.reason}` };
    reactions.push({ model: read.model, equation: read.equation! });
  }
  const document = buildSubstitutionFigure({ question, reactions });
  if (!document) return { status: "declined", reason: "the verified mechanisms could not be laid out on the board" };
  const equations = entries.map((entry) => entry.equation).join("; ");
  document.source = { ...document.source, question, figureProvenance: "plan_example", exampleSpecies: equations };
  return { status: "built", document, equations };
}
