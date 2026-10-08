import { strict as assert } from "node:assert";
import { compileSceneDocument } from "../../../src/compile/compiler";
import { branchGlyph } from "../../../src/compile/networkGlyphs";
import { evaluateNetworkConstruction } from "../../../src/compile/networkGeometry";
import { validateSceneDocument } from "../../../src/document/validation";
import { consumePhysicalModel } from "../../../src/physics/em20261007/consume";
import { renderSceneSvg } from "../../lib/renderSceneSvg";
import type { RenderPrimitive } from "../../../src/types";

const failures: string[] = [];
function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

function sceneOf(model: string, inputs: Record<string, number>): RenderPrimitive[] {
  const consumed = consumePhysicalModel(model, inputs);
  assert.equal(consumed.status, "scene");
  if (consumed.status !== "scene") return [];
  const validated = validateSceneDocument(consumed.document);
  const compiled = validated.document ? compileSceneDocument(validated.document) : null;
  assert.equal(compiled?.ok, true);
  return compiled?.renderScene?.primitives ?? [];
}

const wheatstone = sceneOf("dc.wheatstone", { emf: 12, r: 1, P: 2, Q: 4, Rg: 5 });
const sourceInk = wheatstone.filter((primitive) => primitive.entityId === "S" && primitive.kind === "polyline" && primitive.points.length === 2);
const vertical = sourceInk.filter((primitive) => Math.abs(primitive.points[0]!.x - primitive.points[1]!.x) < 2);
const horizontal = sourceInk.filter((primitive) => Math.abs(primitive.points[0]!.y - primitive.points[1]!.y) < 2);
const longPlate = vertical.reduce((best, plate) => {
  const span = Math.abs(plate.points[0]!.y - plate.points[1]!.y);
  return span > best.span ? { span, plate } : best;
}, { span: 0, plate: vertical[0] });
const leadXs = horizontal.flatMap((lead) => lead.points.map((point) => point.x));
const terminalMid = leadXs.length > 0 ? (Math.min(...leadXs) + Math.max(...leadXs)) / 2 : NaN;
const longX = longPlate.plate ? (longPlate.plate.points[0]!.x + longPlate.plate.points[1]!.x) / 2 : NaN;
check(longX > terminalMid, `positive battery plate must sit toward the higher-potential right terminal, long-plate x=${longX}, terminal mid=${terminalMid}`);
const positiveGlyph = branchGlyph("source", { x: 0, y: 0 }, { x: 4, y: 0 }, 0, 12);
const negativeGlyph = branchGlyph("source", { x: 0, y: 0 }, { x: 4, y: 0 }, 0, -12);
function longPlateX(paths: readonly (readonly { x: number; y: number }[])[]): number {
  const vertical = paths.filter((path) => path.length === 2 && Math.abs(path[0]!.x - path[1]!.x) < 1e-6);
  const longest = vertical.reduce((best, path) => Math.abs(path[0]!.y - path[1]!.y) > best.span ? { span: Math.abs(path[0]!.y - path[1]!.y), x: path[0]!.x } : best, { span: 0, x: NaN });
  return longest.x;
}
check(longPlateX(positiveGlyph) > longPlateX(negativeGlyph), "a negative emf must move the long plate to the other terminal");

for (const kind of ["wire", "open", "source", "detector", "resistor"] as const) {
  const start = { x: 0, y: 0 };
  const end = { x: 4, y: 0 };
  const paths = branchGlyph(kind, start, end, 0.18, 12);
  const points = paths.flat();
  check(points.some((point) => point.x === start.x && point.y === start.y), `${kind} lane ink must touch its source terminal`);
  check(points.some((point) => point.x === end.x && point.y === end.y), `${kind} lane ink must touch its destination terminal`);
}

const solved = evaluateNetworkConstruction("kirchhoff_network", {
  nodes: [
    { id: "L", at: [0, 1] }, { id: "T", at: [2, 2] }, { id: "R", at: [4, 1] },
    { id: "B", at: [2, 0] }, { id: "SL", at: [0, -1.2] }, { id: "SR", at: [4, -1.2] },
  ],
  branches: [
    { id: "WL", from: "L", to: "SL", kind: "wire" },
    { id: "S", from: "SL", to: "SR", kind: "source", resistance: 1, emf: 12 },
    { id: "WR", from: "SR", to: "R", kind: "wire" },
    { id: "LT", from: "L", to: "T", kind: "resistor", resistance: 2 },
    { id: "TR", from: "T", to: "R", kind: "resistor", resistance: 4 },
    { id: "LB", from: "L", to: "B", kind: "resistor", resistance: 2 },
    { id: "BR", from: "B", to: "R", kind: "resistor", resistance: 4 },
    { id: "G", from: "T", to: "B", kind: "detector", resistance: 5 },
  ],
  ground: "L",
  units: { resistance: "ohm", emf: "V" },
  currentScale: 0.4,
}, {
  number(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("number");
    return value;
  },
  point() { throw new Error("point"); },
  geometry() { return undefined; },
});
const source = solved.find((item) => item.networkBranch?.id === "S");
check(source && "networkBranch" in source && source.networkBranch.current > 0, "source current must leave the left terminal toward the right");

const magnet = sceneOf("mm.lines", { mx: 2, my: 0 });
const curve = magnet.find((primitive) => primitive.kind === "vector" && primitive.points.length >= 20);
check(Boolean(curve), "bar-magnet field line must remain a multi-point directed curve");
if (curve) {
  const markup = renderSceneSvg({ primitives: [curve] });
  const mid = curve.points[Math.floor(curve.points.length / 2)]!;
  check(markup.includes(`${mid.x},${mid.y}`) || markup.includes(`${mid.x.toFixed(2)}`), "SVG writer must keep an intermediate field-line vertex");
  check(!markup.includes(`<line `) || markup.includes("<polyline "), "a curved vector must not be only a chord");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("pilot defect checks passed");
