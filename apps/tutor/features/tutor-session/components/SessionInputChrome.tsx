import { InputBar } from "@/components/InputBar";
import type { TutorPhase } from "../types";

interface SessionInputChromeProps {
  isInputOverlay: boolean;
  phase: TutorPhase;
  isPaused: boolean;
  inputSubmitMode: "ask" | "doubt";
  onSubmit: (question: string) => void;
  onAskDoubt: (question: string) => void;
  onPauseToggle: () => void;
  onCancel: () => void;
  onUserInteractionChange: (interacted: boolean) => void;
}

export function SessionInputChrome({
  isInputOverlay,
  phase,
  isPaused,
  inputSubmitMode,
  onSubmit,
  onAskDoubt,
  onPauseToggle,
  onCancel,
  onUserInteractionChange,
}: SessionInputChromeProps) {
  return (
    <div
      className="flex w-full items-center gap-3"
      style={{
        maxWidth: isInputOverlay
          ? "min(720px, 100%)"
          : "min(48rem, calc(100vw - 1.5rem))",
        margin: "0 auto",
      }}
    >
      <div className="min-w-0 flex-1">
        <InputBar
          onSubmit={onSubmit}
          onAskDoubt={onAskDoubt}
          disabled={phase !== "idle"}
          submitMode={inputSubmitMode}
          isPaused={isPaused}
          onPauseToggle={onPauseToggle}
          onCancel={onCancel}
          onUserInteractionChange={onUserInteractionChange}
        />
      </div>
    </div>
  );
}
