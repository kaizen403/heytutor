import assert from "node:assert/strict";
import { StreamingSpeechClient } from "../../src/tts/streamingSpeechClient";

class PendingContext {
  static resumeCalls = 0;
  static decodeCalls = 0;
  static initialState: AudioContextState = "suspended";
  state: AudioContextState = PendingContext.initialState;
  currentTime = 0;
  destination = {};
  resume(): Promise<void> { PendingContext.resumeCalls++; return new Promise(() => {}); }
  async suspend() { this.state = "suspended"; }
  async close() { this.state = "closed"; }
  decodeAudioData(): Promise<AudioBuffer> { PendingContext.decodeCalls++; return new Promise(() => {}); }
}
class NativeAudio {
  static instances: NativeAudio[] = [];
  static hold = false;
  static rejectNext = false;
  releases: Array<() => void> = [];
  playbackRate = 1;
  preservesPitch = false;
  muted = false;
  volume = 1;
  currentTime = 0;
  paused = true;
  src: string;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  constructor(url: string) { this.src = url; NativeAudio.instances.push(this); }
  async play() {
    if (NativeAudio.rejectNext) {
      NativeAudio.rejectNext = false;
      throw new DOMException("native playback blocked", "NotAllowedError");
    }
    if (NativeAudio.hold) await new Promise<void>((resolve) => this.releases.push(resolve));
    this.paused = false;
    this.onplaying?.();
  }
  pause() { this.paused = true; }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
  load() {}
  end() { this.onended?.(); }
}
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: PendingContext });
Object.defineProperty(globalThis, "Audio", { configurable: true, value: NativeAudio });

async function waitFor(predicate: () => boolean, message: string) {
  for (let i = 0; i < 50 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 2));
  assert(predicate(), message);
}

const client = new StreamingSpeechClient();
client.setPlaybackRate(1.25);
let starts = 0;
const playback = client.playAudio(new Uint8Array([1, 2, 3]), { onStart: () => starts++ });
try {
  await waitFor(() => NativeAudio.instances.length === 1,
    "complete bytes must reach HTML audio without waiting for AudioContext.resume/decode");
  assert.equal(PendingContext.decodeCalls, 0, "native bytes must not need a WebAudio decode");
  assert.equal(starts, 1);
  const audio = NativeAudio.instances[0]!;
  assert.equal(audio.playbackRate, 1.25);
  assert.equal(audio.preservesPitch, true);
  audio.end();
  await playback;
} finally { client.stop(); }
class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  static latest: Socket;
  readyState = 0;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  segments = 0;
  listeners = new Set<(event: { data: string | Blob | ArrayBuffer }) => void>();
  constructor(_url: string) {
    Socket.latest = this;
    setTimeout(() => { this.readyState = 1; this.emit({ type: "ready" }); }, 0);
  }
  addEventListener(_type: string, listener: (event: { data: string | Blob | ArrayBuffer }) => void) { this.listeners.add(listener); }
  removeEventListener(_type: string, listener: (event: { data: string | Blob | ArrayBuffer }) => void) { this.listeners.delete(listener); }
  send(raw: string) { if (JSON.parse(raw).text) this.segments++; }
  close() { this.readyState = 3; this.onclose?.(); }
  emit(payload: object) { for (const listener of this.listeners) listener({ data: JSON.stringify(payload) }); }
  emitBinary(data: Blob | ArrayBuffer) { for (const listener of this.listeners) listener({ data }); }
}
const bytes = new Uint8Array([73, 68, 51, 4, 5, 6]);
const packet = { audio_base64: Buffer.from(bytes).toString("base64"),
  alignment: { character_start_times_seconds: [0, 0.2], character_end_times_seconds: [0.2, 0.4] } };
