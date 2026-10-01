/** Source-grounded dimensions composed through the existing solid operators. */
import {
  SCENE_DOCUMENT_VERSION,
  type SceneConstruction,
  type SceneAnnotation,
  type SceneDocument,
  type SceneEntity,
  type SceneRevealGroup,
} from "../types";
import { buildPolyhedralFigure } from "./polyhedralFigure";

type SolidKind = "cylinder" | "cone" | "frustum" | "sphere" | "hemisphere";
type DimensionKind = "radius" | "height" | "topRadius" | "innerRadius";
interface Measure { value: number; unit: string; sourceText: string }
interface SolidFact {
  kind: SolidKind;
  start: number;
  end: number;
  dimensions: Partial<Record<DimensionKind, Measure>>;
}

const UNIT_SCALE: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, km: 1000 };

export function buildSolidFigure(question: string): SceneDocument | null {
  const polyhedral = buildPolyhedralFigure(question);
  if (polyhedral) return polyhedral;
  // This reads source facts inside an already-selected family; it does not
  // route subjects or author contours. solid_projection owns every contour.
  const mentions = [...question.matchAll(/\b(hemisphere|cylinder|frustum|sphere|cone)s?\b/gi)];
  if (mentions.some((mention, index) => mentions.slice(0, index).some((prior) => prior[1]!.toLowerCase() === mention[1]!.toLowerCase()) && /\b(?:another|second|additional)\s+(?:\w+\s+){0,2}$/i.test(question.slice(Math.max(0, mention.index! - 40), mention.index!)))) return null;
  const facts: SolidFact[] = [];
  for (const [index, mention] of mentions.entries()) {
    const kind = mention[1]!.toLowerCase() as SolidKind;
    let fact = facts.find((item) => item.kind === kind);
    if (!fact) {
      fact = { kind, start: mention.index!, end: mention.index! + mention[0].length, dimensions: {} };
      facts.push(fact);
    }
    const dimensions = readDimensions(question.slice(mention.index! + mention[0].length, mentions[index + 1]?.index ?? question.length));
    if (!dimensions) return null;
    for (const key of ["radius", "height", "topRadius", "innerRadius"] as const) {
      const measure = dimensions[key];
      if (!measure) continue;
      if (fact.dimensions[key] && !sameLength(fact.dimensions[key], measure)) return null;
      fact.dimensions[key] = measure;
    }
  }
  if (facts.length === 0) return null;
  if (/\b(?:drilled|scooped|cut out|removed from)\b/i.test(question)) return null;
  if (/\bhollow\b/i.test(question) && (facts.length !== 1 || facts[0]!.kind !== "cylinder" || !facts[0]!.dimensions.innerRadius)) return null;
  // A melting comparison may show one representative of each solid. A
  // multi-part assembly must not silently collapse several equal-kind parts.
  if (mentions.some((mention) => /s$/i.test(mention[0])) && !/\b(?:melted|recast)\b/i.test(question)) return null;

  const joined = stackOrder(question, facts);
  if (joined) {
    // A cap shares the stated circular joining face unless its own radius is
    // given. Different explicit radii are not silently stretched to fit.
    for (let index = 1; index < joined.length; index += 1) {
      const below = joined[index - 1]!;
      const above = joined[index]!;
      const joinDimension = below.kind === "frustum" ? "topRadius" : "radius";
      below.dimensions[joinDimension] ??= above.dimensions.radius;
      const joinRadius = below.dimensions[joinDimension];
      above.dimensions.radius ??= joinRadius;
      if (!joinRadius || !above.dimensions.radius || !sameLength(joinRadius, above.dimensions.radius)) return null;
      if (below.kind !== "cylinder" && below.kind !== "frustum") return null;
      if (above.kind === "sphere") return null;
    }
  } else if (facts.length > 1 && !/\b(?:melted|recast|separate|compare)\b/i.test(question)) {
    // Do not guess how two named solids are joined, cut, or hollowed out.
    return null;
  }
  const solids = joined ?? facts;
  if (solids.some((solid) => !completeDimensions(solid))) return null;
  const unit = solids[0]!.dimensions.radius!.unit;
  const length = (measure: Measure) => measure.value * UNIT_SCALE[measure.unit]! / UNIT_SCALE[unit]!;
  const entities: SceneEntity[] = [];
  const constructions: SceneConstruction[] = [];
  const annotations: SceneAnnotation[] = [];
  const groups: SceneRevealGroup[] = [];
  const visible: string[] = [];
  const point = (id: string, x: number, y: number): string => {
    entities.push({ id, kind: "point", role: "construction helper point" });
    constructions.push({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] });
    return id;
  };
  const dimension = (id: string, start: string, end: string, symbol: string, measure: Measure): string => {
    entities.push({ id, kind: "dimension", role: `solid ${symbol} dimension`, label: `${symbol} = ${measure.value} ${measure.unit}` });
    constructions.push({ id: `make_${id}`, operator: "dimension", inputs: { start, end }, outputs: [id] });
    visible.push(id);
    return id;
  };
  const maxRadius = Math.max(...solids.map((solid) => length(solid.dimensions.radius!)));
  let baseY = 0;
  let nextX = 0;
  for (const [index, solid] of solids.entries()) {
    const id = solid.kind;
    const radius = length(solid.dimensions.radius!);
    const height = solid.dimensions.height ? length(solid.dimensions.height) : radius * (solid.kind === "sphere" ? 2 : 1);
    const x = joined ? 0 : nextX;
    const y = joined ? baseY : 0;
    const center = point(`${id}_center`, x, solid.kind === "sphere" ? y + radius : y);
    entities.push({ id, kind: "polyline", role: `${solid.kind} solid projection`, label: solid.kind });
    annotations.push({ id: `${id}_name`, kind: "label", targetIds: [id], text: solid.kind, placementIntent: index % 2 === 0 ? "left" : "right" });
    constructions.push({
      id: `make_${id}`, operator: "solid_projection",
      inputs: {
        kind: solid.kind, center, radius, axis: "vertical",
        ...(solid.dimensions.height ? { height } : {}),
        ...(solid.dimensions.topRadius ? { topRadius: length(solid.dimensions.topRadius) } : {}),
        ...(solid.dimensions.innerRadius ? { innerRadius: length(solid.dimensions.innerRadius) } : {}),
      }, outputs: [id],
    });
    visible.push(id);
    const groupIds: string[] = [id];
    if (!joined || index === 0) {
      const radialCenter = solid.kind === "sphere" ? center : `${id}_center`;
      const radialEnd = point(`${id}_rim`, x + radius, solid.kind === "sphere" ? y + radius : y);
      groupIds.push(dimension(`${id}_radius`, radialCenter, radialEnd, "r", solid.dimensions.radius!));
    }
    if (solid.dimensions.height) {
      const side = index % 2 === 0 ? 1 : -1;
      const dimensionX = x + side * maxRadius * 1.4;
      const a = point(`${id}_height_start`, dimensionX, y);
      const b = point(`${id}_height_end`, dimensionX, y + height);
      groupIds.push(dimension(`${id}_height`, a, b, "h", solid.dimensions.height));
    }
    if (solid.dimensions.innerRadius) {
      const end = point(`${id}_inner_rim`, x - length(solid.dimensions.innerRadius), y + height);
      const start = point(`${id}_inner_center`, x, y + height);
      groupIds.push(dimension(`${id}_inner_radius`, start, end, "r_i", solid.dimensions.innerRadius));
    }
    if (solid.dimensions.topRadius) {
      const a = point(`${id}_top_center`, x, y + height);
      const b = point(`${id}_top_rim`, x + length(solid.dimensions.topRadius), y + height);
      groupIds.push(dimension(`${id}_top_radius`, a, b, "R", solid.dimensions.topRadius));
    }
    groups.push({ id: `${id}_group`, entityIds: groupIds, dependsOn: index ? [groups[index - 1]!.id] : [], narrationCue: `show the ${solid.kind} and its given dimensions` });
    baseY += height;
    nextX += 4 * maxRadius;
  }
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: { mode: "scene", reason: "named solids with source-grounded radii, heights, and joining faces" },
    source: { question, synthesizedFamily: true }, quantities: [], entities, constructions,
    relations: [], annotations, requiredEntityIds: visible,
    assertions: [
      { id: "solids_exist", predicate: "exists", entities: solids.map((solid) => solid.kind), expected: true, severity: "fatal" },
      ...visible.map((id) => ({ id: `${id}_readable`, predicate: "label_attached", entities: [id], expected: true, severity: "fatal" as const })),
      ...(joined ? joined.slice(1).map((solid, index) => ({ id: `join_${index}`, predicate: "connected", entities: [joined[index]!.kind, solid.kind], expected: true, severity: "fatal" as const })) : []),
    ],
    revealGroups: groups,
    teachingTimeline: groups.map((group, index) => ({ id: `reveal_${group.id}`, action: "reveal", targetId: group.id, dependsOn: index ? [`reveal_${groups[index - 1]!.id}`] : [], narrationIntent: group.narrationCue })),
  };
}

