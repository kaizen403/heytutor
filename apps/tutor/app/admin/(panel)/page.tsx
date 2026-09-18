import type { Metadata } from "next";
import { OverviewView } from "@/features/admin/analytics/OverviewView";

export const metadata: Metadata = {
  title: "Overview · Admin",
};

export default function AdminOverviewPage() {
  return <OverviewView />;
}
