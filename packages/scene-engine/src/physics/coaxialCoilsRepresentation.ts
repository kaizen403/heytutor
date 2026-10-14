/**
 * A nonmetric apparatus representation, bound to two explicitly named coils
 * and their shared axis. This is an inventory of the submitted setup, not a
 * magnetic-field solution: turn counts, winding sense, circuit connectivity,
 * current, flux, induced emf and dimensions remain unspecified.
 */
import { compileSceneDocument } from "../compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import type { SynthesizedFamilyScene } from "../synthesize/familyScene";
import { SCENE_DOCUMENT_VERSION, type SceneDocument } from "../types";

export const COAXIAL_COILS_SOURCE_MODEL = "coaxial_coils_inventory";

export interface CoaxialCoilsSource {
  kind: "coaxial_coils";
  coils: readonly [
    { id: "primary"; label: "primary"; kind: "coil" | "solenoid" },
    { id: "secondary"; label: "secondary"; kind: "coil" | "solenoid" },
  ];
  alignment: "coaxial";
  metric: false;
  /** Offsets only; the source stays in the normal private question field. */
  evidence: ReadonlyArray<{ start: number; end: number; role: "components" | "alignment" | "names" }>;
}

interface Token { word: string; start: number; end: number; clause: number }

function words(source: string): Token[] {
  const tokens: Token[] = [];
  let start: number | null = null;
  let clause = 0;
  for (let index = 0; index <= source.length; index += 1) {
    const code = source.charCodeAt(index);
    const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
    if (letter && start === null) start = index;
    if (!letter && start !== null) {
      tokens.push({ word: source.slice(start, index).toLowerCase(), start, end: index, clause });
      start = null;
    }
    if (".!?;,".includes(source[index] ?? " ")) clause += 1;
  }
  return tokens;
}

function sequence(tokens: readonly Token[], phrase: readonly string[]): number {
  return tokens.findIndex((_, index) => phrase.every((word, offset) => tokens[index + offset]?.word === word));
}

function boundCoilName(tokens: readonly Token[], name: "primary" | "secondary", components: number): number {
  const component = tokens[components]!;
  const apparatusHeads = ["coil", "coils", "solenoid", "solenoids", "circuit", "circuits", "current", "currents"];
  return tokens.findIndex((token, index) => {
    if (token.word !== name || token.start < component.start) return false;
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (next?.clause === token.clause && apparatusHeads.includes(next.word)) return true;
    if (previous?.clause === token.clause && apparatusHeads.includes(previous.word)) return true;
    const clause = tokens.filter((part) => part.clause === token.clause && part.start < token.start);
    if (clause.some((part) => ["named", "called", "labelled", "labeled"].includes(part.word))) return true;
    // A bare list immediately attached to the declared pair also supplies its
    // names. Later clauses need a definite apparatus reference or an explicit
    // first/second alias; unrelated primary/secondary nouns cannot bind it.
    const pairListWords = ["primary", "secondary", "and", "are", "named", "called", "labelled", "labeled", "the"];
    const afterPair = tokens.slice(components + 1, components + 9).filter((part) => part.clause === component.clause);
    const prefix = afterPair.slice(0, afterPair.findIndex((part) => !pairListWords.includes(part.word)) < 0
      ? afterPair.length : afterPair.findIndex((part) => !pairListWords.includes(part.word)));
    if (token.clause === component.clause && prefix.some((part) => part.word === "primary") && prefix.some((part) => part.word === "secondary")) return true;
    const complement = tokens[index + 2];
    if ((next?.word === "is" || next?.word === "are") && complement?.clause === token.clause &&
      ["a", "an", "the"].includes(complement.word) && !apparatusHeads.includes(tokens[index + 3]?.word ?? "")) return false;
    if (previous?.word === "the" && (!next || next.clause !== token.clause || ["is", "are", "has", "have", "and", "while", "when"].includes(next.word))) return true;
    const alias = name === "primary" ? "first" : "second";
    return clause.slice(-4).some((part) => part.word === alias) && previous?.word === "is";
  });
}

/**
 * Bounded source syntax, not chapter routing: bind a component pair, names
 * and an explicit same-axis relation. A law id or a topic name cannot admit
 * this representation. Apparatus with an omitted axis relation is declined.
 */
