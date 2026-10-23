import { numberToSpokenWords } from "@heytutor/tutor-core";
import { pcmToWav } from "./cartesiaProtocol";
import type { TtsConfig } from "./providerConfig";

/**
 * Sarvam bulbul speaks the Hinglish voice (hi-IN only; Cartesia owns every
 * other voice). Measured on 6 Oct 2026: linear16 arrives as headerless 24 kHz
 * mono PCM, first audio in about 350 ms, one `final` event per flush. Sarvam
 * returns no word timings, so the client keeps its estimated pen schedule.
 */
export const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";
export const SARVAM_WS_URL = "wss://api.sarvam.ai/text-to-speech/ws";
/** Sarvam's limit for one text message or one REST request. */
export const SARVAM_MAX_TEXT_CHARS = 2500;
/** Sarvam closes a socket after about a minute without traffic. */
export const SARVAM_KEEPALIVE_MS = 25_000;

const SAMPLE_RATE = 24_000;
const MAX_SEGMENT_AUDIO_BYTES = 16 * 1024 * 1024;
/** 100 ms of 24 kHz 16-bit silence. */
const SILENT_FINAL_BYTES = 4_800;

/**
 * Sarvam reads digits as Hindi numerals ("9" was heard as नौ), but the pen
 * finds a board row by its English number words. The model is told to spell
 * numbers in English; this catches the digits it leaves behind. Only the
 * audio sees this text: Sarvam returns no alignment, so client offsets are
 * unaffected. A "।" becomes "." for the same pause.
 */
export function sarvamSpeechText(text: string): string {
  return text
    .replace(/(?<![\p{L}_])km(?:\s*\/\s*(?:hour|hr|h)|ph)(?![\p{L}\p{N}_])/gu, (_unit, offset: number, whole: string) => {
      const before = whole.slice(0, offset);
      const quantity = /(?<![\p{L}\p{N}_.])([+-]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)|one)\s*$/u.exec(before);
      // A standalone "one" may already come from mathToSpeech. Do not
      // singularize the final word of "twenty one" or "point one".
      const singular = quantity?.[1] === "one"
        ? !/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|lakh|crore|point|and)[\s-]*$/i.test(before.slice(0, quantity.index))
        : quantity ? Number(quantity[1]!.replace(/,/g, "")) === 1 : false;
      return `${singular ? "kilometer" : "kilometers"} per hour`;
    })
    .replace(SPACED_UNIT, (match: string, value: string, unit: string, offset: number, whole: string) => {
      // "2 m g" is the spaced product m g, and "4 m squared" or "6 m times"
      // are still arithmetic; only a quantity that ends here gets a unit word.
      const rest = whole.slice(offset + match.length);
      if (/^\s+(?:[A-Za-z](?![\p{L}\p{N}_])|(?:times|squared|cubed|over|plus|minus|into|by|divided|per)\b)/u
        .test(rest)) return match;
      // A bare m is a mass as often as a meter ("block ka mass 2 m hai"), so
      // it is a meter only where the words around it measure a length.
      if (unit === "m" && !bareMeterContext(whole.slice(0, offset), rest)) return match;
      const words = SPACED_UNIT_WORDS[unit]!;
      return `${value} ${Number(value.replace(/,/g, "")) === 1 ? words[0] : words[1]}`;
    })
    .replace(ORDINAL, (_match, digits: string) => ordinalWords(digits))
    .replace(CLOCK_TIME, (_match, hours: string, minutes: string) =>
      `${numberToSpokenWords(hours)} ${minutes === "00" ? "o'clock" : minutes.startsWith("0") ? `oh ${numberToSpokenWords(minutes)}` : numberToSpokenWords(minutes)}`)
    .replace(NUMBER, (match: string, offset: number, whole: string) => {
      const trailingComma = match.endsWith(",") ? "," : "";
      const number = trailingComma ? match.slice(0, -1) : match;
      // 1,00,000 (Indian) and 100,000 (Western) are one number; "1,2,3" is a list.
      const words = INDIAN_GROUPED.test(number)
        ? indianWords(number)
        : GROUPED_NUMBER.test(number) || !number.includes(",")
        ? numberToSpokenWords(number.startsWith(".") ? `0${number}` : number).replace(/^zero point/, number.startsWith(".") ? "point" : "zero point")
        : number.split(",").map((part) => numberToSpokenWords(part)).join(", ");
      // "5x" and "H2O" keep a word boundary on both sides.
      const before = /\p{L}/u.test(whole[offset - 1] ?? "") ? " " : "";
      const after = /\p{L}/u.test(whole[offset + match.length] ?? "") ? " " : "";
      return before + words + trailingComma + after;
    })
    .replace(/\s*%/g, " percent")
    .replace(/।/g, ".");
}

