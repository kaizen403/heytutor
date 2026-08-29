/** Coordinate-geometry archetypes computed from the stated equations and lengths. */
import { SceneBuilder, fmt, type Vec2 } from "../document";
import { grounded, maybeNum, num, numbers, type GeneratorContext, type GeneratorTable } from "./context";

function circleAndPoint(context: GeneratorContext) {
  const cx = num(context, "cx", 0);
  const cy = num(context, "cy", 0);
  const r = maybeNum(context, "r");
  if (r === null || r <= 0) return null;
  const px = maybeNum(context, "px");
  const py = maybeNum(context, "py");
  const scene = new SceneBuilder(context.question, "circle from its equation with the named point", "circle_and_point");
  scene.quantity("r", "r", r, "");
  const extent = Math.max(r, px !== null ? Math.abs(px - cx) : 0, py !== null ? Math.abs(py - cy) : 0) * 1.3 + 0.5;
  scene.axes("axes", cx - extent, cx + extent, cy - extent, cy + extent, "coordinate axes");
  scene.point("C", { x: cx, y: cy }, "centre", `C(${fmt(cx)}, ${fmt(cy)})`);
  scene.circle("circle", "C", r, "circle", `r=${fmt(r)}`);
  if (px !== null && py !== null) {
    const d = Math.hypot(px - cx, py - cy);
    scene.point("P", { x: px, y: py }, "named point", `P(${fmt(px)}, ${fmt(py)})`);
    if (d > r + 1e-6) {
      const base = Math.atan2(py - cy, px - cx);
      const alpha = Math.acos(r / d);
      const tangentPoints: Vec2[] = [base + alpha, base - alpha].map((angle) => ({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }));
      scene.point("T1", tangentPoints[0]!, "point of tangency", "T1");
      scene.point("T2", tangentPoints[1]!, "point of tangency", "T2");
      scene.segment("tangent1", "P", "T1", "tangent from P", `√(${fmt(d * d - r * r)})`);
      scene.segment("tangent2", "P", "T2", "tangent from P");
      scene.segment("radius1", "C", "T1", "radius to the point of tangency", "r");
      scene.segment("CP", "C", "P", "distance from the centre", `d=${fmt(d)}`);
      scene.assert("t1_on_circle", "on", ["T1", "circle"]);
      scene.assert("t2_on_circle", "on", ["T2", "circle"]);
      scene.assert("tangent_perp", "perpendicular", ["tangent1", "radius1"]);
      scene.assert("ratio", "distance_ratio", ["C", "T1", "C", "P"], Number((r / d).toFixed(6)));
    } else if (Math.abs(d - r) < 1e-6) {
      const direction: Vec2 = { x: -(py - cy) / r, y: (px - cx) / r };
      scene.point("tan_a", { x: px - direction.x * r, y: py - direction.y * r }, "tangent end");
      scene.point("tan_b", { x: px + direction.x * r, y: py + direction.y * r }, "tangent end");
      scene.line("tangent", "tan_a", "tan_b", "tangent at P", "tangent");
      scene.segment("radius", "C", "P", "radius to P", "r");
      scene.assert("p_on_circle", "on", ["P", "circle"]);
      scene.assert("tangent_perp", "perpendicular", ["tangent", "radius"]);
      scene.assert("radius_ratio", "distance_ratio", ["C", "P", "tan_a", "tan_b"], 0.5);
    } else {
      scene.segment("CP", "C", "P", "distance from the centre", `d=${fmt(d)}`);
      scene.assert("ratio", "distance_ratio", ["C", "P", "C", "T_ref"], Number((d / r).toFixed(6)));
      scene.point("T_ref", { x: cx + r, y: cy }, "point on the circle");
    }
  } else {
    scene.point("T_ref", { x: cx + r, y: cy }, "point on the circle", `(${fmt(cx + r)}, ${fmt(cy)})`);
    scene.segment("radius", "C", "T_ref", "radius", `r=${fmt(r)}`);
    scene.assert("ref_on_circle", "on", ["T_ref", "circle"]);
  }
  scene.labelled("C", "circle");
  return scene.build();
}

