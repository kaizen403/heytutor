import { HTTP_TTS_DOWNLOAD_TIMEOUT_MS, HTTP_TTS_MAX_DOWNLOAD_BYTES } from "./httpTtsPolicy";

/** A bounded download failure must not repeat paid synthesis. */
export class HttpTtsDownloadError extends Error {}

/**
 * Recognize growth inside a top-level audio/audio_base64 JSON string, even
 * before its packet is complete. This is transport progress, never audio
 * readiness. Scan incrementally so split keys/values work without reparsing
 * a growing base64 string, and quoted control text cannot masquerade as a key.
 */
function audioStringProgress() {
  let prefix = "", depth = 0, invalid = false, inString = false, escaped = false;
  let key = "", readingKey = false, expectKey = false, expectValue = false;
  let audioKey = false, readingAudio = false;
  return (text: string): boolean => {
    let progressed = false;
    for (const char of text) {
      if (char === "\n") {
        prefix = ""; depth = 0; invalid = inString = escaped = false;
        key = ""; readingKey = expectKey = expectValue = audioKey = readingAudio = false;
        continue;
      }
      if (invalid) continue;
      if (depth === 0) {
        if (char === "{" && /^\s*(?:data:\s*)?$/.test(prefix)) { depth = 1; expectKey = true; }
        else { prefix += char; if (prefix.length > 64) invalid = true; }
        continue;
      }
      if (inString) {
        if (escaped) { escaped = false; readingAudio = false; continue; }
        if (char === "\\") { escaped = true; continue; }
        if (char === '"') {
          inString = false;
          if (readingKey) audioKey = key === "audio" || key === "audio_base64";
          readingKey = readingAudio = false;
        } else if (readingKey) {
          if (key.length < 16) key += char;
        } else if (readingAudio) {
          if (/[A-Za-z0-9+/=]/.test(char)) progressed = true;
          else readingAudio = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true; key = "";
        readingKey = depth === 1 && expectKey;
        readingAudio = depth === 1 && expectValue && audioKey;
        expectKey = expectValue = false;
      } else if (char === "{" || char === "[") {
        depth++; expectValue = false;
      } else if (char === "}" || char === "]") {
        depth--; if (depth === 0) invalid = true;
      } else if (depth === 1 && char === ",") {
        expectKey = true; expectValue = audioKey = false;
      } else if (depth === 1 && char === ":") {
        expectValue = true;
      } else if (!/\s/.test(char)) expectValue = false;
    }
    return progressed;
  };
}

/** Retries spend the same sentence's remaining time and bytes. */
export interface HttpAudioDownloadBudget { deadlineMs?: number; bytes: number }

/** Shared by direct speech and lookahead; the timer ends before local playback. */
export async function* httpAudioLines(
  fetchResponse: () => Promise<Response>,
  controller: AbortController,
  onProgress?: () => void,
  budget: HttpAudioDownloadBudget = { bytes: 0 },
): AsyncGenerator<string> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel(controller.signal.reason).catch(() => {}); };
  const throwIfAborted = () => {
    if (controller.signal.aborted) throw controller.signal.reason;
  };
  budget.deadlineMs ??= performance.now() + HTTP_TTS_DOWNLOAD_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(new HttpTtsDownloadError("TTS download exceeded 60000ms")), Math.max(0, budget.deadlineMs - performance.now()));
  controller.signal.addEventListener("abort", cancel, { once: true });
  try {
    if (budget.deadlineMs <= performance.now()) {
      controller.abort(new HttpTtsDownloadError("TTS download exceeded 60000ms"));
    }
    throwIfAborted();
    const response = await fetchResponse();
    throwIfAborted();
    if (!response.ok) throw new Error(`TTS stream error ${response.status}`);
    if (response.headers.get("x-heytutor-tts-skipped")) throw new Error("TTS skipped");
    if (!response.body) throw new Error("TTS stream returned no body");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    const progress = audioStringProgress();
    let buffer = "";
    while (true) {
      throwIfAborted();
      const { value, done } = await reader.read();
      throwIfAborted();
      if (done) break;
      budget.bytes += value.byteLength;
      if (budget.bytes > HTTP_TTS_MAX_DOWNLOAD_BYTES) {
        const error = new HttpTtsDownloadError("TTS download exceeded 24 MiB");
        controller.abort(error);
        throw error;
      }
      const text = decoder.decode(value, { stream: true });
      if (progress(text)) onProgress?.();
      throwIfAborted();
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) yield line;
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield buffer;
  } catch (error) {
    // Fetch may wrap an abort in a browser-specific network error.
    throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", cancel);
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}
