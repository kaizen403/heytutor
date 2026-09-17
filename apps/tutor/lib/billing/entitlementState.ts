export interface Entitlement {
  planId: string;
  remainingPct: number | null;
  nextResetAt: number | null;
  staff: boolean;
}

let snapshot: Entitlement | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getEntitlementSnapshot(): Entitlement | null {
  return snapshot;
}

export function subscribeEntitlement(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setEntitlementSnapshot(next: Entitlement | null): void {
  snapshot = next;
  emit();
}

export function patchEntitlementSnapshot(partial: Partial<Entitlement>): void {
  snapshot = {
    planId: partial.planId ?? snapshot?.planId ?? "free",
    remainingPct:
      partial.remainingPct !== undefined ? partial.remainingPct : (snapshot?.remainingPct ?? null),
    nextResetAt: partial.nextResetAt !== undefined ? partial.nextResetAt : (snapshot?.nextResetAt ?? null),
    staff: partial.staff ?? snapshot?.staff ?? false,
  };
  emit();
}
