import type { Metadata } from "next";
import { CoverageView } from "@/features/admin/turns/CoverageView";

export const metadata: Metadata = {
  title: "Coverage · Admin",
};

export default function AdminCoveragePage() {
  return <CoverageView />;
}
