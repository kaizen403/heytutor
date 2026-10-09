export type LabSpendMode = "conservative" | "response_usage";

export interface LabUsageObservation {
  model: string;
  measuredUsd: number | null;
  unresolvedAttempts: number;
  unresolvedAllowanceUsd: number;
  reason: string | null;
}

export interface LabUnresolvedCall {
  traceId: string | null;
  kind: "planner" | "teaching" | "picker" | "visual_need" | "checkpoint";
  model: string;
  attempts: number;
  allowanceUsd: number;
  reason: string;
}

/** Missing input or output cannot be priced even when a provider reports total tokens. */
export function hasPricedUsage(usage: { known: boolean; input?: number; output?: number } | null): boolean {
  return Boolean(usage?.known && usage.input !== undefined && usage.output !== undefined);
}

export function assertLabSpendMode(saved: LabSpendMode | undefined, requested: LabSpendMode): void {
  if ((saved ?? "conservative") !== requested) throw new Error("resume requires the identical --spend-mode; legacy checkpoints are conservative");
}

/** Response mode cannot restore unexplained charges as measured usage. */
export function assertLabUsageCheckpoint(checkpoint: { chargedUsd: number; knownUsageUsd?: number }, mode: LabSpendMode): void {
  const known = checkpoint.knownUsageUsd;
  if (known === undefined && mode === "conservative") return;
  if (known === undefined || !Number.isFinite(known) || known < 0 || !Number.isFinite(checkpoint.chargedUsd) ||
    known > checkpoint.chargedUsd + 1e-6 || (mode === "response_usage" && Math.abs(known - checkpoint.chargedUsd) > 1e-6)) {
    throw new Error("invalid known usage checkpoint: response charges require the measured subtotal");
  }
}
