/**
 * Optics focus-label grammar and magnitude inputs (DESIGN-53 sections 2 and 3).
 *
 * G3a to G3e: textbook focus names (F, F′, F1, F2, F₁, F₂) are names; an unsigned
 * value states a magnitude checked against the engine's own model; an explicit
 * sign must match; wrong values, units, names and bound values stay fatal.
 * G3f: two source mutations of the grammar must turn G3e and G3b red.
 * G2a, G2b: `form` and `objectSide` make `gaussian_image` and `optical_focus`
 * read unsigned magnitudes and apply the Cartesian convention in the engine;
 * a converging lens with a negative f fails closed.
 */
import { readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SceneConstruction, SceneDocument, SceneIssue } from "../../src/types";

type OpticsModule = typeof import("../../src/compile/geometricOpticsGeometry");
type Gate = "G3a" | "G3b" | "G3c" | "G3d" | "G3e" | "G2a" | "G2b";
const GATES: Gate[] = ["G3a", "G3b", "G3c", "G3d", "G3e", "G2a", "G2b"];
const SOURCE = fileURLToPath(new URL("../../src/compile/geometricOpticsGeometry.ts", import.meta.url));

const base = { kind: "lens", center: "O", axis: "axis", objectDistance: { value: "u" }, focalLength: "f", objectHeight: "h", displayScale: "scale", lengthUnit: "cm" };

/** Lens f = 10, concave mirror f = -10, u = -30, h = 5, signed Cartesian quantities. */
function scene(kind: "lens" | "mirror" = "lens"): SceneDocument {
  const constructions: SceneConstruction[] = [
    { id: "make-O", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["O"] }, { id: "make-A", operator: "point", inputs: { x: -60, y: 0 }, outputs: ["A"] }, { id: "make-B", operator: "point", inputs: { x: 60, y: 0 }, outputs: ["B"] },
    { id: "make-axis", operator: "line", inputs: { start: "A", end: "B" }, outputs: ["axis"] },
    { id: "image", operator: "gaussian_image", inputs: { ...base, kind }, outputs: ["ob", "ot", "ib", "it"] },
    { id: "foci", operator: "optical_focus", inputs: { kind, center: "O", axis: "axis", focalLength: "f", displayScale: "scale", lengthUnit: "cm" }, outputs: kind === "lens" ? ["F1", "F2"] : ["F"] },
    { id: "make-object", operator: "segment", inputs: { start: "ob", end: "ot" }, outputs: ["object"] }, { id: "make-image-height", operator: "segment", inputs: { start: "ib", end: "it" }, outputs: ["image-height"] },
  ];
  const ids = constructions.flatMap((construction) => construction.outputs);
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "explicit signed Cartesian image and focus landmarks" }, source: {},
    quantities: [{ id: "u", value: -30, unit: "cm" }, { id: "f", value: kind === "lens" ? 10 : -10, unit: "cm" }, { id: "h", value: 5, unit: "cm" }, { id: "scale", value: 2, unit: "dimensionless" }],
    entities: ids.map((id) => ({ id, kind: id === "axis" ? "line" : ["object", "image-height"].includes(id) ? "segment" : "point", role: "Cartesian optical geometry" })),
    constructions, relations: [], annotations: [],
    assertions: [
      { id: "object-axis", predicate: "incident", entities: ["ob", "axis"], expected: true, severity: "fatal" },
      { id: "image-axis", predicate: "incident", entities: ["ib", "axis"], expected: true, severity: "fatal" },
      { id: "height-parallel", predicate: "parallel", entities: ["object", "image-height"], expected: true, severity: "fatal" },
    ],
    requiredEntityIds: ids, revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "reveal the verified image anchors" }], teachingTimeline: [],
  } as SceneDocument;
}

/** The same scene in magnitude mode: unsigned plan quantities plus form, the engine applies the sign. */
function magnitudeScene(kind: "lens" | "mirror", form: "converging" | "diverging", objectSide?: "real" | "virtual", focal = 10): SceneDocument {
  const document = scene(kind);
  document.quantities.find((quantity) => quantity.id === "u")!.value = 30;
  document.quantities.find((quantity) => quantity.id === "f")!.value = focal;
  for (const construction of document.constructions) {
    if (construction.id === "image") Object.assign(construction.inputs, { form, ...(objectSide ? { objectSide } : {}) });
    if (construction.id === "foci") Object.assign(construction.inputs, { form });
  }
  return document;
}

