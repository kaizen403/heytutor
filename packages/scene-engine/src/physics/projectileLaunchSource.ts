import { firstAngle } from "../archetypes/slots";

/** A later object's angle is not a measurement of the launch direction. */
export function projectileLaunchAngle(question: string): number | null {
  const launchStart = /\b(?:launched|projected|thrown)\b/i.exec(question);
  const launchClause = launchStart ? question.slice(launchStart.index)
    .split(/\.(?!\d)|[;!?]|\band\b(?!\s+(?:(?:an?|the)\s+)?angle\s+(?:of\s+|is\s+)?\(?\s*[+-]?\d)|\b(?:hence|show|it|maximum)\b/i)[0]! : "";
  return /\bhorizontally\b/i.test(launchClause) ? 0
    : /(?:\btheta\b|θ)(?!\s*[=:])/i.test(launchClause) ? null : firstAngle(launchClause);
}
