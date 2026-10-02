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
import type { SolidProjectionKind } from "../compile/solidAnchors";

type SolidKind = "cylinder" | "cone" | "frustum" | "sphere" | "hemisphere";
type DimensionKind = "radius" | "diameter" | "height" | "topRadius" | "innerRadius";
interface Measure { value: number; unit: string; sourceText: string; derivedFromDiameter?: boolean }
interface SolidFact {
  kind: SolidKind;
  start: number;
  end: number;
  dimensions: Partial<Record<DimensionKind, Measure>>;
}

const UNIT_SCALE: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, km: 1000 };

export function buildSolidFigure(question: string, quantities: SolidQuantity[] = []): SceneDocument | null {
  const polyhedral = buildPolyhedralFigure(question);
  if (polyhedral) return polyhedral;
  // This reads source facts inside an already-selected family; it does not
  // route subjects or author contours. solid_projection owns every contour.
  const mentions = [...question.matchAll(/\b(hemisphere|cylinder|frustum|sphere|cone)s?\b/gi)].filter((mention, index, all) => {
    const prior = all[index - 1];
    // A frustum of a cone names one body; the parent type is not another solid.
    return !(mention[1]!.toLowerCase() === "cone" && prior?.[1]?.toLowerCase() === "frustum" &&
      /^\s+of\s+(?:(?:a|the)\s+)?$/i.test(question.slice(prior.index! + prior[0].length, mention.index!)));
  });
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
    for (const key of ["radius", "diameter", "height", "topRadius", "innerRadius"] as const) {
      const measure = dimensions[key];
      if (!measure) continue;
      if (fact.dimensions[key] && !sameLength(fact.dimensions[key], measure)) return null;
      if (!fact.dimensions[key] || !measure.derivedFromDiameter) fact.dimensions[key] = measure;
    }
  }
  if (facts.length === 0) return null;
  if (/\b(?:drilled|scooped|cut out|removed from)\b/i.test(question)) return null;
  const hollow = /\bhollow\b/i.test(question);
  if (hollow && (facts.length !== 1 || facts[0]!.kind !== "cylinder")) return null;
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
  if (solids.some((solid) => !completeDimensions(solid)) || (hollow && !solids[0]!.dimensions.innerRadius)) {
    return solids.length === 1 ? buildQuantitySolidFigure(question, solids[0]!, quantities, hollow) : null;
  }
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
  const dimension = (id: string, start: string, end: string, symbol: string, measure: Measure, measurementKind: "radius" | "diameter" | "height" | "inner_radius", solid: string): string => {
    entities.push({ id, kind: "dimension", role: `solid ${symbol} dimension`, label: `${symbol} = ${measure.value} ${measure.unit}` });
    constructions.push({ id: `make_${id}`, operator: "dimension", inputs: { start, end, measurementKind, solid }, outputs: [id] });
    visible.push(id);
    return id;
  };
  const anchor = (id: string, solid: string, at: number, radialFraction: number, angleDeg = 0): string => {
    entities.push({ id, kind: "point", role: "construction helper point" });
    constructions.push({ id: `make_${id}`, operator: "solid_anchor", inputs: { solid, at, radialFraction, angleDeg }, outputs: [id] });
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
    const face = solid.kind === "cylinder" ? 1 : solid.kind === "sphere" ? 0.5 : 0;
    if ((!joined || index === 0) && !solid.dimensions.radius!.derivedFromDiameter) {
      const radialCenter = anchor(`${id}_radius_center`, id, face, 0);
      const radialEnd = anchor(`${id}_rim`, id, face, 1);
      groupIds.push(dimension(`${id}_radius`, radialCenter, radialEnd, "r", solid.dimensions.radius!, "radius", id));
    }
    if (solid.dimensions.diameter) {
      const diameterFace = solid.kind === "cylinder" ? 0 : face;
      const a = anchor(`${id}_diameter_start`, id, diameterFace, 1, 180);
      const b = anchor(`${id}_diameter_end`, id, diameterFace, 1, 0);
      groupIds.push(dimension(`${id}_diameter`, a, b, "D", solid.dimensions.diameter, "diameter", id));
    }
    if (solid.dimensions.height) {
      const side = index % 2 === 0 ? 1 : -1;
      const radialFraction = solid.kind === "cylinder" ? 1 : 0;
      const a = anchor(`${id}_height_start`, id, 0, radialFraction, side > 0 ? 0 : 180);
      const b = anchor(`${id}_height_end`, id, 1, radialFraction, side > 0 ? 0 : 180);
      groupIds.push(dimension(`${id}_height`, a, b, "h", solid.dimensions.height, "height", id));
    }
    if (solid.dimensions.innerRadius) {
      const end = anchor(`${id}_inner_rim`, id, 1, length(solid.dimensions.innerRadius) / radius, 180);
      const start = anchor(`${id}_inner_center`, id, 1, 0);
      groupIds.push(dimension(`${id}_inner_radius`, start, end, "r_i", solid.dimensions.innerRadius, "inner_radius", id));
    }
    if (solid.dimensions.topRadius) {
      const a = anchor(`${id}_top_center`, id, 1, 0);
      const b = anchor(`${id}_top_rim`, id, 1, 1);
      groupIds.push(dimension(`${id}_top_radius`, a, b, "R", solid.dimensions.topRadius, "radius", id));
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
    const isDiameter = name === "diameter";
    const value = Number(match[2]) / (isDiameter ? 2 : 1);
    const measure: Measure = { value, unit: match[3]!.toLowerCase(), sourceText: match[0], ...(isDiameter ? { derivedFromDiameter: true } : {}) };
    if (dimensions[kind] && !sameLength(dimensions[kind], measure)) return null;
    if (!dimensions[kind] || !isDiameter) dimensions[kind] = measure;
    if (isDiameter) {
      const diameter = { ...measure, value: Number(match[2]), derivedFromDiameter: false };
      if (dimensions.diameter && !sameLength(dimensions.diameter, diameter)) return null;
      dimensions.diameter = diameter;
    }
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

/** Only explicit, source-backed single-solid quantities may fill parser gaps. */
function buildQuantitySolidFigure(question: string, fact: SolidFact, quantities: SolidQuantity[], hollow: boolean): SceneDocument | null {
  const parts = solidFigureParts(fact.kind, quantities);
  if (!parts || parts.quantities.length === 0) return null;
  if (fact.kind === "frustum" && !parts.entities.some((entity) => entity.id === "top_radius_measure")) return null;
  const projection = parts.constructions.find((construction) => construction.operator === "solid_projection" && construction.outputs.includes("solid"));
  const inner = parts.constructions.find((construction) => construction.operator === "solid_projection" && construction.outputs.includes("inner_solid"));
  if (!projection || (hollow && !inner)) return null;
  const used = quantities.filter((quantity) => parts.quantities.some((item) => item.id === quantity.id));
  const unit = (quantity: SolidQuantity) => quantity.unit?.trim().toLowerCase() ?? "";
  const sameUnit = used.every((quantity) => unit(quantity) === unit(used[0]!));
  const geometryScale = sameUnit ? UNIT_SCALE[unit(used[0]!)] : 1;
  const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
  for (const [key, measure] of Object.entries(fact.dimensions)) {
    const input = key === "innerRadius" ? inner?.inputs.radius : key === "diameter" ? Number(projection.inputs.radius) * 2 : projection.inputs[key];
    if (typeof input !== "number" || geometryScale === undefined || !close(input * geometryScale, measure.value * UNIT_SCALE[measure.unit]!)) return null;
  }
  const compactSource = question.replace(/\s+/g, "").toLowerCase();
  if (used.some((quantity) => {
    const explicit = `${quantity.symbol}=${quantity.value}${quantity.unit ?? ""}`.replace(/\s+/g, "").toLowerCase();
    if (quantity.symbol && compactSource.includes(explicit)) return false;
    const scale = UNIT_SCALE[unit(quantity)];
    return scale === undefined || !Object.values(fact.dimensions).some((measure) => close(quantity.value * scale, measure.value * UNIT_SCALE[measure.unit]!));
  })) return null;
  const entityIds = parts.entities.map((entity) => entity.id);
  const cue = `Show the ${fact.kind}: ${parts.entities.filter((entity) => entity.kind === "dimension").map((entity) => entity.label).join(", ")}`;
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "source-backed solid quantities with exact measurement anchors" },
    source: { question, synthesizedFamily: true }, ...parts, relations: [], annotations: [], requiredEntityIds: entityIds,
    revealGroups: [{ id: "setup", entityIds, dependsOn: [], narrationCue: cue }],
    teachingTimeline: [{ id: "reveal_setup", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: cue }],
  };
}

