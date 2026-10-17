import assert from "node:assert/strict";
import { rejectTurnSave } from "../../lib/boards/turnSaveRejection";

const logs: unknown[][] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => { logs.push(args); };
try {
  for (const [message, expected] of [
    ["seq must be a positive integer", "sequence_invalid"],
    ["invalid visualStatus", "visual_status_invalid"],
    ["appended segment order indexes must continue from baseCount", "segment_order_invalid"],
    ["question and rawResponse are required to create a checkpoint", "creation_fields_missing"],
    ["PRIVATE_FIXTURE_QUESTION secret@example.invalid", "unclassified"],
    ["__proto__", "unclassified"],
  ] as const) {
    const response = rejectTurnSave("turn_fields_invalid", message, 400);
    assert.equal(response.status, 400);
    const diagnostic = logs.at(-1)![1] as Record<string, unknown>;
    assert.equal(diagnostic.reason, expected);
    assert.equal(diagnostic.code, "turn_fields_invalid", "existing client contract stays stable");
  }
  rejectTurnSave("storage_admission_rejected", "account storage quota exceeded", 413);
  assert.equal((logs.at(-1)![1] as Record<string, unknown>).reason, "account_storage_quota");
  rejectTurnSave("storage_admission_rejected", "PRIVATE_FIXTURE_QUOTA payload", 413);
  assert.equal((logs.at(-1)![1] as Record<string, unknown>).reason, "unclassified");
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_FIXTURE|secret@example|__proto__/);
} finally {
  console.warn = originalWarn;
}
console.log("PASS: save rejection logs classify fixed invariants without logging submitted messages");
