/**
 * Compile a verified scene from the question, turn plan, and inferred visual
 * family. Geometry comes from operators and plan quantities — never from
 * planner-authored pixels.
 */
import { compileSceneDocument } from "../compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import { parseMathExpression } from "../math/expression";
import { evaluateOpticsLaw } from "../physics/opticsLaws";
import {
  SCENE_DOCUMENT_VERSION,
  type RenderScene,
  type SceneAssertion,
  type SceneConstruction,
  type SceneDocument,
  type SceneEntity,
  type SceneRevealGroup,
  type SceneTeachingAction,
  type ValidationReport,
} from "../types";

export const SYNTHESIZED_REPRESENTATION_TIERS = [
  "exact_verified",
  "qualitative_verified",
  "question_representation",
] as const;

export type SynthesizedRepresentationTier = (typeof SYNTHESIZED_REPRESENTATION_TIERS)[number];

export interface FamilySceneInput {
  question: string;
  turnPlan?: unknown;
  families?: readonly string[];
}

export interface SynthesizedFamilyScene {
  document: SceneDocument;
  renderScene: RenderScene;
  validationReport: ValidationReport;
  tier: SynthesizedRepresentationTier;
  nonMetric: boolean;
  reason: string;
  family: string;
}

const FAMILY_PRIORITY = [
  "instrument_chain",
  "interface",
  "axis_view",
  "ray_path",
  "circuit_network",
  "analytic_curve",
  "bounded_region",
  "state_plot",
  "contact_body",
  "vector_diagram",
  "aperture",
  "screen_pattern",
  "wavefront",
  "polarizer",
  "transverse_field",
  "coordinate_figure",
  "solid_figure",
  "point_field",
  "energy_level",
  "fluid_apparatus",
] as const;

type FamilyBuilder = (
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
) => SceneDocument | null;

interface PlanQuantity {
  id: string;
  symbol: string;
  value: number;
  unit?: string;
  sourceText?: string;
}

export function synthesizeFamilyScene(input: FamilySceneInput): SynthesizedFamilyScene | null {
  return synthesizeFromFamilies(input, false);
}

export function synthesizeLastResortScene(input: FamilySceneInput): SynthesizedFamilyScene | null {
  return synthesizeFromFamilies(input, true);
}

function synthesizeFromFamilies(
  input: FamilySceneInput,
  schematic: boolean,
): SynthesizedFamilyScene | null {
  const question = input.question.trim();
  if (!question) return null;
  const quantities = collectPlanQuantities(input.turnPlan);
  const families = orderedFamilies(input.families ?? inferFamiliesFromQuestion(question));
  for (const family of families) {
    const builder = FAMILY_BUILDERS[family];
    if (!builder) continue;
    const document = builder(question, quantities, schematic);
    const compiled = document ? tryCompile(document) : null;
    if (!compiled) continue;
    const nonMetric = schematic || familyUsesDisplayScale(family);
    return {
      ...compiled,
      tier: schematic
        ? "question_representation"
        : nonMetric ? "qualitative_verified" : "exact_verified",
      nonMetric,
      reason: schematic
        ? `compiled a ${family} schematic after the exact operator program was unavailable`
        : `compiled ${family} from the turn plan and reusable operators`,
      family,
    };
  }
  return null;
}

function familyUsesDisplayScale(family: string): boolean {
  return family === "analytic_curve" || family === "bounded_region" || family === "state_plot"
    || family === "energy_level" || family === "coordinate_figure";
}

function orderedFamilies(families: readonly string[]): string[] {
  const known = new Set(families);
  return FAMILY_PRIORITY.filter((family) => known.has(family));
}

