import assert from "node:assert/strict";
import { planTurnV3, TURN_PLAN_V3_PROMPT } from "../../src/planners/turnPlannerV3";
import { parseDiagramSubject, parseDiagramStrictSubjects, subjectFromTurnPlanContent } from "../../src/planners/diagramSubject";

assert.equal(parseDiagramSubject("maths"), "maths");
for (const value of [null, undefined, "math", "Maths", "code", "other", {}]) assert.equal(parseDiagramSubject(value), "other");
assert.deepEqual(parseDiagramStrictSubjects("maths,physics maths invalid"), ["maths", "physics"]);
assert.deepEqual(parseDiagramStrictSubjects(undefined), []);
assert.equal(subjectFromTurnPlanContent("bad json"), "other");

const originalFetch = globalThis.fetch;
const prompts: string[] = [];
let subject = "maths";
try {
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    prompts.push(body.messages[0].content);
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      schemaVersion: "turn-plan/v3", question: "Explain set union", subject,
      givens: [], unknowns: [], derived: [], qualitativeClaims: [],
      lawIds: [], assumptions: [], visualRequirement: "optional",
    }) } }] });
  };
  const off = await planTurnV3("Explain set union", { proxyUrl: "http://subject.test", timeoutMs: 1000 });
  assert.ok(off);
  assert.equal(off.subject, undefined, "off ignores unsolicited subject metadata");
  assert.equal(prompts[0], TURN_PLAN_V3_PROMPT, "off preserves exact main prompt");
  const before = prompts.length;
  const on = await planTurnV3("Explain set union", { proxyUrl: "http://subject.test", timeoutMs: 1000, classifySubject: true });
  assert.equal(on?.subject, "maths");
  assert.equal(prompts.length - before, 2, "scope adds no classifier request");
  assert.match(prompts[before]!, /Classify the question's subject/);
  subject = "invalid";
  const unknown = await planTurnV3("Explain set union", { proxyUrl: "http://subject.test", timeoutMs: 1000, classifySubject: true });
  assert.equal(unknown?.subject, "other", "invalid subject fails closed");
  let calls = 0;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({
    schemaVersion: "turn-plan/v3", question: "Explain set union", subject: calls++ === 0 ? "maths" : "physics",
    givens: [], unknowns: [], derived: [], qualitativeClaims: [],
    lawIds: [], assumptions: [], visualRequirement: "optional",
  }) } }] });
  const ambiguous = await planTurnV3("Explain set union", { proxyUrl: "http://subject.test", timeoutMs: 1000, classifySubject: true });
  assert.equal(ambiguous?.subject, "other", "disagreeing peer subjects fail closed");
} finally {
  globalThis.fetch = originalFetch;
}
console.log("diagram subject verification passed (mocked, zero model calls)");