/**
 * A unit symbol spaced after a number, as the runtime given lines and figure
 * captions write it: "t equals 4 s से", "40 m, rectangle". The digits become
 * English words below, but the letter stayed a letter, so the Hinglish voice
 * said "four s". A spaced unit is a quantity by the teaching convention (a
 * product is glued, `2m`, and mathToSpeech keeps that glue as a no-break
 * space, which `[ \t]+` below does not match). Single capitals other than
 * N, J and W also name points and bodies, so they are left alone. g and h
 * are left alone too: "acceleration 2 g hai" is twice g and "height 2 h hai"
 * twice a height, far more often than grams or hours. Only the audio sees
 * this.
 */
const SPACED_UNIT_WORDS: Record<string, [string, string]> = {
  s: ["second", "seconds"], ms: ["millisecond", "milliseconds"],
  m: ["meter", "meters"], cm: ["centimeter", "centimeters"], mm: ["millimeter", "millimeters"],
  km: ["kilometer", "kilometers"], kg: ["kilogram", "kilograms"],
  N: ["newton", "newtons"], J: ["joule", "joules"], kJ: ["kilojoule", "kilojoules"],
  W: ["watt", "watts"], Hz: ["hertz", "hertz"], Pa: ["pascal", "pascals"],
};
const SPACED_UNIT = new RegExp(
  // "1,000 m" is one number. Without the grouped form the lookbehind refused
  // the "000" and the whole quantity kept its letter.
  `(?<![\\p{L}\\p{N}_.,])(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)[ \\t]+(${Object.keys(SPACED_UNIT_WORDS).join("|")})(?![\\p{L}\\p{N}_/^²³'′])`,
  "gu",
);
/** Where a bare m ends its quantity: a comma, a full stop (or ।), the end, or a postposition. */
const BARE_METER_END = /^(?:[,.।]|\s*$|\s+(?:se|me|ka|ki|ko|से|में|का|की|को)(?![\p{L}\p{M}\p{N}_]))/u;
/**
 * The word after a length: a preposition or a direction ("75 m above the
 * ground", "240 m east", "30 m आगे"). Measured on 20 Oct 2026 in the recorded
 * lessons, where these were spoken as "seventy five m".
 */
const BARE_METER_LENGTH_NEXT =
  /^\s+(?:above|below|beneath|under|from|to|of|in|on|at|onto|along|across|through|behind|beyond|ahead|apart|away|toward|towards|up|down|upward|upwards|downward|downwards|high|long|wide|deep|tall|east|west|north|south|left|right|forward|forwards|backward|backwards|par|tak|aage|peeche|upar|neeche|पर|तक|आगे|पीछे|ऊपर|नीचे)(?![\p{L}\p{M}\p{N}_])/u;
/**
 * A length symbol given the quantity: "x equals 40 m", "delta x equals 50 m",
 * "h max equals 20 m". The teaching model reads a figure label aloud and
 * points at it, "x=40 m [FOCUS:B] turnaround position", so the quantity ends
 * at the pointing tag; speech never sees the tag, only "x equals 40 m
 * turnaround position". A position, height, distance, radius, length or
 * width named by its symbol is a length whatever follows it.
 */
