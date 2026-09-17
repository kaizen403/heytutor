"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { fetchEntitlement } from "./billingClient";
import {
  getEntitlementSnapshot,
  subscribeEntitlement,
  type Entitlement,
} from "./entitlementState";

async function loadEntitlement(): Promise<void> {
  await fetchEntitlement().catch(() => undefined);
}

export function useEntitlement(): {
  entitlement: Entitlement | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const entitlement = useSyncExternalStore(
    subscribeEntitlement,
    getEntitlementSnapshot,
    () => null,
  );
  const [loading, setLoading] = useState(entitlement == null);

  const refresh = useCallback(async () => {
    setLoading(getEntitlementSnapshot() == null);
    await loadEntitlement();
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadEntitlement().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { entitlement, loading, refresh };
}
