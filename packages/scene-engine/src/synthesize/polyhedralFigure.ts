/** Source dimensions bound to the generic extrusion/taper operator. */
import { readPolyhedralSolid, projectSolidPoint } from "../math/polyhedralSolid";
import { SCENE_DOCUMENT_VERSION, type SceneDocument, type SceneEntity, type SceneConstruction, type SceneRevealGroup } from "../types";

interface Measure { value: number; unit: string }
type Measures = Partial<Record<"side" | "length" | "width" | "height" | "baseHeight" | "base", Measure>>;
const UNIT_SCALE: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, km: 1000 };

export function buildPolyhedralFigure(question: string): SceneDocument | null {
  const mentions = [...question.matchAll(/\b(cuboid|cube|prism|pyramid)s?\b/gi)];
  if (!mentions.length || /\b(?:hollow|drilled|scooped|cut|removed|sphere|cylinder|cone|frustum|hemisphere)\b/i.test(question)) return null;
  // Compound polyhedra stay with the semantic planner; never collapse them
  // into one box or guess how their source faces join.
  if (new Set(mentions.map((m) => m[1]!.toLowerCase())).size > 1 || mentions.some((m) => /s$/i.test(m[0]))) return null;
  if (mentions.some((m, index) => index > 0 && /\b(?:another|second|additional)\s+(?:\w+\s+){0,2}$/i.test(question.slice(Math.max(0, m.index! - 40), m.index!)))) return null;
  const kind = mentions[0]![1]!.toLowerCase();
  const dimensions: Measures = {};
  for (const match of question.matchAll(/\b(base height|base side|length|width|breadth|height|edge|side|base)\s*(?:of\s+|is\s+|=\s*)?(\d+(?:\.\d+)?)\s*(mm|cm|km|m)\b/gi)) {
    if (/slant\s*$/i.test(question.slice(Math.max(0, match.index! - 8), match.index!))) continue;
    const name = match[1]!.toLowerCase();
    const key = name === "base height" ? "baseHeight" : name === "base side" || name === "edge" ? "side" : name === "breadth" ? "width" : name as keyof Measures;
    const measure = { value: Number(match[2]), unit: match[3]!.toLowerCase() };
    const prior = dimensions[key];
    if (prior && Math.abs(prior.value * UNIT_SCALE[prior.unit]! - measure.value * UNIT_SCALE[measure.unit]!) > 1e-9) return null;
    dimensions[key] = measure;
  }
  // A dimension triplet in the source has the conventional length × width × height order.
  const triplet = question.match(/\b(\d+(?:\.\d+)?)\s*(mm|cm|km|m)?\s*[×x]\s*(\d+(?:\.\d+)?)\s*(mm|cm|km|m)?\s*[×x]\s*(\d+(?:\.\d+)?)\s*(mm|cm|km|m)\b/i);
  if (triplet && (kind === "cube" || kind === "cuboid")) {
    for (const [i, key] of (["length", "width", "height"] as const).entries()) {
      const measure = { value: Number(triplet[1 + i * 2]), unit: (triplet[2 + i * 2] ?? triplet[6]!).toLowerCase() };
      const prior = dimensions[key];
      if (prior && Math.abs(prior.value * UNIT_SCALE[prior.unit]! - measure.value * UNIT_SCALE[measure.unit]!) > 1e-9) return null;
      dimensions[key] = measure;
    }
  }
  if (kind === "cube") {
    const edges = [dimensions.side, dimensions.length, dimensions.width, dimensions.height].filter((m): m is Measure => Boolean(m));
    if (edges.some((m) => Math.abs(m.value * UNIT_SCALE[m.unit]! - edges[0]!.value * UNIT_SCALE[edges[0]!.unit]!) > 1e-9)) return null;
  }
  if (kind === "cube" && dimensions.side) dimensions.length = dimensions.width = dimensions.height = dimensions.side;
  const unit = Object.values(dimensions)[0]?.unit;
  if (!unit || Object.values(dimensions).some((m) => !(m.value > 0 && Number.isFinite(m.value)))) return null;
  const length = (m: Measure) => m.value * UNIT_SCALE[m.unit]! / UNIT_SCALE[unit]!;
  const prefix = question.slice(Math.max(0, mentions[0]!.index! - 40), mentions[0]!.index!);
  const descriptor = prefix + " " + question.slice(mentions[0]!.index! + mentions[0]![0].length);
  let base: Record<string, unknown>;
  let measures: Array<{ name: string; role: string; value: Measure }>;
  let h = dimensions.height;
  if (kind === "cube" || kind === "cuboid" || /\brectangular\b/i.test(descriptor)) {
    if (!dimensions.length || !dimensions.width || !h) return null;
    base = { kind: "rectangle", length: length(dimensions.length), width: length(dimensions.width) };
    measures = [{ name: "l", role: "base length", value: dimensions.length }, { name: "w", role: "base width", value: dimensions.width }];
  } else if (/\bright triangular\b/i.test(descriptor)) {
    if (!dimensions.base || !dimensions.baseHeight) return null;
    h ??= dimensions.length;
    base = { kind: "polygon", vertices: [[0, 0], [length(dimensions.base), 0], [0, length(dimensions.baseHeight)]] };
    measures = [{ name: "b", role: "base edge", value: dimensions.base }, { name: "a", role: "base altitude", value: dimensions.baseHeight }];
  } else {
    const regular = /\bregular\b/i.test(descriptor);
    const namedSides = /\bsquare\b/i.test(descriptor) ? 4 : /\bequilateral\b/i.test(descriptor) ? 3
      : regular && /\bpentagonal\b/i.test(descriptor) ? 5 : regular && /\bhexagonal\b/i.test(descriptor) ? 6 : regular && /\boctagonal\b/i.test(descriptor) ? 8 : null;
    const sided = descriptor.match(/\b(\d+)[- ]sided\b/i);
    const sides = namedSides ?? (sided && /\bregular\b/i.test(descriptor) ? Number(sided[1]) : null);
    if (!sides || !dimensions.side) return null;
    h ??= kind === "prism" ? dimensions.length : undefined;
    base = sides === 4 ? { kind: "rectangle", length: length(dimensions.side), width: length(dimensions.side) }
      : { kind: "regular_polygon", sides, side: length(dimensions.side) };
    measures = [{ name: "s", role: "base side", value: dimensions.side }];
  }
  if (!h) return null;
  const inputs = { kind: "polyhedron", base, height: length(h), topScale: kind === "pyramid" ? 0 : 1 };
  let spec;
  try { spec = readPolyhedralSolid(inputs, Number); } catch { return null; }
  const entities: SceneEntity[] = [
    { id: "solid_center", kind: "point", role: "construction helper point" },
    { id: kind, kind: "polyline", role: `${kind} polyhedral solid`, label: kind },
  ];
  const constructions: SceneConstruction[] = [
    { id: "make_center", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["solid_center"] },
    { id: "make_solid", operator: "solid_projection", inputs: { center: "solid_center", ...inputs }, outputs: [kind] },
  ];
  const dimensionIds: string[] = [];
  const addDimension = (name: string, role: string, value: Measure, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const id = `${kind}_${name}`;
    for (const [suffix, p] of [["a", a], ["b", b]] as const) {
      entities.push({ id: `${id}_${suffix}`, kind: "point", role: "construction helper point" });
      constructions.push({ id: `make_${id}_${suffix}`, operator: "point", inputs: { ...p, coordinateSpace: "world" }, outputs: [`${id}_${suffix}`] });
    }
    entities.push({ id, kind: "dimension", role, label: `${name} = ${value.value} ${value.unit}` });
    constructions.push({ id: `make_${id}`, operator: "dimension", inputs: { start: `${id}_a`, end: `${id}_b` }, outputs: [id] });
    dimensionIds.push(id);
  };
  const center = { x: 0, y: 0 };
  const projected = spec.base.map((p) => projectSolidPoint(center, p, 0));
  addDimension(measures[0]!.name, measures[0]!.role, measures[0]!.value, projected[0]!, projected[1]!);
  if (measures[1]) {
    // A right triangle's other leg joins vertex 0 to 2; a rectangle's
    // width joins vertex 1 to 2. Never label the hypotenuse as base altitude.
    addDimension(measures[1].name, measures[1].role, measures[1].value, base.kind === "polygon" ? projected[0]! : projected[1]!, projected[2]!);
  }
  const right = Math.max(...projected.map((p) => p.x)) + length(h) * 0.2;
  addDimension("h", "perpendicular height", h, { x: right, y: 0 }, { x: right, y: spec.height });
  // Name each compiled measurement so the shared reveal conductor letters it
  // during the figure introduction instead of withholding it for a later FOCUS.
  const spokenDimensions = entities.filter((entity) => dimensionIds.includes(entity.id))
    .map((entity) => `${entity.role} ${entity.label}`);
  const dimensionList = spokenDimensions.length === 2 ? spokenDimensions.join(" and ")
    : `${spokenDimensions.slice(0, -1).join(", ")}, and ${spokenDimensions.at(-1)}`;
  const groups: SceneRevealGroup[] = [{ id: "solid_setup", entityIds: [kind, ...dimensionIds], dependsOn: [], narrationCue: `Here is the ${kind}, with ${dimensionList}.` }];
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "source-defined base extruded or tapered by the geometry engine" },
    source: { question, synthesizedFamily: true }, quantities: [], entities, constructions, relations: [], annotations: [],
    requiredEntityIds: [kind, ...dimensionIds], assertions: dimensionIds.map((id) => ({ id: `${id}_readable`, predicate: "label_attached", entities: [id], expected: true, severity: "fatal" })),
    revealGroups: groups, teachingTimeline: [{ id: "show_solid", action: "reveal", targetId: "solid_setup", dependsOn: [], narrationIntent: groups[0]!.narrationCue }],
  };
}
