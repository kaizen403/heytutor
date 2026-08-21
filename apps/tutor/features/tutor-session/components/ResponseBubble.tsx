"use client";

import { formatLiveSubtitle } from "@/lib/client/subtitleText";

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
        backgroundColor: "rgba(22, 27, 34, 0.94)",
        color: "#E6EDF3",
        borderRadius: "10px",
        boxShadow: "0 8px 24px -4px rgba(0, 0, 0, 0.45)",
        border: "1px solid rgba(240, 246, 252, 0.1)",
        backdropFilter: "blur(8px)",
      }}
    >
      <p
        className="text-center text-sm font-medium leading-relaxed md:text-base"
        style={{
          color: "#E6EDF3",
        }}
      >
        {displayText}
      </p>
    </div>
  );
}
