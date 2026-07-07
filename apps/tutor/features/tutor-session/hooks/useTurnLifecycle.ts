import { useRef } from "react";
import { useTurnControl } from "./turn/useTurnControl";
import { useQuestionHandler } from "./turn/useQuestionHandler";
import type { UseTurnLifecycleParams } from "./turn/types";

export type { UseTurnLifecycleParams } from "./turn/types";

export function useTurnLifecycle(params: UseTurnLifecycleParams) {
  const handleQuestionRef = useRef<(question: string) => Promise<void>>(async () => {});
  const turnControl = useTurnControl(params, handleQuestionRef);
  const { handleQuestion } = useQuestionHandler(params, turnControl);
  handleQuestionRef.current = handleQuestion;

  return {
    finishLectureUi: turnControl.finishLectureUi,
    applyTurnPhase: turnControl.applyTurnPhase,
    stopTurn: turnControl.stopTurn,
    pauseTurn: turnControl.pauseTurn,
    resumeTurn: turnControl.resumeTurn,
    handleQuestion,
    handleAskDoubt: turnControl.handleAskDoubt,
  };
}
