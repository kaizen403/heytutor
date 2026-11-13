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
  EXTRACT_QUESTION_SECOND_LOOK_PROMPT,
  readExtractionChoice,
  shouldTakeSecondLook,
  type ExtractionReply,
} from "@/lib/llm/extractQuestion";
import { resolveFireworksVisionModels } from "@/lib/llm/fireworksModels";
import {
  completionTokenCap,
  endpointEnv,
  providerChatBody,
  resolveLlmEndpoint,
} from "@/lib/llm/llmProvider";
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

/** Shown in the question box, so it can point at typing as the way out. */
const NO_QUESTION_MESSAGE =
  "No question found in that photo. Crop to just the question and try again, or type it here.";
const TRACE_REPLY_CHARS = 500;

type UsageDetails = NonNullable<ReturnType<typeof usageDetailsFromParsed>>;

function sumUsage(a: UsageDetails, b: UsageDetails): UsageDetails {
  const add = (x?: number, y?: number) =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
  return {
    input: add(a.input, b.input),
    output: add(a.output, b.output),
    total: add(a.total, b.total),
    cachedInput: add(a.cachedInput, b.cachedInput),
  };
}

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

  const llm = resolveLlmEndpoint();
  const apiKey = llm.apiKey;
  if (!apiKey)
    return Response.json(
      { error: "Question photos need FIREWORKS_API_KEY." },
      { status: 503 },
    );

  const models = resolveFireworksVisionModels(endpointEnv(llm));
  let model = models[0]!;
  // OpenAI-family models choose a low-detail pass for "auto" on some images,
  // which shrinks a page of text below legibility.
  const imageDetail = llm.provider === "fireworks" ? undefined : "high";
  const messagesFor = (prompt: string) => [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: imageDetail
            ? { url: image.dataUrl, detail: imageDetail }
            : { url: image.dataUrl },
        },
      ],
    },
  ];
  const messages = messagesFor(EXTRACT_QUESTION_PROMPT);
  const requestBody = (candidate: string, secondLook = false) => providerChatBody({
    model: candidate,
    max_tokens: 1024,
    n: 1,
    temperature: 0,
    // Azure and the relay floor "none" at low effort, so the second look buys
    // more reasoning there. Fireworks keeps thinking off: it would eat the cap.
    reasoning_effort: secondLook && llm.provider !== "fireworks" ? "medium" : "none",
    stream: false,
    messages: secondLook ? messagesFor(EXTRACT_QUESTION_SECOND_LOOK_PROMPT) : messages,
  }, llm);
  // The image parser bounds static decoded dimensions. Add a conservative
  // 64k vision-token allowance as well as the encoded-input/output ceiling.
  const firstAttemptUsd =
    maximumLlmCost(messages, completionTokenCap(requestBody(model)), models) +
    Math.max(
      ...models.map(
        (candidate) =>
          actualLlmCost({ input: 64_000, output: 0 }, candidate) ?? 1,
      ),
    );
  const reservation = await reservePaidUsage({
    actor,
    grant: gated.grant,
    kind: "photo",
    traceId: request.headers.get("x-heytutor-trace-id") ?? undefined,
    usd: firstAttemptUsd,
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
    generationName: "vision-ocr",
  });
  let attempts = 0;
  const post = (candidate: string, secondLook: boolean) => {
    attempts += 1;
    return fetch(llm.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
      body: JSON.stringify(requestBody(candidate, secondLook)),
    });
  };
  const readReply = async (response: Response) => {
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`OCR upstream ${response.status} from ${model}`);
    }
    const raw: unknown = await response.json();
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new Error("Invalid OCR response");
    const data = raw as { choices?: unknown[]; usage?: unknown };
    const parsed = parseProviderUsage(data.usage);
    return {
      extraction: readExtractionChoice(data.choices?.[0]),
      usage: usageDetailsFromParsed(parsed),
      reasoningTokens: parsed.reasoning,
    };
  };
  try {
    let response: Response | null = null;
    for (const [index, candidate] of models.entries()) {
      model = candidate;
      response = await post(model, false);
      // 404 means the provider no longer serves this model. Nothing was billed,
      // so try the next one rather than failing the photo.
      if (response.status !== 404 || index === models.length - 1) break;
      console.warn(`[extract-question] vision model unavailable: ${model}`);
      await response.body?.cancel();
    }
    if (!response) throw new Error("No OCR model configured");
    const first = await readReply(response);
    const replies: ExtractionReply[] = [first.extraction];
    let usage = first.usage;
    let reasoningTokens = first.reasoningTokens;
    let spentUsd = actualLlmCost(first.usage, model);
    let secondLook: "found" | "declined" | "unfunded" | "failed" | undefined;
    if (shouldTakeSecondLook(first.extraction) && !request.signal.aborted) {
      // The first call measured the image, so the second is funded from its
      // input tokens rather than another full encoded-image ceiling.
      const secondCap = completionTokenCap(requestBody(model, true));
      const secondUsd =
        maximumLlmCost(
          [{ role: "user", content: EXTRACT_QUESTION_SECOND_LOOK_PROMPT }],
          secondCap,
          [model],
        ) +
        (first.usage?.input !== undefined
          ? (actualLlmCost({ input: first.usage.input, output: 0 }, model) ??
            firstAttemptUsd)
          : firstAttemptUsd);
      const denied = await reservation.ensureReserved(
        (spentUsd ?? firstAttemptUsd) + secondUsd,
      );
      if (denied) {
        secondLook = "unfunded";
      } else {
        try {
          const second = await readReply(await post(model, true));
          replies.push(second.extraction);
          // Half-known usage would understate the trace cost; leave it unknown.
          usage = usage && second.usage ? sumUsage(usage, second.usage) : undefined;
          const secondSpent = actualLlmCost(second.usage, model);
          spentUsd =
            spentUsd === undefined || secondSpent === undefined
              ? undefined
              : spentUsd + secondSpent;
          if (second.reasoningTokens !== undefined)
            reasoningTokens = (reasoningTokens ?? 0) + second.reasoningTokens;
          secondLook = second.extraction.question ? "found" : "declined";
        } catch (error) {
          if (request.signal.aborted) throw error;
          spentUsd = undefined;
          usage = undefined;
          secondLook = "failed";
          console.warn(
            `[extract-question] second look failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    await reservation.settle(spentUsd);
    const last = replies[replies.length - 1]!;
    const traceMetadata = {
      image_width: image.width,
      image_height: image.height,
      image_bytes: image.bytes.length,
      image_detail: imageDetail ?? "default",
      attempts,
      ...(secondLook ? { second_look: secondLook, first_decline: first.extraction.reason } : {}),
      ...(last.finishReason ? { finish_reason: last.finishReason } : {}),
      ...(reasoningTokens !== undefined ? { reasoning_tokens: reasoningTokens } : {}),
    };
    const question = last.question;
    if (!question) {
      endLlmGeneration(turnTrace, {
        output: last.reply.slice(0, TRACE_REPLY_CHARS),
        usageDetails: usage,
        metadata: {
          error: true,
          reason: "no_question",
          decline: last.reason,
          ...traceMetadata,
        },
        model,
        updateTrace: false,
        level: "WARNING",
      });
      return Response.json({ error: NO_QUESTION_MESSAGE }, { status: 422 });
    }
    endLlmGeneration(turnTrace, {
      output: question,
      usageDetails: usage,
      metadata: { latency_ms: Date.now() - startedAt, ...traceMetadata },
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
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[extract-question] ${reason}`);
    endLlmGeneration(turnTrace, {
      output: "extract-question failed",
      metadata: { error: true, reason },
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
