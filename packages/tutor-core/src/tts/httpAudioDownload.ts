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
  type Frame = { kind: "object" | "array"; state: "keyOrEnd" | "key" | "colon" | "valueOrEnd" | "value" | "commaOrEnd"; audioKey?: boolean };
  let prefix = "", invalid = false, inString = false, escaped = false;
  let key = "", readingKey = false, readingAudio = false, scalar = "", unicode = 0;
  const stack: Frame[] = [];
  return (text: string): boolean => {
    let progressed = false;
    for (const char of text) {
      if (char === "\n") {
        prefix = key = scalar = ""; stack.length = 0; unicode = 0;
        invalid = inString = escaped = readingKey = readingAudio = false;
        continue;
      }
      if (invalid) continue;
      if (stack.length === 0) {
        if (char === "{" && /^\s*(?:data:\s*)?$/.test(prefix)) stack.push({ kind: "object", state: "keyOrEnd" });
        else { prefix += char; if (prefix.length > 64) invalid = true; }
        continue;
      }
      const frame = stack.at(-1)!;
      if (inString) {
        if (unicode > 0) { if (!/[0-9a-f]/i.test(char)) invalid = true; unicode--; continue; }
        if (escaped) {
          escaped = false; readingAudio = false;
          if (readingKey) key += "?"; // Escaped keys cannot impersonate an audio key.
          if (char === "u") unicode = 4;
          else if (!'"\\/bfnrt'.includes(char)) invalid = true;
          continue;
        }
        if (char === "\\") { escaped = true; continue; }
        if (char === '"') {
          inString = false;
          frame.state = readingKey ? "colon" : "commaOrEnd";
          if (readingKey) frame.audioKey = key === "audio" || key === "audio_base64";
          readingKey = readingAudio = false;
        } else if (char.charCodeAt(0) < 32) invalid = true;
        else if (readingKey) { if (key.length < 16) key += char; }
        else if (readingAudio) {
          if (/[A-Za-z0-9+/=]/.test(char)) progressed = true;
          else readingAudio = false;
        }
        continue;
      }
      if (scalar) {
        if (!/[\s,}\]]/.test(char)) { scalar += char; if (scalar.length > 64) invalid = true; continue; }
        // Validate the value preceding the next key, including nested metadata.
        try { JSON.parse(scalar); } catch { invalid = true; continue; }
        scalar = ""; frame.state = "commaOrEnd";
      }
      if (/\s/.test(char)) continue;
      if (char === '"' && ["keyOrEnd", "key", "value", "valueOrEnd"].includes(frame.state)) {
        inString = true; key = "";
        readingKey = frame.state === "keyOrEnd" || frame.state === "key";
        readingAudio = !readingKey && stack.length === 1 && frame.audioKey === true;
      } else if ((char === "}" && frame.kind === "object" && ["keyOrEnd", "commaOrEnd"].includes(frame.state)) ||
                 (char === "]" && frame.kind === "array" && ["valueOrEnd", "commaOrEnd"].includes(frame.state))) {
        stack.pop(); if (stack.length === 0) invalid = true;
      } else if (char === ":" && frame.state === "colon") frame.state = "value";
      else if (char === "," && frame.state === "commaOrEnd") {
        frame.state = frame.kind === "object" ? "key" : "value"; frame.audioKey = false;
      } else if (frame.state === "value" || frame.state === "valueOrEnd") {
        if (char === "{" || char === "[") {
          frame.state = "commaOrEnd";
          stack.push({ kind: char === "{" ? "object" : "array", state: char === "{" ? "keyOrEnd" : "valueOrEnd" });
        } else if (/[tfn0-9-]/.test(char)) scalar = char;
        else invalid = true;
      } else invalid = true;
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