export function readCoaxialCoilsSource(question: string): CoaxialCoilsSource | null {
  const tokens = words(question);
  if (tokens.length > 1024) return null;
  const components = tokens.findIndex((token) => token.word === "solenoids" || token.word === "coils");
  if (components < 0) return null;
  const kind = tokens[components]!.word === "solenoids" ? "solenoid" : "coil";
  const componentToken = tokens[components]!;
  const apparatusClause = tokens.filter((token) => token.clause === componentToken.clause);
  const componentClause = tokens.slice(Math.max(0, components - 5), components + 1).filter((token) => token.clause === componentToken.clause);
  // The names alone do not rule out a third named apparatus. An explicit
  // pair count is required, and three/four-component variants stay declined.
  if (!componentClause.some((token) => token.word === "two" || token.word === "2" || token.word === "pair")) return null;
  if (componentClause.some((token) => ["three", "3", "four", "4"].includes(token.word))) return null;
  const count = componentClause.findIndex((token) => ["two", "2", "pair"].includes(token.word));
  if (componentClause.slice(count + 1, -1).some((token) => !["of", "co", "axial", "coaxial"].includes(token.word))) return null;
  if (tokens.some((token, index) => index !== components && ["coils", "solenoids"].includes(token.word) &&
    tokens.slice(Math.max(0, index - 5), index).some((before) => before.clause === token.clause && ["two", "2", "pair"].includes(before.word)))) return null;
  // A second setup or an explicit absence of names cannot lend its labels or
  // axis to this pair. This bounded inventory deliberately declines ambiguity.
  if (tokens.some((token) => ["unnamed", "unlabelled", "unlabeled", "another", "elsewhere", "textbook"].includes(token.word))) return null;
  if (sequence(tokens, ["different", "pair"]) >= 0 || sequence(tokens, ["different", "setup"]) >= 0 || sequence(tokens, ["different", "example"]) >= 0) return null;
  const axes = [["coaxial"], ["co", "axial"], ["same", "axis"], ["common", "axis"]] as const;
  for (const clause of new Set(tokens.map((token) => token.clause))) {
    const parts = tokens.filter((token) => token.clause === clause);
    for (const phrase of axes) {
      const index = sequence(parts, phrase);
      if (index >= 0 && parts.slice(0, index).some((token) => ["no", "not", "non", "without", "neither"].includes(token.word))) return null;
    }
  }
  const alignment = axes.map((phrase) => ({ phrase, index: sequence(apparatusClause, phrase) })).find((entry) => entry.index >= 0);
  if (!alignment) return null;
  const beforeAxis = apparatusClause.slice(0, alignment.index);
  if (beforeAxis.some((token) => ["no", "not", "non", "without", "neither"].includes(token.word))) return null;
  if (tokens.some((token) => ["perpendicular", "orthogonal", "noncoaxial", "misaligned", "nested", "inside", "within", "surrounds", "surrounding"].includes(token.word))) return null;
  if (sequence(tokens, ["different", "axes"]) >= 0 || sequence(tokens, ["separate", "axes"]) >= 0) return null;
  const unrelatedHeads = ["battery", "batteries", "cell", "cells", "school", "schools", "colour", "colours", "color", "colors", "source", "sources", "resistor", "resistors"];
  if (tokens.some((token, index) => (token.word === "primary" || token.word === "secondary") &&
    tokens[index + 1]?.clause === token.clause && unrelatedHeads.includes(tokens[index + 1]!.word))) return null;
  const primary = boundCoilName(tokens, "primary", components);
  const secondary = boundCoilName(tokens, "secondary", components);
  if (primary < 0 || secondary < 0) return null;
  const nameTokens = [tokens[primary]!, tokens[secondary]!];
  const axisStart = apparatusClause[alignment.index]!;
  const axisEnd = apparatusClause[alignment.index + alignment.phrase.length - 1]!;
  return {
    kind: "coaxial_coils", alignment: "coaxial", metric: false,
    coils: [{ id: "primary", label: "primary", kind }, { id: "secondary", label: "secondary", kind }],
    evidence: [
      { start: componentClause[0]!.start, end: componentToken.end, role: "components" },
      { start: axisStart.start, end: axisEnd.end, role: "alignment" },
      ...nameTokens.map((token) => ({ start: token.start, end: token.end, role: "names" as const })),
    ],
  };
}

/**
 * Project each named coil as a schematic helix on a common display axis.
 * The drawing repeats turns solely to make the component recognizable; their
 * count and spacing are display choices and certify no physical turn count.
 */
