import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLecturePipelineVm, deferred } from './lib/lecture-pipeline-vm.mjs';

// Synthetic public fixture only. No providers, student questions or images.
const question = 'Draw a labelled line segment AB of length 3 cm. State its length and identify its endpoints.';
const rawQuestion = 'Draw a labelled line segment AB of length 3 cm.\n\nState its length and identify its endpoints.';
const plan = { schemaVersion: 'turn-plan/v3', question, visualRequirement: 'required',
  givens: [{ id: 'givenLength', symbol: 'l', value: 3, unit: 'cm', provenance: 'given', sourceText: '3 cm' }],
  unknowns: [{ id: 'length', symbol: 'L', unit: 'cm' }],
  derived: [{ id: 'length', symbol: 'L', value: 3, unit: 'cm', provenance: 'derived', sourceText: 'L = 3 cm' }],
  qualitativeClaims: [], lawIds: [], assumptions: [] };
const sceneDocument = { schemaVersion: 'scene-document/v2', source: { question },
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
  teachingTimeline: [{ id: 'reveal', action: 'reveal', targetId: 'setup', dependsOn: [], narrationIntent: 'Segment AB.' }] };
const setup = { v: 1, actions: ['organize_givens', 'identify_target'] };
const main = '[STEP]The endpoints are A and B, and the segment connects them. Its stated length is three centimetres.[WRITE:A and B are endpoints,80,150][FOCUS:ab][/STEP]';
const reply = text => ({ text, streamStats: { contentChars: text.length, reasoningChars: 0, ttftContentMs: 0 } });
const flush = async () => { for (let index = 0; index < 200; index++) await Promise.resolve(); };
const cases = [];
const mutation = process.argv.find(argument => argument.startsWith('--mutate-')) ?? null;
const count = (vm, name) => vm.events.filter(event => event.name === name).length;
const setupRaw = '[STEP]First, separate the information supplied from what still needs to be established. Identify exactly what is being asked, and keep that target separate from the supplied information.[/STEP]';

function fixture(options = {}) {
  let now = 1_000;
  const scene = deferred();
  const prefix = deferred();
  let vm;
  vm = createLecturePipelineVm({
    plan, rawQuestion, sceneDocument, parallelEnabled: true, ignoreSceneAbort: true,
    pendingFigureMutation: mutation,
    now: () => now, scene: () => scene.promise,
    authority: async () => {
      const engine = vm.load('packages/scene-engine/src/index.ts');
      const problemIR = { schemaVersion: 'problem-ir/v1', id: 'segmentLength', question,
        facts: [{ id: 'request', kind: 'requested', statement: question,
          evidence: { source: 'question', start: 0, end: question.length, quote: question } }],
        entities: [], expressions: [{ id: 'lengthValue', valueType: 'scalar', root: { kind: 'number', value: 3 }, evidenceFactIds: ['request'] }],
        constraints: [], representationIntents: [], solveRequests: [{ id: 'evaluateLength', kind: 'evaluate', expressionId: 'lengthValue',
          resultBinding: { turnPlanQuantityId: 'length', symbol: 'L', unit: 'cm', evidenceFactIds: ['request'] } }] };
      const solverResult = await new engine.LocalDeterministicSolverProvider().solve(problemIR);
      const audit = engine.verifyTurnPlanAgainstSolver(problemIR, solverResult, plan, question);
      assert.equal(audit.status, 'verified');
      return { problemIR, solverResult, audit, projection: null, rawContent: JSON.stringify(problemIR), elapsedMs: 0 };
    },
    teachPrefix: () => prefix.promise,
    teachFull: async (_request, _call, onDelta) => { now += 10; onDelta(main); return reply(main); },
    ...options,
  });
  assert.equal(vm.load('packages/tutor-core/src/text/questionText.ts').normalizeTutorQuestion(rawQuestion), question,
    'the real normalizer supplies the synthetic plan identity without changing the persisted raw question');
  return { vm, scene, prefix, advance(ms) { now += ms; } };
}

function assertClosedSources(vm) {
  assert.equal(vm.stats().providerAttempts, 0, 'actual pipeline cannot make HTTP/model calls in this gate');
  assert.equal(vm.stats().actualIntegration, true);
  assert.equal(vm.stats().packagesLoadedFromSource, true);
  assert(vm.stats().repositorySources.every(({ file }) => !file.startsWith('.context/')),
    'ignored helper code cannot replace the tracked implementation');
}

