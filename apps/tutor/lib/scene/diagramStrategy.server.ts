import { parseDiagramYieldPolicy } from "@heytutor/scene-engine";
import { createHash } from "node:crypto";
import { parseDiagramStrictSubjects } from "@heytutor/tutor-core";
import type { DiagramStrategy } from "@/features/tutor-session/lib/scene/diagramStrategy";

interface StrategyActor {
  userId: string;
  email: string | null;
}

interface StrategyEnvironment {
  percent?: string;
  allowlist?: string;
}

/** Independent subject opt-in. Global cohort flags retain their original meaning. */
export function resolveDiagramStrictSubjects(raw = process.env.DIAGRAM_STRICT_SUBJECTS) {
  return parseDiagramStrictSubjects(raw);
}

function rolloutPercent(raw: string | undefined): number {
  const parsed = Number(raw ?? "0");
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
}

function allowlistEntries(raw: string | undefined): Set<string> {
  return new Set((raw ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean));
}

function stableBucket(userId: string): number {
  return createHash("sha256").update(userId).digest().readUInt32BE(0) % 10_000;
}

/** Server-only cohort assignment. Eligibility is decided later from the turn. */
export function resolveDiagramStrategyAssignment(
  actor: StrategyActor,
  environment: StrategyEnvironment = {
    percent: process.env.DIAGRAM_STRICT_PERCENT,
    allowlist: process.env.DIAGRAM_STRICT_ALLOWLIST,
  },
): DiagramStrategy {
  const allowlist = allowlistEntries(environment.allowlist);
  const userId = actor.userId.trim().toLowerCase();
  const email = actor.email?.trim().toLowerCase() ?? "";
  if (allowlist.has(userId) || (email.length > 0 && allowlist.has(email))) return "strict";
  const threshold = Math.round(rolloutPercent(environment.percent) * 100);
  return stableBucket(actor.userId) < threshold ? "strict" : "current";
}

export function resolveDiagramYieldPolicy(raw = process.env.DIAGRAM_YIELD_POLICY) {
  return parseDiagramYieldPolicy(raw);
}

/** Switch for strict drawing the owning optics archetype: only `OPTICS_ARCHETYPE_IN_STRICT=on` turns it on; default off. */
export function resolveOpticsArchetypeInStrict(raw = process.env.OPTICS_ARCHETYPE_IN_STRICT): boolean {
  return (raw ?? "").trim().toLowerCase() === "on";
}

/**
 * Reference pictures (a judged Commons or generated picture drawn when no
 * verified figure could be): off unless `DIAGRAM_REFERENCE_PICTURE=on`.
 */
export function resolveReferencePictureEnabled(raw = process.env.DIAGRAM_REFERENCE_PICTURE): boolean {
  return raw?.trim().toLowerCase() === "on";
}

/**
 * Pointing at a picture's parts (`[FOCUS:reference_picture.part.<n>]`): off
 * unless `REFERENCE_PICTURE_PART_FOCUS=on`. Off, the server serves and saves
 * records without `parts`, so the turn has only the whole picture to point at,
 * exactly as before. Located parts are still stored, so turning it on needs no
 * re-judging.
 */
export function resolveReferencePicturePartFocusEnabled(raw = process.env.REFERENCE_PICTURE_PART_FOCUS): boolean {
  return raw?.trim().toLowerCase() === "on";
}
