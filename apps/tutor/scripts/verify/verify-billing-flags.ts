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
  isAutumnEnabled(
    env({ AUTUMN_ENABLED: "1", AUTUMN_SECRET_KEY: "am_sk_test", NODE_ENV: "development" }),
    "development",
  ),
  "AUTUMN_ENABLED=1 turns Autumn on locally when the secret is set",
);
assert(
  !isAutumnEnabled(env({ AUTUMN_ENABLED: "1", NODE_ENV: "development" }), "development"),
  "AUTUMN_ENABLED=1 without AUTUMN_SECRET_KEY must not fail-close teaching",
);
assert(
  !isAutumnEnabled(
    env({ AUTUMN_ENABLED: "0", AUTUMN_SECRET_KEY: "am_sk_test", NODE_ENV: "production" }),
    "production",
  ),
  "AUTUMN_ENABLED=0 is the kill switch even in production",
);
assert(
  !isAutumnEnabled(env({ NODE_ENV: "production" }), "production"),
  "production without AUTUMN_SECRET_KEY uses the local ledger instead of 503ing every lesson",
);
assert(
  isAutumnEnabled(env({ AUTUMN_SECRET_KEY: "am_sk_test", NODE_ENV: "production" }), "production"),
  "production enables Autumn when the secret is set and the flag is unset",
);
assert(
  !isAutumnEnabled(env({ NODE_ENV: "development" }), "development"),
  "dev stays off unless the flag is set",
);
assert(isProviderMockMode(env({})), "missing FIREWORKS_API_KEY is mock mode");
assert(!isProviderMockMode(env({ FIREWORKS_API_KEY: "fw" })), "a Fireworks key is live");

const labBare = new Request("http://localhost/api/chat", { headers: { [LECTURE_LAB_HEADER]: "1" } });
assert(
  !isLectureLabRequest(labBare, env({ AUTUMN_ENABLED: "0", NODE_ENV: "development" })),
  "lecture-lab header 1 without LECTURE_LAB_TOKEN never bypasses",
);
assert(
  !isLectureLabRequest(labBare, env({ NODE_ENV: "production" })),
  "production must not honor the lecture-lab header without a token",
);
const labToken = new Request("http://localhost/api/chat", {
  headers: { [LECTURE_LAB_HEADER]: "lab-secret" },
});
assert(
  isLectureLabRequest(labToken, env({ LECTURE_LAB_TOKEN: "lab-secret", NODE_ENV: "production" })),
  "a matching LECTURE_LAB_TOKEN opens the lab gate even in production",
);
assert(
  !isLectureLabRequest(labToken, env({ LECTURE_LAB_TOKEN: "other-secret", NODE_ENV: "production" })),
  "a mismatched lecture-lab token is rejected",
);
assert(
  !isLectureLabRequest(
    new Request("http://localhost/api/chat"),
    env({ LECTURE_LAB_TOKEN: "lab-secret", NODE_ENV: "development" }),
  ),
  "a missing lecture-lab header is rejected even when the token is set",
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

console.log("✓ Autumn enablement, mock mode, and token-gated lecture-lab bypass");
