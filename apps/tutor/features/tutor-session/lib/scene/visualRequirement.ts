import type { VisualRequirement } from "@heytutor/scene-engine";
import type { VisualNeedDecision } from "@/lib/llm/visualNeedPolicy";
import { diagramFailureVisualStatus } from "./diagramGeneration";

/** Jev resolves uncertain plans; explicit or structural requirements stay required. */
export function resolveVisualRequirement(
  planned: VisualRequirement,
  evaluated: VisualNeedDecision | null,
  deterministicRequired: boolean,
): VisualRequirement {
  return planned === "required" || evaluated === "required" || deterministicRequired
    ? "required"
    : evaluated ?? planned;
}

export function resolveSelectedVisualStatus(
  requirement: VisualRequirement,
  hasReadableScene: boolean,
): "validated" | "retry_required" | "text_only" {
  if (hasReadableScene) return "validated";
  return diagramFailureVisualStatus(requirement);
}
