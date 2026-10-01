/** Source-defined planar boundaries composed from existing geometry operators. */
import { SCENE_DOCUMENT_VERSION, type SceneConstruction, type SceneDocument, type SceneEntity } from "../types";

interface Measure { value: number; unit: string }
const UNIT_SCALE: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, km: 1000 };

export function buildPlanarMensuration(question: string): SceneDocument | null {
  if (/\b(?:prism|pyramid|cuboid|cube|cone|cylinder|sphere|hemisphere|frustum|sector|semicircle|triangle|trapezium|trapezoid)\b/i.test(question)) return null;
  const rectangular = /\b(?:rectangle|rectangular|square)\b/i.test(question);
  const circular = /\b(?:circle|circular)\b/i.test(question);
  if (!rectangular && !circular) return null;
  const measures: Partial<Record<"length" | "width" | "radius" | "side", Measure>> = {};
  const set = (key: keyof typeof measures, value: number, unit: string) => {
    const prior = measures[key];
    if (prior && Math.abs(prior.value * UNIT_SCALE[prior.unit]! - value * UNIT_SCALE[unit]!) > 1e-9) return false;
    measures[key] = { value, unit };
    return true;
  };
  for (const m of question.matchAll(/\b(length|width|breadth|radius|diameter|side)\s*(?:of\s+|is\s+|=\s*)?(\d+(?:\.\d+)?)\s*(mm|cm|km|m)\b/gi)) {
    const name = m[1]!.toLowerCase();
    if (!set(name === "diameter" ? "radius" : name === "breadth" ? "width" : name as keyof typeof measures, Number(m[2]) / (name === "diameter" ? 2 : 1), m[3]!.toLowerCase())) return null;
  }
  for (const m of question.matchAll(/\b(\d+(?:\.\d+)?)\s*(mm|cm|km|m)\s+(long|wide)\b/gi)) {
    if (!set(m[3]!.toLowerCase() === "long" ? "length" : "width", Number(m[1]), m[2]!.toLowerCase())) return null;
  }
  if (/\bsquare\b/i.test(question) && measures.side) measures.length = measures.width = measures.side;
  if (rectangular && (!measures.length || !measures.width) || circular && !measures.radius) return null;
  const unit = Object.values(measures)[0]?.unit;
  if (!unit || Object.values(measures).some((m) => !Number.isFinite(m.value) || m.value <= 0)) return null;
  const length = (m: Measure) => m.value * UNIT_SCALE[m.unit]! / UNIT_SCALE[unit]!;
  const l = measures.length ? length(measures.length) : 0;
  const w = measures.width ? length(measures.width) : 0;
  const r = measures.radius ? length(measures.radius) : 0;
  // Multiple boundaries need source membership/location, never a guessed
  // hole or two silently combined, independently named measurements.
  if (rectangular && circular && (!/\b(?:centre|center)\b/i.test(question) || 2 * r > Math.min(l, w))) return null;
  if (/\b(?:two|three|several|overlap|sector|semicircle)\b/i.test(question)) return null;
  const entities: SceneEntity[] = [];
  const constructions: SceneConstruction[] = [];
  const visible: string[] = [];
  const point = (id: string, x: number, y: number) => {
    entities.push({ id, kind: "point", role: "construction helper point" });
    constructions.push({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] });
    return id;
  };
  const dimension = (id: string, symbol: string, value: Measure, a: string, b: string) => {
    entities.push({ id, kind: "dimension", role: `${symbol} dimension`, label: `${symbol} = ${value.value} ${value.unit}` });
    constructions.push({ id: `make_${id}`, operator: "dimension", inputs: { start: a, end: b }, outputs: [id] });
    visible.push(id);
  };
  const center = point("region_center", 0, 0);
  if (rectangular) {
    entities.push({ id: "rectangle", kind: "polygon", role: "rectangular source region", label: "rectangle" });
    constructions.push({ id: "make_rectangle", operator: "rectangle", inputs: { center, width: l, height: w }, outputs: ["rectangle"] });
    visible.push("rectangle");
    const a = point("corner_a", -l / 2, -w / 2);
    const b = point("corner_b", l / 2, -w / 2);
    const c = point("corner_c", l / 2, w / 2);
    dimension("region_length", "l", measures.length!, a, b);
    dimension("region_width", "w", measures.width!, b, c);
  }
  if (circular) {
    entities.push({ id: "circle", kind: "circle", role: "circular source region", label: "circle" });
    constructions.push({ id: "make_circle", operator: "circle", inputs: { center, radius: r }, outputs: ["circle"] });
    visible.push("circle");
    dimension("region_radius", "r", measures.radius!, center, point("radius_rim", r, 0));
  }
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "source-defined planar boundaries and dimensions" },
    source: { question, synthesizedFamily: true }, quantities: [], entities, constructions, relations: [], annotations: [],
    requiredEntityIds: visible,
    assertions: [
      ...visible.map((id) => ({ id: `${id}_readable`, predicate: "label_attached", entities: [id], expected: true, severity: "fatal" as const })),
      ...(rectangular && circular ? [{ id: "contained_circle", predicate: "inside", entities: ["circle", "rectangle"], expected: true, severity: "fatal" as const }] : []),
    ],
    revealGroups: [{ id: "region_setup", entityIds: visible, dependsOn: [], narrationCue: "introduce the boundaries and their given dimensions" }],
    teachingTimeline: [{ id: "show_region", action: "reveal", targetId: "region_setup", dependsOn: [], narrationIntent: "read the source region before computing its area" }],
  };
}
