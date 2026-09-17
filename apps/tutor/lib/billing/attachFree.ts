import { ensureAutumnCustomer } from "./autumnClient";
import { isAutumnEnabled } from "./flags";

export async function attachFreePlan(input: {
  userId: string;
  email?: string | null;
  name?: string | null;
}): Promise<void> {
  if (!isAutumnEnabled()) return;
  await ensureAutumnCustomer(input);
}
