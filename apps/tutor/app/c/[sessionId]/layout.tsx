import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";

type SessionLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ sessionId: string }>;
};

export async function generateMetadata({ params }: Pick<SessionLayoutProps, "params">): Promise<Metadata> {
  const { sessionId } = await params;

  return {
    title: "Whiteboard session",
    description: `Private tutoring session on ${SITE_NAME}.`,
    robots: {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    },
    openGraph: {
      title: `${SITE_NAME} — Whiteboard session`,
      description: "Your private AI whiteboard tutoring session.",
    },
    other: {
      "heytutor:session-id": sessionId,
    },
  };
}

export default function SessionLayout({ children }: SessionLayoutProps) {
  return children;
}
