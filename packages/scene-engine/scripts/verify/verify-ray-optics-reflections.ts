/**
 * Total internal reflection is judged on what the figure draws (R7).
 *
 * A reflection inside the denser medium is total only above the critical
 * angle; below it the refraction at the same contact must be drawn. Review of
 * #164 found two ways the rule judged the document rather than the figure:
 *
 *   drawn     A refraction counted at the reflection's contact even when its
 *             ray was hidden, so a lone drawn reflection below the critical
 *             angle passed with no escaping ray on the board. A hidden helper
 *             reflection was checked too, so it could refuse a correct figure.
 *             Now only a drawn reflection is checked and only a drawn
 *             refraction excuses it; a hidden refraction still declares the
 *             interface's indices.
 *   literal   `reflect_direction` and `refract_direction` with a literal
 *             incoming vector (the compiler accepts [x, y]) were skipped, so
 *             writing the direction as a vector switched the rule off.
 *
 * Every case starts from the recorded b2 optical fibre (h8u) in
 * fixtures/ray-optics-remaining.json: a core and cladding boundary, the light
 * reflected at 26.6 degrees to the normal. Its indices are declared by a
 * refraction that leaves the core (1.58 to 1.47, critical angle 68.5
 * degrees), at another contact or at the same one.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-ray-optics-reflections.ts
 */
import { readFileSync } from "node:fs";
import { compileSceneDocument, validateSceneDocument } from "../../src";

type RecordedDocument = Record<string, any>;
type Primitive = { id: string; kind: string; points: Array<{ x: number; y: number }> };

const remaining = JSON.parse(readFileSync(new URL("./fixtures/ray-optics-remaining.json", import.meta.url), "utf8")) as {
  documents: Record<string, RecordedDocument>;
};
const failures: string[] = [];
let passed = 0;

function fibre(edit: (document: RecordedDocument) => void) {
  const document = structuredClone(remaining.documents.fibre!) as RecordedDocument;
  edit(document);
  const validated = validateSceneDocument(document as never);
  const compiled = validated.document ? compileSceneDocument(validated.document) : null;
  const fatal = (compiled?.report ?? validated.report).issues.filter((issue) => issue.severity === "fatal");
  return { ok: Boolean(compiled?.ok && compiled.renderScene), primitives: (compiled?.renderScene?.primitives ?? []) as Primitive[], fatal };
}

const fatalCodes = (fatal: Array<{ code: string }>) => [...new Set(fatal.map((issue) => issue.code))];

function stroke(primitives: Primitive[], id: string): Primitive {
  const found = primitives.find((primitive) => primitive.id === `primitive_${id}`);
  if (!found) throw new Error(`no primitive for ${id}`);
  return found;
}

function check(name: string, run: () => string | null): void {
  let problem: string | null;
  try { problem = run(); } catch (error) { problem = `threw: ${error instanceof Error ? error.message : String(error)}`; }
  if (problem) { failures.push(`${name}: ${problem}`); console.log(`FAIL ${name}: ${problem}`); }
  else { passed += 1; console.log(`pass ${name}`); }
}

function show(document: RecordedDocument, ids: string[]): void {
  document.requiredEntityIds.push(...ids);
  document.revealGroups.at(-1).entityIds.push(...ids);
}

function setInputs(document: RecordedDocument, id: string, inputs: Record<string, unknown>): void {
  Object.assign(document.constructions.find((construction: RecordedDocument) => construction.id === id).inputs, inputs);
}

/**
 * Declare the core and cladding indices with a refraction out of the core:
 * at a second contact (leak) whose light meets the boundary at 45 degrees, or
 * at the fibre's own contact. `drawn` false declares the refracted ray as a
 * group entity: validation lets a group stay out of requiredEntityIds and the
 * reveal groups, so the compiler computes the ray and never draws it. At
 * another contact everything else is hidden too.
 */
