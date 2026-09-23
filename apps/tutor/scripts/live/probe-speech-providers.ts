/** Live, billable smoke test: one HTTP sentence, one WS sentence, one transcription.
 * pnpm --filter @heytutor/tutor exec dotenv -e .env.local -- tsx scripts/live/probe-speech-providers.ts
 * Writes audio under the OS temporary directory, never credentials or student data.
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { ttsConfig, sttConfig } from "../../lib/tts/providerConfig";
import { createTtsRelay, requestTts } from "../../lib/tts/ttsProvider";
import { transcriptionRequest } from "../../lib/tts/transcriptionProvider";
import { mathToSpeech, TUTOR_VOICE_SETTINGS } from "@heytutor/tutor-core";

async function main() {
  const config = ttsConfig();
  assert(config.apiKey && config.voiceId, "Selected speech provider is not configured");
  const directory = await mkdtemp(join(tmpdir(), "accelute-speech-"));
  const text = mathToSpeech("Let's look at the block on the slope. Gravity pulls it downward, and the surface pushes back at right angles. Friction opposes the block's tendency to slide.");
  const startedAt = Date.now();
  const response = await requestTts(config, { text, voice_settings: TUTOR_VOICE_SETTINGS }, true);
  if (!response.ok) throw new Error(`HTTP synthesis failed (${response.status})`);
  const lines = (await response.text()).trim().split(/\r?\n/);
  const packets = lines.filter(Boolean).map(line => JSON.parse(line.replace(/^data:\s*/, "")));
  const bytes = Buffer.concat(packets.map(packet => Buffer.from(packet.audio ?? packet.audio_base64 ?? "", "base64")));
  assert(bytes.length > 1000, "HTTP synthesis returned no playable audio");
  assert(packets.some(packet => packet.alignment?.character_start_times_seconds?.length === text.length), "HTTP synthesis returned no complete character timings");
  const extension = bytes.toString("ascii", 0, 4) === "RIFF" ? "wav" : "mp3";
  const httpFile = join(directory, `incline-http.${extension}`);
  await writeFile(httpFile, bytes, { mode: 0o600 });
  console.log(JSON.stringify({ transport: "http", provider: config.provider, model: config.model, bytes: bytes.length, generationMs: Date.now() - startedAt, path: httpFile }));

  const relay = createTtsRelay(config);
  const wsBytes = await new Promise<Buffer>((resolve, reject) => {
    const socket = new WebSocket(relay.url, { headers: relay.headers, handshakeTimeout: 10000 });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { socket.terminate(); reject(new Error("WebSocket synthesis timed out")); }, 30000);
    let complete = false;
    socket.on("open", () => {
      for (const message of relay.segment("segment_1", "If the block is stationary, static friction adjusts to balance the force along the slope.", TUTOR_VOICE_SETTINGS)) socket.send(JSON.stringify(message));
    });
    socket.on("message", raw => {
      try {
        const normalized = relay.receive(raw.toString());
        if (!normalized) return;
        const packet = JSON.parse(normalized);
        if (packet.audio || packet.audio_base64) chunks.push(Buffer.from(packet.audio ?? packet.audio_base64, "base64"));
        if (packet.isFinal) {
          complete = true;
          clearTimeout(timer);
          assert(chunks.length > 0, "WebSocket returned no audio");
          socket.close(); resolve(Buffer.concat(chunks));
        }
      } catch { clearTimeout(timer); socket.close(); reject(new Error("WebSocket speech generation failed")); }
    });
    socket.on("error", () => { clearTimeout(timer); reject(new Error("WebSocket provider connection failed")); });
    socket.on("close", () => { clearTimeout(timer); relay.dispose(); if (!complete) reject(new Error("WebSocket closed before audio completion")); });
  });
  const wsFile = join(directory, `incline-ws.${extension}`);
  await writeFile(wsFile, wsBytes, { mode: 0o600 });
  console.log(JSON.stringify({ transport: "ws", bytes: wsBytes.length, path: wsFile }));

  const stt = sttConfig();
  assert(stt.apiKey, "Selected transcription provider is not configured");
  const input = transcriptionRequest(stt, new Blob([new Uint8Array(bytes)], { type: extension === "wav" ? "audio/wav" : "audio/mpeg" }), `sample.${extension}`, "en");
  const result = await fetch(stt.url, { method: "POST", ...input, signal: AbortSignal.timeout(30000) });
  if (!result.ok) throw new Error(`Transcription failed (${result.status})`);
  const transcript = await result.json() as { text?: string };
  assert(transcript.text?.trim(), "Transcription returned no text");
  console.log(JSON.stringify({ transcription: transcript.text, sampleDirectory: directory }));
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Speech probe failed"); process.exitCode = 1; });
