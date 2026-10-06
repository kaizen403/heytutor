import assert from "node:assert/strict";
import { StreamingSpeechClient, type SpeakSegmentOptions } from "@heytutor/tutor-core";

type Blocked = Parameters<NonNullable<SpeakSegmentOptions["onPlaybackBlocked"]>>[0];
class Context {
  static instances: Context[] = [];
  static initialState: AudioContextState | "interrupted" = "suspended";
  static deferResume = false;
  state = Context.initialState;
  currentTime = 0;
  destination = {};
  resumeCalls = 0;
  releases: Array<() => void> = [];
  constructor() { Context.instances.push(this); }
  resume(): Promise<void> {
    this.resumeCalls++;
    return Context.deferResume ? new Promise<void>((resolve) => this.releases.push(resolve)) : Promise.resolve();
  }
  async suspend() { this.state = "suspended"; }
  async close() { this.state = "closed"; }
}
class Audio {
  static instances: Audio[] = [];
  static rejectNext = false;
  playbackRate = 1;
  preservesPitch = true;
  muted = false;
  volume = 1;
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  releases: Array<() => void> = [];
  rejectors: Array<(error: unknown) => void> = [];
  constructor(readonly src: string) { Audio.instances.push(this); }
  async play() {
    if (Audio.rejectNext) { Audio.rejectNext = false; throw new DOMException("offline gesture failure", "NotAllowedError"); }
    await new Promise<void>((resolve, reject) => { this.releases.push(resolve); this.rejectors.push(reject); });
    this.onplaying?.();
  }
  pause() {} removeAttribute() {} load() {}
}
class Utterance {
  onstart: (() => void) | null = null; onend: (() => void) | null = null;
  onerror = null; onboundary = null; rate = 1; pitch = 1; volume = 1;
  constructor(readonly text: string) {}
}
const saved = new Map<string, PropertyDescriptor | undefined>();
function replace(key: string, value: unknown) {
  if (!saved.has(key)) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
replace("window", globalThis);
replace("AudioContext", Context);
replace("Audio", Audio);
replace("location", { protocol: "http:", host: "localhost:3000", origin: "http://localhost:3000" });
replace("SpeechSynthesisUtterance", Utterance);
replace("speechSynthesis", {
  getVoices: () => [{ name: "Offline", lang: "en-US" }], resume() {}, cancel() {},
  speak: (utterance: Utterance) => { setTimeout(() => { utterance.onstart?.(); utterance.onend?.(); }, 0); },
});
replace("fetch", async (url: unknown) => {
  if (String(url).includes("ws-ticket")) return Response.json({});
  if (String(url).endsWith("/api/tts")) return Response.json({});
  assert(String(url).includes("/api/tts/stream"), "only offline TTS stubs may run");
  return new Response(`${JSON.stringify({ audio_base64: Buffer.from([73, 68, 51, 1]).toString("base64") })}\n`);
});
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const waitFor = async (predicate: () => boolean) => {
  for (let i = 0; i < 200 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
  assert(predicate(), "offline provider did not reach the expected playback boundary");
};

async function main() {
  try {
    for (const state of ["suspended", "interrupted"] as const) {
      Context.initialState = state;
      const client = new StreamingSpeechClient();
      const events: Blocked[] = [];
      assert.equal(client.getAudioContextState(), null, "reading diagnostics must not create a context");
      await client.prewarm();
      assert.equal(client.getAudioContextState(), state);
      const count = Audio.instances.length;
      const speech = client.speakSegment("Offline startup.", { onPlaybackBlocked: (event) => events.push(event) });
      void speech.catch(() => {});
      await waitFor(() => Audio.instances.length === count + 1);
      assert.equal(events.filter(Boolean).length, 0, "a suspended WebAudio context alone is not evidence that native playback is blocked");
      client.resume();
      await flush();
      assert.equal(events.filter(Boolean).length, 0, "a failed resume of an unused context must not label independent native playback as blocked");
      const ctx = Context.instances.at(-1)!;
      assert.equal(ctx.resumeCalls, 1, "blockage must follow an actual context resume attempt");
      client.stop();
      await speech;
      assert.equal(events.at(-1), null, "stopped playback invalidates its blocked status");
    }

    replace("Audio", undefined);
    Context.initialState = "suspended";
    const webAudio = new StreamingSpeechClient();
    const webAudioEvents: Blocked[] = [];
    await webAudio.speakSegment("WebAudio startup.", { onPlaybackBlocked: (event) => webAudioEvents.push(event) });
    assert.deepEqual(webAudioEvents.find(Boolean), { reason: "context-suspended", audioContextState: "suspended" });
    assert.equal(webAudioEvents.at(-1), null, "internal browser handoff invalidates the blocked WebAudio attempt");
    webAudio.stop();
    replace("Audio", Audio);

    Context.initialState = "suspended";
    const rejected = new StreamingSpeechClient();
    const rejectedEvents: Blocked[] = [];
    await rejected.prewarm();
    Audio.rejectNext = true;
    const rejectedSpeech = rejected.speakSegment("Rejected native startup.", { onPlaybackBlocked: (event) => rejectedEvents.push(event) });
    await waitFor(() => rejectedEvents.some(Boolean));
    assert(rejectedEvents.some((event) => event?.reason === "not-allowed"));
    assert.equal(rejectedEvents.at(-1)?.reason, "not-allowed", "a consumer must retain the actionable native clip until a tap or abandonment");
    rejected.stop();
    await rejectedSpeech;
    assert.equal(rejectedEvents.at(-1), null, "Stop invalidates the held native clip");

    const legacy = new StreamingSpeechClient();
    await legacy.prewarm(); Audio.rejectNext = true;
    await legacy.speakSegment("Legacy native startup.");
    legacy.stop();

    for (const mode of ["paused", "muted"] as const) {
      const client = new StreamingSpeechClient();
      const events: Blocked[] = [];
      await client.prewarm();
      if (mode === "muted") client.setMuted(true);
      const count = Audio.instances.length;
      const speech = client.speakSegment("Intentional silence.", { onPlaybackBlocked: (event) => events.push(event) });
      void speech.catch(() => {});
      await waitFor(() => Audio.instances.length === count + 1);
      if (mode === "paused") client.pause();
      else client.resume();
      for (const reject of Audio.instances.at(-1)!.rejectors) reject(new DOMException("offline gesture failure", "NotAllowedError"));
      await flush();
      assert.equal(events.filter(Boolean).length, 0, `${mode} playback must never request a gesture`);
      client.stop(); await speech;
    }

    Context.deferResume = true;
    const old = new StreamingSpeechClient();
    await old.prewarm();
    const oldEvents: Blocked[] = [];
    const count = Audio.instances.length;
    const oldSpeech = old.speakSegment("Old segment.", { onPlaybackBlocked: (event) => oldEvents.push(event) });
    await waitFor(() => Audio.instances.length === count + 1);
    old.resume();
    const ctx = Context.instances.at(-1)!;
    old.stop(); await oldSpeech;
    const eventCount = oldEvents.length;
    for (const release of ctx.releases) release();
    await flush();
    assert.equal(oldEvents.length, eventCount, "a late resume result cannot publish blockage after Stop");
    console.log("verified optional playback diagnostics use actual failures, ignore suspended context alone, suppress pause/mute, and clear abandoned ownership");
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
