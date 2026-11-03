import type { Metadata } from "next";
import { CommunityBoardView } from "@/features/community/CommunityBoardView";
import { getCommunityBoardCard } from "@/lib/community/queries";
import { SITE_NAME } from "@/lib/site";

type CommunityBoardPageProps = {
  params: Promise<{ boardId: string }>;
};

export async function generateMetadata({ params }: CommunityBoardPageProps): Promise<Metadata> {
  const { boardId } = await params;
  const card = await getCommunityBoardCard(boardId).catch(() => null);
  if (!card) {
    return { title: "Lesson not found", robots: { index: false, follow: false } };
  }
  const description = `${card.question.slice(0, 150)} Taught on the ${SITE_NAME} whiteboard.`;
  return {
    title: card.title,
    description,
    openGraph: {
      title: `${card.title} · ${SITE_NAME}`,
      description,
      ...(card.thumbnailUrl ? { images: [{ url: card.thumbnailUrl, width: 600, height: 350 }] } : {}),
    },
  };
}

export default async function CommunityBoardPage({ params }: CommunityBoardPageProps) {
  const { boardId } = await params;
  return <CommunityBoardView boardId={boardId} />;
}
