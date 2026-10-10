import { useEffect, useRef } from "react";
import { useTurnControl } from "./turn/useTurnControl";
import { useQuestionHandler } from "./turn/useQuestionHandler";
import type { HandleQuestionOptions, UseTurnLifecycleParams } from "./turn/types";

export type { UseTurnLifecycleParams } from "./turn/types";

export function useTurnLifecycle(params: UseTurnLifecycleParams) {
  const handleQuestionRef = useRef<
    (question: string, options?: HandleQuestionOptions) => Promise<void>
  >(async () => {});
  const turnControl = useTurnControl(params, handleQuestionRef);
  const { handleQuestion } = useQuestionHandler(params, turnControl);

  useEffect(() => {
    handleQuestionRef.current = handleQuestion;
  }, [handleQuestion]);

  return {
    finishLectureUi: turnControl.finishLectureUi,
    applyTurnPhase: turnControl.applyTurnPhase,
    stopTurn: turnControl.stopTurn,
    pauseTurn: turnControl.pauseTurn,
    resumeTurn: turnControl.resumeTurn,
    handleQuestion,
    handleAskDoubt: turnControl.handleAskDoubt,
    flushPausedLesson: turnControl.flushPausedLesson,
    pausedLessonOffer: turnControl.pausedLessonOffer,
    /** "stop" or "doubt": which words the paused lesson bar shows. */
    pausedLessonReason: turnControl.pausedLessonReason,
    /** Offer the stopped lesson a restored board's saved turns leave (never continues). */
    restorePausedLesson: turnControl.restorePausedLesson,
  };
}
