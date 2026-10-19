/** Public, non-secret timing policy; never changes prompts or admission rules. */
export interface PlannerTimingProfile {
  version: "fireworks-planner-timing/v1";
  turnPlanMs: 30000;
  sceneMs: 120000;
  sceneCandidateMs: 60000;
}

const BALANCED: Readonly<PlannerTimingProfile> = Object.freeze({
  version: "fireworks-planner-timing/v1", turnPlanMs: 30_000,
  sceneMs: 120_000, sceneCandidateMs: 60_000,
});

/** K3 measured without thinking: turn max 25.2 s; accepted scenes 31.4–36.8 s.
 * The total includes turn 30 + unchanged authority 18 + scene 60 (108 s).
 * `legacy` restores the existing client AND proxy policy together. Other
 * providers and ancillary lanes retain their existing policy.
 */
export function resolvePlannerTimingProfile(
  provider: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<PlannerTimingProfile> | undefined {
  const setting = env.FIREWORKS_PLANNER_TIMING_PROFILE;
  return provider === "fireworks" && (setting === undefined || setting === "balanced")
    ? BALANCED : undefined;
}

/** Old clients/servers or malformed metadata safely keep legacy deadlines. */
export function parsePlannerTimingProfile(value: unknown): Readonly<PlannerTimingProfile> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const profile = value as Record<string, unknown>;
  return profile.version === BALANCED.version && profile.turnPlanMs === BALANCED.turnPlanMs &&
    profile.sceneMs === BALANCED.sceneMs && profile.sceneCandidateMs === BALANCED.sceneCandidateMs
    ? BALANCED : undefined;
}

/** Individual fallback requests must not reset generation halfway through. */
export function plannerTimingRequestCap(
  profile: Readonly<PlannerTimingProfile> | undefined,
  lane: { turnPlanV3: boolean; semanticSceneV2: boolean; problemIRV1?: boolean; codeLessonV1?: boolean; diagramExamplePicker?: boolean },
): number | undefined {
  if (!profile || lane.problemIRV1 || lane.codeLessonV1 || lane.diagramExamplePicker) return undefined;
  return lane.turnPlanV3 ? profile.turnPlanMs : lane.semanticSceneV2 ? profile.sceneCandidateMs : undefined;
}
