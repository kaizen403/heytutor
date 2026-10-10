import type { SceneIssue } from "@heytutor/scene-engine";

/** The real frozen NeutralPanelPresentationDeclined class uses this exact
 * discriminant. Recognition refuses a visual only; it grants no scene authority
 * and deliberately leaves unrelated presentation failures to their caller. */
export interface VisualPresentationRefusal extends Error {
  readonly code: "neutral_panel_declined";
  readonly issues: readonly SceneIssue[];
}

function isTypedIssue(value: unknown): value is SceneIssue {
  if (!value || typeof value !== "object") return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Object.values(fields).some(field => !("value" in field))) return false;
  const read = (key: string): unknown => fields[key]?.value;
  return typeof read("code") === "string" && typeof read("message") === "string" &&
    (read("severity") === "fatal" || read("severity") === "warning") &&
    (read("path") === undefined || typeof read("path") === "string") &&
    (read("entityIds") === undefined || (Array.isArray(read("entityIds")) &&
      Array.from(read("entityIds") as unknown[]).every(id => typeof id === "string"))) &&
    (read("residual") === undefined || (typeof read("residual") === "number" && Number.isFinite(read("residual"))));
}

export function isVisualPresentationRefusal(error: unknown): error is VisualPresentationRefusal {
  try {
    if (!(error instanceof Error)) return false;
    // The real class owns both data fields. Do not run arbitrary getters while
    // deciding whether an operational exception may become a visual refusal.
    const code = Object.getOwnPropertyDescriptor(error, "code");
    const issues = Object.getOwnPropertyDescriptor(error, "issues");
    return code?.value === "neutral_panel_declined" && Array.isArray(issues?.value) &&
      Array.from(issues.value as unknown[]).every(isTypedIssue);
  } catch {
    return false;
  }
}
