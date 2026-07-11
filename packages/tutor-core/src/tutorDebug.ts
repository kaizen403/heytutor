export type TutorDebugScope =
  | "llm"
  | "chat"
  | "parser"
  | "planner"
  | "segment"
  | "speed"
  | "draw"
  | "tts"
  | "turn"
  | "whiteboard"
  | "alignment"
  | "optics";

function isDebugEnabled(): boolean {
  if (typeof process !== "undefined") {
    if (process.env.NEXT_PUBLIC_TUTOR_DEBUG === "1") {
      return true;
    }

    if (process.env.TUTOR_DEBUG === "1") {
      return true;
    }

    if (process.env.NODE_ENV === "development") {
      return true;
    }
  }

  return false;
}

function formatPayload(data: Record<string, unknown> | undefined): string {
  if (!data) {
    return "";
  }

  try {
    return ` ${JSON.stringify(data)}`;
  } catch {
    return " [unserializable]";
  }
}

export function tutorDebug(
  scope: TutorDebugScope,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!isDebugEnabled()) {
    return;
  }

  const ts =
    typeof performance !== "undefined"
      ? `${Math.round(performance.now())}ms`
      : new Date().toISOString();

  console.log(`[tutor:${scope}] ${ts} ${message}${formatPayload(data)}`);
}