function assertCheckpoint(checkpoint, hasSetup) {
  assert.deepEqual(Object.keys(checkpoint).sort(), ['schemaVersion', 'identity', 'setup'].sort(),
    'checkpoint has no authority, scene, render or narration payload');
  assert.equal(checkpoint.schemaVersion, 'lab-pending-figure/v1');
  assert.deepEqual(Object.keys(checkpoint.identity).sort(), [
    'question', 'language', 'arm', 'familiarity', 'fastMode', 'productionStrictSubjects',
    'scenePlannerDeadlineMs', 'sceneDeclinePolicy', 'selectionVersion', 'rendererSHA256',
  ].sort(), 'execution identity contains only the agreed bounded fields');
  assert.equal(checkpoint.identity.question, rawQuestion, 'checkpoint preserves the exact original question including its newlines');
  assert.equal(checkpoint.identity.language, 'english');
  assert.equal(checkpoint.identity.arm, 'planner_first');
  assert.equal(checkpoint.identity.familiarity, 'normal');
  assert.equal(checkpoint.identity.fastMode, false);
  assert.equal(checkpoint.identity.productionStrictSubjects, null);
  assert.equal(checkpoint.identity.scenePlannerDeadlineMs, 60_000);
  assert.equal(checkpoint.identity.sceneDeclinePolicy, 'unchanged');
  assert.equal(typeof checkpoint.identity.selectionVersion, 'string');
  assert(checkpoint.identity.selectionVersion.length > 0);
  assert.match(checkpoint.identity.rendererSHA256, /^[a-f0-9]{64}$/);
  assert.deepEqual(checkpoint.setup, hasSetup ? setup : null);
  assert(Buffer.byteLength(JSON.stringify(checkpoint), 'utf8') <= 16 * 1024);
  assert(!JSON.stringify(checkpoint).includes(setupRaw), 'only admitted operation IDs, not host/model prose, are stored');
}

async function stoppedScenario(name, { acceptSetup = false, alreadyStopped = false } = {}) {
  const controller = new AbortController();
  if (alreadyStopped) controller.abort();
  const f = fixture({ stopSignal: controller.signal });
  let completed = false;
  let stoppedRun;
  const pending = f.vm.run().then(run => { completed = true; stoppedRun = run; return run; });
  await flush();
  const reachedScene = count(f.vm, 'scene-dispatched') > 0;
  if (acceptSetup) {
    f.advance(40);
    f.prefix.resolve(reply(JSON.stringify(setup)));
    await flush();
  }
  const setupBeforeStop = count(f.vm, 'setup-prefix-accepted');
  if (!alreadyStopped) controller.abort();
  await flush();
  const returnedBeforeLateScene = completed;
  const stoppedSnapshot = completed ? JSON.stringify(stoppedRun) : null;
  // Always release fake ports so a RED does not leave patched globals pending.
  f.advance(90);
  f.prefix.resolve(reply(JSON.stringify(setup)));
  f.scene.resolve();
  const run = await pending;
  await f.vm.settlePrefix();
  await flush();
  assert.equal(reachedScene, !alreadyStopped, `${name}: actual overlap reaches the held scene unless already stopped`);
  assert.equal(setupBeforeStop, acceptSetup ? 1 : 0);
  assert.equal(returnedBeforeLateScene, true, `${name}: Stop must return promptly without awaiting an uncooperative scene provider`);
  assert.equal(run.stoppedWhileFigurePending, true);
  assert.equal(run.error, null, 'an intentional Stop is not a model failure');
  assert.equal(run.teaching.incomplete, true);
  assert.equal(run.diagram.committed, false);
  assert.equal(run.diagram.emptyCause, null, 'an interruption is not a decline, invalid candidate or deadline');
  assertCheckpoint(run.pendingFigureCheckpoint, acceptSetup);
  assert.equal(run.teaching.rawText, acceptSetup ? setupRaw : '', 'stopped artifact preserves only its admitted host STEP');
  assert.equal(run.timings.firstSetupReadyMs ?? null, acceptSetup ? 40 : null);
  assert.equal(run.timings.firstMainStepReadyMs ?? null, null);
  assert.equal(count(f.vm, 'setup-prefix-accepted'), acceptSetup ? 1 : 0, 'late prefix never becomes newly delivered narration');
  assert.equal(count(f.vm, 'scene-validated'), 0, 'late scene cannot finish candidate admission');
  assert.equal(count(f.vm, 'scene-selected'), 0);
  assert.equal(count(f.vm, 'verified-presentation'), 0);
  assert.equal(count(f.vm, 'teaching-dispatched'), 0, 'Stop does not dispatch fallback or continuation teaching');
  assert.equal(JSON.stringify(run), stoppedSnapshot, 'late uncooperative callbacks cannot mutate the returned stopped artifact');
  if (alreadyStopped) {
    assert.equal(count(f.vm, 'plan-reply'), 0);
    assert.equal(count(f.vm, 'authority-dispatched'), 0);
    assert.equal(f.vm.stats().teachingCalls, 0);
  }
  assertClosedSources(f.vm);
  cases.push(name);
  return run.pendingFigureCheckpoint;
}

