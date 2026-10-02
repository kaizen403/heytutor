import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_DICTATION_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_DICTATION_SECONDS = 60;
// Browser encoders pad the final AAC/Opus frame after a sixty-second take.
// Count and meter those samples, while allowing only a bounded padding margin.
const MAX_ENCODED_DICTATION_SECONDS = MAX_DICTATION_SECONDS + 0.25;
const MAX_PROBE_BYTES = 512 * 1024;
const PROBE_TIMEOUT_MS = 8000;
const MAX_CONCURRENT_PROBES = 2;
let activeProbes = 0;

type AudioValidationFailure = {
  ok: false;
  status: 400 | 413 | 429 | 503;
  error: string;
};
type AudioValidationSuccess = {
  ok: true;
  durationSeconds: number;
  filename: string;
};
export type DictationAudioValidation =
  AudioValidationSuccess | AudioValidationFailure;

class AudioProbeError extends Error {
  constructor(
    readonly status: AudioValidationFailure["status"],
    message: string,
  ) {
    super(message);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function audioFilename(bytes: Uint8Array, mime: string): string | null {
  const text = (start: number, end: number) =>
    new TextDecoder().decode(bytes.subarray(start, end));
  const starts = (values: number[]) =>
    values.every((value, index) => bytes[index] === value);
  const wav = text(0, 4) === "RIFF" && text(8, 12) === "WAVE";
  const webm = starts([0x1a, 0x45, 0xdf, 0xa3]);
  const ogg = text(0, 4) === "OggS";
  const mp4 = text(4, 8) === "ftyp";
  const adts = bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xf6) === 0xf0;
  const mp3 =
    text(0, 3) === "ID3" ||
    (bytes[0] === 0xff &&
      ((bytes[1] ?? 0) & 0xe0) === 0xe0 &&
      ((bytes[1] ?? 0) & 0x06) !== 0);
  if (["audio/wav", "audio/x-wav", "audio/wave"].includes(mime) && wav)
    return "dictation.wav";
  if (mime === "audio/webm" && webm) return "dictation.webm";
  if (mime === "audio/ogg" && ogg) return "dictation.ogg";
  if (["audio/mp4", "audio/x-m4a", "audio/m4a"].includes(mime) && mp4)
    return "dictation.mp4";
  if (mime === "audio/aac" && adts) return "dictation.aac";
  if (["audio/mpeg", "audio/mp3"].includes(mime) && mp3) return "dictation.mp3";
  return null;
}

const MEDIA_BASE_ARGS = [
  "-v",
  "error",
  "-max_alloc",
  "16777216",
  "-threads",
  "1",
];
const DECODED_SAMPLE_RATE = 16_000;
const DECODED_BYTES_PER_SECOND = DECODED_SAMPLE_RATE * 2;

function mediaInputArgs(privateFilename?: string): string[] {
  return [
    ...MEDIA_BASE_ARGS,
    "-protocol_whitelist",
    privateFilename ? "file,pipe" : "pipe",
    "-format_whitelist",
    privateFilename ? "mov" : "wav,ogg,matroska,webm,mov,mp3,aac",
    // A seekable MP4 is a server-created file; external tracks are forbidden.
    ...(privateFilename
      ? ["-f", "mov", "-enable_drefs", "0", "-use_absolute_path", "0"]
      : []),
  ];
}

/** Fixed argv and pipe-only input keep media metadata from opening files/URLs.
 * ffprobe options: https://www.ffmpeg.org/ffprobe-all.html */
async function runMediaTool(
  bytes: Uint8Array,
  binary: "ffmpeg" | "ffprobe",
  args: string[],
  maxOutputBytes: number,
  captureOutput: boolean,
  signal?: AbortSignal,
  fromPrivateFile = false,
): Promise<{ outputBytes: number; text: string }> {
  if (signal?.aborted)
    throw new AudioProbeError(400, "The recording request was cancelled.");
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["pipe", "pipe", "ignore"],
      shell: false,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
        NODE_ENV: "production",
      },
    });
    const chunks: Buffer[] = [];
    let length = 0;
    let failure: AudioProbeError | undefined;
    const terminate = (error: AudioProbeError) => {
      failure ??= error;
      child.kill("SIGKILL");
    };
    const timeout = setTimeout(
      () =>
        terminate(
          new AudioProbeError(
            400,
            "That recording could not be decoded safely.",
          ),
        ),
      PROBE_TIMEOUT_MS,
    );
    const abort = () =>
      terminate(
        new AudioProbeError(400, "The recording request was cancelled."),
      );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    child.once("error", (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(
        new AudioProbeError(
          error.code === "ENOENT" ? 503 : 400,
          error.code === "ENOENT"
            ? "Voice input validation is not configured yet."
            : "That recording could not be decoded.",
        ),
      );
    });
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > maxOutputBytes)
        terminate(
          new AudioProbeError(
            captureOutput ? 400 : 413,
            captureOutput
              ? "That recording is too complex to decode safely."
              : "That recording is too long. Keep it under a minute.",
          ),
        );
      else if (captureOutput) chunks.push(chunk);
    });
    child.once("close", (code) => {
      cleanup();
      if (failure) {
        reject(failure);
        return;
      }
      if (code !== 0) {
        reject(
          new AudioProbeError(400, "That is not a supported audio recording."),
        );
        return;
      }
      resolve({
        outputBytes: length,
        text: captureOutput ? Buffer.concat(chunks).toString("utf8") : "",
      });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(fromPrivateFile ? undefined : bytes);
  });
}

