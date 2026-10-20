import { strict as assert } from "node:assert";
import { arrowPath } from "../../../drawing/src/handwriting/shapePaths";
import { directedCurveInk } from "../../src/compile/directedCurve";
import type { RenderPrimitive } from "../../src/types";
import { primitiveToSvg } from "../lib/renderSceneSvg";

function vector(points: RenderPrimitive["points"], kind: "vector" | "ray" = "vector"): RenderPrimitive {
  return { id: "native", entityId: "owner", groupId: "group", kind, points };
}
const stroke = 'fill="none" stroke="#123" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"';
let cases = 0;
for (const kind of ["vector", "ray"] as const) {
  for (const span of [0, 1.999, 2, 4, 7.71, 18, 22]) {
    for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      const points = [{ x: 10, y: 20 }, { x: 10 + span * Math.cos(angle), y: 20 + span * Math.sin(angle) }];
      const primitive = vector(points, kind);
      const before = JSON.stringify(primitive);
      const svg = primitiveToSvg(primitive, "stock", "#123", "#abc");
      assert.equal(svg, `<path d="${arrowPath(10, 20, points[1]!.x, points[1]!.y)}" ${stroke}/>`, "short native SVG must use the actual live head bound");
      const commands = [...svg.matchAll(/[ML] (-?[\d.e+]+) (-?[\d.e+]+)/g)]
        .map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
      const measured = Math.hypot(points[1]!.x - 10, points[1]!.y - 20);
      for (const head of commands.slice(3).filter((_point, index) => index % 2 === 0)) {
        assert.ok(Math.hypot(head.x - commands[1]!.x, head.y - commands[1]!.y) <= measured * 0.45 + 0.002,
          `SVG head exceeds 45% of the unchanged native span: ${svg}`);
      }
      assert.equal(JSON.stringify(primitive), before, "rendering cannot mutate native geometry or text");
      assert.ok(!/NaN|Infinity/.test(svg), "short SVG paths must be finite");
      cases += 1;
    }
  }
}

const long = vector([{ x: 1, y: 2 }, { x: 24, y: 2 }]);
assert.equal(primitiveToSvg(long, "stock", "#123", "#abc"), `<line x1="1" y1="2" x2="24" y2="2" ${stroke} marker-end="url(#stock)"/>`, "stock long straight SVG stays byte-identical");
const longCurve = vector([{ x: 0, y: 0 }, { x: 30, y: 10 }, { x: 60, y: 10 }]);
assert.equal(primitiveToSvg(longCurve, "stock", "#123", "#abc"), `<polyline points="0,0 30,10 60,10" ${stroke} marker-end="url(#stock)"/>`, "stock SVG with a long terminal head span stays byte-identical");
const named = { ...vector([{ x: 0, y: 0 }, { x: 7.71, y: 0 }]), text: "native identity" };
const namedBefore = JSON.stringify(named);
assert.ok(primitiveToSvg(named, "stock", "#123", "#abc").endsWith('<text x="6" y="-6" font-size="13" fill="#abc">native identity</text>'), "native text remains unchanged");
assert.equal(JSON.stringify(named), namedBefore, "native text and geometry cannot be rewritten");

const curve = vector([{ x: 0, y: 0 }, { x: 40, y: 10 }, { x: 41, y: 10 }, { x: 44, y: 10 }]);
const ink = directedCurveInk(curve.points);
assert.ok(ink.arrow);
const a = ink.arrow[0], b = ink.arrow[1];
assert.equal(primitiveToSvg(curve, "stock", "#123", "#abc"), `<polyline points="0,0 40,10 41,10 44,10" ${stroke}/><path d="${arrowPath(a.x, a.y, b.x, b.y)}" ${stroke}/>`, "short curved head must use the actual native terminal span and retain the whole stroke");
const tinyCurve = vector([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }]);
assert.ok(!primitiveToSvg(tinyCurve, "stock", "#123", "#abc").includes("marker-end"), "a curved span under 2px cannot gain a head");
for (const invalid of [NaN, Infinity, -Infinity]) {
  assert.equal(primitiveToSvg(vector([{ x: invalid, y: 0 }, { x: 7, y: 0 }]), "stock", "#123", "#abc"), "", "invalid SVG coordinates must emit no arrow ink");
}
console.log(`verify-short-arrowhead-svg: ${cases} source-rendered spans, legacy marker bytes, curve parity and invalid inputs passed`);