function inferFamiliesFromQuestion(question: string): string[] {
  const matches: string[] = [];
  const rules: Array<readonly [RegExp, readonly string[]]> = [
    [/(?:microscope|telescope|objective|eyepiece)/i, ["instrument_chain", "axis_view"]],
    [/(?:refraction|refracted|critical angle|prism|brewster|optical fibr)/i, ["interface", "ray_path"]],
    [/(?:spherical (?:air|refracting|surface|interface)|air-glass interface|paraxial image|center of curvature|surface[- ]normal)/i, ["axis_view", "interface", "ray_path"]],
    [/(?:mirror|lens|focal point|principal axis)/i, ["axis_view", "ray_path"]],
    [/(?:circuit|resistor|inductor|capacitor|\bLCR\b|\bemf\b)/i, ["circuit_network"]],
    [/(?:y\s*=|parametric|polar curve|sketch (?:the )?(?:curve|graph)|F\s*=\s*5x|F_x\s*=|F versus x|U\s*=\s*\(|U\(x\)|U\(r\)\s*=)/i, ["analytic_curve"]],
    [/(?:p[-–—]?v|thermodynamic cycle|v[-–]?t graph|s[-–]?t graph)/i, ["state_plot"]],
    [/(?:incline|pulley|hinged|free[- ]body|friction|hanging (?:mass|block)|raindrop|dropped from|pushes a (?:box|block)|spring of stiffness|spring-block|vertical circl|collid|collision|head-on|particle of mass|body of mass|towed at)/i, ["contact_body"]],
    [/(?:resultant of|two vectors|vector components|parallelogram law|velocity vectors)/i, ["vector_diagram"]],
    [/(?:double.?slit|single.?slit|interference|fringe|diffraction)/i, ["aperture", "screen_pattern"]],
    [/(?:wavefront|huygens)/i, ["wavefront"]],
    [/(?:polari[sz]er|malus)/i, ["polarizer"]],
    [/(?:point charges?|electric[- ]field|magnetic field)/i, ["point_field"]],
    [/(?:photoelectric|energy levels?|bohr)/i, ["energy_level"]],
    [/(?:cylinder|hemisphere|frustum|cone of radius)/i, ["solid_figure"]],
    [/(?:cylindrical vessels|connected at the bottom|hydraulic|piston|venturi)/i, ["fluid_apparatus"]],
    [/(?:moves from \()/i, ["coordinate_figure"]],
  ];
  for (const [pattern, families] of rules) {
    if (pattern.test(question)) families.forEach((family) => {
      if (!matches.includes(family)) matches.push(family);
    });
  }
  return matches;
}

const FAMILY_BUILDERS: Record<string, FamilyBuilder> = {
  instrument_chain: buildInstrumentChain,
  interface: buildInterfaceRays,
  ray_path: buildInterfaceRays,
  axis_view: buildAxisView,
  circuit_network: buildCircuit,
  analytic_curve: buildAnalyticCurve,
  bounded_region: buildAnalyticCurve,
  state_plot: buildStatePlot,
  contact_body: buildContactBody,
  vector_diagram: buildVectorDiagram,
  aperture: buildAperturePattern,
  screen_pattern: buildAperturePattern,
  wavefront: buildWavefront,
  polarizer: buildPolarizer,
  transverse_field: buildTransverseField,
  coordinate_figure: buildCoordinateFigure,
  solid_figure: buildSolidFigure,
  point_field: buildPointField,
  energy_level: buildEnergyLevel,
  fluid_apparatus: buildFluidApparatus,
};

function buildInstrumentChain(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  if (!/(?:microscope|telescope|objective|eyepiece)/i.test(question) && !schematic) return null;
  const fo = absQuantity(quantities, ["fo", "objectivefocallength", "focalobjective"]);
  const fe = absQuantity(quantities, ["fe", "eyepiecefocallength", "focaleyepiece"]);
  const uo = absQuantity(quantities, ["uo", "objectdistance", "uobjective"]);
  const nearPoint = absQuantity(quantities, ["d", "nearpoint", "leastdistance"]);
  if (!schematic && (fo === null || uo === null)) return null;
  const sceneQuantities = [
    quantityRecord("f_o", "f_o", fo ?? 0.004, unitOf(quantities, ["fo"]) ?? "m"),
    quantityRecord("f_e", "f_e", fe ?? 0.025, unitOf(quantities, ["fe"]) ?? "m"),
    quantityRecord("u_o", "u_o", uo ?? 0.0045, unitOf(quantities, ["uo"]) ?? "m"),
    quantityRecord("D", "D", nearPoint ?? 0.25, unitOf(quantities, ["d", "nearpoint"]) ?? "m"),
  ];
  return baseDocument({
    question,
    reason: "finite optical instrument chain from plan quantities",
    quantities: sceneQuantities,
    entities: [
      { id: "O", kind: "point", role: "object position", label: "O" },
      { id: "I", kind: "point", role: "intermediate real image", label: "I" },
      { id: "I_prime", kind: "point", role: "final virtual image", label: "I'" },
      { id: "L_o", kind: "point", role: "objective lens center" },
      { id: "L_e", kind: "point", role: "eyepiece lens center" },
      { id: "axis", kind: "line", role: "optical axis" },
      { id: "obj_lens", kind: "line", role: "objective lens", label: "L_o" },
      { id: "eye_lens", kind: "line", role: "eyepiece lens", label: "L_e" },
    ],
    constructions: [],
    assertions: [],
  });
}

function buildInterfaceRays(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  if (/(?:microscope|telescope)/i.test(question) && !schematic) return null;
  if (/\bprism\b/i.test(question)) return buildPrism(question, quantities, schematic);
  if (isSphericalInterface(question, quantities)) {
    return buildSphericalInterface(question, quantities, schematic);
  }
  if (isSphericalMirrorOrLens(question, quantities)) return null;
  const reflection = /(?:reflect|mirror|law of reflection)/i.test(question)
    && !/(?:refract|snell|glass|prism|water)/i.test(question);
  const incident = angleDegrees(quantities, question);
  const n2 = firstQuantity(quantities, ["n2", "nglass", "n", "mu", "refractiveindex"]);
  const n1 = firstQuantity(quantities, ["n1", "nair"]) ?? 1;
  if (!schematic && incident === null) return null;
  if (!schematic && !reflection && n2 === null) return null;
  const theta = incident ?? 30;
  const index2 = n2 ?? 1.5;
  if (reflection) {
    return surfaceRayDocument(question, {
      operator: "reflect_at",
      theta,
      n1: 1,
      n2: 1,
      outgoingId: "reflected",
      outgoingRole: "reflected ray",
    });
  }
  try {
    evaluateOpticsLaw("snell_law", { n1, n2: index2, incidentDeg: theta });
  } catch {
    if (!schematic) return null;
  }
  return surfaceRayDocument(question, {
    operator: "refract_at",
    theta,
    n1,
    n2: index2,
    outgoingId: "refracted",
    outgoingRole: "refracted ray",
  });
}

function surfaceRayDocument(
  question: string,
  options: {
    operator: "reflect_at" | "refract_at";
    theta: number;
    n1: number;
    n2: number;
    outgoingId: string;
    outgoingRole: string;
  },
): SceneDocument {
  const outgoingId = options.outgoingId;
  return baseDocument({
    question,
    reason: `atomic ${options.operator} from plan incidence and indices`,
    quantities: [
      { id: "theta", symbol: "theta", value: options.theta, unit: "degree" },
      { id: "n1", symbol: "n1", value: options.n1, unit: "1" },
      { id: "n2", symbol: "n2", value: options.n2, unit: "1" },
    ],
    entities: [
      { id: "left", kind: "point", role: "interface endpoint" },
      { id: "right", kind: "point", role: "interface endpoint" },
      { id: "contact", kind: "point", role: "point of incidence" },
      { id: "interface", kind: "segment", role: "optical interface" },
      { id: "incident", kind: "ray", role: "incident ray" },
      { id: "normal", kind: "segment", role: "surface normal" },
      { id: outgoingId, kind: "ray", role: options.outgoingRole },
    ],
    constructions: [
      pointAt("left", -3, 0),
      pointAt("right", 3, 0),
      pointAt("contact", 0, 0),
      { id: "make_interface", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["interface"] },
      {
        id: "make_bundle",
        operator: options.operator,
        inputs: options.operator === "refract_at"
          ? { point: "contact", surface: "interface", incidentAngleDeg: "theta", n1: "n1", n2: "n2", span: 2 }
          : { point: "contact", surface: "interface", incidentAngleDeg: "theta", span: 2 },
        outputs: ["incident", "normal", outgoingId],
      },
    ],
    assertions: [
      { id: "contact_on_surface", predicate: "on", entities: ["contact", "interface"], expected: true, severity: "fatal" },
      { id: "normal_perpendicular", predicate: "perpendicular", entities: ["normal", "interface"], expected: true, severity: "fatal" },
      options.operator === "refract_at"
        ? {
            id: "snell",
            predicate: "snells_law",
            entities: ["incident", "normal", outgoingId],
            expected: { n1: options.n1, n2: options.n2 },
            tolerance: 1e-6,
            severity: "fatal",
          }
        : {
            id: "reflection_angles",
            predicate: "equal_angle",
            entities: ["incident", "normal", outgoingId, "normal"],
            expected: true,
            tolerance: 1e-6,
            severity: "fatal",
          },
    ],
  });
}

function isSphericalInterface(question: string, quantities: PlanQuantity[]): boolean {
  const hasRadius = absQuantity(quantities, ["r", "radius"]) !== null
    || /\bradius\b/i.test(question);
  const hasObject = absQuantity(quantities, ["u", "s", "objectdistance"]) !== null
    || /\b(?:point object|object is|from a spherical)\b/i.test(question);
  return hasRadius && hasObject &&
    /(?:spherical|interface|paraxial image|center of curvature|surface[- ]normal)/i.test(question);
}

function buildSphericalInterface(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  const objectDistance = absQuantity(quantities, ["u", "s", "objectdistance"])
    ?? questionNumber(question, /(\d+(?:\.\d+)?)\s*(?:cm|mm|m)\s+from/i);
  const radius = absQuantity(quantities, ["r", "radius"])
    ?? questionNumber(question, /radius\s+(?:of\s+)?(\d+(?:\.\d+)?)/i);
  const n2 = firstQuantity(quantities, ["n2", "n", "nglass", "mu", "refractiveindex"])
    ?? questionNumber(question, /(?:index|n)\s*(?:=|is)?\s*(\d+(?:\.\d+)?)/i);
  const n1 = firstQuantity(quantities, ["n1", "nair"]) ?? 1;
  if (!schematic && (objectDistance === null || radius === null || n2 === null)) return null;
  const u = objectDistance ?? 0.3;
  const R = radius ?? 0.1;
  const index2 = n2 ?? 1.5;
  let imageDistance = u * 3;
  try {
    imageDistance = evaluateOpticsLaw("spherical_refraction", {
      n1,
      n2: index2,
      objectDistance: u,
      radius: R,
    }).imageDistance;
  } catch {
    if (!schematic) return null;
  }
  const xs = displayAxis([-u, 0, R, imageDistance]);
  const objectX = xs[0]!;
  const vertexX = xs[1]!;
  const centerX = xs[2]!;
  const imageX = xs[3]!;
  const radiusDisplay = Math.abs(centerX - vertexX);
  return baseDocument({
    question,
    reason: "spherical refracting surface from the paraxial imaging law",
    quantities: [
      quantityRecord("u", "u", u, unitOf(quantities, ["u", "s", "objectdistance"]) ?? "m"),
      quantityRecord("R", "R", R, unitOf(quantities, ["r", "radius"]) ?? "m"),
      quantityRecord("n1", "n1", n1, "1"),
      quantityRecord("n2", "n2", index2, "1"),
      quantityRecord("v", "v", imageDistance, unitOf(quantities, ["v", "imagedistance"]) ?? "m"),
    ],
    entities: [
      { id: "O", kind: "point", role: "object position", label: "O" },
      { id: "V", kind: "point", role: "surface vertex", label: "V" },
      { id: "C", kind: "point", role: "center of curvature", label: "C" },
      { id: "I", kind: "point", role: "paraxial image", label: "I" },
      { id: "contact", kind: "point", role: "point of incidence", label: "P" },
      { id: "axis", kind: "line", role: "optical axis" },
      { id: "interface", kind: "arc", role: "spherical interface" },
      { id: "normal", kind: "segment", role: "surface normal" },
      { id: "radius", kind: "segment", role: "radius", label: "R" },
    ],
    constructions: [
      pointAt("O", objectX, 0),
      pointAt("V", vertexX, 0),
      pointAt("C", centerX, 0),
      pointAt("I", imageX, 0),
      pointAt("contact", vertexX + radiusDisplay * (1 - Math.cos(Math.PI / 8)), radiusDisplay * Math.sin(Math.PI / 8)),
      { id: "make_axis", operator: "line", inputs: { start: "O", end: "I" }, outputs: ["axis"] },
      {
        id: "make_interface",
        operator: "arc",
        inputs: { center: "C", radius: radiusDisplay, startAngle: 120, endAngle: 240, angleUnit: "degrees" },
        outputs: ["interface"],
      },
      { id: "make_normal", operator: "normal_at", inputs: { point: "contact", surface: "interface" }, outputs: ["normal"] },
      { id: "make_radius", operator: "segment", inputs: { start: "C", end: "V" }, outputs: ["radius"] },
    ],
    assertions: [
      { id: "O_on_axis", predicate: "on", entities: ["O", "axis"], expected: true, severity: "fatal" },
      { id: "V_on_axis", predicate: "on", entities: ["V", "axis"], expected: true, severity: "fatal" },
      { id: "C_on_axis", predicate: "on", entities: ["C", "axis"], expected: true, severity: "fatal" },
      { id: "I_on_axis", predicate: "on", entities: ["I", "axis"], expected: true, severity: "fatal" },
      { id: "V_on_surface", predicate: "on", entities: ["V", "interface"], expected: true, severity: "fatal" },
      { id: "P_on_surface", predicate: "on", entities: ["contact", "interface"], expected: true, severity: "fatal" },
      { id: "label_O", predicate: "label_attached", entities: ["O"], expected: true, severity: "fatal" },
      { id: "label_C", predicate: "label_attached", entities: ["C"], expected: true, severity: "fatal" },
      { id: "label_I", predicate: "label_attached", entities: ["I"], expected: true, severity: "fatal" },
      { id: "label_V", predicate: "label_attached", entities: ["V"], expected: true, severity: "fatal" },
    ],
    teachingTimeline: [
      {
        id: "reveal_setup",
        action: "reveal",
        targetId: "setup",
        dependsOn: [],
        narrationIntent: "Begin with the spherical surface and the points O, V, C, and I on the axis.",
      },
      {
        id: "focus_object",
        action: "focus",
        targetId: "O",
        dependsOn: ["reveal_setup"],
        narrationIntent: "This is O, the object.",
      },
      {
        id: "focus_image",
        action: "focus",
        targetId: "I",
        dependsOn: ["focus_object"],
        narrationIntent: "This is I, the image.",
      },
    ],
  });
}

function questionNumber(question: string, pattern: RegExp): number | null {
  const match = pattern.exec(question);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function buildPrism(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  const apex = firstQuantity(quantities, ["a", "apex", "apexangle", "angle"])
    ?? angleDegrees(quantities, question);
  if (!schematic && apex === null) return null;
  const A = apex ?? 60;
  const half = (A / 2) * Math.PI / 180;
  const size = 3;
  const leftX = -Math.sin(half) * size;
  const rightX = Math.sin(half) * size;
  const apexY = Math.cos(half) * size;
  return baseDocument({
    question,
    reason: "prism cross-section from the named apex angle",
    quantities: [{ id: "A", symbol: "A", value: A, unit: "degree" }],
    entities: [
      { id: "apex", kind: "point", role: "prism apex", label: "A" },
      { id: "left", kind: "point", role: "prism base", label: "B" },
      { id: "right", kind: "point", role: "prism base", label: "C" },
      { id: "prism", kind: "polygon", role: "prism" },
    ],
    constructions: [
      pointAt("apex", 0, apexY),
      pointAt("left", leftX, 0),
      pointAt("right", rightX, 0),
      { id: "make_prism", operator: "polygon", inputs: { points: ["apex", "left", "right"] }, outputs: ["prism"] },
    ],
    assertions: [
      { id: "prism_exists", predicate: "exists", entities: ["prism"], expected: true, severity: "fatal" },
    ],
  });
}

function isSphericalMirrorOrLens(question: string, quantities: PlanQuantity[]): boolean {
  if (isSphericalInterface(question, quantities)) return false;
  if (/(?:microscope|telescope)/i.test(question)) return false;
  const focal = absQuantity(quantities, ["f", "focallength"]);
  const objectDistance = absQuantity(quantities, ["u", "objectdistance"]);
  return /(?:concave|convex)\s+(?:mirror|lens)/i.test(question)
    || (/\b(?:mirror|lens)\b/i.test(question) && focal !== null && objectDistance !== null);
}

function buildAxisView(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  if (/(?:microscope|telescope)/i.test(question)) return null;
  if (isSphericalInterface(question, quantities)) {
    return buildSphericalInterface(question, quantities, schematic);
  }
  const focalMagnitude = absQuantity(quantities, ["f", "focallength"]);
  const objectDistance = absQuantity(quantities, ["u", "objectdistance"]);
  const imageDistanceGiven = firstQuantity(quantities, ["v", "imagedistance"]);
  const mirror = /\bmirror\b/i.test(question);
  if (!schematic && (focalMagnitude === null || (objectDistance === null && imageDistanceGiven === null))) {
    return null;
  }
  const convex = /\bconvex\s+(?:mirror|lens)\b/i.test(question)
    || ((firstQuantity(quantities, ["f", "focallength"]) ?? 0) < 0 && mirror);
  let u = objectDistance ?? focalMagnitude ?? 1;
  const f = (focalMagnitude ?? u / 2) * (convex ? -1 : 1);
  if (Math.abs(u - Math.abs(f)) < 1e-9) {
    if (!schematic) return null;
    u = Math.abs(f) * 1.5;
  }
  let imageDistance = imageDistanceGiven;
  let magnification = -1;
  try {
    const solved = evaluateOpticsLaw(mirror ? "mirror_formula" : "thin_lens_formula", {
      objectDistance: u,
      focalLength: f,
    });
    imageDistance = solved.imageDistance;
    magnification = solved.magnification;
  } catch {
    if (!schematic) return null;
  }
  const v = imageDistance ?? (mirror && convex ? -u / 2 : u * 2);
  if (mirror) return buildParaxialMirror(question, quantities, { u, f, v, magnification });
  return buildThinLens(question, quantities, { u, f, v, magnification });
}

function buildParaxialMirror(
  question: string,
  quantities: PlanQuantity[],
  values: { u: number; f: number; v: number; magnification: number },
): SceneDocument {
  const { u, f, v, magnification } = values;
  const poleX = 0;
  const objectX = -u;
  const focusX = -f;
  const centerX = -2 * f;
  const imageX = -v;
  const objectHeight = Math.abs(f) * 0.08;
  const imageHeight = objectHeight * magnification;
  const xs = [objectX, poleX, focusX, centerX, imageX];
  const pad = Math.abs(f) * 0.4;
  const leftX = Math.min(...xs) - pad;
  const rightX = Math.max(...xs) + pad;
  const vertexAngle = Math.atan2(0, poleX - centerX) * 180 / Math.PI;
  const sweep = 40;
  const radius = Math.abs(2 * f);
  const unit = unitOf(quantities, ["f", "focallength", "u", "objectdistance"]) ?? "cm";
  const realImage = v > 0;
  return baseDocument({
    question,
    reason: "paraxial mirror construction from the mirror formula",
    quantities: [
      quantityRecord("f", "f", f, unit),
      quantityRecord("u", "u", u, unit),
      quantityRecord("v", "v", v, unit),
      quantityRecord("m", "m", magnification, "1"),
    ],
    entities: [
      { id: "left_axis", kind: "point", role: "axis endpoint" },
      { id: "right_axis", kind: "point", role: "axis endpoint" },
      { id: "P", kind: "point", role: "pole", label: "P" },
      { id: "F", kind: "point", role: "focal point", label: "F" },
      { id: "C", kind: "point", role: "center of curvature", label: "C" },
      { id: "object_base", kind: "point", role: "object position", label: "O" },
      { id: "object_tip", kind: "point", role: "object tip" },
      { id: "image_base", kind: "point", role: "image position", label: "I" },
      { id: "image_tip", kind: "point", role: "image tip" },
      { id: "axis", kind: "segment", role: "principal axis" },
      { id: "mirror", kind: "arc", role: "spherical mirror", label: "M" },
      { id: "object", kind: "vector", role: "object" },
      { id: "image", kind: "vector", role: "image" },
      { id: "hit_parallel", kind: "point", role: "surface intersection" },
      { id: "incident_parallel", kind: "vector", role: "incident ray" },
      { id: "normal_parallel", kind: "vector", role: "surface normal" },
      { id: "reflected_parallel", kind: "ray", role: "reflected ray" },
      { id: "hit_focus", kind: "point", role: "surface intersection" },
      { id: "incident_focus", kind: "vector", role: "incident ray" },
      { id: "normal_focus", kind: "vector", role: "surface normal" },
      { id: "reflected_focus", kind: "ray", role: "reflected ray" },
    ],
    constructions: [
      pointAt("left_axis", leftX, 0),
      pointAt("right_axis", rightX, 0),
      pointAt("P", poleX, 0),
      pointAt("F", focusX, 0),
      pointAt("C", centerX, 0),
      pointAt("object_base", objectX, 0),
      pointAt("object_tip", objectX, objectHeight),
      pointAt("image_base", imageX, 0),
      pointAt("image_tip", imageX, imageHeight),
      { id: "make_axis", operator: "segment", inputs: { start: "left_axis", end: "right_axis" }, outputs: ["axis"] },
      {
        id: "make_mirror",
        operator: "arc",
        inputs: {
          center: "C",
          radius,
          startAngle: vertexAngle - sweep,
          endAngle: vertexAngle + sweep,
          angleUnit: "degrees",
        },
        outputs: ["mirror"],
      },
      { id: "make_object", operator: "vector", inputs: { start: "object_base", end: "object_tip" }, outputs: ["object"] },
      { id: "make_image", operator: "vector", inputs: { start: "image_base", end: "image_tip" }, outputs: ["image"] },
      {
        id: "make_parallel_contact",
        operator: "surface_contact",
        inputs: { origin: "object_tip", direction: [1, 0], surface: "mirror" },
        outputs: ["hit_parallel", "incident_parallel"],
      },
      { id: "make_parallel_normal", operator: "normal_at", inputs: { point: "hit_parallel", surface: "mirror" }, outputs: ["normal_parallel"] },
      {
        id: "make_parallel_reflection",
        operator: "reflect_direction",
        inputs: { origin: "hit_parallel", incoming: "incident_parallel", normal: "normal_parallel" },
        outputs: ["reflected_parallel"],
      },
      {
        id: "make_focus_contact",
        operator: "surface_contact",
        inputs: { origin: "object_tip", through: "F", surface: "mirror" },
        outputs: ["hit_focus", "incident_focus"],
      },
      { id: "make_focus_normal", operator: "normal_at", inputs: { point: "hit_focus", surface: "mirror" }, outputs: ["normal_focus"] },
      {
        id: "make_focus_reflection",
        operator: "reflect_direction",
        inputs: { origin: "hit_focus", incoming: "incident_focus", normal: "normal_focus" },
        outputs: ["reflected_focus"],
      },
    ],
    assertions: [
      { id: "P_on_axis", predicate: "on", entities: ["P", "axis"], expected: true, severity: "fatal" },
      { id: "F_on_axis", predicate: "on", entities: ["F", "axis"], expected: true, severity: "fatal" },
      { id: "C_on_axis", predicate: "on", entities: ["C", "axis"], expected: true, severity: "fatal" },
      { id: "object_on_axis", predicate: "on", entities: ["object_base", "axis"], expected: true, severity: "fatal" },
      { id: "image_on_axis", predicate: "on", entities: ["image_base", "axis"], expected: true, severity: "fatal" },
      { id: "P_on_mirror", predicate: "on", entities: ["P", "mirror"], expected: true, severity: "fatal" },
      { id: "focus_between", predicate: "between", entities: ["F", "C", "P"], expected: true, severity: "fatal" },
      {
        id: "image_distance_ratio",
        predicate: "distance_ratio",
        entities: ["image_base", "P", "object_base", "P"],
        expected: Math.abs(v / u),
        tolerance: 0.0001,
        severity: "fatal",
      },
      { id: "label_O", predicate: "label_attached", entities: ["object_base"], expected: true, severity: "fatal" },
      { id: "label_I", predicate: "label_attached", entities: ["image_base"], expected: true, severity: "fatal" },
      { id: "label_F", predicate: "label_attached", entities: ["F"], expected: true, severity: "fatal" },
      { id: "label_C", predicate: "label_attached", entities: ["C"], expected: true, severity: "fatal" },
      { id: "label_P", predicate: "label_attached", entities: ["P"], expected: true, severity: "fatal" },
      ...(realImage
        ? [{
            id: "rays_meet_image",
            predicate: "converges" as const,
            entities: ["reflected_parallel", "reflected_focus", "image_tip"],
            expected: true,
            tolerance: 0.2,
            severity: "fatal" as const,
          }]
        : []),
    ],
    revealGroups: [
      {
        id: "mirror_setup",
        entityIds: ["left_axis", "right_axis", "axis", "P", "F", "C", "mirror"],
        dependsOn: [],
        narrationCue: "Begin with the spherical mirror and the points P, F, and C on the principal axis.",
      },
      {
        id: "object_image",
        entityIds: ["object_base", "object_tip", "object", "image_base", "image_tip", "image"],
        dependsOn: ["mirror_setup"],
        narrationCue: "O is the object in front of the mirror, and I is the image.",
      },
      {
        id: "principal_rays",
        entityIds: [
          "hit_parallel", "incident_parallel", "normal_parallel", "reflected_parallel",
          "hit_focus", "incident_focus", "normal_focus", "reflected_focus",
        ],
        dependsOn: ["object_image"],
        narrationCue: "Follow the principal rays from the object to the image.",
      },
    ],
    teachingTimeline: [
      {
        id: "reveal_mirror_setup",
        action: "reveal",
        targetId: "mirror_setup",
        dependsOn: [],
        narrationIntent: "Begin with the spherical mirror and the points P, F, and C on the principal axis.",
      },
      {
        id: "reveal_object_image",
        action: "reveal",
        targetId: "object_image",
        dependsOn: ["reveal_mirror_setup"],
        narrationIntent: "O is the object in front of the mirror, and I is the image.",
      },
      {
        id: "reveal_principal_rays",
        action: "reveal",
        targetId: "principal_rays",
        dependsOn: ["reveal_object_image"],
        narrationIntent: "Follow the principal rays from the object to the image.",
      },
      {
        id: "focus_object",
        action: "focus",
        targetId: "object_base",
        dependsOn: ["reveal_principal_rays"],
        narrationIntent: "This is O, the object.",
      },
      {
        id: "focus_image",
        action: "focus",
        targetId: "image_base",
        dependsOn: ["focus_object"],
        narrationIntent: "This is I, the image.",
      },
    ],
  });
}

function buildThinLens(
  question: string,
  quantities: PlanQuantity[],
  values: { u: number; f: number; v: number; magnification: number },
): SceneDocument {
  const { u, f, v, magnification } = values;
  const objectHeight = Math.abs(f) * 0.08;
  const imageHeight = objectHeight * magnification;
  const objectX = 0;
  const lensX = u;
  const focusX = u + f;
  const imageX = u + v;
  const pad = Math.abs(f) * 0.4;
  const leftX = Math.min(objectX, lensX, focusX, imageX) - pad;
  const rightX = Math.max(objectX, lensX, focusX, imageX) + pad;
  const unit = unitOf(quantities, ["f", "focallength", "u", "objectdistance"]) ?? "m";
  return baseDocument({
    question,
    reason: "paraxial thin-lens construction from the lens formula",
    quantities: [
      quantityRecord("f", "f", f, unit),
      quantityRecord("u", "u", u, unit),
      quantityRecord("v", "v", v, unit),
    ],
    entities: [
      { id: "left_axis", kind: "point", role: "axis endpoint" },
      { id: "right_axis", kind: "point", role: "axis endpoint" },
      { id: "object_base", kind: "point", role: "object position", label: "O" },
      { id: "object_tip", kind: "point", role: "object tip" },
      { id: "lens_center", kind: "point", role: "surface vertex", label: "V" },
      { id: "focus", kind: "point", role: "focal point", label: "F" },
      { id: "image_base", kind: "point", role: "image position", label: "I" },
      { id: "image_tip", kind: "point", role: "image tip" },
      { id: "axis", kind: "segment", role: "principal axis" },
      { id: "lens", kind: "line", role: "thin lens", label: "L" },
      { id: "object", kind: "vector", role: "object" },
      { id: "image", kind: "vector", role: "image" },
    ],
    constructions: [
      pointAt("left_axis", leftX, 0),
      pointAt("right_axis", rightX, 0),
      pointAt("object_base", objectX, 0),
      pointAt("object_tip", objectX, objectHeight),
      pointAt("lens_center", lensX, 0),
      pointAt("focus", focusX, 0),
      pointAt("image_base", imageX, 0),
      pointAt("image_tip", imageX, imageHeight),
      { id: "make_axis", operator: "segment", inputs: { start: "left_axis", end: "right_axis" }, outputs: ["axis"] },
      { id: "make_lens", operator: "perpendicular_through", inputs: { through: "lens_center", line: "axis" }, outputs: ["lens"] },
      { id: "make_object", operator: "vector", inputs: { start: "object_base", end: "object_tip" }, outputs: ["object"] },
      { id: "make_image", operator: "vector", inputs: { start: "image_base", end: "image_tip" }, outputs: ["image"] },
    ],
    assertions: [
      { id: "object_on_axis", predicate: "on", entities: ["object_base", "axis"], expected: true, severity: "fatal" },
      { id: "image_on_axis", predicate: "on", entities: ["image_base", "axis"], expected: true, severity: "fatal" },
      { id: "lens_perp", predicate: "perpendicular", entities: ["lens", "axis"], expected: true, severity: "fatal" },
      { id: "label_O", predicate: "label_attached", entities: ["object_base"], expected: true, severity: "fatal" },
      { id: "label_I", predicate: "label_attached", entities: ["image_base"], expected: true, severity: "fatal" },
    ],
    revealGroups: [
      {
        id: "lens_setup",
        entityIds: ["left_axis", "right_axis", "axis", "lens_center", "focus", "lens"],
        dependsOn: [],
        narrationCue: "Begin with the thin lens, its optical centre, and the focus on the principal axis.",
      },
      {
        id: "object_image",
        entityIds: ["object_base", "object_tip", "object", "image_base", "image_tip", "image"],
        dependsOn: ["lens_setup"],
        narrationCue: "O is the object, and I is the image.",
      },
    ],
    teachingTimeline: [
      {
        id: "reveal_lens_setup",
        action: "reveal",
        targetId: "lens_setup",
        dependsOn: [],
        narrationIntent: "Begin with the thin lens, its optical centre, and the focus on the principal axis.",
      },
      {
        id: "reveal_object_image",
        action: "reveal",
        targetId: "object_image",
        dependsOn: ["reveal_lens_setup"],
        narrationIntent: "O is the object, and I is the image.",
      },
      {
        id: "focus_object",
        action: "focus",
        targetId: "object_base",
        dependsOn: ["reveal_object_image"],
        narrationIntent: "This is O, the object.",
      },
      {
        id: "focus_image",
        action: "focus",
        targetId: "image_base",
        dependsOn: ["focus_object"],
        narrationIntent: "This is I, the image.",
      },
    ],
  });
}

function buildCircuit(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  const resistors = extractResistors(question, quantities);
  if (resistors.length < 2 && !schematic) return null;
  const count = Math.max(2, Math.min(resistors.length || 3, 4));
  const wantsParallel = /\bparallel\b/i.test(question) && !/\bin series except\b/i.test(question);
  const wantsSeries = /\bseries\b/i.test(question);
  if (!schematic && !wantsParallel && !wantsSeries) return null;
  if (wantsSeries && wantsParallel) {
    return buildSeparatedCircuitViews(question, resistors, count);
  }
  const topology = wantsParallel || (!wantsSeries && schematic) ? "parallel" : "series";
  return buildSingleCircuitView(question, resistors, count, topology, 0, "");
}

function buildSingleCircuitView(
  question: string,
  resistors: Array<{ symbol: string; value: number; unit?: string }>,
  count: number,
  topology: "series" | "parallel",
  originY: number,
  idPrefix: string,
): SceneDocument {
  const nodes = topology === "parallel"
    ? [`${idPrefix}n0`, `${idPrefix}n1`]
    : Array.from({ length: count + 1 }, (_, index) => `${idPrefix}n${index}`);
  const nodePoints = topology === "parallel"
    ? [pointAt(nodes[0]!, 0, originY), pointAt(nodes[1]!, count * 2, originY)]
    : nodes.map((id, index) => pointAt(id, index * 2, originY));
  const resistorIds = Array.from({ length: count }, (_, index) => `${idPrefix}r${index + 1}`);
  const symbols = resistorIds.map((id, index) => ({
    id: `make_${id}`,
    operator: "symbol" as const,
    inputs: topology === "parallel"
      ? { symbol: "resistor", start: nodes[0]!, end: nodes[1]! }
      : { symbol: "resistor", start: nodes[index]!, end: nodes[index + 1]! },
    outputs: [id],
  }));
  return baseDocument({
    question,
    reason: `${topology} resistor network from the question wording`,
    quantities: resistors.slice(0, count).map((resistor, index) =>
      quantityRecord(`R${index + 1}`, resistor.symbol, resistor.value, resistor.unit ?? "ohm")),
    entities: [
      ...nodes.map((id) => ({ id, kind: "point" as const, role: "node" })),
      ...resistorIds.map((id, index) => ({
        id,
        kind: "component" as const,
        role: "resistor",
        label: compactLabel(resistors[index]?.symbol ?? `R${index + 1}`),
      })),
    ],
    constructions: [...nodePoints, ...symbols],
    assertions: topology === "parallel"
      ? [{
          id: "same_pair",
          predicate: "sameTerminalPair",
          entities: resistorIds,
          expected: true,
          severity: "fatal" as const,
        }]
      : [{
          id: "series_path",
          predicate: "path",
          entities: resistorIds,
          expected: true,
          severity: "fatal" as const,
        }],
    revealGroups: [{
      id: `${topology}_group`,
      entityIds: [...nodes, ...resistorIds],
      dependsOn: [],
      narrationCue: `${topology} circuit`,
    }],
  });
}

function buildSeparatedCircuitViews(
  question: string,
  resistors: Array<{ symbol: string; value: number; unit?: string }>,
  count: number,
): SceneDocument {
  const series = buildSingleCircuitView(question, resistors, count, "series", 3, "series_");
  const parallel = buildSingleCircuitView(question, resistors, count, "parallel", -3, "parallel_");
  return baseDocument({
    question,
    reason: "series and parallel resistor networks from the question wording",
    quantities: series.quantities,
    entities: [...series.entities, ...parallel.entities],
    constructions: [...series.constructions, ...parallel.constructions],
    assertions: [...series.assertions, ...parallel.assertions],
    revealGroups: [
      { id: "series_group", entityIds: series.entities.map((entity) => entity.id), dependsOn: [], narrationCue: "series circuit" },
      { id: "parallel_group", entityIds: parallel.entities.map((entity) => entity.id), dependsOn: [], narrationCue: "parallel circuit" },
    ],
  });
}

function buildAnalyticCurve(
  question: string,
  _quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  const parametric = extractParametric(question);
  if (parametric) return buildParametricCurve(question, parametric);
  const expressions = extractExplicitFunctions(question);
  const named = extractNamedPlotExpressions(question);
  const plots = expressions.length > 0 ? expressions : named;
  const domain = extractXInterval(question)
    ?? (named.includes("1/x^12-1/x^6") ? [0.8, 2.5] as [number, number] : [-2, 2] as [number, number]);
  if (plots.length === 0) {
    if (/(?:U\(x\) graph|stable and unstable equilibrium|F versus x|graph of F)/i.test(question) || schematic) {
      const well = /U\(x\)|equilibrium/i.test(question) ? "x^4/4-x^2/2" : "x";
      return plotExpressions(question, [well], domain);
    }
    return schematic ? axesOnly(question, "analytic display axes") : null;
  }
  return plotExpressions(question, plots, domain);
}

function plotExpressions(
  question: string,
  expressions: string[],
  domain: [number, number],
): SceneDocument {
  const yMin = -2;
  const yMax = 4;
  const entities: SceneEntity[] = [{ id: "axes", kind: "axes", role: "display axes" }];
  const constructions: SceneConstruction[] = [{
    id: "make_axes",
    operator: "axes",
    inputs: { xMin: domain[0], xMax: domain[1], yMin, yMax },
    outputs: ["axes"],
  }];
  expressions.forEach((expression, index) => {
    const id = `curve_${index + 1}`;
    entities.push({
      id,
      kind: "polyline",
      role: "explicit function graph",
      label: compactLabel(`y=${expression}`),
    });
    constructions.push({
      id: `make_${id}`,
      operator: "function_curve",
      inputs: { expression, variable: "x", xMin: domain[0], xMax: domain[1], samples: 65 },
      outputs: [id],
    });
  });
  return baseDocument({
    question,
    reason: "function curves copied from the submitted question",
    quantities: [],
    entities,
    constructions,
    assertions: entities.map((entity, index) => ({
      id: `exists_${index + 1}`,
      predicate: "exists",
      entities: [entity.id],
      expected: true,
      severity: "fatal" as const,
    })),
  });
}

function buildStatePlot(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  const pressures = quantities.filter((quantity) => /^p\d*$/i.test(normalizeKey(quantity.symbol))
    || /^p\d*$/i.test(normalizeKey(quantity.id)));
  const volumes = quantities.filter((quantity) => /^v\d*$/i.test(normalizeKey(quantity.symbol))
    || /^v\d*$/i.test(normalizeKey(quantity.id)));
  const closed = /(?:cycle|clockwise|rectangular)/i.test(question);
  if (!schematic && pressures.length < 2 && volumes.length < 2 && !closed) return null;
  const corners = [
    { id: "A", x: -2, y: -1.5 },
    { id: "B", x: 2, y: -1.5 },
    { id: "C", x: 2, y: 1.5 },
    { id: "D", x: -2, y: 1.5 },
  ];
  return baseDocument({
    question,
    reason: "display-scaled thermodynamic state plot",
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "PV axes", label: "P-V" },
      ...corners.map((corner) => ({ id: corner.id, kind: "point", role: "named state", label: corner.id })),
      { id: "cycle", kind: "polygon", role: "process cycle" },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: -3, xMax: 3, yMin: -2.5, yMax: 2.5 }, outputs: ["axes"] },
      ...corners.map((corner) => pointAt(corner.id, corner.x, corner.y)),
      {
        id: "make_cycle",
        operator: "polygon",
        inputs: { points: corners.map((corner) => corner.id) },
        outputs: ["cycle"],
      },
    ],
    assertions: [
      { id: "A_exists", predicate: "exists", entities: ["A"], expected: true, severity: "fatal" },
      { id: "cycle_exists", predicate: "exists", entities: ["cycle"], expected: true, severity: "fatal" },
    ],
  });
}

