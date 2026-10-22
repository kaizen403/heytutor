/** Server-owned planner transport; no client body can select a paid service tier. */
export function plannerSpeedSettings(env: Record<string, string | undefined> = process.env) {
  return {
    priority: env.DIAGRAM_PLANNER_PRIORITY === "1",
  };
}

export function applyPlannerSpeedSettings(
  body: Record<string, unknown>,
  context: { provider: string },
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  if (context.provider !== "azure" || !plannerSpeedSettings(env).priority) return body;
  return { ...body, service_tier: "priority" };
}

/** A missing/unknown returned tier never makes a requested priority call cheap. */
export function plannerTierCostMultiplier(returnedTier: unknown, requestedPriority: boolean): 1 | 2 {
  return returnedTier === "priority" || (requestedPriority && returnedTier !== "default") ? 2 : 1;
}
