import {
  BOARD_TITLE_SYSTEM_PROMPT,
  finalizeBoardTitle,
} from "@/lib/boardTitle";
import { ensureUser, getUserId } from "@/lib/auth";

const FIREWORKS_CHAT_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

export async function POST(request: Request): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  await ensureUser(userId);

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const question = typeof body?.question === "string" ? body.question.trim() : "";

  if (!question) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }

  const fallbackTitle = finalizeBoardTitle(question);
  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) {
    return Response.json({ title: fallbackTitle });
  }

  const model = process.env.FIREWORKS_MODEL ?? "accounts/fireworks/models/kimi-k2p6";

  try {
    const response = await fetch(FIREWORKS_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 32,
        temperature: 0.2,
        reasoning_effort: "low",
        stream: false,
        messages: [
          { role: "system", content: BOARD_TITLE_SYSTEM_PROMPT },
          { role: "user", content: question },
        ],
      }),
    });

    if (!response.ok) {
      return Response.json({ title: fallbackTitle });
    }

    const data = await response.json();
    const rawTitle: string = data?.choices?.[0]?.message?.content ?? "";

    return Response.json({ title: finalizeBoardTitle(question, rawTitle) });
  } catch {
    return Response.json({ title: fallbackTitle });
  }
}