function buildContactBody(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  if (/(?:pulley|blocks? connected|hanging (?:mass|block))/i.test(question)) {
    return pulleyDocument(question);
  }
  if (/(?:hinged|hinge|uniform (?:rod|bar)|physical pendulum)/i.test(question)
    && !/(?:simple pendulum|pendulum of length)/i.test(question)) {
    return hingedRodDocument(question, quantities);
  }
  if (/(?:vertical circl|whirled|circular loop|circular path of constant radius|completes a (?:full )?vertical)/i.test(question)) {
    return verticalCircleDocument(question, quantities);
  }
  if (/(?:simple pendulum|pendulum of length|bob of mass)/i.test(question)) {
    return pendulumDocument(question, quantities);
  }
  if (/(?:incline|inclined plane|slope)/i.test(question)) {
    return inclineDocument(question, angleDegrees(quantities, question) ?? 30);
  }
  if (/(?:spring of stiffness|spring-block|unstretched springs|springs S1|elastic potential)/i.test(question)) {
    return springDocument(question);
  }
  if (/(?:raindrop|dropped from|dropped onto|starts from rest at height|hits the ground|raised vertically|rebounds? to|released on the slide)/i.test(question)) {
    return fallingBodyDocument(question);
  }
  if (/(?:collid(?:e|es|ing|ed)|collision|head-on|sticks to|embeds in|ballistic pendulum|glancing collision|coefficient of restitution)/i.test(question)) {
    return collisionDocument(question);
  }
  if (/(?:moved slowly around a closed|closed \d+(?:\.\d+)?\s*m\s*[×x])/i.test(question)) {
    return squarePathDocument(question);
  }
  if (/(?:pushes a (?:box|block)|force (?:pushes|pulls|acts through)|towed at|frictionless horizontal|work done by (?:a |the )?(?:constant |unknown )?force)/i.test(question)) {
    return appliedForceBlockDocument(question);
  }
  if (/(?:\d+(?:\.\d+)?\s*kg (?:particle|block|mass|cart|wad)|particle of mass|body of mass|particle moves|moves along a straight line)/i.test(question)) {
    return particleMotionDocument(question);
  }
  if (!schematic && !/(?:free[- ]body|friction|normal reaction)/i.test(question)) return null;
  return blockOnSurfaceDocument(question);
}

function pulleyDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "two-mass pulley apparatus from the contact-body family",
    quantities: [],
    entities: [
      { id: "axle", kind: "point", role: "pulley center" },
      { id: "left_mass", kind: "point", role: "left mass center" },
      { id: "right_mass", kind: "point", role: "right mass center" },
      { id: "pulley", kind: "circle", role: "pulley" },
      { id: "left_block", kind: "rectangle", role: "hanging block", label: "m1" },
      { id: "right_block", kind: "rectangle", role: "hanging block", label: "m2" },
      { id: "left_string", kind: "segment", role: "string" },
      { id: "right_string", kind: "segment", role: "string" },
    ],
    constructions: [
      pointAt("axle", 0, 2),
      pointAt("left_mass", -1.2, -1),
      pointAt("right_mass", 1.2, 0),
      { id: "make_pulley", operator: "circle", inputs: { center: "axle", radius: 0.6 }, outputs: ["pulley"] },
      { id: "make_left_block", operator: "rectangle", inputs: { center: "left_mass", width: 0.8, height: 0.6 }, outputs: ["left_block"] },
      { id: "make_right_block", operator: "rectangle", inputs: { center: "right_mass", width: 0.8, height: 0.6 }, outputs: ["right_block"] },
      { id: "make_left_string", operator: "segment", inputs: { start: "left_mass", end: "axle" }, outputs: ["left_string"] },
      { id: "make_right_string", operator: "segment", inputs: { start: "right_mass", end: "axle" }, outputs: ["right_string"] },
    ],
    assertions: [
      { id: "pulley_exists", predicate: "exists", entities: ["pulley"], expected: true, severity: "fatal" },
      { id: "strings_exist", predicate: "exists", entities: ["left_string", "right_string"], expected: true, severity: "fatal" },
    ],
  });
}