async function probe(
  bytes: Uint8Array,
  signal?: AbortSignal,
  privateFilename?: string,
): Promise<unknown> {
  const result = await runMediaTool(
    bytes,
    "ffprobe",
    [
      ...mediaInputArgs(privateFilename),
      "-show_entries",
      "stream=codec_type,codec_name,sample_rate,channels",
      "-of",
      "json",
      privateFilename ?? "pipe:0",
    ],
    MAX_PROBE_BYTES,
    true,
    signal,
    Boolean(privateFilename),
  );
  try {
    return JSON.parse(result.text);
  } catch {
    throw new AudioProbeError(400, "That recording could not be decoded.");
  }
}

/** Normalize decoded samples and count their bytes; source timestamps and
 * declared duration cannot shorten an overlong recording. PCM is never buffered.
 * https://www.ffmpeg.org/ffmpeg-filters.html#asetpts */
async function decodedDuration(
  bytes: Uint8Array,
  signal?: AbortSignal,
  privateFilename?: string,
): Promise<number> {
  const result = await runMediaTool(
    bytes,
    "ffmpeg",
    [
      ...mediaInputArgs(privateFilename),
      "-i",
      privateFilename ?? "pipe:0",
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-af",
      "asetpts=N/SR/TB",
      "-ac",
      "1",
      "-ar",
      String(DECODED_SAMPLE_RATE),
      "-threads",
      "1",
      "-f",
      "s16le",
      "pipe:1",
    ],
    MAX_ENCODED_DICTATION_SECONDS * DECODED_BYTES_PER_SECOND,
    false,
    signal,
    Boolean(privateFilename),
  );
  return result.outputBytes / DECODED_BYTES_PER_SECOND;
}

export async function validateDictationAudio(
  audio: Blob,
  signal?: AbortSignal,
): Promise<DictationAudioValidation> {
  if (audio.size === 0)
    return {
      ok: false,
      status: 400,
      error: "Nothing was recorded. Hold the mic a moment longer.",
    };
  if (audio.size > MAX_DICTATION_AUDIO_BYTES)
    return {
      ok: false,
      status: 413,
      error: "That recording is too large. Keep it under a minute.",
    };
  if (activeProbes >= MAX_CONCURRENT_PROBES)
    return {
      ok: false,
      status: 429,
      error: "Voice input is busy. Try again in a moment.",
    };
  activeProbes += 1;
  let privateDirectory: string | undefined;
  try {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const mime = audio.type.split(";")[0]?.trim().toLowerCase() ?? "";
    const filename = audioFilename(bytes, mime);
    if (!filename)
      return {
        ok: false,
        status: 400,
        error: "That is not a supported audio recording.",
      };
    let privateFilename: string | undefined;
    if (filename === "dictation.mp4") {
      privateDirectory = await mkdtemp(join(tmpdir(), "heytutor-dictation-"));
      privateFilename = join(privateDirectory, "audio.mp4");
      await writeFile(privateFilename, bytes, { mode: 0o600, flag: "wx" });
    }
    const metadata = await probe(bytes, signal, privateFilename);
    if (
      !record(metadata) ||
      !Array.isArray(metadata.streams) ||
      metadata.streams.length !== 1
    ) {
      return {
        ok: false,
        status: 400,
        error: "Send a recording with one audio track.",
      };
    }
    const stream: unknown = metadata.streams[0];
    if (!record(stream) || stream.codec_type !== "audio")
      return {
        ok: false,
        status: 400,
        error: "That is not an audio recording.",
      };
    const sampleRate = Number(stream.sample_rate);
    const channels = Number(stream.channels);
    if (
      !Number.isInteger(sampleRate) ||
      sampleRate < 8000 ||
      sampleRate > 96000 ||
      ![1, 2].includes(channels)
    ) {
      return {
        ok: false,
        status: 400,
        error: "That audio format is not supported for voice input.",
      };
    }
    const durationSeconds = await decodedDuration(
      bytes,
      signal,
      privateFilename,
    );
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
      return {
        ok: false,
        status: 400,
        error: "Nothing was recorded. Hold the mic a moment longer.",
      };
    if (durationSeconds > MAX_ENCODED_DICTATION_SECONDS)
      return {
        ok: false,
        status: 413,
        error: "That recording is too long. Keep it under a minute.",
      };
    return { ok: true, durationSeconds, filename };
  } catch (error) {
    return error instanceof AudioProbeError
      ? { ok: false, status: error.status, error: error.message }
      : {
          ok: false,
          status: 400,
          error: "That recording could not be decoded.",
        };
  } finally {
    activeProbes -= 1;
    if (privateDirectory)
      await rm(privateDirectory, { recursive: true, force: true });
  }
}