const BARE_METER_LENGTH_SYMBOL =
  /(?:^|[^\p{L}\p{M}\p{N}_])(?:delta\s+)?[xyzhdsrlwLR](?:\s+(?:[A-Z]|max|min|zero|one|two|three|\d+))?\s+equals\s+[+-]?$/u;
/**
 * A clause that names a mass: "two blocks of masses 2 m and 3 m", "has mass
 * 2 m", "a mass of 3 m". There m is the mass unit of the problem, never a
 * meter, whatever word follows ("a mass of 3 m on the incline").
 */
const MASS_CLAUSE = /(?<![\p{L}\p{M}\p{N}_])(?:mass(?:es)?|द्रव्यमान)(?![\p{L}\p{M}\p{N}_])/iu;

/**
 * A bare m after a number is spoken as meters only in a measured length:
 * where its quantity visibly ends, before a preposition or a direction, or
 * after a length symbol. Never in a clause that names a mass: that m is
 * unclear as a letter but false as a meter.
 */
function bareMeterContext(before: string, rest: string): boolean {
  const clause = before.split(/[.;:!?।](?=\s|$)/u).at(-1) ?? before;
  if (MASS_CLAUSE.test(clause)) return false;
  return BARE_METER_END.test(rest) || BARE_METER_LENGTH_NEXT.test(rest) || BARE_METER_LENGTH_SYMBOL.test(before);
}
const ORDINAL = /\b(\d+)(?:st|nd|rd|th)\b/gi;
const CLOCK_TIME = /\b(\d{1,2}):([0-5]\d)\b/g;
const NUMBER = /\.?\d[\d,]*(?:\.\d+)?/g;
const GROUPED_NUMBER = /^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d+)?$/;
const INDIAN_GROUPED = /^\d{1,2}(?:,\d{2})+,\d{3}$/;

/** 1,00,000 is "one lakh" to a student who writes it that way. */
function indianWords(number: string): string {
  const value = Number(number.replace(/,/g, ""));
  const crore = Math.floor(value / 10_000_000);
  const lakh = Math.floor((value % 10_000_000) / 100_000);
  const rest = value % 100_000;
  return [
    crore ? `${numberToSpokenWords(String(crore))} crore` : "",
    lakh ? `${numberToSpokenWords(String(lakh))} lakh` : "",
    rest ? numberToSpokenWords(String(rest)) : "",
  ].filter(Boolean).join(" ");
}
const ORDINAL_ENDINGS: Record<string, string> = {
  one: "first", two: "second", three: "third", five: "fifth",
  eight: "eighth", nine: "ninth", twelve: "twelfth",
};

function ordinalWords(digits: string): string {
  const words = numberToSpokenWords(digits).split(" ");
  const last = words.pop() ?? "";
  const ordinal = ORDINAL_ENDINGS[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...words, ordinal].join(" ");
}

function pace(speed: number | undefined): number {
  return typeof speed === "number" && Number.isFinite(speed)
    ? Math.min(2, Math.max(0.5, speed))
    : 1;
}

export function sarvamConfigMessage(config: TtsConfig, speed?: number) {
  return {
    type: "config",
    data: {
      language_code: "hi-IN",
      speaker: config.voiceId,
      pace: pace(speed),
      speech_sample_rate: SAMPLE_RATE,
      output_audio_codec: "linear16",
    },
  };
}

/** Split at whitespace into messages Sarvam accepts; one flush still yields one final. */
export function sarvamTextMessages(text: string): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  let rest = text;
  while (rest.length > SARVAM_MAX_TEXT_CHARS) {
    // The space stays with the first part, so it must sit inside the limit.
    const cut = rest.lastIndexOf(" ", SARVAM_MAX_TEXT_CHARS - 1);
    const at = cut > 0 ? cut + 1 : SARVAM_MAX_TEXT_CHARS;
    messages.push({ type: "text", data: { text: rest.slice(0, at) } });
    rest = rest.slice(at);
  }
  if (rest) messages.push({ type: "text", data: { text: rest } });
  return messages;
}

