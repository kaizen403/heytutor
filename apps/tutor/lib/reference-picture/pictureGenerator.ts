/**
 * Generated pictures, the second source after Wikimedia Commons.
 *
 * Any OpenAI-compatible images endpoint works (Azure AI Foundry gpt-image,
 * OpenAI). It is off until all three env values are set. On 27 Oct 2026 no
 * provider was available: Fireworks serves no image model on our account and
 * the Azure Foundry key returned 401.
 *
 * A generated picture carries no text: image models garble labels. It passes
 * the same judge as a Commons picture, with a stricter rule (no letters).
 */
import { ProviderRefusedError } from "./providerErrors";

export interface ImageProviderConfig {
  url: string;
  apiKey: string;
  model: string;
}

export function resolveImageProvider(env: NodeJS.ProcessEnv = process.env): ImageProviderConfig | null {
  const url = env.REFERENCE_PICTURE_IMAGE_URL?.trim();
  const apiKey = env.REFERENCE_PICTURE_IMAGE_KEY?.trim();
  const model = env.REFERENCE_PICTURE_IMAGE_MODEL?.trim();
  if (!url || !apiKey || !model || !url.startsWith("https://")) return null;
  return { url, apiKey, model };
}

/** Our board style: a clean textbook drawing that the stroke planner can trace. */
export function generationPrompt(mustShow: string): string {
  return [
    `A clean school textbook diagram of: ${mustShow.slice(0, 500)}.`,
    "Flat illustration with clear dark outlines and a few flat pastel fill colours on a plain white background.",
    "Scientifically accurate shapes and proportions. One subject, centred, with generous white space around it.",
    "Absolutely no text, no letters, no numbers, no labels, no arrows with captions, no watermark, no border, no shadows, no photo realism.",
  ].join(" ");
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function generatePicture(mustShow: string, provider: ImageProviderConfig, options: { signal?: AbortSignal; fetchImpl?: FetchLike } = {}): Promise<{ bytes: Buffer; contentType: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000);
  const response = await fetchImpl(provider.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey}`, "api-key": provider.apiKey, "content-type": "application/json" },
    signal,
    body: JSON.stringify({ model: provider.model, prompt: generationPrompt(mustShow), size: "1536x1024", quality: "medium", n: 1 }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderRefusedError(`Image generation upstream ${response.status}`, response.status);
  }
  const data = (await response.json()) as { data?: { b64_json?: string }[] };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image generation returned no image");
  return { bytes: Buffer.from(b64, "base64"), contentType: "image/png" };
}
