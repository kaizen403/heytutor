/**
 * Optics focus-label grammar and magnitude inputs (DESIGN-53 sections 2 and 3).
 *
 * G3a to G3e: textbook focus names (F, F′, F1, F2, F₁, F₂) are names; an unsigned
 * value states a magnitude checked against the engine's own model; an explicit
 * sign must match; wrong values, units, names and bound values stay fatal.
 * G3f: two source mutations of the grammar must turn G3e and G3b red.
 * G3g: a label may name a scalar by the document's own quantity id or symbol
 * (d_o, dₒ, do, w_o, wᵢ, ...). An input symbol binds only through the quantity the
 * operator input references; an output symbol (v, h_i, m) binds only to a
 * quantity whose own value equals the engine's. The texts are the recorded
 * planner labels of the p8 lens and mirror runs (DIAG-P8), all honest.
 * G3h: wrong values (request 57: the plan's h_i = 0.2273 m, the engine's 0.3 m),
 * a non-Cartesian explicit sign, an undeclared symbol, an unreferenced or
 * wrong-role quantity, prose and composite focus names all stay fatal.
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
type Gate = "G3a" | "G3b" | "G3c" | "G3d" | "G3e" | "G3g" | "G3h" | "G2a" | "G2b";
const GATES: Gate[] = ["G3a", "G3b", "G3c", "G3d", "G3e", "G3g", "G3h", "G2a", "G2b"];
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

  // G3g/G3h: the recorded p8 scenes, rebuilt with the plan's own quantity ids and magnitude inputs.
  type Q = SceneDocument["quantities"][number];
  const q = (id: string, value: number, unit?: string, symbol?: string): Q => ({ id, value, ...(unit ? { unit } : {}), ...(symbol ? { symbol } : {}) }) as Q;
  const planScene = (kind: "lens" | "mirror", form: "converging" | "diverging", unit: string, quantities: Q[], refs: { u: unknown; f: unknown; h: unknown },
    labels: Record<string, string> = {}, annotations: Array<{ target: string; text: string; quantityId?: string }> = []): SceneDocument => {
    const document = labelled(kind, labels, annotations);
    document.quantities = [...quantities, q("scale", 0.5, "dimensionless")];
    for (const construction of document.constructions) {
      if (construction.id === "image") Object.assign(construction.inputs, { objectDistance: refs.u, focalLength: refs.f, objectHeight: refs.h, form, objectSide: "real", lengthUnit: unit });
      if (construction.id === "foci") Object.assign(construction.inputs, { focalLength: refs.f, form, lengthUnit: unit });
    }
    return document;
  };
  // b1 lens_formulas_h8b (stamp collector): converging lens u = 12, f = 16, h = 0.8; engine v = -48, m = 4, h_i = 3.2.
  const stampB1 = [q("f", 16, "cm", "f"), q("do", 12, "cm", "d_o"), q("ho", 0.8, "cm", "h_o"), q("di", -48, "cm", "d_i"), q("hi", 3.2, "cm", "h_i"), q("m", 4, undefined, "m")];
  const stampB1Refs = { u: { value: "do" }, f: "f", h: "ho" };
  // b2 lens_formulas_h8b: the same stem with the plan ids d_o, w_o, d_i, w_i.
  const stampB2 = [q("f", 16, "cm", "f"), q("d_o", 12, "cm", "d_o"), q("w_o", 0.8, "cm", "w_o"), q("d_i", -48, "cm", "d_i"), q("w_i", 3.2, "cm", "w_i"), q("m", 4, undefined, "m")];
  const stampB2Refs = { u: "d_o", f: "f", h: "w_o" };
  // b2 reflection_h8a: concave mirror u = 48, R = 32, h = 3.4; engine v = -24 (real), h_i = -1.7.
  const concave = [q("h_o", 3.4, "cm", "h_o"), q("d_o", 48, "cm", "d_o"), q("R", 32, "cm", "R"), q("f", 16, "cm", "f"), q("d_i", 24, "cm", "d_i"), q("h_i", -1.7, "cm", "h_i")];
  const concaveRefs = { u: "d_o", f: "f", h: "h_o" };
  // b2 magnification_h8a (spectacle lens, -6.25 D): diverging lens u = 112, f = -16, h = 5.6; engine v = -14, h_i = 0.7.
  const spectacle = [q("P", -6.25, "D", "P"), q("do", 112, "cm", "d_o"), q("ho", 5.6, "cm", "h_o"), q("f", -16, "cm", "f"), q("di", -14, "cm", "d_i"), q("hi", 0.7, "cm", "h_i")];
  const spectacleRefs = { u: "do", f: "f", h: "ho" };
  // b1 reflection_h8b (request 57): convex mirror u = 2.4 m, R = 1.2 m, h = 1.5 m; engine v = +0.48, h_i = 0.3. The plan's h_i = 0.2273 is wrong.
  const security = [q("R", 1.2, "m", "R"), q("ho", 1.5, "m", "h_o"), q("do", 2.4, "m", "d_o"), q("f", -0.6, "m", "f"), q("di", -0.48, "m", "d_i"), q("hi", 0.22727272727272727, "m", "h_i")];
  const securityRefs = { u: "do", f: "f", h: "ho" };

  for (const [name, document] of [
    ["b1 stamp: d_o, h_o, d_i, h_i bound by quantityId", planScene("lens", "converging", "cm", stampB1, stampB1Refs, {},
      [{ target: "ob", text: "d_o=12 cm", quantityId: "do" }, { target: "ot", text: "h_o=0.8 cm", quantityId: "ho" }, { target: "ib", text: "d_i=-48 cm", quantityId: "di" }, { target: "it", text: "h_i=3.2 cm", quantityId: "hi" }])],
    ["b1 stamp: dₒ as an entity label, dᵢ and hᵢ as annotations", planScene("lens", "converging", "cm", stampB1, stampB1Refs, { ob: "dₒ=12 cm", F1: "F₁=16 cm" },
      [{ target: "ib", text: "dᵢ=−48 cm" }, { target: "it", text: "hᵢ=3.2 cm" }])],
    ["b2 stamp: d_o, w_o, d_i, w_i with no quantityId", planScene("lens", "converging", "cm", stampB2, stampB2Refs, { F1: "F₁", F2: "F₂" },
      [{ target: "ob", text: "d_o=12 cm" }, { target: "ot", text: "w_o=0.8 cm" }, { target: "ib", text: "d_i=-48 cm" }, { target: "it", text: "w_i=3.2 cm" }])],
    ["b2 stamp: dₒ, wₒ, dᵢ, wᵢ bound by quantityId", planScene("lens", "converging", "cm", stampB2, stampB2Refs, {},
      [{ target: "ob", text: "dₒ=12 cm", quantityId: "d_o" }, { target: "ot", text: "wₒ=0.8 cm", quantityId: "w_o" }, { target: "ib", text: "dᵢ=-48 cm", quantityId: "d_i" }, { target: "it", text: "wᵢ=3.2 cm", quantityId: "w_i" }, { target: "F2", text: "f=16 cm", quantityId: "f" }])],
    ["b2 concave mirror: d_o, h_o, d_i = 24 (a magnitude), h_i = -1.7 (Cartesian)", planScene("mirror", "converging", "cm", concave, concaveRefs, { F: "F" },
      [{ target: "ob", text: "d_o=48 cm", quantityId: "d_o" }, { target: "ot", text: "h_o=3.4 cm", quantityId: "h_o" }, { target: "ib", text: "d_i=24 cm", quantityId: "d_i" }, { target: "it", text: "h_i=−1.7 cm", quantityId: "h_i" }, { target: "F", text: "f=16 cm", quantityId: "f" }])],
    ["b2 spectacle lens: d_o, h_o, d_i = -14, h_i, f = -16 on a diverging lens", planScene("lens", "diverging", "cm", spectacle, spectacleRefs, {},
      [{ target: "ob", text: "d_o=112 cm" }, { target: "ot", text: "h_o=5.6 cm" }, { target: "ib", text: "d_i=-14 cm" }, { target: "it", text: "h_i=0.7 cm" }, { target: "F1", text: "f=-16 cm" }])],
    ["security mirror: the honest input labels d_o and h_o", planScene("mirror", "diverging", "m", security, securityRefs, {},
      [{ target: "ob", text: "d_o=2.4 m", quantityId: "do" }, { target: "ot", text: "h_o=1.5 m", quantityId: "ho" }])],
  ] as const) clean("G3g", name, document);

  for (const [name, document, code] of [
    ['request 57: "h_i=0.227 m" bound to the plan\'s wrong h_i = 0.2273 m', planScene("mirror", "diverging", "m", security, securityRefs, {}, [{ target: "it", text: "h_i=0.227 m", quantityId: "hi" }]), "invalid_gaussian_image_label"],
    ['request 57: "hᵢ=0.227 m"', planScene("mirror", "diverging", "m", security, securityRefs, {}, [{ target: "it", text: "hᵢ=0.227 m" }]), "invalid_gaussian_image_label"],
    ['request 57: "h_i≈0.227 m"', planScene("mirror", "diverging", "m", security, securityRefs, {}, [{ target: "it", text: "h_i≈0.227 m" }]), "invalid_gaussian_image_label"],
    ['request 57 with the plan id "y_i" = 0.2273 m and its own value "y_i=0.227 m"', planScene("mirror", "diverging", "m", [...security, q("y_i", 0.22727272727272727, "m", "y_i")], securityRefs, {}, [{ target: "it", text: "y_i=0.227 m" }]), "invalid_gaussian_image_label"],
    ['"y_i=0.3 m": the right value cannot bind through a quantity whose own value is wrong', planScene("mirror", "diverging", "m", [...security, q("y_i", 0.22727272727272727, "m", "y_i")], securityRefs, {}, [{ target: "it", text: "y_i=0.3 m" }]), "invalid_gaussian_image_label"],
    ['"d_i=-0.48 m" on the convex mirror (real-is-positive sign, Cartesian v = +0.48)', planScene("mirror", "diverging", "m", security, securityRefs, {}, [{ target: "ib", text: "d_i=-0.48 m", quantityId: "di" }]), "invalid_gaussian_image_label"],
    ['"d_i=24 cm" with no d_i quantity declared', planScene("mirror", "converging", "cm", concave.filter((item) => item.id !== "d_i"), concaveRefs, {}, [{ target: "ib", text: "d_i=24 cm" }]), "invalid_gaussian_image_label"],
    ['"d_o=13 cm": a bound input symbol with the wrong value', planScene("lens", "converging", "cm", stampB1, stampB1Refs, { ob: "d_o=13 cm" }), "invalid_gaussian_image_label"],
    ['"d_o=12 mm": a bound input symbol in the wrong unit', planScene("lens", "converging", "cm", stampB1, stampB1Refs, { ob: "d_o=12 mm" }), "invalid_gaussian_image_label"],
    ['"w_o=12 cm": the object-height id carrying u\'s value', planScene("lens", "converging", "cm", stampB2, stampB2Refs, { ot: "w_o=12 cm" }), "invalid_gaussian_image_label"],
    ['"s=48 cm": a quantity no input references', planScene("mirror", "converging", "cm", [...concave, q("s", 48, "cm", "s")], concaveRefs, { ob: "s=48 cm" }), "invalid_gaussian_image_label"],
    ['"d_i=24 cm" as the stamp\'s image distance (engine v = -48)', planScene("lens", "converging", "cm", [...stampB1.filter((item) => item.id !== "di"), q("di", 24, "cm", "d_i")], stampB1Refs, { ib: "d_i=24 cm" }), "invalid_gaussian_image_label"],
    ['"F, f=16 cm" on the mirror focus', planScene("mirror", "converging", "cm", concave, concaveRefs, {}, [{ target: "F", text: "F, f=16 cm", quantityId: "f" }]), "invalid_optical_focus_label"],
    ["prose on the mirror focus", planScene("mirror", "converging", "cm", concave, concaveRefs, {}, [{ target: "F", text: "The focal length is half the radius of curvature: 16 cm.", quantityId: "f" }]), "invalid_optical_focus_label"],
    ['"Fₘ" on the mirror focus', planScene("mirror", "converging", "cm", concave, concaveRefs, { F: "Fₘ" }), "invalid_optical_focus_label"],
    ["power prose on a lens focus", planScene("lens", "converging", "cm", stampB1, stampB1Refs, {}, [{ target: "F2", text: "Power P = 1/f, with f in metres. Its unit is the dioptre (D)." }]), "invalid_optical_focus_label"],
    ['"d_o=12 cm" on a focus', planScene("lens", "converging", "cm", stampB1, stampB1Refs, { F2: "d_o=12 cm" }), "invalid_optical_focus_label"],
  ] as const) fatal("G3h", name, document, code);

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
