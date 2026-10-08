import type { ProblemIR, SolveRequest } from "../../ir/problemIR";
import type { SceneDocument } from "../../types";
import { currentLawModels } from "./agent1-current-laws";
import { dcNetworkModels } from "./agent2-dc-networks";
import { electrostaticFieldModels } from "./agent3-electrostatic-fields";
import { potentialCapacitorModels } from "./agent4-potential-capacitors";
import { magneticSourceModels } from "./agent5-magnetic-sources";
import { magneticForceModels } from "./agent6-magnetic-forces";
import { inductionAcModels } from "./agent7-induction-ac";
import { emWaveModels } from "./agent8-em-waves";
import { groundExplicitModel, modelAdmission, modelAdmissionRole } from "./admission";
import "./registerAdmission";
import type { DeclaredScope, EmModel, TopicBinding } from "./sceneKit";

const MODEL_NAME = /^(ce|dc|ef|ep|mf|mm|ind|emw)\.[a-z0-9_]{1,48}$/;
const OWNED_PREFIX = /^(ce|dc|ef|ep|mf|mm|ind|emw)\./;

const models: EmModel[] = [
  ...currentLawModels,
  ...dcNetworkModels.map((model) => ({ ...model, family: "circuit_network" })),
  ...electrostaticFieldModels,
  ...potentialCapacitorModels,
  ...magneticSourceModels,
  ...magneticForceModels,
  ...inductionAcModels,
  ...emWaveModels,
];

const byName = new Map<string, EmModel>();
for (const model of models) {
  if (byName.has(model.name)) throw new Error(`duplicate physical model ${model.name}`);
  byName.set(model.name, model);
}

export interface EmStandardCase {
  id: string;
  modelName: string;
  topicIds: string[];
  packet: string;
  chapter: string;
  declaredScope: DeclaredScope;
  assumptions: string;
  family: string;
  ordinary: Record<string, number>;
  altered: Record<string, number>;
  rejections: Record<string, number>[];
  build(): SceneDocument;
}

export interface TopicDisposition {
  topicId: string;
  packet: string;
  chapter: string;
  declaredScope: DeclaredScope;
  models: string[];
  assumptions: string[];
  remaining: string[];
}

export type ConsumeResult =
  | { status: "unclaimed" }
  | { status: "rejected"; reason: string }
  | { status: "scene"; document: SceneDocument };

export function standardCases(): EmStandardCase[] {
  return models.map((model) => ({
    id: model.name,
    modelName: model.name,
    topicIds: model.topics.map((topic) => topic.topicId),
    packet: model.topics[0]?.packet ?? "",
    chapter: model.topics[0]?.chapter ?? "",
    declaredScope: model.scope,
    assumptions: model.assumptions,
    family: model.family,
    ordinary: model.ordinary,
    altered: model.altered,
    rejections: model.rejections,
    build: () => model.build(model.ordinary),
  }));
}

export function topicDispositions(): TopicDisposition[] {
  const grouped = new Map<string, { binding: TopicBinding; scopes: DeclaredScope[]; models: string[]; assumptions: string[]; remaining: string[] }>();
  for (const model of models) {
    for (const topic of model.topics) {
      const existing = grouped.get(topic.topicId);
      if (existing) {
        existing.scopes.push(model.scope);
        existing.models.push(model.name);
        existing.assumptions.push(model.assumptions);
        existing.remaining.push(topic.remaining);
      } else {
        grouped.set(topic.topicId, {
          binding: topic,
          scopes: [model.scope],
          models: [model.name],
          assumptions: [model.assumptions],
          remaining: [topic.remaining],
        });
      }
    }
  }
  const rank: Record<DeclaredScope, number> = { solved: 4, qualitative: 3, setup_only: 2, text_only: 1 };
  return [...grouped.values()].map((entry) => ({
    topicId: entry.binding.topicId,
    packet: entry.binding.packet,
    chapter: entry.binding.chapter,
    declaredScope: entry.scopes.reduce((best, scope) => rank[scope] > rank[best] ? scope : best),
    models: [...new Set(entry.models)],
    assumptions: [...new Set(entry.assumptions)],
    remaining: [...new Set(entry.remaining)],
  }));
}

export function consumePhysicalModel(modelName: string, inputs: Record<string, unknown>): ConsumeResult {
  if (!OWNED_PREFIX.test(modelName)) return { status: "unclaimed" };
  if (!MODEL_NAME.test(modelName)) return { status: "rejected", reason: "model name is not a declared physical model" };
  const model = byName.get(modelName);
  if (!model) return { status: "rejected", reason: `no standard case is named ${modelName}` };
  try {
    return { status: "scene", document: model.build(inputs) };
  } catch (error) {
    return { status: "rejected", reason: error instanceof Error ? error.message : "physical model rejected the inputs" };
  }
}

