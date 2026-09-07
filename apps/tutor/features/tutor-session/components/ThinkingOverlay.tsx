"use client";

interface ThinkingOverlayProps {
  message?: string;
}

/**
 * The pause before the tutor writes. The board stays a whiteboard through it —
 * no frost, no second spinner — so the Konva marker can keep its pending twirl
 * where it last wrote. Chrome is only a top progress strip and a short label.
 */
export function ThinkingOverlay({ message = "thinking…" }: ThinkingOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div className="absolute left-0 right-0 top-0 h-1 overflow-hidden">
        <div className="wb-progress-bar" />
      </div>
      <p className="wb-scrim-ink absolute left-1/2 top-6 -translate-x-1/2 text-[0.9rem] font-medium">
        {message}
      </p>
    </div>
  );
}
