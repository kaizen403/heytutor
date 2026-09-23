import type { TtsConfig } from "./providerConfig";

const SAMPLE_RATE = 24_000;
const MAX_CONTEXT_AUDIO_BYTES = 16 * 1024 * 1024;

export function cartesiaRequest(config: TtsConfig, text: string, speed = 1) {
  return {
    model_id: config.model,
    transcript: text,
    voice: config.voiceId,
    ...(config.model === "sonic-3.6" || config.model === "sonic-latest"
      ? { locale: config.voiceKey }
      : { language: config.voiceKey.startsWith("hi") ? "hi" : "en" }),
    output_format: {
      container: "raw",
      encoding: "pcm_s16le",
      sample_rate: SAMPLE_RATE,
    },
    add_timestamps: true,
    use_normalized_timestamps: false,
    generation_config: {
      speed: Number.isFinite(speed) ? Math.min(1.2, Math.max(0.7, speed)) : 1,
    },
  };
}

/** A complete WAV per sentence lets the same browser decoder and replay handle both vendors. */
export function pcmToWav(pcm: Buffer): Buffer {
  if (pcm.length % 2) throw new Error("Incomplete Cartesia PCM sample");
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

type WordTiming = { word: string; start: number; end: number };
/** Map onto the submitted text, including spaces/punctuation; never invent normalized-word offsets. */
export function characterAlignment(text: string, words: WordTiming[]) {
  if (!words.length) return undefined;
  const starts = Array<number>(text.length).fill(0);
  const ends = Array<number>(text.length).fill(0);
  let cursor = 0;
  let previousEnd = 0;
  for (const { word, start, end } of words) {
    const token = word.trim();
    if (
      !token ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < previousEnd - 0.05 ||
      end < start
    )
      return undefined;
    const index = text
      .toLocaleLowerCase()
      .indexOf(token.toLocaleLowerCase(), cursor);
    if (index < 0 || /[\p{L}\p{N}]/u.test(text.slice(cursor, index)))
      return undefined;
    for (let i = cursor; i < index; i++) {
      starts[i] = previousEnd;
      ends[i] = start;
    }
    for (let i = 0; i < token.length; i++) {
      starts[index + i] = start + ((end - start) * i) / token.length;
      ends[index + i] = start + ((end - start) * (i + 1)) / token.length;
    }
    cursor = index + token.length;
    previousEnd = end;
  }
  if (/[\p{L}\p{N}]/u.test(text.slice(cursor))) return undefined;
  for (let i = cursor; i < text.length; i++) {
    starts[i] = previousEnd;
    ends[i] = previousEnd;
  }
  return {
    characters: text.split(""),
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}

/** Independent contexts may interleave or finish out of order. State lives only for this relay. */
export class CartesiaContexts {
  private contexts = new Map<
    string,
    { text: string; chunks: Buffer[]; bytes: number; words: WordTiming[] }
  >();
  start(id: string, text: string): void {
    if (this.contexts.has(id) || this.contexts.size >= 16)
      throw new Error("Too many active speech contexts");
    this.contexts.set(id, { text, chunks: [], bytes: 0, words: [] });
  }
  accept(raw: string): string | null {
    const message = JSON.parse(raw);
    const id = message.context_id;
    if (message.type === "error") {
      this.contexts.delete(id);
      throw new Error("Cartesia speech generation failed");
    }
    const context = this.contexts.get(id);
    if (!context) return null;
    if (message.type === "chunk" && typeof message.data === "string") {
      const bytes = Buffer.from(message.data, "base64");
      context.bytes += bytes.length;
      if (context.bytes > MAX_CONTEXT_AUDIO_BYTES)
        throw new Error("Speech audio exceeded segment limit");
      context.chunks.push(bytes);
    }
    if (message.type === "timestamps" && message.word_timestamps) {
      const { words, start, end } = message.word_timestamps;
      if (
        !Array.isArray(words) ||
        !Array.isArray(start) ||
        !Array.isArray(end) ||
        words.length !== start.length ||
        words.length !== end.length
      )
        throw new Error("Invalid speech timestamps");
      words.forEach((word: unknown, index: number) => {
        if (
          typeof word !== "string" ||
          context.words.length > context.text.length * 4 + 100
        )
          throw new Error("Invalid speech timestamps");
        context.words.push({ word, start: start[index], end: end[index] });
      });
    }
    if (message.type !== "done") return null;
    this.contexts.delete(id);
    if (!context.bytes) throw new Error("Cartesia returned no audio");
    return JSON.stringify({
      contextId: id,
      isFinal: true,
      audio: pcmToWav(Buffer.concat(context.chunks)).toString("base64"),
      alignment: characterAlignment(context.text, context.words),
    });
  }
  get pending(): number {
    return this.contexts.size;
  }
  clear(): void {
    this.contexts.clear();
  }
}