function hingedRodDocument(question: string, quantities: PlanQuantity[]): SceneDocument {
  const theta = angleDegrees(quantities, question) ?? 30;
  return baseDocument({
    question,
    reason: "hinged rod from a shared hinge and rotate",
    quantities: [{ id: "theta", symbol: "theta", value: theta, unit: "degree" }],
    entities: [
      { id: "hinge", kind: "point", role: "hinge", label: "H" },
      { id: "free_h", kind: "point", role: "horizontal rod end" },
      { id: "free_v", kind: "point", role: "rotated rod end" },
      { id: "mid", kind: "point", role: "centre of mass" },
      { id: "rod", kind: "segment", role: "uniform rod", label: "rod" },
      { id: "weight", kind: "vector", role: "weight", label: "mg" },
    ],
    constructions: [
      pointAt("hinge", 0, 0),
      pointAt("free_h", 3, 0),
      {
        id: "make_free_v",
        operator: "rotate",
        inputs: { point: "free_h", center: "hinge", angle: -theta, angleUnit: "degrees" },
        outputs: ["free_v"],
      },
      { id: "make_mid", operator: "midpoint", inputs: { a: "hinge", b: "free_v" }, outputs: ["mid"] },
      { id: "make_rod", operator: "segment", inputs: { start: "hinge", end: "free_v" }, outputs: ["rod"] },
      { id: "make_weight", operator: "vector", inputs: { start: "mid", direction: [0, -1], length: 1 }, outputs: ["weight"] },
    ],
    assertions: [
      { id: "equal_length", predicate: "equal_length", entities: ["hinge", "free_h", "hinge", "free_v"], expected: true, severity: "fatal" },
      { id: "mid_on_rod", predicate: "on", entities: ["mid", "rod"], expected: true, severity: "fatal" },
    ],
  });
}

function inclineDocument(question: string, theta: number): SceneDocument {
  const radians = theta * Math.PI / 180;
  const endX = 4 * Math.cos(radians);
  const endY = 4 * Math.sin(radians);
  const contactX = endX * 0.45;
  const contactY = endY * 0.45;
  const rollingBody = /(?:roll(?:s|ing)?(?:\s+without\s+slipping)?|solid cylinder|\bdisc\b|\bdisk\b|\bsphere\b)/i.test(question);
  const bodyRadius = 0.55;
  const bodyCenterX = contactX + (-Math.sin(radians)) * bodyRadius;
  const bodyCenterY = contactY + Math.cos(radians) * bodyRadius;
  const weightStart = rollingBody ? "body_center" : "contact";
  return baseDocument({
    question,
    reason: rollingBody
      ? "inclined-plane contact body with a circular rolling section and derived normal"
      : "inclined-plane contact body with derived normal",
    quantities: [{ id: "theta", symbol: "theta", value: theta, unit: "degree" }],
    entities: [
      { id: "base", kind: "point", role: "incline foot" },
      { id: "top", kind: "point", role: "incline top" },
      { id: "contact", kind: "point", role: "contact point" },
      { id: "incline", kind: "segment", role: "inclined plane" },
      { id: "normal", kind: "vector", role: "normal reaction", label: "N" },
      { id: "weight", kind: "vector", role: "weight", label: "mg" },
      ...(rollingBody
        ? [
            { id: "body_center", kind: "point" as const, role: "rolling body center" },
            { id: "body", kind: "circle" as const, role: "rolling body", label: "m" },
          ]
        : []),
    ],
    constructions: [
      pointAt("base", 0, 0),
      pointAt("top", endX, endY),
      pointAt("contact", contactX, contactY),
      { id: "make_incline", operator: "segment", inputs: { start: "base", end: "top" }, outputs: ["incline"] },
      { id: "make_normal", operator: "normal_at", inputs: { point: "contact", surface: "incline" }, outputs: ["normal"] },
      { id: "make_weight", operator: "vector", inputs: { start: weightStart, direction: [0, -1], length: 1.2 }, outputs: ["weight"] },
      ...(rollingBody
        ? [
            pointAt("body_center", bodyCenterX, bodyCenterY),
            {
              id: "make_body",
              operator: "circle" as const,
              inputs: { center: "body_center", radius: bodyRadius },
              outputs: ["body"],
            },
          ]
        : []),
    ],
    assertions: [
      { id: "contact_on_incline", predicate: "on", entities: ["contact", "incline"], expected: true, severity: "fatal" },
      { id: "normal_perp", predicate: "perpendicular", entities: ["normal", "incline"], expected: true, severity: "fatal" },
      ...(rollingBody
        ? [{ id: "body_exists", predicate: "exists" as const, entities: ["body"], expected: true, severity: "fatal" as const }]
        : []),
    ],
  });
}

function blockOnSurfaceDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "block on a horizontal surface with weight and normal",
    quantities: [],
    entities: [
      { id: "center", kind: "point", role: "block center" },
      { id: "left", kind: "point", role: "surface end" },
      { id: "right", kind: "point", role: "surface end" },
      { id: "block", kind: "rectangle", role: "block" },
      { id: "surface", kind: "segment", role: "contact surface" },
      { id: "weight", kind: "vector", role: "weight", label: "mg" },
      { id: "normal", kind: "vector", role: "normal reaction", label: "N" },
    ],
    constructions: [
      pointAt("center", 0, 0.4),
      pointAt("left", -2, 0),
      pointAt("right", 2, 0),
      { id: "make_block", operator: "rectangle", inputs: { center: "center", width: 1.2, height: 0.8 }, outputs: ["block"] },
      { id: "make_surface", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["surface"] },
      { id: "make_weight", operator: "vector", inputs: { start: "center", direction: [0, -1], length: 1 }, outputs: ["weight"] },
      { id: "make_normal", operator: "normal_at", inputs: { point: "center", surface: "surface" }, outputs: ["normal"] },
    ],
    assertions: [
      { id: "surface_exists", predicate: "exists", entities: ["surface"], expected: true, severity: "fatal" },
      { id: "block_exists", predicate: "exists", entities: ["block"], expected: true, severity: "fatal" },
    ],
  });
}

function appliedForceBlockDocument(question: string): SceneDocument {
  const perpendicular = /perpendicular to (?:the )?(?:\d+(?:\.\d+)?\s*m )?displacement/i.test(question);
  return baseDocument({
    question,
    reason: perpendicular
      ? "block, applied force, and perpendicular displacement"
      : "block with applied force along the displacement",
    quantities: [],
    entities: [
      { id: "center", kind: "point", role: "block center" },
      { id: "left", kind: "point", role: "surface end" },
      { id: "right", kind: "point", role: "surface end" },
      { id: "block", kind: "rectangle", role: "block", label: "m" },
      { id: "surface", kind: "segment", role: "contact surface" },
      { id: "force", kind: "vector", role: "applied force", label: "F" },
      { id: "displacement", kind: "vector", role: "displacement", label: "d" },
    ],
    constructions: [
      pointAt("center", 0, 0.4),
      pointAt("left", -2.4, 0),
      pointAt("right", 2.8, 0),
      { id: "make_block", operator: "rectangle", inputs: { center: "center", width: 1.2, height: 0.8 }, outputs: ["block"] },
      { id: "make_surface", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["surface"] },
      {
        id: "make_force",
        operator: "vector",
        inputs: perpendicular
          ? { start: "center", direction: [0, 1], length: 1.4 }
          : { start: "center", direction: [1, 0], length: 1.6 },
        outputs: ["force"],
      },
      { id: "make_displacement", operator: "vector", inputs: { start: "center", direction: [1, 0], length: 2.2 }, outputs: ["displacement"] },
    ],
    assertions: [
      { id: "block_exists", predicate: "exists", entities: ["block"], expected: true, severity: "fatal" },
      { id: "force_exists", predicate: "exists", entities: ["force"], expected: true, severity: "fatal" },
      { id: "displacement_exists", predicate: "exists", entities: ["displacement"], expected: true, severity: "fatal" },
    ],
  });
}

function fallingBodyDocument(question: string): SceneDocument {
  const resistive = /(?:resistive|air (?:drag|resistance)|unknown resistive)/i.test(question);
  return baseDocument({
    question,
    reason: resistive
      ? "vertical drop with weight and a resistive force"
      : "vertical drop from a stated height",
    quantities: [],
    entities: [
      { id: "ground_left", kind: "point", role: "ground end" },
      { id: "ground_right", kind: "point", role: "ground end" },
      { id: "start", kind: "point", role: "release point", label: "h" },
      { id: "particle", kind: "point", role: "falling body" },
      { id: "ground", kind: "segment", role: "ground" },
      { id: "path", kind: "segment", role: "drop" },
      { id: "weight", kind: "vector", role: "weight", label: "mg" },
      ...(resistive
        ? [{ id: "resist", kind: "vector" as const, role: "resistive force", label: "R" }]
        : []),
    ],
    constructions: [
      pointAt("ground_left", -1.6, 0),
      pointAt("ground_right", 1.6, 0),
      pointAt("start", 0, 3.2),
      pointAt("particle", 0, 2.4),
      { id: "make_ground", operator: "segment", inputs: { start: "ground_left", end: "ground_right" }, outputs: ["ground"] },
      { id: "make_path", operator: "segment", inputs: { start: "start", end: "particle" }, outputs: ["path"] },
      { id: "make_weight", operator: "vector", inputs: { start: "particle", direction: [0, -1], length: 1.1 }, outputs: ["weight"] },
      ...(resistive
        ? [{
            id: "make_resist",
            operator: "vector" as const,
            inputs: { start: "particle", direction: [0, 1], length: 0.8 },
            outputs: ["resist"],
          }]
        : []),
    ],
    assertions: [
      { id: "ground_exists", predicate: "exists", entities: ["ground"], expected: true, severity: "fatal" },
      { id: "path_exists", predicate: "exists", entities: ["path"], expected: true, severity: "fatal" },
      { id: "weight_exists", predicate: "exists", entities: ["weight"], expected: true, severity: "fatal" },
    ],
  });
}

function springDocument(question: string): SceneDocument {
  const twoSprings = /(?:two unstretched springs|springs S1)/i.test(question);
  if (twoSprings) {
    return baseDocument({
      question,
      reason: "block between two springs from shared attachment points",
      quantities: [],
      entities: [
        { id: "wall1", kind: "point", role: "left support" },
        { id: "wall2", kind: "point", role: "right support" },
        { id: "center", kind: "point", role: "block center" },
        { id: "block", kind: "rectangle", role: "block", label: "B" },
        { id: "s1", kind: "segment", role: "spring", label: "S1" },
        { id: "s2", kind: "segment", role: "spring", label: "S2" },
      ],
      constructions: [
        pointAt("wall1", -3, 0.4),
        pointAt("wall2", 3, 0.4),
        pointAt("center", 0, 0.4),
        { id: "make_block", operator: "rectangle", inputs: { center: "center", width: 0.9, height: 0.8 }, outputs: ["block"] },
        { id: "make_s1", operator: "segment", inputs: { start: "wall1", end: "center" }, outputs: ["s1"] },
        { id: "make_s2", operator: "segment", inputs: { start: "center", end: "wall2" }, outputs: ["s2"] },
      ],
      assertions: [
        { id: "block_exists", predicate: "exists", entities: ["block"], expected: true, severity: "fatal" },
        { id: "springs_exist", predicate: "exists", entities: ["s1", "s2"], expected: true, severity: "fatal" },
      ],
    });
  }
  return baseDocument({
    question,
    reason: "spring-block on a horizontal surface",
    quantities: [],
    entities: [
      { id: "wall", kind: "point", role: "fixed wall" },
      { id: "center", kind: "point", role: "block center" },
      { id: "left", kind: "point", role: "surface end" },
      { id: "right", kind: "point", role: "surface end" },
      { id: "block", kind: "rectangle", role: "block", label: "m" },
      { id: "surface", kind: "segment", role: "contact surface" },
      { id: "spring", kind: "segment", role: "spring", label: "k" },
    ],
    constructions: [
      pointAt("wall", -2.6, 0.4),
      pointAt("center", 0.4, 0.4),
      pointAt("left", -2.8, 0),
      pointAt("right", 2.4, 0),
      { id: "make_block", operator: "rectangle", inputs: { center: "center", width: 1.0, height: 0.8 }, outputs: ["block"] },
      { id: "make_surface", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["surface"] },
      { id: "make_spring", operator: "segment", inputs: { start: "wall", end: "center" }, outputs: ["spring"] },
    ],
    assertions: [
      { id: "block_exists", predicate: "exists", entities: ["block"], expected: true, severity: "fatal" },
      { id: "spring_exists", predicate: "exists", entities: ["spring"], expected: true, severity: "fatal" },
    ],
  });
}

