import {
  BOARD_TITLE_SYSTEM_PROMPT,
  finalizeBoardTitle,
} from "@/lib/boards/boardTitle";
import { isSpendActor, requireSpendActor } from "@/lib/billing/gate";
import { recordLlmSpend } from "@/lib/billing/track";
import { resolveFireworksModel } from "@/lib/llm/fireworksModels";
import { parseProviderUsage, usageDetailsFromParsed } from "@/lib/obs/providerUsage";

const FIREWORKS_CHAT_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

export async function POST(request: Request): Promise<Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;

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

  const model = resolveFireworksModel();

  try {
    const response = await fetch(FIREWORKS_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        // Headroom for reasoning_content on reasoning models — small caps starve the title into empty content.
        max_tokens: 512,
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
    const usage = usageDetailsFromParsed(parseProviderUsage(data?.usage));
    if (usage) {
      recordLlmSpend({ actor, model, usage });
    }

    return Response.json({ title: finalizeBoardTitle(question, rawTitle) });
  } catch {
    return Response.json({ title: fallbackTitle });
  }
}
