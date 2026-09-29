import assert from "node:assert/strict";
import type { StoredSegment, StoredTurn } from "../../lib/boards/boardsClient";
import { frameCountForDuration, type PcmTrack } from "../../lib/lecture-export/lectureAudioTrack";
import {
  LECTURE_PLAYER_SAMPLE_RATE,
  buildLecturePlayerTrack,
  clearLecturePlayerTrackCache,
  decodeLectureAudioInBrowser,
  encodeWavPcm16,
  getLecturePlayerTrack,
  lecturePlayerTrackKey,
  mixToMono,
  type LecturePlayerTrack,
} from "../../lib/replay/lecturePlayerAudio";
import { buildReplayTimeline, type ReplayCue } from "../../lib/replay/replayTimeline";

function pcm16(sample: number): number {
  const x = Math.max(-1, Math.min(1, sample));
  return x >= 0 ? Math.round(x * 0x7fff) : Math.round(x * 0x8000);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function wavView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function pcmAt(bytes: Uint8Array, frame: number): number {
  return wavView(bytes).getInt16(44 + frame * 2, true);
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function microtasks(times = 24): Promise<void> {
  for (let index = 0; index < times; index++) {
    await Promise.resolve();
  }
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let index = 0; index < 1000; index++) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error(label);
}

function constantTrack(
  value: number,
  durationMs: number,
  sampleRate = LECTURE_PLAYER_SAMPLE_RATE,
): PcmTrack {
  const frames = frameCountForDuration(durationMs, sampleRate);
  return { sampleRate, channels: [new Float32Array(frames).fill(value)] };
}

function storedSegment(
  id: string,
  orderIndex: number,
  durationMs: number | null,
  audioUrl: string | null,
): StoredSegment {
  return {
    id,
    orderIndex,
    narration: `n-${id}`,
    spokenText: `n-${id}`,
    command: null,
    audioUrl,
    durationMs,
    timings: null,
  };
}

function storedTurn(id: string, segments: StoredSegment[]): StoredTurn {
  return {
    id,
    orderIndex: 0,
    question: id,
    rawResponse: "",
    speedMultiplier: 1,
    traceId: null,
    sceneDocument: null,
    sceneEngineVersion: null,
    validationReport: null,
    visualStatus: null,
    sceneArtifacts: null,
    segments,
  };
}

function cue(input: {
  id: string;
  durationMs: number;
  narration: string;
  audioUrl: string | null;
  startMs: number;
  segmentIndex?: number;
}): ReplayCue {
  const segment: StoredSegment = {
    id: input.id,
    orderIndex: input.segmentIndex ?? 0,
    narration: input.narration,
    spokenText: input.narration,
    command: null,
    audioUrl: input.audioUrl,
    durationMs: input.durationMs,
    timings: null,
  };
  return {
    id: input.id,
    turnIndex: 0,
    segmentIndex: input.segmentIndex ?? 0,
    startMs: input.startMs,
    endMs: input.startMs + input.durationMs,
    durationMs: input.durationMs,
    narration: input.narration,
    commands: [],
    trustedDiagramGeometry: false,
    audioUrl: input.audioUrl,
    durationMsStored: input.durationMs,
    timings: null,
    segment,
  };
}

function cueList(
  specs: Array<{ durationMs: number; narration: string; audioUrl: string | null }>,
): ReplayCue[] {
  let startMs = 0;
  return specs.map((spec, index) => {
    const built = cue({
      id: `c${index}`,
      durationMs: spec.durationMs,
      narration: spec.narration,
      audioUrl: spec.audioUrl,
      startMs,
      segmentIndex: index,
    });
    startMs += spec.durationMs;
    return built;
  });
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: string }).name === "AbortError"
  );
}

async function wavBytes(
  cues: ReplayCue[],
  options: {
    fetchBytes: (url: string) => Promise<Uint8Array | null>;
    decodeBytes: (data: ArrayBuffer) => Promise<PcmTrack | null>;
    concurrency?: number;
    sampleRate?: number;
    onProgress?: (loadedMs: number, totalMs: number) => void;
    shouldCancel?: () => boolean;
  },
): Promise<{ track: LecturePlayerTrack; wav: Uint8Array; blob: Blob }> {
  let blob: Blob | null = null;
  const track = await buildLecturePlayerTrack({
    cues,
    fetchBytes: options.fetchBytes,
    decodeBytes: options.decodeBytes,
    concurrency: options.concurrency,
    sampleRate: options.sampleRate,
    onProgress: options.onProgress,
    shouldCancel: options.shouldCancel,
    createObjectUrl: (value) => {
      blob = value;
      return "blob:lecture-player";
    },
  });
  assert.ok(blob, "createObjectUrl must receive the WAV blob");
  const captured = blob as Blob;
  assert.equal(captured.type, "audio/wav");
  return { track, wav: new Uint8Array(await captured.arrayBuffer()), blob: captured };
}

