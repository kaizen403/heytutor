import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readCircuitLiterals, readStatedCircuitProblemSource } from "../../src/ir/statedCircuitAuthority";
import { bindStatedCircuitProblem } from "../../src/ir/statedCircuitProblemBinding";
import { compileSceneDocument } from "../../src/compile/compiler";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
import type { ProblemIR } from "../../src/ir/problemIR";

function fullSource(question: string): ProblemIR {
  const problem: ProblemIR = { schemaVersion: "problem-ir/v1", id: "cardinality", question, facts: [], entities: [], expressions: [], constraints: [], representationIntents: [], solveRequests: [] };
  for (const [i, literal] of readCircuitLiterals(question).entries()) {
    const noun = literal.dimension === "resistance" ? "resistor" : "cell";
    const text = question.slice(literal.start, literal.end), quote = `${text} ${noun}`;
    problem.facts.push({ id: `f${i}`, kind: "given", statement: noun === "cell" ? `The cell provides ${text}.` : `The resistor has resistance ${text}.`, evidence: { source: "question", quote, start: literal.start, end: literal.start + quote.length } });
    problem.entities.push({ id: `e${i}`, kind: "component", label: quote, evidenceFactIds: [`f${i}`] });
    problem.expressions.push({ id: `x${i}`, valueType: "scalar", root: { kind: "number", value: literal.value }, evidenceFactIds: [`f${i}`] });
  }
  const start = question.indexOf("Find");
  problem.facts.push({ id: "ask", kind: "requested", statement: question.slice(start), evidence: { source: "question", quote: question.slice(start), start, end: question.length } });
  problem.representationIntents.push({ id: "network", kind: "network", entityIds: problem.entities.map(row => row.id), evidenceFactIds: problem.facts.map(row => row.id) });
  return problem;
}
let checks = 0;
for (const question of [
  "A 8 ohm resistor and three 7 ohm resistors are connected in series across a 30 V cell. Find the total current.",
  "A 8 ohm resistor and two 7 ohm resistors are connected in parallel across a 30 V cell. Find the total current.",
  "A series combination of two resistors of 8 ohm, 7 ohm and 5 ohm resistors across a 40 V cell. Find the total current.",
  "A series combination of three resistors of 8 ohm resistor and 7 ohm resistor across a 30 V cell. Find the total current.",
  "A series combination of two resistors of 8 ohm resistor and three 7 ohm resistors across a 30 V cell. Find the total current.",
]) {
  const problem = fullSource(question), snapshot = structuredClone(problem);
  assert.equal(readStatedCircuitProblemSource(question), null);
  assert.equal(bindStatedCircuitProblem(question, problem), null);
  assert.deepEqual(problem, snapshot);
  checks++;
}
for (const [question, resistance, current] of [
  ["A series combination of two resistors of 8 ohm resistor and 7 ohm resistor across a 30 V cell. Find the total current.", "15", "2"],
  ["A parallel combination of two resistors of 6 ohm resistor and 9 ohm resistor across an 18 V cell. Find the total current.", "18/5", "5"],
  ["A series combination of three resistors of 8 ohm resistor, 7 ohm resistor and 5 ohm resistor across a 40 V cell. Find the total current.", "20", "2"],
  ["A 8 ohm resistor and a 7 ohm resistor are connected in series across a 30 V cell. Find the total current.", "15", "2"],
] as const) {
  const problem = fullSource(question), snapshot = structuredClone(problem), binding = bindStatedCircuitProblem(question, problem);
  assert.ok(binding, question);
  assert.equal(binding.problem, problem);
  assert.equal(binding.solution.equivalentResistance.exact, resistance);
  assert.equal(binding.solution.sourceCurrent?.exact, current);
  assert.equal(compileSceneDocument(binding.document).ok, true);
  assert.equal(checkVisualObligations(deriveVisualObligations(problem), binding.document, problem).satisfied, true);
  assert.deepEqual(problem, snapshot);
  checks++;
}
for (const name of ["w1-ohm-meters-normalized-problem-ir", "w1-ohm-tree-normalized-problem-ir"]) {
  const problem: ProblemIR = JSON.parse(readFileSync(new URL(`./fixtures/w2-ohm/${name}.json`, import.meta.url), "utf8"));
  assert.ok(bindStatedCircuitProblem(problem.question, problem)); checks++;
}
console.log(`PASS ${checks} typed circuit cardinality controls; no student acceptance`);