function runGates(optics: OpticsModule): Map<Gate, string[]> {
  const failures = new Map<Gate, string[]>(GATES.map((gate) => [gate, []]));
  const fail = (gate: Gate, message: string): void => { failures.get(gate)!.push(message); };
  const guard = (gate: Gate, name: string, body: () => void): void => {
    try { body(); } catch (error) { fail(gate, `${name} threw: ${error instanceof Error ? error.message : String(error)}`); }
  };
  const structural = (document: SceneDocument): SceneIssue[] => {
    const producers = new Map(document.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const)));
    const issues: SceneIssue[] = [];
    document.constructions.forEach((construction, index) => {
      if (construction.operator === "gaussian_image" || construction.operator === "optical_focus") optics.validateGeometricOpticsConstruction(construction, index, document, producers, issues);
    });
    return issues;
  };
  const describe = (issues: SceneIssue[]): string => issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ") || "no issues";
  const labelled = (kind: "lens" | "mirror", labels: Record<string, string>, annotations: Array<{ target: string; text: string; quantityId?: string }> = [], quantities: SceneDocument["quantities"] = []): SceneDocument => {
    const document = scene(kind);
    for (const entity of document.entities) if (labels[entity.id] !== undefined) entity.label = labels[entity.id];
    annotations.forEach((annotation, index) => document.annotations.push({ id: `a${index}`, kind: "label", targetIds: [annotation.target], text: annotation.text, ...(annotation.quantityId ? { quantityId: annotation.quantityId } : {}) }));
    document.quantities.push(...quantities);
    return document;
  };
  const clean = (gate: Gate, name: string, document: SceneDocument): void => guard(gate, name, () => {
    const issues = structural(document);
    if (issues.length !== 0) fail(gate, `${name} must give 0 issues; got ${describe(issues)}`);
  });
  const fatal = (gate: Gate, name: string, document: SceneDocument, code?: string): void => guard(gate, name, () => {
    const issues = structural(document).filter((issue) => issue.severity === "fatal");
    if (issues.length === 0 || code !== undefined && !issues.some((issue) => issue.code === code)) fail(gate, `${name} must be fatal${code ? ` with ${code}` : ""}; got ${describe(issues)}`);
  });

  // Signed baselines validate before any label is added.
  clean("G3a", "unlabelled signed lens", scene("lens"));
  clean("G3a", "unlabelled signed concave mirror", scene("mirror"));

  // G3a: an unsigned f on a concave mirror's focus is the magnitude of its Cartesian f = -10.
  clean("G3a", 'mirror focus label "f = 10 cm"', labelled("mirror", { F: "f = 10 cm" }));
  clean("G3a", 'mirror focus label "f = -10 cm" (explicit Cartesian sign)', labelled("mirror", { F: "f = -10 cm" }));

  // G3b: bare textbook focus names make no claim.
  clean("G3b", "lens foci named F₁ and F₂", labelled("lens", { F1: "F₁", F2: "F₂" }));
  clean("G3b", "lens second focus named F′", labelled("lens", { F2: "F′" }));
  clean("G3b", "lens second focus named F' (ASCII prime)", labelled("lens", { F2: "F'" }));
  clean("G3b", "mirror focus named F′", labelled("mirror", { F: "F′" }));

  // G3c: a value joined to a focus name is that focus's own unsigned distance.
  clean("G3c", 'lens annotations "F₂ = 10 cm" on F2 and "F1 = 10 cm" on F1', labelled("lens", {}, [{ target: "F2", text: "F₂ = 10 cm" }, { target: "F1", text: "F1 = 10 cm" }]));
  clean("G3c", 'mirror annotation "F = 10 cm"', labelled("mirror", {}, [{ target: "F", text: "F = 10 cm" }]));

  // G3d: the plan's unsigned f binds to a concave mirror's focus.
  clean("G3d", 'mirror annotation "f" bound to an unsigned 10 cm quantity', labelled("mirror", {}, [{ target: "F", text: "f", quantityId: "fmag" }], [{ id: "fmag", value: 10, unit: "cm" }]));
  clean("G3d", "mirror focus annotation with no text bound to an unsigned 10 cm quantity", (() => {
    const document = labelled("mirror", {}, [], [{ id: "fmag", value: 10, unit: "cm" }]);
    document.annotations.push({ id: "bare", kind: "label", targetIds: ["F"], quantityId: "fmag" });
    return document;
  })());

  // G3e: negative controls stay fatal.
  for (const [name, document, code] of [
    ['"f = 12 cm" on the mirror focus', labelled("mirror", { F: "f = 12 cm" }), "invalid_optical_focus_label"],
    ['"f = 12 cm" on the lens focus', labelled("lens", { F2: "f = 12 cm" }), "invalid_optical_focus_label"],
    ['"f = +10 cm" on the concave mirror', labelled("mirror", { F: "f = +10 cm" }), "invalid_optical_focus_label"],
    ['"f = -10 cm" on the lens', labelled("lens", { F2: "f = -10 cm" }), "invalid_optical_focus_label"],
    ['"F₂ = 12 cm" on F2', labelled("lens", {}, [{ target: "F2", text: "F₂ = 12 cm" }]), "invalid_optical_focus_label"],
    ['"F″" on F2', labelled("lens", { F2: "F″" }), "invalid_optical_focus_label"],
    ['"F3 = 10 cm" on F2', labelled("lens", { F2: "F3 = 10 cm" }), "invalid_optical_focus_label"],
    ['"m=0.5" on the image tip (m = -0.5)', labelled("lens", { it: "m=0.5" }), "invalid_gaussian_image_label"],
    ['"f = 10 mm" on a cm lens', labelled("lens", { F2: "f = 10 mm" }), "invalid_optical_focus_label"],
    ["a quantityId bound to -12 on the mirror focus", labelled("mirror", {}, [{ target: "F", text: "f", quantityId: "fneg" }], [{ id: "fneg", value: -12, unit: "cm" }]), "invalid_optical_focus_label"],
    ["a magnification annotation bound to +0.5 (m = -0.5 stays signed)", labelled("lens", {}, [{ target: "it", text: "m", quantityId: "mpos" }], [{ id: "mpos", value: 0.5, unit: "dimensionless" }]), "invalid_gaussian_image_label"],
    ['"F2 = 10 cm" on a gaussian anchor', labelled("lens", { ib: "F2 = 10 cm" }), "invalid_gaussian_image_label"],
    ['"u = 31 cm" on the object base', labelled("lens", { ob: "u = 31 cm" }), "invalid_gaussian_image_label"],
    ['prose on a focus', labelled("lens", { F2: "principal focus where rays meet" }), "invalid_optical_focus_label"],
    ['a bare number on a focus', labelled("lens", { F2: "10 cm" }), "invalid_optical_focus_label"],
    ['a tagged name "f_L = 10 cm" on a focus', labelled("lens", { F2: "f_L = 10 cm" }), "invalid_optical_focus_label"],
  ] as const) fatal("G3e", name, document, code);

  // G2a: magnitude mode equals the signed Cartesian scene, and stored metadata stays Cartesian.
  const context = { number(value: unknown) { const result = Number(value); if (!Number.isFinite(result)) throw new Error("nonfinite"); return result; }, point() { throw new Error("unused"); }, geometry() { return undefined; } };
  const literal = { center: [3, -2], axis: [1, 0], objectHeight: 5, displayScale: 2, lengthUnit: "cm" };
  const samePoints = (name: string, operator: string, magnitude: Record<string, unknown>, signed: Record<string, unknown>): void => guard("G2a", name, () => {
    const a = optics.evaluateGeometricOpticsConstruction(operator, magnitude, context);
    const b = optics.evaluateGeometricOpticsConstruction(operator, signed, context);
    if (a.length !== b.length || a.some((output, index) => Math.hypot(output.point.x - b[index]!.point.x, output.point.y - b[index]!.point.y) > 1e-9)) fail("G2a", `${name}: magnitude points differ from the signed oracle`);
    if (JSON.stringify(a.map((output) => output.opticalImage ?? output.opticalFocus)) !== JSON.stringify(b.map((output) => output.opticalImage ?? output.opticalFocus))) fail("G2a", `${name}: stored metadata must stay Cartesian`);
  });
  samePoints("converging mirror u = 30, f = 10", "gaussian_image", { ...literal, kind: "mirror", form: "converging", objectDistance: 30, focalLength: 10 }, { ...literal, kind: "mirror", objectDistance: -30, focalLength: -10 });
  samePoints("diverging mirror u = 30, f = 10", "gaussian_image", { ...literal, kind: "mirror", form: "diverging", objectDistance: 30, focalLength: 10 }, { ...literal, kind: "mirror", objectDistance: -30, focalLength: 10 });
  samePoints("converging lens u = 30, f = 10", "gaussian_image", { ...literal, kind: "lens", form: "converging", objectDistance: 30, focalLength: 10 }, { ...literal, kind: "lens", objectDistance: -30, focalLength: 10 });
  samePoints("diverging lens f = 10", "gaussian_image", { ...literal, kind: "lens", form: "diverging", objectDistance: 30, focalLength: 10 }, { ...literal, kind: "lens", objectDistance: -30, focalLength: -10 });
  samePoints("diverging lens with a stated -10", "gaussian_image", { ...literal, kind: "lens", form: "diverging", objectDistance: 30, focalLength: -10 }, { ...literal, kind: "lens", objectDistance: -30, focalLength: -10 });
  samePoints("objectSide virtual lens", "gaussian_image", { ...literal, kind: "lens", form: "converging", objectSide: "virtual", objectDistance: 30, focalLength: 10 }, { ...literal, kind: "lens", objectDistance: 30, focalLength: 10 });
  samePoints("objectSide real is the default", "gaussian_image", { ...literal, kind: "lens", form: "converging", objectSide: "real", objectDistance: 30, focalLength: 10 }, { ...literal, kind: "lens", objectDistance: -30, focalLength: 10 });
  samePoints("diverging lens focus", "optical_focus", { kind: "lens", center: [3, -2], axis: [1, 0], displayScale: 2, lengthUnit: "cm", form: "diverging", focalLength: 10 }, { kind: "lens", center: [3, -2], axis: [1, 0], displayScale: 2, lengthUnit: "cm", focalLength: -10 });
  samePoints("converging mirror focus", "optical_focus", { kind: "mirror", center: [3, -2], axis: [1, 0], displayScale: 2, lengthUnit: "cm", form: "converging", focalLength: 10 }, { kind: "mirror", center: [3, -2], axis: [1, 0], displayScale: 2, lengthUnit: "cm", focalLength: -10 });
  guard("G2a", "resolveCartesianOpticsInputs", () => {
    const resolved = optics.resolveCartesianOpticsInputs({ kind: "mirror", form: "converging", objectDistance: 30, focalLength: 10, objectHeight: 5 }, (value) => Number(value));
    if (resolved.objectDistance !== -30 || resolved.focalLength !== -10 || resolved.objectHeight !== 5) fail("G2a", `resolveCartesianOpticsInputs must give u = -30, f = -10, h = 5; got ${JSON.stringify(resolved)}`);
    const signed = optics.resolveCartesianOpticsInputs({ kind: "mirror", objectDistance: -30, focalLength: 10, objectHeight: 5 }, (value) => Number(value));
    if (signed.objectDistance !== -30 || signed.focalLength !== 10 || signed.form !== undefined) fail("G2a", `signed mode must be unchanged without form; got ${JSON.stringify(signed)}`);
  });
  // Plan ids carry the unsigned values directly, with focus labels bound to the same unsigned f.
  clean("G2a", "magnitude concave mirror on unsigned plan ids", magnitudeScene("mirror", "converging"));
  clean("G2a", "magnitude convex lens on unsigned plan ids", magnitudeScene("lens", "converging"));
  clean("G2a", "magnitude diverging lens on unsigned plan ids", magnitudeScene("lens", "diverging"));
  clean("G2a", "magnitude virtual object on unsigned plan ids", magnitudeScene("lens", "converging", "virtual"));
  clean("G2a", "magnitude mirror with u, v, f labels", (() => {
    const document = magnitudeScene("mirror", "converging");
    for (const entity of document.entities) entity.label = ({ ob: "u=30 cm", ib: "v=15 cm", F: "f=10 cm" } as Record<string, string>)[entity.id] ?? entity.label;
    return document;
  })());

  // G2b: a contradicting form fails closed; malformed form and objectSide are fatal.
  fatal("G2b", "converging lens with f = -10", magnitudeScene("lens", "converging", undefined, -10), "invalid_gaussian_image_form");
  fatal("G2b", "converging lens focus with f = -10", magnitudeScene("lens", "converging", undefined, -10), "invalid_optical_focus_form");
  fatal("G2b", 'form "convex"', (() => { const document = magnitudeScene("lens", "converging"); document.constructions.find((c) => c.id === "image")!.inputs.form = "convex"; return document; })(), "invalid_gaussian_image_form");
  fatal("G2b", "objectSide without form", (() => { const document = scene("lens"); document.constructions.find((c) => c.id === "image")!.inputs.objectSide = "real"; return document; })(), "invalid_gaussian_image_objectSide");
  fatal("G2b", 'objectSide "behind"', magnitudeScene("lens", "converging", "behind" as "real"), "invalid_gaussian_image_objectSide");
  fatal("G2b", "objectSide on optical_focus", (() => { const document = magnitudeScene("lens", "converging"); document.constructions.find((c) => c.id === "foci")!.inputs.objectSide = "real"; return document; })(), "invalid_optical_focus_fields");
  return failures;
}

