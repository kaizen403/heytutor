import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as engine from "@heytutor/scene-engine";
import { planProblemAuthorityV1 } from "@heytutor/tutor-core";
import { buildVerifiedDiagramPresentation } from "../../../../apps/tutor/features/tutor-session/lib/scene/verifiedScenePresentation";
import { canonicalizeTurnSceneMetadata } from "../../../../apps/tutor/lib/scene/turnScenePersistence";
import { liveSceneSaveFailure } from "../../../../apps/tutor/lib/scene/sceneSaveAdmission";
import { sourceCheckedStoredTurn } from "../../../../apps/tutor/lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../../../apps/tutor/features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type { StoredTurn } from "../../../../apps/tutor/lib/boards/boardsClient";

type Input = { question: string; plan: engine.TurnPlanV3; problemIR: engine.ProblemIR };
type Entry = string | number;
type Fresh = { id: string; leftName: string; rightName: string; left: Entry[][]; right: Entry[][]; products: Entry[][][] };
const rootArgument = process.argv.find(arg => arg.startsWith("--engine-root="))?.slice("--engine-root=".length);
const engineRoot = rootArgument ? pathToFileURL(`${rootArgument}/`) : new URL("../../", import.meta.url);
const actual = JSON.parse(readFileSync(new URL("fixtures/matrix-products-live-20261006/actual-runtime.json", engineRoot), "utf8")) as Input;
const fixtures = JSON.parse(readFileSync(new URL("scripts/verify/fixtures/w2-matrix-prose-fix-20261006.json", engineRoot), "utf8")) as {
  falseCue: string; falseRole: string; mutations: string[]; fresh: Fresh[];
};
const measure = process.argv.includes("--measure");
const receipt = process.argv.find(arg => arg.startsWith("--receipt="))?.slice("--receipt=".length);
let checks = 0;
const failures: string[] = [];
function equal(value: unknown, expected: unknown, label: string): void {
  checks++;
  try { assert.deepEqual(value, expected, label); }
  catch (error) { if (!measure) throw error; failures.push(label); }
}
const roundtrip = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const literal = (entries: Entry[][]): string => JSON.stringify(entries).replace(/"/g, "");
const number = (entry: Entry): number => typeof entry === "number" ? entry : entry.split("/").map(Number).reduce((n, d) => n / d);
function freshInput(fixture: Fresh): Input {
  const names = [fixture.leftName, fixture.rightName];
  const quotes = names.map((name, i) => `${name}=${literal(i === 0 ? fixture.left : fixture.right)}`);
  const products = [names.join(""), [...names].reverse().join("")];
  const question = `Let ${quotes[0]} and ${quotes[1]}. Find ${products[0]} and ${products[1]}.`;
  const facts: engine.ProblemIR["facts"] = [...names, ...products].map((name, i) => {
    const quote = quotes[i] ?? (i === 2 ? `Find ${name}` : name);
    const start = question.indexOf(quote);
    return { id: `fact_${name}`, kind: i < 2 ? "given" : "requested", statement: i < 2 ? `Matrix ${name} is ${literal(i === 0 ? fixture.left : fixture.right)}` : `Find product ${name}`, evidence: { source: "question", start, end: start + quote.length, quote } };
  });
  const problemIR: engine.ProblemIR = {
    schemaVersion: "problem-ir/v1", id: fixture.id.replaceAll("-", "_"), question, facts,
    entities: names.map(name => ({ id: `entity_${name}`, kind: "other", label: name, evidenceFactIds: [`fact_${name}`] })),
    expressions: [], constraints: [], representationIntents: [], solveRequests: [],
  };
  const plan: engine.TurnPlanV3 = {
    schemaVersion: "turn-plan/v3", question,
    givens: names.map((name, i) => ({ id: name, symbol: name, value: 0, provenance: "given", sourceText: quotes[i] })),
    unknowns: products.map(name => ({ id: name, symbol: name })),
    derived: [], qualitativeClaims: [], lawIds: ["matrix-multiplication-definition"],
    assumptions: ["Standard row-by-column matrix multiplication over the real numbers"], visualRequirement: "optional",
  };
  // Hand-calculated fixture results supply the expected Plan, never the engine.
  products.forEach((name, productIndex) => fixture.products[productIndex]!.forEach((row, i) => row.forEach((entry, j) => {
    const left = productIndex === 0 ? fixture.left : fixture.right;
    const right = productIndex === 0 ? fixture.right : fixture.left;
    const factor = (value: Entry): string => String(value).startsWith("-") || String(value).includes("/") ? `(${value})` : String(value);
    const sourceText = left[i]!.map((value, k) => `${factor(value)}*${factor(right[k]![j]!)}`).join("+") + `=${entry}`;
    plan.derived.push({ id: `${name}${i + 1}${j + 1}`, symbol: `(${name})${i + 1}${j + 1}`, value: number(entry), sourceText, provenance: "derived", dependsOn: names });
  })));
  return { question, plan, problemIR };
}

function mutate(document: engine.SceneDocument, variant: string): void {
  const first = document.revealGroups[0]!, second = document.revealGroups[1]!;
  switch (variant) {
    case "falseCue": first.narrationCue = fixtures.falseCue; break;
    case "falseRole": document.entities[0]!.role = fixtures.falseRole; break;
    case "productRole": document.entities.at(-1)!.role = "requested AB equals BA"; break;
    case "missingRole": Reflect.deleteProperty(document.entities[0]!, "role"); break;
    case "roleMetadata": document.entities[0]!.semantic = { role: fixtures.falseRole }; break;
    case "missingCue": Reflect.deleteProperty(first, "narrationCue"); break;
    case "productCue": document.revealGroups.at(-1)!.narrationCue = "AB equals BA. Multiplication is commutative."; break;
    case "swappedCues": [first.narrationCue, second.narrationCue] = [second.narrationCue, first.narrationCue]; break;
    case "reverseReveal": document.revealGroups.reverse(); document.revealGroups.forEach(group => { group.dependsOn = []; }); break;
    case "reverseRevealWithDependencies": document.revealGroups.reverse(); break;
    case "missingDependency": second.dependsOn = []; break;
    case "extraDependency": first.dependsOn = [second.id]; break;
    case "duplicateDependency": second.dependsOn.push(first.id); break;
    case "cycleDependency": second.dependsOn = [second.id]; break;
    case "wrongMember": first.entityIds = [...second.entityIds]; break;
    case "extraMember": first.entityIds.push(...second.entityIds); break;
    case "duplicateMember": first.entityIds.push(...first.entityIds); break;
    case "missingGroup": document.revealGroups.pop(); break;
    case "extraGroup": document.revealGroups.push({ ...roundtrip(first), id: "extra", dependsOn: [] }); break;
    case "duplicateGroupId": second.id = first.id; break;
    case "extraRequired": document.requiredEntityIds.push("extra"); break;
    case "duplicateRequired": document.requiredEntityIds.push(document.requiredEntityIds[0]!); break;
    case "missingRequired": document.requiredEntityIds.pop(); break;
    default: throw new Error(`Unknown fixture mutation: ${variant}`);
  }
}
function rename(document: engine.SceneDocument): void {
  const ids = new Map(document.entities.map(entity => [entity.id, `owned_${entity.id}`]));
  const groups = new Map(document.revealGroups.map(group => [group.id, `renamed_${group.id}`]));
  document.entities.forEach(entity => { entity.id = ids.get(entity.id)!; });
  document.constructions.forEach(construction => {
    construction.id = `renamed_${construction.id}`;
    construction.outputs = construction.outputs.map(id => ids.get(id)!);
    for (const key of ["left", "right", "matrix"]) {
      const id = construction.inputs[key];
      if (typeof id === "string" && ids.has(id)) construction.inputs[key] = ids.get(id)!;
    }
  });
  document.requiredEntityIds = document.requiredEntityIds.map(id => ids.get(id)!);
  document.revealGroups.forEach(group => {
    group.id = groups.get(group.id)!;
    group.entityIds = group.entityIds.map(id => ids.get(id)!);
    group.dependsOn = group.dependsOn.map(id => groups.get(id)!);
  });
  document.entities.reverse(); // Storage order is not reveal order.
}

const observations: object[] = [];
for (const [caseName, input] of [["actual", actual], ...fixtures.fresh.map(fixture => [fixture.id, freshInput(fixture)])] as Array<[string, Input]>) {
  const selectedCase = process.argv.find(arg => arg.startsWith("--case="))?.slice("--case=".length);
  if (selectedCase && selectedCase !== caseName) continue;
  const before = JSON.stringify(input);
  const prepared = engine.prepareMatrixProductSourceAuthority(input.question, input.plan, input.problemIR);
  assert(prepared, `${caseName}: complete original caller preparation: ${JSON.stringify({
    ir: engine.validateProblemIR(input.problemIR, input.question),
    plan: engine.validateTurnPlanV3(input.plan, input.question).issues,
    corrected: engine.correctMatrixProductSourcePlan(input.question, input.plan) !== null,
  })}`);
  equal(prepared.problemIR === input.problemIR, true, `${caseName}: same complete original IR reference`);
  equal(prepared.correction.audit.withdrawn, input.plan.givens, `${caseName}: unchanged original withdrawal audit`);
  equal(engine.correctMatrixProductSourcePlan(input.question, prepared.plan)?.plan, prepared.plan, `${caseName}: correction idempotent`);
  const api = await planProblemAuthorityV1(input.question, prepared.plan, {
    proxyUrl: "https://offline.invalid", timeoutMs: 3000,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(input.problemIR) } }] })),
  });
  assert(api && !("status" in api), `${caseName}: normal original-IR API`);
  equal(api.problemIR, input.problemIR, `${caseName}: API preserves full caller channels`);
  equal([api.solverResult.status, api.solverResult.values.length, api.audit.status, api.projection], ["solved", 0, "not_applicable", null], `${caseName}: no fabricated numeric graph`);
  const context = { question: input.question, problemIR: input.problemIR, turnPlan: prepared.plan };
  const controlCompile = engine.compileSceneDocument(prepared.document, { sourceAuthority: context });
  assert(controlCompile.ok && controlCompile.renderScene);
  const control = buildVerifiedDiagramPresentation(prepared.document, controlCompile.renderScene);
  const variants = caseName === "actual" ? ["control", "renamed", ...fixtures.mutations] : ["control", "renamed", "falseCue", "falseRole", "reverseReveal", "missingDependency"];
  for (const variant of variants) {
    const document = roundtrip(prepared.document);
    if (variant === "renamed") rename(document);
    else if (variant !== "control") mutate(document, variant);
    const expected = ["control", "renamed"].includes(variant);
    const label = `${caseName}/${variant}`;
    const strict = engine.matrixProductSourceDocumentIssues(document, input.question, input.problemIR, prepared.plan);
    const structural = engine.validateSceneDocument(document, { sourceAuthority: context });
    const compiled = engine.compileSceneDocument(document, { sourceAuthority: context });
    const central = engine.validateSceneSourceAuthority(document, input.question, input.problemIR, prepared.plan);
    const live = liveSceneSaveFailure({ document, ...context, tier: "qualitative_verified" });
    const artifacts: engine.SceneArtifactsV3 = {
      schemaVersion: "scene-artifacts/v3", turnPlan: prepared.plan, problemIR: input.problemIR,
      solverResult: api.solverResult, solverAuthority: api.audit,
      sourcePlanEvidence: JSON.stringify({ forgedProsePermission: true, original: prepared.correction }),
      representationTier: "qualitative_verified", nonMetric: true, candidates: [], diagramResultStatus: "ready",
    };
    const turn: StoredTurn = {
      id: "prose-offline", question: input.question, rawResponse: "", orderIndex: 0, speedMultiplier: 2, traceId: null, segments: [],
      sceneDocument: document, sceneArtifacts: artifacts, visualStatus: "validated", sceneEngineVersion: null, validationReport: null,
    };
    const saved = await canonicalizeTurnSceneMetadata({ ...turn, segments: [] });
    const read = sourceCheckedStoredTurn(roundtrip(turn));
    const restored = restoreVerifiedPresentationFromTurn(roundtrip(turn));
    const canonicalRestored = saved.ok ? restoreVerifiedPresentationFromTurn(roundtrip({ ...turn, ...saved.value })) : null;
    const shown = compiled.ok && compiled.renderScene ? buildVerifiedDiagramPresentation(document, compiled.renderScene) : null;
    observations.push({ caseName, variant, strict, structural: structural.report.valid, compiled: compiled.ok, central, live, saved: saved.ok, read: read.visualStatus, intro: shown?.introSegments.map(segment => segment.narration) ?? null, restoredIntro: restored?.introSegments.map(segment => segment.narration) ?? null, canonicalRestoredIntro: canonicalRestored?.introSegments.map(segment => segment.narration) ?? null });
    equal(strict.length === 0, expected, `${label}: strict source document`);
    equal(structural.report.valid, expected, `${label}: normal structural context`);
    equal(compiled.ok, expected, `${label}: normal compile`);
    equal(central.length === 0, expected, `${label}: central source authority`);
    equal(live === null, expected, `${label}: live/save admission`);
    equal(saved.ok, expected, `${label}: canonical persistence`);
    equal(read.visualStatus === "validated", expected, `${label}: raw stored read`);
    equal(restored !== null, expected, `${label}: serialized restore`);
    if (expected) {
      equal(restored?.introSegments.map(segment => segment.narration), control.introSegments.map(segment => segment.narration), `${label}: actual restored intro truthful and ordered`);
      equal(canonicalRestored?.introSegments.map(segment => segment.narration), control.introSegments.map(segment => segment.narration), `${label}: canonical saved intro roundtrip`);
      if (saved.ok) {
        equal(saved.value.sceneArtifacts?.problemIR, input.problemIR, `${label}: saved complete original IR`);
        equal(saved.value.sceneArtifacts?.turnPlan, prepared.plan, `${label}: saved complete corrected original Plan`);
        equal(saved.value.segments.map(segment => segment.narration), control.introSegments.map(segment => segment.narration), `${label}: server-generated fixed intro`);
      }
    } else {
      equal(compiled.renderScene, null, `${label}: no partial ink`);
      equal(shown, null, `${label}: declined before fixed intro`);
      equal(restored?.introSegments ?? null, null, `${label}: no restored false intro`);
      equal(canonicalRestored, null, `${label}: no canonically restored false intro`);
    }
  }
  equal(JSON.stringify(input), before, `${caseName}: original IR and Plan immutable`);
}
if (receipt) writeFileSync(receipt, JSON.stringify({ checks, failures, observations }, null, 2));
console.log(JSON.stringify({ mode: measure ? "baseline measurement" : "correctness", checks, failures }));
if (failures.length) process.exitCode = 1;
