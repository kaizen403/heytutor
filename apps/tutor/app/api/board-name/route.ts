import { finalizeBoardTitle } from "@/lib/boards/boardTitle";
import { isSpendActor, requireSpendActor } from "@/lib/billing/gate";
import { readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";

/** Titles are deterministic; creating a board name never purchases AI work. */
export async function POST(request: Request): Promise<Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  let body: unknown;
  try {
    body = await readBoundedJson(request, 64 * 1024);
  } catch (error) {
    return Response.json(
      { error: "Send a valid board question." },
      { status: error instanceof RequestBodyError ? error.status : 400 },
    );
  }
  const question =
    typeof body === "object" &&
    body !== null &&
    "question" in body &&
    typeof body.question === "string"
      ? body.question.trim()
      : "";
  if (!question)
    return Response.json({ error: "question is required" }, { status: 400 });
  if (question.length > 12_000)
    return Response.json(
      { error: "That question is too long." },
      { status: 413 },
    );
  return Response.json({ title: finalizeBoardTitle(question) });
}
