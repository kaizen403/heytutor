import type { Metadata } from "next";
import { FailsView } from "@/features/admin/turns/FailsView";

export const metadata: Metadata = {
  title: "Fails · Admin",
};

export default function AdminFailsPage() {
  return <FailsView />;
}
