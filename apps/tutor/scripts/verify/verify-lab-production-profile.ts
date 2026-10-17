import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { LabSpendCap, parseOptions } from '../lecture-lab/run';
import { liveDiagramStrategyDecision } from '../../features/tutor-session/lib/scene/diagramStrategy';
import { labStrategyDecision, pickProductionLabExamples, productionLabUsesExamples, productionLabExecutionIdentity, productionLabPreflightArm } from '../lecture-lab/productionLabProfile';
import { createFallbackTurnPlanV3 } from '@heytutor/tutor-core';
import { validateProblemIR, type ProblemIR } from '@heytutor/scene-engine';
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
  for (const rawOrigin of ['http://127.0.0.1:3000', 'http://127.0.0.1:3000/', 'HTTP://LOCALHOST:80/']) {
  const origin = parseOptions(['--max-usd', '2', '--origin', rawOrigin]).origin;
  for (const maxUsd of [0.5, 2]) {
    const cap = new LabSpendCap(maxUsd);
    let upstreamCalls = 0;
    const result = await pickProductionLabExamples([], { origin, question, plan,
      traceId: 'synthetic-capped-picker', fetchImpl: async (input, init) => {
        // The runner accounts exactly this URL and trace header, not a foreign origin.
        const metered = String(input) === `${origin}/api/chat` &&
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
  }
  return;
}
// Public origins are captured at module load; use a fresh mocked process.
execFileSync(process.execPath, ['--import', 'tsx', resolve(process.cwd(), 'scripts/verify/verify-lab-production-profile.ts')], {
  env: { ...process.env, NEXT_PUBLIC_API_ORIGIN: 'https://foreign.invalid', HEYTUTOR_VERIFY_FOREIGN_ORIGIN_CHILD: '1' },
  stdio: 'pipe',
});
const args = ['--eval', 'sample.jsonl', '--arm', 'planner_examples_strict', '--production-strict-subjects', 'maths', '--max-usd', '30'];
assert.equal(parseOptions([...args, '--origin', 'http://127.0.0.1:3000/']).origin, 'http://127.0.0.1:3000',
  'transport and spend accounting must share one canonical origin, including trailing slashes');
assert.equal(parseOptions([...args, '--origin', 'HTTP://LOCALHOST:80/']).origin, 'http://localhost');
for (const origin of ['invalid', 'file:///tmp/', 'https://example.invalid/path', 'https://example.invalid/?query=1',
  'https://example.invalid/#fragment', 'https://user:private@example.invalid/']) {
  assert.throws(() => parseOptions([...args, '--origin', origin]), error =>
    error instanceof Error && error.message.startsWith('--origin must be an HTTP(S) origin') &&
      !error.message.includes('private'), 'invalid origins are rejected without echoing credentials');
}
assert.deepEqual(parseOptions(args).productionStrictSubjects, ['maths']);
assert.equal(parseOptions(['--eval', 'sample.jsonl', '--max-usd', '30']).productionStrictSubjects, null);
assert.deepEqual(parseOptions([...args, '--production-strict-subjects', 'maths,physics']).productionStrictSubjects, ['maths', 'physics']);
assert.deepEqual(parseOptions([...args, '--production-strict-subjects', 'chemistry']).productionStrictSubjects, ['chemistry']);
assert.deepEqual(parseOptions([...args, '--arm', 'current']).productionStrictSubjects, ['maths'],
  'a current-labelled production profile must still apply real maths opt-in');
assert.throws(() => parseOptions([...args, '--production-strict-subjects=']), /production-strict-subjects/,
  'an explicitly empty production profile must fail rather than silently force the eval arm');
assert.throws(() => parseOptions([...args, '--production-strict-subjects']), /production-strict-subjects/);
for (const value of ['other', 'biology', ',', 'maths,', ',physics', 'maths,,physics', 'maths,maths', 'maths physics']) {
  assert.throws(() => parseOptions([...args, '--production-strict-subjects', value]), /production-strict-subjects/);
}
for (const arm of ['planner_first', 'planner_examples']) {
  assert.throws(() => parseOptions([...args, '--arm', arm]), /production-strict-subjects/);
}
assert.throws(() => parseOptions(['--production-strict-subjects', 'maths', '--max-usd', '30']), /production-strict-subjects/);
assert.equal(parseOptions(args).productionPhysicsMode, null);
assert.equal(parseOptions([...args, '--production-physics-mode', 'hybrid']).productionPhysicsMode, 'hybrid');
for (const value of ['', 'true', 'strict', 'current', 'Hybrid', 'hybrid,hybrid']) {
  assert.throws(() => parseOptions([...args, `--production-physics-mode=${value}`]), /production-physics-mode/);
}
assert.throws(() => parseOptions([...args, '--production-physics-mode']), /production-physics-mode/);
assert.throws(() => parseOptions([...args, '--production-physics-mode', 'hybrid', '--arm', 'current']), /production-physics-mode/);
assert.throws(() => parseOptions(['--eval', 'sample.jsonl', '--arm', 'planner_examples_strict', '--production-physics-mode', 'hybrid', '--max-usd', '30']), /production-physics-mode/);
assert.throws(() => parseOptions(['--production-strict-subjects', 'maths', '--production-physics-mode', 'hybrid', '--max-usd', '30']), /production-strict-subjects|production-physics-mode/);
assert.equal(productionLabUsesExamples('current', ['maths']), true,
  'every production profile loads examples because corpus physics may be classified as strict maths');
assert.equal(productionLabUsesExamples('current', null), false, 'legacy current evaluation remains unchanged');
assert.equal(productionLabUsesExamples('planner_examples_strict', ['maths']), true);
assert.equal(productionLabPreflightArm('current', ['maths']), 'planner_examples_strict',
  'a current-labelled live profile must estimate the examples path that actual maths classification can use');
assert.equal(productionLabPreflightArm('planner_examples_strict', ['maths', 'physics']), 'planner_examples_strict');
assert.equal(productionLabPreflightArm('current', null), 'current', 'legacy current preflight stays unchanged');
assert.equal(productionLabPreflightArm('planner_examples', null), 'planner_examples', 'legacy arm preflight stays unchanged');
assert.deepEqual(productionLabExecutionIdentity(null, null), {}, 'legacy execution identity stays unchanged');
assert.deepEqual(productionLabExecutionIdentity(['maths'], null), {
  productionStrictSubjects: ['maths'], productionPhysicsMode: null,
  diagramStrategyPolicyVersion: 'diagram-strategy/v2', physicsHybridPolicyVersion: 'physics-hybrid/preplanning-signals-v1',
  examplePickerProfile: 'live-client-4000ms/v1', subjectClassification: 'existing-turn-plan',
});
assert.equal(productionLabExecutionIdentity(['maths'], 'hybrid').productionPhysicsMode, 'hybrid');
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
assert.equal(picked.record.status, 'none', 'a response with only rejected IDs must not claim examples were picked');
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
  const legacyQuestion = 'Explain the meaning of a variable.';
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('x-turn-planner-version'), '3');
    const body = JSON.parse(String(init?.body));
    assert.ok(!JSON.stringify(body).includes("Classify the question's subject"),
      'legacy evaluation does not enable production subject classification');
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      ...createFallbackTurnPlanV3(legacyQuestion), visualRequirement: 'none', subject: 'physics',
    }) } }] });
  };
  const legacyResult = await runLecture(legacyQuestion, { origin: 'http://synthetic', cookie: '', figureOnly: true,
    arm: 'current', subject: 'maths', scenePlannerDeadlineMs: 1000,
    visualNeedReplay: { decision: null, source: 'unavailable', unavailableReason: 'missing_key', usage: null, provenance: null } });
  assert.equal(legacyResult.error, null);
  assert.equal(legacyResult.productionStrategy, undefined, 'unprofiled runs must not claim production strategy metadata');
  for (const subject of ['maths', 'physics', 'other'] as const) {
    const question = 'Explain the meaning of a variable.';
    const syntheticPlan = { ...createFallbackTurnPlanV3(question), visualRequirement: 'none', subject };
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify(syntheticPlan) } }] });
    const result = await runLecture(question, { origin: 'http://synthetic', cookie: '', figureOnly: true,
      arm: 'planner_examples_strict', subject: 'maths', productionStrictSubjects: ['maths'],
      scenePlannerDeadlineMs: 1000, visualNeedReplay: { decision: null, source: 'unavailable',
        unavailableReason: 'missing_gateway_key', usage: null, provenance: null } });
    assert.deepEqual(result.productionStrategy, { classifiedSubject: subject, strategy: subject === 'maths' ? 'strict' : 'current',
      physicsMode: null, strategyReason: subject === 'maths' ? 'strict_subject' : 'current', hybridSignal: null, policyVersion: null,
      pickerDecision: { classifiedSubject: subject, strategy: subject === 'maths' ? 'strict' : 'current', physicsMode: null,
        strategyReason: subject === 'maths' ? 'strict_subject' : 'current', hybridSignal: null, policyVersion: null } });
    assert.equal(result.visualNeed?.mergedRequirement, 'none');
    assert.equal(result.examplePicker, undefined);
    assert.equal(result.diagram.committed, false);
  }
  const profiles = [
    { name: 'current', arm: 'current', strictSubjects: ['maths'], physicsMode: null },
    { name: 'strict', arm: 'planner_examples_strict', strictSubjects: ['maths', 'physics'], physicsMode: null },
    { name: 'hybrid', arm: 'planner_examples_strict', strictSubjects: ['maths'], physicsMode: 'hybrid' },
  ] as const;
  for (const profile of profiles) for (const matched of [true, false]) for (const classifiedSubject of ['physics', 'maths', 'other'] as const) {
    const question = matched ? 'Explain the magnetic field of a bar magnet.' : 'Explain the electric field of an isolated positive point charge.';
    const syntheticPlan = { ...createFallbackTurnPlanV3(question), visualRequirement: 'required', subject: classifiedSubject };
    let pickerCalls = 0;
    globalThis.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get('x-diagram-example-picker') === '1') {
        pickerCalls++;
        assert.equal(headers.get('x-planner-deadline-ms'), '4000');
        return Response.json({ choices: [{ message: { content: '{"ids":["permitted"]}' } }] });
      }
      if (headers.get('x-scene-planner-version') === '2') {
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          schemaVersion: 'scene-document/v2', source: { question },
          visualDecision: { mode: 'text_only', reason: 'Synthetic valid planner decline.' },
          quantities: [], entities: [], constructions: [], relations: [], assertions: [], annotations: [],
          requiredEntityIds: [], revealGroups: [], teachingTimeline: [],
        }) } }] });
      }
      assert.equal(headers.get('x-turn-planner-version'), '3', 'all other synthetic requests must be existing turn-planner calls');
      return Response.json({ choices: [{ message: { content: JSON.stringify(syntheticPlan) } }] });
    };
    const result = await runLecture(question, { origin: 'http://synthetic', cookie: '', figureOnly: true,
      arm: profile.arm, subject: 'physics', productionStrictSubjects: profile.strictSubjects,
      productionPhysicsMode: profile.physicsMode, diagramExamples: [permitted], scenePlannerDeadlineMs: 1000,
      visualNeedReplay: { decision: null, source: 'unavailable', unavailableReason: 'missing_key', usage: null, provenance: null } });
    assert.equal(result.error, null);
    const isStrict = classifiedSubject === 'maths' || classifiedSubject === 'physics' &&
      (profile.name === 'strict' || profile.name === 'hybrid' && !matched);
    assert.equal(result.productionStrategy?.classifiedSubject, classifiedSubject, 'corpus physics must not override actual subject consensus');
    assert.equal(result.productionStrategy?.strategy, isStrict ? 'strict' : 'current', `${profile.name}/${classifiedSubject}/${matched}: live strategy`);
    assert.equal(result.productionStrategy?.physicsMode, profile.physicsMode);
    assert.equal(result.productionStrategy?.strategyReason, classifiedSubject === 'maths' || classifiedSubject === 'physics' && profile.name === 'strict'
      ? 'strict_subject' : classifiedSubject === 'physics' && profile.name === 'hybrid'
        ? matched ? 'hybrid_current_signal' : 'hybrid_strict_default' : 'current');
    assert.equal(result.productionStrategy?.hybridSignal, classifiedSubject === 'physics' && profile.name === 'hybrid' && matched ? 'archetype:bar_magnet' : null);
    assert.equal(result.productionStrategy?.policyVersion, classifiedSubject === 'physics' && profile.name === 'hybrid' ? 'physics-hybrid/preplanning-signals-v1' : null);
    assert.equal(pickerCalls, Number(isStrict), 'production profiles use the same live picker and never a direct-provider or word fallback');
    assert.deepEqual(result.examplePicker?.ids ?? [], isStrict ? ['permitted'] : []);
    assert.deepEqual(result.diagram.examplesUsed?.map(example => example.id), isStrict ? ['permitted'] : []);
    assert.equal(result.visualNeed?.origin, 'frozen_replay');
    assert.equal(result.visualNeed?.assessment.decision, null);
    if (isStrict) assert.equal(result.diagram.committed, false, 'strict cannot admit the current builder after a valid planner decline');
  }
  // The numeric-authority overlap can make a live archetype signal available
  // after the picker ran. Exercise the real ProblemIR parser/solver and final
  // gate rather than mocking either internal decision.
  const overlapQuestion = 'A cell has an emf of 12 V. Show how it supplies a load.';
  const overlapPlan = { ...createFallbackTurnPlanV3(overlapQuestion), visualRequirement: 'required', subject: 'physics' };
  const overlapProblem: ProblemIR = {
    schemaVersion: 'problem-ir/v1', id: 'sourceProblem', question: overlapQuestion,
    facts: ['cell', 'load'].map((quote, index) => ({
      id: `f${index}`, kind: 'given', statement: quote,
      evidence: { source: 'question', start: overlapQuestion.indexOf(quote),
        end: overlapQuestion.indexOf(quote) + quote.length, quote },
    })),
    entities: ['cell', 'load'].map((label, index) => ({
      id: label, kind: 'component', label, evidenceFactIds: [`f${index}`],
    })),
    expressions: [], constraints: [], solveRequests: [],
    representationIntents: [{ id: 'sourceNetwork', kind: 'network', entityIds: ['cell', 'load'], evidenceFactIds: ['f0', 'f1'] }],
  };
  assert.equal(validateProblemIR(overlapProblem, overlapQuestion).valid, true, 'overlap fixture must obey actual source evidence admission');
  let authorityCalls = 0;
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.get('x-problem-ir-version') === '1') {
      authorityCalls++;
      return Response.json({ choices: [{ message: { content: JSON.stringify(overlapProblem) } }] });
    }
    if (headers.get('x-diagram-example-picker') === '1') {
      return Response.json({ choices: [{ message: { content: '{"ids":["permitted"]}' } }] });
    }
    if (headers.get('x-scene-planner-version') === '2') {
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        schemaVersion: 'scene-document/v2', source: { question: overlapQuestion },
        visualDecision: { mode: 'text_only', reason: 'Synthetic valid planner decline.' },
        quantities: [], entities: [], constructions: [], relations: [], assertions: [], annotations: [],
        requiredEntityIds: [], revealGroups: [], teachingTimeline: [],
      }) } }] });
    }
    assert.equal(headers.get('x-turn-planner-version'), '3');
    return Response.json({ choices: [{ message: { content: JSON.stringify(overlapPlan) } }] });
  };
  const overlapResult = await runLecture(overlapQuestion, { origin: 'http://synthetic', cookie: '', figureOnly: true,
    arm: 'planner_examples_strict', subject: 'physics', productionStrictSubjects: ['maths'], productionPhysicsMode: 'hybrid',
    diagramExamples: [permitted], scenePlannerDeadlineMs: 1000,
    visualNeedReplay: { decision: null, source: 'unavailable', unavailableReason: 'missing_key', usage: null, provenance: null } });
  assert.equal(overlapResult.error, null);
  assert.ok(authorityCalls > 0, 'the fixture must reach the real numeric authority overlap');
  assert.equal(overlapResult.productionStrategy?.pickerDecision?.strategyReason, 'hybrid_strict_default');
  assert.equal(overlapResult.productionStrategy?.pickerDecision?.hybridSignal, null);
  assert.equal(overlapResult.productionStrategy?.strategyReason, 'hybrid_current_signal', 'final metadata follows the authority-enriched gate');
  assert.equal(overlapResult.productionStrategy?.hybridSignal, 'archetype:resistor_network');
  assert.deepEqual(overlapResult.diagram.examplesUsed, [], 'final current strategy does not inject examples selected by the early strict gate');
} finally { globalThis.fetch = nativeFetch; }
console.log('production lab profile: live subject policy, no label forcing, 4s live picker and leak-safe IDs PASS');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