function triangleSides(context: GeneratorContext) {
  const a = maybeNum(context, "a");
  const b = maybeNum(context, "b");
  const c = maybeNum(context, "c");
  if (a === null || b === null || c === null) return null;
  if (a <= 0 || b <= 0 || c <= 0 || a + b <= c || b + c <= a || c + a <= b) return null;
  const ax = (c * c - b * b + a * a) / (2 * a);
  const ay = Math.sqrt(Math.max(c * c - ax * ax, 0));
  const scene = new SceneBuilder(context.question, `triangle with sides ${fmt(a)}, ${fmt(b)}, ${fmt(c)} constructed to scale`, "triangle_sides");
  scene.quantity("a", "a", a, "");
  scene.quantity("b", "b", b, "");
  scene.quantity("c", "c", c, "");
  scene.point("B", { x: 0, y: 0 }, "vertex", "B");
  scene.point("C", { x: a, y: 0 }, "vertex", "C");
  scene.point("A", { x: ax, y: ay }, "vertex", "A");
  scene.segment("side_c", "A", "B", "side AB", `c=${fmt(c)}`);
  scene.segment("side_a", "B", "C", "side BC", `a=${fmt(a)}`);
  scene.segment("side_b", "C", "A", "side CA", `b=${fmt(b)}`);
  const wantsCircumcircle = /\bcircumcircle|circumcentre|circumcenter|circumradius\b/i.test(context.question);
  const wantsIncircle = /\bincircle|incentre|incenter|inradius\b/i.test(context.question);
  if (wantsCircumcircle) {
    const d = 2 * (0 * (0 - ay) + a * (ay - 0) + ax * (0 - 0));
    const ux = ((0) * (0) * 0 + (a * a) * (ay - 0) + (ax * ax + ay * ay) * (0 - 0)) / d;
    const uy = ((0) * (0) + (a * a) * (0 - ax) + (ax * ax + ay * ay) * (a - 0)) / d;
    const radius = Math.hypot(ux - 0, uy - 0);
    scene.point("O", { x: ux, y: uy }, "circumcentre", "O");
    scene.circle("circumcircle", "O", radius, "circumcircle", `R=${fmt(radius)}`);
    scene.assert("a_on_circumcircle", "on", ["A", "circumcircle"]);
    scene.assert("b_on_circumcircle", "on", ["B", "circumcircle"]);
  }
  if (wantsIncircle) {
    const perimeter = a + b + c;
    const ix = (a * ax + b * 0 + c * a) / perimeter;
    const iy = (a * ay + b * 0 + c * 0) / perimeter;
    const s = perimeter / 2;
    const area = Math.sqrt(s * (s - a) * (s - b) * (s - c));
    scene.point("I", { x: ix, y: iy }, "incentre", "I");
    scene.circle("incircle", "I", area / s, "incircle", `r=${fmt(area / s)}`);
  }
  if (/\baltitude\b/i.test(context.question)) {
    scene.point("D", { x: ax, y: 0 }, "foot of the altitude from A", "D");
    scene.segment("altitude", "A", "D", "altitude from A", "h");
    scene.rightAngle("right_d", "D", "altitude", "side_a");
    scene.assert("altitude_perp", "perpendicular", ["altitude", "side_a"]);
  }
  scene.assert("ratio_ab", "distance_ratio", ["B", "C", "C", "A"], Number((a / b).toFixed(6)));
  scene.assert("ratio_ac", "distance_ratio", ["B", "C", "A", "B"], Number((a / c).toFixed(6)));
  scene.labelled("A", "B", "C");
  return scene.build();
}

function spacePointPlane(context: GeneratorContext) {
  const point = numbers(context, "point");
  const plane = numbers(context, "plane");
  if (point.length !== 3 || plane.length !== 4) return null;
  const [a, b, c, d] = plane as [number, number, number, number];
  const norm = a * a + b * b + c * c;
  if (norm === 0) return null;
  const t = (a * point[0]! + b * point[1]! + c * point[2]! - d) / norm;
  const foot: [number, number, number] = [point[0]! - a * t, point[1]! - b * t, point[2]! - c * t];
  const distance = Math.abs(t) * Math.sqrt(norm);
  const spread = Math.max(...point.map(Math.abs), ...foot.map(Math.abs), 1);
  const k = 2.5 / spread;
  const scene = new SceneBuilder(context.question, "point and plane in three dimensions with the perpendicular from the point", "space_point_plane");
  scene.point("origin", { x: 0, y: 0 }, "frame origin");
  scene.spaceFrame("frame", "origin", "frame");
  scene.plane("plane", "frame", [a, b, c, d * k], "plane", `${fmt(a)}x${b >= 0 ? "+" : ""}${fmt(b)}y${c >= 0 ? "+" : ""}${fmt(c)}z=${fmt(d)}`.slice(0, 16), 2.4);
  scene.spacePoint("P", "frame", [point[0]! * k, point[1]! * k, point[2]! * k], "point", `P(${point.map((value) => fmt(value)).join(",")})`);
  scene.spacePoint("N", "frame", [foot[0] * k, foot[1] * k, foot[2] * k], "nearest point N on the plane", "N");
  scene.segment("PN", "P", "N", "shortest distance PN from the point to the plane", grounded(context, "point") && grounded(context, "plane") ? `d=${fmt(distance)}` : "d");
  scene.labelled("P", "PN");
  return scene.build();
}

export const MATHS_GENERATORS: GeneratorTable = {
  circle_and_point: circleAndPoint,
  triangle_sides: triangleSides,
  space_point_plane: spacePointPlane,
};
