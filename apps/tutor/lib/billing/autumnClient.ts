import { Autumn } from "autumn-js";
import {
  BILLING_FEATURES,
  BILLING_PLANS,
  isKnownPlanId,
  type BillingFeatureId,
} from "./catalog";
import { isAutumnEnabled } from "./flags";

export class AutumnUnavailableError extends Error {
  constructor(message = "Autumn is enabled but unavailable") {
    super(message);
    this.name = "AutumnUnavailableError";
  }
}

export interface AutumnCheckResult {
  allowed: boolean;
  remaining: number | null;
  planId: string;
  nextResetAt: number | null;
}

export interface AutumnCustomerSnapshot {
  planId: string;
  remainingLessons: number | null;
  remainingNotes: number | null;
  nextResetAt: number | null;
}

type AutumnClient = Autumn;

let client: AutumnClient | null | undefined;
let testClient: AutumnClient | null = null;

function autumnSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.AUTUMN_SECRET_KEY?.trim() || undefined;
}

export function resetAutumnClientForTests(): void {
  client = undefined;
  testClient = null;
}

function getAutumnClient(env: NodeJS.ProcessEnv = process.env): AutumnClient {
  if (testClient) return testClient;
  if (client) return client;
  const secretKey = autumnSecret(env);
  if (!secretKey) {
    throw new AutumnUnavailableError("AUTUMN_SECRET_KEY is missing");
  }
  client = new Autumn({
    secretKey,
    failOpen: false,
  });
  return client;
}

export function requireAutumnReady(env: NodeJS.ProcessEnv = process.env): AutumnClient {
  if (!isAutumnEnabled(env)) {
    throw new AutumnUnavailableError("Autumn is not enabled");
  }
  if (!autumnSecret(env) && !testClient) {
    throw new AutumnUnavailableError("AUTUMN_SECRET_KEY is missing");
  }
  return getAutumnClient(env);
}

function isFailOpenCustomerId(customerId: string | null | undefined): boolean {
  return !customerId;
}

async function autumnCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AutumnUnavailableError) throw error;
    const message = error instanceof Error ? error.message : "Autumn request failed";
    throw new AutumnUnavailableError(message);
  }
}

