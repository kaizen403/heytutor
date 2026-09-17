import { isAutumnEnabled, isLectureLabRequest, isProviderMockMode, LECTURE_LAB_HEADER } from "../../lib/billing/flags";
import {
  AutumnUnavailableError,
  requireAutumnReady,
  resetAutumnClientForTests,
} from "../../lib/billing/autumnClient";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

assert(
  isAutumnEnabled(env({ AUTUMN_ENABLED: "1", NODE_ENV: "development" }), "development"),
  "AUTUMN_ENABLED=1 turns Autumn on locally",
);
assert(
  !isAutumnEnabled(env({ AUTUMN_ENABLED: "0", NODE_ENV: "production" }), "production"),
  "AUTUMN_ENABLED=0 is the kill switch even in production",
);
assert(
  isAutumnEnabled(env({ NODE_ENV: "production" }), "production"),
  "production enables Autumn when the flag is unset",
);
assert(
  !isAutumnEnabled(env({ NODE_ENV: "development" }), "development"),
  "dev stays off unless the flag is set",
);
assert(isProviderMockMode(env({})), "missing FIREWORKS_API_KEY is mock mode");
assert(!isProviderMockMode(env({ FIREWORKS_API_KEY: "fw" })), "a Fireworks key is live");

const lab = new Request("http://localhost/api/chat", { headers: { [LECTURE_LAB_HEADER]: "1" } });
assert(
  isLectureLabRequest(lab, env({ AUTUMN_ENABLED: "0", NODE_ENV: "development" })),
  "lecture-lab header bypasses only when Autumn is off",
);
assert(
  !isLectureLabRequest(lab, env({ AUTUMN_ENABLED: "1", NODE_ENV: "production" })),
  "production must not honor the lecture-lab header",
);

resetAutumnClientForTests();
try {
  requireAutumnReady(env({ AUTUMN_ENABLED: "1", NODE_ENV: "production" }));
  throw new Error("missing AUTUMN_SECRET_KEY must not fail open");
} catch (error) {
  assert(
    error instanceof AutumnUnavailableError,
    "production Autumn without a secret is unavailable, not fail-open",
  );
}
resetAutumnClientForTests();

console.log("✓ Autumn enablement, mock mode, and lecture-lab bypass");
