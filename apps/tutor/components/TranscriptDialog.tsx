"use client";

export interface TranscriptDialogProps {
  text: string;
  open: boolean;
  onClose: () => void;
}

export function TranscriptDialog({ text, open, onClose }: TranscriptDialogProps) {
  if (!open || !text) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(6, 42, 48, 0.55)" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Lesson transcript"
        className="flex max-h-[min(70vh,520px)] w-full max-w-lg flex-col overflow-hidden"
        style={{
          backgroundColor: "#135D66",
          borderRadius: "12px",
          border: "1px solid rgba(119, 176, 170, 0.3)",
          boxShadow: "0 16px 48px -8px rgba(0, 0, 0, 0.45)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: "1px solid rgba(119, 176, 170, 0.2)" }}
        >
          <h2
            className="text-sm font-semibold tracking-wide"
            style={{ color: "#E3FEF7" }}
          >
            transcript
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close transcript"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors"
            style={{ color: "rgba(227, 254, 247, 0.8)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <p
            className="text-base leading-relaxed"
            style={{ color: "rgba(227, 254, 247, 0.92)" }}
          >
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}
