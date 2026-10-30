import { WebSocket } from "ws";
import { normalizeVoiceKey, type TutorVoiceKey } from "@heytutor/tutor-core";
import { prisma } from "../db/prisma";
import { captureTtsRelayFailure } from "../obs/sentryNode";
import { flushInBackground, recordTtsSpan } from "../obs/langfuse";
import { assertOwnedTrace } from "../obs/traceOwnership";
import { calculateTtsCostDetails } from "../obs/usageCost";
import { consumeTtsChars, getTurnGrant, shouldSkipTtsForUsage, type TurnGrant } from "../billing/grant";
import { reservePaidUsage, type PaidUsageReservation } from "../billing/paidUsage";
import { recordTtsSpend } from "../billing/track";
import { ttsConfig } from "./providerConfig";
import { createTtsRelay } from "./ttsProvider";
import { sarvamSpeechText } from "./sarvamProtocol";
import { registerWsConnectionRevocation } from "./wsTicket";
import { releaseTtsWsConnection, TTS_WS_IDLE_MS, TTS_WS_MAX_MESSAGE_CHARS, ttsWsCharsWithinCeiling } from "./wsRelayLimits";

export interface TtsRelayContext {
  userId: string;
  grant: TurnGrant;
  traceId: string;
  sessionId?: string;
  speed?: number;
  voiceKey?: TutorVoiceKey;
  lowLatency?: boolean;
  releaseConnection?: () => void;
}
interface SegmentMessage {
  /** The client dropped this lookahead segment; a serial vendor removes it if unsent. */
  cancel_segment_index?: unknown;
  text?: unknown;
  flush?: unknown;
  segment_index?: unknown;
  voice_settings?: Record<string, unknown>;
}
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const MAX_QUEUED_MESSAGES = 32;

/**
 * Live relays and the segments each is still synthesising, so a restart can
 * let the sentence being spoken finish (see `installGracefulShutdown`).
 */
const liveRelays = new Set<{ pending: Map<string, unknown>; restart: () => void }>();
let speechDraining = false;

/** Receipt settlements (finish or refund) still in flight, across every relay. */
const settlements = new Set<Promise<unknown>>();
function trackSettlement<T>(settlement: Promise<T>): Promise<T> {
  settlements.add(settlement);
  // then(remove, remove): a raw (possibly rejecting) promise is tracked too,
  // and a derived finally() would reject unhandled.
  const remove = () => { settlements.delete(settlement); };
  settlement.then(remove, remove);
  return settlement;
}

/** Receipt settlements still open, for the exit log. */
export function openSpeechSettlements(): number {
  return settlements.size;
}

/**
 * Resolves once every receipt settlement already started has finished, so a
 * restart lets the charges for spoken segments land before the process exits.
 * The caller bounds the wait (`beforeExit` runs under its own cap).
 */
export function speechSettlementsDone(): Promise<unknown> {
  return Promise.allSettled([...settlements]);
}

/** Segments sent to the provider and not yet finished, across every relay. */
export function inFlightSpeechSegments(): number {
  let count = 0;
  for (const relay of liveRelays) count += relay.pending.size;
  return count;
}

/**
 * A restart has begun: an idle relay closes now with 1012 (service restart),
 * a busy one when its last segment finishes, and no new segment is admitted.
 * The browser treats the close like any other and falls back for the rest.
 */
export function beginSpeechDrain(): void {
  speechDraining = true;
  for (const relay of [...liveRelays]) if (relay.pending.size === 0) relay.restart();
}

/** Every segment is admitted and durably charged before the first vendor send.
 * Socket close/error retains that charge, including missing provider finals. */