/**
 * Sarvam has no context ids, so one segment is in flight at a time and the
 * rest wait here. A final belongs to the segment in flight.
 */
export class SarvamSegments {
  private queue: { id: string; text: string }[] = [];
  private current: { id: string; chunks: Buffer[]; bytes: number } | null = null;

  /** Messages to send now: the segment's text and a flush, or nothing while another is in flight. */
  start(id: string, text: string): Record<string, unknown>[] {
    if (this.queue.length >= 24) throw new Error("Too many queued speech segments");
    this.queue.push({ id, text });
    return this.current ? [] : this.next();
  }

  /** After a final, the messages that start the next queued segment. */
  next(): Record<string, unknown>[] {
    if (this.current) return [];
    const segment = this.queue.shift();
    if (!segment) return [];
    this.current = { id: segment.id, chunks: [], bytes: 0 };
    return [...sarvamTextMessages(sarvamSpeechText(segment.text)), { type: "flush" }];
  }

  accept(raw: string): string | null {
    const message = JSON.parse(raw);
    if (message?.type === "error") {
      // Never forward Sarvam's message: it can echo the student's text.
      throw new Error("Sarvam speech generation failed");
    }
    const current = this.current;
    if (!current) return null;
    if (message?.type === "audio" && typeof message.data?.audio === "string") {
      const bytes = Buffer.from(message.data.audio, "base64");
      current.bytes += bytes.length;
      if (current.bytes > MAX_SEGMENT_AUDIO_BYTES)
        throw new Error("Speech audio exceeded segment limit");
      current.chunks.push(bytes);
      return null;
    }
    if (message?.type !== "event" || message.data?.event_type !== "final") return null;
    this.current = null;
    // A sentence of punctuation alone can come back empty; a breath of
    // silence keeps the lesson moving instead of closing the socket.
    if (!current.bytes) current.chunks.push(Buffer.alloc(SILENT_FINAL_BYTES));
    return JSON.stringify({
      contextId: current.id,
      isFinal: true,
      audio: pcmToWav(Buffer.concat(current.chunks)).toString("base64"),
    });
  }

  /** Remove a queued segment the client no longer wants. The one in flight cannot be recalled. */
  cancel(id: string): boolean {
    const at = this.queue.findIndex((segment) => segment.id === id);
    if (at < 0) return false;
    this.queue.splice(at, 1);
    return true;
  }

  /** Segments that were queued but never sent, so their charge can be released. */
  undispatched(): string[] {
    return this.queue.map((segment) => segment.id);
  }

  clear(): void {
    this.queue = [];
    this.current = null;
  }
}

/** One sentence over REST. Returns a complete 24 kHz WAV. */
export async function requestSarvamWav(
  config: TtsConfig,
  text: string,
  speed: number | undefined,
  signal: AbortSignal,
): Promise<{ ok: true; wav: Buffer } | { ok: false; status: number }> {
  const response = await fetch(SARVAM_TTS_URL, {
    method: "POST",
    headers: {
      "api-subscription-key": config.apiKey!,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: sarvamSpeechText(text),
      language_code: "hi-IN",
      speaker: config.voiceId,
      model: config.model,
      pace: pace(speed),
      speech_sample_rate: SAMPLE_RATE,
      output_audio_codec: "linear16",
    }),
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, status: response.status };
  }
  const data = (await response.json()) as { audios?: unknown };
  const parts = Array.isArray(data.audios)
    ? data.audios.filter((part): part is string => typeof part === "string")
    : [];
  const pcm = Buffer.concat(parts.map((part) => Buffer.from(part, "base64")));
  if (!pcm.length || pcm.length > MAX_SEGMENT_AUDIO_BYTES)
    return { ok: false, status: 502 };
  return { ok: true, wav: pcmToWav(pcm) };
}
