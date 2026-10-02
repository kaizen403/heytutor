import assert from "node:assert/strict";
import { test } from "node:test";
import { safeNextPath } from "../../lib/auth/publicPaths";

const origin = "https://app.accelute.co";

test("a slash-backslash login destination cannot navigate to another origin", () => {
  const result = safeNextPath("/\\phishing.invalid/login");
  assert.equal(new URL(result, origin).origin, origin);
  assert.equal(result, "/");
});

test("backslashes and URL parser control characters cannot bypass the login destination guard", () => {
  for (const value of ["/\\\\phishing.invalid", "/\t/phishing.invalid", "/\r/phishing.invalid", "/\n/phishing.invalid"]) {
    const result = safeNextPath(value);
    assert.equal(new URL(result, origin).origin, origin, value);
    assert.equal(result, "/", value);
  }
});

test("canonical destination restrictions also apply after resolving path segments", () => {
  for (const value of ["/library/../api/account", "/library/../login", "/%2e%2e/api/account"]) {
    assert.equal(safeNextPath(value), "/", value);
  }
});

test("valid in-app paths retain their query and fragment", () => {
  assert.equal(safeNextPath("/c/board-1?replay=1#chapter-2"), "/c/board-1?replay=1#chapter-2");
  assert.equal(safeNextPath("/library"), "/library");
});

test("absolute URLs, protocol-relative URLs, and non-string destinations fall back", () => {
  for (const value of ["https://phishing.invalid", "//phishing.invalid", "javascript:alert(1)", null, 42]) {
    assert.equal(safeNextPath(value), "/");
  }
});
