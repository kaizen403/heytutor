/** The existing turn-plan JSON framing, shared with optional policy metadata. */
export function parseTurnPlanJsonObject(content: string): unknown | null {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  // Keep JSON errors in the caller's existing parse-error/fail-closed path.
  return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as unknown;
}
