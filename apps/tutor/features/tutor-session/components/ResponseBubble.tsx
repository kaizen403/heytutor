"use client";

import { formatLiveSubtitle } from "@/lib/client/subtitleText";
import { MathText } from "@/features/tutor-session/components/MathText";

const LIVE_SUBTITLE_MAX_CHARS = 140;

function truncateSubtitle(text: string): string {
  const cleaned = formatLiveSubtitle(text);

  if (cleaned.length <= LIVE_SUBTITLE_MAX_CHARS) {
    return cleaned;
  }

  const truncated = cleaned.slice(0, LIVE_SUBTITLE_MAX_CHARS).trimEnd();
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > LIVE_SUBTITLE_MAX_CHARS * 0.6) {
    return `${truncated.slice(0, lastSpace)}…`;
  }

  return `${truncated}…`;
}

export interface ResponseBubbleProps {
  text: string;
  visible: boolean;
}

export function ResponseBubble({ text, visible }: ResponseBubbleProps) {
  if (!visible || !text) {
    return null;
  }

  const displayText = truncateSubtitle(text);

  return (
    <div
      className="animate-wb-bubble-fade pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[calc(100%-2rem)] -translate-x-1/2 px-4 py-3 md:bottom-5 md:max-w-xl md:px-6"
      style={{
        backgroundColor: "rgba(21, 21, 23, 0.94)",
        color: "#F2F2F4",
        borderRadius: "12px",
        boxShadow: "0 10px 30px -8px rgba(0, 0, 0, 0.55)",
        border: "1px solid rgba(242, 242, 244, 0.08)",
        backdropFilter: "blur(8px)",
      }}
    >
      <p
        className="text-center text-sm font-medium leading-relaxed md:text-base"
        style={{
          color: "#F2F2F4",
        }}
      >
        <MathText>{displayText}</MathText>
      </p>
    </div>
  );
}
