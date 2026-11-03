import type { Metadata } from "next";
import { CommunityGallery } from "@/features/community/CommunityGallery";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Community",
  description: `Lessons students asked ${SITE_NAME} to teach, drawn on a whiteboard as the tutor explains. Watch any of them, or remix one into your own board.`,
  openGraph: {
    title: `${SITE_NAME} Community`,
    description: "Whiteboard lessons from students everywhere. Watch any of them free.",
  },
};

export default function CommunityPage() {
  return <CommunityGallery />;
}
