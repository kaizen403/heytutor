import { Prisma } from "@prisma/client";
import type { TurnFailureInput } from "../../lib/obs/turnFailureClassification";

// Evaluate the concrete positive Prisma predicate on deterministic fixtures.
// JSON path absence is false; it is never treated as NOT(true) or a failure.
export function matches(row: TurnFailureInput, where: unknown): boolean {
  const condition = where as Record<string, unknown>;
  if (Array.isArray(condition.AND) && !condition.AND.every((child) => matches(row, child))) return false;
  if (Array.isArray(condition.OR) && !condition.OR.some((child) => matches(row, child))) return false;
  for (const [key, value] of Object.entries(condition)) {
    if (key === "AND" || key === "OR") continue;
    if (key === "sceneArtifacts") {
      const json = value as { path: string[]; equals?: unknown; not?: unknown };
      let actual: unknown = row.sceneArtifacts;
      for (const part of json.path) actual = actual !== null && typeof actual === "object" ? (actual as Record<string, unknown>)[part] : undefined;
      if ("not" in json) {
        if (actual == null || actual === json.not) return false;
      } else if (json.equals === Prisma.AnyNull ? actual !== undefined && actual !== null : actual !== json.equals) return false;
    } else if (key === "segments") {
      const count = row.segments?.length ?? row.segmentCount ?? 0;
      if ("some" in (value as object) ? count === 0 : count !== 0) return false;
    } else if (key === "visualStatus" || key === "status") {
      const actual = row[key] ?? null;
      if (value !== null && typeof value === "object" && "in" in value) {
        if (!(value as { in: unknown[] }).in.includes(actual)) return false;
      } else if (actual !== value) return false;
    } else throw new Error(`unsupported predicate fixture field ${key}`);
  }
  return true;
}
