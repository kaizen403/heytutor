/**
 * Principal-ray geometry for spherical mirrors and thin lenses.
 *
 * The live figure used to clamp the through-F hit onto the object height and
 * mark every construction point with a large circle. This gate locks the
 * textbook pole-plane construction and the small named-point ink set.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-mirror-ray-diagram.ts
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-mirror-ray-diagram.ts --render /tmp/mirror-rays
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { attemptArchetypeScene } from "../../src/archetypes";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { renderSceneSvg } from "../lib/renderSceneSvg";
import type { SceneDocument } from "../../src/types";

interface WorldPoint { x: number; y: number }

const renderFlag = process.argv.indexOf("--render");
const renderDir = renderFlag >= 0 ? resolve(process.argv[renderFlag + 1] ?? "mirror-ray-diagrams") : null;
if (renderDir) mkdirSync(renderDir, { recursive: true });

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function nearly(actual: number, expected: number, eps = 1e-3): boolean {
  return Math.abs(actual - expected) <= eps;
}

function worldPoint(document: SceneDocument, id: string): WorldPoint | null {
  const construction = document.constructions.find((item) =>
    item.operator === "point" && item.outputs.includes(id));
  const x = construction?.inputs.x;
  const y = construction?.inputs.y;
  if (typeof x !== "number" || typeof y !== "number") return null;
  return { x, y };
}

function pointLineDistance(point: WorldPoint, a: WorldPoint, b: WorldPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return Math.abs(dx * (point.y - a.y) - dy * (point.x - a.x)) / length;
}

/** True when the interiors of two segments cross, not when they only share an end. */
function interiorsCross(a: WorldPoint, b: WorldPoint, c: WorldPoint, d: WorldPoint): boolean {
  const orient = (p: WorldPoint, q: WorldPoint, r: WorldPoint): number =>
    (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) return false;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function quantity(document: SceneDocument, symbol: string): number | null {
  const value = document.quantities.find((item) => item.symbol === symbol)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const MIRROR_INK_POINTS = new Set(["P", "C", "F", "O_base", "I_base"]);
const LENS_INK_POINTS = new Set(["O", "F1", "F2", "O_base", "I_base"]);

function checkMirror(
  id: string,
  question: string,
  expected: { u: number; f: number; v: number; m: number },
): void {
  const attempt = attemptArchetypeScene({ question });
  if (attempt.match?.id !== "spherical_mirror" || !attempt.scene) {
    fail(id, `expected spherical_mirror, got ${attempt.match?.id ?? "nothing"} (${attempt.declined ?? ""})`);
    return;
  }
  const { document, renderScene, tier } = attempt.scene;
  if (tier !== "exact_verified") fail(id, `tier ${tier} is not exact_verified`);
  const u = quantity(document, "u");
  const f = quantity(document, "f");
  const v = quantity(document, "v");
  if (u === null || !nearly(u, expected.u)) fail(id, `u is ${u}, expected ${expected.u}`);
  if (f === null || !nearly(f, expected.f)) fail(id, `f is ${f}, expected ${expected.f}`);
  if (v === null || !nearly(v, expected.v, 0.02)) fail(id, `v is ${v}, expected ${expected.v}`);

  const oTip = worldPoint(document, "O_tip");
  const m1 = worldPoint(document, "M1");
  const m2 = worldPoint(document, "M2");
  const focus = worldPoint(document, "F");
  const iTip = worldPoint(document, "I_tip");
  const iBase = worldPoint(document, "I_base");
  if (!oTip || !m1 || !m2 || !focus || !iTip || !iBase) {
    fail(id, "missing pole-plane construction points");
    return;
  }
  if (!nearly(m1.x, 0) || !nearly(m1.y, oTip.y)) {
    fail(id, `parallel-ray hit is (${m1.x}, ${m1.y}), expected (0, ${oTip.y})`);
  }
  if (!nearly(m2.x, 0) || !nearly(m2.y, iTip.y)) {
    fail(id, `through-F hit is (${m2.x}, ${m2.y}), expected (0, ${iTip.y})`);
  }
  if (!nearly(iTip.y, expected.m * oTip.y, 0.05)) {
    fail(id, `image height ${iTip.y} does not match m=${expected.m} times object height ${oTip.y}`);
  }
  if (!nearly(iBase.x, expected.v, 0.02)) fail(id, `image foot x=${iBase.x}, expected ${expected.v}`);
  if (pointLineDistance(focus, m1, iTip) > 0.02) {
    fail(id, "the parallel-reflected ray must pass through F and the image tip");
  }
  if (pointLineDistance(focus, oTip, m2) > 0.02) {
    fail(id, "the through-F incident ray must stay on the line O_tip–F–M2");
  }
  if (Math.abs(m2.y - iTip.y) > 0.02) {
    fail(id, "the second reflected ray must be parallel to the axis");
  }

  const dimFa = worldPoint(document, "dim_f_a");
  const dimFb = worldPoint(document, "dim_f_b");
  const pole = worldPoint(document, "P");
  if (!dimFa || !dimFb || !pole) {
    fail(id, "missing focal-length dimension anchors");
  } else {
    const dimLeft = dimFa.x < dimFb.x ? dimFa : dimFb;
    const dimRight = dimFa.x < dimFb.x ? dimFb : dimFa;
    const focusLeft = focus.x < pole.x ? focus : pole;
    const focusRight = focus.x < pole.x ? pole : focus;
    if (!nearly(dimLeft.x, focusLeft.x, 0.02) || !nearly(dimRight.x, focusRight.x, 0.02)) {
      fail(id, `f-bar spans x=${dimLeft.x}..${dimRight.x}, expected F–P ${focusLeft.x}..${focusRight.x}`);
    }
    if (Math.abs(dimFa.x - dimFb.x) < 0.02 || Math.abs(dimFa.y - dimFb.y) > 0.02) {
      fail(id, "f-bar must be a horizontal span from F to P");
    }
    const envelope = Math.min(0, iTip.y, m2.y) - 0.15 * Math.abs(oTip.y);
    if (dimFa.y > envelope || dimFb.y > envelope) {
      fail(id, `f-bar at y=${dimFa.y} still sits in the through-F corridor (must be below ${envelope})`);
    }
  }
  const dimUa = worldPoint(document, "dim_u_a");
  if (dimUa && dimUa.y < oTip.y + 0.15 * Math.abs(oTip.y)) {
    fail(id, `u-bar at y=${dimUa.y} must sit above the object, not in the ray corridor`);
  }

  const rayIds = new Set(["ray1_in", "ray2_in", "ray1_out", "ray2_out", "ray1_ext", "ray2_ext"]);
  const rayInk = renderScene.primitives.filter((primitive) =>
    rayIds.has(primitive.entityId) && primitive.points.length >= 2);
  const dimInk = renderScene.primitives.filter((primitive) =>
    (primitive.entityId === "dim_f" || primitive.entityId === "dim_u")
    && primitive.kind === "dimension"
    && primitive.points.length >= 2);
  for (const bar of dimInk) {
    const a = bar.points[0]!;
    const b = bar.points[1]!;
    for (const ray of rayInk) {
      for (let index = 0; index < ray.points.length - 1; index++) {
        if (interiorsCross(a, b, ray.points[index]!, ray.points[index + 1]!)) {
          fail(id, `${bar.entityId} is slashed by ${ray.entityId}`);
        }
      }
    }
  }
  for (const leader of renderScene.primitives) {
    if (leader.provenance?.annotation !== "callout" || leader.points.length < 2) continue;
    if (leader.entityId !== "F" && leader.entityId !== "dim_f") continue;
    for (const ray of rayInk) {
      for (let index = 0; index < ray.points.length - 1; index++) {
        if (interiorsCross(leader.points[0]!, leader.points[1]!, ray.points[index]!, ray.points[index + 1]!)) {
          fail(id, `${leader.entityId} leader slashes ${ray.entityId}`);
        }
      }
    }
  }

  const drawnPoints = renderScene.primitives.filter((primitive) => primitive.kind === "point");
  for (const primitive of drawnPoints) {
    if (!MIRROR_INK_POINTS.has(primitive.entityId)) {
      fail(id, `construction point ${primitive.entityId} must not draw a mark`);
    }
  }
  for (const idNeeded of MIRROR_INK_POINTS) {
    if (!drawnPoints.some((primitive) => primitive.entityId === idNeeded)) {
      fail(id, `named point ${idNeeded} must stay visible`);
    }
  }
  if (renderScene.primitives.some((primitive) => /^(object|image)$/i.test(primitive.text ?? ""))) {
    fail(id, "do not write the words object/image on the figure");
  }
  for (const predicate of ["ray1_in_parallel", "ray2_out_parallel"]) {
    if (!document.assertions.some((assertion) => assertion.id === predicate)) {
      fail(id, `missing ${predicate} assertion`);
    }
  }

  const live = synthesizeFamilyScene({ question });
  if (!live) {
    fail(id, "synthesizeFamilyScene declined the live path");
  } else {
    const liveHit = worldPoint(live.document, "M2");
    if (!liveHit || !nearly(liveHit.x, 0) || !nearly(liveHit.y, iTip.y)) {
      fail(id, "the live family path must use the same pole-plane through-F hit");
    }
  }

  if (renderDir) {
    writeFileSync(
      resolve(renderDir, `${id}.svg`),
      renderSceneSvg(renderScene, { title: question.slice(0, 110), subtitle: `${id} · ${tier}` }),
    );
  }
}

function checkLens(id: string, question: string, expected: { v: number; m: number }): void {
  const attempt = attemptArchetypeScene({ question });
  if (attempt.match?.id !== "thin_lens" || !attempt.scene) {
    fail(id, `expected thin_lens, got ${attempt.match?.id ?? "nothing"} (${attempt.declined ?? ""})`);
    return;
  }
  const { document, renderScene, tier } = attempt.scene;
  if (tier !== "exact_verified") fail(id, `tier ${tier} is not exact_verified`);
  const v = quantity(document, "v");
  if (v === null || !nearly(v, expected.v, 0.02)) fail(id, `v is ${v}, expected ${expected.v}`);
  const oTip = worldPoint(document, "O_tip");
  const l1 = worldPoint(document, "L1");
  const iTip = worldPoint(document, "I_tip");
  const focus = worldPoint(document, "F2");
  if (!oTip || !l1 || !iTip || !focus) {
    fail(id, "missing lens principal-ray points");
    return;
  }
  if (!nearly(l1.x, 0) || !nearly(l1.y, oTip.y)) {
    fail(id, `parallel-ray lens crossing is (${l1.x}, ${l1.y}), expected (0, ${oTip.y})`);
  }
  if (expected.v > 0 && pointLineDistance(focus, l1, iTip) > 0.02) {
    fail(id, "the refracted parallel ray must pass through F' and the image tip");
  }
  if (!nearly(iTip.y, expected.m * oTip.y, 0.05)) {
    fail(id, `image height ${iTip.y} does not match m=${expected.m} times object height ${oTip.y}`);
  }
  const drawnPoints = renderScene.primitives.filter((primitive) => primitive.kind === "point");
  for (const primitive of drawnPoints) {
    if (!LENS_INK_POINTS.has(primitive.entityId)) {
      fail(id, `construction point ${primitive.entityId} must not draw a mark`);
    }
  }
  if (renderDir) {
    writeFileSync(
      resolve(renderDir, `${id}.svg`),
      renderSceneSvg(renderScene, { title: question.slice(0, 110), subtitle: `${id} · ${tier}` }),
    );
  }
}

checkMirror(
  "concave-u20-f15",
  "Concave mirror, f = 15 cm, object at 20 cm. Locate the image and draw the ray diagram.",
  { u: -20, f: -15, v: -60, m: -3 },
);
checkMirror(
  "convex-u20-f15",
  "A convex mirror has focal length 15 cm. An object is placed 20 cm from the mirror. Locate the image.",
  { u: -20, f: 15, v: 60 / 7, m: (60 / 7) / 20 },
);
checkMirror(
  "concave-inside-f",
  "A concave mirror of focal length 15 cm has an object at 10 cm. Locate the image and draw the ray diagram.",
  { u: -10, f: -15, v: 30, m: 3 },
);
checkLens(
  "convex-lens-u20-f15",
  "A convex lens of focal length 15 cm has an object at 20 cm. Draw the ray diagram and locate the image.",
  { v: 60, m: -3 },
);

if (failures.length > 0) {
  console.error(`verify-mirror-ray-diagram: FAILED (${failures.length})`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("verify-mirror-ray-diagram: ok");
