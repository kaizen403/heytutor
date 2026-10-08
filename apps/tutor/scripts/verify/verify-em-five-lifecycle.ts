import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  LocalDeterministicSolverProvider,
  SCENE_ARTIFACTS_V3_VERSION,
  compileSceneDocument,
  consumePhysicalModel,
  modelAdmissionCatalog,
  modelAdmissionEvidenceText,
  modelAdmissionRequiredAssumptions,
  modelAdmissionRole,
  standardCases,
  synthesizeFamilyScene,
  validateProblemIR,
  validateTurnPlanV3,
  verifyTurnPlanAgainstSolver,
  type ExpressionNodeIR,
  type ProblemIR,
  type QuestionSourceEvidence,
  type SceneArtifactsV3,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import {
  getSegmentCommands,
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
} from "@heytutor/drawing";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type { StoredSegment, StoredTurn } from "../../lib/boards/boardsClient";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSegment } from "../../lib/scene/turnScenePersistence";

const admissionByName = new Map(modelAdmissionCatalog().map((entry) => [entry.name, entry]));
const solver = new LocalDeterministicSolverProvider();

function fixture(modelName: string, inputs: Readonly<Record<string, number>>, output?: [string, number]) {
  const admission = admissionByName.get(modelName);
  assert(admission, `${modelName}: missing registered admission`);
  const assumptions = modelAdmissionRequiredAssumptions(modelName, inputs);
  const inputQuotes = Object.keys(inputs).map((key) => {
    const role = modelAdmissionRole(modelName, key, inputs);
    assert(role, `${modelName}.${key}: missing source role`);
    const quote = modelAdmissionEvidenceText(modelName, key, inputs[key]!, inputs);
    assert(quote, `${modelName}.${key}: missing source evidence text`);
    return { key, role, quote };
  });
  const asked = output ? `Find ${output[0]}.` : "Show the requested representation.";
  const assumptionQuotes = assumptions.map((phrase) => `The model is ${phrase}.`);
  const question = [...assumptionQuotes, ...inputQuotes.map((item) => item.quote), asked].join(" ");
  const evidence = (quote: string): QuestionSourceEvidence => {
    const start = question.indexOf(quote);
    assert(start >= 0, `${modelName}: missing exact source quote`);
    return { source: "question", start, end: start + quote.length, quote };
  };
  const facts = [
    ...assumptionQuotes.map((quote, index) => ({ id: `assumption_${index}`, kind: "assumption" as const, statement: quote, evidence: evidence(quote) })),
    ...inputQuotes.map(({ key, quote }) => ({ id: `fact_${key}`, kind: "given" as const, statement: quote, evidence: evidence(quote) })),
    { id: "asked", kind: "requested" as const, statement: asked, evidence: evidence(asked) },
  ];
  const expressions = inputQuotes.map(({ key }) => ({
    id: `expr_${key}`,
    valueType: "scalar" as const,
    root: { kind: "number", value: inputs[key] } as ExpressionNodeIR,
    evidenceFactIds: [`fact_${key}`],
  }));
  const request = {
    id: "explicitModel",
    kind: "explicit_physical_model" as const,
    model: modelName,
    bindings: inputQuotes.map(({ key, role }) => ({
      key,
      role: role.role,
      unit: role.unit,
      expressionId: `expr_${key}`,
      evidenceFactId: `fact_${key}`,
    })),
    evidenceFactIds: ["asked"],
    ...(output ? { resultBinding: { turnPlanQuantityId: "requestedResult", symbol: output[0], unit: "1", evidenceFactIds: ["asked"] } } : {}),
  };
  const rawProblem = {
    schemaVersion: "problem-ir/v1",
    id: `lifecycle_${modelName.replace(/[^A-Za-z0-9_]/g, "_")}`,
    question,
    facts,
    entities: [],
    expressions,
    constraints: [],
    representationIntents: [],
    solveRequests: [request],
  };
  const checked = validateProblemIR(rawProblem, question);
  assert(checked.problem, `${modelName}: source fixture rejected: ${checked.issues.map((issue) => issue.message).join("; ")}`);
  const planRaw: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3",
    question,
    givens: inputQuotes.map(({ key, quote, role }) => ({
      id: `input_${key}`,
      symbol: key,
      value: inputs[key]!,
      unit: role.unit,
      provenance: "given" as const,
      sourceText: quote,
    })),
    unknowns: output ? [{ id: "requestedResult", symbol: output[0], unit: "1" }] : [],
    derived: output ? [{ id: "requestedResult", symbol: output[0], value: output[1], unit: "1", provenance: "derived" }] : [],
    qualitativeClaims: [],
    lawIds: [],
    assumptions: [],
    visualRequirement: "required",
  };
  const checkedPlan = validateTurnPlanV3(planRaw, question);
  assert(checkedPlan.plan, `${modelName}: lifecycle plan invalid: ${checkedPlan.issues.map((issue) => issue.message).join("; ")}`);
  return { question, problem: checked.problem, plan: checkedPlan.plan };
}