export function relayTtsWebSocket(client: WebSocket, context: TtsRelayContext): void {
  let released = false;
  let stopped = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let undispatched: () => string[] = () => [];
  let unregister = () => {};
  let upstream: WebSocket | undefined = undefined;
  const pending = new Map<string, { receipt: PaidUsageReservation; characters: number; startedAt: number; grant: TurnGrant }>();
  const finishReceipt = (receipt: PaidUsageReservation) => trackSettlement(receipt.finish().catch(captureTtsRelayFailure));
  const live = { pending: pending as Map<string, unknown>, restart: () => close("server_restarting", 1012) };
  liveRelays.add(live);
  const teardown = () => {
    if (stopped) return;
    stopped = true;
    liveRelays.delete(live);
    if (idle) clearTimeout(idle);
    if (keepalive) clearInterval(keepalive);
    unregister();
    if (!released) { released = true; (context.releaseConnection ?? (() => releaseTtsWsConnection(context.userId)))(); }
    // A serial vendor (Sarvam) queues segments here; those never reached it.
    const neverSent = new Set(undispatched());
    for (const [id, spend] of pending) {
      if (neverSent.has(id)) trackSettlement(spend.receipt.cancelBeforeDispatch().catch(captureTtsRelayFailure));
      else finishReceipt(spend.receipt);
    }
    pending.clear();
    if (upstream?.readyState === WebSocket.OPEN) upstream.close();
    else if (upstream?.readyState === WebSocket.CONNECTING) upstream.terminate();
  };
  const close = (reason: string, code = 1008) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "skip", reason }));
      client.close(code, reason);
    }
    teardown();
  };
  client.on("close", teardown);
  client.on("error", teardown);
  unregister = registerWsConnectionRevocation(context.userId, () => close("account_revoked"));
  if (stopped) return;
  let config: ReturnType<typeof ttsConfig>;
  try { config = ttsConfig(normalizeVoiceKey(context.voiceKey), context.lowLatency); }
  catch { close("invalid_speech_configuration", 1011); return; }
  if (!config.apiKey || !config.voiceId) { close("tts_not_configured", 1011); return; }
  const { model, provider, voiceId } = config;
  let relay: ReturnType<typeof createTtsRelay>;
  try { relay = createTtsRelay(config, { speed: context.speed }); }
  catch (error) { captureTtsRelayFailure(error); close("speech_connection_failed", 1011); return; }
  client.once("close", () => relay.dispose());
  undispatched = () => relay.undispatched?.() ?? [];
  try { upstream = new WebSocket(relay.url, { headers: relay.headers, handshakeTimeout: 10_000, maxPayload: MAX_BUFFERED_BYTES }); }
  catch (error) { captureTtsRelayFailure(error); close("speech_connection_failed", 1011); return; }
  const vendor = upstream;
  let ready = false;
  let text = "";
  let voiceSettings: Parameters<typeof relay.segment>[2] | undefined;
  let segmentIndex: number | undefined;
  let sequence = 0;
  let charactersUsed = 0;
  let startedAt = 0;
  let queue = Promise.resolve();
  let queued = 0;
  const usedContexts = new Set<string>();
  let messageWindow = Date.now();
  let messagesInWindow = 0;
  const bumpIdle = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => close("idle"), TTS_WS_IDLE_MS);
  };
  bumpIdle();
  vendor.on("open", () => {
    if (stopped || client.readyState !== WebSocket.OPEN) { vendor.close(); return; }
    for (const payload of relay.openMessages ?? []) vendor.send(JSON.stringify(payload));
    const ping = relay.keepalive;
    if (ping) keepalive = setInterval(() => {
      if (vendor.readyState === WebSocket.OPEN) vendor.send(JSON.stringify(ping.message));
    }, ping.everyMs);
    ready = true;
    client.send(JSON.stringify({ type: "ready" }));
  });
  vendor.on("message", (data, isBinary) => {
    if (stopped || client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > MAX_BUFFERED_BYTES) { close("slow_client"); return; }
    if (isBinary) { client.send(data, { binary: true }); return; }
    try {
      const normalized = relay.receive(data.toString());
      if (!normalized) return;
      client.send(normalized);
      for (const payload of relay.drain?.() ?? []) vendor.send(JSON.stringify(payload));
      const message = JSON.parse(normalized);
      if (message.isFinal) {
        const id = message.contextId ?? message.context_id;
        const spend = pending.get(id);
        if (!spend) return;
        pending.delete(id);
        finishReceipt(spend.receipt);
        recordTtsSpan({ userId: context.userId, traceId: context.traceId, sessionId: context.sessionId,
          characters: spend.characters, model, provider, voiceId, transport: "ws", latencyMs: Date.now() - spend.startedAt });
        recordTtsSpend({ userId: context.userId, characters: spend.characters, model, provider,
          skipAutumn: spend.grant.skipAutumn, skipGates: spend.grant.skipGates, accounted: true });
        flushInBackground();
        if (speechDraining && pending.size === 0) close("server_restarting", 1012);
      }
    } catch (error) { captureTtsRelayFailure(error); close("speech_generation_failed", 1011); }
  });
  vendor.on("error", error => {
    // Stop/revocation terminates a CONNECTING socket, which ws reports as an error.
    // Accounting and queued-admission failures still report through their own catches.
    if (stopped) return;
    captureTtsRelayFailure(error);
    close("speech_generation_failed", 1011);
  });
  vendor.on("close", () => close("speech_connection_closed", 1011));
  async function accept(message: SegmentMessage): Promise<void> {
    if (stopped || !ready || vendor.readyState !== WebSocket.OPEN) return;
    if (message.cancel_segment_index !== undefined) {
      const index = Number(message.cancel_segment_index);
      if (!Number.isSafeInteger(index)) { close("invalid_segment"); return; }
      const id = `segment_${index}`;
      const spend = pending.get(id);
      // Only a segment the vendor never received is refunded; one in flight
      // finishes and is charged, and the client ignores its audio.
      if (spend && relay.cancel?.(id)) {
        pending.delete(id);
        await trackSettlement(spend.receipt.cancelBeforeDispatch().catch(captureTtsRelayFailure));
      }
      return;
    }
    if (message.text !== undefined && typeof message.text !== "string") { close("invalid_speech_request"); return; }
    if (typeof message.text === "string" && message.text.length) {
      if (!text) startedAt = Date.now();
      text += message.text;
      if (text.length > TTS_WS_MAX_MESSAGE_CHARS) { close("tts_budget"); return; }
    }
    if (message.segment_index !== undefined) {
      if (!Number.isSafeInteger(message.segment_index) || Number(message.segment_index) < 1 || Number(message.segment_index) > 1000) { close("invalid_segment"); return; }
      segmentIndex = Number(message.segment_index);
    }
    if (message.voice_settings && typeof message.voice_settings === "object") {
      const bounded = (key: string, fallback: number, min = 0, max = 1) => {
        const value = message.voice_settings?.[key];
        return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
      };
      voiceSettings = { stability: bounded("stability", 0.5), similarity_boost: bounded("similarity_boost", 0.75),
        style: bounded("style", 0), speed: bounded("speed", context.speed ?? 1, 0.7, 1.2) };
    }
    if (message.flush !== true) return;
    // During a restart no new segment is admitted or charged. A close or a
    // skip fails every segment this client is generating, so a busy relay
    // waits for its last in-flight segment and closes then.
    if (speechDraining) {
      if (pending.size === 0) close("server_restarting", 1012);
      return;
    }
    const segmentText = text.trim();
    const settings = voiceSettings ?? { stability: 0.5, similarity_boost: 0.75, speed: context.speed ?? 1 };
    const start = startedAt;
    const id = `segment_${segmentIndex ?? sequence + 1}`;
    text = ""; voiceSettings = undefined; segmentIndex = undefined; startedAt = 0;
    if (!segmentText) return;
    if (usedContexts.has(id) || pending.size >= 24 || usedContexts.size >= 240) { close("tts_budget"); return; }
    const user = await prisma.user.findUnique({ where: { id: context.userId }, select: { id: true } });
    const grant = getTurnGrant(context.userId);
    if (!user || !grant || !grant.allowedTraceIds.has(context.traceId) ||
      !await assertOwnedTrace(context.userId, context.traceId, context.sessionId)) { close("account_revoked"); return; }
    // Sarvam bills the text it receives, with digits spelled out as words.
    const characters = provider === "sarvam" ? sarvamSpeechText(segmentText).length : segmentText.length;
    if (!ttsWsCharsWithinCeiling(charactersUsed, characters) || shouldSkipTtsForUsage(grant) || !consumeTtsChars(grant, characters).allowed) { close("tts_budget"); return; }
    const receipt = await reservePaidUsage({
      actor: { userId: context.userId, email: null, staff: grant.skipGates, lectureLab: false,
        skipGates: grant.skipGates, skipAutumn: grant.skipAutumn },
      grant, kind: "tts", traceId: context.traceId, usd: calculateTtsCostDetails(characters, { model, provider }).total ?? 0,
    });
    if (receipt instanceof Response) { close("tts_budget"); return; }
    // The drain may have begun during the awaits above: nothing is dispatched.
    if (speechDraining) {
      // A failed refund is reported, never allowed to cut the sentence in flight.
      await trackSettlement(receipt.cancelBeforeDispatch().catch(captureTtsRelayFailure));
      if (pending.size === 0) close("server_restarting", 1012);
      return;
    }
    if (stopped || client.readyState !== WebSocket.OPEN || vendor.readyState !== WebSocket.OPEN) { await trackSettlement(receipt.cancelBeforeDispatch()); return; }
    if (vendor.bufferedAmount > MAX_BUFFERED_BYTES) { await trackSettlement(receipt.cancelBeforeDispatch()); close("speech_backpressure"); return; }
    sequence++; charactersUsed += characters; usedContexts.add(id);
    pending.set(id, { receipt, characters, startedAt: start, grant });
    // From this point any uncertain send failure is charged conservatively.
    for (const payload of relay.segment(id, segmentText, settings)) vendor.send(JSON.stringify(payload));
  }
  client.on("message", (data, isBinary) => {
    if (stopped) return;
    bumpIdle();
    const now = Date.now();
    if (now - messageWindow >= 1000) { messageWindow = now; messagesInWindow = 0; }
    if (++messagesInWindow > 60 || ++queued > MAX_QUEUED_MESSAGES || isBinary || data.toString().length > TTS_WS_MAX_MESSAGE_CHARS) { close("invalid_speech_request"); return; }
    let message: SegmentMessage;
    try {
      message = JSON.parse(data.toString());
      if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("invalid");
    } catch { close("invalid_speech_request"); return; }
    queue = queue.then(() => accept(message)).catch(error => { captureTtsRelayFailure(error); close("speech_generation_failed", 1011); }).finally(() => { queued--; });
  });
}
