import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDictationAudio } from "../../lib/tts/audioValidation";

function wav(seconds: number): Uint8Array {
  const sampleRate = 16_000;
  const dataBytes = seconds * sampleRate * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const header = new DataView(bytes.buffer);
  const text = (offset: number, value: string) =>
    bytes.set(new TextEncoder().encode(value), offset);
  text(0, "RIFF");
  header.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVEfmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, "data");
  header.setUint32(40, dataBytes, true);
  return bytes;
}

function encodeAudio(
  input: Uint8Array,
  codec: string,
  format: string,
  extra: string[] = [],
): Uint8Array<ArrayBuffer> {
  const result = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "wav",
      "-i",
      "pipe:0",
      "-map",
      "0:a:0",
      "-threads",
      "1",
      "-c:a",
      codec,
      ...extra,
      "-f",
      format,
      "pipe:1",
    ],
    { input, timeout: 8000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(
    result.status,
    0,
    `generate a valid ${format} fixture: ${result.stderr?.toString()}`,
  );
  return new Uint8Array(result.stdout);
}

function seekableMp4(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const directory = mkdtempSync(join(tmpdir(), "heytutor-audio-check-"));
  const filename = join(directory, "dictation.mp4");
  try {
    const result = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "wav", "-i", "pipe:0", "-c:a", "aac", filename],
      { input, timeout: 8000 },
    );
    assert.equal(
      result.status,
      0,
      "generate an ordinary MP4 with its metadata after audio data",
    );
    return new Uint8Array(readFileSync(filename));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const shortWav = wav(1);
  const fixtures: [string, Uint8Array<ArrayBuffer>, string][] = [
    ["audio/wav", new Uint8Array(shortWav), "wav"],
    [
      "audio/webm;codecs=opus",
      encodeAudio(shortWav, "libopus", "webm"),
      "webm",
    ],
    ["audio/ogg", encodeAudio(shortWav, "libopus", "ogg"), "ogg"],
    [
      "audio/mp4",
      encodeAudio(shortWav, "aac", "mp4", [
        "-movflags",
        "frag_keyframe+empty_moov",
      ]),
      "mp4",
    ],
    ["audio/mpeg", encodeAudio(shortWav, "libmp3lame", "mp3"), "mp3"],
    ["audio/mp4", seekableMp4(shortWav), "mp4"],
  ];
  for (const [type, bytes, extension] of fixtures) {
    const result = await validateDictationAudio(new Blob([bytes], { type }));
    assert(
      result.ok,
      `${type}: valid browser-compatible audio remains usable: ${JSON.stringify(result)}`,
    );
    assert(
      result.durationSeconds > 0.9 && result.durationSeconds < 1.2,
      `${type}: decoded samples yield the actual duration`,
    );
    assert.equal(result.filename, `dictation.${extension}`);
  }
  const noisyWav = wav(30);
  let random = 1;
  for (let index = 44; index < noisyWav.length; index += 1) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    noisyWav[index] = random >>> 24;
  }
  const ordinaryMp4 = await validateDictationAudio(
    new Blob([seekableMp4(noisyWav)], { type: "audio/mp4" }),
  );
  assert(
    ordinaryMp4.ok,
    `a normal thirty-second MP4 remains usable: ${JSON.stringify(ordinaryMp4)}`,
  );
  assert(
    ordinaryMp4.durationSeconds > 29.9 && ordinaryMp4.durationSeconds < 30.2,
  );

  const minuteAac = encodeAudio(wav(60), "aac", "mp4", [
    "-movflags",
    "frag_keyframe+empty_moov",
  ]);
  const fullMinute = await validateDictationAudio(
    new Blob([minuteAac], { type: "audio/mp4" }),
  );
  assert(
    fullMinute.ok,
    `codec padding must not reject a normal full-minute take: ${JSON.stringify(fullMinute)}`,
  );
  const compressedLong = encodeAudio(wav(120), "libopus", "ogg");
  assert(
    compressedLong.byteLength < 10 * 1024 * 1024,
    "the attack fixture stays below the old byte cap",
  );
  const overlong = await validateDictationAudio(
    new Blob([compressedLong], { type: "audio/ogg" }),
  );
  assert(
    !overlong.ok && overlong.status === 413,
    "two minutes of compressed audio is refused by decoded duration",
  );
  const mislabeled = await validateDictationAudio(
    new Blob([new Uint8Array(shortWav)], { type: "audio/mp4" }),
  );
  assert(
    !mislabeled.ok && mislabeled.status === 400,
    "client MIME labels cannot disguise the container",
  );
  const junk = await validateDictationAudio(
    new Blob(["not an audio container"], { type: "audio/webm" }),
  );
  assert(
    !junk.ok && junk.status === 400,
    "fake media is refused before a vendor sees it",
  );
  const malformed = await validateDictationAudio(
    new Blob([new Uint8Array(shortWav.subarray(0, 36))], { type: "audio/wav" }),
  );
  assert(
    !malformed.ok && malformed.status === 400,
    "truncated containers do not produce an authorized duration",
  );
  const abort = new AbortController();
  abort.abort();
  const cancelled = await validateDictationAudio(
    new Blob([new Uint8Array(shortWav)], { type: "audio/wav" }),
    abort.signal,
  );
  assert(
    !cancelled.ok && cancelled.status === 400,
    "cancelled input cannot start a media probe",
  );
  console.log(
    "✓ dictation validates real WAV/WebM/Ogg/MP4/MP3, decoded duration, MIME, and cancellation",
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
