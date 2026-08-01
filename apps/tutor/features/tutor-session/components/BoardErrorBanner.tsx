interface BoardErrorBannerProps {
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}

export function BoardErrorBanner({ message, onRetry, onDismiss }: BoardErrorBannerProps) {
  return (
    <div
      className="absolute bottom-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[#30363D] bg-[#161B22]/95 px-4 py-2.5 shadow-lg"
      style={{ pointerEvents: "auto" }}
    >
      <span className="text-sm text-[#E6EDF3]">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md px-3 py-1 text-sm text-white transition-opacity hover:opacity-90"
        style={{ background: "#238636", border: "none", cursor: "pointer" }}
      >
        retry
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="text-[#8B949E] transition-colors hover:text-[#E6EDF3]"
        style={{ border: "none", background: "none", cursor: "pointer", fontSize: "16px" }}
        aria-label="dismiss"
      >
        ×
      </button>
    </div>
  );
}
