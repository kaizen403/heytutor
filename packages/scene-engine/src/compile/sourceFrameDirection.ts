import { sourceUnquotedText } from "../document/sourceRequestScope";
import type { RenderPrimitive, RenderScene, SceneDocument, SceneEntity, SceneIssue } from "../types";

type Axis = "x" | "y" | "z";
type PageDirection = readonly [number, number, number];
interface NamedAxis { axis: Axis; sign: 1 | -1; name: string }
interface FrameOwnerClaim { entity: SceneEntity; axis: NamedAxis; alias?: SceneEntity }
interface SourceFrame { start: number; end: number; text: string; directions: Partial<Record<Axis, PageDirection>> }
const NEGATIVE = /\b(?:not|never|false|incorrect|unknown|unspecified|reported|reportedly|reports?|claims?|says?|hypothetical|if|unless|maybe|another|different|separate|rotated|tilted|oblique)\b/iu;
const FRAME = /\b(?:frame|basis|axes)\b/giu;
const DECLARATION = /([+−-])\s*([xyz])\b\s*(?:(?:axis\s+)?(?:is|points?)\s+)?(right(?:ward)?|left(?:ward)?|up(?:ward)?|down(?:ward)?|out\s+of\s+(?:the\s+)?(?:page|plane|screen)|(?:in|into)\s+(?:the\s+)?(?:page|plane|screen))/gu;
const PAGE = new Map<string, PageDirection>([["right", [1, 0, 0]], ["rightward", [1, 0, 0]], ["left", [-1, 0, 0]], ["leftward", [-1, 0, 0]], ["up", [0, -1, 0]], ["upward", [0, -1, 0]], ["down", [0, 1, 0]], ["downward", [0, 1, 0]]]);
const normalize = (text: string): string => text.normalize("NFKC").replace(/\s+/gu, " ").trim();
function axisName(text: unknown): NamedAxis | null {
  if (typeof text !== "string") return null;
  const match = /^([+−-])\s*([xyz])$/u.exec(normalize(text));
  return match ? { axis: match[2] as Axis, sign: match[1] === "+" ? 1 : -1, name: normalize(text) } : null;
}
function frameOwner(entity: SceneEntity): NamedAxis | null {
  // A primary signed axis label is a visible frame claim. A model role cannot
  // rename it into a force/vector/arrow and suppress the original direction.
  return axisName(entity.label);
}
function sourceFrame(question: string): SourceFrame | null | false {
  if (typeof question !== "string" || question.length > 16384) return false;
  const source = sourceUnquotedText(question);
  const rawHeads = [...question.matchAll(FRAME)], heads = [...source.matchAll(FRAME)];
  if (!rawHeads.length) return null;
  if (rawHeads.length !== 1 || heads.length !== 1) return false;
  const head = heads[0]!;
  let start = 0;
  for (const boundary of source.slice(0, head.index).matchAll(/[;!?\n]|\.(?=\s|$)/gu)) start = boundary.index! + 1;
  const tail = source.slice(head.index!), boundary = /[!?]|\.(?=\s|$)/u.exec(tail);
  const end = boundary ? head.index! + boundary.index : source.length;
  if (end - start > 2048 || NEGATIVE.test(source.slice(start, end))) return false;
  const text = source.slice(start, end), directions: Partial<Record<Axis, PageDirection>> = {};
  const statements = [...text.matchAll(DECLARATION)];
  if (!statements.length) return false;
  for (const statement of statements) {
    const axis = statement[2] as Axis, sign = statement[1] === "+" ? 1 : -1, phrase = statement[3]!.replace(/\s+/gu, " ");
    const page = PAGE.get(phrase) ?? (phrase.startsWith("out ") ? [0, 0, 1] as const : [0, 0, -1] as const);
    if (directions[axis] || (axis === "z") !== (page[2] !== 0) || axis === "x" && page[0] === 0 || axis === "y" && page[1] === 0) return false;
    directions[axis] = [page[0] * sign, page[1] * sign, page[2] * sign];
  }
  // An unsupported extra signed-axis clause cannot borrow an earlier valid
  // declaration, including another basis or an unresolved spatial direction.
  const signed = [...text.matchAll(/[+−-]\s*[xyz]\b/gu)];
  if (signed.some(token => !statements.some(statement => token.index! >= statement.index! && token.index! < statement.index! + statement[0].length))) {
    const extra = signed.filter(token => !statements.some(statement => token.index! >= statement.index! && token.index! < statement.index! + statement[0].length));
    // The source's angular-sign convention may repeat +z after the coordinate
    // declarations; it adds no second frame or missing coordinate direction.
    if (extra.some(token => token[0].replace(/\s/gu, "") !== "+z" || directions.z?.[2] !== 1 ||
      !/(?:^|[;.!?\n])\s*positive\s+angular\s+quantities\s+about\s+$/iu.test(text.slice(0, token.index!)) ||
      !/^\s+are\s+(?:anticlockwise|counterclockwise)\s*$/iu.test(text.slice(token.index! + token[0].length)))) return false;
  }
  // Coordinate claims later in the original question can contradict the
  // frame without repeating the word frame. Read every unquoted direct
  // signed-axis declaration, retaining the same source/size bound. Negated,
  // reported and hypothetical clauses do not add a current declaration.
  for (const statement of source.matchAll(DECLARATION)) {
    if (statement.index! >= start && statement.index! < end) continue;
    let clauseStart = 0;
    for (const split of source.slice(0, statement.index).matchAll(/[;!?\n]|\.(?=\s|$)/gu)) clauseStart = split.index! + 1;
    const after = source.slice(statement.index!), split = /[;!?\n]|\.(?=\s|$)/u.exec(after);
    const clauseEnd = split ? statement.index! + split.index : source.length;
    const clause = source.slice(clauseStart, clauseEnd);
    if (NEGATIVE.test(clause)) continue;
    const axis = statement[2] as Axis, sign = statement[1] === "+" ? 1 : -1, phrase = statement[3]!.replace(/\s+/gu, " ");
    const page = PAGE.get(phrase) ?? (phrase.startsWith("out ") ? [0, 0, 1] as const : [0, 0, -1] as const);
    const proposed = [page[0] * sign, page[1] * sign, page[2] * sign];
    if (!directions[axis] || proposed.some((value, index) => value !== directions[axis]![index])) return false;
  }
  return { start, end, text: question.slice(start, end), directions };
}
const finitePoint = (point: unknown): point is { x: number; y: number } => Boolean(point && typeof point === "object" &&
  typeof (point as { x?: unknown }).x === "number" && typeof (point as { y?: unknown }).y === "number" &&
  Number.isFinite((point as { x: number }).x) && Number.isFinite((point as { y: number }).y));