function urlCodec(tracks: Record<string, PcmTrack | "fetch-fail" | "decode-fail">): {
  fetchBytes: (url: string) => Promise<Uint8Array | null>;
  decodeBytes: (data: ArrayBuffer) => Promise<PcmTrack | null>;
} {
  return {
    fetchBytes: async (url) => {
      const entry = tracks[url];
      if (entry === undefined || entry === "fetch-fail") {
        return null;
      }
      return new TextEncoder().encode(url);
    },
    decodeBytes: async (data) => {
      const url = new TextDecoder().decode(data);
      const entry = tracks[url];
      if (entry === undefined || entry === "fetch-fail" || entry === "decode-fail") {
        return null;
      }
      return entry;
    },
  };
}

async function main(): Promise<void> {
  clearLecturePlayerTrackCache();

  const headerSamples = new Float32Array([1.5, -1.5, 0.5, 0]);
  const header = encodeWavPcm16(headerSamples, LECTURE_PLAYER_SAMPLE_RATE);
  const headerView = wavView(header);
  assert.equal(ascii(header, 0, 4), "RIFF");
  assert.equal(headerView.getUint32(4, true), header.length - 8);
  assert.equal(ascii(header, 8, 4), "WAVE");
  assert.equal(ascii(header, 12, 4), "fmt ");
  assert.equal(headerView.getUint32(16, true), 16);
  assert.equal(headerView.getUint16(20, true), 1);
  assert.equal(headerView.getUint16(22, true), 1);
  assert.equal(headerView.getUint32(24, true), LECTURE_PLAYER_SAMPLE_RATE);
  assert.equal(headerView.getUint32(28, true), LECTURE_PLAYER_SAMPLE_RATE * 2);
  assert.equal(headerView.getUint16(32, true), 2);
  assert.equal(headerView.getUint16(34, true), 16);
  assert.equal(ascii(header, 36, 4), "data");
  assert.equal(headerView.getUint32(40, true), headerSamples.length * 2);
  assert.equal(pcmAt(header, 0), 32767);
  assert.equal(pcmAt(header, 1), -32768);
  const half = pcmAt(header, 2);
  assert.ok(half === 16384 || half === 16383, `0.5 should encode to 16384 or 16383, got ${half}`);
  assert.equal(pcmAt(header, 3), 0);

  const empty = mixToMono([]);
  assert.equal(empty.length, 0);
  const single = new Float32Array([0.2, 0.4]);
  assert.equal(mixToMono([single]), single);
  const mixed = mixToMono([
    new Float32Array([1, 0.5, 0]),
    new Float32Array([0, 0.5, 1]),
  ]);
  assert.equal(mixed.length, 3);
  assert.equal(mixed[0], 0.5);
  assert.equal(mixed[1], 0.5);
  assert.equal(mixed[2], 0.5);

  const decoded = await decodeLectureAudioInBrowser(new ArrayBuffer(0));
  assert.equal(decoded, null);

  const turnA = storedTurn("turn-a", [
    storedSegment("s1", 0, 1000, "blob:a"),
    storedSegment("s2", 1, 500, null),
  ]);
  const turnB = storedTurn("turn-b", [storedSegment("s3", 0, 200, "https://cdn/x.mp3")]);
  assert.equal(lecturePlayerTrackKey([turnA, turnB]), lecturePlayerTrackKey([turnA, turnB]));
  assert.notEqual(
    lecturePlayerTrackKey([turnA, turnB]),
    lecturePlayerTrackKey([turnA, storedTurn("turn-b", [storedSegment("s3", 0, 200, "https://cdn/y.mp3")])]),
  );
  const timeline = buildReplayTimeline([
    storedTurn("t0", [
      storedSegment("keep", 0, 700, "blob:keep"),
    ]),
  ]);
  assert.ok(timeline.cues.length >= 1);

  const rate = LECTURE_PLAYER_SAMPLE_RATE;
  const stitchCues = cueList([
    { durationMs: 50, narration: "", audioUrl: null },
    { durationMs: 100, narration: "one", audioUrl: "blob:one" },
    { durationMs: 80, narration: "missing-url", audioUrl: null },
    { durationMs: 60, narration: "fetch-fail", audioUrl: "blob:fetch-fail" },
    { durationMs: 40, narration: "decode-fail", audioUrl: "blob:decode-fail" },
    { durationMs: 100, narration: "two", audioUrl: "blob:two" },
  ]);
  const stitch = await wavBytes(stitchCues, {
    ...urlCodec({
      "blob:one": constantTrack(0.5, 100),
      "blob:fetch-fail": "fetch-fail",
      "blob:decode-fail": "decode-fail",
      "blob:two": constantTrack(-0.25, 100),
    }),
  });
  const frames = stitchCues.map((item) => frameCountForDuration(item.durationMs, rate));
  const totalFrames = frames.reduce((sum, count) => sum + count, 0);
  assert.equal(stitch.wav.length, 44 + 2 * totalFrames);
  assert.equal(stitch.track.durationMs, 50 + 100 + 80 + 60 + 40 + 100);
  assert.equal(stitch.track.missingAudioCues, 3);
  const offset = (index: number) => frames.slice(0, index).reduce((sum, count) => sum + count, 0);
  assert.equal(pcmAt(stitch.wav, 0), 0);
  assert.equal(pcmAt(stitch.wav, offset(1) - 1), 0);
  assert.equal(pcmAt(stitch.wav, offset(1)), pcm16(0.5));
  assert.equal(pcmAt(stitch.wav, offset(2) - 1), pcm16(0.5));
  assert.equal(pcmAt(stitch.wav, offset(2)), 0);
  assert.equal(pcmAt(stitch.wav, offset(5) - 1), 0);
  assert.equal(pcmAt(stitch.wav, offset(5)), pcm16(-0.25));
  assert.equal(pcmAt(stitch.wav, totalFrames - 1), pcm16(-0.25));

  const stereoFrames = frameCountForDuration(50, rate);
  const stereo = await wavBytes(cueList([{ durationMs: 50, narration: "stereo", audioUrl: "blob:stereo" }]), {
    fetchBytes: async () => new TextEncoder().encode("blob:stereo"),
    decodeBytes: async () => ({
      sampleRate: rate,
      channels: [new Float32Array(stereoFrames).fill(0.5), new Float32Array(stereoFrames).fill(0.25)],
    }),
  });
  assert.equal(pcmAt(stereo.wav, 0), pcm16(0.375));

  let inFlight = 0;
  let maxInFlight = 0;
  let started = 0;
  const releaseFetches = deferred();
  const concurrentCues = cueList(
    Array.from({ length: 5 }, (_, index) => ({
      durationMs: 50,
      narration: `n${index}`,
      audioUrl: `blob:c${index}`,
    })),
  );
  const concurrentPending = buildLecturePlayerTrack({
    cues: concurrentCues,
    concurrency: 2,
    fetchBytes: async (url) => {
      started += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await releaseFetches.promise;
      inFlight -= 1;
      return new TextEncoder().encode(url);
    },
    decodeBytes: async () => constantTrack(0.2, 50),
    createObjectUrl: () => "blob:concurrent",
  });
  await waitUntil(() => started === 2, "concurrency 2 should start two fetches and hold the rest");
  assert.equal(started, 2, "concurrency 2 should start two fetches and hold the rest");
  assert.equal(inFlight, 2);
  assert.equal(maxInFlight, 2);
  releaseFetches.resolve();
  await concurrentPending;
  assert.ok(maxInFlight <= 2, `in-flight fetches reached ${maxInFlight}`);
  assert.equal(maxInFlight, 2);

  const progressCues = cueList([
    { durationMs: 100, narration: "a", audioUrl: "0" },
    { durationMs: 100, narration: "b", audioUrl: "1" },
    { durationMs: 100, narration: "c", audioUrl: "2" },
  ]);
  const gates = [deferred(), deferred(), deferred()];
  const progress: Array<[number, number]> = [];
  let startedFetches = 0;
  let completedFetches = 0;
  const progressPending = buildLecturePlayerTrack({
    cues: progressCues,
    fetchBytes: async (url) => {
      startedFetches += 1;
      await gates[Number(url)]!.promise;
      completedFetches += 1;
      return new TextEncoder().encode(url);
    },
    decodeBytes: async () => constantTrack(0.5, 100),
    onProgress: (loadedMs, totalMs) => {
      progress.push([loadedMs, totalMs]);
    },
    createObjectUrl: () => "blob:progress",
  });
  await waitUntil(() => startedFetches === 3, "all three progress fetches should start");
  gates[2]!.resolve();
  await waitUntil(() => completedFetches === 1, "later cue fetch should finish first");
  await microtasks();
  gates[1]!.resolve();
  await waitUntil(() => completedFetches === 2, "middle cue fetch should finish before the prefix");
  await microtasks();
  assert.equal(
    progress.length,
    0,
    "later cues resolving first must not grow the loaded prefix",
  );
  gates[0]!.resolve();
  const progressTrack = await progressPending;
  assert.equal(progressTrack.durationMs, 300);
  for (let index = 1; index < progress.length; index++) {
    assert.ok(progress[index]![0] >= progress[index - 1]![0], "loadedMs must be monotonic");
    assert.ok(progress[index]![1] >= progress[index - 1]![1], "totalMs must be monotonic");
  }
  assert.deepEqual(progress[progress.length - 1], [300, 300]);

  let fetchCount = 0;
  await assert.rejects(
    () =>
      buildLecturePlayerTrack({
        cues: cueList([{ durationMs: 80, narration: "go", audioUrl: "blob:cancel" }]),
        shouldCancel: () => true,
        fetchBytes: async () => {
          fetchCount += 1;
          return new Uint8Array([1]);
        },
        decodeBytes: async () => constantTrack(0.5, 80),
        createObjectUrl: () => "blob:cancelled",
      }),
    (error: unknown) => {
      assert.equal(isAbortError(error), true);
      assert.ok(error instanceof DOMException);
      assert.equal((error as DOMException).message, "Lecture track cancelled");
      return true;
    },
  );
  assert.equal(fetchCount, 0, "cancel before fetch must not issue the request");

  const resampleMs = 100;
  const resampled = await wavBytes(
    cueList([{ durationMs: resampleMs, narration: "slow", audioUrl: "blob:48k" }]),
    {
      sampleRate: LECTURE_PLAYER_SAMPLE_RATE,
      fetchBytes: async () => new TextEncoder().encode("blob:48k"),
      decodeBytes: async () => constantTrack(0.5, resampleMs, 48_000),
    },
  );
  const expectedFrames = frameCountForDuration(resampleMs, LECTURE_PLAYER_SAMPLE_RATE);
  assert.equal(resampled.wav.length, 44 + 2 * expectedFrames);
  assert.equal(pcmAt(resampled.wav, 0), pcm16(0.5));
  assert.equal(pcmAt(resampled.wav, expectedFrames - 1), pcm16(0.5));

  clearLecturePlayerTrackCache();
  const originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  try {
    let builds = 0;
    const first = getLecturePlayerTrack("same", async () => {
      builds += 1;
      return { url: "blob:same", durationMs: 10, missingAudioCues: 0 };
    });
    const second = getLecturePlayerTrack("same", async () => {
      builds += 1;
      return { url: "blob:same-other", durationMs: 10, missingAudioCues: 0 };
    });
    assert.equal(first, second);
    await first;
    assert.equal(builds, 1);

    clearLecturePlayerTrackCache();
    revoked.length = 0;

    await getLecturePlayerTrack("k1", async () => ({
      url: "blob:1",
      durationMs: 1,
      missingAudioCues: 0,
    }));
    await getLecturePlayerTrack("k2", async () => ({
      url: "blob:2",
      durationMs: 1,
      missingAudioCues: 0,
    }));
    await getLecturePlayerTrack("k3", async () => ({
      url: "blob:3",
      durationMs: 1,
      missingAudioCues: 0,
    }));
    await getLecturePlayerTrack("k1", async () => ({
      url: "blob:1-rebuild",
      durationMs: 1,
      missingAudioCues: 0,
    }));
    await getLecturePlayerTrack("k4", async () => ({
      url: "blob:4",
      durationMs: 1,
      missingAudioCues: 0,
    }));
    await microtasks();
    assert.ok(revoked.includes("blob:2"), `LRU eviction should revoke blob:2, got ${revoked.join(",")}`);
    assert.equal(revoked.includes("blob:1"), false, "a cache hit must keep that entry");
    assert.equal(revoked.includes("blob:3"), false);
    assert.equal(revoked.includes("blob:4"), false);

    clearLecturePlayerTrackCache();
    await microtasks();
    revoked.length = 0;

    let attempts = 0;
    await assert.rejects(() =>
      getLecturePlayerTrack("boom", async () => {
        attempts += 1;
        throw new Error("build failed");
      }),
    );
    const recovered = await getLecturePlayerTrack("boom", async () => {
      attempts += 1;
      return { url: "blob:recovered", durationMs: 4, missingAudioCues: 0 };
    });
    assert.equal(attempts, 2);
    assert.equal(recovered.url, "blob:recovered");

    await getLecturePlayerTrack("keep-a", async () => ({
      url: "blob:keep-a",
      durationMs: 1,
      missingAudioCues: 0,
    }));
    await getLecturePlayerTrack("keep-b", async () => ({
      url: "blob:keep-b",
      durationMs: 1,
      missingAudioCues: 0,
    }));
    revoked.length = 0;
    clearLecturePlayerTrackCache();
    await microtasks();
    assert.ok(revoked.includes("blob:recovered"));
    assert.ok(revoked.includes("blob:keep-a"));
    assert.ok(revoked.includes("blob:keep-b"));
  } finally {
    clearLecturePlayerTrackCache();
    await microtasks();
    URL.revokeObjectURL = originalRevoke;
  }
}

void main()
  .then(() => {
    console.log("verify-lecture-player-audio: ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
