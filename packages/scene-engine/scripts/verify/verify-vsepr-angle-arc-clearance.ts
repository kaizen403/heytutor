/**
 * A VSEPR angle arc never crosses another bond, and its value sits at it.
 *
 * On 24 Oct a blind judge marked "shape of NH3" WRONG: the 107° arc between
 * the plain and the wedge H swept through the dashed middle bond, and the
 * value sat a bond length away behind a dashed leader, so the dashed bond
 * read as a bent L. An angle is written only when the stem asks for one
 * (main's rule), so this gate compiles every VSEPR probe, a shape and a bond
 * angle stem for each common species, and multi-species comparisons, and
 * measures the compiled ink (screen px):
 *
 *   honest     an arc ends on two of its species' bonds, its curve crosses no
 *              other bond line or wedge, and its swept sector holds no other
 *              bond end and no lone pair dot
 *   value      the arc's value needs no leader and its glyph ink is nearer
 *              the arc than any other mark (bonds, wedges, dots, symbols,
 *              captions)
 *   written    on an asked stem a molecule with a source angle shows that
 *              value exactly once, on its arc or as a caption naming the
 *              atoms (NH3 "H-N-H = 107°", SF4 "eq. F-S-F <120°"); a stem
 *              that does not ask shows none; every figure compiles. Rows of
 *              species keep main's mark and are checked by
 *              verify-vsepr-asked-angle
 *   scale      fitPxPerUnit (what the builder places the value with) matches
 *              the compiled fit within 3%
 *   mutation   restoring the old crossing arc turns NH3 red; handing the value
 *              back to the label solver turns the value check red
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { measureTextInkBounds } from "@heytutor/drawing";
import { chemStem } from "../../src/chemistry/sceneKit";
import { askedAngle, buildVseprFigure, fitPxPerUnit, VSEPR_PROBES, vseprSpecies } from "../../src/chemistry/vsepr";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { RenderPrimitive, RenderScene, SceneDocument } from "../../src/types";

type Build = typeof buildVseprFigure;
type P = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };
const TAU = Math.PI * 2;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;

/** Main's rule for writing an angle, kept apart from the builder as the oracle. */
const asks = (question: string) => /\bangles?\b|°|\bdegrees?\b/i.test(chemStem(question));

const SPECIES = ["NH3", "H2O", "CH4", "SF4", "ClF3", "XeF4", "BF3", "CO2", "SF6", "PCl5", "PCl3", "NF3", "PH3", "H2S", "SO2",
  "NH4+", "H3O+", "BrF5", "IF5", "XeF2", "XeOF4", "BeCl2", "SO3", "SiCl4", "SnCl2", "NO2", "ICl4-", "I3-", "BrF3", "SO4^2-"];
const STEMS = [
  ...VSEPR_PROBES.filter((probe) => probe.expect === "draw").map((probe) => probe.question),
  ...SPECIES.flatMap((formula) => [`What is the shape of ${formula}?`, `What is the bond angle in ${formula}?`, `shape of ${formula} molecule`]),
  "Compare the shapes of NH3 and H2O",
  "Compare the shapes of NH3, H2O and CH4",
  "Compare the bond angles of CH4, NH3 and H2O",
  "Shapes of BF3, NH3, CH4 and SF6",
  "Compare the shapes of XeF2, XeF4 and XeF6",
  "Use VSEPR to compare the molecular shapes and bond angles of ClF3 and BrF5.",
  "Use VSEPR to compare the molecular shapes and bond angles of ClF3 and XeF4.",
  ...["SCl4", "SeCl4", "TeCl4", "PF5", "XeOF4"].map((formula) => `bond angle of ${formula} and its shape`),
// A row of species keeps main's mark (verify-vsepr-asked-angle), so only a
// single molecule is measured here.
].filter((question) => vseprSpecies(question).length === 1);

/* Compiled-ink geometry ------------------------------------------------- */

