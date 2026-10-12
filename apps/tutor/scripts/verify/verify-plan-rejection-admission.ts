/** Authored source-member and instrument boundary fixtures, including the real save canonicalizer. */
import assert from "node:assert/strict";
import {
  compileSceneDocument,
  validateTurnPlanV3,
  type SceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { parseTurnPlanV3Content } from "@heytutor/tutor-core";
import { validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

const instrumentQuestion =
  "Convert a galvanometer of resistance 8 Ω and full-scale current 1.5 mA into a 3 V voltmeter. Find the series resistance.";
const instrument: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: instrumentQuestion,
  visualRequirement: "required",
  givens: [
    {
      id: "coil_current",
      symbol: "I_g",
      value: 1.5,
      unit: "mA",
      provenance: "given",
    },
    {
      id: "coil_resistance",
      symbol: "R_g",
      value: 8,
      unit: "Ω",
      provenance: "given",
    },
    { id: "range", symbol: "V", value: 3, unit: "V", provenance: "given" },
  ],
  unknowns: [{ id: "series", symbol: "R_s", unit: "Ω" }],
  derived: [
    {
      id: "total",
      symbol: "R_total",
      value: 6,
      unit: "Ω",
      provenance: "derived",
    },
    {
      id: "series",
      symbol: "R_s",
      value: -2,
      unit: "Ω",
      provenance: "derived",
    },
  ],
  qualitativeClaims: [],
  lawIds: ["galvanometer_to_voltmeter"],
  assumptions: [],
};
async function main() {
  assert(
    !validateTurnPlanV3(instrument, instrumentQuestion).valid,
    "a declared conversion law must not admit the unconverted 6/-2 outputs",
  );
  assert.equal(
    parseTurnPlanV3Content(JSON.stringify(instrument), instrumentQuestion),
    null,
    "the same wrong values are rejected at the real core admission boundary without a solver",
  );
  const correct = structuredClone(instrument);
  correct.derived[0]!.value = 2000;
  correct.derived[1]!.value = 1992;
  assert(validateTurnPlanV3(correct, instrumentQuestion).valid);
  assert(parseTurnPlanV3Content(JSON.stringify(correct), instrumentQuestion));
  const seriesOnly = structuredClone(correct);
  seriesOnly.derived.shift();
  assert(
    validateTurnPlanV3(seriesOnly, instrumentQuestion).valid,
    "an unrequested intermediate total is optional; the requested series answer is independently checked",
  );
  for (const symbol of [
    "R_total",
    "Rₜₒₜₐₗ",
    "R_{total}",
    "\\mathrm{R}_{total}",
  ]) {
    const missingRequested = structuredClone(seriesOnly);
    missingRequested.unknowns.push({ id: "total_answer", symbol, unit: "Ω" });
    missingRequested.derived.push({
      id: "total_answer",
      symbol: "X",
      value: 6,
      unit: "Ω",
      provenance: "derived",
    });
    assert(
      !validateTurnPlanV3(missingRequested, instrumentQuestion).valid,
      "a requested total must use the audit's exact role recognition, not disappear through a different Unicode key normalizer",
    );
  }
  const unsupported = structuredClone(correct);
  unsupported.givens[0]!.unit = "MA";
  assert(
    !validateTurnPlanV3(unsupported, instrumentQuestion).valid,
    "an unsupported unit on an active law fails closed, never guessed as mA",
  );

  function instrumentScene(
    plan: TurnPlanV3,
    tier: "exact_verified" | "qualitative_verified" | "question_representation",
  ): SceneDocument {
    const answer = plan.derived.find((quantity) => quantity.symbol === "R_s")!;
    return {
      schemaVersion: "scene-document/v2",
      visualDecision: {
        mode: "scene",
        reason: "authored instrument admission fixture",
      },
      source: {
        question: instrumentQuestion,
        representationTier: tier,
        nonMetric: tier !== "exact_verified",
      },
      quantities: [{ id: answer.id, value: answer.value, unit: answer.unit }],
      entities: [
        {
          id: "series_body",
          kind: "point",
          role: "series resistance",
          label: `R_s = ${answer.value} Ω`,
        },
      ],
      constructions: [
        {
          id: "series_mark",
          operator: "point",
          inputs: { x: 0, y: 0 },
          outputs: ["series_body"],
        },
      ],
      relations: [],
      assertions: [],
      annotations: [],
      requiredEntityIds: ["series_body"],
      revealGroups: [
        {
          id: "series_reveal",
          entityIds: ["series_body"],
          dependsOn: [],
          narrationCue: "series resistance",
        },
      ],
      teachingTimeline: [],
    };
  }
  for (const tier of [
    "qualitative_verified",
    "question_representation",
    "exact_verified",
  ] as const) {
    const doc = instrumentScene(instrument, tier);
    // The qualitative point fixture is not an exact metric construction.
    // Both nonmetric paths must reach authority with a compiling document;
    // the exact path independently asserts the supplied-plan rejection leaf.
    if (tier !== "exact_verified") {
      const compiled = compileSceneDocument(doc);
      assert(
        compiled.ok,
        `the nonmetric negative must reach numeric authority, not fail a malformed document: ${JSON.stringify(compiled.report.issues)}`,
      );
    }
    assert(
      !validateProductionSceneCandidate({
        candidate: doc as unknown as Record<string, unknown>,
        question: instrumentQuestion,
        turnPlan: instrument,
      }).valid,
      `${tier}: a wrong active plan must not serve as its own candidate authority`,
    );
    assert(
      liveSceneSaveFailure({
        document: doc,
        question: instrumentQuestion,
        turnPlan: instrument,
        tier,
      }),
      `${tier}: live admission refuses the same contradiction before drawing`,
    );
    const saved = await canonicalizeTurnSceneMetadata({
      question: instrumentQuestion,
      sceneDocument: doc,
      visualStatus: "validated",
      sceneArtifacts: {
        schemaVersion: "scene-artifacts/v3",
        representationTier: tier,
        nonMetric: tier !== "exact_verified",
        diagramResultStatus: "ready",
        turnPlan: instrument,
      },
      segments: [],
    });
    assert(
      !saved.ok && saved.code === "scene_turn_plan_invalid",
      `${tier}: the server cannot drop a contradictory supplied plan and save its wrong number`,
    );
  }
  for (const tier of [
    "qualitative_verified",
    "question_representation",
  ] as const) {
    const doc = instrumentScene(correct, tier);
    assert(
      validateProductionSceneCandidate({
        candidate: doc as unknown as Record<string, unknown>,
        question: instrumentQuestion,
        turnPlan: correct,
      }).valid,
    );
    assert.equal(
      liveSceneSaveFailure({
        document: doc,
        question: instrumentQuestion,
        turnPlan: correct,
        tier,
      }),
      null,
    );
    assert(
      (
        await canonicalizeTurnSceneMetadata({
          question: instrumentQuestion,
          sceneDocument: doc,
          visualStatus: "validated",
          sceneArtifacts: {
            schemaVersion: "scene-artifacts/v3",
            representationTier: tier,
            nonMetric: true,
            diagramResultStatus: "ready",
            turnPlan: correct,
          },
          segments: [],
        })
      ).ok,
      "correct conversions retain both nonmetric paths",
    );
  }
  const textOnly = await canonicalizeTurnSceneMetadata({
    question: instrumentQuestion,
    visualStatus: "text_only",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3",
      turnPlan: instrument,
    },
    segments: [],
  });
  assert(
    textOnly.ok && textOnly.value.sceneDocument === null,
    "refused numeric authority must never stop text-only teaching",
  );

  const question =
    "An electric dipole has charges ±8.0 μC. Sketch its two members without asserting a metric separation.";
  // The source's 'without' asks for non-metric drawing, so use a separate asserted
  // pair sentence to exercise the conservative, qualifier-free source capability.
  const sourceQuestion =
    "An electric dipole has charges ±8.0 μC. Sketch its two members qualitatively.";
  function sourcePlan(source = sourceQuestion): TurnPlanV3 {
    return {
      schemaVersion: "turn-plan/v3",
      question: source,
      visualRequirement: "required",
      givens: [
        {
          id: "magnitude",
          symbol: "|q|",
          value: 8,
          unit: "μC",
          provenance: "given",
        },
      ],
      unknowns: [],
      derived: [],
      qualitativeClaims: [],
      lawIds: [],
      assumptions: [],
    };
  }
  function document(source = sourceQuestion): SceneDocument {
    return {
      schemaVersion: "scene-document/v2",
      visualDecision: { mode: "scene", reason: "explicit source pair" },
      source: {
        question: source,
        representationTier: "qualitative_verified",
        nonMetric: true,
      },
      quantities: [
        { id: "positive_member", value: 8, unit: "μC" },
        { id: "negative_member", value: -8, unit: "μC" },
      ],
      entities: [
        {
          id: "positive",
          kind: "point",
          role: "positive member",
          label: "+8.0 μC",
        },
        {
          id: "negative",
          kind: "point",
          role: "negative member",
          label: "−8.0 μC",
        },
      ],
      constructions: [
        {
          id: "p",
          operator: "point",
          inputs: { x: -1, y: 0 },
          outputs: ["positive"],
        },
        {
          id: "n",
          operator: "point",
          inputs: { x: 1, y: 0 },
          outputs: ["negative"],
        },
      ],
      relations: [],
      assertions: [],
      annotations: [],
      requiredEntityIds: ["positive", "negative"],
      revealGroups: [
        {
          id: "pair",
          entityIds: ["positive", "negative"],
          dependsOn: [],
          narrationCue: "pair",
        },
      ],
      teachingTimeline: [],
    };
  }

  async function roundtrip(doc: SceneDocument, plan: TurnPlanV3) {
    return canonicalizeTurnSceneMetadata({
      question: plan.question,
      sceneDocument: doc,
      visualStatus: "validated",
      sceneArtifacts: {
        schemaVersion: "scene-artifacts/v3",
        representationTier: "qualitative_verified",
        nonMetric: true,
        diagramResultStatus: "ready",
        turnPlan: plan,
      },
      segments: [],
    });
  }

  const plan = sourcePlan();
  const scene = document();
  const candidate = validateProductionSceneCandidate({
    candidate: scene as unknown as Record<string, unknown>,
    question: sourceQuestion,
    turnPlan: plan,
  });
  assert(
    candidate.valid,
    "the production candidate entry preserves and verifies both source members",
  );
  assert(compileSceneDocument(scene).ok);
  assert.equal(
    liveSceneSaveFailure({
      document: scene,
      question: sourceQuestion,
      turnPlan: plan,
      tier: "qualitative_verified",
    }),
    null,
  );
  const saved = await roundtrip(scene, plan);
  assert(
    saved.ok,
    "the actual server canonicalizer accepts the same verified source-members scene",
  );
  if (saved.ok) {
    const reopened = JSON.parse(JSON.stringify(saved.value));
    assert.equal(
      reopened.sceneDocument.entities.find(
        (entity: { id: string }) => entity.id === "negative",
      ).label,
      "−8.0 μC",
      "serialization and reopen keep the signed source label",
    );
  }
  for (const source of ["The charge magnitude is 8 μC.", question]) {
    const falsePlan = sourcePlan(source);
    const falseScene = document(source);
    assert(
      !validateProductionSceneCandidate({
        candidate: falseScene as unknown as Record<string, unknown>,
        question: source,
        turnPlan: falsePlan,
      }).valid,
    );
    assert(
      liveSceneSaveFailure({
        document: falseScene,
        question: source,
        turnPlan: falsePlan,
        tier: "qualitative_verified",
      }),
    );
    assert(
      !(await roundtrip(falseScene, falsePlan)).ok,
      "live and save both refuse unsupported source-member evidence",
    );
  }
  const wrongScene = document();
  wrongScene.quantities[1]!.value = -9;
  assert(
    liveSceneSaveFailure({
      document: wrongScene,
      question: sourceQuestion,
      turnPlan: plan,
      tier: "qualitative_verified",
    }),
  );
  assert(!(await roundtrip(wrongScene, plan)).ok);
  console.log(
    "verify-plan-rejection-admission: real core instrument admission, candidate/live/save signed-source parity and serialized reopen pass",
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