async function reopenScenario(name, checkpoint) {
  const f = fixture({ reopenPendingFigure: checkpoint });
  f.scene.resolve();
  f.prefix.resolve(reply(JSON.stringify(setup)));
  const run = await f.vm.run();
  await flush();
  assert.equal(run.error, null, `${name}: disk-restored run completes normally`);
  assert.equal(run.stoppedWhileFigurePending, undefined);
  assert.equal(run.pendingFigureCheckpoint, undefined);
  assert.equal(run.diagram.committed, true, 'reopen still selects and compiles a verified figure');
  assert.equal(count(f.vm, 'plan-reply'), 1, 'reopen makes a fresh plan rather than restoring one');
  assert.equal(count(f.vm, 'authority-dispatched'), 1, 'reopen obtains fresh deterministic authority');
  assert(count(f.vm, 'scene-dispatched') > 0, 'reopen freshly plans the pending scene');
  assert(count(f.vm, 'scene-validated') > 0, 'reopen uses real shared candidate validation');
  assert.equal(f.vm.requests[0].question, question);
  assert.equal(run.parallelTeaching.restored, Boolean(checkpoint.setup));
  if (checkpoint.setup) {
    assert.equal(run.parallelTeaching.accepted, false, 'restored setup is not counted as a fresh accepted setup');
    assert.equal(run.parallelTeaching.started, false);
    assert.equal(f.vm.stats().prefixCalls, 0, 'restored host setup prevents a second setup request');
    assert.equal(count(f.vm, 'setup-prefix-accepted'), 0, 'reopen never replays its setup callback');
    assert.equal(run.timings.firstSetupReadyMs ?? null, null, 'restored history never manufactures a new setup readiness clock');
    const firstMain = f.vm.events.find(event => event.name === 'teaching-dispatched');
    assert.deepEqual(firstMain.history, [{ user: question, assistant: setupRaw }]);
    assert.equal(firstMain.alreadyTaughtInstruction, true);
    assert.equal(firstMain.verifiedPromptPreserved, true);
    assert.equal(firstMain.verifiedFigureContextPresent, true);
    for (const event of f.vm.events.filter(event => event.name === 'teaching-dispatched')) {
      assert.equal(event.history[0].assistant.split(setupRaw).length - 1, 1,
        'every continuation retains the already-taught host STEP exactly once');
    }
    assert.equal(run.teaching.rawText.split(setupRaw).length - 1, 1);
    assert.equal(run.teaching.steps[0].speech, setupRaw.slice(6, -7));
    assert.deepEqual(run.teaching.steps[0].tags, [], 'restored setup owns no ink or focus');
  } else {
    assert.equal(f.vm.stats().prefixCalls, 1, 'a checkpoint with no admitted setup may request setup freshly');
    assert.equal(count(f.vm, 'setup-prefix-accepted'), 1);
  }
  assertClosedSources(f.vm);
  cases.push(name);
  return run;
}

async function rejectsBeforeIo(name, checkpoint, options = {}) {
  const f = fixture({ reopenPendingFigure: checkpoint, ...options });
  f.scene.resolve(); f.prefix.resolve(reply(JSON.stringify(setup)));
  const run = await f.vm.run();
  await flush();
  assert.equal(typeof run.error, 'string', `${name}: invalid checkpoint is rejected rather than silently ignored`);
  assert(run.error.length > 0);
  for (const event of ['plan-reply', 'authority-dispatched', 'scene-dispatched', 'scene-selected', 'verified-presentation', 'teaching-dispatched', 'setup-prefix-accepted']) {
    assert.equal(count(f.vm, event), 0, `${name}: ${event} cannot run before checkpoint admission`);
  }
  assert.equal(f.vm.stats().teachingCalls, 0);
  assert.equal(run.diagram.committed, false);
  assertClosedSources(f.vm);
  cases.push(name);
}