export interface ExplicitPhysicalModelScene {
  handled: boolean;
  document: SceneDocument | null;
  tier: "question_representation" | "qualitative_verified";
  family: string;
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readExplicitRequest(problemIR: unknown): Extract<SolveRequest, { kind: "explicit_physical_model" }> | null {
  if (!isRecord(problemIR) || !Array.isArray(problemIR.solveRequests)) return null;
  const request = problemIR.solveRequests.find((entry) => isRecord(entry) && entry.kind === "explicit_physical_model");
  if (!request || !isRecord(request)) return null;
  return request as Extract<SolveRequest, { kind: "explicit_physical_model" }>;
}

/** Scene authority for a source-declared physical model. A miss is unhandled; an owned failure does not fall through. */
export function explicitPhysicalModelScene(question: string, problemIR: unknown): ExplicitPhysicalModelScene {
  const request = readExplicitRequest(problemIR);
  const absent: ExplicitPhysicalModelScene = {
    handled: false, document: null, tier: "qualitative_verified", family: "point_field", reason: "",
  };
  if (!request) return absent;
  const fail = (reason: string): ExplicitPhysicalModelScene => ({
    handled: true, document: null, tier: "qualitative_verified", family: "point_field", reason,
  });
  if (typeof request.model !== "string" || !OWNED_PREFIX.test(request.model)) return absent;
  const grounded = groundExplicitModel(question, problemIR);
  if (!grounded.ok) return fail(grounded.reason);
  const admission = modelAdmission(grounded.model);
  if (!admission) return fail("explicit physical model is not admitted");
  const consumed = consumePhysicalModel(grounded.model, grounded.inputs);
  if (consumed.status === "unclaimed") return absent;
  if (consumed.status === "rejected") return fail(consumed.reason);
  const model = byName.get(grounded.model);
  if (!model) return fail("explicit physical model disappeared after a successful build");
  const resultKind = admission.resultKind ?? "scalar";
  if ((model.scope === "solved") !== (resultKind === "scalar")) {
    return fail("physical model scope disagrees with its source-admission result kind");
  }
  const binding = isRecord(request.resultBinding) ? request.resultBinding : null;
  const proved = admission.scalar(grounded.inputs);
  if (model.scope === "solved") {
    if (!binding || typeof binding.symbol !== "string") return fail("a solved physical model requires a result binding");
    const value = proved[binding.symbol];
    if (typeof value !== "number") return fail(`unbound physical output ${binding.symbol}`);
    const certified = { [binding.symbol]: value };
    const inputQuantities = Object.entries(grounded.inputs).map(([id, input]) => {
      const unit = modelAdmissionRole(grounded.model, id, grounded.inputs)?.unit;
      return { id: `input_${id}`, value: input, ...(unit ? { unit } : {}) };
    });
    return {
      handled: true,
      document: {
        ...consumed.document,
        source: { ...consumed.document.source, question, certified, declaredScope: model.scope },
        quantities: [
          ...inputQuantities,
          ...consumed.document.quantities.filter((quantity) => quantity.id === `certified_${binding.symbol}`),
        ],
      },
      tier: "question_representation",
      family: model.family,
      reason: model.assumptions,
    };
  }
  const certified = consumed.document.source.certified;
  if (isRecord(certified) && Object.keys(certified).length > 0) {
    return fail("a qualitative model cannot carry solved numeric labels");
  }
  return {
    handled: true,
    document: {
      ...consumed.document,
      source: { ...consumed.document.source, question },
      // A qualitative representation may carry source-given dimensions even
      // though it certifies no derived scalar. Preserve those exact grounded
      // inputs so visual-obligation admission can prove that every stated
      // observation reached the scene, without promoting them to outputs.
      quantities: [
        ...Object.entries(grounded.inputs).map(([id, input]) => {
          const unit = modelAdmissionRole(grounded.model, id, grounded.inputs)?.unit;
          return { id: `input_${id}`, value: input, ...(unit ? { unit } : {}) };
        }),
        ...consumed.document.quantities,
      ],
    },
    tier: "qualitative_verified",
    family: model.family,
    reason: model.assumptions,
  };
}

export function explicitModelRequest(model: string, inputs: Record<string, number>, evidenceFactIds: string[]): SolveRequest {
  return { id: "explicitModel", kind: "explicit_physical_model", model, inputs, evidenceFactIds };
}

export function assignedTopicIds(): string[] {
  return topicDispositions().map((topic) => topic.topicId);
}

export type { ProblemIR };
