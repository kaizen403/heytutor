"use client";

import { PenSpinner } from "@heytutor/whiteboard/pen-spinner";

interface ThinkingOverlayProps {
  message?: string;
}

export function ThinkingOverlay({ message = "thinking about how to teach this…" }: ThinkingOverlayProps) {
  return (
    <div
      className="absolute inset-0 z-20 pointer-events-none"
      style={{
        background:
          "linear-gradient(180deg, rgba(11,11,12,0.72) 0%, rgba(21,21,23,0.88) 100%)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-1 overflow-hidden">
        <div className="wb-progress-bar" />
      </div>
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <PenSpinner size={56} ink="#C9C9D2" label={message} />
        <p style={{ fontSize: "0.9rem", color: "#C9C9D2", fontWeight: 500 }}>
          {message}
        </p>
      </div>
    </div>
  );
}
