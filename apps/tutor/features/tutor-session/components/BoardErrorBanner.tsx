import { X } from "lucide-react";

interface BoardErrorBannerProps {
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}

export function BoardErrorBanner({ message, onRetry, onDismiss }: BoardErrorBannerProps) {
  return (
    <div className="glass-deep animate-fade-up pointer-events-auto absolute bottom-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2.5">
      <span className="text-sm text-frost">{message}</span>
      <button type="button" onClick={onRetry} className="btn-plain btn-sky h-7 rounded-md px-2.5 text-[11px]">
        Retry
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="text-soft transition-colors hover:text-frost"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
