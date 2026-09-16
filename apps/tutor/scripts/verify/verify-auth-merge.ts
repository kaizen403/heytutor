import { decideAgeGate } from "../../lib/auth/ageGate";
import { isAuthDisabled } from "../../lib/authDisabled";
import { shouldAttemptCookieMerge } from "../../lib/auth/mergeAnonymousUser";
import { isAuthPublicPath, isEmbedDemoRequest, loginRedirectPath, safeNextPath } from "../../lib/auth/publicPaths";
import { isAllowedLoginEmail, isStudentEmail } from "../../lib/auth/studentEmail";
import { isStaffEmail, staffEmailsFromEnv } from "../../lib/auth/staff";
import { hasAuthSessionCookie } from "../../lib/auth/sessionCookie";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(shouldAttemptCookieMerge("anon-1", "user-2"), "different ids must merge");
assert(!shouldAttemptCookieMerge("same", "same"), "same id must not merge");
assert(!shouldAttemptCookieMerge(null, "user-2"), "missing cookie must not merge");

const under13 = decideAgeGate({ ageBand: "under_13" });
assert(!under13.ok && under13.reason === "under_13", "under 13 must refuse");

const adult = decideAgeGate({ ageBand: "18_plus" });
assert(adult.ok && adult.band === "18_plus", "18+ continues");

const teenMissing = decideAgeGate({ ageBand: "13_17" });
assert(!teenMissing.ok && teenMissing.reason === "guardian_required", "13–17 needs guardian email");

const teenOk = decideAgeGate({ ageBand: "13_17", guardianEmail: "parent@example.com" });
assert(teenOk.ok && teenOk.band === "13_17" && teenOk.guardianEmail === "parent@example.com", "valid guardian email continues");

assert(isAuthDisabled(), "login gate stays off until AUTH_REQUIRED=1");

assert(isAuthPublicPath("/login"), "login is public");
assert(isAuthPublicPath("/api/auth/callback/google"), "auth callbacks are public");
assert(isAuthPublicPath("/fonts/stack-sans-notch.woff2"), "webfonts stay public");
assert(!isAuthPublicPath("/settings"), "settings is not public");
assert(isEmbedDemoRequest("/", "?embed=1"), "home embed is the demo exception");
assert(isEmbedDemoRequest("/c/abc", "?embed=1&replay=1"), "board embed is the demo exception");
assert(!isEmbedDemoRequest("/", ""), "plain home is not a demo");
assert(!isEmbedDemoRequest("/settings", "?embed=1"), "settings cannot hide behind embed");

assert(loginRedirectPath("/library", "") === "/login?next=%2Flibrary", "login keeps next");
assert(safeNextPath("/settings") === "/settings", "in-app next is kept");
assert(safeNextPath("https://evil.example") === "/", "absolute next is rejected");
assert(safeNextPath("//evil.example") === "/", "protocol-relative next is rejected");

assert(staffEmailsFromEnv("Ada@Accelute.co, bob@x.com").includes("ada@accelute.co"), "staff list is case-insensitive");
assert(isStaffEmail("ada@accelute.co", ["ada@accelute.co"]), "allowlisted staff passes");
assert(!isStaffEmail("student@school.edu", ["ada@accelute.co"]), "students are not staff");

assert(isStudentEmail("ada@mit.edu"), "bare .edu is a student");
assert(isStudentEmail("ada@student.ox.ac.uk"), ".ac.uk is a student");
assert(isStudentEmail("ada@iitb.ac.in"), ".ac.in is a student");
assert(isStudentEmail("ada@uni.edu.au"), ".edu.au is a student");
assert(!isStudentEmail("ada@gmail.com"), "gmail is not a student");
assert(!isStudentEmail("ada@education.com"), "education.com is not .edu");
assert(!isStudentEmail("ada@mac.com"), "mac.com is not .ac");
assert(!isStudentEmail("not-an-email"), "junk is not a student");
assert(isAllowedLoginEmail("ada@accelute.co", ["ada@accelute.co"]), "staff bypass the school-email rule");
assert(!isAllowedLoginEmail("ada@gmail.com", ["ada@accelute.co"]), "non-staff gmail is refused");
assert(
  hasAuthSessionCookie({ cookies: { get: (name) => (name === "authjs.session-token" ? { value: "x" } : undefined) } }),
  "authjs session cookie counts as signed in",
);
assert(
  !hasAuthSessionCookie({ cookies: { get: () => undefined } }),
  "no session cookie is logged out",
);

console.log("✓ auth merge, age gate, public paths, staff allowlist, and student emails");
