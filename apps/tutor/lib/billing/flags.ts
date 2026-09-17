const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

/**
 * Autumn is on in production unless AUTUMN_ENABLED=0.
 * Local/dev stays off unless AUTUMN_ENABLED=1, so lecture-lab and mock
 * teaching keep working. Fuses stay on either way.
 */
export function isAutumnEnabled(
  env: NodeJS.ProcessEnv = process.env,
  nodeEnv = env.NODE_ENV,
): boolean {
  const raw = env.AUTUMN_ENABLED?.trim().toLowerCase();
  if (raw && FALSY.has(raw)) return false;
  if (raw && TRUTHY.has(raw)) return true;
  return nodeEnv === "production";
}

export function isProviderMockMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.FIREWORKS_API_KEY?.trim();
}

export function isTtsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ELEVENLABS_API_KEY?.trim());
}

export const LECTURE_LAB_HEADER = "x-heytutor-lecture-lab";

export function isLectureLabRequest(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isAutumnEnabled(env)) return false;
  return request.headers.get(LECTURE_LAB_HEADER)?.trim() === "1";
}
