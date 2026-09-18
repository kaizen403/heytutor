import type { Metadata } from "next";
import { TurnsLogView } from "@/features/admin/turns/TurnsLogView";

export const metadata: Metadata = {
  title: "Logs · Admin",
};

export default function AdminLogsPage() {
  return <TurnsLogView />;
}