function readDimensions(clause: string): SolidFact["dimensions"] | null {
  const dimensions: SolidFact["dimensions"] = {};
  const pattern = /\b((?:(?:top|upper|smaller|bottom|lower|base|outer|inner|internal|external)\s+)?radius|diameter|(?:vertical\s+)?height)\s*(?:of\s+|is\s+|=\s*)?(-?\d+(?:\.\d+)?)\s*(mm|cm|km|m)\b/gi;
  for (const match of clause.matchAll(pattern)) {
    const name = match[1]!.toLowerCase();
    const prefix = clause.slice(Math.max(0, match.index! - 8), match.index!);
    if (/slant\s*$/i.test(prefix)) continue;
    const kind: DimensionKind = name.includes("height") ? "height" : /inner|internal/.test(name) ? "innerRadius" : /top|upper|smaller/.test(name) ? "topRadius" : "radius";
    const value = Number(match[2]) / (name === "diameter" ? 2 : 1);
    const measure = { value, unit: match[3]!.toLowerCase(), sourceText: match[0] };
    if (dimensions[kind] && !sameLength(dimensions[kind], measure)) return null;
    dimensions[kind] = measure;
  }
  return dimensions;
}

function stackOrder(question: string, facts: SolidFact[]): SolidFact[] | null {
  if (facts.length !== 2) return null;
  const [first, second] = facts as [SolidFact, SolidFact];
  const between = question.slice(first.end, second.start);
  if (/\b(?:topped|surmounted|capped)\s+(?:by|with)\b/i.test(between)) return [first, second];
  if (/\b(?:on top of|mounted on|placed on|sits on|on a|on the)\b/i.test(between)) return [second, first];
  return null;
}

function completeDimensions(solid: SolidFact): boolean {
  const values = Object.values(solid.dimensions);
  if (!solid.dimensions.radius || values.some((measure) => !Number.isFinite(measure.value) || measure.value <= 0 || !UNIT_SCALE[measure.unit])) return false;
  if (solid.dimensions.innerRadius && (solid.kind !== "cylinder" || solid.dimensions.innerRadius.value * UNIT_SCALE[solid.dimensions.innerRadius.unit]! >= solid.dimensions.radius.value * UNIT_SCALE[solid.dimensions.radius.unit]!)) return false;
  if (solid.kind === "sphere" || solid.kind === "hemisphere") {
    // These operators derive their extent from radius, never a guessed height.
    delete solid.dimensions.height;
    return !solid.dimensions.topRadius;
  }
  if (!solid.dimensions.height) return false;
  return solid.kind !== "frustum" || Boolean(solid.dimensions.topRadius && !sameLength(solid.dimensions.radius, solid.dimensions.topRadius));
}

function sameLength(a: Measure, b: Measure): boolean {
  return Math.abs(a.value * UNIT_SCALE[a.unit]! - b.value * UNIT_SCALE[b.unit]!) < 1e-9;
}
