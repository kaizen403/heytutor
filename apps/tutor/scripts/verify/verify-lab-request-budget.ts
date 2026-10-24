/** Offline contract gate for the actual lecture-lab request budgeting seam. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as runner from "../lecture-lab/run";
import { expectedLabRequestModel, labModelProfilesMatch, type LabModelProfile } from "../../lib/llm/labModelProfile";

const K3 = "accounts/fireworks/models/kimi-k3";
const FLASH = "accounts/fireworks/models/deepseek-v4p1-flash";
const FAST = "accounts/fireworks/routers/kimi-k3-fast";
const profile: LabModelProfile = {
  version: "lab-model-profile/v1", provider: "fireworks", deployment: null, fastMode: false,
  models: { planner: K3, problemIR: K3, teaching: K3, picker: FLASH },
  rates: {
    planner: { lane: "kimi-k3", inputUsdPer1M: 3, outputUsdPer1M: 15, cachedInputUsdPer1M: 0.3 },
    problemIR: { lane: "kimi-k3", inputUsdPer1M: 3, outputUsdPer1M: 15, cachedInputUsdPer1M: 0.3 },
    teaching: { lane: "kimi-k3", inputUsdPer1M: 3, outputUsdPer1M: 15, cachedInputUsdPer1M: 0.3 },
    picker: { lane: "deepseek-flash", inputUsdPer1M: 0.3, outputUsdPer1M: 1.2, cachedInputUsdPer1M: 0.03 },
  },
};
const serverConfig = {
  configured: true, provider: "fireworks", deployment: null, modelProfile: profile,
  inputBounds: {
    picker: { inputByteMultiplier: 2, addedInputBytes: 30_000 },
    scene: { inputByteMultiplier: 1, addedInputBytes: 20_000 },
  },
  plannerOutputCap: 1_000, teachingOutputCap: 2_000,
};
const fastRates = { lane: "kimi-k3-fast" as const, inputUsdPer1M: 4.5, outputUsdPer1M: 22.5, cachedInputUsdPer1M: 0.45 };
const fastProfile: LabModelProfile = { ...profile, fastMode: true,
  models: { planner: FAST, problemIR: FAST, teaching: FAST, picker: FLASH },
  rates: { planner: fastRates, problemIR: fastRates, teaching: fastRates, picker: profile.rates.picker },
  // Production's teaching fallback after a 429, connect failures or a startup retry.
  teachingAlternate: { model: K3, rates: profile.rates.teaching } };
const fastServerConfig = { ...serverConfig, fastModelProfile: fastProfile };
const origin = "http://offline.test";
const endpoint = { provider: "fireworks" as const, deployment: null, url: "https://provider.invalid/chat" };
const init = { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "A π question" }], max_tokens: 100 }) };

type BudgetApi = Pick<typeof runner, "assertLabBudgetPreflight" | "labRequestBudgetDecision">;
const sceneHeaders = { "x-heytutor-trace-id": "offline-scene", "x-planner": "1", "x-scene-planner-version": "2" };
const close = (actual: number, expected: number, reason: string) => assert(Math.abs(actual - expected) < 1e-12,
  `${reason}: expected $${expected}, received $${actual}`);

function verifyDecision(api: BudgetApi): void {
  assert.equal(typeof api.assertLabBudgetPreflight, "function", "R1: the actual runner must export its preflight seam");
  assert.equal(typeof api.labRequestBudgetDecision, "function", "R1: the actual runner must export its request decision seam");
  api.assertLabBudgetPreflight(profile, serverConfig);
  const decide = (headers: Record<string, string> = sceneHeaders, url = `${origin}/api/chat`, body = init) =>
    api.labRequestBudgetDecision({ url, origin, headers: new Headers(headers), init: body, endpoint, profile, serverConfig });
  const queryScene = decide(sceneHeaders, `${origin}/api/chat?diagramExampleIds=a,b`);
  assert.equal(queryScene.shouldBudget, true, "M7: query-string scene requests cannot bypass the cap");
  assert.equal(queryScene.chatRequest, true);
  assert.equal(queryScene.plannerRequest, true);
  assert.equal(queryScene.directProviderRequest, false);
  assert.equal(queryScene.model, K3, "M10: scene is not the picker price lane");
  assert.deepEqual(queryScene.inputBound, serverConfig.inputBounds.scene, "M8: advertised server-prepared example expansion is retained");
  assert.equal(queryScene.maxAttempts, 2);
  // Worked billing oracle: the UTF-8 messages are 43 bytes (π is two bytes).
  // Scene: ((43 + 20,000 + 2,048) * $3 + 1,000 * $15) / 1M, twice.
  close(queryScene.worstCaseUsd, 0.162546, "M8/M10: captured K3 rates, server cap, expansion and both attempts");

  for (const [lane, laneHeaders] of [
    ["turn", { "x-turn-planner-version": "3" }],
    ["scene", { "x-scene-planner-version": "2" }],
    ["problem IR", { "x-problem-ir-version": "1" }],
  ] as const) {
    const result = decide({ "x-heytutor-trace-id": lane, "x-planner": "1", ...laneHeaders });
    assert.equal(result.model, K3, `M10: ${lane} uses the standard K3 identity`);
    assert.equal(result.inputBound, undefined, `${lane}: no query means no server example expansion`);
    close(result.worstCaseUsd, 0.042546, `${lane}: not priced at the cheap picker rate`);
  }
  const inline = decide(sceneHeaders, `${origin}/api/chat`, { ...init,
    body: JSON.stringify({ ...JSON.parse(init.body), workedExamples: [{ text: "Already supplied inline" }] }) });
  assert.equal(inline.inputBound, undefined, "inlined scene examples are not expanded again on the server");
  close(inline.worstCaseUsd, 0.042546, "inlined examples leave the messages-only bound unchanged");

  const picker = decide({ ...sceneHeaders, "x-diagram-example-picker": "1", "x-problem-ir-version": "1" },
    `${origin}/api/chat?diagramExampleIds=a,b`);
  assert.equal(picker.model, FLASH, "picker precedence matches actual server routing");
  assert.deepEqual(picker.inputBound, serverConfig.inputBounds.picker);
  close(picker.worstCaseUsd, 0.02168, "M8: picker expansion and captured high Flash $0.30/$1.20 prices, independently rounded");
  const teaching = decide({ "x-heytutor-trace-id": "teaching" });
  assert.equal(teaching.model, K3);
  assert.equal(teaching.plannerRequest, false);
  assert.equal(teaching.maxAttempts, 3, "M11: teaching can dispatch three proxy attempts");
  close(teaching.worstCaseUsd, 0.108819, "M10/M11: teaching cap and all three K3 attempts");
  const priority = api.labRequestBudgetDecision({ url: `${origin}/api/chat?diagramExampleIds=a,b`, origin,
    headers: new Headers(sceneHeaders), init, endpoint, profile,
    serverConfig: { ...serverConfig, planningSpeed: { priority: true } } });
  close(priority.worstCaseUsd, 0.325092, "priority doubles the planner reservation");
  close(decide(sceneHeaders, `${origin}/api/chat`, { ...init,
    body: JSON.stringify({ ...JSON.parse(init.body), max_tokens: 3_000 }) }).worstCaseUsd,
  0.102546, "a larger client output cap cannot be replaced with the smaller server cap");

  for (const [url, headers] of [
    [`${origin}/api/unrelated`, sceneHeaders],
    ["http://other.invalid/api/chat?diagramExampleIds=a,b", sceneHeaders],
    [`${origin}/api/chat`, { "x-planner": "1" }],
    [`${origin}/api/chat`, { ...sceneHeaders, "x-heytutor-trace-id": "" }],
  ] as const) {
    const result = decide(headers, url);
    assert.equal(result.shouldBudget, false, "unrelated or untraced requests retain existing non-budgeted behavior");
    assert.equal(result.chatRequest, false);
    assert.equal(result.worstCaseUsd, 0);
  }

  for (const [model, expected] of [[FLASH, 0.000747], [K3, 0.007773]] as const) {
    const direct = decide({}, endpoint.url, { ...init, body: JSON.stringify({ ...JSON.parse(init.body), model }) });
    assert.equal(direct.shouldBudget, true);
    assert.equal(direct.chatRequest, false);
    assert.equal(direct.directProviderRequest, true);
    assert.equal(direct.model, model, "direct provider JSON, not generic headers, owns the exact model");
    assert.equal(direct.maxAttempts, 1);
    assert.equal(direct.inputBound, undefined);
    close(direct.worstCaseUsd, expected, "direct provider uses matching captured profile price");
  }
  for (const body of ["{", "{}", JSON.stringify({ model: "unpriced-fallback" })]) {
    assert.throws(() => decide({}, endpoint.url, { ...init, body }),
      "malformed or unpriced direct provider requests fail closed before reservation");
  }

  const changedPrice = structuredClone(profile);
  changedPrice.rates.planner.inputUsdPer1M = 3.01;
  const changedPicker = structuredClone(profile);
  changedPicker.models.picker = K3;
  changedPicker.rates.picker = { ...profile.rates.planner };
  for (const mismatch of [
    { ...serverConfig, configured: false },
    { ...serverConfig, provider: "azure" },
    { ...serverConfig, deployment: "unexpected-deployment" },
    { ...serverConfig, modelProfile: changedPrice },
    { ...serverConfig, modelProfile: changedPicker },
    { ...serverConfig, plannerOutputCap: 0 },
    { ...serverConfig, teachingOutputCap: NaN },
    { ...serverConfig, inputBounds: { ...serverConfig.inputBounds, picker: { inputByteMultiplier: 0, addedInputBytes: 0 } } },
    { ...serverConfig, inputBounds: { ...serverConfig.inputBounds, scene: { inputByteMultiplier: 1, addedInputBytes: -1 } } },
  ]) {
    assert.throws(() => api.assertLabBudgetPreflight(profile, mismatch),
      "M9: server configuration, exact lane identities, prices and safe bounds must match before the round");
    assert.throws(() => api.labRequestBudgetDecision({ url: `${origin}/api/chat`, origin,
      headers: new Headers(sceneHeaders), init, endpoint, profile, serverConfig: mismatch }),
    "request boundary also rejects stale or mismatched preflight parameters");
  }
  const invalidProfile = structuredClone(profile);
  invalidProfile.models.planner = "unpriced-fallback";
  assert.throws(() => api.assertLabBudgetPreflight(invalidProfile, { ...serverConfig, modelProfile: invalidProfile }),
    "a self-consistent but unpriced fallback profile is not acceptable");

  // Fast: production routing, compared against the server's advertised Fast profile.
  try {
    api.assertLabBudgetPreflight(fastProfile, fastServerConfig);
    api.assertLabBudgetPreflight(profile, fastServerConfig);
  } catch {
    assert.fail("M12: a Fast lab must compare against the server's Fast profile, standard against standard");
  }
  const fastDecide = (headers: Record<string, string>, url = `${origin}/api/chat`) => api.labRequestBudgetDecision({ url, origin,
    headers: new Headers(headers), init, endpoint, profile: fastProfile, serverConfig: fastServerConfig });
  const fastScene = fastDecide(sceneHeaders, `${origin}/api/chat?diagramExampleIds=a,b`);
  assert.equal(fastScene.model, FAST, "Fast scene requests use the Fast router identity");
  // ((43 + 20,000 + 2,048) * $4.5 + 1,000 * $22.5) / 1M, twice.
  close(fastScene.worstCaseUsd, 0.24382, "Fast scene reserves at captured Kimi K3 Fast rates");
  for (const laneHeaders of [{ "x-turn-planner-version": "3" }, { "x-problem-ir-version": "1" }] as Record<string, string>[]) {
    const result = fastDecide({ "x-heytutor-trace-id": "fast-lane", "x-planner": "1", ...laneHeaders });
    assert.equal(result.model, FAST, "Fast turn planner and ProblemIR use the Fast router");
    // ((43 + 2,048) * $4.5, rounded to $0.00941, + 1,000 * $22.5) / 1M, twice.
    close(result.worstCaseUsd, 0.06382, "Fast planner lanes reserve at Fast rates");
  }
  assert.equal(fastDecide({ ...sceneHeaders, "x-diagram-example-picker": "1" }).model, FLASH, "Fast keeps the cheap picker");
  assert.equal(fastDecide({ "x-heytutor-trace-id": "fast-teaching" }).model, FAST);
  const fastAsStandard = { ...fastProfile, fastMode: false };
  for (const [local, mismatch] of [
    [fastProfile, serverConfig],
    [fastProfile, { ...serverConfig, fastModelProfile: null }],
    [fastProfile, { ...serverConfig, fastModelProfile: profile }],
    [fastProfile, { ...serverConfig, fastModelProfile: { ...fastProfile, rates: { ...fastProfile.rates, planner: profile.rates.planner } } }],
    [fastProfile, { ...fastServerConfig, modelProfile: fastProfile, fastModelProfile: profile }],
    [profile, { ...serverConfig, modelProfile: fastProfile, fastModelProfile: fastProfile }],
    [fastAsStandard, { ...serverConfig, modelProfile: fastAsStandard }],
  ] as const) {
    assert.throws(() => api.assertLabBudgetPreflight(local, mismatch),
      "M9: a Fast/standard identity mismatch or a missing Fast profile fails before dispatch");
  }

  const azureRates = { lane: "gpt-6.1-sol" as const, inputUsdPer1M: 2, outputUsdPer1M: 10, cachedInputUsdPer1M: 0.1 };
  const azureProfile: LabModelProfile = { ...profile, provider: "azure", deployment: "gpt-6-1-sol",
    models: { planner: "gpt-6-1-sol", problemIR: "gpt-6-1-sol", teaching: "gpt-6-1-sol", picker: "gpt-6-1-sol" },
    rates: { planner: azureRates, problemIR: azureRates, teaching: azureRates, picker: azureRates } };
  const azureEndpoint = { ...endpoint, provider: "azure" as const, deployment: azureProfile.deployment };
  const azureConfig = { ...serverConfig, provider: "azure", deployment: azureProfile.deployment, modelProfile: azureProfile };
  api.assertLabBudgetPreflight(azureProfile, azureConfig);
  const azure = api.labRequestBudgetDecision({ url: `${origin}/api/chat`, origin,
    headers: new Headers(sceneHeaders), init, endpoint: azureEndpoint, profile: azureProfile, serverConfig: azureConfig });
  assert.equal(azure.model, azureProfile.deployment);
  // Existing Azure translation adds 2,048 reasoning tokens to max_tokens=100.
  close(azure.worstCaseUsd, 0.051324, "Azure keeps deployment prices and translated completion headroom");
  const azureDirect = api.labRequestBudgetDecision({ url: azureEndpoint.url, origin,
    headers: new Headers(), init, endpoint: azureEndpoint, profile: azureProfile, serverConfig: azureConfig });
  close(azureDirect.worstCaseUsd, 0.025662, "Azure direct model comes from deployment, not an absent JSON model");
}

/** The agreed public seam must also be the one main actually reserves and settles. */
function verifyMainWiring(source: string): void {
  const tree = ts.createSourceFile("run.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const main = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "main");
  assert(main?.body, "runner main exists");
  const calls: ts.CallExpression[] = [];
  const declarations: ts.VariableDeclaration[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) calls.push(node);
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, walk);
  };
  walk(main.body);
  const namedCalls = (name: string) => calls.filter((node) => node.expression.getText(tree) === name);
  const upfront = namedCalls("assertLabBudgetPreflight");
  assert.equal(upfront.length, 1, "main calls the gated preflight before any round output");
  assert.deepEqual(upfront[0]!.arguments.map((arg) => arg.getText(tree)), ["modelProfile", "serverConfig"]);
  assert(upfront[0]!.pos < source.indexOf("const executionConfig"), "preflight runs before execution evidence is written");
  const decisions = namedCalls("labRequestBudgetDecision");
  assert.equal(decisions.length, 1, "main uses the gated request decision, not a duplicated pricing controller");
  const decision = decisions[0]!;
  const input = decision.arguments[0];
  assert(input && ts.isObjectLiteralExpression(input));
  const props = new Map(input.properties.map((prop) => {
    assert(ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop), "explicit frozen decision parameters");
    return [prop.name.getText(tree), ts.isPropertyAssignment(prop) ? prop.initializer.getText(tree) : prop.name.getText(tree)];
  }));
  for (const [key, value] of Object.entries({ url: "url", origin: "options.origin", headers: "headers", init: "init",
    endpoint: "endpoint", profile: "modelProfile", serverConfig: "serverConfig" })) {
    assert.equal(props.get(key), value, `main supplies actual captured ${key}`);
  }
  const declaration = declarations.find((node) => node.initializer === decision);
  assert(declaration, "main captures the gated request decision");
  const binding = ts.isObjectBindingPattern(declaration.name) ? declaration
    : declarations.find((node) => ts.isObjectBindingPattern(node.name) && node.initializer?.getText(tree) === declaration.name.getText(tree));
  assert(binding && ts.isObjectBindingPattern(binding.name), "main consumes the captured decision fields");
  const aliases = new Map(binding.name.elements.map((element) => [
    element.propertyName?.getText(tree) ?? element.name.getText(tree), element.name.getText(tree),
  ]));
  if (!aliases.has("chatRequest")) {
    const narrowed = declarations.find((node) => node.initializer?.getText(tree) === `${declaration.name.getText(tree)}.chatRequest && traceId`);
    assert(narrowed, "main derives chatRequest from the captured decision and actual traceId");
    aliases.set("chatRequest", narrowed.name.getText(tree));
  }
  for (const field of ["chatRequest", "plannerRequest", "directProviderRequest", "model", "maxAttempts", "worstCaseUsd"]) {
    assert(aliases.has(field), `main must consume gated ${field}`);
  }
  const shouldBudget = aliases.get("shouldBudget") ?? `${declaration.name.getText(tree)}.shouldBudget`;
  const reserve = namedCalls("reserveLabRequest")[0];
  assert(reserve);
  let reserveGuard: ts.Node | undefined = reserve.parent;
  while (reserveGuard && !(ts.isIfStatement(reserveGuard) && reserveGuard.expression.getText(tree) === shouldBudget)) {
    reserveGuard = reserveGuard.parent;
  }
  assert(reserveGuard, "reservation is controlled by decision.shouldBudget");
  const alias = (field: string) => aliases.get(field)!;
  const argumentsAt = (name: string, slots: Record<number, string>) => {
    const selected = namedCalls(name);
    assert.equal(selected.length, 1, `main has one ${name} boundary`);
    for (const [index, field] of Object.entries(slots)) {
      assert.equal(selected[0]!.arguments[Number(index)]?.getText(tree), alias(field), `${name} consumes decision.${field}`);
    }
  };
  argumentsAt("reserveLabRequest", { 1: "worstCaseUsd" });
  argumentsAt("usageTracker.recordRequest", { 1: "worstCaseUsd", 3: "maxAttempts" });
  argumentsAt("usageTracker.recordResponse", { 2: "worstCaseUsd", 3: "maxAttempts", 4: "model" });
  argumentsAt("usageTracker.recordStreamingResponse", { 2: "worstCaseUsd", 3: "maxAttempts", 4: "model" });
  argumentsAt("usageTracker.recordFailure", { 1: "model", 2: "worstCaseUsd" });
  // inputBound is consumed within the gated decision, never reinterpreted by main.
  const operation = source.slice(decision.end, source.indexOf("console.log(", decision.end));
  assert(!operation.includes("plannerRequestWorstCaseUsd("), "main cannot substitute another price/bound calculation after the decision");
}