function trustedIntro(presentation: ReturnType<typeof buildVerifiedDiagramPresentation>): SubmittedTurnSegment[] {
  return presentation.introSegments.map((segment, orderIndex) => ({
    orderIndex,
    narration: segment.narration,
    spokenText: segment.narration,
    command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }),
  }));
}

function solidCommands<T extends { visualStyle?: { fillRole?: string } }>(commands: readonly T[]): T[] {
  return commands.filter((command) => command.visualStyle?.fillRole === "solid");
}

async function main(): Promise<void> {
const results: Array<{ model: string; variant: string; tier: string; commands: number; anchors: number }> = [];
let checks = 0;
for (const item of standardCases()) {
  for (const [variant, inputs] of [["ordinary", item.ordinary], ["altered", item.altered]] as const) {
    const raw = consumePhysicalModel(item.modelName, inputs);
    assert(raw?.status === "scene", `${item.modelName}/${variant}: direct scene missing`);
    const certified = raw.document.source.certified;
    assert(certified && typeof certified === "object" && !Array.isArray(certified));
    const output = Object.entries(certified).find((entry): entry is [string, number] => typeof entry[1] === "number");
    const { question, problem, plan } = fixture(item.modelName, inputs, output);
    const selected = synthesizeFamilyScene({ question, problemIR: problem, turnPlan: plan });
    assert(selected, `${item.modelName}/${variant}: admitted lifecycle scene missing`);
    const compiled = compileSceneDocument(selected.document, { sourceAuthority: { question, problemIR: problem, turnPlan: plan } });
    assert(compiled.ok && compiled.renderScene, `${item.modelName}/${variant}: lifecycle scene did not compile`);
    const presentation = buildVerifiedDiagramPresentation(selected.document, compiled.renderScene);
    const solved = await solver.solve(problem);
    const audit = verifyTurnPlanAgainstSolver(problem, solved, plan, question);
    assert.equal(audit.status, "verified", `${item.modelName}/${variant}: solver audit ${audit.status}`);
    const artifacts: SceneArtifactsV3 = {
      schemaVersion: SCENE_ARTIFACTS_V3_VERSION,
      turnPlan: plan,
      problemIR: problem,
      solverResult: solved,
      solverAuthority: audit,
      representationTier: selected.tier,
      nonMetric: selected.nonMetric,
      candidates: [],
      selectedCandidateId: null,
      selectionReason: selected.reason,
      proofObligations: [],
      visualReview: null,
      diagramResultStatus: "ready",
    };
    if (selected.document.visualDecision.mode === "text_only") {
      const textOnly = await canonicalizeTurnSceneMetadata({
        question,
        sceneDocument: null,
        sceneArtifacts: artifacts,
        visualStatus: "text_only",
        segments: [],
      });
      assert(textOnly.ok, `${item.modelName}/${variant}: honest text-only persistence failed`);
      assert.equal(textOnly.value.visualStatus, "text_only", `${item.modelName}/${variant}: text-only status was promoted`);
      assert.equal(textOnly.value.sceneDocument, null, `${item.modelName}/${variant}: text-only row retained a scene`);
      const forgedInk = await canonicalizeTurnSceneMetadata({
        question,
        sceneDocument: null,
        sceneArtifacts: artifacts,
        visualStatus: "text_only",
        segments: [{
          orderIndex: 0,
          narration: "forged diagram",
          spokenText: "forged diagram",
          command: serializeSegmentCommands([{
            type: "DRAW_LINE", params: [400, 0, 1160, 700], charPosition: 0, narrationBefore: "",
          }], { trustedDiagramGeometry: true }),
        }],
      });
      assert.equal(forgedInk.ok, false, `${item.modelName}/${variant}: text-only row accepted trusted diagram ink`);
      results.push({ model: item.modelName, variant, tier: "text_only", commands: 0, anchors: 0 });
      checks += 4;
      continue;
    }
    let segments = trustedIntro(presentation);
    if (item.modelName === "emw.triad" && variant === "ordinary" && segments.length > 0) {
      const forgedRegion: DrawCommand = {
        type: "DRAW_CIRCLE",
        params: [800, 350, 90],
        charPosition: 0,
        narrationBefore: "forged client region",
        visualStyle: { fillRole: "region" },
      };
      segments = [{ ...segments[0]!, command: serializeSegmentCommands([forgedRegion], { trustedDiagramGeometry: true }) }, ...segments.slice(1)];
    }
    const saved = await canonicalizeTurnSceneMetadata({
      question,
      sceneDocument: selected.document,
      sceneArtifacts: artifacts,
      visualStatus: "validated",
      segments,
    });
    assert(saved.ok, `${item.modelName}/${variant}: persistence failed: ${saved.ok ? "" : saved.error}`);
    const trusted = saved.value.segments.filter((segment) => isStoredCommandTrustedGeometry(segment.command));
    assert(trusted.length > 0, `${item.modelName}/${variant}: server intro was not persisted as trusted geometry`);
    assert(trusted.every((segment) => parseStoredSegmentCommands(segment.command).length > 0), `${item.modelName}/${variant}: trusted command envelope did not survive parsing`);

    const turn: StoredTurn = {
      id: `${item.modelName}-${variant}`,
      question,
      rawResponse: "",
      orderIndex: 0,
      speedMultiplier: 1,
      traceId: null,
      segments: saved.value.segments.map((segment, index): StoredSegment => ({
        id: `${item.modelName}-${variant}-${index}`,
        orderIndex: segment.orderIndex,
        narration: segment.narration,
        spokenText: segment.spokenText,
        command: segment.command as StoredSegment["command"],
        audioUrl: null,
        durationMs: segment.durationMs ?? null,
        timings: (segment.timings ?? null) as StoredSegment["timings"],
      })),
      sceneDocument: saved.value.sceneDocument,
      sceneArtifacts: saved.value.sceneArtifacts,
      visualStatus: saved.value.visualStatus,
      sceneEngineVersion: saved.value.sceneEngineVersion,
      validationReport: saved.value.validationReport,
    };
    const checkedTurn = sourceCheckedStoredTurn(turn);
    assert.equal(checkedTurn.visualStatus, "validated", `${item.modelName}/${variant}: stored source recheck withdrew the scene`);
    const replay = restoreVerifiedPresentationFromTurn(checkedTurn);
    assert(replay, `${item.modelName}/${variant}: stored scene did not restore`);
    assert.deepEqual(
      replay.diagram.anchors.map((anchor) => anchor.id).sort(),
      presentation.diagram.anchors.map((anchor) => anchor.id).sort(),
      `${item.modelName}/${variant}: replay anchors diverged`,
    );

    if (item.modelName === "emw.triad" && variant === "ordinary") {
      assert(solidCommands(presentation.diagram.commands).length > 0, "emw.triad live presentation lost its opaque magnetic dot");
      assert(solidCommands(replay.diagram.commands).length > 0, "emw.triad replay lost its opaque magnetic dot");
      const storedCommands = saved.value.segments.flatMap((segment) => parseStoredSegmentCommands(segment.command));
      assert(storedCommands.some((command) => command.visualStyle?.fillRole === "solid"), "emw.triad persisted intro lost solid fill semantics");
      assert(!storedCommands.some((command) => command.visualStyle?.fillRole === "region"), "forged client region styling survived server intro reconstruction");
    }

    const forgedDocument = structuredClone(selected.document);
    forgedDocument.source.question = `${question} forged`;
    const forgedSave = await canonicalizeTurnSceneMetadata({
      question,
      sceneDocument: forgedDocument,
      sceneArtifacts: artifacts,
      visualStatus: "validated",
      segments: [],
    });
    assert.equal(forgedSave.ok, false, `${item.modelName}/${variant}: forged document source survived persistence`);

    const staleProblem = structuredClone(problem) as ProblemIR;
    const first = staleProblem.expressions[0]?.root;
    assert(first?.kind === "number", `${item.modelName}/${variant}: source fixture has no numeric input`);
    first.value += first.value === 0 ? 1 : Math.max(1, Math.abs(first.value) * 0.25);
    const staleArtifacts = { ...artifacts, problemIR: staleProblem };
    const staleSave = await canonicalizeTurnSceneMetadata({
      question,
      sceneDocument: selected.document,
      sceneArtifacts: staleArtifacts,
      visualStatus: "validated",
      segments: [],
    });
    assert.equal(staleSave.ok, false, `${item.modelName}/${variant}: stale source value survived persistence`);

    results.push({
      model: item.modelName,
      variant,
      tier: selected.tier,
      commands: presentation.diagram.commands.length,
      anchors: presentation.diagram.anchors.length,
    });
    checks += 10;
  }
}

const report = {
  models: standardCases().length,
  variants: results.length,
  checks,
  chapters: Object.fromEntries([...new Set(standardCases().map((item) => item.chapter))].map((chapter) => [chapter, results.filter((row) => standardCases().find((item) => item.modelName === row.model)?.chapter === chapter).length])),
  results,
};
if (process.env.EM_FIVE_LIFECYCLE_REPORT) writeFileSync(process.env.EM_FIVE_LIFECYCLE_REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`em-five lifecycle PASS (${report.models} models, ${report.variants} variants, ${checks} boundary checks)`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
