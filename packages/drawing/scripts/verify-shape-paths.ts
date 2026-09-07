/**
 * Diagram ink that is a circle or an angle mark must be a curve, not a
 * polyline of chords. A 45° incidence arc used to be two `L` segments
 * (one every 22.5°) and read as a hexagon corner on the board.
 */
import { arcPath, circlePath } from "../src/handwriting/shapePaths";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sampleCubic(
  p0: { x: number; y: number },
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p3.y,
  };
}

function parseFirstCubic(path: string): {
  start: { x: number; y: number };
  c1: { x: number; y: number };
  c2: { x: number; y: number };
  end: { x: number; y: number };
} {
  const match = path.match(
    /M (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) C (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/,
  );
  assert(match, `expected a cubic arc, got "${path}"`);
  return {
    start: { x: Number(match[1]), y: Number(match[2]) },
    c1: { x: Number(match[3]), y: Number(match[4]) },
    c2: { x: Number(match[5]), y: Number(match[6]) },
    end: { x: Number(match[7]), y: Number(match[8]) },
  };
}

const incidence = arcPath(400, 300, 48, -135, -90);
assert(!/\sL\s/.test(incidence), `a 45° angle mark must not be straight chords: ${incidence}`);
assert(/ C /.test(incidence), `a 45° angle mark must be a cubic: ${incidence}`);
assert(
  (incidence.match(/ C /g) ?? []).length === 1,
  `a 45° sweep is one cubic, got ${incidence}`,
);

const cubic = parseFirstCubic(incidence);
const mid = sampleCubic(cubic.start, cubic.c1, cubic.c2, cubic.end, 0.5);
const expectedMid = {
  x: 400 + 48 * Math.cos((-112.5 * Math.PI) / 180),
  y: 300 + 48 * Math.sin((-112.5 * Math.PI) / 180),
};
const midError = Math.hypot(mid.x - expectedMid.x, mid.y - expectedMid.y);
assert(
  midError < 0.35,
  `45° arc midpoint is ${midError.toFixed(2)}px off the circle (got ${mid.x.toFixed(2)},${mid.y.toFixed(2)})`,
);

const startError = Math.hypot(
  cubic.start.x - (400 + 48 * Math.cos((-135 * Math.PI) / 180)),
  cubic.start.y - (300 + 48 * Math.sin((-135 * Math.PI) / 180)),
);
const endError = Math.hypot(
  cubic.end.x - (400 + 48 * Math.cos((-90 * Math.PI) / 180)),
  cubic.end.y - (300 + 48 * Math.sin((-90 * Math.PI) / 180)),
);
assert(startError < 0.05, `arc must start on the circle, err ${startError.toFixed(3)}`);
assert(endError < 0.05, `arc must end on the circle, err ${endError.toFixed(3)}`);

const refraction = arcPath(400, 300, 72, -90, -61.9);
assert(!/\sL\s/.test(refraction), `a 28° angle mark must not be straight chords: ${refraction}`);

const semicircle = arcPath(0, 0, 10, 0, 180);
assert(
  (semicircle.match(/ C /g) ?? []).length === 2,
  `a 180° arc is two cubics of 90°, got ${semicircle}`,
);

const clockwise = arcPath(0, 0, 10, 90, 0);
assert(/ C /.test(clockwise), "a clockwise quarter must still be a cubic");
const cw = parseFirstCubic(clockwise);
assert(Math.abs(cw.start.x) < 0.05 && Math.abs(cw.start.y - 10) < 0.05, "CW quarter starts at (0,10)");
assert(Math.abs(cw.end.x - 10) < 0.05 && Math.abs(cw.end.y) < 0.05, "CW quarter ends at (10,0)");

assert(/ C /.test(circlePath(0, 0, 10)), "a full circle stays four cubics");

console.log("verify-shape-paths: angle marks and arcs are cubics, not chord polylines");
