/**
 * Floor figure kinds, organised by what the picture is, never by chapter.
 * Each builder reads only {@link FloorFacts} and returns a scene document of
 * the stated setup, a reason it declines, or null when the facts hold nothing
 * of its kind.
 */
import type { SceneDocument } from "../../types";
import type { FloorFacts } from "../facts";
import { buildBodyFloor } from "./body";
import { buildCircuitFloor } from "./circuit";
import { buildGraphFloor, graphSignals } from "./graph";
import { buildMotionFloor, motionSignals } from "./motion";
import { buildOpticsFloor, opticsSignals } from "./optics";
import { buildCircularFloor, circularSignals } from "./circular";
import { buildFieldsFloor, fieldsSignals } from "./fields";

export interface FloorKindBuild {
  document: SceneDocument;
  /** Digit-free names this kind writes on the board (re-audited). */
  names: string[];
  /** True only for a kind whose arrows are stated directions. */
  directedInk: boolean;
  reason: string;
}

export type FloorKindBuilder = (facts: FloorFacts) => FloorKindBuild | { declined: string } | null;

export const FLOOR_KIND_BUILDERS = {
  circuit: buildCircuitFloor,
  body: buildBodyFloor,
  graph: buildGraphFloor,
  motion: buildMotionFloor,
  optics: buildOpticsFloor,
  circular: buildCircularFloor,
  fields: buildFieldsFloor,
} satisfies Record<string, FloorKindBuilder>;

export type FloorKind = keyof typeof FLOOR_KIND_BUILDERS;

/**
 * Kind order from structured signals: ProblemIR representation intents and
 * entity kinds first, then the families the live gate inferred. Every kind
 * still checks its own facts; order only decides which honest picture is
 * tried first.
 */
export function floorKindOrder(facts: FloorFacts, families: readonly string[]): FloorKind[] {
  const order: FloorKind[] = [];
  const add = (kind: FloorKind) => { if (!order.includes(kind)) order.push(kind); };
  const intents = new Set(facts.intents.map((intent) => intent.kind));
  const entityKinds = new Set(facts.objects.map((object) => object.kind));
  if (intents.has("network") || entityKinds.has("component") || families.includes("circuit_network") ||
    (!facts.problem && /\b(?:circuit|resistors?|capacitors?|inductors?|battery|cell)\b/i.test(facts.question))) add("circuit");
  if (intents.has("free_body") || entityKinds.has("body") || families.includes("contact_body")) add("body");
  if (opticsSignals(facts)) add("optics");
  if (fieldsSignals(facts)) add("fields");
  if (circularSignals(facts)) add("circular");
  if (motionSignals(facts)) add("motion");
  if (graphSignals(facts)) add("graph");
  return order;
}
