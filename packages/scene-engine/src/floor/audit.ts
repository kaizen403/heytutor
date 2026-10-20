/**
 * The floor's own honesty audit, run on the compiled render after every other
 * engine check passed. It does not trust the builder: the allowed texts are
 * recomputed from the stated facts, so a builder bug that writes a solved or
 * invented number, or draws analysis ink its kind does not allow, refuses the
 * whole figure.
 */
import type { RenderScene, SceneDocument } from "../types";
import { FLOOR_FIGURE_VERSION, flattenText, type FloorFacts } from "./facts";
import { statedInQuestion } from "./statedText";

export interface FloorAuditIssue {
  code: string;
  message: string;
}

export interface FloorAuditAllowance {
  /** Digit-free names the kind writes (axis names, element names); each is checked again here. */
  names: readonly string[];
  /** Primitive kinds that carry direction; only a kind that draws a stated direction may use them. */
  directedInk: boolean;
}

/** Every label text the stated facts allow, normalised for comparison. */
export function floorAllowedTexts(facts: FloorFacts, names: readonly string[]): Set<string> {
  const allowed = new Set<string>();
  const add = (text: string) => allowed.add(normaliseLabel(text));
  for (const value of facts.values) {
    add(value.valueText);
    add(`${value.symbol} = ${value.valueText}`);
    add(value.symbol);
  }
  for (const unknown of facts.unknowns) {
    add(`${unknown.symbol} = ?`);
    add(unknown.symbol);
  }
  for (const object of facts.objects) if (object.name) add(object.name);
  for (const name of names) if (digitFree(name)) add(name);
  return allowed;
}

export function normaliseLabel(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\s*=\s*/g, " = ").trim();
}

function digitFree(text: string): boolean {
  return !/[0-9]/.test(text);
}

/** Digits a label may carry: only those inside a stated value spelling or a symbol subscript. */
function statedDigitsOnly(text: string, facts: FloorFacts): boolean {
  let rest = normaliseLabel(text);
  for (const value of [...facts.values].sort((a, b) => b.valueText.length - a.valueText.length)) {
    rest = rest.split(normaliseLabel(value.valueText)).join(" ");
  }
  for (const symbol of [...facts.values.map((value) => value.symbol), ...facts.unknowns.map((unknown) => unknown.symbol)]) {
    rest = rest.split(symbol).join(" ");
  }
  return digitFree(rest);
}

export function auditFloorFigure(
  document: SceneDocument,
  render: RenderScene,
  facts: FloorFacts,
  allowance: FloorAuditAllowance,
): FloorAuditIssue[] {
  const issues: FloorAuditIssue[] = [];
  const source = document.source as Record<string, unknown>;
  if (source.floorFigure !== FLOOR_FIGURE_VERSION) {
    issues.push({ code: "floor_version", message: "the document is not a floor figure" });
  }
  if (typeof source.question !== "string" || flattenText(source.question) !== flattenText(facts.question)) {
    issues.push({ code: "floor_question", message: "the floor figure was built for a different question" });
  }
  if (source.representationTier !== "question_representation" || source.nonMetric !== true) {
    issues.push({ code: "floor_tier", message: "a floor figure is a nonmetric question representation" });
  }
  if (document.quantities.some((quantity) => typeof quantity.value === "number" &&
      !facts.values.some((value) => value.quantityId === quantity.id && value.value === quantity.value))) {
    issues.push({ code: "floor_unstated_quantity", message: "a floor quantity is not a stated given" });
  }
  const allowed = floorAllowedTexts(facts, allowance.names);
  for (const primitive of render.primitives) {
    if ((primitive.kind === "label" || primitive.kind === "dimension") && typeof primitive.text === "string") {
      const text = normaliseLabel(primitive.text);
      if (!text) continue;
      const fromFacts = allowed.has(text) && statedDigitsOnly(text, facts);
      if (!fromFacts && !statedInQuestion(text, facts.question)) {
        issues.push({ code: "floor_unstated_text", message: `"${text}" is not a stated value, unknown or name` });
      }
    }
    if (!allowance.directedInk && (primitive.kind === "vector" || primitive.kind === "ray")) {
      issues.push({ code: "floor_analysis_ink", message: `${primitive.kind} ink on ${primitive.entityId} draws analysis the floor never draws` });
    }
  }
  for (const entity of document.entities) {
    const provenance = entity.provenance as Record<string, unknown> | undefined;
    if (!provenance || provenance.floor !== true) {
      issues.push({ code: "floor_unsourced_entity", message: `${entity.id} carries no floor provenance` });
    }
  }
  return issues;
}
