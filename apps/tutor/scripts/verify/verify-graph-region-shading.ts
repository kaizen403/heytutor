/**
 * Shading on the live board follows the compiled region, not its bounding box.
 *
 * Replays the scene document from the Accelute lesson v2/p4c-t2 (17 Oct 2026):
 * a v against t graph rising to 20 m/s at 4 s, flat to 10 s, with a highlight
 * annotation on the trapezium under it. The engine compiled the trapezium, but
 * the presentation turned every highlight into a HIGHLIGHT rectangle over the
 * outline's bounding box, so the board shaded the whole 0 to 10 s by 20 m/s
 * rectangle (200 m) while the voice said 160 m. The shading was also held
 * under the annotation's own id, so `[FOCUS:shaded_area]` never released it
 * and it appeared only when the lesson ended.
 */
import { compileSceneDocument, validateSceneDocument } from "@heytutor/scene-engine";
import { isBlockedVerifiedDiagramCommand, parseDrawingCommands, takeDeferredAnnotations } from "@heytutor/drawing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

type Point = { x: number; y: number };
const fixturePath = resolve(import.meta.dirname, "../../../../packages/scene-engine/scripts/verify/fixtures/motion-graph-regions-recorded.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { rows: Array<{ id: string; document: unknown }> };
const failures: string[] = [];
const check = (condition: unknown, message: string) => { if (!condition) failures.push(message); };

function insidePolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

for (const { id, regionId } of [
  { id: "p4c-t2/doc-4", regionId: "shaded_area" },
  { id: "p4c-t1/doc-5", regionId: "area" },
]) {
  const raw = fixture.rows.find((row) => row.id === id)?.document;
  const validation = validateSceneDocument(raw);
  const compiled = validation.document ? compileSceneDocument(validation.document) : null;
  if (!validation.document || !compiled?.ok || !compiled.renderScene) {
    failures.push(`${id}: recorded document no longer compiles`);
    continue;
  }
  const region = compiled.renderScene.primitives.find((primitive) => primitive.entityId === regionId && primitive.kind === "polygon")?.points;
  const highlight = compiled.renderScene.primitives.find((primitive) => primitive.provenance?.annotation === "highlight");
  if (!region || !highlight) {
    failures.push(`${id}: missing compiled region ${regionId} or its highlight`);
    continue;
  }
  const presentation = buildVerifiedDiagramPresentation(validation.document, compiled.renderScene);
  const shading = presentation.diagram.commands.filter((command) => command.semanticRef?.entityId === highlight.entityId);
  check(shading.length > 0, `${id}: the highlight produced no board command`);

  // A point inside the bounding box but above the rising line, outside the region.
  const xs = region.map((point) => point.x);
  const ys = region.map((point) => point.y);
  const outside: Point = { x: Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * 0.08, y: Math.min(...ys) + 6 };
  check(!insidePolygon(outside, region), `${id}: probe point must lie outside the compiled region`);
  for (const command of shading) {
    if (command.type === "HIGHLIGHT") {
      const [x, y, width, height] = command.params as [number, number, number, number];
      check(!(outside.x >= x && outside.x <= x + width && outside.y >= y && outside.y <= y + height),
        `${id}: HIGHLIGHT rectangle ${command.params.map((value) => value.toFixed(0)).join(",")} shades the triangle above the graph`);
      continue;
    }
    check(command.type === "DRAW_LINE" && command.visualStyle?.fillRole === "region" && command.visualStyle.strokeWidth === 0,
      `${id}: region shading must be a fill-only DRAW_LINE, got ${command.type}`);
    const vertices: Point[] = [];
    for (let index = 0; index + 1 < command.params.length; index += 2) vertices.push({ x: command.params[index]!, y: command.params[index + 1]! });
    check(highlight.points.every((point) => vertices.some((vertex) => Math.hypot(vertex.x - point.x, vertex.y - point.y) < 0.01)),
      `${id}: the shading must trace every vertex of the compiled region`);
    check(!insidePolygon(outside, vertices), `${id}: the shading covers the triangle above the graph`);
  }
  check(!presentation.introSegments.some((segment) => (segment.commands ?? []).some((command) => command.semanticRef?.entityId === highlight.entityId)),
    `${id}: shading must wait for the lecture to name the area, not land in the intro`);

  // FOCUS on the shaded entity releases the shading while the voice names it.
  const focus = parseDrawingCommands(`[STEP]now look at the shaded area. [FOCUS:${regionId}][/STEP]`).commands[0]!;
  check(!isBlockedVerifiedDiagramCommand(focus, presentation.diagram), `${id}: FOCUS on ${regionId} was blocked`);
  const annotate = parseDrawingCommands(`[STEP]shade it. [ANNOTATE:${highlight.entityId}][/STEP]`).commands[0]!;
  check(!isBlockedVerifiedDiagramCommand(annotate, presentation.diagram), `${id}: ANNOTATE on the highlight id was blocked`);
  const released = takeDeferredAnnotations(presentation.diagram, { entityIds: [regionId] });
  check(released.some((command) => command.visualStyle?.fillRole === "region"),
    `${id}: FOCUS on ${regionId} must release its shading; it was held until the lesson ended`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log("graph region shading verified: the board shades the compiled region when the voice names it");
