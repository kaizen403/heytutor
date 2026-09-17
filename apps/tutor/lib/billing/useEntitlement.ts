"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { fetchEntitlement } from "./billingClient";
import {
  getEntitlementSnapshot,
  subscribeEntitlement,
  type Entitlement,
} from "./entitlementState";

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
    await fetchEntitlement().catch(() => undefined);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entitlement, loading, refresh };
}