function near(a: number, b: number): boolean { return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)); }
function samePoint(a: { x: number; y: number }, b: { x: number; y: number }): boolean { return near(a.x, b.x) && near(a.y, b.y); }
function physicalDirection(primitive: RenderPrimitive, expected: PageDirection): boolean {
  const raw = primitive.provenance?.physicalDirection;
  if (!raw || typeof raw !== "object") return false;
  const value = raw as { frameId?: unknown; a?: { x?: unknown; y?: unknown; z?: unknown }; b?: { x?: unknown; y?: unknown; z?: unknown }; length?: unknown };
  if (value.frameId !== "__page_direction_frame" || !value.a || !value.b ||
      ![value.a.x, value.a.y, value.a.z, value.b.x, value.b.y, value.b.z, value.length].every(v => typeof v === "number" && Number.isFinite(v))) return false;
  const delta = [Number(value.b.x) - Number(value.a.x), Number(value.b.y) - Number(value.a.y), Number(value.b.z) - Number(value.a.z)];
  if (!delta.every(Number.isFinite) || !(Number(value.length) > 0)) return false;
  const along = delta[0]! * expected[0] + delta[1]! * expected[1] + delta[2]! * expected[2];
  return along > 0 && delta.every((v, i) => expected[i] === 0 ? v === 0 : near(v / along, expected[i]!));
}
function planarMark(primitives: RenderPrimitive[], expected: PageDirection): boolean {
  if (primitives.length !== 1) return false;
  const primitive = primitives[0]!;
  if (!["vector", "ray"].includes(primitive.kind) || primitive.points.length !== 2 || primitive.provenance?.pageNormal !== undefined) return false;
  const [a, b] = primitive.points;
  if (!finitePoint(a) || !finitePoint(b)) return false;
  const dx = b.x - a.x, dy = b.y - a.y, along = dx * expected[0] + dy * expected[1], across = dx * expected[1] - dy * expected[0];
  if (!Number.isFinite(along) || !Number.isFinite(across) || !(along > 0) || Math.abs(across) > along * 1e-6) return false;
  return primitive.provenance?.physicalDirection === undefined || physicalDirection(primitive, [expected[0], -expected[1], expected[2]]);
}
function normalMarks(primitives: RenderPrimitive[], expected: PageDirection): boolean {
  const sign = expected[2];
  if (![1, -1].includes(sign) || primitives.length !== (sign === 1 ? 2 : 3) ||
      primitives.some(p => p.provenance?.pageNormal !== sign || !physicalDirection(p, expected))) return false;
  const rings = primitives.filter(p => p.kind === "circle");
  if (rings.length !== 1 || rings[0]!.points.length !== 1 || !finitePoint(rings[0]!.points[0]) || !(rings[0]!.radius! > 0) || !Number.isFinite(rings[0]!.radius)) return false;
  const center = rings[0]!.points[0]!, marks = primitives.filter(p => p !== rings[0]);
  if (sign === 1) return marks.length === 1 && marks[0]!.kind === "point" && marks[0]!.points.length === 1 &&
    finitePoint(marks[0]!.points[0]) && samePoint(center, marks[0]!.points[0]!);
  if (marks.length !== 2 || marks.some(p => p.kind !== "line" || p.points.length !== 2 || p.points.some(point => !finitePoint(point)))) return false;
  const vectors = marks.map(mark => {
    const [a, b] = mark.points;
    return { x: b!.x - a!.x, y: b!.y - a!.y, midpoint: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 } };
  });
  if (vectors.some(v => !Number.isFinite(v.x) || !Number.isFinite(v.y) || v.x === 0 || v.y === 0 || !samePoint(v.midpoint, center))) return false;
  const norm = Math.hypot(vectors[0]!.x, vectors[0]!.y) * Math.hypot(vectors[1]!.x, vectors[1]!.y);
  return norm > 0 && Number.isFinite(norm) && Math.abs(vectors[0]!.x * vectors[1]!.x + vectors[0]!.y * vectors[1]!.y) <= norm * 1e-6;
}
/** Refuse false source-frame glyphs in the current revealed compiler scene.
 * This does not demand an omitted frame or confer numeric/physical authority.
 * All callers must retain full source validation and a fresh compile; model
 * inputs, IDs, captions and stored render objects cannot supply this proof.
 */
