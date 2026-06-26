"use client";

const LIVE_SUBTITLE_MAX_CHARS = 140;

function truncateSubtitle(text: string): string {
  if (text.length <= LIVE_SUBTITLE_MAX_CHARS) {
    return text;
  }

  const truncated = text.slice(0, LIVE_SUBTITLE_MAX_CHARS).trimEnd();
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
      className="animate-wb-bubble-fade pointer-events-none absolute left-1/2 top-5 z-10 max-w-xl -translate-x-1/2 px-6 py-3"
      style={{
        backgroundColor: "rgba(255,255,255,0.92)",
        color: "#333333",
        borderRadius: "8px",
        boxShadow: "0 6px 20px -3px rgba(0, 0, 0, 0.15)",
        border: `1px solid rgba(0,119,204,0.25)`,
        backdropFilter: "blur(8px)",
      }}
    >
      <p
        className="text-center text-base font-medium leading-relaxed"
        style={{
          color: "#333333",
        }}
      >
        {displayText}
      </p>
    </div>
  );
}