async function main(): Promise<void> {
  const optics = await import("../../src/compile/geometricOpticsGeometry") as OpticsModule;
  const results = runGates(optics);
  const red: string[] = [];
  for (const gate of GATES) {
    const failures = results.get(gate)!;
    console.log(`${gate}: ${failures.length === 0 ? "pass" : `FAIL (${failures.length})`}`);
    for (const failure of failures) red.push(`${gate}: ${failure}`);
  }

  // The magnitude scenes compile to the same render as their signed twins.
  const { compileSceneDocument } = await import("../../src/index");
  const compiledPoints = (document: SceneDocument): string => {
    const result = compileSceneDocument(document);
    if (!result.ok || !result.renderScene) throw new Error(JSON.stringify(result.report.issues.filter((issue) => issue.severity === "fatal")));
    return JSON.stringify(result.renderScene.primitives.map((primitive) => primitive.points.map((point) => [Math.round(point.x * 1e6), Math.round(point.y * 1e6)])));
  };
  try {
    if (compiledPoints(magnitudeScene("mirror", "converging")) !== compiledPoints(scene("mirror"))) red.push("G2a: the compiled magnitude concave mirror differs from the signed scene");
    if (compiledPoints(magnitudeScene("lens", "converging")) !== compiledPoints(scene("lens"))) red.push("G2a: the compiled magnitude convex lens differs from the signed scene");
    console.log("G2a compile: checked");
  } catch (error) { red.push(`G2a compile: ${error instanceof Error ? error.message : String(error)}`); }

  // G3f: mutations of the grammar must turn the gates that guard them red.
  const source = readFileSync(SOURCE, "utf8");
  const directory = mkdtempSync(join(tmpdir(), "optics-mutant-"));
  try {
    for (const [name, from, to, gate, needle] of [
      ["agreesStated compares magnitudes on both sides", /symbol !== "m" && !\/\^\[\+-\]\/\.test\(raw\) \? (agrees\(Math\.abs\(Number\(raw\)\), Math\.abs\(expected\), tolerance\)) : agrees\(Number\(raw\), expected, tolerance\)/, "$1", "G3e", '"f = +10 cm" on the concave mirror'],
      ["FOCUS_NAME without ₁ and ₂", /const FOCUS_NAME = \/\^F\(\?:1\|2\|₁\|₂\|′\|'\)\?\$\/u;/, "const FOCUS_NAME = /^F(?:1|2|′|')?$/u;", "G3b", "F₁ and F₂"],
    ] as const) {
      const mutated = source.replace(from, to);
      if (mutated === source) { red.push(`G3f: mutation "${name}" did not apply to the source`); continue; }
      const file = join(directory, `${name.replace(/[^A-Za-z]+/g, "-")}.ts`);
      writeFileSync(file, mutated);
      const mutant = await import(pathToFileURL(file).href) as OpticsModule;
      const caught = mutant && runGates(mutant).get(gate)!.some((failure) => failure.includes(needle));
      console.log(`G3f ${name}: ${caught ? `caught by ${gate}` : "NOT caught"}`);
      if (!caught) red.push(`G3f: mutation "${name}" must turn ${gate} red on ${needle}`);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }

  if (red.length > 0) {
    for (const line of red) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log("verify-optics-labels-and-magnitudes: focus names, magnitudes and form inputs are certified by the engine model");
}

await main();
