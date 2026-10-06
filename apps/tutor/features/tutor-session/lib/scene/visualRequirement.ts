import type { VisualRequirement } from "@heytutor/scene-engine";
import type { VisualNeedDecision } from "@/lib/llm/visualNeedPolicy";
import { diagramFailureVisualStatus } from "./diagramGeneration";

/** Jev resolves uncertain plans; explicit or structural requirements stay required. */
export function resolveVisualRequirement(
  planned: VisualRequirement,
  evaluated: VisualNeedDecision | null,
  deterministicRequired: boolean,
  sourceProgram = false,
): VisualRequirement {
  if (planned === "required" || evaluated === "required" || deterministicRequired) return "required";
  // Jev unavailable (null: timeout, open circuit, no gateway key) is not a
  // "none" decision. A question the engine reads as a complete source program
  // (a matrix premise it binds) may still draw that program; every other
  // planner "none" stands, so no figure is invented without a bound source.
  if (evaluated === null && planned === "none" && sourceProgram) return "optional";
  return evaluated ?? planned;
}

export function resolveSelectedVisualStatus(
  requirement: VisualRequirement,
  hasReadableScene: boolean,
): "validated" | "retry_required" | "text_only" {
  if (hasReadableScene) return "validated";
  return diagramFailureVisualStatus(requirement);
}
