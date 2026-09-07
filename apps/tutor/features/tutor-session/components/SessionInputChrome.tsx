import { InputBar } from "@/features/tutor-session/components/InputBar";
import { MarkedDoubtBar } from "@/features/tutor-session/components/MarkedDoubtBar";
import type { SubjectFamiliarity } from "@heytutor/tutor-core";
import type { BoardMark } from "../lib/board/boardMarking";
import type { TutorPhase } from "../types";

interface SessionInputChromeProps {
  isInputOverlay: boolean;
  phase: TutorPhase;
  isPaused: boolean;
  inputSubmitMode: "ask" | "doubt" | "follow-up";
  onSubmit: (question: string) => void;
  onAskDoubt: (question: string) => void;
  onPauseToggle: () => void;
  onCancel: () => void;
  onUserInteractionChange: (interacted: boolean) => void;
  onOpenSettings?: () => void;
  /** The student's marker, when this board has something worth marking. */
  canMark?: boolean;
  markingArmed?: boolean;
  marks?: BoardMark[];
  atMarkLimit?: boolean;
  onToggleMarking?: () => void;
  onRemoveMark?: (id: string, targetIndex?: number) => void;
  onClearMarks?: () => void;
  onDisarmMarking?: () => void;
  /** How well the student knows this topic; chosen per question in the bar. */
  familiarity?: SubjectFamiliarity;
  onFamiliarityChange?: (familiarity: SubjectFamiliarity) => void;
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
  onOpenSettings,
  canMark = false,
  markingArmed = false,
  marks = [],
  atMarkLimit = false,
  onToggleMarking,
  onRemoveMark,
  onClearMarks,
  onDisarmMarking,
  familiarity,
  onFamiliarityChange,
}: SessionInputChromeProps) {
  return (
    <div
      className="flex w-full flex-col items-stretch gap-2"
      style={{
        maxWidth: isInputOverlay
          ? "min(720px, 100%)"
          : "min(48rem, calc(100vw - 1.5rem))",
        margin: "0 auto",
      }}
    >
      {/* What the board understood, directly above where the doubt is typed —
          so the student reads the resolved line before pressing Ask. */}
      <MarkedDoubtBar
        armed={markingArmed}
        marks={marks}
        atMarkLimit={atMarkLimit}
        onRemove={(id, targetIndex) => onRemoveMark?.(id, targetIndex)}
        onClear={() => onClearMarks?.()}
        onDone={() => onDisarmMarking?.()}
      />
      <div className="flex w-full min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <InputBar
            onSubmit={onSubmit}
            onAskDoubt={onAskDoubt}
            disabled={phase !== "idle"}
            placeholder={
              inputSubmitMode === "follow-up"
                ? "Ask a doubt or the next question"
                : "Ask a question or paste a photo"
            }
            submitMode={inputSubmitMode}
            isPaused={isPaused}
            onPauseToggle={onPauseToggle}
            onCancel={onCancel}
            onUserInteractionChange={onUserInteractionChange}
            onOpenSettings={onOpenSettings}
            canMark={canMark}
            markingArmed={markingArmed}
            markCount={marks.length}
            onToggleMarking={onToggleMarking}
            familiarity={familiarity}
            onFamiliarityChange={onFamiliarityChange}
          />
        </div>
      </div>
    </div>
  );
}
