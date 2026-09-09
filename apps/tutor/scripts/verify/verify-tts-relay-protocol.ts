import {
  buildMultiContextSegmentMessages,
  normalizeMultiContextServerPayload,
} from "../../lib/tts/ttsRelayProtocol";

const [initializeMessage, flushMessage, closeMessage] = buildMultiContextSegmentMessages(
  "segment_12",
  "  Explain this region.  ",
  { stability: 0.5, similarity_boost: 0.75, speed: 1.1 },
);
if (initializeMessage.context_id !== "segment_12" || initializeMessage.text !== " ") {
  throw new Error("segment context was not initialized with the required blank space");
}
if (initializeMessage.voice_settings === undefined) {
  throw new Error("voice settings were not attached to context initialization");
}
if (
  flushMessage.context_id !== "segment_12" ||
  flushMessage.flush !== true ||
  flushMessage.text !== "Explain this region. "
) {
  throw new Error("context flush message is invalid");
}

// ElevenLabs answers a flush with audio and nothing else; the `isFinal` the
// browser waits on before it plays a word arrives only when the context is
// closed. Leaving it open cost twelve seconds of silence on the first line and
// then dropped the whole lecture onto the slower HTTP path.
if (closeMessage?.context_id !== "segment_12" || closeMessage.close_context !== true) {
  throw new Error("segment context was left open, so its audio can never be spoken");
}

const audio = normalizeMultiContextServerPayload(JSON.stringify({
  contextId: "segment_12",
  audio: "abc",
  is_final: false,
}));
if (audio.finalContextId !== undefined) throw new Error("audio chunk ended its context early");

const final = normalizeMultiContextServerPayload(JSON.stringify({
  contextId: "segment_12",
  is_final: true,
}));
if (final.finalContextId !== "segment_12") throw new Error("authoritative context final was lost");
if (JSON.parse(final.forwardPayload).isFinal !== true) throw new Error("client final alias was not emitted");

let rejected = false;
try {
  buildMultiContextSegmentMessages("unsafe context", "text", { stability: 0.5, similarity_boost: 0.75 });
} catch {
  rejected = true;
}
if (!rejected) throw new Error("invalid relay context id was accepted");

console.log("tts multi-context relay protocol verification passed");
