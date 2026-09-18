import { prisma } from "@/lib/db/prisma";
import {
  classifyOutcome,
  extractArtifactSummary,
  foldOutcomeCounts,
  type DegradationReason,
} from "./outcome";
import type {
  DegradationReasonCount,
  OutcomeCounts,
  TierCounts,
} from "./types";

/**
 * Representation tiers and degradation reasons live inside the turns'
 * `sceneArtifacts` JSON column, so they cannot be aggregated in SQL. The scan
 * is bounded to the newest 7 days of turns (plus one row to detect
 * truncation); the payload reports how many rows were actually read so the
 * dashboard can say when a number is partial.
 */
const ARTIFACT_SCAN_BUDGET = 5_000;

export interface OverviewDistributions {
  outcomesAllTime: OutcomeCounts;
  outcomes7d: OutcomeCounts;
  tiers7d: TierCounts & { scanned: number; truncated: boolean };
  degradation7d: { reasons: DegradationReasonCount[]; scanned: number; truncated: boolean };
  sceneEngineVersions30d: Array<{ version: string; count: number }>;
}

export async function fetchOverviewDistributions(windows: {
  weekAgo: Date;
  monthAgo: Date;
}): Promise<OverviewDistributions> {
  const [statusAllTime, status7d, engineRows, artifactRows] = await Promise.all([
    prisma.turn.groupBy({ by: ["visualStatus"], _count: { _all: true } }),
    prisma.turn.groupBy({
      by: ["visualStatus"],
      where: { createdAt: { gte: windows.weekAgo } },
      _count: { _all: true },
    }),
    prisma.turn.groupBy({
      by: ["sceneEngineVersion"],
      where: { createdAt: { gte: windows.monthAgo } },
      _count: { _all: true },
    }),
    prisma.turn.findMany({
      where: { createdAt: { gte: windows.weekAgo } },
      select: { visualStatus: true, sceneArtifacts: true },
      orderBy: { createdAt: "desc" },
      take: ARTIFACT_SCAN_BUDGET + 1,
    }),
  ]);

  const outcomesAllTime = foldOutcomeCounts(
    statusAllTime.map((row) => ({ visualStatus: row.visualStatus, count: row._count._all })),
  );
  const outcomes7d = foldOutcomeCounts(
    status7d.map((row) => ({ visualStatus: row.visualStatus, count: row._count._all })),
  );

  const truncated = artifactRows.length > ARTIFACT_SCAN_BUDGET;
  const scannedRows = truncated ? artifactRows.slice(0, ARTIFACT_SCAN_BUDGET) : artifactRows;
  const tiers: TierCounts = {
    exactVerified: 0,
    qualitativeVerified: 0,
    questionRepresentation: 0,
  };
  const reasonCounts = new Map<DegradationReason | "unrecorded", number>();
  for (const row of scannedRows) {
    const summary = extractArtifactSummary(row.sceneArtifacts);
    if (summary?.representationTier === "exact_verified") tiers.exactVerified += 1;
    else if (summary?.representationTier === "qualitative_verified") {
      tiers.qualitativeVerified += 1;
    } else if (summary?.representationTier === "question_representation") {
      tiers.questionRepresentation += 1;
    }
    // Degradation artifacts ride text-only/retry-required turns; legacy and
    // status-less rows have none, and counting them as a reason would invent
    // one. They land in "unrecorded" so the failure total still adds up.
    if (classifyOutcome(row.visualStatus) !== "validated") {
      const reason = summary?.degradationReason ?? "unrecorded";
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }
  const reasons: DegradationReasonCount[] = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  const sceneEngineVersions30d = engineRows
    .map((row) => ({ version: row.sceneEngineVersion ?? "unknown", count: row._count._all }))
    .sort((a, b) => b.count - a.count || a.version.localeCompare(b.version));

  return {
    outcomesAllTime,
    outcomes7d,
    tiers7d: { ...tiers, scanned: scannedRows.length, truncated },
    degradation7d: { reasons, scanned: scannedRows.length, truncated },
    sceneEngineVersions30d,
  };
}