async function completeControl(name, options = {}, { abortedAfterCommit = false } = {}) {
  const f = fixture(options);
  f.scene.resolve(); f.prefix.resolve(reply(JSON.stringify(setup)));
  const run = await f.vm.run();
  await flush();
  if (abortedAfterCommit) {
    assert.match(run.error, /^AbortError:/, 'post-commit Stop records the intentionally aborted main teaching');
    assert.equal(count(f.vm, 'teaching-dispatched'), 0, 'no main teaching dispatches after the post-commit abort');
  } else {
    assert.equal(run.error, null);
  }
  assert.equal(run.diagram.committed, true);
  assert.equal(run.stoppedWhileFigurePending, undefined);
  assert.equal(run.pendingFigureCheckpoint, undefined);
  assertClosedSources(f.vm);
  cases.push(name);
  return { run, vm: f.vm };
}

const withSetup = await stoppedScenario('Stop after setup returns before late scene', { acceptSetup: true });
const withoutSetup = await stoppedScenario('Stop before setup discards late prefix and scene');
await stoppedScenario('Already stopped dispatches no calls', { alreadyStopped: true });

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'heytutor-pending-figure-gate-'));
try {
  const filename = path.join(directory, 'pending-figure.json');
  fs.writeFileSync(filename, JSON.stringify(withSetup), { mode: 0o600 });
  const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
  assert.deepEqual(parsed, withSetup, 'JSON filesystem save/reopen retains only the bounded checkpoint');
  await reopenScenario('Disk roundtrip restores setup once with fresh authority', parsed);
  await reopenScenario('Second fresh VM does not accumulate setup history', parsed);
} finally {
  fs.rmSync(directory, { recursive: true });
}
await reopenScenario('Empty-setup checkpoint permits fresh host setup', withoutSetup);

// Public checkpoint helper seam: bounds must fail independently of an
// execution-identity mismatch or an unknown-key rejection.
const helperVm = fixture().vm;
const checkpointApi = helperVm.load('apps/tutor/scripts/lecture-lab/parallelPendingFigure.ts');
const prefixApi = helperVm.load('apps/tutor/scripts/lecture-lab/parallelTeachingPrefix.ts');
const admitted = prefixApi.acceptParallelPrefix(JSON.stringify(setup), rawQuestion, 'english');
assert.equal(admitted.accepted, true);
assert.deepEqual(admitted.actions, setup.actions, 'admission exposes only the selected known action IDs');
assert.equal(checkpointApi.restorePendingFigureCheckpoint(withSetup, withSetup.identity).raw, setupRaw);
assert.equal(checkpointApi.restorePendingFigureCheckpoint(withoutSetup, withoutSetup.identity), null);
assert.throws(() => checkpointApi.createPendingFigureCheckpoint(withSetup.identity, {
  ...admitted, raw: '[STEP]The requested answer is already known.[/STEP]',
}), 'a constructor cannot preserve prose that differs from the canonical host action rendering');
const identityInput = { ...withSetup.identity };
delete identityInput.rendererSHA256;
assert.throws(() => checkpointApi.pendingFigureIdentity({ ...identityInput, question: 'é'.repeat(4097) }),
  '8 KiB original-question bound is measured in UTF-8 bytes, not string characters');
assert.doesNotThrow(() => checkpointApi.pendingFigureIdentity({ ...identityInput, question: 'x'.repeat(8192) }),
  'the exact question byte boundary remains admitted');
const largeIdentity = { ...withSetup.identity, selectionVersion: 'x'.repeat(17 * 1024) };
const largeCheckpoint = { schemaVersion: 'lab-pending-figure/v1', identity: largeIdentity, setup: null };
assert.throws(() => checkpointApi.createPendingFigureCheckpoint(largeIdentity, null),
  '16 KiB bound rejects a large otherwise matching constructor input');
assert.throws(() => checkpointApi.restorePendingFigureCheckpoint(largeCheckpoint, largeIdentity),
  '16 KiB bound rejects a large otherwise matching restore input');
assertClosedSources(helperVm);
cases.push('Checkpoint helper bounds and canonical host rendering');

