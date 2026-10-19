/**
 * An infinite ray is clipped to its view whatever the length of the segment
 * it was built from.
 *
 * `reflect_direction` keeps the incoming ray's length, and the clip measured
 * its forward hits against a far point a million of those lengths away. From
 * a long incident ray the in-view exit fell under that parameter's epsilon,
 * was dropped, and the reflected ray was drawn to a point a hundred million
 * pixels off the board (the board showed a 45 degree line where the
 * reflection was 65 degrees).
 *
 * A plane mirror reflects rays at 65 degrees to its surface from incident
 * rays of several lengths. Each reflected ray must end inside the board and
 * keep its 65 degree direction.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-infinite-ray-clip.ts
 */
import { compileSceneDocument, validateSceneDocument } from "../../src";

const DEG = Math.PI / 180;
const REFLECTED_DEGREES = 65;
// The compiler's default diagram view (compiler.ts `compileSceneDocument`); clipped rays end inside it.
const VIEW = { left: 410, top: 55, right: 410 + 740, bottom: 55 + 555 };
const failures: string[] = [];

function mirrorScene(incidentLength: number) {
  const ids = ["m1", "m2", "mirror", "hit", "src", "incident", "normal", "reflected"];
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "reflect an incident ray from a plane mirror" },
    source: { question: "A ray reflects from a plane mirror." },
    quantities: [],
    entities: [
      { id: "m1", kind: "point", role: "mirror end" },
      { id: "m2", kind: "point", role: "mirror end" },
      { id: "mirror", kind: "segment", role: "plane mirror" },
      { id: "hit", kind: "point", role: "point of incidence" },
      { id: "src", kind: "point", role: "source" },
      { id: "incident", kind: "vector", role: "incident ray" },
      { id: "normal", kind: "vector", role: "normal" },
      { id: "reflected", kind: "ray", role: "reflected ray" },
    ],
    constructions: [
      // A long mirror makes the view width-limited and puts the reflected
      // ray's exit close to the point of incidence.
      { id: "make_m1", operator: "point", inputs: { x: -8, y: 0, coordinateSpace: "world" }, outputs: ["m1"] },
      { id: "make_m2", operator: "point", inputs: { x: 0.3, y: 0, coordinateSpace: "world" }, outputs: ["m2"] },
      { id: "make_mirror", operator: "segment", inputs: { start: "m1", end: "m2" }, outputs: ["mirror"] },
      { id: "make_hit", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["hit"] },
      {
        id: "make_src",
        operator: "point",
        inputs: {
          x: -incidentLength * Math.cos(REFLECTED_DEGREES * DEG),
          y: incidentLength * Math.sin(REFLECTED_DEGREES * DEG),
          coordinateSpace: "world",
        },
        outputs: ["src"],
      },
      { id: "make_incident", operator: "vector", inputs: { start: "src", end: "hit" }, outputs: ["incident"] },
      { id: "make_normal", operator: "normal_at", inputs: { point: "hit", surface: "mirror" }, outputs: ["normal"] },
      { id: "make_reflected", operator: "reflect_direction", inputs: { origin: "hit", incoming: "incident", normal: "normal" }, outputs: ["reflected"] },
    ],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids }],
    teachingTimeline: [{ action: "reveal", targetId: "setup" }],
  };
}

for (const incidentLength of [0.5, 1, 4.7, 20, 100]) {
  const id = `incident ${incidentLength}`;
  const validated = validateSceneDocument(mirrorScene(incidentLength));
  const compiled = validated.document ? compileSceneDocument(validated.document) : null;
  if (!compiled?.ok || !compiled.renderScene) {
    failures.push(`${id}: did not compile: ${JSON.stringify((compiled?.report ?? validated.report).issues)}`);
    continue;
  }
  const ray = compiled.renderScene.primitives.find((primitive) => primitive.entityId === "reflected");
  if (!ray || ray.points.length !== 2) {
    failures.push(`${id}: reflected ray primitive missing or not two points`);
    continue;
  }
  const [start, end] = [ray.points[0]!, ray.points[1]!];
  if (!(end.x >= VIEW.left - 0.5 && end.x <= VIEW.right + 0.5 && end.y >= VIEW.top - 0.5 && end.y <= VIEW.bottom + 0.5)) {
    failures.push(`${id}: reflected ray ends off the board at (${end.x}, ${end.y})`);
  }
  // Screen y grows downward; the world angle is measured with y up.
  const degrees = Math.atan2(start.y - end.y, end.x - start.x) / DEG;
  // Endpoints are rounded to hundredths of a pixel.
  const tolerance = (0.01 / Math.hypot(end.x - start.x, end.y - start.y)) / DEG * 2;
  if (Math.abs(degrees - REFLECTED_DEGREES) > Math.max(tolerance, 0.01)) {
    failures.push(`${id}: reflected ray drawn at ${degrees.toFixed(3)} degrees, expected ${REFLECTED_DEGREES}`);
  }
  if (Math.hypot(end.x - start.x, end.y - start.y) < 40) {
    failures.push(`${id}: reflected ray is a ${Math.hypot(end.x - start.x, end.y - start.y).toFixed(1)} px stub`);
  }
}

if (failures.length > 0) {
  console.error(`infinite ray clip: ${failures.length} failure(s)\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("infinite ray clip: reflected rays keep 65 degrees and end on the board for incident lengths 0.5 to 100");
