/**
 * A ray-optics label stays in its own medium.
 *
 * Round 7 physics drew labels across the interface: "glass" in the air
 * outside a refracting sphere and "iᵣ = 46.2°" inside a prism, though both
 * name things on the other side. Compass slots know nothing of an interface.
 * The rules read only the document's optics operators, their paths and
 * n1/n2 inputs, and each label's quantity binding:
 *
 *   R2b  a label on a light path that starts or ends at a refraction or
 *        reflection contact stays on that path's side; with no slot there
 *        it is dropped, never carried across.
 *   R2c  a label whose quantityId, or leading symbol, is a refraction's n1
 *        or n2 input sits on the incident or transmitted side.
 *   R2a  a label on a refraction interface follows placementIntent
 *        "incident_side" or "transmitted_side", or "<medium> side" when the
 *        medium is the text of a label or quantity bound to n1 or n2. An
 *        unbound, unnumbered interface label with no side it can resolve is
 *        dropped, and the figure still compiles.
 *
 * Each case is a recorded planner document (fixtures/ray-optics-label-sides.json),
 * compiled here. The side is checked against the rendered ink: a label box
 * must lie wholly on the side of the interface where its path runs. Two
 * negative controls must not move: a correct air and glass pair on their
 * paths, and a triangle with no optics at all.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-ray-optics-label-sides.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSceneDocument, validateSceneDocument, type RenderPoint, type RenderPrimitive, type SceneDocument } from "../../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures/ray-optics-label-sides.json"), "utf8")) as {
  documents: Record<string, unknown>;
};
const failures: string[] = [];

interface Box { x: number; y: number; width: number; height: number }

function compile(name: string, edit?: (document: SceneDocument) => void): RenderPrimitive[] | null {
  const document = structuredClone(fixture.documents[name]) as SceneDocument;
  edit?.(document);
  const validated = validateSceneDocument(document);
  if (!validated.document) {
    failures.push(`${name}: document invalid (${validated.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code).join(", ")})`);
    return null;
  }
  const compiled = compileSceneDocument(validated.document);
  if (!compiled.ok || !compiled.renderScene) {
    failures.push(`${name}: did not compile (${compiled.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code).join(", ")})`);
    return null;
  }
  return compiled.renderScene.primitives;
}

function primitive(primitives: RenderPrimitive[], id: string): RenderPrimitive {
  const found = primitives.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing primitive ${id}`);
  return found;
}

function labelBox(primitives: RenderPrimitive[], labelId: string): Box | null {
  const label = primitives.find((candidate) => candidate.id === labelId && candidate.kind === "label");
  const bounds = label?.provenance?.labelBounds as Box | undefined;
  return bounds ?? null;
}

function corners(box: Box): RenderPoint[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
}

/** Sign of `point` against the line through the interface segment. */
function lineSide(line: RenderPrimitive, point: RenderPoint): number {
  const [a, b] = [line.points[0]!, line.points.at(-1)!];
  return Math.sign((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x));
}

/** The box lies wholly on the same side of a straight interface as `reference`. */
function onLineSide(box: Box, line: RenderPrimitive, reference: RenderPoint): boolean {
  const want = lineSide(line, reference);
  return want !== 0 && corners(box).every((corner) => lineSide(line, corner) === want);
}

/** The box lies wholly inside (or wholly outside) a rendered circle. */
function onCircleSide(box: Box, circle: RenderPrimitive, inside: boolean): boolean {
  const center = circle.points[0]!;
  const radius = circle.radius ?? 0;
  if (inside) return corners(box).every((corner) => Math.hypot(corner.x - center.x, corner.y - center.y) <= radius);
  const nearestX = Math.max(box.x, Math.min(center.x, box.x + box.width));
  const nearestY = Math.max(box.y, Math.min(center.y, box.y + box.height));
  return Math.hypot(nearestX - center.x, nearestY - center.y) >= radius;
}

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

