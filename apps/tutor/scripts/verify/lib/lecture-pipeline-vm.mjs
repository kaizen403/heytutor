// Actual tracked lab integration: only external provider responses and time
// are frozen. Source selection, prefix admission, history and raw assembly run
// unchanged. This gate does not claim live parity for authority contradictions.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

function findRepositoryRoot() {
  let candidate = path.dirname(fileURLToPath(import.meta.url));
  while (path.dirname(candidate) !== candidate) {
    if (fs.existsSync(path.join(candidate, 'apps/tutor/package.json')) && fs.existsSync(path.join(candidate, 'packages/scene-engine/src/index.ts'))) return candidate;
    candidate = path.dirname(candidate);
  }
  throw new Error('No HeyTutor repository root found');
}
export const root = findRepositoryRoot();
export const pipelinePath = 'apps/tutor/scripts/lecture-lab/lecturePipeline.ts';
const appRequire = createRequire(path.join(root, 'apps/tutor/package.json'));
const ts = appRequire('typescript');
const hash = value => createHash('sha256').update(value).digest('hex');
const transpiled = new Map();
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

export function createLecturePipelineVm(input) {
  const modules = new Map();
  const sources = new Map();
  const edges = [];
  const events = [];
  const requests = [];
  const selections = [];
  let trackedPrefixController = null;
  let prefixSignal = null;
  let verifiedPromptAddon = null;
  let verifiedTeachingPrompt = null;
  let fullTeachingCalls = 0;
  let teachingCalls = 0;
  let prefixCalls = 0;
  let providerAttempts = 0;
  const record = (name, data = {}) => events.push({ name, at: input.now(), ...data });
  const observeAcceptedPrefix = result => {
    const drawing = load('packages/drawing/src/index.ts').parseDrawingCommands(result.raw);
    record('useful-prefix-accepted', { commandCount: drawing.commands.length, raw: result.raw });
  };
  function resolveSource(candidate) {
    const absolute = path.isAbsolute(candidate) ? candidate : path.join(root, candidate);
    const base = absolute.endsWith('.js') ? absolute.slice(0, -3) : absolute;
    const target = [absolute, `${absolute}.ts`, `${absolute}.tsx`, `${absolute}.json`,
      `${absolute}/index.ts`, `${base}.ts`, `${base}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    if (!target || path.relative(root, target).startsWith('..')) throw new Error(`Unresolved source import ${candidate}`);
    return target;
  }

  async function teachingPort(request) {
    teachingCalls++;
    if (teachingCalls > 4) throw new Error('prototype teaching call budget exceeded');
    const isPrefix = request.systemPrompt.includes('PENDING_FIGURE_PREFIX');
    if (isPrefix) {
      record('prefix-dispatched', { call: teachingCalls, systemPrompt: request.systemPrompt });
      prefixSignal = request.signal ?? null;
      prefixCalls++;
      if (prefixCalls > 1) throw new Error('prototype dispatched a second prefix');
      return input.teachPrefix(request);
    }
    if (input.mutateWaitForPrefix) await trackedPrefixController?.settled();
    const sent = { ...request, conversationHistory: structuredClone(request.conversationHistory ?? []) };
    if (input.mutateDropVerifiedPrompt) sent.systemPrompt = 'Lost verified teaching prompt';
    if (input.mutateDropPrefixHistory) sent.conversationHistory = [];
    const expectedPrompt = fullTeachingCalls++ === 0
      ? verifiedTeachingPrompt?.systemPrompt : verifiedTeachingPrompt?.continuationPrompt;
    record('teaching-dispatched', {
      call: teachingCalls, history: structuredClone(sent.conversationHistory ?? []),
      question: request.question, userPrompt: request.userPrompt,
      verifiedPromptPreserved: typeof expectedPrompt === 'string' && sent.systemPrompt.startsWith(expectedPrompt),
      alreadyTaughtInstruction: /already(?:\s+been)?\s+taught/i.test(sent.systemPrompt),
      verifiedFigureContextPresent: !verifiedPromptAddon || sent.systemPrompt.includes(verifiedPromptAddon),
    });
    const reply = await input.teachFull(sent, teachingCalls - prefixCalls);
    return reply;
  }

  const ports = {
    async planTurnV3(question) {
      record('plan-reply');
      if (question !== input.plan.question) throw new Error('frozen plan question identity changed');
      return { turnPlan: structuredClone(input.plan), peerTurnPlans: [], subject: 'maths' };
    },
    async planAndSolveProblemV1() {
      record('authority-dispatched');
      const authority = await input.authority();
      record('authority-reply');
      return structuredClone(authority);
    },
    async planSceneDocumentWithRepair(question, validate, options) {
      record('scene-dispatched', { held: Boolean(options.holdValidationUntil) });
      requests.push({ question, request: {
        conversationContext: options.conversationContext,
        constructionOperators: options.constructionOperators,
        proofPredicates: options.proofPredicates,
        planningGuidance: options.planningGuidance,
        workedExamples: options.workedExamples,
      } });
      await input.scene();
      if (options.holdValidationUntil && !(await options.holdValidationUntil)) return null;
      if (options.signal?.aborted) return null;
      const document = structuredClone(input.sceneDocument);
      const response = { document, rawContent: JSON.stringify(document), phase: 'plan', lane: 'primary', elapsedMs: 0 };
      const validation = await validate(document);
      options.onResponse?.(response);
      options.onCandidateValidation?.(response, validation);
      record('scene-validated', { valid: validation.valid });
      return { response, validation, repaired: false,
        candidates: [{ candidateId: 'frozen-primary', response, validation, score: 0, selected: true }] };
    },
    streamLLMResponse: teachingPort,
  };

  function load(candidate) {
    const filename = resolveSource(candidate);
    if (modules.has(filename)) return modules.get(filename).exports;
    const raw = fs.readFileSync(filename);
    sources.set(path.relative(root, filename), hash(raw));
    if (filename.endsWith('.json')) {
      const value = JSON.parse(raw);
      modules.set(filename, { exports: value }); return value;
    }
    const loadedModule = { exports: {} };
    modules.set(filename, loadedModule);
    const source = raw.toString('utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href))
      .replaceAll('import.meta.dirname', JSON.stringify(path.dirname(filename)));
    const compilationKey = `${filename}:${hash(raw)}`;
    if (!transpiled.has(compilationKey)) transpiled.set(compilationKey, ts.transpileModule(source, { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText);
    const compiled = transpiled.get(compilationKey);
    const requireLocal = specifier => {
      let target;
      if (specifier === '@heytutor/scene-engine') target = 'packages/scene-engine/src/index.ts';
      else if (specifier === '@heytutor/tutor-core') target = 'packages/tutor-core/src/index.ts';
      else if (specifier === '@heytutor/drawing') target = 'packages/drawing/src/index.ts';
      else if (specifier === '@heytutor/design-tokens') target = 'packages/design-tokens/src/index.ts';
      else if (specifier === '@heytutor/whiteboard') target = 'packages/whiteboard/src/index.ts';
      else if (specifier === '@heytutor/whiteboard/pen-spinner') target = 'packages/whiteboard/src/pen-spinner.ts';
      else if (specifier.startsWith('@/')) target = `apps/tutor/${specifier.slice(2)}`;
      else if (specifier.startsWith('.')) target = path.resolve(path.dirname(filename), specifier);
      if (!target) {
        if (specifier.startsWith('@heytutor/')) throw new Error(`Unclosed workspace source import ${specifier}`);
        if (specifier === 'node:http' || specifier === 'node:https') throw new Error('Network module import refused');
        return appRequire(specifier);
      }
      const resolved = resolveSource(target);
      edges.push({ from: path.relative(root, filename), specifier, to: path.relative(root, resolved) });
      const real = load(resolved);
      if (path.relative(root, filename).startsWith('apps/tutor/scripts/lecture-lab/') &&
        specifier === '@heytutor/tutor-core') return { ...real, ...ports };
      if (path.relative(root, filename) !== pipelinePath) return real;
      if (specifier.endsWith('/turnTeachingPrompt')) return { ...real,
        buildTurnTeachingPrompt(promptInput) {
          const prompt = real.buildTurnTeachingPrompt(promptInput);
          verifiedTeachingPrompt = prompt;
          record('verified-teaching-prompt-generated', {
            systemPromptSHA256: hash(prompt.systemPrompt), continuationPromptSHA256: hash(prompt.continuationPrompt),
            actualDiagramAddonPresent: !verifiedPromptAddon || prompt.systemPrompt.includes(verifiedPromptAddon),
          });
          return prompt;
        } };
      if (specifier === './parallelTeachingController') return { ...real,
        createParallelPrefixController(controllerInput) {
          trackedPrefixController = real.createParallelPrefixController(controllerInput);
          return trackedPrefixController;
        } };
      if (specifier.endsWith('/productionSceneSelection')) return { ...real,
        selectProductionScene(selectionInput) {
          const selected = real.selectProductionScene(selectionInput);
          if (input.mutateDropSelectedFigure && input.parallelEnabled && selected.representation) {
            selected.representation = null;
          }
          selections.push({ input: selectionInput, selected });
          record('scene-selected', { source: selected.representation?.figureSource ?? 'text_only' });
          return selected;
        } };
      return real;
    };
    new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
      requireLocal, loadedModule, loadedModule.exports, filename, path.dirname(filename));
    return loadedModule.exports;
  }

  return {
    load, events, requests, selections,
    setSceneDocument(document) { input.sceneDocument = structuredClone(document); },
    settlePrefix: () => trackedPrefixController?.settled() ?? Promise.resolve(),
    prefixSignalAborted: () => prefixSignal?.aborted ?? null,
    async run() {
      const nativeFetch = globalThis.fetch;
      const nativeNow = Date.now;
      const nativeSpeculationFlag = process.env.NEXT_PUBLIC_SCENE_SPECULATION;
      globalThis.fetch = async () => { providerAttempts++; throw new Error('No HTTP/provider/localhost calls in this VM'); };
      Date.now = input.now;
      process.env.NEXT_PUBLIC_SCENE_SPECULATION = input.speculationEnabled ? '1' : '0';
      try {
        const pipelineModule = load(pipelinePath);
        return await pipelineModule.runLecture(input.plan.question, {
          origin: 'http://synthetic.invalid', cookie: '', fastMode: false, arm: 'planner_first',
          figureOnly: Boolean(input.figureOnly), scenePlannerDeadlineMs: 60_000,
          visualNeedReplay: { decision: null, source: 'unavailable', unavailableReason: 'missing_gateway_key', usage: null, provenance: null },
          traceId: 'synthetic-parallel-prefix',
          parallelTeaching: Boolean(input.parallelEnabled),
          narrationLanguage: input.narrationLanguage,
          onParallelPrefix: observeAcceptedPrefix,
          onPresentation(presentation) {
            verifiedPromptAddon = presentation.diagram?.promptAddon ?? null;
            record('verified-presentation', { hasFigure: Boolean(presentation.diagram),
              introCommands: presentation.intro.flatMap(segment => segment.commands ?? (segment.command ? [segment.command] : [])) });
            input.onPresentation?.(presentation);
          },
        });
      } finally {
        globalThis.fetch = nativeFetch; Date.now = nativeNow;
        if (nativeSpeculationFlag === undefined) delete process.env.NEXT_PUBLIC_SCENE_SPECULATION;
        else process.env.NEXT_PUBLIC_SCENE_SPECULATION = nativeSpeculationFlag;
      }
    },
    stats() { return { teachingCalls, prefixCalls, providerAttempts, actualIntegration: true,
      sourceSHA256: sources.get(pipelinePath), repositorySources: [...sources].map(([file, sha256]) => ({ file, sha256 })),
      imports: edges, packagesLoadedFromSource: true }; },
  };
}
