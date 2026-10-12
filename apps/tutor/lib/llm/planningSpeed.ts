/** Server-owned experiments; no client body can select a paid service tier. */
export function plannerSpeedSettings(env: Record<string, string | undefined> = process.env) {
  return {
    sceneEffort: env.DIAGRAM_SCENE_REASONING_EFFORT === "medium" ? "medium" as const : "low" as const,
    priority: env.DIAGRAM_PLANNER_PRIORITY === "1",
  };
}

export function applyPlannerSpeedSettings(
  body: Record<string, unknown>,
  context: { provider: string; scene: boolean },
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  if (context.provider !== "azure") return body;
  const settings = plannerSpeedSettings(env);
  const forceStandard = env.DIAGRAM_PLANNER_PRIORITY === "0";
  if (!settings.priority && !forceStandard && (!context.scene || settings.sceneEffort === "low")) return body;
  const result = { ...body };
  if (settings.priority) result.service_tier = "priority";
  else if (forceStandard) result.service_tier = "default";
  if (context.scene && settings.sceneEffort === "medium") {
    delete result.thinking;
    result.reasoning_effort = "medium";
  }
  return result;
}

/** A missing/unknown returned tier never makes a requested priority call cheap. */
export function plannerTierCostMultiplier(returnedTier: unknown, requestedPriority: boolean): 1 | 2 {
  return returnedTier === "priority" || (requestedPriority && returnedTier !== "default") ? 2 : 1;
}
