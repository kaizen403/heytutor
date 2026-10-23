/**
 * Floor figure kinds, organised by what the picture is, never by chapter, and
 * chosen only from ProblemIR structure: a typed DC network or components
 * joined to stated nodes (circuit), a free-body intent with a stated
 * incidence (body), a graph intent with bound function expressions (graph).
 * With no ProblemIR there is no floor. The question's words never choose a
 * kind; inside a kind they can only make it decline.
 */
import type { SceneDocument } from "../../types";
import type { FloorFacts } from "../facts";
import { buildBodyFloor } from "./body";
import { buildCircuitFloor } from "./circuit";
import { buildGraphFloor } from "./graph";

export interface FloorKindBuild {
  document: SceneDocument;
  /** Digit-free names this kind writes on the board. */
  names: string[];
  /** True only for a kind whose arrows are stated directions (none today). */
  directedInk: boolean;
  reason: string;
}

export type FloorKindBuilder = (facts: FloorFacts) => FloorKindBuild | { declined: string } | null;

export const FLOOR_KIND_BUILDERS = {
  circuit: buildCircuitFloor,
  body: buildBodyFloor,
  graph: buildGraphFloor,
} satisfies Record<string, FloorKindBuilder>;

export type FloorKind = keyof typeof FLOOR_KIND_BUILDERS;

export function floorKindOrder(facts: FloorFacts): FloorKind[] {
  const problem = facts.problem;
  if (!problem) return [];
  const order: FloorKind[] = [];
  const intents = new Set(problem.representationIntents.map((intent) => intent.kind));
  if (problem.solveRequests.some((request) => request.kind === "dc_network") || problem.entities.some((entity) => entity.kind === "component")) order.push("circuit");
  if (intents.has("free_body")) order.push("body");
  if (intents.has("graph") && problem.expressions.some((expression) => expression.valueType === "function")) order.push("graph");
  return order;
}