function segDist(p: P, a: P, b: P): number {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function segSeg(a: P, b: P, c: P, d: P): number {
  const cross = (o: P, p: P, q: P) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  if ((cross(c, d, a) > 0) !== (cross(c, d, b) > 0) && (cross(a, b, c) > 0) !== (cross(a, b, d) > 0)) return 0;
  return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
}
const corners = (b: Box): P[] => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }];
const inBox = (p: P, b: Box) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
function edges(points: P[], closed: boolean): Array<[P, P]> {
  const out: Array<[P, P]> = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i]!, points[i + 1]!]);
  if (closed && points.length > 2) out.push([points[points.length - 1]!, points[0]!]);
  return out;
}
function arcSamples(arc: RenderPrimitive, n = 64): P[] {
  const c = arc.points[0]!, r = arc.radius!, s = arc.startAngle!;
  let e = arc.endAngle!;
  while (e < s) e += TAU;
  return Array.from({ length: n + 1 }, (_, i) => { const t = s + ((e - s) * i) / n; return { x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r }; });
}
/** Glyph ink of a placed label, measured as the label engine measures it (24 px font, 4 px padding). */
function labelInk(prim: RenderPrimitive): Box | undefined {
  const bounds = prim.provenance?.labelBounds as Box | undefined;
  if (!bounds || !prim.text) return undefined;
  return measureTextInkBounds(prim.text, bounds.x + 4, bounds.y + 4, 24) ?? bounds;
}
function boxDist(box: Box, prim: RenderPrimitive): number {
  if (prim.kind === "label") {
    const other = labelInk(prim);
    if (!other) return Infinity;
    return Math.hypot(Math.max(other.x - (box.x + box.width), box.x - (other.x + other.width), 0),
      Math.max(other.y - (box.y + box.height), box.y - (other.y + other.height), 0));
  }
  const points = prim.kind === "arc" ? arcSamples(prim) : prim.points;
  if (points.some((p) => inBox(p, box))) return 0;
  if (points.length === 1) return Math.min(...edges(corners(box), true).map(([a, b]) => segDist(points[0]!, a, b)));
  const closed = prim.kind === "polygon" || prim.kind === "rectangle";
  return Math.min(...edges(points, closed).flatMap(([p, q]) => edges(corners(box), true).map(([a, b]) => segSeg(p, q, a, b))));
}

/** Every problem with every arc of a compiled scene. */
function arcProblems(scene: RenderScene): string[] {
  const prims = scene.primitives;
  return prims.filter((p) => p.kind === "arc").flatMap((arc) => {
    const tag = /^(m\d+)_/.exec(arc.entityId ?? "")?.[1] ?? "";
    const c = arc.points[0]!, r = arc.radius!;
    const s = norm(arc.startAngle!);
    let span = norm(arc.endAngle!) - s;
    if (span <= 0) span += TAU;
    const inSector = (p: P) => { const a = norm(Math.atan2(p.y - c.y, p.x - c.x) - s); const m = (3 * Math.PI) / 180; return a > m && a < span - m; };
    const rayGap = (p: P, ray: number) => { const a = norm(Math.atan2(p.y - c.y, p.x - c.x) - ray); return Math.min(a, TAU - a); };
    const samples = arcSamples(arc);
    const problems: string[] = [];
    const species = prims.filter((p) => p !== arc && (p.entityId ?? "").startsWith(`${tag}_`));
    const bonds = species.filter((p) => /^m\d+_b\d+/.test(p.entityId ?? "") && (p.kind === "line" || p.kind === "polygon"));
    const dots = species.filter((p) => p.kind === "point" && /_(?:lp\d+_\d|odd)$/.test(p.entityId ?? ""));
    const bondOf = (p: RenderPrimitive) => /^(m\d+_b\d+)/.exec(p.entityId ?? "")![1]!;
    // Where a bond points: a wedge's centroid, else the stroke's far end.
    const tipOf = (p: RenderPrimitive): P => p.kind === "polygon"
      ? { x: p.points.reduce((t, q) => t + q.x, 0) / p.points.length, y: p.points.reduce((t, q) => t + q.y, 0) / p.points.length }
      : p.points.reduce((best, q) => (Math.hypot(q.x - c.x, q.y - c.y) > Math.hypot(best.x - c.x, best.y - c.y) ? q : best));
    const own = new Set<string>();
    for (const bond of new Set(bonds.map(bondOf))) {
      const tips = bonds.filter((b) => bondOf(b) === bond).map(tipOf);
      const mid = { x: tips.reduce((t, q) => t + q.x, 0) / tips.length, y: tips.reduce((t, q) => t + q.y, 0) / tips.length };
      if (Math.min(rayGap(mid, s), rayGap(mid, s + span)) < (2 * Math.PI) / 180) own.add(bond);
    }
    if (own.size !== 2) problems.push(`ends on ${own.size} bonds`);
    for (const bond of bonds.filter((b) => !own.has(bondOf(b)))) {
      const hit = Math.min(...edges(bond.points, bond.kind === "polygon").flatMap(([a, b]) => samples.slice(1).map((q, i) => segSeg(samples[i]!, q, a, b))));
      if (hit <= 2) problems.push(`crosses ${bond.entityId}`);
      if (inSector(tipOf(bond))) problems.push(`sector holds ${bond.entityId}`);
    }
    for (const dot of dots) {
      const p = dot.points[0]!;
      if (Math.min(...samples.map((q) => Math.hypot(q.x - p.x, q.y - p.y))) <= 5) problems.push(`touches ${dot.entityId}`);
      if (inSector(p)) problems.push(`sector holds ${dot.entityId}`);
    }
    const label = prims.find((p) => p.kind === "label" && (p.entityId === arc.entityId || p.entityId === `${arc.entityId}_val`));
    const box = label ? labelInk(label) : undefined;
    if (!label || !box) problems.push("arc has no value");
    else {
      if (prims.some((p) => (p.entityId === label.entityId || p.entityId === arc.entityId) && p.provenance?.labelLeader)) problems.push("value needs a leader");
      const toArc = boxDist(box, arc);
      let toOther = Infinity, nearest = "";
      for (const other of prims) {
        if (other === arc || other === label || other.kind === "rectangle" || other.entityId === arc.entityId || other.entityId === label.entityId) continue;
        const d = boxDist(box, other);
        if (d < toOther) { toOther = d; nearest = other.entityId ?? other.id; }
      }
      if (!(toArc < toOther)) problems.push(`value ${toArc.toFixed(1)}px from its arc, ${toOther.toFixed(1)}px from ${nearest}`);
    }
    return problems.map((problem) => `${arc.entityId}: ${problem}`);
  });
}