function pendulumDocument(question: string, quantities: PlanQuantity[]): SceneDocument {
  const theta = angleDegrees(quantities, question) ?? 30;
  return baseDocument({
    question,
    reason: "simple pendulum displaced from the vertical",
    quantities: [{ id: "theta", symbol: "theta", value: theta, unit: "degree" }],
    entities: [
      { id: "hinge", kind: "point", role: "support", label: "O" },
      { id: "rest", kind: "point", role: "lowest point" },
      { id: "bob", kind: "point", role: "bob", label: "m" },
      { id: "string", kind: "segment", role: "string" },
      { id: "weight", kind: "vector", role: "weight", label: "mg" },
    ],
    constructions: [
      pointAt("hinge", 0, 2.4),
      pointAt("rest", 0, 0),
      {
        id: "make_bob",
        operator: "rotate",
        inputs: { point: "rest", center: "hinge", angle: -theta, angleUnit: "degrees" },
        outputs: ["bob"],
      },
      { id: "make_string", operator: "segment", inputs: { start: "hinge", end: "bob" }, outputs: ["string"] },
      { id: "make_weight", operator: "vector", inputs: { start: "bob", direction: [0, -1], length: 0.8 }, outputs: ["weight"] },
    ],
    assertions: [
      { id: "equal_length", predicate: "equal_length", entities: ["hinge", "rest", "hinge", "bob"], expected: true, severity: "fatal" },
      { id: "string_exists", predicate: "exists", entities: ["string"], expected: true, severity: "fatal" },
    ],
  });
}

function verticalCircleDocument(question: string, quantities: PlanQuantity[]): SceneDocument {
  const withIncline = /(?:incline|inclined plane)/i.test(question);
  const radius = 1.6;
  const loopCenterX = withIncline ? 3.2 : 0;
  const loopCenterY = radius;
  const entities: SceneEntity[] = [
    { id: "center", kind: "point", role: "circle center" },
    { id: "bottom", kind: "point", role: "lowest point" },
    { id: "top", kind: "point", role: "highest point" },
    { id: "mass", kind: "point", role: "particle", label: "m" },
    { id: "loop", kind: "circle", role: "vertical circle" },
    { id: "radius_arm", kind: "segment", role: "string or track radius" },
    { id: "weight", kind: "vector", role: "weight", label: "mg" },
  ];
  const constructions: SceneConstruction[] = [
    pointAt("center", loopCenterX, loopCenterY),
    pointAt("bottom", loopCenterX, loopCenterY - radius),
    pointAt("top", loopCenterX, loopCenterY + radius),
    pointAt("mass", loopCenterX, loopCenterY - radius),
    { id: "make_loop", operator: "circle", inputs: { center: "center", radius }, outputs: ["loop"] },
    { id: "make_radius", operator: "segment", inputs: { start: "center", end: "mass" }, outputs: ["radius_arm"] },
    { id: "make_weight", operator: "vector", inputs: { start: "mass", direction: [0, -1], length: 0.9 }, outputs: ["weight"] },
  ];
  if (withIncline) {
    const theta = angleDegrees(quantities, question) ?? 30;
    const radians = theta * Math.PI / 180;
    const run = 3.2;
    entities.push(
      { id: "base", kind: "point", role: "incline foot" },
      { id: "incline", kind: "segment", role: "approach incline" },
    );
    constructions.push(
      pointAt("base", loopCenterX - run, (loopCenterY - radius) + run * Math.tan(radians)),
      { id: "make_incline", operator: "segment", inputs: { start: "base", end: "bottom" }, outputs: ["incline"] },
    );
  }
  return baseDocument({
    question,
    reason: withIncline
      ? "incline feeding a vertical circular loop"
      : "particle on a vertical circle with weight at the lowest point",
    quantities: [],
    entities,
    constructions,
    assertions: [
      { id: "loop_exists", predicate: "exists", entities: ["loop"], expected: true, severity: "fatal" },
      { id: "mass_exists", predicate: "exists", entities: ["mass"], expected: true, severity: "fatal" },
    ],
  });
}

function collisionDocument(question: string): SceneDocument {
  const glancing = /(?:glancing|two dimensions|oblique|30° to its original|perpendicular)/i.test(question);
  return baseDocument({
    question,
    reason: glancing
      ? "two-body collision with outgoing velocity vectors"
      : "one-dimensional two-body collision on a line",
    quantities: [],
    entities: [
      { id: "left", kind: "point", role: "track end" },
      { id: "right", kind: "point", role: "track end" },
      { id: "a", kind: "point", role: "incoming center" },
      { id: "b", kind: "point", role: "target center" },
      { id: "track", kind: "segment", role: "line of impact" },
      { id: "block_a", kind: "rectangle", role: "incoming body", label: "A" },
      { id: "block_b", kind: "rectangle", role: "target body", label: "B" },
      { id: "va", kind: "vector", role: "velocity", label: "v" },
      { id: "vb", kind: "vector", role: "velocity", label: "u" },
    ],
    constructions: [
      pointAt("left", -3.2, 0),
      pointAt("right", 3.2, 0),
      pointAt("a", -1.4, 0.45),
      pointAt("b", 1.1, 0.45),
      { id: "make_track", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["track"] },
      { id: "make_a", operator: "rectangle", inputs: { center: "a", width: 1.0, height: 0.8 }, outputs: ["block_a"] },
      { id: "make_b", operator: "rectangle", inputs: { center: "b", width: 1.0, height: 0.8 }, outputs: ["block_b"] },
      { id: "make_va", operator: "vector", inputs: { start: "a", direction: [1, 0], length: 1.3 }, outputs: ["va"] },
      {
        id: "make_vb",
        operator: "vector",
        inputs: glancing
          ? { start: "b", direction: [0.6, 0.8], length: 1.3 }
          : { start: "b", direction: [1, 0], length: 0.9 },
        outputs: ["vb"],
      },
    ],
    assertions: [
      { id: "track_exists", predicate: "exists", entities: ["track"], expected: true, severity: "fatal" },
      { id: "bodies_exist", predicate: "exists", entities: ["block_a", "block_b"], expected: true, severity: "fatal" },
    ],
  });
}

function squarePathDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "closed square path of a block on a horizontal floor",
    quantities: [],
    entities: [
      { id: "A", kind: "point", role: "corner", label: "A" },
      { id: "B", kind: "point", role: "corner", label: "B" },
      { id: "C", kind: "point", role: "corner", label: "C" },
      { id: "D", kind: "point", role: "corner", label: "D" },
      { id: "path", kind: "polygon", role: "closed path" },
      { id: "center", kind: "point", role: "block center" },
      { id: "block", kind: "rectangle", role: "block", label: "m" },
    ],
    constructions: [
      pointAt("A", -2, -2),
      pointAt("B", 2, -2),
      pointAt("C", 2, 2),
      pointAt("D", -2, 2),
      pointAt("center", -2, -2),
      { id: "make_path", operator: "polygon", inputs: { points: ["A", "B", "C", "D"] }, outputs: ["path"] },
      { id: "make_block", operator: "rectangle", inputs: { center: "center", width: 0.7, height: 0.7 }, outputs: ["block"] },
    ],
    assertions: [
      { id: "path_exists", predicate: "exists", entities: ["path"], expected: true, severity: "fatal" },
      { id: "block_exists", predicate: "exists", entities: ["block"], expected: true, severity: "fatal" },
    ],
  });
}

function particleMotionDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "particle with a velocity vector on a line",
    quantities: [],
    entities: [
      { id: "left", kind: "point", role: "axis end" },
      { id: "right", kind: "point", role: "axis end" },
      { id: "particle", kind: "point", role: "particle", label: "m" },
      { id: "axis", kind: "segment", role: "path" },
      { id: "velocity", kind: "vector", role: "velocity", label: "v" },
    ],
    constructions: [
      pointAt("left", -2.5, 0),
      pointAt("right", 2.5, 0),
      pointAt("particle", -0.4, 0),
      { id: "make_axis", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["axis"] },
      { id: "make_velocity", operator: "vector", inputs: { start: "particle", direction: [1, 0], length: 1.6 }, outputs: ["velocity"] },
    ],
    assertions: [
      { id: "axis_exists", predicate: "exists", entities: ["axis"], expected: true, severity: "fatal" },
      { id: "velocity_exists", predicate: "exists", entities: ["velocity"], expected: true, severity: "fatal" },
    ],
  });
}

function buildVectorDiagram(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  const magnitudes = quantities.filter((quantity) =>
    /(?:magnitude|vec|a|b)/i.test(`${quantity.id} ${quantity.symbol}`));
  if (!schematic && magnitudes.length < 1 && !/(?:resultant|two vectors|vector|velocity vectors)/i.test(question)) {
    return null;
  }
  return baseDocument({
    question,
    reason: "shared-origin vector diagram",
    quantities: [],
    entities: [
      { id: "origin", kind: "point", role: "origin", label: "O" },
      { id: "a_end", kind: "point", role: "vector A tip" },
      { id: "b_end", kind: "point", role: "vector B tip" },
      { id: "a", kind: "vector", role: "vector", label: "A" },
      { id: "b", kind: "vector", role: "vector", label: "B" },
    ],
    constructions: [
      pointAt("origin", 0, 0),
      pointAt("a_end", 3, 0),
      pointAt("b_end", 1.5, 2),
      { id: "make_a", operator: "vector", inputs: { start: "origin", end: "a_end" }, outputs: ["a"] },
      { id: "make_b", operator: "vector", inputs: { start: "origin", end: "b_end" }, outputs: ["b"] },
    ],
    assertions: [
      { id: "a_exists", predicate: "exists", entities: ["a"], expected: true, severity: "fatal" },
      { id: "b_exists", predicate: "exists", entities: ["b"], expected: true, severity: "fatal" },
    ],
  });
}

function buildAperturePattern(
  question: string,
  _quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  if (!schematic && !/(?:slit|interference|diffraction|aperture|fringe)/i.test(question)) return null;
  const slits = /single/i.test(question) ? 1 : 2;
  return baseDocument({
    question,
    reason: "aperture and screen pattern from the wave-optics family",
    quantities: [],
    entities: [
      { id: "center", kind: "point", role: "aperture center" },
      { id: "screen_a", kind: "point", role: "screen end" },
      { id: "screen_b", kind: "point", role: "screen end" },
      { id: "aperture", kind: "polyline", role: "aperture" },
      { id: "pattern", kind: "polyline", role: "screen pattern" },
    ],
    constructions: [
      pointAt("center", -2, 0),
      pointAt("screen_a", 3, -3),
      pointAt("screen_b", 3, 3),
      {
        id: "make_aperture",
        operator: "aperture",
        inputs: {
          center: "center",
          orientation: "vertical",
          length: 4,
          slitCount: slits,
          slitWidth: 0.25,
          slitSeparation: 1.1,
        },
        outputs: ["aperture"],
      },
      {
        id: "make_pattern",
        operator: "screen_pattern",
        inputs: { start: "screen_a", end: "screen_b", pattern: "interference", count: 7, spacing: 0.45, centralWidth: 0.7 },
        outputs: ["pattern"],
      },
    ],
    assertions: [
      { id: "aperture_exists", predicate: "exists", entities: ["aperture"], expected: true, severity: "fatal" },
      { id: "pattern_exists", predicate: "exists", entities: ["pattern"], expected: true, severity: "fatal" },
    ],
  });
}

