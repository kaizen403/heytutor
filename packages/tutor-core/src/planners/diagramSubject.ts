/** Shared subject vocabulary for labelled eval rows and semantic live plans. */
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
    return parseDiagramSubject(JSON.parse(content).subject);
  } catch {
    return "other";
  }
}