function compile(document: SceneDocument): RenderScene | null {
  const validated = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>));
  if (!validated.document) return null;
  const compiled = compileSceneDocument(validated.document);
  return compiled.ok && compiled.renderScene && !compiled.report.issues.some((issue) => issue.severity === "fatal") ? compiled.renderScene : null;
}

const VALUE = /(?:^|\s)([<>]?\d+(?:\.\d+)?°)$/;

interface Sweep { red: string[]; drawn: number; arcs: number; captions: number }
function sweep(build: Build): Sweep {
  const red: string[] = [];
  let drawn = 0, arcs = 0, captions = 0;
  for (const question of STEMS) {
    const figure = build(question, [], false);
    if (!figure) continue;
    drawn++;
    const scene = compile(figure.document);
    if (!scene) { red.push(`${question}: refused`); continue; }
    for (const problem of arcProblems(scene)) red.push(`${question}: ${problem}`);
    const texts = figure.document.entities.filter((entity) => entity.label && /°/.test(entity.label));
    vseprSpecies(question).forEach((result, index) => {
      // An angle the stem did not ask is never written.
      const want = asks(question) ? askedAngle(result) : null;
      const mine = texts.filter((entity) => entity.id.startsWith(`m${index + 1}_`));
      const shown = mine.map((entity) => VALUE.exec(entity.label!)?.[1] ?? entity.label!);
      arcs += mine.filter((entity) => entity.id.endsWith("_ang_val")).length;
      captions += mine.filter((entity) => entity.id.endsWith("_ang_txt")).length;
      if (JSON.stringify(shown) !== JSON.stringify(want ? [want] : [])) red.push(`${question}: m${index + 1} shows ${JSON.stringify(shown)}, source ${want}`);
    });
    // The builder places the value at fitPxPerUnit; the compile must agree.
    const rects = figure.document.constructions.filter((c) => c.operator === "rectangle" && /_panel$/.test(c.outputs[0] ?? ""));
    const panels = rects.map((rect) => {
      const centre = figure.document.constructions.find((c) => c.outputs.includes(String(rect.inputs.center)))!.inputs as { x: number; y: number };
      const w = Number(rect.inputs.width) / 2, h = Number(rect.inputs.height) / 2;
      return { minX: centre.x - w, maxX: centre.x + w, minY: centre.y - h, maxY: centre.y + h };
    });
    const drawnPanel = scene.primitives.find((p) => p.kind === "rectangle" && p.entityId === "m1_panel");
    if (drawnPanel && panels[0]) {
      const xs = drawnPanel.points.map((p) => p.x);
      const actual = (Math.max(...xs) - Math.min(...xs)) / (panels[0].maxX - panels[0].minX);
      const estimate = fitPxPerUnit(panels);
      if (Math.abs(actual - estimate) / actual > 0.03) red.push(`${question}: fit ${estimate.toFixed(1)} px/unit, compiled ${actual.toFixed(1)}`);
    }
  }
  return { red, drawn, arcs, captions };
}

