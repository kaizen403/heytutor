import { attemptArchetypeScene, POINT_LABEL_TETHER_PX, type RenderPoint } from "../../src/index";
import { ARCHETYPE_PROBES } from "../probes/archetypeProbes";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const samePoint = (a: RenderPoint, b: RenderPoint) => Math.hypot(a.x - b.x, a.y - b.y) < 0.02;

for (const id of ["incline-fbd", "collision", "wire-field", "topic-magnetic-dipole-torque", "topic-centre-of-mass"]) {
  const probe = ARCHETYPE_PROBES.find((probe) => probe.id === id)!;
  const attempt = attemptArchetypeScene({ question: probe.question });
  const scene = attempt.scene;
  assert(scene, `${id} must retain every physical body and meaningful label: ${JSON.stringify(attempt.issues)}`);
  const primitives = scene.renderScene.primitives;
  for (const entity of scene.document.entities.filter((entity) => entity.kind === "point" && entity.label && /^[A-Za-z][A-Za-z0-9_]{0,2}$/.test(entity.label))) {
    const point = primitives.find((primitive) => primitive.kind === "point" && primitive.entityId === entity.id)?.points[0];
    const label = primitives.find((primitive) => primitive.kind === "label" && primitive.entityId === entity.id);
    assert(point && label && Math.hypot(point.x - label.points[0]!.x, point.y - label.points[0]!.y) <= POINT_LABEL_TETHER_PX + 0.02,
      `${id} point ${entity.id} must stay in its bounded neighborhood.`);
  }
  if (id === "incline-fbd" || id === "collision") {
    const anchors = id === "incline-fbd" ? ["G"] : ["C1", "C2"];
    assert(!primitives.some((primitive) => anchors.includes(primitive.entityId)), "Construction body centres must not add duplicate physical labels.");
    const requiredLabels = id === "incline-fbd" ? ["body", "weight", "normal"] : ["body1", "body2"];
    assert(requiredLabels.every((entityId) => primitives.some((primitive) => primitive.kind === "label" && primitive.entityId === entityId)), "Every body and force must retain its own label.");
  }
  if (id === "topic-magnetic-dipole-torque") {
    const magnet = primitives.find((primitive) => primitive.entityId === "magnet" && primitive.kind === "polygon")!;
    for (const [pole, force] of [["N", "F_N"], ["S", "F_S"]]) {
      const anchor = primitives.find((primitive) => primitive.entityId === pole && primitive.kind === "point")!.points[0]!;
      const arrow = primitives.find((primitive) => primitive.entityId === force && primitive.kind === "vector")!;
      assert(samePoint(anchor, arrow.points[0]!), "A pole force must start at its true pole.");
      assert(magnet.points.some((point, index) => samePoint(anchor, {
        x: (point.x + magnet.points[(index + 1) % magnet.points.length]!.x) / 2,
        y: (point.y + magnet.points[(index + 1) % magnet.points.length]!.y) / 2,
      })), "Each magnetic pole must sit on the actual end face.");
    }
  }
  if (id === "wire-field") {
    const wire = primitives.find((primitive) => primitive.entityId === "wire" && primitive.kind === "circle")!;
    const current = primitives.find((primitive) => primitive.entityId === "current" && primitive.kind === "point")!;
    assert(samePoint(wire.points[0]!, current.points[0]!), "The page-normal current dot must remain exactly at the wire cross-section centre.");
    assert(primitives.some((primitive) => primitive.entityId === "wire" && primitive.kind === "label" && primitive.text === "I"), "The current name must attach to the wire contour.");
    const radius = primitives.find((primitive) => primitive.entityId === "radius" && primitive.kind === "dimension")!;
    const fieldPoint = primitives.find((primitive) => primitive.entityId === "P" && primitive.kind === "point")!.points[0]!;
    assert(samePoint(radius.provenance?.measuredStart as RenderPoint, wire.points[0]!) && samePoint(radius.provenance?.measuredEnd as RenderPoint, fieldPoint), "A wire radius measurement must retain the exact centre and observation-point endpoints.");
  }
  if (id === "topic-centre-of-mass") {
    for (const index of [1, 2]) {
      const body = primitives.find((primitive) => primitive.entityId === `body${index}` && primitive.kind === "circle")!;
      const guide = primitives.find((primitive) => primitive.entityId === `position_guide${index}` && primitive.kind === "line")!;
      const foot = primitives.find((primitive) => primitive.entityId === `coordinate${index}` && primitive.kind === "point")!.points[0]!;
      assert(samePoint(body.points[0]!, guide.points[0]!) && samePoint(foot, guide.points[1]!), "A coordinate guide must join the exact body centre and its axis projection.");
      assert(Math.abs(guide.points[0]!.x - foot.x) < 0.02, "Coordinate guides must preserve the body's actual x position.");
    }
  }
}
console.log("verify-archetype-point-ownership: exact bodies, poles and coordinate projections retain bounded labels");