interface SolidQuantity { id: string; symbol: string; value: number; unit?: string }
type SolidFigureParts = Pick<SceneDocument, "entities" | "constructions" | "quantities" | "assertions">;

/** Compose solids and their measurements from quantity bindings, preserving R/r. */
export function solidFigureParts(kind: SolidProjectionKind, quantities: SolidQuantity[]): SolidFigureParts | null {
  const name = (id: string) => id.replace(/[^a-z]/gi, "").toLowerCase();
  const matchesName = (q: SolidQuantity, aliases: string[]) => {
    const id = name(q.id);
    return aliases.some((alias) => id === alias || id === `${kind}${alias}` || id === `${alias}${kind}`);
  };
  const named = (aliases: string[]) => quantities.find((q) => matchesName(q, aliases));
  // A symbol is not an owner: sphere_radius/r and water_rise/Δh must never
  // become the radius and height of a vessel. A one-solid fallback cannot
  // faithfully represent explicitly scoped measurements of several solids.
  const measurementNames = ["r", "d", "h", "l", "radius", "diameter", "height", "length", "outerradius", "externalradius", "innerradius", "internalradius", "topradius", "baseradius", "bottomradius", "outerdiameter", "externaldiameter", "innerdiameter", "topdiameter", "basediameter", "bottomdiameter"];
  const solidKinds: SolidProjectionKind[] = ["cylinder", "cone", "frustum", "sphere", "hemisphere"];
  if (quantities.some((q) => solidKinds.some((owner) => owner !== kind && measurementNames.some((measurement) =>
    name(q.id) === `${owner}${measurement}` || name(q.id) === `${measurement}${owner}`,
  )))) return null;
  const neutralSymbol = (symbol: string) => quantities.find((q) => q.symbol === symbol && name(q.id) === name(symbol));
  const outer = named(["outerradius", "externalradius"]) ?? neutralSymbol("R");
  const inner = named(["innerradius", "internalradius"]) ?? (kind === "cylinder" && outer ? quantities.find((q) =>
    q !== outer && q.symbol === "r" && ["r", "radius"].includes(q.id.replace(/[^a-z]/gi, "").toLowerCase()),
  ) : undefined);
  const radius = (kind === "frustum" ? named(["baseradius", "bottomradius"]) : undefined) ?? outer ?? named(["radius", "r"]);
  const diameters = quantities.filter((q) => matchesName(q, ["diameter", "d", "outerdiameter", "externaldiameter", "basediameter", "bottomdiameter"]));
  const diameter = diameters[0];
  const height = named(kind === "cylinder" ? ["height", "length", "h", "l"] : ["height", "h"]);
  const topRadius = named(["topradius"]) ?? (kind === "frustum" && outer ? neutralSymbol("r") : undefined);
  const used = [radius, ...diameters, height, kind === "cylinder" ? inner : topRadius].filter((q): q is SolidQuantity => Boolean(q));
  // Render ratios only when lengths have a shared scale. Labels retain source units.
  const scales: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001, km: 1000 };
  const unit = (q: SolidQuantity) => q.unit?.trim().toLowerCase() ?? "";
  const sameUnit = used.every((q) => unit(q) === (used[0] ? unit(used[0]) : ""));
  if (!sameUnit && used.some((q) => scales[unit(q)] === undefined)) return null;
  const value = (q: SolidQuantity) => q.value * (sameUnit ? 1 : scales[unit(q)]!);
  if (used.some((q) => !(value(q) > 0) || !Number.isFinite(value(q)))) return null;
  if (diameter && diameters.some((other) => Math.abs(value(other) - value(diameter)) > 1e-9 * Math.max(value(other), value(diameter)))) return null;
  if (radius && diameter && Math.abs(value(diameter) - 2 * value(radius)) > 1e-9 * Math.max(value(diameter), 2 * value(radius))) return null;
  const r = radius ? value(radius) : diameter ? value(diameter) / 2 : 1.2;
  if (kind === "cylinder" && inner && ((!radius && !diameter) || value(inner) >= r)) return null;
  const h = height ? value(height) : r * 2;
  const entities: SceneEntity[] = [
    { id: "center", kind: "point", role: "construction helper point" },
    { id: "solid", kind: "polyline", role: "solid projection" },
  ];
  const constructions: SceneConstruction[] = [
    { id: "make_center", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["center"] },
    { id: "make_solid", operator: "solid_projection", inputs: { kind, center: "center", radius: r, axis: "vertical",
      ...(["cylinder", "cone", "frustum"].includes(kind) ? { height: h } : {}),
      ...(kind === "frustum" ? { topRadius: topRadius ? value(topRadius) : r * 0.55 } : {}) }, outputs: ["solid"] },
  ];
  const anchor = (id: string, solid: string, at: number, radialFraction: number, angleDeg = 0) => {
    entities.push({ id, kind: "point", role: "construction helper point" });
    constructions.push({ id: `make_${id}`, operator: "solid_anchor", inputs: { solid, at, radialFraction, angleDeg }, outputs: [id] });
  };
  const measure = (id: string, start: string, end: string, quantity: SolidQuantity, measurementKind: "radius" | "diameter" | "height", solid = "solid") => {
    entities.push({ id, kind: "dimension", role: "solid measurement", label: `${quantity.symbol} = ${quantity.value}${quantity.unit ? ` ${quantity.unit}` : ""}` });
    constructions.push({ id: `make_${id}`, operator: "dimension", inputs: { start, end, measurementKind, solid }, outputs: [id] });
  };
  // Cone/frustum radii belong to the base. Cylinder radii belong to the top
  // face; spheres use the equatorial cross-section.
  const face = kind === "cylinder" ? 1 : kind === "sphere" ? 0.5 : 0;
  if (radius) anchor("radius_center", "solid", face, 0);
  if (radius) {
    anchor("radius_rim", "solid", face, 1);
    measure("radius_measure", "radius_center", "radius_rim", radius, "radius");
  }
  if (diameter) {
    // A cylinder's base has the same diameter as its top. Use that actual
    // section to separate the full span from top-face bore/radius marks.
    const diameterFace = kind === "cylinder" ? 0 : face;
    anchor("diameter_start", "solid", diameterFace, 1, 180);
    anchor("diameter_end", "solid", diameterFace, 1, 0);
    measure("diameter_measure", "diameter_start", "diameter_end", diameter, "diameter");
  }
  if (kind === "cylinder" && inner) {
    entities.push({ id: "inner_solid", kind: "polyline", role: "inner cylinder projection" });
    constructions.push({ id: "make_inner_solid", operator: "solid_projection", inputs: { kind, center: "center", radius: value(inner), height: h, axis: "vertical" }, outputs: ["inner_solid"] });
    anchor("inner_center", "inner_solid", face, 0);
    anchor("inner_rim", "inner_solid", face, 1, 180);
    measure("inner_radius_measure", "inner_center", "inner_rim", inner, "radius", "inner_solid");
  }
  if (height && ["cylinder", "cone", "frustum"].includes(kind)) {
    // A cone or frustum has no pair of parallel rim sides: use axis centres
    // for its true height rather than accidentally dimensioning slant height.
    const radialFraction = kind === "cylinder" ? 1 : 0;
    anchor("height_base", "solid", 0, radialFraction);
    anchor("height_top", "solid", 1, radialFraction);
    measure("height_measure", "height_base", "height_top", height, "height");
  }
  if (kind === "frustum" && topRadius) {
    anchor("top_radius_center", "solid", 1, 0);
    anchor("top_radius_rim", "solid", 1, 1);
    measure("top_radius_measure", "top_radius_center", "top_radius_rim", topRadius, "radius");
  }
  return { entities, constructions, quantities: used.map((q) => ({ ...q })), assertions: [{ id: "solid_exists", predicate: "exists", entities: ["solid"], expected: true, severity: "fatal" }] };
}
