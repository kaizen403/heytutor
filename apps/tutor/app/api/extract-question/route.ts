import { requireLessonCredits } from "@/lib/billing/gate";
import { recordLlmSpend } from "@/lib/billing/track";
import {
  EXTRACT_QUESTION_PROMPT,
  parseExtractedQuestion,
  readExtractedContent,
} from "@/lib/llm/extractQuestion";
import { resolveFireworksVisionModel } from "@/lib/llm/fireworksModels";
import {
  endLlmGeneration,
  flushInBackground,
  genTraceId,
  startTurnTrace,
} from "@/lib/obs/langfuse";
import { questionImageKey } from "@/lib/object-store/keys";
import { readQuestionImage } from "@/lib/object-store/questionImage";
import { uploadImage } from "@/lib/object-store/s3";

const FIREWORKS_CHAT_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

interface ExtractRequestBody {
  image?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  const gated = await requireLessonCredits(request);
  if (gated instanceof Response) return gated;
  const { actor } = gated;

  const body = (await request.json().catch(() => ({}))) as ExtractRequestBody;
  const image = readQuestionImage(body.image);
  if (!image) {
    return Response.json(
      { error: "Send a JPEG, PNG, or WebP photo of the question." },
      { status: 400 },
    );
  }

  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Question photos need FIREWORKS_API_KEY." },
      { status: 503 },
    );
  }

  const model = resolveFireworksVisionModel();
  const startedAt = Date.now();
  const sessionId = request.headers.get("x-session-id") ?? undefined;
  const turnTrace = startTurnTrace({
    sessionId,
    input: "extract-question",
    traceId: genTraceId(),
    model,
    name: "extract-question",
    generationName: "qwen-vision",
  });
  let response: Response;
  try {
    response = await fetch(FIREWORKS_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0,
        reasoning_effort: "none",
        stream: false,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: EXTRACT_QUESTION_PROMPT },
              { type: "image_url", image_url: { url: image.dataUrl } },
            ],
          },
        ],
      }),
    });
  } catch {
    endLlmGeneration(turnTrace, {
      output: "extract-question fetch failed",
      metadata: { error: true },
      model,
      updateTrace: false,
      level: "ERROR",
    });
    flushInBackground();
    return Response.json(
      { error: "Could not read that image. Try a clearer photo." },
      { status: 502 },
    );
  }

  if (!response.ok) {
    endLlmGeneration(turnTrace, {
      output: `extract-question upstream ${response.status}`,
      metadata: { error: true, status: response.status },
      model,
      updateTrace: false,
      level: "ERROR",
    });
    flushInBackground();
    return Response.json(
      { error: "Could not read that image. Try a clearer photo." },
      { status: 502 },
    );
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const question = parseExtractedQuestion(
    readExtractedContent(data.choices?.[0]?.message?.content),
  );
  if (!question) {
    endLlmGeneration(turnTrace, {
      output: "",
      usageDetails: {
        input: data.usage?.prompt_tokens,
        output: data.usage?.completion_tokens,
        total: data.usage?.total_tokens,
      },
      metadata: { error: true, reason: "no_question" },
      model,
      updateTrace: false,
      level: "WARNING",
    });
    flushInBackground();
    return Response.json(
      { error: "No question found in that image. Try a closer, sharper photo." },
      { status: 422 },
    );
  }

  const usage = {
    input: data.usage?.prompt_tokens,
    output: data.usage?.completion_tokens,
    total: data.usage?.total_tokens,
  };
  endLlmGeneration(turnTrace, {
    output: question,
    usageDetails: usage,
    metadata: { latency_ms: Date.now() - startedAt },
    model,
  });
  recordLlmSpend({
    actor,
    model,
    usage,
  });
  flushInBackground();

  const imageUrl = await uploadImage(
    questionImageKey(actor.userId, crypto.randomUUID(), image.ext),
    image.bytes,
    image.mimeType,
  );

  return Response.json({
    question,
    imageUrl,
    latencyMs: Date.now() - startedAt,
  });
}