// R2b, m1 sphere h8u: rays from the object refract into the glass at one
// air-glass sphere. "glass" sat on outgoing1 out in the air.
{
  const primitives = compile("sphere");
  if (primitives) {
    const circle = primitive(primitives, "primitive_boundary");
    const glass = labelBox(primitives, "glass_label");
    check(glass !== null, "sphere: the glass label on the refracted ray was dropped though the glass has room for it");
    if (glass) check(onCircleSide(glass, circle, true), `sphere: "glass" on the refracted ray sits outside the glass at (${glass.x.toFixed(1)}, ${glass.y.toFixed(1)})`);
    const air = labelBox(primitives, "air_label");
    if (air) check(onCircleSide(air, circle, false), `sphere: "air" on the incoming ray sits inside the glass`);
  }
}

// R2b, m2 prism: the incidence callout on the entry ray sat inside the prism,
// on the far side of the face the ray meets.
{
  const primitives = compile("prism");
  if (primitives) {
    const face = primitive(primitives, "primitive_leftFace");
    const source = primitive(primitives, "primitive_incoming").points[0]!;
    const incidence = labelBox(primitives, "redIncidence");
    check(incidence !== null, "prism: the incidence callout was dropped though the air side has room for it");
    if (incidence) check(onLineSide(incidence, face, source), `prism: "iᵣ = 46.2°" on the entry ray sits inside the glass at (${incidence.x.toFixed(1)}, ${incidence.y.toFixed(1)})`);
  }
}

// R2c, m1 refraction h8a: "crown glass" is bound to n1, the medium the ray
// leaves, but sat on the water side of the flat interface.
{
  const primitives = compile("flat");
  if (primitives) {
    const surface = primitive(primitives, "primitive_interface");
    const source = primitive(primitives, "primitive_incident").points[0]!;
    const glass = labelBox(primitives, "glassLabel");
    check(glass !== null, "flat: the crown glass label was dropped though the glass side has room for it");
    if (glass) check(onLineSide(glass, surface, source), `flat: "crown glass" (n1) sits on the water side at (${glass.x.toFixed(1)}, ${glass.y.toFixed(1)})`);
  }
}

// R2a, m1 TIR h8a: "air" on the gem-air face with intent "air side". Nothing
// binds "air" to n1 or n2 (n2 is the literal 1), so the side is unknown and
// the label goes; it had sat on the gem side. The bound gem index stays on
// the incident side.
{
  const primitives = compile("tir");
  if (primitives) {
    const face = primitive(primitives, "primitive_face");
    const gemSource = primitive(primitives, "primitive_incident1").points[0]!;
    check(labelBox(primitives, "airMedium") === null, `tir: the unbound "air" label with an unresolvable side was drawn`);
    const gem = labelBox(primitives, "gemMedium");
    check(gem !== null, "tir: the gem index label was dropped");
    if (gem) check(onLineSide(gem, face, gemSource), `tir: "n_gem = 2.15" (n1) left the gem side`);
  }
}

// R2a: the same "air" label is placed, on the air side, once its side is
// named: by the new enum value, or by "air side" when a quantity bound to n2
// is labelled "air".
for (const [variant, edit] of [
  ["transmitted_side", (document: SceneDocument) => {
    document.annotations.find((annotation) => annotation.id === "airMedium")!.placementIntent = "transmitted_side";
  }],
  ["air side, n2 labelled air", (document: SceneDocument) => {
    document.quantities.push({ id: "na", symbol: "n_air", label: "air", value: 1 });
    document.constructions.find((construction) => construction.id === "firstRay")!.inputs.n2 = "na";
  }],
] as const) {
  const primitives = compile("tir", edit);
  if (!primitives) continue;
  const face = primitive(primitives, "primitive_face");
  const airEnd = primitive(primitives, "primitive_transmitted1").points.at(-1)!;
  const air = labelBox(primitives, "airMedium");
  check(air !== null, `tir (${variant}): the "air" label with a named side was dropped`);
  if (air) check(onLineSide(air, face, airEnd), `tir (${variant}): "air" sits on the gem side`);
}