const failures: string[] = [];
let passed = 0;
async function check(id: string, run: () => void | Promise<void>): Promise<void> {
  try { await run(); passed++; }
  catch (error) { failures.push(id); console.log(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`); }
}

const live = sweep(buildVseprFigure);
await check("sweep", () => {
  assert.deepEqual(live.red, []);
  assert.ok(live.drawn >= 80, `stems drawn: ${live.drawn}`);
  assert.ok(live.arcs >= 20 && live.captions >= 8, `arcs ${live.arcs}, captions ${live.captions}`);
});
await check("nh3-and-sf4-captions", () => {
  for (const [question, text] of [["What is the bond angle in NH3?", "H-N-H = 107°"], ["What is the bond angle in SF4?", "eq. F-S-F <120°"]] as const) {
    const figure = buildVseprFigure(question, [], false)!;
    assert.ok(!figure.document.entities.some((entity) => entity.id === "m1_ang"), `${question}: no arc`);
    assert.equal(figure.document.entities.find((entity) => entity.id === "m1_ang_txt")?.label, text);
  }
});

// Mutants: a copy of vsepr.ts beside it, so its relative imports resolve.
const source = fileURLToPath(new URL("../../src/chemistry/vsepr.ts", import.meta.url));
const original = readFileSync(source, "utf8");
async function mutant(name: string, edits: Array<[string, string]>): Promise<Build> {
  let text = original;
  for (const [from, to] of edits) {
    assert.ok(text.includes(from), `${name}: mutation anchor is missing: ${from.slice(0, 60)}`);
    text = text.replace(from, to);
  }
  assert.notEqual(text, original);
  const path = source.replace(/vsepr\.ts$/, `vsepr.mutant-${name}-${process.pid}.ts`);
  writeFileSync(path, text);
  try { return ((await import(path)) as { buildVseprFigure: Build }).buildVseprFigure; }
  finally { rmSync(path, { force: true }); }
}
const SOLVER_VALUE: Array<[string, string]> = [
  ["ligandIds[mark.b]!, undefined, mark.radius));", "ligandIds[mark.b]!, characteristic!, mark.radius));"],
  ['    const valueId = c.text(`${tag}_ang_val`, { x: mark.value.cx, y: mark.value.cy }, characteristic!, "bond angle value");\n    detailIds.push(valueId);\n    angleTextIds.push(valueId);\n', ""],
];
await check("mutation/crossing-arc", async () => {
  // The pre-fix drawing: every layout pair gets an arc, its value left to the label solver.
  const build = await mutant("crossing", [
    ['  if (!slotA || !slotB || slotA.style !== "plain" || slotB.style !== "plain") return null;\n', "  if (!slotA || !slotB) return null;\n"],
    ["  if (layout.bonds.some((slot, index) => index !== a && index !== b && inSector(slot.deg, sector))) return null;\n", ""],
    ["  const placed = pair ? arcValueBox(value, layout, pair, radius, ink, pxPerUnit) : null;\n",
      "  const placed = pair ? arcValueBox(value, layout, pair, radius, ink, pxPerUnit) ?? { value: inkBox(value, ink.origin, pxPerUnit), box: inkBox(value, ink.origin, pxPerUnit) } : null;\n"],
    ...SOLVER_VALUE,
  ]);
  const red = sweep(build).red;
  console.log(`mutation/crossing-arc: ${red.length} red lines`);
  for (const problem of ["crosses m1_b3", "sector holds m1_b3", "value needs a leader"]) {
    assert.ok(red.includes(`What is the bond angle in NH3?: m1_ang: ${problem}`), `NH3: ${problem}`);
  }
});
await check("mutation/solver-placed-value", async () => {
  const build = await mutant("solver", SOLVER_VALUE);
  const red = sweep(build).red.filter((line) => /: value [\d.]+px from its arc|value needs a leader/.test(line));
  console.log(`mutation/solver-placed-value: ${red.length} values off their arc`);
  assert.ok(red.length >= 5, `solver-placed values nearer another mark: ${red.length}`);
});

console.log(`verify-vsepr-angle-arc-clearance: ${passed} passed, ${failures.length} failed (${live.drawn} figures, ${live.arcs} arcs, ${live.captions} captions)`);
if (live.red.length) console.log(live.red.slice(0, 40).join("\n"));
if (failures.length) process.exitCode = 1;