function declareIndices(document: RecordedDocument, options: { sameContact?: boolean; drawn?: boolean; literal?: boolean } = {}): void {
  const drawn = options.drawn ?? true;
  if (options.sameContact) {
    document.entities.push({ id: "leakOut", kind: drawn ? "ray" : "group", role: "light refracted into the cladding" });
    document.constructions.push({ id: "makeLeakOut", operator: "refract_direction", inputs: { origin: "contact", incoming: options.literal ? [1, 2] : "incoming", normal: "contactNormal", n1: 1.58, n2: 1.47 }, outputs: ["leakOut"] });
    if (drawn) show(document, ["leakOut"]);
    return;
  }
  if (!drawn) {
    // All of it hidden: a helper point on the boundary, a construction-only
    // line for the light arriving at 45 degrees, and the refracted ray as a group.
    document.entities.push(
      { id: "leak", kind: "point", role: "helper point" },
      { id: "leakIncoming", kind: "line", role: "helper direction" },
      { id: "leakNormal", kind: "segment", role: "normal" },
      { id: "leakOut", kind: "group", role: "light refracted into the cladding" },
    );
    document.constructions.push(
      { id: "makeLeak", operator: "point", inputs: { x: -2, y: 0, coordinateSpace: "world" }, outputs: ["leak"] },
      { id: "makeLeakIncoming", operator: "line", inputs: { start: "leak", direction: [1, 1] }, outputs: ["leakIncoming"] },
      { id: "makeLeakNormal", operator: "normal_at", inputs: { point: "leak", surface: "boundary" }, outputs: ["leakNormal"] },
      { id: "makeLeakOut", operator: "refract_direction", inputs: { origin: "leak", incoming: "leakIncoming", normal: "leakNormal", n1: 1.58, n2: 1.47 }, outputs: ["leakOut"] },
    );
    return;
  }
  document.entities.push(
    { id: "leakOrigin", kind: "point", role: "helper point" },
    { id: "leak", kind: "point", role: "second point of incidence" },
    { id: "leakIncoming", kind: "vector", role: "light in the core" },
    { id: "leakNormal", kind: "segment", role: "normal" },
    { id: "leakOut", kind: "ray", role: "light refracted into the cladding" },
  );
  document.constructions.push(
    { id: "makeLeakOrigin", operator: "point", inputs: { x: -4, y: -2, coordinateSpace: "world" }, outputs: ["leakOrigin"] },
    { id: "makeLeak", operator: "surface_contact", inputs: { origin: "leakOrigin", surface: "boundary", direction: [1, 1] }, outputs: ["leak", "leakIncoming"] },
    { id: "makeLeakNormal", operator: "normal_at", inputs: { point: "leak", surface: "boundary" }, outputs: ["leakNormal"] },
    { id: "makeLeakOut", operator: "refract_direction", inputs: { origin: "leak", incoming: options.literal ? [1, 1] : "leakIncoming", normal: "leakNormal", n1: 1.58, n2: 1.47 }, outputs: ["leakOut"] },
  );
  show(document, ["leakOrigin", "leak", "leakIncoming", "leakNormal", "leakOut"]);
}

/**
 * A helper reflection at the fibre's contact of light arriving at 45 degrees,
 * none of it drawn: its incoming line is a construction-only line and its
 * reflected ray a group entity.
 */
function hiddenHelperReflection(document: RecordedDocument): void {
  document.entities.push(
    { id: "auxIncoming", kind: "line", role: "helper direction" },
    { id: "auxReflected", kind: "group", role: "helper reflection" },
  );
  document.constructions.push(
    { id: "makeAuxIncoming", operator: "line", inputs: { start: "contact", direction: [1, 1] }, outputs: ["auxIncoming"] },
    { id: "makeAuxReflected", operator: "reflect_direction", inputs: { origin: "contact", incoming: "auxIncoming", normal: "contactNormal" }, outputs: ["auxReflected"] },
  );
}

