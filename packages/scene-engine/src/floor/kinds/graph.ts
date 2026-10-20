/**
 * Graph floor: the curves, lines and regions the question states, plotted by
 * the engine's own analytic families from the stated equations, with every
 * board text the question does not state removed (a computed intercept, a
 * corner coordinate, an area). Only maths graph families are reused here; a
 * physics apparatus the same reader might build is never a graph floor.
 */
import { pruneDeadSceneEntities, validateSceneDocument } from "../../document/validation";
import { synthesizeFamilyScene } from "../../synthesize/familyScene";
import { parseMathExpression } from "../../math/expression";
import type { SceneDocument } from "../../types";
import { FLOOR_FIGURE_VERSION, type FloorFacts } from "../facts";
import { floorAllowedTexts, normaliseLabel } from "../audit";
import { findStatedCurves } from "../../synthesize/statedEquations";
import { questionSpelling, statedFunctionBodies, statedInQuestion } from "../statedText";
import type { FloorKindBuild } from "./index";

const GRAPH_FAMILIES = new Set(["analytic_curve", "bounded_region", "coordinate_figure"]);
/** Plain axis and origin names a coordinate frame always carries; no digits, no values. */
const AXIS_NAMES = ["x", "y", "z", "O"];

/**
 * A graph floor plots what the question writes. A stem with no equation of its
 * own ("explain the angle between two planes") has no stated curve, and a
 * reused figure for it drew a different situation (two lines for two planes).
 */
export function graphSignals(facts: FloorFacts): boolean {
  return statedFunctionBodies(facts.question).length > 0 || findStatedCurves(facts.question).length > 0;
}

export function buildGraphFloor(facts: FloorFacts): FloorKindBuild | { declined: string } | null {
  if (!graphSignals(facts)) return null;
  const scene = synthesizeFamilyScene({
    question: facts.question,
    turnPlan: facts.rawPlan,
    families: facts.families.filter((family) => GRAPH_FAMILIES.has(family)),
    problemIR: facts.problem,
  });
  if (!scene) return { declined: "the engine computes no graph of the stated equations" };
  if (!GRAPH_FAMILIES.has(scene.family)) return { declined: `the computed figure is ${scene.family}, not a graph` };
  const allowed = floorAllowedTexts(facts, AXIS_NAMES);
  const stated = (text: string) => allowed.has(normaliseLabel(text)) || statedInQuestion(text, facts.question);
  const document: SceneDocument = structuredClone(scene.document);
  const removed = new Set<string>();
  for (const entity of document.entities) {
    if (entity.label && !stated(entity.label)) delete entity.label;
    else if (entity.label) entity.label = questionSpelling(entity.label, facts.question) ?? entity.label;
  }
  document.constructions = document.constructions.filter((construction) => {
    if (construction.operator !== "label" || typeof construction.inputs.text !== "string" || stated(construction.inputs.text)) return true;
    construction.outputs.forEach((id) => removed.add(id));
    return false;
  });
  document.annotations = document.annotations.filter((annotation) => !annotation.text || stated(annotation.text))
    .map((annotation) => annotation.text ? { ...annotation, text: questionSpelling(annotation.text, facts.question) ?? annotation.text } : annotation);
  for (const construction of document.constructions) {
    if (construction.operator === "label" && typeof construction.inputs.text === "string") {
      construction.inputs = { ...construction.inputs, text: questionSpelling(construction.inputs.text, facts.question) ?? construction.inputs.text };
    }
  }
  // The figure must still say which stated equation it plots.
  const texts = [
    ...document.entities.flatMap((entity) => entity.label ? [entity.label] : []),
    ...document.annotations.flatMap((annotation) => annotation.text ? [annotation.text] : []),
    ...document.constructions.flatMap((construction) => construction.operator === "label" && typeof construction.inputs.text === "string" ? [construction.inputs.text] : []),
  ];
  if (!texts.some((text) => /=/.test(text) && /\p{L}/u.test(text) && statedInQuestion(text, facts.question))) {
    return { declined: "the reused graph names none of the stated equations" };
  }
  document.entities = document.entities.filter((entity) => !removed.has(entity.id));
  document.requiredEntityIds = document.requiredEntityIds.filter((id) => !removed.has(id));
  document.revealGroups = document.revealGroups.map((group) => ({ ...group, entityIds: group.entityIds.filter((id) => !removed.has(id)) }))
    .filter((group) => group.entityIds.length > 0);
  const groups = new Set(document.revealGroups.map((group) => group.id));
  document.revealGroups = document.revealGroups.map((group) => ({ ...group, dependsOn: group.dependsOn.filter((id) => groups.has(id)) }));
  document.teachingTimeline = document.teachingTimeline.filter((action) => !removed.has(action.targetId) &&
    (action.action !== "reveal" || groups.has(action.targetId)));
  const labelled = new Set(document.entities.filter((entity) => entity.label).map((entity) => entity.id));
  document.assertions = document.assertions.filter((assertion) => !assertion.entities.some((id) => removed.has(id)) &&
    (assertion.predicate !== "label_attached" || assertion.entities.every((id) => labelled.has(id))));
  // A floor figure declares only stated values; the engine's own computed quantities go.
  document.quantities = document.quantities.filter((quantity) => facts.values.some((value) =>
    value.quantityId === quantity.id && value.value === quantity.value));
  pinCurveLabels(document);
  for (const entity of document.entities) entity.provenance = { ...(entity.provenance ?? {}), floor: true, reusedFamily: scene.family };
  document.source = {
    question: facts.question,
    floorFigure: FLOOR_FIGURE_VERSION,
    floorKind: "graph",
    reusedFamily: scene.family,
    representationTier: "question_representation",
    nonMetric: true,
    omittedClaims: ["labels the question does not state", "derived values"],
  };
  document.visualDecision = { mode: "scene", reason: "the stated equations, plotted by the engine" };
  const validated = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>));
  if (!validated.document) return { declined: "the stated graph does not survive label removal" };
  return {
    document: validated.document,
    names: AXIS_NAMES,
    directedInk: false,
    reason: `the stated equations plotted as ${scene.family}`,
  };
}

