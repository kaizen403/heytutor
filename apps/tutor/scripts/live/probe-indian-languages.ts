/** Billable smoke test: short synthetic lessons, HTTP and WebSocket, nine locales.
 * pnpm --filter @heytutor/tutor exec dotenv -e .env.local -- tsx scripts/live/probe-indian-languages.ts
 * Audio is saved privately under the OS temporary directory for listening.
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { INDIAN_LANGUAGE_OPTIONS, regionalNarration, TUTOR_VOICE_SETTINGS } from "@heytutor/tutor-core";
import { ttsConfig, type TtsConfig } from "../../lib/tts/providerConfig";
import { requestSarvamWav } from "../../lib/tts/sarvamProtocol";
import { createTtsRelay } from "../../lib/tts/ttsProvider";

function stream(config: TtsConfig, text: string): Promise<Buffer> {
  const relay = createTtsRelay(config);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(relay.url, { headers: relay.headers, handshakeTimeout: 10_000 });
    const timer = setTimeout(() => { socket.terminate(); reject(new Error("WebSocket timed out")); }, 30_000);
    let complete = false;
    socket.on("open", () => {
      for (const message of [...relay.openMessages ?? [], ...relay.segment("sample", text, TUTOR_VOICE_SETTINGS)]) {
        socket.send(JSON.stringify(message));
      }
    });
    socket.on("message", (raw) => {
      try {
        const normalized = relay.receive(raw.toString());
        if (!normalized) return;
        const packet = JSON.parse(normalized);
        if (packet.isFinal) {
          const bytes = Buffer.from(packet.audio, "base64");
          assert.ok(bytes.length > 1_000);
          complete = true;
          clearTimeout(timer);
          socket.close();
          resolve(bytes);
        }
      } catch {
        clearTimeout(timer); socket.close(); reject(new Error("WebSocket speech generation failed"));
      }
    });
    socket.on("error", () => { clearTimeout(timer); reject(new Error("WebSocket connection failed")); });
    socket.on("close", () => {
      clearTimeout(timer); relay.dispose();
      if (!complete) reject(new Error("WebSocket closed before audio completion"));
    });
  });
}

async function main() {
  assert.ok(process.env.SARVAM_API_KEY?.trim(), "SARVAM_API_KEY is required");
  const directory = await mkdtemp(join(tmpdir(), "accelute-indian-languages-"));
  let failed = false;
  for (const { language, voiceKey } of INDIAN_LANGUAGE_OPTIONS) {
    const copy = regionalNarration(language);
    if (!copy) continue;
    const config = ttsConfig(voiceKey);
    const text = `${copy.opening} x squared equals nine.`;
    for (const transport of ["http", "ws"] as const) {
      try {
        const started = Date.now();
        const http = transport === "http" ? await requestSarvamWav(config, text, 1, AbortSignal.timeout(30_000)) : null;
        if (http && !http.ok) throw new Error(`HTTP status ${http.status}`);
        const bytes = http?.ok ? http.wav : await stream(config, text);
        assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
        assert.ok(bytes.length > 1_000);
        const file = join(directory, `${language}-${transport}.wav`);
        await writeFile(file, bytes, { mode: 0o600 });
        console.log(JSON.stringify({ language, voiceKey, transport, bytes: bytes.length, generationMs: Date.now() - started, path: file }));
      } catch (error) {
        failed = true;
        console.error(JSON.stringify({ language, transport, error: error instanceof Error ? error.message : "generation failed" }));
      }
    }
  }
  if (failed) process.exitCode = 1;
}
void main().catch(() => { console.error("Indian language probe failed"); process.exitCode = 1; });