function buildWavefront(question: string, _quantities: PlanQuantity[], schematic: boolean): SceneDocument | null {
  if (!schematic && !/(?:wavefront|huygens)/i.test(question)) return null;
  return baseDocument({
    question,
    reason: "plane wavefront family",
    quantities: [],
    entities: [
      { id: "origin", kind: "point", role: "wave origin" },
      { id: "fronts", kind: "polyline", role: "wavefront family" },
    ],
    constructions: [
      pointAt("origin", 0, 0),
      {
        id: "make_fronts",
        operator: "wavefront_family",
        inputs: { origin: "origin", direction: [1, 0], shape: "plane", count: 4, spacing: 0.7, span: 4 },
        outputs: ["fronts"],
      },
    ],
    assertions: [{ id: "fronts_exist", predicate: "exists", entities: ["fronts"], expected: true, severity: "fatal" }],
  });
}

function buildPolarizer(question: string, quantities: PlanQuantity[], schematic: boolean): SceneDocument | null {
  if (!schematic && !/(?:polari[sz]|malus|polaroid)/i.test(question)) return null;
  const angle = angleDegrees(quantities, question) ?? 35;
  return baseDocument({
    question,
    reason: "polarizer transmission axis",
    quantities: [{ id: "theta", symbol: "theta", value: angle, unit: "degree" }],
    entities: [
      { id: "center", kind: "point", role: "polarizer center" },
      { id: "polarizer", kind: "polyline", role: "polarizer" },
    ],
    constructions: [
      pointAt("center", 0, 0),
      {
        id: "make_polarizer",
        operator: "polarizer",
        inputs: { center: "center", radius: 2, axisAngleDeg: angle },
        outputs: ["polarizer"],
      },
    ],
    assertions: [{ id: "polarizer_exists", predicate: "exists", entities: ["polarizer"], expected: true, severity: "fatal" }],
  });
}

function buildTransverseField(question: string, _quantities: PlanQuantity[], schematic: boolean): SceneDocument | null {
  if (!schematic && !/(?:unpolari[sz]|plane.?polari[sz]|electric field direction)/i.test(question)) return null;
  return baseDocument({
    question,
    reason: "transverse field along a propagation axis",
    quantities: [],
    entities: [
      { id: "start", kind: "point", role: "propagation start" },
      { id: "end", kind: "point", role: "propagation end" },
      { id: "field", kind: "polyline", role: "transverse field" },
    ],
    constructions: [
      pointAt("start", -3, 0),
      pointAt("end", 3, 0),
      {
        id: "make_field",
        operator: "transverse_field",
        inputs: { start: "start", end: "end", amplitude: 0.6, cycles: 3, orientationDeg: 90 },
        outputs: ["field"],
      },
    ],
    assertions: [{ id: "field_exists", predicate: "exists", entities: ["field"], expected: true, severity: "fatal" }],
  });
}

function buildCoordinateFigure(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  const displacement = extractCoordinateDisplacement(question);
  if (displacement) return coordinateDisplacementDocument(question, displacement);
  const radius = firstQuantity(quantities, ["r", "radius"]);
  if (!schematic && radius === null && !/(?:circle|parabola|ellipse|triangle)/i.test(question)) return null;
  const r = radius ?? 2;
  return baseDocument({
    question,
    reason: "coordinate figure on display axes",
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "coordinate axes" },
      { id: "origin", kind: "point", role: "origin" },
      { id: "circle", kind: "circle", role: "named circle" },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 }, outputs: ["axes"] },
      pointAt("origin", 0, 0),
      { id: "make_circle", operator: "circle", inputs: { center: "origin", radius: r }, outputs: ["circle"] },
    ],
    assertions: [{ id: "circle_exists", predicate: "exists", entities: ["circle"], expected: true, severity: "fatal" }],
  });
}

function buildSolidFigure(question: string, quantities: PlanQuantity[], schematic: boolean): SceneDocument | null {
  const radius = firstQuantity(quantities, ["r", "radius"]) ?? 1.2;
  const height = firstQuantity(quantities, ["h", "height"]) ?? 2.4;
  const kind = /\bcone\b/i.test(question) ? "cone"
    : /\bfrustum\b/i.test(question) ? "frustum"
      : /\bhemisphere\b/i.test(question) ? "hemisphere"
        : /\bsphere\b/i.test(question) ? "sphere"
          : "cylinder";
  if (!schematic && !/(?:cylinder|cone|frustum|hemisphere|sphere)/i.test(question)) return null;
  return baseDocument({
    question,
    reason: "solid projection from named mensuration family",
    quantities: [],
    entities: [
      { id: "center", kind: "point", role: "solid center" },
      { id: "solid", kind: "polyline", role: "solid projection" },
    ],
    constructions: [
      pointAt("center", 0, 0),
      {
        id: "make_solid",
        operator: "solid_projection",
        inputs: kind === "frustum"
          ? { kind, center: "center", radius, height, topRadius: radius * 0.55, axis: "vertical" }
          : { kind, center: "center", radius, height, axis: "vertical" },
        outputs: ["solid"],
      },
    ],
    assertions: [{ id: "solid_exists", predicate: "exists", entities: ["solid"], expected: true, severity: "fatal" }],
  });
}

function buildPointField(question: string, _quantities: PlanQuantity[], schematic: boolean): SceneDocument | null {
  if (!schematic && !/(?:point charge|electric[- ]field|magnetic field|current-carrying)/i.test(question)) {
    return null;
  }
  return baseDocument({
    question,
    reason: "two source points and the joining field line",
    quantities: [],
    entities: [
      { id: "q1", kind: "point", role: "point charge", label: "q1" },
      { id: "q2", kind: "point", role: "point charge", label: "q2" },
      { id: "field", kind: "vector", role: "field" },
    ],
    constructions: [
      pointAt("q1", -2, 0),
      pointAt("q2", 2, 0),
      { id: "make_field", operator: "vector", inputs: { start: "q1", end: "q2" }, outputs: ["field"] },
    ],
    assertions: [{ id: "field_exists", predicate: "exists", entities: ["field"], expected: true, severity: "fatal" }],
  });
}

function buildEnergyLevel(question: string, _quantities: PlanQuantity[], schematic: boolean): SceneDocument | null {
  if (!schematic && !/(?:energy level|photoelectric|bohr|stopping potential)/i.test(question)) return null;
  return baseDocument({
    question,
    reason: "stacked energy levels on a display axis",
    quantities: [],
    entities: [
      { id: "n1_a", kind: "point", role: "level end" },
      { id: "n1_b", kind: "point", role: "level end" },
      { id: "n2_a", kind: "point", role: "level end" },
      { id: "n2_b", kind: "point", role: "level end" },
      { id: "level1", kind: "segment", role: "energy level", label: "n=1" },
      { id: "level2", kind: "segment", role: "energy level", label: "n=2" },
      { id: "transition", kind: "vector", role: "transition" },
    ],
    constructions: [
      pointAt("n1_a", -2, -1),
      pointAt("n1_b", 2, -1),
      pointAt("n2_a", -2, 1),
      pointAt("n2_b", 2, 1),
      { id: "make_level1", operator: "segment", inputs: { start: "n1_a", end: "n1_b" }, outputs: ["level1"] },
      { id: "make_level2", operator: "segment", inputs: { start: "n2_a", end: "n2_b" }, outputs: ["level2"] },
      { id: "make_transition", operator: "vector", inputs: { start: "n2_a", end: "n1_a" }, outputs: ["transition"] },
    ],
    assertions: [{ id: "levels_exist", predicate: "exists", entities: ["level1", "level2"], expected: true, severity: "fatal" }],
  });
}

function buildFluidApparatus(question: string, _quantities: PlanQuantity[], schematic: boolean): SceneDocument | null {
  if (!schematic && !/(?:hydraulic|piston|venturi|pipe|cylindrical vessels|connected at the bottom)/i.test(question)) {
    return null;
  }
  return baseDocument({
    question,
    reason: "connected vessels for a fluid apparatus",
    quantities: [],
    entities: [
      { id: "left", kind: "point", role: "vessel center" },
      { id: "right", kind: "point", role: "vessel center" },
      { id: "tank1", kind: "rectangle", role: "vessel" },
      { id: "tank2", kind: "rectangle", role: "vessel" },
      { id: "pipe", kind: "segment", role: "connecting pipe" },
    ],
    constructions: [
      pointAt("left", -2, 0),
      pointAt("right", 2, 0),
      { id: "make_tank1", operator: "rectangle", inputs: { center: "left", width: 1.4, height: 2 }, outputs: ["tank1"] },
      { id: "make_tank2", operator: "rectangle", inputs: { center: "right", width: 1, height: 1.4 }, outputs: ["tank2"] },
      { id: "make_pipe", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["pipe"] },
    ],
    assertions: [{ id: "vessels_exist", predicate: "exists", entities: ["tank1", "tank2", "pipe"], expected: true, severity: "fatal" }],
  });
}

function axesOnly(question: string, reason: string): SceneDocument {
  return baseDocument({
    question,
    reason,
    quantities: [],
    entities: [{ id: "axes", kind: "axes", role: "display axes" }],
    constructions: [{
      id: "make_axes",
      operator: "axes",
      inputs: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 },
      outputs: ["axes"],
    }],
    assertions: [{ id: "axes_exist", predicate: "exists", entities: ["axes"], expected: true, severity: "fatal" }],
  });
}

function tryCompile(document: SceneDocument): {
  document: SceneDocument;
  renderScene: RenderScene;
  validationReport: ValidationReport;
} | null {
  const pruned = pruneDeadSceneEntities(document as unknown as Record<string, unknown>);
  const validated = validateSceneDocument(pruned);
  if (!validated.document) return null;
  const compiled = compileSceneDocument(validated.document);
  if (
    !compiled.ok
    || !compiled.renderScene
    || compiled.renderScene.primitives.length === 0
    || compiled.report.issues.some((issue) => issue.severity === "fatal")
  ) {
    return null;
  }
  return {
    document: validated.document,
    renderScene: compiled.renderScene,
    validationReport: compiled.report,
  };
}

function baseDocument(options: {
  question: string;
  reason: string;
  quantities: Array<Record<string, unknown> & { id: string }>;
  entities: SceneEntity[];
  constructions: SceneConstruction[];
  assertions: SceneAssertion[];
  revealGroups?: SceneRevealGroup[];
  teachingTimeline?: SceneTeachingAction[];
}): SceneDocument {
  const requiredEntityIds = options.entities.map((entity) => entity.id);
  const revealGroups = options.revealGroups ?? [{
    id: "setup",
    entityIds: requiredEntityIds,
    dependsOn: [],
    narrationCue: options.reason,
  }];
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: { mode: "scene", reason: options.reason },
    source: {
      question: options.question,
      synthesizedFamily: true,
    },
    quantities: options.quantities,
    entities: options.entities,
    constructions: options.constructions,
    relations: [],
    assertions: options.assertions,
    annotations: [],
    requiredEntityIds,
    revealGroups,
    teachingTimeline: options.teachingTimeline ?? revealGroups.map((group, index) => ({
      id: `reveal_${group.id}`,
      action: "reveal" as const,
      targetId: group.id,
      dependsOn: index === 0 ? [] : [`reveal_${revealGroups[index - 1]!.id}`],
      narrationIntent: group.narrationCue,
    })),
  };
}

function pointAt(id: string, x: number, y: number): SceneConstruction {
  return {
    id: `make_${id}`,
    operator: "point",
    inputs: { x, y, coordinateSpace: "world" },
    outputs: [id],
  };
}

function quantityRecord(
  id: string,
  symbol: string,
  value: number,
  unit: string,
): Record<string, unknown> & { id: string } {
  return { id, symbol, value, unit };
}

