/** Shared subject vocabulary for labelled eval rows and semantic live plans. */
import { parseTurnPlanJsonObject } from "./turnPlanJson";

export type DiagramSubject = "maths" | "physics" | "chemistry" | "other";

export function parseDiagramSubject(value: unknown): DiagramSubject {
  return value === "maths" || value === "physics" || value === "chemistry" ? value : "other";
}

export function parseDiagramStrictSubjects(value: unknown): DiagramSubject[] {
  const entries = typeof value === "string" ? value.split(/[\s,]+/) : Array.isArray(value) ? value : [];
  return [...new Set(entries.map(parseDiagramSubject).filter((subject) => subject !== "other"))];
}

export function subjectFromTurnPlanContent(content: string): DiagramSubject {
  try {
    const parsed = parseTurnPlanJsonObject(content);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parseDiagramSubject((parsed as Record<string, unknown>).subject) : "other";
  } catch {
    return "other";
  }
}
