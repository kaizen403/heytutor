import assert from 'node:assert/strict';
import { parseOptions } from '../lecture-lab/run';
import { liveDiagramStrategyDecision } from '../../features/tutor-session/lib/scene/diagramStrategy';
import { labStrategyDecision, pickProductionLabExamples } from '../lecture-lab/productionLabProfile';
import { createFallbackTurnPlanV3 } from '@heytutor/tutor-core';
import { runLecture } from '../lecture-lab/lecturePipeline';

async function main() {
const args = ['--eval', 'sample.jsonl', '--arm', 'planner_examples_strict', '--production-strict-subjects', 'maths', '--max-usd', '30'];
assert.deepEqual(parseOptions(args).productionStrictSubjects, ['maths']);
assert.equal(parseOptions(['--eval', 'sample.jsonl', '--max-usd', '30']).productionStrictSubjects, null);
assert.throws(() => parseOptions([...args, '--production-strict-subjects', 'physics']), /maths/);
const context = { chemistryLane: false, codeLesson: false, dsa: false, doubt: false };
for (const subject of ['maths', 'physics', 'other'] as const) for (const exempt of [false, true]) {
  const actual = labStrategyDecision('planner_examples_strict', { ...context, chemistryLane: exempt }, ['maths'], subject);
  const expected = liveDiagramStrategyDecision({ ...context, chemistryLane: exempt, assignedStrategy: 'current', strictSubjects: ['maths'], subject });
  assert.deepEqual(actual, expected);
}
assert.equal(labStrategyDecision('planner_examples_strict', context, null, 'other').strategy, 'strict');
let calls = 0;
const plan = createFallbackTurnPlanV3('Explain a triangle'); plan.visualRequirement = 'required';
const picked = await pickProductionLabExamples([], { origin: 'http://127.0.0.1:3000', question: 'Explain a triangle', plan,
  traceId: 'synthetic-profile', fetchImpl: async (input, init) => {
    calls += 1;
    assert.equal(String(input), 'http://127.0.0.1:3000/api/chat');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('x-diagram-example-picker'), '1');
    assert.equal(headers.get('x-planner-deadline-ms'), '4000');
    assert.equal(headers.get('x-heytutor-trace-id'), 'synthetic-profile');
    return Response.json({ choices: [{ message: {content: '{"ids":["unknown"]}'} }] });
  } });
assert.equal(calls, 1);
assert.deepEqual(picked.examples, []); // Unknown/leak-filtered IDs are never injected.
assert.deepEqual(picked.record.ids, []);
assert.equal(picked.record.method, 'model');
// Exercise the real pipeline: the corpus label cannot replace planner subject
// consensus, and missing Jev evidence cannot manufacture a visual requirement.
const nativeFetch = globalThis.fetch;
try {
  for (const subject of ['maths', 'physics', 'other'] as const) {
    const question = 'Explain the meaning of a variable.';
    const syntheticPlan = { ...createFallbackTurnPlanV3(question), visualRequirement: 'none', subject };
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify(syntheticPlan) } }] });
    const result = await runLecture(question, { origin: 'http://synthetic', cookie: '', figureOnly: true,
      arm: 'planner_examples_strict', subject: 'maths', productionStrictSubjects: ['maths'],
      scenePlannerDeadlineMs: 1000, visualNeedReplay: { decision: null, source: 'unavailable',
        unavailableReason: 'missing_gateway_key', usage: null, provenance: null } });
    assert.deepEqual(result.productionStrategy, { classifiedSubject: subject, strategy: subject === 'maths' ? 'strict' : 'current' });
    assert.equal(result.visualNeed?.mergedRequirement, 'none');
    assert.equal(result.examplePicker, undefined);
    assert.equal(result.diagram.committed, false);
  }
} finally { globalThis.fetch = nativeFetch; }
console.log('production lab profile: live subject policy, no label forcing, 4s live picker and leak-safe IDs PASS');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
