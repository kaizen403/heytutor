import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const GEOMETRIC_OPTICS_OPERATORS = ["gaussian_image", "optical_focus"] as const;
type OpticalKind = "lens" | "mirror";
type ImageRole = "object_base" | "object_tip" | "image_base" | "image_tip";
interface OpticalDisplay { kind: OpticalKind; center: RenderPoint; axis: RenderPoint; normal: RenderPoint; displayScale: number; lengthUnit: string; focalLength: number }
type FocusModel = Pick<OpticalDisplay, "kind" | "displayScale" | "lengthUnit" | "focalLength">;
type ImageModel = FocusModel & Pick<OpticalImageDefinition, "objectDistance" | "imageDistance" | "objectHeight" | "imageHeight" | "magnification" | "objectIsReal" | "imageIsReal">;
export interface OpticalImageDefinition extends OpticalDisplay {
  anchorRole: ImageRole; objectDistance: number; imageDistance: number; objectHeight: number; imageHeight: number; magnification: number;
  objectIsReal: boolean; imageIsReal: boolean;
}
export interface OpticalFocusDefinition extends OpticalDisplay { anchorRole: "first_focus" | "second_focus" | "mirror_focus"; axisDistance: number }
export type GeometricOpticsGeometry = { kind: "point"; point: RenderPoint; opticalImage?: OpticalImageDefinition; opticalFocus?: OpticalFocusDefinition };
export interface GeometricOpticsEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }
const MAX_PHYSICAL = 1e9;
const MAX_COORDINATE = 1e12;
const MIN_PHYSICAL = 1e-9;
const MIN_DISPLAY = 1e-6;
const METRIC_TOLERANCE = 1e-8;
const LENGTH_UNITS: Readonly<Record<string, string>> = {
  unit: "unit", units: "unit", "1": "unit", dimensionless: "unit", m: "m", meter: "m", meters: "m", metre: "m", metres: "m",
  cm: "cm", centimeter: "cm", centimeters: "cm", centimetre: "cm", centimetres: "cm", mm: "mm", millimeter: "mm", millimeters: "mm", millimetre: "mm", millimetres: "mm",
  km: "km", kilometer: "km", kilometre: "km", um: "um", "µm": "um", "μm": "um", nm: "nm", in: "in", inch: "in", inches: "in", ft: "ft", foot: "ft", feet: "ft",
};
const INPUT_KEYS: Readonly<Record<string, readonly string[]>> = {
  gaussian_image: ["kind", "center", "axis", "objectDistance", "focalLength", "objectHeight", "displayScale", "lengthUnit"],
  optical_focus: ["kind", "center", "axis", "focalLength", "displayScale", "lengthUnit"],
};
class OpticalInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
class UnresolvedOpticalGeometry extends Error {}
function invalid(key: string, message: string): never { throw new OpticalInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function bounded(value: number, key: string, maximum = MAX_PHYSICAL): number { if (!Number.isFinite(value) || Math.abs(value) > maximum) invalid(key, `${key} requires a finite value with magnitude at most ${maximum}`); return value; }
function scalar(value: unknown, key: string, context: GeometricOpticsEvaluationContext, depth = 0, maximum = MAX_PHYSICAL): number {
  if (depth > 32) return invalid(key, "numeric reference depth exceeds32");
  if (isRecord(value) && "value" in value) {
    if (Object.keys(value).some((key) => key !== "value" && key !== "unit")) return invalid(key, "numeric wrapper accepts only value and unit");
    return scalar(value.value, key, context, depth + 1, maximum);
  }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return invalid(key, `${key} must be a numeric literal or quantity reference`);
  try { return bounded(context.number(value), key, maximum); }
  catch (error) { if (error instanceof OpticalInputError) throw error; return invalid(key, `${key} requires a finite numeric value`); }
}
function point(value: unknown, key: string): RenderPoint { if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") return invalid(key, `${key} must have finite x,y coordinates`); return { x: bounded(value.x, key, MAX_COORDINATE), y: bounded(value.y, key, MAX_COORDINATE) }; }
function inlinePoint(value: unknown, key: string, context: GeometricOpticsEvaluationContext): RenderPoint {
  const maximum = key === "center" ? MAX_COORDINATE : MAX_PHYSICAL;
  if (Array.isArray(value) && value.length === 2) return { x: scalar(value[0], key, context, 0, maximum), y: scalar(value[1], key, context, 0, maximum) };
  if (isRecord(value) && Object.keys(value).every((key) => key === "x" || key === "y")) return { x: scalar(value.x, key, context, 0, maximum), y: scalar(value.y, key, context, 0, maximum) };
  return invalid(key, `${key} requires [x,y] or {x,y}`);
}
function checkBasisMetadata(geometry: Record<string, unknown>, key: string): void {
  const allowed = geometry.kind === "point" ? ["kind", "point", "opticalImage", "opticalFocus"] : ["kind", "points", "infinite", "directed", "closed"];
  if (Object.keys(geometry).some((key) => !allowed.includes(key))) invalid(key, "Gaussian optics cannot reinterpret protected 3D, field, or analytic-basis metadata");
}
function centerInput(value: unknown, context: GeometricOpticsEvaluationContext): RenderPoint {
  if (typeof value !== "string") return point(inlinePoint(value, "center", context), "center");
  const geometry = context.geometry(value);
  if (!isRecord(geometry) || geometry.kind !== "point") return invalid("center", "center must reference a constructed 2D point");
  checkBasisMetadata(geometry, "center"); return point(geometry.point, "center");
}
function axisInput(value: unknown, center: RenderPoint, context: GeometricOpticsEvaluationContext): RenderPoint {
  let direction: RenderPoint;
  if (typeof value === "string") {
    const geometry = context.geometry(value);
    if (!isRecord(geometry) || geometry.kind !== "path" || geometry.infinite !== true || !Array.isArray(geometry.points) || geometry.points.length !== 2) return invalid("axis", "axis must reference a plain constructed line");
    checkBasisMetadata(geometry, "axis"); const a = point(geometry.points[0], "axis"); const b = point(geometry.points[1], "axis");
    direction = { x: b.x - a.x, y: b.y - a.y };
    const span = Math.hypot(direction.x, direction.y);
    if (!(span > MIN_DISPLAY)) invalid("axis", "axis line must be nonzero");
    const incidence = Math.abs(direction.x / span * (center.y - a.y) - direction.y / span * (center.x - a.x));
    if (incidence > MIN_DISPLAY) invalid("axis", "principal-axis line must pass through the optical center within placement precision");
  } else direction = inlinePoint(value, "axis", context);
  const length = Math.hypot(direction.x, direction.y); if (!(length > MIN_PHYSICAL) || !Number.isFinite(length)) invalid("axis", "axis direction must be nonzero and finite");
  return { x: direction.x / length, y: direction.y / length };
}
function sourceUnits(value: unknown, key: string, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) return invalid(key, "cyclic or overdeep source-unit reference");
  if (isRecord(value)) {
    if (!("value" in value) || Object.keys(value).some((field) => field !== "value" && field !== "unit")) invalid(key, "numeric wrapper accepts only value and unit");
    if (value.unit !== undefined && (typeof value.unit !== "string" || !value.unit.trim())) invalid(key, "unit must be a nonempty string");
    seen.add(value); return [...(typeof value.unit === "string" ? [value.unit] : []), ...sourceUnits(value.value, key, document, seen, depth + 1)];
  }
  const quantity = typeof value === "string" ? document?.quantities.find((item) => item.id === value) : undefined;
  if (!quantity) return [];
  if (quantity.unit !== undefined && (typeof quantity.unit !== "string" || !quantity.unit.trim())) invalid(key, "source quantity unit must be a nonempty string");
  seen.add(value); return [...(typeof quantity.unit === "string" ? [quantity.unit] : []), ...sourceUnits(quantity.value, key, document, seen, depth + 1)];
}
function normalizedUnit(value: string): string { return value.trim().replace(/[A-Za-z]{4,}/g, (word) => word.toLowerCase()); }
function checkSourceUnits(operator: string, inputs: Record<string, unknown>, document?: SceneDocument): void {
  const declared = inputs.lengthUnit === undefined ? "unit" : typeof inputs.lengthUnit === "string" ? LENGTH_UNITS[normalizedUnit(inputs.lengthUnit)] : undefined;
  if (!declared) invalid("lengthUnit", "lengthUnit must be a supported common length scale");
  for (const key of operator === "gaussian_image" ? ["objectDistance", "focalLength", "objectHeight"] : ["focalLength"]) {
    for (const unit of sourceUnits(inputs[key], key, document)) if (LENGTH_UNITS[normalizedUnit(unit)] !== declared) invalid(`${key}_unit`, "physical optical distances must use the declared common length unit; source scales are not silently converted");
  }
  for (const unit of sourceUnits(inputs.displayScale, "displayScale", document)) if (LENGTH_UNITS[normalizedUnit(unit)] !== "unit") invalid("displayScale_unit", "displayScale must be dimensionless");
  if (typeof inputs.axis !== "string") {
    const coordinates = Array.isArray(inputs.axis) ? inputs.axis : isRecord(inputs.axis) ? [inputs.axis.x, inputs.axis.y] : [];
    for (const value of coordinates) for (const unit of sourceUnits(value, "axis", document)) if (LENGTH_UNITS[normalizedUnit(unit)] !== "unit") invalid("axis_unit", "explicit axis directions must be dimensionless");
  }
  if (typeof inputs.center !== "string") {
    const coordinates = Array.isArray(inputs.center) ? inputs.center : isRecord(inputs.center) ? [inputs.center.x, inputs.center.y] : [];
    for (const value of coordinates) for (const unit of sourceUnits(value, "center", document)) {
      const canonical = LENGTH_UNITS[normalizedUnit(unit)];
      if (!canonical || canonical !== "unit" && canonical !== declared) invalid("center_unit", "optical center coordinates use an incompatible length scale");
    }
  }
}
function physicalModel(operator: string, inputs: Record<string, unknown>, context: GeometricOpticsEvaluationContext): FocusModel | ImageModel {
  if (!isRecord(inputs)) invalid("fields", "geometric optics inputs must be an object");
  const allowed = INPUT_KEYS[operator]; if (!allowed) return invalid("operator", `unsupported geometric optics operator ${operator}`);
  const extra = Object.keys(inputs).filter((key) => !allowed.includes(key)); if (extra.length) invalid("fields", `unsupported geometric optics inputs: ${extra.join(", ")}`);
  if (inputs.kind !== "lens" && inputs.kind !== "mirror") return invalid("kind", "optical kind must be explicit lens or mirror");
  const kind: OpticalKind = inputs.kind;
  checkSourceUnits(operator, inputs);
  const focalLength = scalar(inputs.focalLength, "focalLength", context); if (!(Math.abs(focalLength) > MIN_PHYSICAL)) invalid("focalLength", "signed focal length must be nonzero");
  const displayScale = scalar(inputs.displayScale, "displayScale", context); if (!(displayScale > 0)) invalid("displayScale", "displayScale must be positive");
  const lengthUnit = inputs.lengthUnit === undefined ? "unit" : typeof inputs.lengthUnit === "string" ? LENGTH_UNITS[normalizedUnit(inputs.lengthUnit)] : undefined;
  if (!lengthUnit) invalid("lengthUnit", "lengthUnit must be a supported common length scale");
  if (operator === "optical_focus") return { kind, focalLength, displayScale, lengthUnit };
  const objectDistance = scalar(inputs.objectDistance, "objectDistance", context); if (!(Math.abs(objectDistance) > MIN_PHYSICAL)) invalid("objectDistance", "signed object distance must be nonzero");
  const objectHeight = scalar(inputs.objectHeight, "objectHeight", context);
  const denominator = kind === "lens" ? objectDistance + focalLength : objectDistance - focalLength;
  if (!(Math.abs(denominator) / Math.max(Math.abs(objectDistance), Math.abs(focalLength)) > 1e-10)) invalid("objectDistance", "image at infinity or a numerically singular image cannot be represented by finite landmarks");
  const imageDistance = bounded(focalLength * (objectDistance / denominator), "imageDistance");
  const magnification = bounded((kind === "lens" ? 1 : -1) * imageDistance / objectDistance, "magnification");
  const imageHeight = bounded(magnification * objectHeight, "imageHeight");
  if (!(Math.abs(imageDistance) > 0) || !(Math.abs(magnification) > 0)) invalid("imageDistance", "finite Gaussian image must retain nonzero distance and magnification");
  const reciprocalLaw = 1 / imageDistance + (kind === "lens" ? -1 : 1) / objectDistance;
  if (Math.abs(reciprocalLaw - 1 / focalLength) > Math.abs(1 / focalLength) * METRIC_TOLERANCE) invalid("imageDistance", "Gaussian reciprocal law cannot be certified at numeric precision");
  return { kind, focalLength, displayScale, lengthUnit, objectDistance, imageDistance, objectHeight, imageHeight, magnification, objectIsReal: objectDistance < 0, imageIsReal: kind === "lens" ? imageDistance > 0 : imageDistance < 0 };
}
function displaced(center: RenderPoint, axis: RenderPoint, normal: RenderPoint, distance: number, height: number, scale: number): RenderPoint {
  const delta = { x: scale * (distance * axis.x + height * normal.x), y: scale * (distance * axis.y + height * normal.y) };
  const result = point({ x: center.x + delta.x, y: center.y + delta.y }, "geometry");
  const magnitude = Math.hypot(delta.x, delta.y);
  if (magnitude > 0 && Math.hypot((result.x - center.x) - delta.x, (result.y - center.y) - delta.y) > magnitude * METRIC_TOLERANCE) invalid("geometry", "optical landmark placement cannot preserve source distances at numeric precision");
  return result;
}

/** Ideal Cartesian Gaussian law derives anchors only; surfaces and rays remain independent operators. */
export function evaluateGeometricOpticsConstruction(operator: string, inputs: Record<string, unknown>, context: GeometricOpticsEvaluationContext): GeometricOpticsGeometry[] {
  const model = physicalModel(operator, inputs, context);
  const center = centerInput(inputs.center, context); const axis = axisInput(inputs.axis, center, context); const normal = { x: -axis.y, y: axis.x };
  if (operator === "optical_focus") {
    if (!(Math.abs(model.focalLength * model.displayScale) > MIN_DISPLAY)) invalid("geometry", "focus distance must be visible at display scale");
    const distances = model.kind === "lens" ? [-model.focalLength, model.focalLength] : [model.focalLength];
    return distances.map((axisDistance, index) => ({ kind: "point", point: displaced(center, axis, normal, axisDistance, 0, model.displayScale), opticalFocus: {
      kind: model.kind, center, axis, normal, displayScale: model.displayScale, lengthUnit: model.lengthUnit, focalLength: model.focalLength,
      axisDistance, anchorRole: model.kind === "mirror" ? "mirror_focus" : index === 0 ? "first_focus" : "second_focus",
    } }));
  }
  if (!("objectDistance" in model)) return invalid("operator", "Gaussian model is missing source distances");
  const display = { center, axis, normal, ...model };
  const roles: ImageRole[] = ["object_base", "object_tip", "image_base", "image_tip"];
  const locations = [[model.objectDistance, 0], [model.objectDistance, model.objectHeight], [model.imageDistance, 0], [model.imageDistance, model.imageHeight]];
  const outputs = roles.map((anchorRole, index): GeometricOpticsGeometry => ({ kind: "point", point: displaced(center, axis, normal, locations[index]![0]!, locations[index]![1]!, model.displayScale), opticalImage: { ...display, anchorRole } }));
  for (const [base, tip, height] of [[0, 1, model.objectHeight], [2, 3, model.imageHeight]]) {
    const a = outputs[base!]!.point; const b = outputs[tip!]!.point; const expected = height! * model.displayScale;
    if (height !== 0 && !(Math.abs(expected) > MIN_DISPLAY)) invalid("geometry", "nonzero object or image height is invisible at display scale");
    if (Math.hypot((b.x - a.x) - expected * normal.x, (b.y - a.y) - expected * normal.y) > Math.abs(expected) * METRIC_TOLERANCE) invalid("geometry", "image height cannot preserve magnification at placement precision");
  }
  if (!(Math.abs(model.objectDistance * model.displayScale) > MIN_DISPLAY) || !(Math.abs(model.imageDistance * model.displayScale) > MIN_DISPLAY)) invalid("geometry", "object and image distances must be visible at display scale");
  return outputs;
}
function compact(value: number): string {
  if (value === 0) return "0";
  const rounded = Number(value.toPrecision(4));
  return Math.abs(rounded) >= 1e6 || Math.abs(rounded) < 1e-3 ? rounded.toExponential().replace("e+", "e") : rounded.toString();
}
function evaluatedMetadata(operator: string, outputs: readonly unknown[]): GeometricOpticsGeometry[] {
  const first = outputs[0]; const field = operator === "gaussian_image" ? "opticalImage" : "opticalFocus";
  if (!GEOMETRIC_OPTICS_OPERATORS.some((item) => item === operator) || !isRecord(first) || !isRecord(first[field])) invalid("outputs", "optical labels require complete typed evaluated metadata");
  const model = first[field];
  const expected = evaluateGeometricOpticsConstruction(operator, {
    kind: model.kind, center: model.center, axis: model.axis, focalLength: model.focalLength, displayScale: model.displayScale, lengthUnit: model.lengthUnit,
    ...(operator === "gaussian_image" ? { objectDistance: model.objectDistance, objectHeight: model.objectHeight } : {}),
  }, { number: Number, geometry() { return undefined; }, point(value) { return point(value, "outputs"); } });
  if (outputs.length !== expected.length) invalid("outputs", "optical result labels require every ordered landmark");
  const same = (actual: unknown, reference: unknown): boolean => {
    if (typeof reference === "number") return typeof actual === "number" && Number.isFinite(actual) && Math.abs(actual - reference) <= 1e-10 * Math.max(1, Math.abs(reference));
    if (isRecord(reference)) return isRecord(actual) && Object.keys(actual).length === Object.keys(reference).length && Object.entries(reference).every(([key, value]) => same(actual[key], value));
    return actual === reference;
  };
  for (const [index, output] of outputs.entries()) {
    if (!isRecord(output) || output.kind !== "point" || Object.keys(output).some((key) => !["kind", "point", field].includes(key)) || !same(output[field], expected[index]![field])) invalid("outputs", "optical landmark metadata is malformed or contradicts the Cartesian model");
    const actual = point(output.point, "outputs"); const reference = expected[index]!.point;
    const delta = Math.hypot(reference.x - point(model.center, "outputs").x, reference.y - point(model.center, "outputs").y);
    if (Math.hypot(actual.x - reference.x, actual.y - reference.y) > METRIC_TOLERANCE * Math.max(1, delta)) invalid("outputs", "optical landmark geometry contradicts its physical metadata");
  }
  return expected;
}
export function geometricOpticsOutputLabels(operator: string, outputs: readonly unknown[]): string[] {
  return evaluatedMetadata(operator, outputs).map((output, index) => {
    const model = output.opticalImage ?? output.opticalFocus!;
    const suffix = model.lengthUnit === "unit" ? "" : ` ${model.lengthUnit}`;
    if (!("objectDistance" in model)) return `${model.kind === "lens" ? `F${index + 1}` : "F"}=${compact(model.axisDistance)}${suffix}`;
    return index === 0 ? `u=${compact(model.objectDistance)}${suffix}` : index === 1 ? `h_o=${compact(model.objectHeight)}${suffix}` : index === 2 ? `v=${compact(model.imageDistance)}${suffix}` : `m=${compact(model.magnification)}`;
  });
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) invalid("number", "cyclic or overdeep numeric reference");
  if (typeof value === "number") return bounded(value, "number", MAX_COORDINATE);
  if (isRecord(value) && "value" in value) { seen.add(value); return validationNumber(value.value, document, seen, depth + 1); }
  if (typeof value !== "string" || !value.trim()) return invalid("number", "numeric input must resolve to a finite scalar");
  const quantity = document.quantities.find((item) => item.id === value);
  if (!quantity) return bounded(Number(value), "number", MAX_COORDINATE);
  seen.add(value); return validationNumber(quantity.value, document, seen, depth + 1);
}
/** Labels retain source quantities; independently supplied results must satisfy the evaluated Cartesian model. */
export function validateEvaluatedGeometricOpticsLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  try {
    const evaluated = evaluatedMetadata(construction.operator, outputs);
    const labels = geometricOpticsOutputLabels(construction.operator, evaluated);
    for (const [outputIndex, outputId] of construction.outputs.entries()) {
      const model = evaluated[outputIndex]!.opticalImage ?? evaluated[outputIndex]!.opticalFocus!;
      const values: Record<string, number> = { f: model.focalLength };
      const defaultSymbol = "objectDistance" in model ? ["u", "h_o", "v", "h_i"][outputIndex]! : model.kind === "lens" ? `F${outputIndex + 1}` : "F";
      if ("objectDistance" in model) Object.assign(values, { u: model.objectDistance, v: model.imageDistance, h_o: model.objectHeight, h_i: model.imageHeight, m: model.magnification });
      else values[defaultSymbol] = model.axisDistance;
      const agrees = (actual: number, expected: number, tolerance = 5e-4): boolean => Math.abs(actual - expected) <= tolerance * Math.max(1e-9, Math.abs(expected));
      const checkUnits = (units: string[], symbol: string): void => {
        for (const unit of units) if (LENGTH_UNITS[normalizedUnit(unit)] !== (symbol === "m" ? "unit" : model.lengthUnit)) invalid("label", "optical label quantity uses a contradictory physical unit");
      };
      const checkText = (text: unknown): string | undefined => {
        if (text === undefined) return undefined;
        if (typeof text !== "string" || !text.trim()) invalid("label", "optical landmark labels must be nonempty strings");
        if (text === labels[outputIndex]) return labels[outputIndex]!.split("=")[0]!.trim();
        const label = text.trim().replaceAll("−", "-");
        if (Object.hasOwn(values, label)) return label;
        // This grammar checks mathematical scalar labels only; it never interprets question prose.
        if (/^[A-Za-z][A-Za-z_]*$/.test(label) || /^(?:F1|F2)$/.test(label)) return undefined;
        for (const part of label.split(";")) {
          const match = /^\s*(u|v|f|h_o|h_i|m|F1|F2|F)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([^\s]*)\s*$/.exec(part);
          if (!match || !Object.hasOwn(values, match[1]!)) invalid("label", "optical numeric labels must name a supported physical scalar");
          if (!agrees(Number(match[2]), values[match[1]!]!)) invalid("label", "optical numeric label contradicts the evaluated Gaussian result");
          if (match[3]) checkUnits([match[3]], match[1]!);
        }
        return label.split("=")[0]!.trim();
      };
      checkText(document.entities.find((entity) => entity.id === outputId)?.label);
      for (const annotation of document.annotations) {
        if (!annotation.targetIds.includes(outputId)) continue;
        const symbol = checkText(annotation.text) ?? defaultSymbol;
        if (annotation.quantityId !== undefined) {
          if (!agrees(validationNumber(annotation.quantityId, document), values[symbol]!, 1e-9)) invalid("label", "source-bound optical annotation contradicts the derived physical scalar");
          checkUnits(sourceUnits(annotation.quantityId, "label", document), symbol);
        }
      }
    }
  } catch (error) {
    issues.push({ code: `invalid_${construction.operator}_label`, severity: "fatal", message: error instanceof Error ? error.message : "invalid optical result labels", path: `constructions[${index}].outputs` });
  }
}
export function validateGeometricOpticsConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const add = (key: string, message: string): void => { issues.push({ code: `invalid_${construction.operator}_${key}`, message, severity: "fatal", path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}` }); };
  if (!isRecord(construction.inputs)) { add("fields", "geometric optics inputs must be an object"); return; }
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : []; const count = construction.operator === "gaussian_image" ? 4 : construction.inputs.kind === "lens" ? 2 : 1;
  if (outputs.length !== count || outputs.some((output) => typeof output !== "string" || !output.trim()) || new Set(outputs).size !== count) add("outputs", `${construction.operator} requires ${count} distinct point outputs`);
  for (const output of outputs) if (document.entities.find((entity) => entity.id === output)?.kind !== "point") add("output_kind", "optical landmarks must be point entities");
  const context: GeometricOpticsEvaluationContext = {
    number(value) { return validationNumber(value, document); },
    point(value) { const geometry = context.geometry(value); if (!isRecord(geometry) || geometry.kind !== "point") throw new UnresolvedOpticalGeometry(); return point(geometry.point, "center"); },
    geometry(value) {
      const producer = typeof value === "string" ? constructionByOutput.get(value) : undefined; if (!producer) return undefined;
      if (producer.operator === "point") return { kind: "point", point: { x: context.number(producer.inputs.x), y: context.number(producer.inputs.y) } };
      if (producer.operator === "line") {
        const a = producer.inputs.start ?? producer.inputs.from ?? producer.inputs.a; const b = producer.inputs.end ?? producer.inputs.to ?? producer.inputs.b;
        if (a === undefined || b === undefined) throw new UnresolvedOpticalGeometry();
        const start = typeof a === "string" ? context.point(a) : inlinePoint(a, "axis", context); const end = typeof b === "string" ? context.point(b) : inlinePoint(b, "axis", context);
        return { kind: "path", points: [start, end], infinite: true };
      }
      throw new UnresolvedOpticalGeometry();
    },
  };
  try {
    checkSourceUnits(construction.operator, construction.inputs, document);
    physicalModel(construction.operator, construction.inputs, context);
    const protectedOperators = new Set(["space_point", "space_project", "space_intersection", "space_closest_points", "space_segment", "space_line", "plane", "electric_field", "field_components", "conic_center", "conic_focus", "conic_vertex", "curve_anchor", "curve_derivative", "curve_secant", "kinematic_state", "kinematic_trajectory", "marked_angle", "angle_marker", "function_curve", "parametric_curve", "polar_curve"]);
    const provenance = (source: string, key: string, ancestors = new Set<string>(), depth = 0): void => {
      if (depth > 32 || ancestors.has(source)) invalid(key, "optical coordinate provenance is cyclic or overdeep");
      const producer = constructionByOutput.get(source);
      if (!producer) invalid(key, "optical basis must reference constructed geometry");
      if (protectedOperators.has(producer.operator)) invalid(key, "optical basis cannot reinterpret protected 3D, field, or analytic geometry");
      ancestors.add(source);
      const unit = construction.inputs.lengthUnit === undefined ? "unit" : LENGTH_UNITS[normalizedUnit(String(construction.inputs.lengthUnit))];
      const walk = (value: unknown, field: string, walkDepth = 0): void => {
        if (walkDepth + depth > 32) invalid(key, "optical basis dependencies exceed the verification depth");
        if (typeof value === "string" && constructionByOutput.has(value)) { provenance(value, key, new Set(ancestors), depth + 1); return; }
        if (Array.isArray(value)) { value.forEach((item) => walk(item, field, walkDepth + 1)); return; }
        if (isRecord(value) && !("value" in value)) { Object.entries(value).forEach(([name, item]) => walk(item, name, walkDepth + 1)); return; }
        for (const declared of sourceUnits(value, key, document)) {
          const canonical = LENGTH_UNITS[normalizedUnit(declared)];
          if (canonical && canonical !== "unit" && canonical !== unit || producer.operator === "point" && ["x", "y"].includes(field) && !canonical) invalid(key, "optical coordinate source quantities use an incompatible length scale");
        }
      };
      Object.entries(producer.inputs).forEach(([field, value]) => walk(value, field));
    };
    for (const key of ["center", "axis"]) {
      const value = construction.inputs[key];
      if (typeof value !== "string") { inlinePoint(value, key, context); continue; }
      const entity = document.entities.find((entity) => entity.id === value);
      if (entity?.kind !== (key === "center" ? "point" : "line")) invalid(key, `${key} must reference a constructed ${key === "center" ? "point" : "line"} entity`);
      provenance(value, key);
    }
    const evaluated = evaluateGeometricOpticsConstruction(construction.operator, construction.inputs, context);
    validateEvaluatedGeometricOpticsLabels(construction, index, document, evaluated, issues);
  }
  catch (error) { if (!(error instanceof UnresolvedOpticalGeometry)) add(error instanceof OpticalInputError ? error.key : "inputs", error instanceof Error ? error.message : "invalid optical construction"); }
}
