import { UsageScreen } from "@/features/account/UsageScreen";

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan } = await searchParams;
  return <UsageScreen selectedPlan={plan === "plus" ? plan : null} />;
}
