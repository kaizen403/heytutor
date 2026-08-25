"use client";

import { useParams, useSearchParams } from "next/navigation";
import { TutorSessionShell } from "./TutorSessionShell";

export function TutorSessionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const sessionId = params.sessionId as string;
  const autoQuestion = searchParams.get("q") ?? undefined;
  const autoReplay = searchParams.get("replay") === "1";
  const embed = searchParams.get("embed") === "1";

  return (
    <TutorSessionShell
      sessionId={sessionId}
      variant={embed ? "embed" : "full"}
      autoQuestion={autoQuestion}
      autoReplay={autoReplay}
    />
  );
}
