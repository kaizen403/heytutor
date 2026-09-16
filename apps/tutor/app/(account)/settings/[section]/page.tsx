import { notFound } from "next/navigation";
import { SettingsScreen } from "@/features/account/SettingsScreen";
import { isSettingsSection } from "@/lib/account/types";

type SettingsSectionPageProps = {
  params: Promise<{ section: string }>;
};

export default async function SettingsSectionPage({ params }: SettingsSectionPageProps) {
  const { section } = await params;
  if (!isSettingsSection(section)) notFound();
  return <SettingsScreen section={section} />;
}
