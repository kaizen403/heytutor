import { ensureUser, getUserId } from "@/lib/auth";
import {
  EXTRACT_QUESTION_PROMPT,
  parseExtractedQuestion,
  readExtractedContent,
} from "@/lib/llm/extractQuestion";
import { resolveFireworksVisionModel } from "@/lib/llm/fireworksModels";
import { questionImageKey } from "@/lib/object-store/keys";
import { readQuestionImage } from "@/lib/object-store/questionImage";
import { uploadImage } from "@/lib/object-store/s3";

const FIREWORKS_CHAT_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

interface ExtractRequestBody {
  image?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  await ensureUser(userId);

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
    return Response.json(
      { error: "Could not read that image. Try a clearer photo." },
      { status: 502 },
    );
  }

  if (!response.ok) {
    return Response.json(
      { error: "Could not read that image. Try a clearer photo." },
      { status: 502 },
    );
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const question = parseExtractedQuestion(
    readExtractedContent(data.choices?.[0]?.message?.content),
  );
  if (!question) {
    return Response.json(
      { error: "No question found in that image. Try a closer, sharper photo." },
      { status: 422 },
    );
  }

  const imageUrl = await uploadImage(
    questionImageKey(userId, crypto.randomUUID(), image.ext),
    image.bytes,
    image.mimeType,
  );

  return Response.json({
    question,
    imageUrl,
    latencyMs: Date.now() - startedAt,
  });
}
