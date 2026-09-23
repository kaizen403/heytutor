import { ttsConfig } from "../tts/providerConfig";
import { timingSafeEqualText } from "@/lib/crypto/timingSafeEqualText";

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

function autumnSecret(env: NodeJS.ProcessEnv): string | undefined {
  return env.AUTUMN_SECRET_KEY?.trim() || undefined;
}

/**
 * Autumn checkout is on in production unless AUTUMN_ENABLED=0.
 * Local/dev stays off unless AUTUMN_ENABLED=1.
 *
 * A missing AUTUMN_SECRET_KEY cannot fail-close teaching: the USD ledger
 * still meters spend. Checkout/portal stay unavailable until the key is set.
 */
export function isAutumnEnabled(
  env: NodeJS.ProcessEnv = process.env,
  nodeEnv = env.NODE_ENV,
): boolean {
  if (!autumnSecret(env)) return false;
  const raw = env.AUTUMN_ENABLED?.trim().toLowerCase();
  if (raw && FALSY.has(raw)) return false;
  if (raw && TRUTHY.has(raw)) return true;
  return nodeEnv === "production";
}

export function isProviderMockMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.FIREWORKS_API_KEY?.trim();
}

export function isTtsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = ttsConfig("en-IN", false, env);
  return Boolean(config.apiKey && config.voiceId);
}

export const LECTURE_LAB_HEADER = "x-heytutor-lecture-lab";

/**
 * Lecture-lab spend bypass. The header value must match LECTURE_LAB_TOKEN
 * (timing-safe). A missing token never opens the gate — including when
 * Autumn is off and including NODE_ENV=production.
 */
export function isLectureLabRequest(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.LECTURE_LAB_TOKEN?.trim() ?? "";
  const presented = request.headers.get(LECTURE_LAB_HEADER)?.trim() ?? "";
  if (!expected || !presented) return false;
  return timingSafeEqualText(presented, expected);
}
