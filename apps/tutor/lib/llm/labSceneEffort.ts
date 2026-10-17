import { isLectureLabRequest } from "../billing/flags";

export const LECTURE_LAB_SCENE_EFFORT_HEADER = "x-heytutor-lab-scene-effort";
export type LectureLabSceneEffort = "low" | "medium" | "high";

/** Authenticated experiment control, never a product setting or client body field. */
export function lectureLabSceneEffort(request: Request, env: NodeJS.ProcessEnv = process.env): LectureLabSceneEffort | undefined {
  if (!isLectureLabRequest(request, env)) return undefined;
  const effort = request.headers.get(LECTURE_LAB_SCENE_EFFORT_HEADER);
  return effort === "low" || effort === "medium" || effort === "high" ? effort : undefined;
}

/** Apply AFTER provider translation: only effort changes, not the production token ceiling. */
export function applyLectureLabSceneEffort(
  body: Record<string, unknown>,
  effort: LectureLabSceneEffort | undefined,
  context: { provider: string; semanticSceneV2: boolean; diagramExamplePicker?: boolean },
): Record<string, unknown> {
  if (!effort || context.provider !== "azure" || !context.semanticSceneV2 || context.diagramExamplePicker) return body;
  return { ...body, reasoning_effort: effort };
}
