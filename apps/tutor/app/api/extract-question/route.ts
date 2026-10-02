import { requireLessonCredits } from "@/lib/billing/gate";
import {
  actualLlmCost,
  maximumLlmCost,
  reservePaidUsage,
} from "@/lib/billing/paidUsage";
import {
  reserveStorageBytes,
  StorageQuotaError,
} from "@/lib/boards/storageQuota";
import { prisma } from "@/lib/db/prisma";
import { readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";
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
import {
  parseProviderUsage,
  usageDetailsFromParsed,
} from "@/lib/obs/providerUsage";
import { enqueueObjectDeletion } from "@/lib/object-store/deletionJobs";
import { questionImageKey } from "@/lib/object-store/keys";
import { readQuestionImage } from "@/lib/object-store/questionImage";
import { uploadImage } from "@/lib/object-store/s3";

const FIREWORKS_CHAT_URL =
  "https://api.fireworks.ai/inference/v1/chat/completions";

export async function POST(request: Request): Promise<Response> {
  const gated = await requireLessonCredits(request);
  if (gated instanceof Response) return gated;
  const { actor } = gated;
  let body: unknown;
  try {
    body = await readBoundedJson(request, 2 * 1024 * 1024);
  } catch (error) {
    return Response.json(
      { error: "invalid_json" },
      { status: error instanceof RequestBodyError ? error.status : 400 },
    );
  }
  const image =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? readQuestionImage((body as { image?: unknown }).image)
      : null;
  if (!image)
    return Response.json(
      {
        error:
          "Send a JPEG, PNG, WebP, or GIF photo of the question, up to 4096 pixels per side.",
      },
      { status: 400 },
    );

  const apiKey = process.env.FIREWORKS_API_KEY?.trim();
  if (!apiKey)
    return Response.json(
      { error: "Question photos need FIREWORKS_API_KEY." },
      { status: 503 },
    );
  const model = resolveFireworksVisionModel();
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: EXTRACT_QUESTION_PROMPT },
        { type: "image_url", image_url: { url: image.dataUrl } },
      ],
    },
  ];
  // The image parser bounds static decoded dimensions. Add a conservative
  // 64k vision-token allowance as well as the encoded-input/output ceiling.
  const reservation = await reservePaidUsage({
    actor,
    grant: gated.grant,
    kind: "photo",
    traceId: request.headers.get("x-heytutor-trace-id") ?? undefined,
    usd:
      maximumLlmCost(messages, 1024, [model]) +
      (actualLlmCost({ input: 64_000, output: 0 }, model) ?? 1),
  });
  if (reservation instanceof Response) return reservation;
  if (request.signal.aborted) {
    await reservation.cancelBeforeDispatch();
    return Response.json({ error: "Request cancelled." }, { status: 400 });
  }
  const startedAt = Date.now();
  const turnTrace = startTurnTrace({
    userId: actor.userId,
    sessionId: request.headers.get("x-session-id") ?? undefined,
    input: "extract-question",
    traceId: genTraceId(),
    model,
    name: "extract-question",
    generationName: "qwen-vision",
  });
  try {
    const response = await fetch(FIREWORKS_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        n: 1,
        temperature: 0,
        reasoning_effort: "none",
        stream: false,
        messages,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`OCR upstream ${response.status}`);
    }
    const raw: unknown = await response.json();
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new Error("Invalid OCR response");
    const data = raw as {
      choices?: { message?: { content?: unknown } }[];
      usage?: unknown;
    };
    const usage = usageDetailsFromParsed(parseProviderUsage(data.usage));
    await reservation.settle(actualLlmCost(usage, model));
    const question = parseExtractedQuestion(
      readExtractedContent(data.choices?.[0]?.message?.content),
    );
    if (!question || question.length > 12_000) {
      endLlmGeneration(turnTrace, {
        output: "",
        usageDetails: usage,
        metadata: { error: true, reason: "no_question" },
        model,
        updateTrace: false,
        level: "WARNING",
      });
      return Response.json(
        {
          error:
            "No question found in that image. Try a closer, sharper photo.",
        },
        { status: 422 },
      );
    }
    endLlmGeneration(turnTrace, {
      output: question,
      usageDetails: usage,
      metadata: { latency_ms: Date.now() - startedAt },
      model,
    });
    if (request.signal.aborted)
      return Response.json({ error: "Request cancelled." }, { status: 400 });

    const key = questionImageKey(actor.userId, crypto.randomUUID(), image.ext);
    await reserveStorageBytes(actor.userId, image.bytes.length);
    let imageUrl: string | null = null;
    let cleanupRequired = true;
    try {
      imageUrl = await uploadImage(
        key,
        image.bytes,
        image.mimeType,
        AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
      );
      // A deletion worker may have swept the account prefix during the upload.
      // Check the live account before exposing this newly written object.
      cleanupRequired =
        !imageUrl ||
        request.signal.aborted ||
        !(await prisma.user.findUnique({
          where: { id: actor.userId },
          select: { id: true },
        }));
    } catch {
      /* S3 may have accepted a write before a transport failure. */
    } finally {
      if (cleanupRequired) {
        imageUrl = null;
        await enqueueObjectDeletion({
          prefix: key,
          userId: actor.userId,
          bytes: BigInt(image.bytes.length),
        });
      }
    }
    return Response.json({
      question,
      imageUrl,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (error instanceof StorageQuotaError)
      return Response.json({ error: error.message }, { status: error.status });
    endLlmGeneration(turnTrace, {
      output: "extract-question failed",
      metadata: { error: true },
      model,
      updateTrace: false,
      level: "ERROR",
    });
    return Response.json(
      { error: "Could not read that image. Try a clearer photo." },
      { status: 502 },
    );
  } finally {
    await reservation.finish();
    flushInBackground();
  }
}