export function sourceFrameDirectionIssues(document: SceneDocument, renderScene: RenderScene | null, originalQuestion: string): SceneIssue[] {
  if (document.visualDecision.mode !== "scene") return [];
  const owners = document.entities.flatMap<FrameOwnerClaim>(entity => {
    const axis = frameOwner(entity);
    if (!axis) return [];
    if (entity.kind === "label") {
      const labelProducers = document.constructions.filter(c => c.outputs.includes(entity.id));
      const labelProducer = labelProducers.length === 1 ? labelProducers[0] : undefined;
      const targetId = labelProducer?.inputs.target ?? labelProducer?.inputs.at ?? labelProducer?.inputs.point;
      const target = typeof targetId === "string" ? document.entities.find(e => e.id === targetId && e.kind !== "label") : undefined;
      const literal = axisName(labelProducer?.inputs.text);
      if (target && labelProducer?.operator === "label" && labelProducer.outputs.length === 1 && literal?.axis === axis.axis && literal.sign === axis.sign) {
        return [{ entity: target, axis, alias: entity }];
      }
    }
    return [{ entity, axis, alias: undefined }];
  });
  if (!owners.length) return [];
  const frame = sourceFrame(originalQuestion);
  if (frame === null) return [];
  const issue = (entityIds: string[], message: string, axis?: NamedAxis): SceneIssue => ({ code: "source_frame_direction_unproved", severity: "fatal", failureKind: "truth", path: "source.question", entityIds, message,
    ...(frame && axis ? { expected: { start: frame.start, end: frame.end, text: frame.text, axis: axis.name, direction: frame.directions[axis.axis]?.map(value => value * axis.sign) } } : {}) });
  if (!frame) return [issue(owners.map(owner => owner.entity.id), "The rendered signed frame axes need one explicit, positive, unquoted and unambiguous original frame declaration.")];
  return owners.flatMap(({ entity, axis, alias }) => {
    const expected = frame.directions[axis.axis]?.map(value => value * axis.sign) as PageDirection | undefined;
    const producer = document.constructions.filter(c => c.outputs.includes(entity.id));
    const validSource = document.source.question === originalQuestion && document.entities.filter(e => e.id === entity.id).length === 1 &&
      document.requiredEntityIds.filter(id => id === entity.id).length === 1 && producer.length === 1 && producer[0]!.outputs.length === 1 &&
      ["vector", "ray", "line", "segment", "polyline", "space_vector", "space_line"].includes(producer[0]!.operator);
    const aliases = alias && renderScene ? renderScene.primitives.filter(p => p.entityId === alias.id && p.kind === "label" &&
      axisName(p.text)?.axis === axis.axis && axisName(p.text)?.sign === axis.sign) : [];
    const aliasVisible = !alias || document.entities.filter(e => e.id === alias.id).length === 1 &&
      document.requiredEntityIds.filter(id => id === alias.id).length === 1 && aliases.length === 1 &&
      document.revealGroups.filter(g => g.id === aliases[0]!.groupId && g.entityIds.includes(alias.id)).length === 1 &&
      renderScene!.revealGroups.filter(g => g.id === aliases[0]!.groupId && g.entityIds.includes(alias.id)).length === 1;
    const primitives = renderScene?.primitives.filter(p => p.entityId === entity.id && p.kind !== "label" && p.provenance?.labelLeader !== true) ?? [];
    const unique = new Set(primitives.map(p => p.id)).size === primitives.length;
    const reveal = primitives.length > 0 && primitives.every(p => document.revealGroups.filter(g => g.id === p.groupId && g.entityIds.includes(entity.id)).length === 1 &&
      renderScene!.revealGroups.filter(g => g.id === p.groupId && g.entityIds.includes(entity.id)).length === 1);
    if (expected && renderScene && validSource && aliasVisible && unique && reveal && (axis.axis === "z" ? normalMarks(primitives, expected) : planarMark(primitives, expected))) return [];
    return [issue([entity.id], `Source frame ${axis.name} has no unique required, revealed native mark with the original direction and retained producer.`, axis)];
  });
}
