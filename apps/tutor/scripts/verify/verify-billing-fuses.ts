import { MAX_NEW_QUESTIONS_PER_HOUR } from "../../lib/billing/catalog";
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
for (let index = 0; index < MAX_NEW_QUESTIONS_PER_HOUR; index += 1) {
  assert(recordNewQuestion(user).ok, `question ${index + 1} in the hour is allowed`);
}
assert(!recordNewQuestion(user).ok, "the next question in the hour is blocked");
assert(questionsRemainingThisHour(user) === 0, "hourly remaining hits zero");

resetBillingFusesForTests();
console.log("✓ local hourly question fuse");
