import type { Metadata } from "next";
import { CommunityModerationView } from "@/features/admin/community/CommunityModerationView";

export const metadata: Metadata = {
  title: "Community · Admin",
};

export default function AdminCommunityPage() {
  return <CommunityModerationView />;
}
