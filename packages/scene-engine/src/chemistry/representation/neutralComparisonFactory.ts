import type { RenderScene, SceneDocument, SceneIssue } from "../../types";
import { buildMoleculePanelScene } from "../organic/panel";
import { closeComparisonSource, failedChemistryComparisonRequest } from "./neutralComparisonSource";
import { auditNeutralComparison, type NeutralComparisonProof } from "./neutralComparisonGeometry";
import { copyNeutralComparisonData } from "./neutralComparisonInput";

export type { NeutralComparisonProof } from "./neutralComparisonGeometry";
export type NeutralPanelLabelBinding = {
  readonly entityId: string; readonly primitiveId: string; readonly groupId: string;
  readonly sourceArgument: { readonly start: number; readonly end: number; readonly text: string };
  readonly graphIdentity: string; readonly compiledAnchor: { readonly x: number; readonly y: number };
} & (
  | { readonly kind: "structure_symbol"; readonly sourceAtom: number; readonly hydrogenSlot: number | null; readonly text: "O" | "OH" | "H" }
  | { readonly kind: "complete_source_name_line"; readonly lineIndex: number; readonly originalStart: number; readonly originalEnd: number; readonly text: string; readonly projection?: "canonical_same_graph" }
);
export type NeutralPanelCheck =
  | { readonly status: "not_applicable" }
  | { readonly status: "declined"; readonly issues: readonly SceneIssue[] }
  | { readonly status: "verified"; readonly originalQuestion: string; readonly document: SceneDocument;
      readonly renderScene: RenderScene; readonly proof: NeutralComparisonProof; readonly labels: readonly NeutralPanelLabelBinding[] };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const declined = (reasons: readonly string[]): NeutralPanelCheck => ({ status: "declined", issues: reasons.map(message => ({ code: "neutral_comparison_declined", severity: "fatal", path: "rawDocument", message })) });

/** Canonical footprint/claimed proof can only cause denial; never permission.
 * A closed external neutral request requires checking even if all markers vanish.
 * Other-kind disposition is bounded; no subject router or family-wide grant. */
function neutralFootprint(document: unknown): boolean {
  if (!record(document)) return false;
  if (Array.isArray(document.revealGroups) && document.revealGroups.some(group => record(group) && group.id === "molecule_panel")) return true;
  if (Array.isArray(document.entities)) {
    const frames = new Set(document.entities.flatMap(entity => record(entity) && typeof entity.id === "string" && /^m[0-3]_panel$/.test(entity.id) ? [entity.id] : []));
    if (frames.size >= 2) return true;
  }
  function claim(value: unknown): boolean {
    if (value === "neutral-comparison-source-proof/v1") return true;
    return record(value) ? Object.values(value).some(claim) : Array.isArray(value) ? value.some(claim) : false;
  }
  return claim(document);
}

/** No supplied proof/flag/certificate API; every call resolves source and audits RAW. */
export function prepareNeutralComparison(input: { originalQuestion: string; rawDocument: unknown; compiledWitness?: unknown }): NeutralPanelCheck {
  try {
    const call = copyNeutralComparisonData(input);
    if (!record(call) || Object.keys(call).some(key => !["originalQuestion", "rawDocument", "compiledWitness"].includes(key))) return declined(["unsupported_factory_arguments"]);
    const question = call.originalQuestion;
    const document = call.rawDocument;
    const closure = typeof question === "string" ? closeComparisonSource(question) : null;
    const failedNeutralRequest = typeof question === "string" && closure !== null && failedChemistryComparisonRequest(question, closure);
    if (!closure?.ok && !failedNeutralRequest && !neutralFootprint(document)) return { status: "not_applicable" };
    if (typeof question !== "string") return declined(["missing_external_original_question"]);
    if (!closure?.ok) return declined(closure?.issues ?? ["unsupported_complete_request"]);
    if (!record(document)) return declined(["unsupported_raw_document_shape"]);
    const audited = auditNeutralComparison(document as unknown as SceneDocument, question, call.compiledWitness as RenderScene | undefined);
    if (!audited.ok || !audited.proof || !audited.renderScene) return declined(audited.issues);
    const proof = audited.proof;
    const scene = audited.renderScene;
    const primitives = new Map(scene.primitives.map(primitive => [primitive.id, primitive]));
    const used = new Set<string>();
    function membership(entityId: string, primitiveId: string, text: string) {
      const primitive = primitives.get(primitiveId);
      if (!primitive || used.has(primitiveId) || primitive.entityId !== entityId || primitive.kind !== "label" || primitive.text !== text || primitive.groupId !== "molecule_panel") throw new Error("unbound_actual_label_membership");
      used.add(primitiveId);
      return { entityId, primitiveId, groupId: primitive.groupId, compiledAnchor: { ...primitive.points[0]! } };
    }
    const labels: NeutralPanelLabelBinding[] = proof.symbols.map(symbol => ({
      ...membership(symbol.entityId, symbol.primitiveId, symbol.text), kind: "structure_symbol", sourceArgument: symbol.sourceArgument,
      graphIdentity: symbol.graphIdentity, sourceAtom: symbol.sourceAtom, hydrogenSlot: symbol.hydrogenSlot, text: symbol.text,
    }));
    for (const line of proof.nameLines) {
      const source = proof.sourceBindings.find(binding => binding.source.start === line.sourceArgument.start && binding.source.end === line.sourceArgument.end && binding.source.text === line.sourceArgument.text);
      if (!source) throw new Error("unbound_complete_name_source");
      labels.push({ ...membership(line.entityId, line.primitiveId, line.text), kind: "complete_source_name_line", sourceArgument: line.sourceArgument,
        graphIdentity: source.graphIdentity, lineIndex: line.lineIndex, originalStart: line.originalStart, originalEnd: line.originalEnd, text: line.text });
    }
    if (scene.primitives.filter(primitive => primitive.kind === "label").length !== labels.length) return declined(["incomplete_actual_label_membership"]);
    return { status: "verified", originalQuestion: question, document: document as unknown as SceneDocument, renderScene: scene, proof, labels };
  } catch (error) {
    return declined([error instanceof Error ? error.message : "unsupported_factory_input"]);
  }
}

/** Neutral structural list only. No ranking, test outcomes or physical authority. */
export function buildSourceBoundNeutralComparison(input: { originalQuestion: string }): NeutralPanelCheck {
  try {
    const call = copyNeutralComparisonData(input);
    if (!record(call) || Object.keys(call).some(key => key !== "originalQuestion") || typeof call.originalQuestion !== "string") return declined(["unsupported_producer_arguments"]);
    const question = call.originalQuestion;
    const closure = closeComparisonSource(question);
    if (!closure.ok) return failedChemistryComparisonRequest(question, closure) ? declined(closure.issues) : { status: "not_applicable" };
    const document = buildMoleculePanelScene(question, closure.species.map(species => ({ molecule: species.resolved.molecule!, label: species.source.text })), [], { mode: "comparison" });
    if (!document) return declined(["ordinary_panel_declined"]);
    return prepareNeutralComparison({ originalQuestion: question, rawDocument: document });
  } catch (error) {
    return declined([error instanceof Error ? error.message : "unsupported_producer_input"]);
  }
}
