import { resolveApiUrl } from "@heytutor/tutor-core";
import { parsePlaygroundLecture, type PlaygroundLecture, type PlaygroundReview } from "@/lib/admin/playgroundLecture";

export async function updatePlaygroundLecture(boardId: string, input: {
  action: "inspect" | "complete" | "discard" | "review";
  meta?: PlaygroundLecture;
  review?: PlaygroundReview;
}): Promise<{ playground: PlaygroundLecture; reason?: string }> {
  const response = await fetch(resolveApiUrl(`/api/admin/playground/${encodeURIComponent(boardId)}`), {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Could not save the playground result. Please retry.");
  const data = await response.json();
  const playground = parsePlaygroundLecture(data.playground);
  if (!playground) throw new Error("Invalid playground result");
  return { playground, reason: typeof data.reason === "string" ? data.reason : undefined };
}
