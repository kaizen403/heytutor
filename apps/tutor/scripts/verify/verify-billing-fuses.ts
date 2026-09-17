import {
  questionsRemainingThisHour,
  recordNewQuestion,
  resetBillingFusesForTests,
} from "../../lib/billing/fuses";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

resetBillingFusesForTests();
const user = "user-fuses";
assert(recordNewQuestion(user).ok, "first question in the hour is allowed");
assert(recordNewQuestion(user).ok, "second question in the hour is allowed");
assert(recordNewQuestion(user).ok, "third question in the hour is allowed");
assert(!recordNewQuestion(user).ok, "fourth question in the hour is blocked");
assert(questionsRemainingThisHour(user) === 0, "hourly remaining hits zero");

resetBillingFusesForTests();
console.log("✓ local hourly question fuse");