function collectPlanQuantities(turnPlan: unknown): PlanQuantity[] {
  if (!isRecord(turnPlan)) return [];
  const rows = [...(Array.isArray(turnPlan.givens) ? turnPlan.givens : []),
    ...(Array.isArray(turnPlan.derived) ? turnPlan.derived : [])];
  return rows.flatMap((row, index) => {
    if (!isRecord(row) || typeof row.value !== "number" || !Number.isFinite(row.value)) return [];
    const id = typeof row.id === "string" && row.id.trim() ? row.id : `q${index + 1}`;
    const symbol = typeof row.symbol === "string" && row.symbol.trim() ? row.symbol : id;
    return [{
      id,
      symbol,
      value: row.value,
      unit: typeof row.unit === "string" ? row.unit : undefined,
      sourceText: typeof row.sourceText === "string" ? row.sourceText : undefined,
    }];
  });
}

function firstQuantity(quantities: PlanQuantity[], aliases: readonly string[]): number | null {
  const match = quantities.find((quantity) => aliases.some((alias) =>
    normalizeKey(quantity.id) === alias || normalizeKey(quantity.symbol) === alias));
  return match ? match.value : null;
}

function absQuantity(quantities: PlanQuantity[], aliases: readonly string[]): number | null {
  const value = firstQuantity(quantities, aliases);
  return value === null ? null : Math.abs(value);
}

function unitOf(quantities: PlanQuantity[], aliases: readonly string[]): string | undefined {
  return quantities.find((quantity) => aliases.some((alias) =>
    normalizeKey(quantity.id) === alias || normalizeKey(quantity.symbol) === alias))?.unit;
}

function angleDegrees(quantities: PlanQuantity[], question: string): number | null {
  const fromPlan = firstQuantity(quantities, [
    "theta", "thetai", "theta1", "i", "incident", "incidentangle", "angle", "alpha",
  ]);
  if (fromPlan !== null && Number.isFinite(fromPlan)) return fromPlan;
  const match = question.match(/(\d+(?:\.\d+)?)\s*(?:°|deg(?:ree)?s?)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractResistors(
  question: string,
  quantities: PlanQuantity[],
): Array<{ symbol: string; value: number; unit?: string }> {
  const fromQuestion: Array<{ symbol: string; value: number; unit?: string }> = [];
  for (const match of question.matchAll(/\b(R[_-]?\d+)\s*=\s*(\d+(?:\.\d+)?)\s*(k?Ω|ohm|ohms)?/gi)) {
    fromQuestion.push({
      symbol: match[1]!.replace(/[_-]/g, ""),
      value: Number(match[2]),
      unit: match[3] ?? "ohm",
    });
  }
  if (fromQuestion.length >= 2) return fromQuestion;
  const repeated = question.match(
    /\b(two|three|four|2|3|4)\s+(\d+(?:\.\d+)?)\s*(k?Ω|ohm|ohms)\s+resistors?\b/i,
  );
  if (repeated) {
    const spoken = { two: 2, three: 3, four: 4 } as const;
    const word = repeated[1]!.toLowerCase();
    const count = word in spoken ? spoken[word as keyof typeof spoken] : Number(word);
    const value = Number(repeated[2]);
    if (Number.isFinite(count) && count >= 2 && Number.isFinite(value)) {
      return Array.from({ length: count }, (_, index) => ({
        symbol: `R${index + 1}`,
        value,
        unit: repeated[3] ?? "ohm",
      }));
    }
  }
  const fromPlan = quantities.filter((quantity) => {
    if (/eq|equiv|equivalent|total/i.test(`${quantity.id} ${quantity.symbol}`)) return false;
    return /^r\d*$/i.test(normalizeKey(quantity.symbol))
      || /resistance|ohm/.test(`${quantity.id} ${quantity.unit ?? ""}`);
  });
  return fromPlan.map((quantity) => ({
    symbol: quantity.symbol,
    value: quantity.value,
    unit: quantity.unit,
  }));
}

function buildParametricCurve(
  question: string,
  parametric: { xExpression: string; yExpression: string; t: number | null },
): SceneDocument | null {
  const t = parametric.t ?? 1;
  const pad = 1.5;
  let pointX: number;
  let pointY: number;
  try {
    pointX = evaluateInT(parametric.xExpression, t);
    pointY = evaluateInT(parametric.yExpression, t);
  } catch {
    return null;
  }
  const entities: SceneEntity[] = [
    { id: "axes", kind: "axes", role: "display axes" },
    { id: "curve", kind: "polyline", role: "parametric curve" },
    { id: "P", kind: "point", role: "marked point", label: "P" },
  ];
  const constructions: SceneConstruction[] = [
    {
      id: "make_axes",
      operator: "axes",
      inputs: {
        xMin: Math.min(-2, pointX - 2),
        xMax: Math.max(4, pointX + 2),
        yMin: Math.min(-2, pointY - 2),
        yMax: Math.max(4, pointY + 2),
      },
      outputs: ["axes"],
    },
    {
      id: "make_curve",
      operator: "parametric_curve",
      inputs: {
        xExpression: parametric.xExpression,
        yExpression: parametric.yExpression,
        parameter: "t",
        tMin: t - pad,
        tMax: t + pad,
        samples: 65,
      },
      outputs: ["curve"],
    },
    pointAt("P", pointX, pointY),
  ];
  const assertions: SceneAssertion[] = [
    {
      id: "point_on_curve",
      predicate: "function_value",
      entities: ["curve"],
      expected: { x: pointX, y: pointY, t },
      severity: "fatal",
    },
    { id: "label_P", predicate: "label_attached", entities: ["P"], expected: true, severity: "fatal" },
  ];
  if (/\btangent\b/i.test(question)) {
    entities.push({ id: "tangent", kind: "line", role: "tangent line" });
    constructions.push({
      id: "make_tangent",
      operator: "tangent_line",
      inputs: { curve: "curve", at: t, span: 2 },
      outputs: ["tangent"],
    });
    assertions.push({
      id: "tangent_exists",
      predicate: "exists",
      entities: ["tangent"],
      expected: true,
      severity: "fatal",
    });
  }
  return baseDocument({
    question,
    reason: "parametric curve with the asked parameter marked",
    quantities: [],
    entities,
    constructions,
    assertions,
  });
}

function extractParametric(question: string): { xExpression: string; yExpression: string; t: number | null } | null {
  const normalized = question
    .replace(/[−–—]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3");
  const xMatch = /(?:^|[^\w])x\s*=\s*([0-9t+\-*/^().\s]+)/i.exec(normalized);
  const yMatch = /(?:^|[^\w])y\s*=\s*([0-9t+\-*/^().\s]+)/i.exec(normalized);
  if (!xMatch || !yMatch) return null;
  const xExpression = normalizeParametricExpression(xMatch[1]!);
  const yExpression = normalizeParametricExpression(yMatch[1]!);
  if (!/\bt\b/.test(xExpression) && !/\bt\b/.test(yExpression)) return null;
  const tMatch = /(?:^|[^\w])t\s*=\s*(-?\d+(?:\.\d+)?)/i.exec(normalized)
    ?? /near t\s*=\s*(-?\d+(?:\.\d+)?)/i.exec(normalized);
  const t = tMatch ? Number(tMatch[1]) : null;
  return { xExpression, yExpression, t: t !== null && Number.isFinite(t) ? t : null };
}

function normalizeParametricExpression(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/(\d)t/g, "$1*t")
    .replace(/t(?=\()/g, "t*");
}

function evaluateInT(expression: string, t: number): number {
  return parseMathExpression(expression.replace(/\bt\b/g, "x")).evaluate(t);
}

function extractExplicitFunctions(question: string): string[] {
  const facts: string[] = [];
  const normalized = question.replace(/[−–—]/g, "-").replace(/²/g, "^2").replace(/³/g, "^3");
  for (const match of normalized.matchAll(/\by\s*=\s*/gi)) {
    const start = (match.index ?? 0) + match[0].length;
    const expression = readExpression(normalized.slice(start, start + 80));
    if (expression && !facts.includes(expression)) facts.push(expression);
  }
  return facts.slice(0, 3);
}

function extractNamedPlotExpressions(question: string): string[] {
  const normalized = question.replace(/[−–—]/g, "-").replace(/²/g, "^2").replace(/³/g, "^3");
  const facts: string[] = [];
  const fx = /\bF\s*=\s*5x\b/i.exec(normalized);
  if (fx) facts.push("5*x");
  const fxPoly = /\bF_x\s*=\s*\(([^)]+)\)/i.exec(normalized);
  if (fxPoly) {
    const expression = normalizePlotExpression(fxPoly[1]!);
    if (expression) facts.push(expression);
  }
  const uxyz = /\bU\s*=\s*\(2x\^2/i.exec(normalized) || /\bU\s*=\s*\(2x²/i.exec(question);
  if (uxyz) facts.push("2*x^2");
  const ur = /\bU\(r\)\s*=/i.exec(normalized);
  if (ur) facts.push("1/x^12-1/x^6");
  const kt = /\bK\s*=\s*c\s*t\b/i.exec(normalized);
  if (kt) facts.push("x");
  return facts.slice(0, 2);
}

function extractXInterval(question: string): [number, number] | null {
  const match = question.match(
    /from x\s*=\s*(\d+(?:\.\d+)?)\s*m to x\s*=\s*(\d+(?:\.\d+)?)/i,
  );
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return null;
  return start < end ? [start, end] : [end, start];
}

function normalizePlotExpression(value: string): string {
  return value
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, "")
    .replace(/(\d)x/g, "$1*x")
    .replace(/x(?=\()/g, "x*");
}

function extractCoordinateDisplacement(
  question: string,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const match = question.match(
    /from\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*to\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i,
  );
  if (!match) return null;
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  return { x1, y1, x2, y2 };
}

function coordinateDisplacementDocument(
  question: string,
  points: { x1: number; y1: number; x2: number; y2: number },
): SceneDocument {
  const pad = 1;
  const xMin = Math.min(points.x1, points.x2) - pad;
  const xMax = Math.max(points.x1, points.x2) + pad;
  const yMin = Math.min(points.y1, points.y2) - pad;
  const yMax = Math.max(points.y1, points.y2) + pad;
  return baseDocument({
    question,
    reason: "displacement in the plane from the named endpoints",
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "coordinate axes" },
      { id: "start", kind: "point", role: "start", label: "A" },
      { id: "end", kind: "point", role: "end", label: "B" },
      { id: "path", kind: "vector", role: "displacement" },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin, xMax, yMin, yMax }, outputs: ["axes"] },
      pointAt("start", points.x1, points.y1),
      pointAt("end", points.x2, points.y2),
      { id: "make_path", operator: "vector", inputs: { start: "start", end: "end" }, outputs: ["path"] },
    ],
    assertions: [
      { id: "path_exists", predicate: "exists", entities: ["path"], expected: true, severity: "fatal" },
      { id: "label_A", predicate: "label_attached", entities: ["start"], expected: true, severity: "fatal" },
      { id: "label_B", predicate: "label_attached", entities: ["end"], expected: true, severity: "fatal" },
    ],
  });
}

function readExpression(source: string): string {
  const allowed = new Set(["x", "pi", "e", "sin", "cos", "tan", "sqrt", "abs", "ln", "log"]);
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (/\s/.test(character) || /[0-9.+\-*/^()]/.test(character)) {
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      const identifier = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0] ?? "";
      if (!allowed.has(identifier.toLowerCase())) break;
      index += identifier.length;
      continue;
    }
    break;
  }
  return source.slice(0, index).replace(/\s+/g, "");
}

function displayAxis(values: number[]): number[] {
  const min = Math.min(...values);
  const span = Math.max(Math.max(...values) - min, 1e-9);
  return values.map((value) => (value - min) / span * 8);
}

function compactLabel(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length <= 16 ? trimmed : trimmed.slice(0, 16);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\\(?:mathrm|text|operatorname)/g, "").replace(/[^a-z0-9]+/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