let wsEnabled = false;
let httpBody: ReadableStreamDefaultController<Uint8Array> | null = null;
const fetchBlob = globalThis.fetch;
Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Socket });
Object.defineProperty(globalThis, "location", { configurable: true,
  value: { protocol: "http:", host: "localhost:3000", origin: "http://localhost:3000" } });
Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url: unknown) => {
  if (String(url).includes("ws-ticket")) return Response.json(wsEnabled ? { ticket: "offline-test" } : {});
  assert(String(url).includes("/api/tts/stream"), "only offline transport stubs may run");
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { httpBody = controller; } }));
} });
async function verifyProvider(mode: "ws" | "http" | "ws-prefetch" | "http-prefetch", state: AudioContextState) {
  PendingContext.initialState = state;
  wsEnabled = mode.startsWith("ws");
  httpBody = null;
  const count = NativeAudio.instances.length;
  const previousSocket = Socket.latest;
  const next = new StreamingSpeechClient();
  let starts = 0;
  let ends = 0;
  let ready = 0;
  let captured: Uint8Array | undefined;
  let speech: Promise<void> | undefined;
  const options = { onAudioReady: () => {
    ready++;
    assert.equal(NativeAudio.instances.length, count, "readiness must precede native loading");
    assert.equal(PendingContext.decodeCalls, 0, "readiness must precede decoding");
  }, onStart: () => { starts++; next.pause(); next.resume(); }, onEnd: () => ends++,
    onAudioCaptured: (audio: { bytes: Uint8Array }) => { captured = audio.bytes; } };
  try {
    if (mode === "ws-prefetch") {
      let warmed = false;
      void next.prewarm().then(() => { warmed = true; });
      await waitFor(() => warmed, "native prewarm must not wait for suspended WebAudio");
    }
    if (mode.endsWith("prefetch")) next.prefetchSegment("Provider sentence.");
    else { speech = next.speakSegment("Provider sentence.", options); void speech.catch(() => {}); }
    if (wsEnabled) {
      await waitFor(() => Socket.latest !== previousSocket && Socket.latest?.segments === 1,
        "WS must generate without a WebAudio resume barrier");
      Socket.latest.emit({ context_id: "segment_1", ...packet });
    } else {
      await waitFor(() => httpBody !== null, "HTTP must generate without a WebAudio resume barrier");
      httpBody!.enqueue(new TextEncoder().encode(`${JSON.stringify(packet)}\n`));
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(NativeAudio.instances.length, count, "partial bytes must not start playback");
    assert.equal(ready, 0, "alignment/partial bytes are not complete audio readiness");
    if (!mode.endsWith("prefetch")) next.pause();
    if (wsEnabled) Socket.latest.emit({ context_id: "segment_1", isFinal: true });
    else httpBody!.close();
    if (mode.endsWith("prefetch")) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(NativeAudio.instances.length, count, "unclaimed prefetch must remain silent");
      speech = next.speakSegment("Provider sentence.", options); void speech.catch(() => {});
    } else {
      await waitFor(() => ready === 1, "complete bytes must be ready even during pause");
      assert.equal(NativeAudio.instances.length, count, "a final packet during pause must remain silent");
      next.resume();
    }
    await waitFor(() => NativeAudio.instances.length === count + 1,
      `${mode}/${state}: complete provider bytes must start HTML audio before WebAudio resume/decode`);
    const audio = NativeAudio.instances[count]!;
    assert.equal(ready, 1, "complete claimed provider bytes must emit onAudioReady exactly once");
    assert.equal(starts, 1);
    assert.equal(ends, 0, "native loading is not completion");
    assert.equal(PendingContext.decodeCalls, 0);
    next.pause(); next.resume(); next.pause(); next.resume();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(NativeAudio.instances.length, count + 1, "rapid pause/final/resume must retain one native element");
    assert.equal(starts, 1, "rapid pause/resume must not duplicate onStart");
    audio.end();
    await speech;
    assert.deepEqual(captured, bytes, "native playback must retain complete provider capture");
    assert.equal(ends, 1);
  } finally { next.stop(); }
}
const modes = ["ws", "http", "ws-prefetch", "http-prefetch"] as const;
const selected = process.argv[2];
for (const mode of modes) {
  if (selected && selected !== mode) continue;
  await verifyProvider(mode, "running"); // decode would remain pending forever
  await verifyProvider(mode, "suspended"); // resume would remain pending forever
}
if (!selected) {
  for (const mode of ["ws", "http"] as const) {
    wsEnabled = mode === "ws";
    httpBody = null;
    const oldSocket = Socket.latest;
    const aborted = new StreamingSpeechClient();
    const count = NativeAudio.instances.length;
    let ready = 0;
    let ends = 0;
    const speech = aborted.speakSegment("Abandon at complete provider readiness.", {
      onAudioReady: () => { ready++; aborted.abandonSpeaking(); }, onEnd: () => ends++,
    });
    void speech.catch(() => {});
    if (wsEnabled) {
      await waitFor(() => Socket.latest !== oldSocket && Socket.latest.segments === 1, "aborted WS setup");
      // Alignment alone must not trigger readiness or native loading.
      Socket.latest.emit({ context_id: "segment_1", alignment: packet.alignment });
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(ready, 0);
      Socket.latest.emit({ context_id: "segment_1", ...packet, isFinal: true });
    } else {
      await waitFor(() => httpBody !== null, "aborted HTTP setup");
      httpBody!.enqueue(new TextEncoder().encode(`${JSON.stringify(packet)}\n`));
      httpBody!.close();
    }
    await speech;
    assert.equal(ready, 1);
    assert.equal(ends, 0, "aborted startup must not manufacture completion");
    assert.equal(NativeAudio.instances.length, count, "abandon at readiness must prevent native loading");
    aborted.stop();
  }

  wsEnabled = false;
  httpBody = null;
  const prefetched = new StreamingSpeechClient();
  const prefetchCount = NativeAudio.instances.length;
  let prefetchReady = 0;
  let prefetchEnds = 0;
  prefetched.prefetchSegment("Claim the still-generating prefetch.");
  await waitFor(() => httpBody !== null, "in-progress prefetch setup");
  const prefetchedSpeech = prefetched.speakSegment("Claim the still-generating prefetch.", {
    onAudioReady: () => prefetchReady++, onEnd: () => prefetchEnds++,
  });
  void prefetchedSpeech.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 5));
  prefetched.pause();
  httpBody!.enqueue(new TextEncoder().encode(`${JSON.stringify(packet)}\n`));
  httpBody!.close();
  await waitFor(() => prefetchReady === 1, "claimed prefetch completed during pause must report ready");
  assert.equal(prefetchEnds, 0, "pause during prefetch completion must not end the sentence");
  assert.equal(NativeAudio.instances.length, prefetchCount);
  prefetched.resume();
  await waitFor(() => NativeAudio.instances.length === prefetchCount + 1, "resume must play the claimed prefetch");
  await new Promise((resolve) => setTimeout(resolve, 5));
  NativeAudio.instances.at(-1)!.end();
  await prefetchedSpeech;
  assert.equal(prefetchEnds, 1);
  prefetched.stop();

  // A rejected native WS start must really fall through to HTTP, without
  // synthetic callbacks or a second readiness signal for the same sentence.
  wsEnabled = true;
  const previousSocket = Socket.latest;
  const fallback = new StreamingSpeechClient();
  let fallbackStarts = 0;
  let fallbackEnds = 0;
  let fallbackReady = 0;
  const before = NativeAudio.instances.length;
  NativeAudio.rejectNext = true;
  httpBody = null;
  const fallbackSpeech = fallback.speakSegment("Native rejection needs another transport.", {
    onAudioReady: () => fallbackReady++, onStart: () => fallbackStarts++, onEnd: () => fallbackEnds++,
  });
  void fallbackSpeech.catch(() => {});
  await waitFor(() => Socket.latest !== previousSocket && Socket.latest.segments === 1, "WS fallback setup");
  Socket.latest.emit({ context_id: "segment_1", ...packet, isFinal: true });
  await waitFor(() => httpBody !== null, "rejected WS native start must request HTTP fallback");
  const failedAudio = NativeAudio.instances[before]!;
  assert.equal(fallbackStarts, 0);
  assert.equal(fallbackEnds, 0, "native rejection must not manufacture onEnd");
  assert.equal(failedAudio.paused, true);
  assert.equal(failedAudio.src, "", "failed WS element must unload before HTTP playback");
  httpBody!.enqueue(new TextEncoder().encode(`${JSON.stringify(packet)}\n`));
  httpBody!.close();
  await waitFor(() => fallbackStarts === 1, "HTTP fallback must genuinely start playback");
  assert.equal(fallbackReady, 1, "transport fallback must not duplicate readiness");
  NativeAudio.instances.at(-1)!.end();
  await fallbackSpeech;
  assert.equal(fallbackEnds, 1);
  fallback.stop();

  const stopping = new StreamingSpeechClient();
  NativeAudio.hold = true;
  let starts = 0;
  const oldCount = NativeAudio.instances.length;
  const stopped = stopping.playAudio(bytes, { onStart: () => starts++ });
  void stopped.catch(() => {});
  await waitFor(() => NativeAudio.instances.length === oldCount + 1, "pending native element must be allocated");
  const audio = NativeAudio.instances[oldCount]!;
  stopping.stop();
  await assert.rejects(stopped, /audio stopped/);
  for (const release of audio.releases.splice(0)) release();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(starts, 0, "late play resolution after stop must not announce speech");
  assert.equal(audio.paused, true, "late play resolution after stop must be silenced");
  assert.equal(audio.src, "");
  NativeAudio.hold = false;

  const rejecting = new StreamingSpeechClient();
  NativeAudio.rejectNext = true;
  await assert.rejects(rejecting.playAudio(bytes, { onStart: () => starts++ }), /native playback blocked/);
  const rejected = NativeAudio.instances.at(-1)!;
  assert.equal(starts, 0, "rejected native play is not an audible start");
  assert.equal(rejected.paused, true);
  assert.equal(rejected.src, "", "failed native audio must unload before fallback can speak");
  rejecting.stop();
}
async function verifyReadyCancellation(mode: "final" | "prefetch", cancel: "abandon" | "stop") {
  wsEnabled = true;
  const previousSocket = Socket.latest;
  const count = NativeAudio.instances.length;
  const next = new StreamingSpeechClient();
  let ready = 0;
  const staleCallbacks: string[] = [];
  const record = (name: string) => { if (ready) staleCallbacks.push(name); };
  const options = {
    onAudioReady: () => { ready++; if (cancel === "stop") next.stop(); else next.abandonSpeaking(); },
    onStart: () => record("start"), onEnd: () => record("end"), onError: () => record("error"),
    onTimings: () => record("timings"), onAudioCaptured: () => record("capture"),
  };
  let speech: Promise<void> | undefined;
  try {
    if (mode === "prefetch") { await next.prewarm(); next.prefetchSegment("Cancel at readiness."); }
    else { speech = next.speakSegment("Cancel at readiness.", options); void speech.catch(() => {}); }
    await waitFor(() => Socket.latest !== previousSocket && Socket.latest.segments === 1, "ready cancellation WS setup");
    Socket.latest.emit({ context_id: "segment_1", ...packet, isFinal: true });
    if (mode === "prefetch") {
      await new Promise((resolve) => setTimeout(resolve, 5));
      speech = next.speakSegment("Cancel at readiness.", options); void speech.catch(() => {});
    }
    await speech;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { mode, cancel, ready, staleCallbacks, elements: NativeAudio.instances.length - count };
  } finally { next.stop(); }
}
if (!selected || selected === "ready-cancel") {
  const outcomes = [];
  for (const mode of ["final", "prefetch"] as const) {
    for (const cancel of ["abandon", "stop"] as const) outcomes.push(await verifyReadyCancellation(mode, cancel));
  }
  console.log("readiness cancellation outcomes", JSON.stringify(outcomes));
  for (const result of outcomes) {
    assert.equal(result.ready, 1);
    assert.deepEqual(result.staleCallbacks, [], `${result.mode}/${result.cancel}: cancelled readiness must block every later callback`);
    assert.equal(result.elements, 0, `${result.mode}/${result.cancel}: cancelled readiness must block native startup`);
  }
}
if (!selected || selected === "immediate-stop") {
  const next = new StreamingSpeechClient();
  const count = NativeAudio.instances.length;
  let starts = 0;
  const playback = next.playAudio(bytes, { onStart: () => starts++ });
  void playback.catch(() => {});
  next.stop();
  try {
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(NativeAudio.instances.length, count, "stop before the first await resumes must prevent any late native element");
    await playback;
    assert.equal(starts, 0);
    assert.equal(next.isPlaying, false);
  } finally { next.stop(); }
}
if (!selected || selected === "resume-owner") {
  const next = new StreamingSpeechClient();
  const count = NativeAudio.instances.length;
  NativeAudio.hold = true;
  let oldStarts = 0;
  let successorStarts = 0;
  try {
    const oldPlayback = next.playAudio(bytes, { onStart: () => oldStarts++ });
    void oldPlayback.catch(() => {});
    await waitFor(() => NativeAudio.instances.length === count + 1, "old native clip setup");
    const old = NativeAudio.instances[count]!;
    old.releases.shift()!();
    await waitFor(() => oldStarts === 1, "old native clip actually starts");
    next.pause(); next.resume();
    const resolveOldResume = old.releases.shift()!;
    next.stop();
    await assert.rejects(oldPlayback, /audio stopped/);
    const successorPlayback = next.playAudio(bytes, { onStart: () => successorStarts++ });
    void successorPlayback.catch(() => {});
    await waitFor(() => NativeAudio.instances.length === count + 2, "successor native clip setup");
    const successor = NativeAudio.instances[count + 1]!;
    resolveOldResume();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(successorStarts, 0, "an old resumed play resolution must never announce the successor's start");
    assert.equal(old.paused, true, "an old resumed play resolution must silence its own element");
    assert.equal(old.src, "");
    assert.equal(successor.paused, true, "successor must await its own play resolution");
    successor.releases.shift()!();
    await waitFor(() => successorStarts === 1, "successor announces only its own actual start");
    successor.end(); await successorPlayback;
    assert.equal(oldStarts, 1);
  } finally { next.stop(); NativeAudio.hold = false; }
}
function deferredBlob(values: number[]) {
  let release!: () => void;
  let reject!: (error: Error) => void;
  const data = new Uint8Array(values).buffer;
  const conversion = new Promise<ArrayBuffer>((resolve, rejectConversion) => {
    release = () => resolve(data); reject = rejectConversion;
  });
  // A later Blob may resolve before its ordered ingestion has even requested the conversion.
  void conversion.catch(() => {});
  const blob = new Blob([data]);
  blob.arrayBuffer = () => conversion;
  return { blob, release, reject };
}
async function verifyBinaryCompletion(paused: boolean) {
  wsEnabled = true;
  const previousSocket = Socket.latest;
  const count = NativeAudio.instances.length;
  const next = new StreamingSpeechClient();
  let ready = 0;
  let starts = 0;
  let ends = 0;
  let timings = 0;
  let captured: Uint8Array | undefined;
  const speech = next.speakSegment("Keep every packet in arrival order.", {
    onAudioReady: () => ready++, onStart: () => starts++, onEnd: () => ends++, onTimings: () => timings++,
    onAudioCaptured: (audio) => { captured = audio.bytes; },
  });
  void speech.catch(() => {});
  const first = deferredBlob([7, 8]);
  const second = deferredBlob([9, 10]);
  try {
    await waitFor(() => Socket.latest !== previousSocket && Socket.latest.segments === 1, "binary completion WS setup");
    Socket.latest.emit({ context_id: "segment_1", ...packet });
    await waitFor(() => timings > 0, "partial packet ingested before binary conversion");
    const partialTimings = timings;
    if (paused) next.pause();
    Socket.latest.emitBinary(first.blob);
    Socket.latest.emitBinary(second.blob);
    Socket.latest.emit({ context_id: "segment_1", audio_base64: "Cww=", alignment: packet.alignment, isFinal: true });
    Socket.latest.emit({ context_id: "segment_1", isFinal: true });
    // Exercise final/resume duplication while the earlier conversions are outstanding.
    next.pause(); next.resume(); if (paused) next.pause();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(ready, 0, "complete readiness must await every preceding Blob conversion");
    assert.equal(timings, partialTimings, "final timings must await preceding binary ingestion");
    assert.equal(NativeAudio.instances.length, count, "final/resume cannot load truncated provider bytes");
    second.release();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(ready, 0, "a later Blob resolving first must not complete the sentence");
    assert.equal(NativeAudio.instances.length, count);
    first.release();
    await waitFor(() => ready === 1, "readiness follows complete ordered binary ingestion");
    if (paused) {
      assert.equal(NativeAudio.instances.length, count, "complete bytes during pause remain silent");
      assert.equal(ends, 0);
      next.resume();
    }
    await waitFor(() => starts === 1, "complete bytes play once after ingestion/resume");
    assert.equal(ready, 1);
    assert.equal(timings, partialTimings + 1, "duplicate finals emit complete timings once before playback");
    assert.equal(NativeAudio.instances.length, count + 1, "duplicate final/resume must share one element");
    const audio = NativeAudio.instances[count]!;
    assert(audio.src.startsWith("blob:"), "native-byte inspection is offline blob-only");
    const nativeBytes = new Uint8Array(await (await fetchBlob(audio.src)).arrayBuffer());
    const expected = new Uint8Array([...bytes, 7, 8, 9, 10, 11, 12]);
    assert.deepEqual(nativeBytes, expected, "native bytes preserve WS arrival order, not conversion resolution order");
    audio.end(); await speech;
    assert.deepEqual(captured, expected, "capture and native playback contain the same complete sentence");
    assert.equal(ends, 1);
    assert.equal(starts, 1);
  } finally { first.release(); second.release(); next.stop(); }
}
if (!selected || selected === "binary-complete") {
  await verifyBinaryCompletion(false);
  await verifyBinaryCompletion(true);
}
if (!selected || selected === "binary-failure") {
  wsEnabled = true;
  httpBody = null;
  const previousSocket = Socket.latest;
  const count = NativeAudio.instances.length;
  const next = new StreamingSpeechClient();
  const pending = deferredBlob([7, 8]);
  let ready = 0;
  let starts = 0;
  let ends = 0;
  let captured: Uint8Array | undefined;
  const errors: unknown[] = [];
  const speech = next.speakSegment("A failed binary conversion must use the next transport.", {
    onAudioReady: () => ready++, onStart: () => starts++, onEnd: () => ends++, onError: (error) => errors.push(error),
    onAudioCaptured: (audio) => { captured = audio.bytes; },
  });
  void speech.catch(() => {});
  try {
    await waitFor(() => Socket.latest !== previousSocket && Socket.latest.segments === 1, "binary failure WS setup");
    Socket.latest.emit({ context_id: "segment_1", ...packet });
    Socket.latest.emitBinary(pending.blob);
    Socket.latest.emit({ context_id: "segment_1", isFinal: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(ready, 0);
    pending.reject(new Error("binary conversion failed"));
    await waitFor(() => httpBody !== null, "failed binary conversion must promptly request HTTP fallback");
    assert.equal(ready, 0, "a failed conversion cannot report complete WS bytes");
    assert.equal(NativeAudio.instances.length, count, "failed conversion cannot play truncated WS audio");
    httpBody!.enqueue(new TextEncoder().encode(`${JSON.stringify(packet)}\n`));
    httpBody!.close();
    await waitFor(() => starts === 1, "fallback genuinely starts after binary conversion fails");
    assert.equal(ready, 1, "only complete fallback bytes report readiness");
    assert.equal(NativeAudio.instances.length, count + 1);
    NativeAudio.instances[count]!.end(); await speech;
    assert.deepEqual(captured, bytes);
    assert.equal(ends, 1);
    assert.deepEqual(errors, [], "successful transport recovery is not a speech failure");
  } finally { pending.release(); next.stop(); }
}
if (!selected || selected === "binary-stop") {
  wsEnabled = true;
  const previousSocket = Socket.latest;
  const count = NativeAudio.instances.length;
  const next = new StreamingSpeechClient();
  const pending = deferredBlob([7, 8]);
  let cancelled = false;
  const staleCallbacks: string[] = [];
  const record = (name: string) => { if (cancelled) staleCallbacks.push(name); };
  const speech = next.speakSegment("Stop while binary conversion is outstanding.", {
    onAudioReady: () => record("ready"), onStart: () => record("start"), onEnd: () => record("end"),
    onTimings: () => record("timings"), onAudioCaptured: () => record("capture"), onError: () => record("error"),
  });
  void speech.catch(() => {});
  NativeAudio.hold = true;
  try {
    await waitFor(() => Socket.latest !== previousSocket && Socket.latest.segments === 1, "binary stop WS setup");
    Socket.latest.emit({ context_id: "segment_1", ...packet });
    Socket.latest.emitBinary(pending.blob);
    Socket.latest.emit({ context_id: "segment_1", isFinal: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    cancelled = true; next.stop(); await speech;
    let successorStarts = 0;
    const successor = next.playAudio(bytes, { onStart: () => successorStarts++ });
    void successor.catch(() => {});
    await waitFor(() => NativeAudio.instances.length === count + 1, "successor clip owns the only element");
    pending.release();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(staleCallbacks, [], "a stopped conversion cannot call back into its cancelled generation");
    assert.equal(NativeAudio.instances.length, count + 1, "stopped conversion cannot create another element");
    assert.equal(successorStarts, 0);
    const audio = NativeAudio.instances[count]!;
    audio.releases.shift()!();
    await waitFor(() => successorStarts === 1, "successor still owns its actual start");
    audio.end(); await successor;
  } finally { pending.release(); next.stop(); NativeAudio.hold = false; }
}
console.log("verified native startup: complete WS/HTTP/prefetch bytes, generation cancellation, ordered binary conversion, pause/final/resume races, and failure recovery");
