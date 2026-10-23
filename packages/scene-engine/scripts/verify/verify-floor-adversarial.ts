/**
 * Adversarial floor set: every case must draw or decline as stated, a drawn
 * figure must carry its required stated values and never a forbidden (solved,
 * misplaced or invented) text, and the set must stay at least 40 cases with
 * the review's counter-examples included. Synthetic questions only.
 */
import assert from "node:assert/strict";
import { buildFloorFigure } from "../../src/index";
import { FLOOR_ADVERSARIAL_CASES } from "./fixtures/floorAdversarial";

let checks = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks += 1; };
check(FLOOR_ADVERSARIAL_CASES.length >= 40, `the adversarial set holds at least 40 cases (${FLOOR_ADVERSARIAL_CASES.length})`);
check(new Set(FLOOR_ADVERSARIAL_CASES.map((item) => item.id)).size === FLOOR_ADVERSARIAL_CASES.length, "case ids are unique");
const outcomes: string[] = [];
for (const item of FLOOR_ADVERSARIAL_CASES) {
  const result = buildFloorFigure({ question: item.question, turnPlan: item.turnPlan, problemIR: item.problemIR });
  const drawn = result.figure !== null;
  outcomes.push(`${item.id}: ${drawn ? `draws ${result.figure!.kind}` : "declines"} (${result.attempts.map((attempt) => `${attempt.kind} ${attempt.outcome}: ${attempt.reason}`).join("; ") || "no kind"})`);
  check(drawn === (item.expect === "draw"), `${item.id} must ${item.expect}: ${outcomes.at(-1)}`);
  if (!drawn) continue;
  const texts = result.figure!.renderScene.primitives.flatMap((primitive) =>
    (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text ? [primitive.text.replace(/\s+/g, " ").trim()] : []);
  for (const shown of item.shows ?? []) check(texts.some((text) => text.includes(shown)), `${item.id} shows ${shown}: ${JSON.stringify(texts)}`);
  for (const banned of item.never ?? []) {
    check(!texts.some((text) => banned.length >= 3 ? text.includes(banned) : text === banned), `${item.id} never shows ${banned}: ${JSON.stringify(texts)}`);
  }
  check(!result.figure!.renderScene.primitives.some((primitive) => primitive.kind === "vector" || primitive.kind === "ray"), `${item.id} draws no arrow`);
}
if (process.argv.includes("--list")) console.log(outcomes.join("\n"));
const draws = FLOOR_ADVERSARIAL_CASES.filter((item) => item.expect === "draw").length;
console.log(`verify-floor-adversarial: ${checks} checks passed (${FLOOR_ADVERSARIAL_CASES.length} cases, ${draws} draw, ${FLOOR_ADVERSARIAL_CASES.length - draws} decline)`);
