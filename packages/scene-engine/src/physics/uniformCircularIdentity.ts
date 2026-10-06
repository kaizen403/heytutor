import { validateProblemIR, type ProblemIR } from "../ir/problemIR";
import type { SceneDocument, SceneIssue } from "../types";
import { readUniformCircularSource } from "./uniformCircularSource";
import { validateUniformCircularSourceInputs } from "./uniformCircularSourceBinding";

import { uniformCircularSourceNames } from "./uniformCircularSourceNames";

/** An alias is an independently proved physical identity, never an extra text body. */
export function uniformCircularProblemEntitySceneId(document: SceneDocument, problem: ProblemIR, entityId: string): string | null {
  if (!validateProblemIR(problem, problem.question).valid) return null;
  const source = readUniformCircularSource(problem.question);
  const names = uniformCircularSourceNames(problem.question);
  if (source?.status !== "numeric" || !names || validateUniformCircularSourceInputs(document, problem.question).some(issue => issue.severity === "fatal")) return null;
  const entity = problem.entities.find(candidate => candidate.id === entityId);
  if (!entity) return null;
  const facts = new Map(problem.facts.map(fact => [fact.id, fact]));
  const quotes = entity.evidenceFactIds.flatMap(id => facts.get(id) && facts.get(id)!.kind !== "requested" ? [facts.get(id)!.evidence.quote.toLowerCase()] : []);
  const label = entity.label?.toLowerCase();
  if (["body", "point"].includes(entity.kind) && label === names.actor && quotes.some(quote => quote.includes(names.actor) || /\buniform circular motion\b/.test(quote))) {
    return document.entities.some(candidate => candidate.id === "body") ? "body" : "P";
  }
  if (entity.kind === "curve" && label === names.path && quotes.some(quote => /\bcircl|\bradius\b/.test(quote))) return "path";
  if (entity.kind === "point" && ["centre", "center", `centre of ${names.path}`, `center of ${names.path}`].includes(label ?? "")
    && quotes.some(quote => /\bcircl|\bradius\b/.test(quote))) return "O";
  return null;
}

/** A source period can be visibly carried by its certified caption without inventing a scalar input. */
export function uniformCircularSourceDimensionIsCarried(document: SceneDocument, problem: ProblemIR, expressionId: string, value: number, factIds: readonly string[]): boolean | null {
  const source = readUniformCircularSource(problem.question);
  if (source?.status !== "numeric") return null;
  if (!validateProblemIR(problem, problem.question).valid || validateUniformCircularSourceInputs(document, problem.question).some(issue => issue.severity === "fatal")) return false;
  const expression = problem.expressions.find(row => row.id === expressionId);
  if (!expression || expression.root.kind !== "number" || expression.root.value !== value) return false;
  const facts = factIds.map(id => problem.facts.find(fact => fact.id === id));
  const givens = source.givens.filter(given => given.value === value && facts.some(fact => fact?.kind === "given" && fact.evidence.quote.includes(given.text)));
  if (givens.length !== 1) return false;
  return givens[0]!.role === "period" ? document.annotations.some(annotation => annotation.id === "source_period" && annotation.targetIds.includes("path")) : null;
}

/** Account for every physical IR entity, including entities omitted by intents. */
export function uniformCircularProblemSourceIssues(document: SceneDocument, problem: ProblemIR): SceneIssue[] {
  if (readUniformCircularSource(problem.question)?.status !== "numeric") return [];
  const used = new Set<string>();
  const issues: SceneIssue[] = [];
  for (const entity of problem.entities) {
    const bound = uniformCircularProblemEntitySceneId(document, problem, entity.id);
    if (!bound || used.has(bound)) issues.push({ code: "ucm_problem_identity", severity: "fatal",
      path: `problemIR.entities.${entity.id}`, message: "Every circular source entity needs a distinct physical source binding." });
    else used.add(bound);
  }
  return issues;
}