// Negative control, m1 refraction h8u: "air" on the incident ray and "glass"
// on the refracted ray already sit on their own sides. Neither may move.
{
  const primitives = compile("pair");
  if (primitives) {
    const boundary = primitive(primitives, "primitive_interface");
    const air = labelBox(primitives, "air_label");
    const glass = labelBox(primitives, "glass_label");
    check(air !== null && glass !== null, "pair: a correct medium label was dropped");
    if (air) check(onLineSide(air, boundary, primitive(primitives, "primitive_incident").points[0]!), "pair: air left the incident side");
    if (glass) check(onLineSide(glass, boundary, primitive(primitives, "primitive_refracted").points.at(-1)!), "pair: glass left the refracted side");
    expectUnmoved("pair", primitives, { air_label: [780, 85], glass_label: [965.22, 574.28] });
  }
}

// Negative control: a triangle with no optics keeps every label where main
// put it, including a label whose intent reads "incident side".
{
  const primitives = compile("plain");
  if (primitives) {
    expectUnmoved("plain", primitives, {
      primitive_A_label: [474, 546.1],
      primitive_B_label: [1086, 546.1],
      primitive_C_label: [657.6, 118.9],
      baseLabel: [780, 554.1],
      sideLabel: [871.8, 114.9],
    });
  }
}

/** Positions main (b57cbecd) compiled for these labels. */
function expectUnmoved(name: string, primitives: RenderPrimitive[], expected: Record<string, [number, number]>): void {
  for (const [id, [x, y]] of Object.entries(expected)) {
    const label = primitives.find((candidate) => candidate.id === id && candidate.kind === "label");
    if (!label) {
      failures.push(`${name}: ${id} was dropped`);
      continue;
    }
    const at = label.points[0]!;
    if (Math.abs(at.x - x) > 0.5 || Math.abs(at.y - y) > 0.5) {
      failures.push(`${name}: ${id} moved from (${x}, ${y}) to (${at.x}, ${at.y})`);
    }
  }
}

// R2d, recorded b1 prism refraction h8u (fixtures/ray-optics-remaining.json):
// "glass" annotates the prism itself, but the side rules only knew
// interfaces, so it sat out in the air beside the second face. A closed
// region with a refraction on its edge whose ray runs inside holds that
// medium: a label on the region (unbound and unnumbered) or bound to the
// index of the medium inside sits wholly inside the region, or is dropped.
const remaining = JSON.parse(readFileSync(join(here, "fixtures/ray-optics-remaining.json"), "utf8")) as {
  documents: Record<string, unknown>;
};

function compileRemaining(name: string, edit?: (document: SceneDocument) => void): RenderPrimitive[] | null {
  const document = structuredClone(remaining.documents[name]) as SceneDocument;
  edit?.(document);
  const validated = validateSceneDocument(document);
  const compiled = validated.document ? compileSceneDocument(validated.document) : null;
  if (!compiled?.ok || !compiled.renderScene) {
    failures.push(`${name}: did not compile (${(compiled ?? validated).report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code).join(", ")})`);
    return null;
  }
  return compiled.renderScene.primitives;
}