/**
 * A curve's equation is written beside its own curve: a hidden anchor on the
 * curve where it is farthest from every other plotted curve, inside the axes.
 * Left to the label engine, two equations once floated between two curves and
 * the nearer curve was the wrong one.
 */
function pinCurveLabels(document: SceneDocument): void {
  const curves = document.constructions.filter((construction) => construction.operator === "function_curve" &&
    typeof construction.inputs.expression === "string" && (construction.inputs.variable ?? "x") === "x" &&
    typeof construction.inputs.xMin === "number" && typeof construction.inputs.xMax === "number");
  const parsed = curves.flatMap((construction) => {
    try { return [{ construction, curve: parseMathExpression(String(construction.inputs.expression)) }]; } catch { return []; }
  });
  const axes = document.constructions.find((construction) => construction.operator === "axes")?.inputs ?? {};
  const yMin = typeof axes.yMin === "number" ? axes.yMin : -Infinity, yMax = typeof axes.yMax === "number" ? axes.yMax : Infinity;
  const xLow = typeof axes.xMin === "number" ? axes.xMin : -Infinity, xHigh = typeof axes.xMax === "number" ? axes.xMax : Infinity;
  const value = (curve: ReturnType<typeof parseMathExpression>, x: number) => { try { const y = curve.evaluate(x); return Number.isFinite(y) ? y : null; } catch { return null; } };
  for (const { construction, curve } of parsed) {
    const id = construction.outputs[0]!;
    const entity = document.entities.find((candidate) => candidate.id === id);
    if (!entity?.label) continue;
    const from = Math.max(Number(construction.inputs.xMin), xLow), to = Math.min(Number(construction.inputs.xMax), xHigh);
    let best: { x: number; y: number; gap: number } | null = null;
    for (let step = 1; step < 20; step += 1) {
      const x = from + ((to - from) * step) / 20, y = value(curve, x);
      if (y === null || y < yMin || y > yMax) continue;
      const gaps = parsed.filter((other) => other.construction !== construction).flatMap((other) => {
        const otherY = value(other.curve, x);
        return otherY === null ? [] : [Math.abs(otherY - y)];
      });
      const gap = gaps.length ? Math.min(...gaps) : Infinity;
      const preferRight = step / 20;
      if (!best || gap + preferRight * 1e-6 > best.gap) best = { x, y, gap: gap + preferRight * 1e-6 };
    }
    if (!best) continue;
    const anchor = `${id}_tag`, name = `${id}_name`;
    document.entities.push(
      { id: anchor, kind: "point", role: "label anchor point" },
      { id: name, kind: "label", role: `equation of ${id}`, label: entity.label },
    );
    document.constructions.push(
      { id: `place_${anchor}`, operator: "point", inputs: { x: best.x, y: best.y, coordinateSpace: "world" }, outputs: [anchor] },
      { id: `write_${name}`, operator: "label", inputs: { target: anchor, text: entity.label }, outputs: [name] },
    );
    document.assertions = document.assertions.filter((assertion) => !(assertion.predicate === "label_attached" && assertion.entities.includes(id)));
    delete entity.label;
    document.requiredEntityIds.push(anchor, name);
    const group = document.revealGroups.find((candidate) => candidate.entityIds.includes(id));
    group?.entityIds.push(anchor, name);
  }
}