function policySource(source: string): string {
  const tree = ts.createSourceFile("run.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return ["assertLabBudgetPreflight", "labRequestBudgetDecision"].map((name) => {
    const fn = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert(fn, `mutation harness locates the real exported ${name}`);
    return fn.getText(tree);
  }).join("\n");
}

/** Evaluate only the two real pure policies, with their real production dependencies. */
function evaluatePolicy(source: string): BudgetApi {
  const exports = { assertLabBudgetPreflight: runner.assertLabBudgetPreflight, labRequestBudgetDecision: runner.labRequestBudgetDecision };
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  runInNewContext(compiled.outputText, { exports, URL, expectedLabRequestModel, labModelProfilesMatch,
    directProviderRequestModel: runner.directProviderRequestModel, plannerRequestWorstCaseUsd: runner.plannerRequestWorstCaseUsd });
  assert.notEqual(exports.assertLabBudgetPreflight, runner.assertLabBudgetPreflight, "the actual isolated preflight was loaded");
  assert.notEqual(exports.labRequestBudgetDecision, runner.labRequestBudgetDecision, "the actual isolated decision was loaded");
  return exports;
}

function replaceNode(source: string, select: (node: ts.Node, tree: ts.SourceFile) => boolean, replacement: string): string {
  const tree = ts.createSourceFile("mutation.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const selected: ts.Node[] = [];
  const walk = (node: ts.Node): void => {
    if (select(node, tree)) selected.push(node);
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(tree, walk);
  assert.equal(selected.length, 1, "each in-memory mutation must change exactly one actual source node");
  const node = selected[0]!;
  return source.slice(0, node.getStart(tree)) + replacement + source.slice(node.end);
}

function replaceInitializer(source: string, name: string, replacement: string): string {
  return replaceNode(source, (node, tree) => ts.isVariableDeclaration(node.parent)
    && node.parent.initializer === node && node.parent.name.getText(tree) === name, replacement);
}

function verifyMutations(source: string): void {
  const pure = policySource(source);
  verifyDecision(evaluatePolicy(pure)); // Prove the isolated evaluator preserves the unmodified behavior first.
  const mutations = [
    { name: "M7 exact URL drops query requests", expected: /M7: query-string/,
      source: replaceInitializer(pure, "chatRequest", 'url === origin + "/api/chat" && Boolean(headers.get("x-heytutor-trace-id"))') },
    { name: "M8 input expansion not passed into the cost bound", expected: /M8\/M10: captured K3/,
      source: replaceNode(pure, (node) => ts.isCallExpression(node.parent)
        && ts.isIdentifier(node.parent.expression) && node.parent.expression.text === "plannerRequestWorstCaseUsd"
        && node.parent.arguments[3] === node, "undefined") },
    { name: "M9 profile/model/price preflight comparison removed", expected: /M9: server configuration/,
      source: replaceNode(pure, (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === "labModelProfilesMatch", "true") },
    { name: "M10 all lanes charged at the picker price", expected: /M8\/M10: captured K3/,
      source: replaceInitializer(pure, "lane", '"picker"') },
    { name: "M12 Fast compared against the standard server profile", expected: /M12: a Fast lab/,
      source: replaceInitializer(pure, "serverProfile", "serverConfig.modelProfile") },
    { name: "M11 teaching reserves only one attempt", expected: /M11: teaching can dispatch three/,
      source: replaceInitializer(pure, "maxAttempts", "chatRequest ? plannerRequest ? 2 : 1 : 1") },
  ];
  for (const mutation of mutations) {
    const api = evaluatePolicy(mutation.source);
    assert.throws(() => verifyDecision(api), (error: unknown) => error instanceof assert.AssertionError && mutation.expected.test(error.message),
      `${mutation.name} must be RED for its behavioral safety assertion, not a harness error`);
    console.log(`mutation RED: ${mutation.name}`);
  }
  const wiringMutations = [
    { name: "main preflight removed", expected: /main calls the gated preflight/,
      source: replaceNode(source, (node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
        && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "assertLabBudgetPreflight"
        && ts.isFunctionDeclaration(node.parent.parent) && node.parent.parent.name?.text === "main", "") },
    { name: "main frozen profile substituted", expected: /main supplies actual captured profile/,
      source: replaceNode(source, (node) => ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "profile"
        && ts.isObjectLiteralExpression(node.parent) && ts.isCallExpression(node.parent.parent)
        && ts.isIdentifier(node.parent.parent.expression) && node.parent.parent.expression.text === "labRequestBudgetDecision",
      "profile: serverConfig.modelProfile") },
    { name: "main reserve ceiling substituted", expected: /reserveLabRequest consumes decision.worstCaseUsd/,
      source: replaceNode(source, (node) => ts.isCallExpression(node.parent) && ts.isIdentifier(node.parent.expression)
        && node.parent.expression.text === "reserveLabRequest" && node.parent.arguments[1] === node, "0.001") },
    { name: "main retry accounting substituted", expected: /recordRequest consumes decision.maxAttempts/,
      source: replaceNode(source, (node, tree) => ts.isCallExpression(node.parent)
        && node.parent.expression.getText(tree) === "usageTracker.recordRequest" && node.parent.arguments[3] === node, "1") },
    { name: "main settlement model substituted", expected: /recordResponse consumes decision.model/,
      source: replaceNode(source, (node, tree) => ts.isCallExpression(node.parent)
        && node.parent.expression.getText(tree) === "usageTracker.recordResponse" && node.parent.arguments[4] === node, "modelProfile.models.picker") },
  ];
  for (const mutation of wiringMutations) {
    assert.throws(() => verifyMainWiring(mutation.source), (error: unknown) => error instanceof assert.AssertionError && mutation.expected.test(error.message),
      `${mutation.name} must be RED at the wiring assertion`);
    console.log(`wiring mutation RED: ${mutation.name}`);
  }
}

const source = readFileSync(new URL("../lecture-lab/run.ts", import.meta.url), "utf8");
verifyDecision(runner);
verifyMainWiring(source);
verifyMutations(source);

console.log("lecture-lab request budget gate passed (offline)");
