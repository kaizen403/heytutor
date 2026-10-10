import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { LabSpendCap, parseOptions } from '../lecture-lab/run';
import { liveDiagramStrategyDecision } from '../../features/tutor-session/lib/scene/diagramStrategy';
import { labStrategyDecision, pickProductionLabExamples } from '../lecture-lab/productionLabProfile';
import { createFallbackTurnPlanV3 } from '@heytutor/tutor-core';
import { runLecture } from '../lecture-lab/lecturePipeline';
import { filterDiagramExemplarsForEvaluation, type DiagramExemplar } from '../lecture-lab/diagramExamples';

async function main() {
if (process.env.HEYTUTOR_VERIFY_FOREIGN_ORIGIN_CHILD === '1') {
  const question = 'Explain a triangle';
  const plan = createFallbackTurnPlanV3(question); plan.visualRequirement = 'required';
  let dispatchedUrl: string | null = null;
  await pickProductionLabExamples([], { origin: 'http://127.0.0.1:3000', question, plan,
    fetchImpl: async (input) => {
      dispatchedUrl = String(input);
      return Response.json({ choices: [{ message: { content: '{"ids":[]}' } }] });
    } });
  assert.equal(dispatchedUrl, 'http://127.0.0.1:3000/api/chat',
    'an absolute public API origin must not bypass the configured lab chat accounting boundary');
  for (const maxUsd of [0.5, 2]) {
    const cap = new LabSpendCap(maxUsd);
    let upstreamCalls = 0;
    const result = await pickProductionLabExamples([], { origin: 'http://127.0.0.1:3000', question, plan,
      traceId: 'synthetic-capped-picker', fetchImpl: async (input, init) => {
        // The runner accounts exactly this URL and trace header, not a foreign origin.
        const metered = String(input) === 'http://127.0.0.1:3000/api/chat' &&
          new Headers(init?.headers).get('x-heytutor-trace-id') === 'synthetic-capped-picker';
        if (metered && !cap.reserveCall(1)) throw new Error('mock cap denied before dispatch');
        upstreamCalls += 1;
        if (metered) cap.settleCall(1, 0.25);
        return Response.json({ choices: [{ message: { content: '{"ids":[]}' } }],
          usage: { prompt_tokens: 100, completion_tokens: 20 } });
      } });
    assert.equal(upstreamCalls, maxUsd < 1 ? 0 : 1, 'same-origin picker dispatch must cross hard-cap admission');
    assert.equal(cap.summary(0, 0).chargedUsd, maxUsd < 1 ? 0 : 0.25);
    assert.equal(cap.summary(0, 0).reservedUsd, 0);
    assert.equal(result.record.estimatedCostUsd, 0, 'proxy usage belongs to planner accounting, not a second picker charge');
    assert.equal(result.record.status, maxUsd < 1 ? 'failed' : 'none');
  }
  return;
}
// Public origins are captured at module load; use a fresh mocked process.
execFileSync(process.execPath, ['--import', 'tsx', resolve(process.cwd(), 'scripts/verify/verify-lab-production-profile.ts')], {
  env: { ...process.env, NEXT_PUBLIC_API_ORIGIN: 'https://foreign.invalid', HEYTUTOR_VERIFY_FOREIGN_ORIGIN_CHILD: '1' },
  stdio: 'pipe',
});
const args = ['--eval', 'sample.jsonl', '--arm', 'planner_examples_strict', '--production-strict-subjects', 'maths', '--max-usd', '30'];
assert.deepEqual(parseOptions(args).productionStrictSubjects, ['maths']);
assert.equal(parseOptions(['--eval', 'sample.jsonl', '--max-usd', '30']).productionStrictSubjects, null);
assert.throws(() => parseOptions([...args, '--production-strict-subjects', 'physics']), /maths/);
assert.throws(() => parseOptions([...args, '--arm', 'current']), /strict maths evaluation/);
assert.throws(() => parseOptions(['--production-strict-subjects', 'maths', '--max-usd', '30']), /strict maths evaluation/);
const context = { chemistryLane: false, codeLesson: false, dsa: false, doubt: false };
for (const subject of ['maths', 'physics', 'other'] as const) for (const exempt of [false, true]) {
  const actual = labStrategyDecision('planner_examples_strict', { ...context, chemistryLane: exempt }, ['maths'], subject);
  const expected = liveDiagramStrategyDecision({ ...context, chemistryLane: exempt, assignedStrategy: 'current', strictSubjects: ['maths'], subject });
  assert.deepEqual(actual, expected);
}
for (const exemption of ['codeLesson', 'dsa', 'doubt'] as const) {
  assert.equal(labStrategyDecision('planner_examples_strict', { ...context, [exemption]: true }, ['maths'], 'maths').strategy,
    'current', `the production ${exemption} exemption survives the lab adapter`);
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
const permitted: DiagramExemplar = { id: 'permitted', sourceKind: 'synthesized', question: null,
  depicts: 'A generic triangle', figureKind: 'geometry', family: null, archetype: null, document: {} };
const excluded: DiagramExemplar = { ...permitted, id: 'excluded', sourceKind: 'curated', question: plan.question };
const filtered = filterDiagramExemplarsForEvaluation([permitted, excluded], [plan.question]);
const admitted = await pickProductionLabExamples(filtered, { origin: 'http://127.0.0.1:3000', question: plan.question, plan,
  fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"ids":["excluded","unknown","permitted"]}' } }] }) });
assert.deepEqual(admitted.examples, [permitted]);
assert.deepEqual(admitted.record.ids, ['permitted'], 'only IDs in the full-sample leak-filtered library can be injected');
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
