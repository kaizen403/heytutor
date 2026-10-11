import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLecturePipelineVm, deferred } from './lib/lecture-pipeline-vm.mjs';

// Agent-authored synthetic public fixture; no student data/private anchors.
const question = 'Draw a labelled line segment AB of length 3 cm. State its length and identify its endpoints.';
const plan = { schemaVersion: 'turn-plan/v3', question, visualRequirement: 'required',
  givens: [{ id: 'givenLength', symbol: 'l', value: 3, unit: 'cm', provenance: 'given', sourceText: '3 cm' }],
  unknowns: [{ id: 'length', symbol: 'L', unit: 'cm' }],
  derived: [{ id: 'length', symbol: 'L', value: 3, unit: 'cm', provenance: 'derived', sourceText: 'L = 3 cm' }],
  qualitativeClaims: [], lawIds: [], assumptions: [] };
const sceneDocument = {
  schemaVersion: 'scene-document/v2', source: { question },
  visualDecision: { mode: 'scene', reason: 'source-labelled segment' }, quantities: [],
  entities: [{ id: 'a', kind: 'point', role: 'endpoint', label: 'A' },
    { id: 'b', kind: 'point', role: 'endpoint', label: 'B' },
    { id: 'ab', kind: 'segment', role: 'segment', label: 'AB' }],
  constructions: [{ id: 'pa', operator: 'point', inputs: { x: 0, y: 0 }, outputs: ['a'] },
    { id: 'pb', operator: 'point', inputs: { x: 3, y: 0 }, outputs: ['b'] },
    { id: 'sab', operator: 'segment', inputs: { start: 'a', end: 'b' }, outputs: ['ab'] }],
  relations: [], assertions: [{ id: 'exists', predicate: 'exists', entities: ['ab'], expected: true, severity: 'fatal' }],
  annotations: [], requiredEntityIds: ['a', 'b', 'ab'],
  revealGroups: [{ id: 'setup', entityIds: ['a', 'b', 'ab'], dependsOn: [], narrationCue: 'Segment AB.' }],
  teachingTimeline: [{ id: 'reveal', action: 'reveal', targetId: 'setup', dependsOn: [], narrationIntent: 'Segment AB.' }],
};
const prefixResponse = JSON.stringify({ v: 1, actions: ['organize_givens', 'identify_target'] });
const answerLeak = '[STEP]The segment endpoints are A and B, and its length is three centimetres. These letters identify the two ends and directly give the requested endpoint names.[/STEP]';
const teaching = '[STEP]The endpoints are A and B, and the segment connects them. Its stated length is three centimetres.[WRITE:A and B are endpoints,80,150][FOCUS:ab][/STEP]';
const circuitQuestion = 'A 12 V battery is connected across a 4 ohm resistor. Draw the circuit and find the current.';
const circuitPlan = { ...plan, question: circuitQuestion,
  givens: [{ id: 'V', symbol: 'V', value: 12, unit: 'V', provenance: 'given', sourceText: '12 V' },
    { id: 'R', symbol: 'R', value: 4, unit: 'Ω', provenance: 'given', sourceText: '4 ohm' }],
  unknowns: [{ id: 'current', symbol: 'I', unit: 'A' }],
  derived: [{ id: 'current', symbol: 'I', value: 3, unit: 'A', provenance: 'derived', sourceText: 'I = 12 / 4 = 3 A' }],
};
const reply = text => ({ text, streamStats: { contentChars: text.length, reasoningChars: 0, ttftContentMs: 0 } });
const flush = async () => { for (let index = 0; index < 100; index++) await Promise.resolve(); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let checks = 0;
const results = [];
const mutateDropPrefixHistory = process.argv.includes('--mutate-drop-prefix-history');
const mutateDropSelectedFigure = process.argv.includes('--mutate-drop-selected-figure');
const mutateWaitForPrefix = process.argv.includes('--mutate-wait-prefix');
const mutateDropVerifiedPrompt = process.argv.includes('--mutate-drop-verified-prompt');

async function scenario(name, { enabled = true, prefixMode = 'good', sceneMode = 'valid',
  exhaustContinuations = false, figureOnly = false, blocked = false, speculationEnabled = false,
  unmarkedTeaching = false, narrationLanguage = 'english' } = {}) {
  let now = 1_000;
  const scene = deferred();
  const prefixReply = deferred();
  const authorityReply = deferred();
  const scenarioPlan = speculationEnabled ? circuitPlan : plan;
  const scenarioQuestion = scenarioPlan.question;
  const vm = createLecturePipelineVm({
    plan: scenarioPlan, sceneDocument: sceneMode === 'invalid' ? { schemaVersion: 'invalid' } : sceneDocument,
    parallelEnabled: enabled, figureOnly, speculationEnabled,
    narrationLanguage,
    mutateDropPrefixHistory, mutateDropSelectedFigure, mutateWaitForPrefix, mutateDropVerifiedPrompt,
    now: () => now, advance: ms => { now += ms; }, scene: () => scene.promise,
    authority: () => speculationEnabled ? authorityReply.promise : authorityFixture(),
    teachPrefix: () => prefixReply.promise,
    teachFull: async (_request, call, onDelta) => {
      const content = exhaustContinuations && call < 3
        ? `[STEP]The segment has endpoints and continues with ${call === 1 ? 'the first explanation' : 'a different explanation'}`
        : unmarkedTeaching ? teaching.replace('[STEP]', '').replace('[/STEP]', '') : teaching;
      now += 10;
      onDelta(content);
      now += 90;
      return reply(content);
    },
  });
  if (speculationEnabled) {
    const core = vm.load('packages/tutor-core/src/index.ts');
    const fallback = vm.load('apps/tutor/features/tutor-session/lib/scene/representationFallback.ts');
    const actual = fallback.selectVerifiedRepresentation({ question: scenarioQuestion, turnPlan: scenarioPlan,
      families: core.inferSceneCapabilities(scenarioQuestion, { turnPlan: scenarioPlan }).families });
    assert(actual?.sceneDocument && 'visualDecision' in actual.sceneDocument,
      'circuit speculative control must use an authentic compiled document'); checks++;
    // The VM input remains an object reference; freeze the authentic reply once
    // before the run, not a hand-authored unrelated line in a circuit question.
    vm.setSceneDocument(actual.sceneDocument);
  }
  async function authorityFixture() {
    const engine = vm.load('packages/scene-engine/src/index.ts');
    const problemIR = { schemaVersion: 'problem-ir/v1', id: 'segmentLength', question: scenarioQuestion,
      facts: [{ id: 'request', kind: 'requested', statement: scenarioQuestion,
        evidence: { source: 'question', start: 0, end: scenarioQuestion.length, quote: scenarioQuestion } }],
      entities: [], expressions: [{ id: 'lengthValue', valueType: 'scalar', root: { kind: 'number', value: 3 }, evidenceFactIds: ['request'] }],
      constraints: [], representationIntents: [], solveRequests: [{ id: 'evaluateLength', kind: 'evaluate', expressionId: 'lengthValue',
        resultBinding: { turnPlanQuantityId: speculationEnabled ? 'current' : 'length',
          symbol: blocked ? 'wrongSymbol' : speculationEnabled ? 'I' : 'L', unit: speculationEnabled ? 'A' : 'cm', evidenceFactIds: ['request'] } }],
    };
    const solverResult = await new engine.LocalDeterministicSolverProvider().solve(problemIR);
    const audit = engine.verifyTurnPlanAgainstSolver(problemIR, solverResult, scenarioPlan, scenarioQuestion);
    assert.equal(audit.status, blocked ? 'contradiction' : 'verified'); checks++;
    return { problemIR, solverResult, audit, projection: null, rawContent: JSON.stringify(problemIR), elapsedMs: 0 };
  }
  let completed = false;
  let completedError = null;
  const pending = vm.run().then(run => { completed = true; completedError = run.error; return run; },
    error => { completed = true; completedError = String(error?.message ?? error); return { error: completedError }; });
  await flush();
  if (speculationEnabled) { authorityReply.resolve(await authorityFixture()); await flush(); }
  if (!vm.events.some(event => event.name === 'scene-dispatched')) console.error(JSON.stringify({ name,
    completed, error: completedError?.replaceAll(scenarioQuestion, '[synthetic-question]').slice(0, 180) ?? null,
    events: vm.events.map(event => ({ name: event.name, at: event.at })),
    sourceCount: vm.stats().repositorySources.length, pipelineSHA256: vm.stats().sourceSHA256,
  }));
  assert(vm.events.some(event => event.name === 'scene-dispatched'), `${name}: actual overlap reaches scene port`); checks++;
  assert.equal(vm.events.filter(event => event.name === 'verified-presentation').length, 0); checks++;
  assert.equal(vm.events.filter(event => event.name === 'teaching-dispatched').length, 0,
    `${name}: full teaching never dispatches before verified selection`); checks++;
  now = 1_040;
  if (prefixMode === 'failure') prefixReply.reject(new Error('synthetic prefix transport failure'));
  else if (prefixMode !== 'held') prefixReply.resolve(reply(prefixMode === 'invalid'
    ? JSON.stringify({ v: 1, actions: ['identify_target'], narration: 'The endpoints are A and B.' })
    : prefixMode === 'answer-leak' ? answerLeak : prefixResponse));
  // A disabled/skipped prefix has no consumer; prevent a deliberate failure
  // mode from becoming an unhandled rejected Promise in such a fixture.
  prefixReply.promise.catch(() => {});
  await flush();
  const setup = vm.events.filter(event => event.name === 'setup-prefix-accepted');
  if (enabled && !blocked && !speculationEnabled && !figureOnly && prefixMode === 'good') {
    assert.equal(setup.length, 1); checks++;
    assert.equal(setup[0].commandCount, 0, 'accepted host setup has no ink/FOCUS'); checks++;
    assert.match(setup[0].raw, /^\[STEP\][^\[\]]+\[\/STEP\]$/); checks++;
    assert.notEqual(setup[0].raw, prefixResponse, 'action JSON is never played as narration'); checks++;
    assert(!vm.events.some(event => event.name === 'scene-selected'), 'host setup precedes delayed scene selection'); checks++;
  } else { assert.equal(setup.length, 0); checks++; }
  now = 1_100; scene.resolve();
  if (prefixMode === 'held') {
    await flush();
    assert.equal(completed, true, 'held prefix cannot delay normal verified teaching'); checks++;
    assert.equal(vm.prefixSignalAborted(), true, 'selection aborts unaccepted prefix without awaiting it'); checks++;
  }
  const run = await pending;
  if (prefixMode === 'held') {
    now += 80; prefixReply.resolve(reply(prefixResponse)); await vm.settlePrefix(); await flush();
    assert.equal(vm.events.filter(event => event.name === 'setup-prefix-accepted').length, 0,
      'late accepted-looking prefix cannot become speech after selection freezes'); checks++;
  }
  assert.equal(run.error, null, `${name}: actual pipeline completes with frozen I/O`); checks++;
  const stats = vm.stats();
  assert.equal(stats.providerAttempts, 0); checks++;
  assert(stats.teachingCalls <= 4); checks++;
  assert(stats.prefixCalls <= 1); checks++;
  assert.equal(stats.actualIntegration, true); checks++;
  assert(stats.repositorySources.every(({ file }) => !file.startsWith('.context/')), 'no ignored helper/protocol sources may enter actual pipeline'); checks++;
  if (enabled && !figureOnly) {
    assert.deepEqual(Object.keys(run.parallelTeaching).sort(), [
      'enabled', 'started', 'accepted', 'frozen', 'reason', 'prefixRequestMs', 'prefixAcceptedMs', 'rawPrefixChars',
    ].sort(), 'public prefix metadata contains no raw/narration/question text'); checks++;
    assert.equal(run.parallelTeaching.accepted, setup.length > 0); checks++;
    assert.equal(run.parallelTeaching.frozen, true); checks++;
    assert.equal(run.parallelTeaching.started, stats.prefixCalls === 1); checks++;
    assert(!JSON.stringify(run.parallelTeaching).includes(prefixResponse)); checks++;
  } else { assert.equal(run.parallelTeaching, undefined); checks++; }
  assert.equal(vm.events.filter(event => event.name === 'verified-teaching-prompt-generated').length, figureOnly ? 0 : 1); checks++;
  if (blocked || speculationEnabled || figureOnly || !enabled) { assert.equal(stats.prefixCalls, 0); checks++; }
  const selectedAt = vm.events.findIndex(event => event.name === 'scene-selected');
  const presentationAt = vm.events.findIndex(event => event.name === 'verified-presentation');
  const fullAt = vm.events.findIndex(event => event.name === 'teaching-dispatched');
  if (!figureOnly) { assert(selectedAt >= 0 && presentationAt > selectedAt && fullAt > presentationAt); checks++; }
  for (const event of vm.events.slice(0, selectedAt)) {
    assert(!event.introCommands && event.name !== 'verified-presentation', 'unverified scene is never presented'); checks++;
  }
  const fullCalls = vm.events.filter(event => event.name === 'teaching-dispatched');
  const renderedSetup = setup[0]?.raw ?? null;
  if (renderedSetup) {
    assert.deepEqual(fullCalls[0].history, [{ user: scenarioQuestion, assistant: renderedSetup }],
      'first verified teaching request retains exact original question and host-rendered STEP, not action JSON'); checks++;
    assert.equal(fullCalls[0].verifiedPromptPreserved, true); checks++;
    assert.equal(fullCalls[0].alreadyTaughtInstruction, true); checks++;
    assert.equal(fullCalls[0].verifiedFigureContextPresent, true, 'first full teaching retains exact verified scene prompt addon'); checks++;
    for (const call of fullCalls) {
      assert.equal(call.history[0].assistant.split(renderedSetup).length - 1, 1); checks++;
      assert(!call.history[0].assistant.includes(prefixResponse), 'continuation contains no request JSON'); checks++;
      assert.equal(call.verifiedPromptPreserved, true, 'every continuation retains actual generated full/continuation prompt'); checks++;
      assert.equal(call.alreadyTaughtInstruction, true); checks++;
      assert.equal(call.verifiedFigureContextPresent, true, 'every continuation retains exact verified addon'); checks++;
    }
  } else if (fullCalls.length) { assert.deepEqual(fullCalls[0].history, []); checks++; }
  if (renderedSetup) {
    assert.equal(run.teaching.rawText.split(renderedSetup).length - 1, 1,
      'complete teaching contains exact host-rendered setup STEP once'); checks++;
    assert.equal(run.teaching.steps[0].speech, renderedSetup.slice('[STEP]'.length, -'[/STEP]'.length),
      'graded setup speech is exactly the host rendering'); checks++;
    assert.deepEqual(run.teaching.steps[0].tags, []); checks++;
  }
  assert(!run.teaching.rawText.includes(prefixResponse), 'action JSON never leaks into lesson text'); checks++;
  if (prefixMode === 'answer-leak') {
    assert(!run.teaching.rawText.includes(answerLeak), 'rejected requested-answer prefix is not replayed'); checks++;
  }
  assert.equal(run.timings.firstSetupReadyMs ?? null, setup.length ? 40 : null,
    'setup readiness is recorded only for an admitted finite host STEP'); checks++;
  if (figureOnly) {
    assert.equal(run.timings.firstMainStepReadyMs ?? null, null); checks++;
  } else {
    const delta = vm.events.find(event => event.name === 'main-content-delta');
    const completions = vm.events.filter(event => event.name === 'teaching-completed');
    const firstFinished = completions[0];
    const finished = completions.at(-1);
    assert.equal(delta.listenerPresent, true, 'real pipeline supplies the streaming delta listener'); checks++;
    assert(Number.isFinite(run.timings.firstMainStepReadyMs), 'a main narration segment gets a readiness clock'); checks++;
    assert(run.timings.firstMainStepReadyMs <= finished.at - 1_000,
      `${name}: main readiness is not delayed until after full-response completion (ready=${run.timings.firstMainStepReadyMs}, finished=${finished.at - 1_000}, delta=${delta.at - 1_000})`); checks++;
    if (!exhaustContinuations) {
      assert.equal(run.timings.firstMainStepReadyMs, delta.at - 1_000,
        'complete main segment is timed when streamed, not when the fake full response finishes'); checks++;
      assert(run.timings.firstMainStepReadyMs < finished.at - 1_000); checks++;
    } else {
      assert.equal(vm.events.filter(event => event.name === 'main-segment-ready' && event.hasNarration && event.at <= firstFinished.at).length, 0,
        'an unfinished first STEP is not ready at the first response end'); checks++;
      assert(run.timings.firstMainStepReadyMs > firstFinished.at - 1_000,
        'continuation readiness cannot be backdated to an unfinished first fragment'); checks++;
    }
  }
  if (sceneMode === 'valid' && !blocked) { assert.equal(run.diagram.committed, true); checks++; }
  if (sceneMode === 'invalid' || blocked) {
    const shown = vm.events.filter(event => event.name === 'verified-presentation');
    assert.equal(shown.length, 1); checks++;
    assert.equal(shown[0].hasFigure, false); checks++;
    assert.deepEqual(shown[0].introCommands, [], 'invalid/contradicted figure has no presented drawing or FOCUS beats'); checks++;
  }
  if (speculationEnabled) {
    assert(vm.events.some(event => event.name === 'scene-dispatched' && event.held),
      'the circuit control must genuinely enter a held speculative callback'); checks++;
    assert.equal(run.timings.stages.speculative, true, 'the unchanged pipeline keeps this identity-equal speculative candidate'); checks++;
  }
  if (blocked) {
    assert.equal(run.diagram.committed, false); checks++;
    assert.equal(run.solver.status, 'contradiction'); checks++;
    assert(fullCalls.length > 0, 'KNOWN mismatch: unchanged lab teaches where live stops'); checks++;
  }
  if (exhaustContinuations) { assert.equal(stats.teachingCalls, 4, 'one prefix plus three normal teaching calls'); checks++; }
  if (unmarkedTeaching) {
    assert(run.teaching.steps.some(step => step.speech.includes('The endpoints are A and B')),
      'accepted prefix cannot hide an unmarked main explanation'); checks++;
    assert(run.teaching.steps.some(step => step.tags.some(tag => tag.type === 'WRITE')),
      'unmarked main board work remains in the graded lesson'); checks++;
    assert(run.teaching.steps.some(step => step.tags.some(tag => tag.type === 'FOCUS')),
      'unmarked main verified focus remains in the graded lesson'); checks++;
    assert.deepEqual(run.teaching.steps.map(step => step.index), run.teaching.steps.map((_step, index) => index + 1)); checks++;
  }
  if (renderedSetup) {
    assert.equal(/\p{Script=Devanagari}/u.test(renderedSetup), narrationLanguage === 'hinglish',
      'actual controller host rendering, not model prose, honors narration language'); checks++;
  }
  const selected = vm.selections[0]?.selected.representation;
  const result = { name, committed: run.diagram.committed, source: run.diagram.figureSource,
    planSHA256: hash(run.plan), solverSHA256: hash(run.solver),
    selectionSHA256: hash({ sceneDocument: selected?.sceneDocument ?? null, renderScene: selected?.renderScene ?? null,
      source: selected?.figureSource ?? null }), sceneRequestSHA256: hash(vm.requests),
    solver: run.solver?.status, calls: stats.teachingCalls, prefixCalls: stats.prefixCalls,
    setupBeforeScene: setup.length > 0 && setup[0].at < 1_100,
    firstSetupReadyMs: run.timings.firstSetupReadyMs ?? null,
    firstMainStepReadyMs: run.timings.firstMainStepReadyMs ?? null,
    sourceSHA256: stats.sourceSHA256, sourceCount: stats.repositorySources.length,
    importCount: stats.imports.length, sourceOnly: stats.packagesLoadedFromSource,
    networkAttempts: stats.providerAttempts,
    actualIntegration: stats.actualIntegration,
    ...(blocked ? { expectedLiveLabMismatch: 'lab continues teaching; live useQuestionHandler rejects solver contradiction before teaching' } : {}),
  };
  results.push(result);
  return result;
}

const off = await scenario('OFF', { enabled: false });
const on = await scenario('ON');
function assertSameAuthority(actual, baseline) {
  for (const field of ['selectionSHA256', 'sceneRequestSHA256', 'planSHA256', 'solverSHA256']) {
    assert.equal(actual[field], baseline[field], `${actual.name}: ${field} cannot change with host setup`); checks++;
  }
  assert.equal(actual.committed, baseline.committed, `${actual.name}: no figure loss`); checks++;
}
assertSameAuthority(on, off);
assertSameAuthority(await scenario('invalid prefix fallback', { prefixMode: 'invalid' }), off);
assertSameAuthority(await scenario('requested-answer prefix fallback', { prefixMode: 'answer-leak' }), off);
assertSameAuthority(await scenario('failed prefix fallback', { prefixMode: 'failure' }), off);
assertSameAuthority(await scenario('held prefix then ignored late resolve', { prefixMode: 'held' }), off);
await scenario('four-call teaching ceiling', { exhaustContinuations: true });
const invalidOff = await scenario('invalid scene OFF', { enabled: false, sceneMode: 'invalid' });
assertSameAuthority(await scenario('invalid scene remains verified-only', { sceneMode: 'invalid' }), invalidOff);
await scenario('figure-only skip', { figureOnly: true });
await scenario('speculation holds prefix', { speculationEnabled: true });
const blockedOff = await scenario('authority block OFF', { enabled: false, blocked: true });
assertSameAuthority(await scenario('authority block explicitly differs from live', { blocked: true }), blockedOff);
await scenario('accepted prefix preserves unmarked teaching', { unmarkedTeaching: true });
await scenario('Hinglish prefix dispatch', { narrationLanguage: 'hinglish' });
console.log(JSON.stringify({ status: 'PASS', checks, actualSourceExecution: true, providerAttempts: 0, results }, null, 2));
