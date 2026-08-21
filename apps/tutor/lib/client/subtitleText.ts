/**
 * Live subtitle copy shown on the whiteboard — plain speech, no dash/underscore punctuation.
 */
export function formatLiveSubtitle(text: string): string {
  return text
    .replace(/__/g, " ")
    .replace(/_/g, " ")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/([a-z0-9])[—–]([a-z0-9])/gi, "$1, $2")
    .replace(/\s+-\s+/g, ", ")
    .replace(/,\s*,+/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/^,\s*/, "")
    .replace(/,\s*$/, "")
    .trim();
}