export function coaxialCoilsDocument(question: string, source: CoaxialCoilsSource): SceneDocument {
  // Rebind at the boundary: an externally constructed source cannot invent
  // an apparatus or carry altered evidence into a source-owned figure.
  const rebound = readCoaxialCoilsSource(question);
  if (!rebound || JSON.stringify(rebound) !== JSON.stringify(source)) throw new Error("coaxial coil source binding failed");
  const entities: SceneDocument["entities"] = [
    { id: "axis_start", kind: "point", role: "display axis endpoint helper" },
    { id: "axis_end", kind: "point", role: "display axis endpoint helper" },
    { id: "shared_axis", kind: "segment", role: "common axis of the source coils", label: "common axis", provenance: { dashed: true } },
    { id: "caption_anchor", kind: "point", role: "display caption helper" },
    { id: "caption", kind: "label", role: "apparatus representation limitation", label: "schematic only" },
  ];
  const constructions: SceneDocument["constructions"] = [
    { id: "make_axis_start", operator: "point", inputs: { x: -4.6, y: 0, coordinateSpace: "layout" }, outputs: ["axis_start"] },
    { id: "make_axis_end", operator: "point", inputs: { x: 4.6, y: 0, coordinateSpace: "layout" }, outputs: ["axis_end"] },
    { id: "make_shared_axis", operator: "segment", inputs: { start: "axis_start", end: "axis_end" }, outputs: ["shared_axis"] },
    { id: "make_caption_anchor", operator: "point", inputs: { x: 0, y: -1.8, coordinateSpace: "layout" }, outputs: ["caption_anchor"] },
    { id: "make_caption", operator: "label", inputs: { target: "caption_anchor", text: "schematic only" }, outputs: ["caption"] },
  ];
  for (const [index, coil] of source.coils.entries()) {
    const center = index === 0 ? -2.3 : 2.3;
    const displayTurns = 4;
    const displaySpan = 2.4;
    const samples = displayTurns * 32 + 1;
    // Raw pairs are a layout path, never source-valued dimensions or fields.
    const points = Array.from({ length: samples }, (_, sample) => {
      const progress = sample / (samples - 1);
      const phase = progress * 2 * Math.PI * displayTurns;
      return [center - displaySpan / 2 + displaySpan * progress + 0.14 * Math.cos(phase), 0.75 * Math.sin(phase)];
    });
    entities.push({ id: coil.id, kind: "polyline", role: `${coil.label} ${coil.kind} in the submitted setup`, label: coil.label });
    constructions.push({ id: `make_${coil.id}`, operator: "polyline", inputs: { points }, outputs: [coil.id] });
  }
  const requiredEntityIds = ["primary", "secondary", "shared_axis", "caption"];
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    source: {
      question, sourceModel: COAXIAL_COILS_SOURCE_MODEL, synthesizedFamily: true,
      representationTier: "question_representation", nonMetric: true,
      sourceEvidence: source.evidence,
      visualLimitation: "apparatus inventory only; no current, flux, winding, connection or induced-emf value is assumed",
    },
    visualDecision: { mode: "scene", reason: "two explicitly named coaxial coils; source apparatus only" },
    quantities: [], entities, constructions, relations: [], annotations: [],
    assertions: requiredEntityIds.flatMap((id) => [
      { id: `exists_${id}`, predicate: "exists", entities: [id], expected: true, severity: "fatal" as const },
      { id: `label_${id}`, predicate: "label_attached", entities: [id], expected: true, severity: "fatal" as const },
    ]),
    requiredEntityIds,
    revealGroups: [{ id: "setup", entityIds: requiredEntityIds, dependsOn: [], narrationCue: "the primary and secondary coils on their common axis" }],
    teachingTimeline: [{ id: "reveal_setup", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "the submitted apparatus; schematic only" }],
  };
}

/** Rebind apparatus geometry and evidence independently at live/save admission. */
export function coaxialCoilsRepresentationRejection(document: SceneDocument, question: string): string | null {
  if (document.visualDecision.mode !== "scene") return null;
  const source = document.source;
  if (source.sourceModel !== COAXIAL_COILS_SOURCE_MODEL && !("sourceEvidence" in source && "visualLimitation" in source)) return null;
  const inventory = readCoaxialCoilsSource(question);
  if (!inventory) return "coaxial_coils_source_missing";
  // Live admission removes dead construction helpers and fills canonical
  // defaults before this boundary. Apply that identical transformation to
  // both graphs; it must not make the honest factory differ from itself.
  const normalize = (candidate: SceneDocument) => validateSceneDocument(
    pruneDeadSceneEntities(candidate as unknown as Record<string, unknown>),
  ).document;
  const expected = normalize(coaxialCoilsDocument(question, inventory));
  const actual = normalize(document);
  if (!expected || !actual) return "coaxial_coils_source_mismatch";
  for (const field of ["source", "visualDecision", "quantities", "entities", "constructions", "relations", "assertions", "annotations", "requiredEntityIds", "revealGroups", "teachingTimeline"] as const) {
    if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) return "coaxial_coils_source_mismatch";
  }
  return null;
}

export function synthesizeCoaxialCoilsRepresentation(question: string): SynthesizedFamilyScene | null {
  const source = readCoaxialCoilsSource(question);
  if (!source) return null;
  const validated = validateSceneDocument(coaxialCoilsDocument(question, source) as unknown as Record<string, unknown>);
  if (!validated.document) return null;
  const compiled = compileSceneDocument(validated.document);
  if (!compiled.ok || !compiled.renderScene || compiled.report.issues.some((issue) => issue.severity === "fatal")) return null;
  return {
    document: validated.document, renderScene: compiled.renderScene, validationReport: compiled.report,
    tier: "question_representation", nonMetric: true, family: "point_field",
    reason: "source-bound coaxial-coil inventory; turns, dimensions, circuit connections and electromagnetic results unspecified",
  };
}