export async function ensureAutumnCustomer(input: {
  userId: string;
  email?: string | null;
  name?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const autumn = requireAutumnReady(input.env);
  const customer = await autumnCall(() =>
    autumn.customers.getOrCreate({
      customerId: input.userId,
      email: input.email ?? undefined,
      name: input.name ?? undefined,
      autoEnablePlanId: BILLING_PLANS.free,
    }),
  );
  if (isFailOpenCustomerId(customer.id)) {
    throw new AutumnUnavailableError("Autumn getOrCreate failed open");
  }
}

function remainingFromCheck(result: {
  allowed?: boolean;
  customerId?: string | null;
  balance?: { remaining?: number; unlimited?: boolean; nextResetAt?: number | null } | null;
}): AutumnCheckResult {
  if (isFailOpenCustomerId(result.customerId)) {
    throw new AutumnUnavailableError("Autumn check failed open");
  }
  const unlimited = result.balance?.unlimited === true;
  const remaining = unlimited
    ? Number.POSITIVE_INFINITY
    : typeof result.balance?.remaining === "number"
      ? result.balance.remaining
      : result.allowed
        ? 1
        : 0;
  return {
    allowed: result.allowed === true,
    remaining: Number.isFinite(remaining) ? remaining : null,
    planId: BILLING_PLANS.free,
    nextResetAt: result.balance?.nextResetAt ?? null,
  };
}

export async function checkFeature(input: {
  userId: string;
  featureId: BillingFeatureId;
  requiredBalance?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<AutumnCheckResult> {
  const autumn = requireAutumnReady(input.env);
  const result = await autumnCall(() =>
    autumn.check({
      customerId: input.userId,
      featureId: input.featureId,
      requiredBalance: input.requiredBalance ?? 1,
    }),
  );
  if (!("allowed" in result)) {
    throw new AutumnUnavailableError("Autumn check returned no allowed flag");
  }
  return remainingFromCheck(result);
}

export async function trackFeature(input: {
  userId: string;
  featureId: BillingFeatureId;
  value: number;
  properties?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}): Promise<{ remaining: number | null }> {
  const autumn = requireAutumnReady(input.env);
  const result = await autumnCall(() =>
    autumn.track({
      customerId: input.userId,
      featureId: input.featureId,
      value: input.value,
      properties: input.properties,
    }),
  );
  if (isFailOpenCustomerId(result.customerId)) {
    throw new AutumnUnavailableError("Autumn track failed open");
  }
  const remaining = result.balance?.remaining;
  return { remaining: typeof remaining === "number" ? remaining : null };
}

export async function loadCustomerSnapshot(input: {
  userId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<AutumnCustomerSnapshot> {
  const autumn = requireAutumnReady(input.env);
  const customer = await autumnCall(() => autumn.customers.get({ customerId: input.userId }));
  const id = "id" in customer ? customer.id : null;
  if (isFailOpenCustomerId(id)) {
    throw new AutumnUnavailableError("Autumn customer get failed open");
  }
  const subscriptions = "subscriptions" in customer ? customer.subscriptions : [];
  const active = subscriptions.find((row) => {
    const addOn = "addOn" in row ? Boolean(row.addOn) : false;
    const status = "status" in row ? String(row.status) : "";
    return !addOn && (status === "active" || status === "trialing");
  }) ?? subscriptions.find((row) => {
    const status = "status" in row ? String(row.status) : "";
    return status === "active" || status === "trialing";
  });
  const rawPlanId =
    active && "planId" in active && typeof active.planId === "string"
      ? active.planId
      : BILLING_PLANS.free;
  const planId = isKnownPlanId(rawPlanId) ? rawPlanId : BILLING_PLANS.free;
  const balances = "balances" in customer ? customer.balances : {};
  const lessons = balances?.[BILLING_FEATURES.lessons];
  const notes = balances?.[BILLING_FEATURES.notesMessages];
  return {
    planId,
    remainingLessons: lessons?.unlimited ? null : (lessons?.remaining ?? null),
    remainingNotes: notes?.unlimited ? null : (notes?.remaining ?? null),
    nextResetAt: lessons?.nextResetAt ?? notes?.nextResetAt ?? null,
  };
}

export async function attachCheckoutPlan(input: {
  userId: string;
  planId: string;
  successUrl: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ url: string | null }> {
  const autumn = requireAutumnReady(input.env);
  await ensureAutumnCustomer({ userId: input.userId, env: input.env });
  const result = await autumnCall(() =>
    autumn.billing.attach({
      customerId: input.userId,
      planId: input.planId,
      successUrl: input.successUrl,
      redirectMode: "if_required",
    }),
  );
  return { url: result.paymentUrl };
}

export async function attachTopUp(input: {
  userId: string;
  successUrl: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ url: string | null }> {
  return attachCheckoutPlan({
    userId: input.userId,
    planId: BILLING_PLANS.lessonTopUp,
    successUrl: input.successUrl,
    env: input.env,
  });
}

export async function openBillingPortal(input: {
  userId: string;
  returnUrl: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ url: string }> {
  const autumn = requireAutumnReady(input.env);
  await ensureAutumnCustomer({ userId: input.userId, env: input.env });
  const result = await autumnCall(() =>
    autumn.billing.openCustomerPortal({
      customerId: input.userId,
      returnUrl: input.returnUrl,
    }),
  );
  return { url: result.url };
}

export function unlimitedSnapshot(planId = BILLING_PLANS.pro): AutumnCustomerSnapshot {
  return {
    planId,
    remainingLessons: null,
    remainingNotes: null,
    nextResetAt: null,
  };
}
