import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";
import { resetIpRateLimitsForTests } from "../../lib/http/ipRateLimit";

const origin = "https://app.accelute.co";
const headers = { "x-forwarded-for": "203.0.113.8", origin };

async function request(path: string, method = "GET") {
  return middleware(new NextRequest(`${origin}${path}`, { method, headers }));
}

async function main() {
  resetIpRateLimitsForTests();
  // Session polling and CSRF requests must never lock a shared school IP out
  // of the next Google sign-in or its callback.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    for (const path of ["/api/auth", "/api/auth/providers", "/api/auth/session", "/api/auth/csrf", "/api/auth/callback/google"]) {
      assert.equal((await request(path)).status, 200, `${path} stays available after repeated auth requests`);
    }
    assert.equal((await request("/api/auth/signin/google", "POST")).status, 200);
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    assert.equal((await request("/api/account/me")).status, 200);
  }
  const limited = await request("/api/account/me");
  assert.equal(limited.status, 429, "account requests retain their IP cap");
  assert(Number(limited.headers.get("retry-after")) > 0);
  assert.equal((await request("/api/auth/signin/google", "POST")).status, 200,
    "an exhausted account budget cannot block sign-in");

  const crossOrigin = await middleware(new NextRequest(`${origin}/api/account/me`, {
    method: "POST", headers: { ...headers, origin: "https://evil.test" },
  }));
  assert.equal(crossOrigin.status, 403, "account mutations retain their origin check");
  assert.equal((await request("/settings")).status, 307, "protected pages still require a session");
  resetIpRateLimitsForTests();
  console.log("Auth requests stay unlimited; account limits, origin checks and the login gate remain active");
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
