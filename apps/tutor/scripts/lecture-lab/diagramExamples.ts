import { readFileSync } from "node:fs";
import { compactSceneExampleDocument } from "@heytutor/tutor-core";

export interface DiagramExemplar {
  id: string;
  question: string;
  family: string | null;
  archetype: string | null;
  document: Record<string, unknown>;
}

export interface DiagramExampleQuery {
  question: string;
  families: readonly string[];
  archetypeId: string | null;
  limit?: number;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "at", "by", "draw", "find", "for", "from", "in", "is", "of", "on",
  "show", "sketch", "the", "to", "using", "with",
]);

function stemToken(token: string): string {
  return token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
}

export function diagramQuestionTokens(question: string): string[] {
  return [...new Set(
    (question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .map(stemToken)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  )];
}

export function diagramQuestionsNearDuplicate(left: string, right: string): boolean {
  const normalized = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (normalized(left) === normalized(right)) return true;
  const leftTokens = new Set(diagramQuestionTokens(left));
  const rightTokens = new Set(diagramQuestionTokens(right));
  if (Math.min(leftTokens.size, rightTokens.size) < 3) return false;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const containment = intersection / Math.min(leftTokens.size, rightTokens.size);
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return containment >= 0.8 && intersection / union >= 0.65;
}

export function filterDiagramExemplarsForEvaluation(
  exemplars: readonly DiagramExemplar[],
  evaluationQuestions: readonly string[],
): DiagramExemplar[] {
  return exemplars.filter((exemplar) =>
    !evaluationQuestions.some((question) => diagramQuestionsNearDuplicate(exemplar.question, question)));
}

export function retrieveDiagramExemplars(
  exemplars: readonly DiagramExemplar[],
  query: DiagramExampleQuery,
): DiagramExemplar[] {
  const queryTokens = new Set(diagramQuestionTokens(query.question));
  const familyHints = new Set(query.families);
  const scored = exemplars.map((exemplar) => {
    const tokens = new Set(diagramQuestionTokens(exemplar.question));
    const intersection = [...tokens].filter((token) => queryTokens.has(token)).length;
    const union = new Set([...tokens, ...queryTokens]).size;
    const lexical = intersection * 20 + (union > 0 ? intersection / union * 100 : 0);
    const family = exemplar.family && familyHints.has(exemplar.family) ? 50 : 0;
    const archetype = exemplar.archetype && exemplar.archetype === query.archetypeId ? 40 : 0;
    const promptChars = JSON.stringify(compactSceneExampleDocument(exemplar.document)).length;
    return { exemplar, score: lexical + family + archetype, promptChars };
  });
  const ordered = scored.sort((left, right) =>
    right.score - left.score || left.promptChars - right.promptChars || left.exemplar.id.localeCompare(right.exemplar.id));
  const promptable = ordered.filter((entry) => entry.promptChars <= 4_000);
  const oversized = ordered.filter((entry) => entry.promptChars > 4_000);
  return [...promptable, ...oversized]
    .slice(0, query.limit ?? 3)
    .map(({ exemplar }) => exemplar);
}

export function loadDiagramExemplarLibrary(
  path: string,
  evaluationQuestions: readonly string[],
): DiagramExemplar[] {
  const exemplars = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith("#"))
    .map((line, index) => {
      const value = JSON.parse(line) as Partial<DiagramExemplar>;
      if (
        typeof value.id !== "string" ||
        typeof value.question !== "string" ||
        typeof value.document !== "object" ||
        value.document === null ||
        Array.isArray(value.document)
      ) {
        throw new Error(`diagram exemplar line ${index + 1} is invalid`);
      }
      return {
        id: value.id,
        question: value.question,
        family: typeof value.family === "string" ? value.family : null,
        archetype: typeof value.archetype === "string" ? value.archetype : null,
        document: value.document as Record<string, unknown>,
      };
    });
  return filterDiagramExemplarsForEvaluation(exemplars, evaluationQuestions);
}