const oversizedQuestion = 'é'.repeat(4097);
const oversizeMatching = structuredClone(withSetup);
oversizeMatching.identity.question = oversizedQuestion;
await rejectsBeforeIo('Matching oversized raw question is rejected before IO', oversizeMatching, { rawQuestion: oversizedQuestion });

for (const [name, options] of [
  ['Changed raw question, identical normalized question', { rawQuestion: question }],
  ['Changed language', { narrationLanguage: 'hinglish' }],
  ['Changed arm', { arm: 'current' }],
  ['Changed familiarity', { familiarity: 'beginner' }],
  ['Changed fastMode', { fastMode: true }],
  ['Changed strict-subject policy', { productionStrictSubjects: ['maths'] }],
  ['Changed scene deadline', { scenePlannerDeadlineMs: 120_000 }],
  ['Changed scene decline policy', { sceneDeclinePolicy: 'qualitative_setup_v1' }],
]) await rejectsBeforeIo(name, withSetup, options);

const malformed = [
  ['Unknown checkpoint scene field', value => { value.scene = sceneDocument; }],
  ['Unknown identity authority field', value => { value.identity.problemIR = {}; }],
  ['Unknown setup prose field', value => { value.setup.narration = '[STEP]The requested answer is three.[/STEP]'; }],
  ['Changed renderer hash', value => { value.identity.rendererSHA256 = '0'.repeat(64); }],
  ['Changed selection version', value => { value.identity.selectionVersion += '-forged'; }],
  ['Changed schema version', value => { value.schemaVersion = 'lab-pending-figure/v2'; }],
  ['Forged STEP action', value => { value.setup.actions = ['[STEP]The answer is three.[/STEP]']; }],
  ['Forged focus action', value => { value.setup.actions = ['[FOCUS:ab]']; }],
  ['Unknown action', value => { value.setup.actions = ['invent_geometry']; }],
  ['Duplicate action', value => { value.setup.actions = ['identify_target', 'identify_target']; }],
  ['No action', value => { value.setup.actions = []; }],
  ['Too many actions', value => { value.setup.actions = ['organize_givens', 'identify_target', 'normalize_units']; }],
  ['Invalid setup version', value => { value.setup.v = 2; }],
  ['Non-array actions', value => { value.setup.actions = 'identify_target'; }],
  ['Non-object identity', value => { value.identity = []; }],
  ['Oversize original question', value => { value.identity.question = 'x'.repeat(8 * 1024 + 1); }],
  ['Oversize whole checkpoint', value => { value.padding = 'x'.repeat(16 * 1024 + 1); }],
];
for (const [name, mutate] of malformed) {
  const value = structuredClone(withSetup); mutate(value);
  await rejectsBeforeIo(name, value);
}
for (const [name, value] of [['Null checkpoint', null], ['Array checkpoint', []], ['String checkpoint', 'forged'], ['Empty checkpoint', {}]]) {
  await rejectsBeforeIo(name, value);
}

const off = await completeControl('Default-off unchanged', { parallelEnabled: false });
assert.equal(off.run.parallelTeaching, undefined);
assert.equal(off.vm.stats().prefixCalls, 0);
const on = await completeControl('No Stop option preserves normal verified teaching');
assert.equal(on.run.diagram.figureSource, off.run.diagram.figureSource);
assert.deepEqual(on.run.solver, off.run.solver, 'the optional Stop seam does not change deterministic authority');

const afterCommit = new AbortController();
const post = await completeControl('Stop after verified commit is not pending', {
  stopSignal: afterCommit.signal,
  onPresentation(presentation) { if (presentation.diagram) afterCommit.abort(); },
}, { abortedAfterCommit: true });
assert.equal(post.run.pendingFigureCheckpoint, undefined);
assert.equal(post.run.stoppedWhileFigurePending, undefined);
assert.equal(count(post.vm, 'verified-presentation'), 1);
assert.equal(post.vm.events.find(event => event.name === 'verified-presentation').hasFigure, true);
assert.equal(typeof post.run.diagram.svg, 'string');
assert(post.run.diagram.svg.length > 0, 'post-commit Stop preserves the already verified figure artifact');
assert(post.run.diagram.entityIds.includes('ab'));

console.log(JSON.stringify({ status: 'PASS', actualSourceExecution: true, providerAttempts: 0,
  certification: 'lab source and filesystem checkpoint only; not browser, audio or canonical database save', cases }, null, 2));