function insidePolygon(point: RenderPoint, polygon: RenderPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The whole box lies inside the rendered polygon. */
function boxInsidePolygon(box: Box, polygon: RenderPrimitive): boolean {
  return corners(box).every((corner) => insidePolygon(corner, polygon.points));
}

{
  const primitives = compileRemaining("prism");
  if (primitives) {
    const prism = primitive(primitives, "primitive_prism");
    const glass = labelBox(primitives, "glassLabel");
    check(glass !== null, "prism glass: the glass label was dropped though the prism has room");
    if (glass) check(boxInsidePolygon(glass, prism), `prism glass: "glass" sits outside the prism at (${glass.x.toFixed(1)}, ${glass.y.toFixed(1)})`);
    const air = labelBox(primitives, "airLabel");
    if (air) check(!corners(air).some((corner) => insidePolygon(corner, prism.points)), "prism glass: air moved into the glass");
    expectUnmoved("prism glass", primitives, { airLabel: [673.3, 298.5] });
  }
}

// Negative control: the same prism with its index declared (quantity n on
// both refractions) and "n = 1.5" bound to it on the ray inside. The side
// rules already put it inside the glass; it stays where #164 put it.
{
  const primitives = compileRemaining("prism", (document) => {
    document.quantities.push({ id: "n", symbol: "n", value: 1.5 } as SceneDocument["quantities"][number]);
    const inputs = (id: string) => document.constructions.find((construction) => construction.id === id)!.inputs as Record<string, unknown>;
    inputs("cInside").n2 = "n";
    inputs("cEmergent").n1 = "n";
    document.annotations = document.annotations.filter((annotation) => annotation.id !== "glassLabel");
    document.annotations.push({ id: "indexLabel", kind: "label", targetIds: ["inside"], text: "n = 1.5", quantityId: "n" } as SceneDocument["annotations"][number]);
  });
  if (primitives) {
    const index = labelBox(primitives, "indexLabel");
    if (index) check(boxInsidePolygon(index, primitive(primitives, "primitive_prism")), "prism index: n = 1.5 left the glass");
    expectUnmoved("prism index", primitives, { indexLabel: [925, 298.5], airLabel: [673.3, 298.5] });
  }
}

// R2d with two bodies of the same glass (review of #164, "Shared indices
// erase labels"): the recorded b1 prism and a second copy of it 4.5 units to
// the right, both declaring quantity n inside. A label bound to n used to get
// both prisms as regions; no box lies inside two prisms, so it was dropped
// though its own prism had room. It now sits in the prism it targets (the
// prism, or the ray inside it), or failing that the one nearest its anchor
// (the base carries no refraction, so it is the nearest case).
function twoPrisms(target: string): (document: SceneDocument) => void {
  return (document) => {
    document.quantities.push({ id: "n", symbol: "n", value: 1.5 } as SceneDocument["quantities"][number]);
    const ids = new Set(document.constructions.flatMap((construction) => construction.outputs ?? []));
    const rename = (value: unknown): unknown => typeof value === "string" && ids.has(value) ? `${value}2` : Array.isArray(value) ? value.map(rename) : value;
    for (const construction of [...document.constructions]) {
      const inputs = Object.fromEntries(Object.entries(construction.inputs as Record<string, unknown>).map(([key, value]) => [key, rename(value)]));
      if (construction.operator === "point") inputs.x = (inputs.x as number) + 4.5;
      document.constructions.push({ ...construction, id: `${construction.id}2`, inputs, outputs: construction.outputs.map((output) => `${output}2`) } as SceneDocument["constructions"][number]);
    }
    for (const entity of [...document.entities]) {
      document.entities.push({ ...entity, id: `${entity.id}2`, ...(entity.label ? { label: `${entity.label}′` } : {}) } as SceneDocument["entities"][number]);
    }
    const inputs = (id: string) => document.constructions.find((construction) => construction.id === id)!.inputs as Record<string, unknown>;
    for (const suffix of ["", "2"]) {
      inputs(`cInside${suffix}`).n2 = "n";
      inputs(`cEmergent${suffix}`).n1 = "n";
    }
    const drawn = document.requiredEntityIds.map((id) => `${id}2`);
    document.requiredEntityIds.push(...drawn);
    document.revealGroups[0]!.entityIds.push(...drawn);
    document.annotations = document.annotations.filter((annotation) => annotation.id !== "glassLabel");
    document.annotations.push({ id: "indexLabel", kind: "label", targetIds: [target], text: "n = 1.5", quantityId: "n" } as SceneDocument["annotations"][number]);
  };
}

for (const [target, body, what] of [
  ["inside", "prism", "on the first prism's inside ray"],
  ["prism2", "prism2", "on the second prism"],
  ["base2", "prism2", "on the second prism's base (no refraction there), nearest that prism"],
] as const) {
  const primitives = compileRemaining("prism", twoPrisms(target));
  if (!primitives) continue;
  const index = labelBox(primitives, "indexLabel");
  check(index !== null, `two prisms: "n = 1.5" ${what} was dropped though its prism has room`);
  if (index) check(boxInsidePolygon(index, primitive(primitives, `primitive_${body}`)), `two prisms: "n = 1.5" ${what} sits outside ${body} at (${index.x.toFixed(1)}, ${index.y.toFixed(1)})`);
}

if (failures.length > 0) {
  console.error(`verify-ray-optics-label-sides: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("verify-ray-optics-label-sides: ok (R2b sphere and prism, R2c flat interface, R2a gem face, R2d prism glass and two prisms of one glass; air/glass pair, plain triangle and prism index unmoved)");