function refused(result: ReturnType<typeof fibre>, what: string): string | null {
  if (result.ok) return `compiled ${what}`;
  if (!fatalCodes(result.fatal).includes("reflection_below_critical_angle")) return `refused with ${JSON.stringify(fatalCodes(result.fatal))}, not reflection_below_critical_angle`;
  return null;
}

function compiles(result: ReturnType<typeof fibre>, ids: string[]): string | null {
  if (!result.ok) return `did not compile: ${JSON.stringify(fatalCodes(result.fatal))}`;
  for (const id of ids) stroke(result.primitives, id);
  return null;
}

// Drawn: PRRT_kwDOTGXbp86rmYOW.
check("hidden refraction at the contact: the lone drawn 26.6 degree reflection is refused, the hidden ray still declares 1.58 to 1.47", () =>
  refused(fibre((document) => declareIndices(document, { sameContact: true, drawn: false })), "a lone reflection below the critical angle excused by a refraction that is not drawn"));

check("hidden helper reflection: a correct figure (71.6 degree TIR, a refraction drawn at the second contact) with an undrawn 45 degree helper reflection at the same contact compiles", () =>
  compiles(fibre((document) => {
    declareIndices(document);
    setInputs(document, "makeContact", { direction: [3, 1] });
    hiddenHelperReflection(document);
  }), ["reflected", "leakOut"]));

// Literal: PRRT_kwDOTGXbp86roZmz.
check("literal incoming on the reflection: incoming [1, 2] at 26.6 degrees is refused", () =>
  refused(fibre((document) => {
    declareIndices(document);
    setInputs(document, "makeReflection", { incoming: [1, 2] });
  }), "a reflection with a literal incoming vector at 26.6 degrees, below the 68.5 degree critical angle"));

check("literal incoming on the refraction: indices declared by refract_direction with incoming [1, 1] still hold the 26.6 degree reflection", () =>
  refused(fibre((document) => declareIndices(document, { literal: true })), "a reflection below the critical angle whose indices come from a refraction with a literal incoming vector"));

// Controls: pass before and after.
check("control: total internal reflection at 71.6 degrees, above the 68.5 degree critical angle, compiles", () =>
  compiles(fibre((document) => {
    declareIndices(document);
    setInputs(document, "makeContact", { direction: [3, 1] });
  }), ["reflected", "leakOut"]));

check("control: total internal reflection at 71.6 degrees with literal incoming vectors on the reflection and the refraction compiles", () =>
  compiles(fibre((document) => {
    declareIndices(document, { literal: true });
    setInputs(document, "makeContact", { direction: [3, 1] });
    setInputs(document, "makeReflection", { incoming: [3, 1] });
  }), ["reflected", "leakOut"]));

check("control: total internal reflection at 71.6 degrees with the indices from a hidden refraction at another contact compiles", () =>
  compiles(fibre((document) => {
    declareIndices(document, { drawn: false });
    setInputs(document, "makeContact", { direction: [3, 1] });
  }), ["reflected"]));

check("control: a hidden refraction at another contact still declares the indices, so the lone 26.6 degree reflection is refused", () =>
  refused(fibre((document) => declareIndices(document, { drawn: false })), "a lone reflection below the critical angle of indices a hidden refraction declares"));

check("control: a drawn refraction at the contact admits the partial reflection at 26.6 degrees", () =>
  compiles(fibre((document) => declareIndices(document, { sameContact: true })), ["reflected", "leakOut"]));

check("control: a drawn refraction at the contact admits the partial reflection when both use the literal incoming [1, 2]", () =>
  compiles(fibre((document) => {
    declareIndices(document, { sameContact: true, literal: true });
    setInputs(document, "makeReflection", { incoming: [1, 2] });
  }), ["reflected", "leakOut"]));

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
console.log("verify-ray-optics-reflections: ok (drawn reflections and refractions only; literal incoming vectors read)");
