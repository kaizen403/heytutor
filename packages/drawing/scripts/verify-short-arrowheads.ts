import { strict as assert } from "node:assert";
import { arrowPath, linePath } from "../src/handwriting/shapePaths";

type Point = { x: number; y: number };
function commands(path: string): Point[] {
  return [...path.matchAll(/[ML] (-?[\d.e+]+) (-?[\d.e+]+)/g)]
    .map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
}

let cases = 0;
for (const length of [...Array.from({ length: 21 }, (_value, index) => index + 2), 2.01, 7.71]) {
  for (let rotation = 0; rotation < 24; rotation += 1) {
    const angle = rotation * Math.PI / 12;
    const start = { x: 37, y: -19 };
    const end = { x: start.x + length * Math.cos(angle), y: start.y + length * Math.sin(angle) };
    const span = Math.hypot(end.x - start.x, end.y - start.y);
    const path = arrowPath(start.x, start.y, end.x, end.y);
    assert.ok(path.startsWith(linePath(start.x, start.y, end.x, end.y)), "native shaft endpoints must remain unchanged");
    const points = commands(path);
    if (span < 2) {
      assert.equal(points.length, 2, "a sub-2px shaft must have no head");
      continue;
    }
    assert.equal(points.length, 6, `one shaft and two head legs: ${path}`);
    for (const head of [points[3]!, points[5]!]) {
      const leg = Math.hypot(head.x - points[1]!.x, head.y - points[1]!.y);
      const projected = ((head.x - start.x) * (end.x - start.x) + (head.y - start.y) * (end.y - start.y)) / span;
      assert.ok(leg <= span * 0.45 + 0.002, `head leg exceeds 45% of native span ${span}: ${path}`);
      assert.ok(projected >= span / 2 - 0.002, `head consumes half of native shaft ${span}: ${path}`);
    }
    assert.deepEqual(points[2], points[1], "left head starts at native tip");
    assert.deepEqual(points[4], points[1], "right head starts at native tip");
    const cross = (point: Point) => (end.x - start.x) * (point.y - end.y) - (end.y - start.y) * (point.x - end.x);
    assert.ok(cross(points[3]!) > 0 && cross(points[5]!) < 0, "head legs must straddle the unchanged shaft direction");
    cases += 1;
  }
}

// Captured from the unchanged source before the short-head fix.
const legacy: Array<{ input: [number, number, number, number]; path: string }> = [
  { input: [0, 0, 23, 0], path: "M 0 0 L 23 0 M 23 0 L 14.557 5.358 M 23 0 L 14.557 -5.358" },
  { input: [4, -7, 4, 33], path: "M 4 -7 L 4 33 M 4 33 L -1.358 24.557 M 4 33 L 9.358 24.557" },
  { input: [12, 22, -28, 22], path: "M 12 22 L -28 22 M -28 22 L -19.557 16.642 M -28 22 L -19.557 27.358" },
  { input: [0, 0, 100, 100], path: "M 0 0 L 100 100 M 100 100 L 80.678 95.681 M 100 100 L 95.681 80.678" },
  { input: [10, 20, 170, 20], path: "M 10 20 L 170 20 M 170 20 L 151.425 31.788 M 170 20 L 151.425 8.212" },
  { input: [-20, 60, -500, -400], path: "M -20 60 L -500 -400 M -500 -400 L -478.433 -395.659 M -500 -400 L -494.745 -378.637" },
  { input: [0, 0, 1000, 0], path: "M 0 0 L 1000 0 M 1000 0 L 981.425 11.788 M 1000 0 L 981.425 -11.788" },
  { input: [25, -30, 25, -229], path: "M 25 -30 L 25 -229 M 25 -229 L 36.788 -210.425 M 25 -229 L 13.212 -210.425" },
];
for (const test of legacy) assert.equal(arrowPath(...test.input), test.path, "long-arrow bytes must remain unchanged");
for (const span of [0, 0.1, 1, 1.999]) {
  assert.equal(arrowPath(0, 0, span, 0), linePath(0, 0, span, 0), "sub-2px arrows stay plain lines");
}
for (const invalid of [NaN, Infinity, -Infinity]) {
  for (let index = 0; index < 4; index += 1) {
    const input: [number, number, number, number] = [0, 0, 10, 0];
    input[index] = invalid;
    assert.throws(() => arrowPath(...input), /Invalid SVG path coordinate/, "invalid coordinates retain the existing rejection");
  }
}
console.log(`verify-short-arrowheads: ${cases} rotated spans, 8 legacy snapshots, tiny shafts and invalid coordinates passed`);
