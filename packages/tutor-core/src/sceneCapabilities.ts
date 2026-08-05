/** Compact, representation-level capability prediction for semantic scenes. */

export const SCENE_VISUAL_FAMILIES = [
  "ray_path",
  "axis_view",
  "interface",
  "instrument_chain",
  "wavefront",
  "aperture",
  "screen_pattern",
  "transverse_field",
  "polarizer",
] as const;

export type SceneVisualFamily = (typeof SCENE_VISUAL_FAMILIES)[number];

export interface SceneCapabilityRequirements {
  visualRequired: boolean;
  families: SceneVisualFamily[];
  constructionOperators: string[];
  proofPredicates: string[];
  planningGuidance: string[];
}

const BASE_OPERATORS = [
  "point", "segment", "line", "polyline", "vector", "label", "dimension", "angle_mark",
];

const FAMILY_OPERATORS: Record<SceneVisualFamily, readonly string[]> = {
  ray_path: [
    "ray", "line", "segment", "vector", "arc", "intersection", "surface_intersection",
    "surface_contact", "normal_at", "reflect_direction", "refract_direction", "parallel_through",
    "reflect_at", "refract_at", "angle_mark", "right_angle_mark",
  ],
  axis_view: ["line", "segment", "ray", "arc", "vector", "dimension", "reflect_point"],
  interface: ["line", "circle", "arc", "polygon", "surface_intersection", "surface_contact", "normal_at"],
  instrument_chain: ["line", "segment", "ray", "arc", "vector", "dimension", "parallel_through", "perpendicular_through", "optical_train"],
  wavefront: ["wavefront_family", "line", "vector", "perpendicular_through"],
  aperture: ["aperture", "line", "segment"],
  screen_pattern: ["screen_pattern", "line", "segment", "dimension"],
  transverse_field: ["transverse_field", "line", "vector"],
  polarizer: ["polarizer", "line", "angle_mark"],
};

const FAMILY_PREDICATES: Record<SceneVisualFamily, readonly string[]> = {
  ray_path: ["incident", "on", "parallel", "converges", "equal_angle", "snells_law"],
  axis_view: ["between", "ordered_along", "distance_ratio", "equal_spacing"],
  interface: ["incident", "on", "inside", "snells_law"],
  instrument_chain: ["ordered_along", "parallel", "perpendicular", "on", "between", "converges"],
  wavefront: ["parallel", "perpendicular", "equal_spacing", "equal_angle"],
  aperture: ["inside", "equal_spacing"],
  screen_pattern: ["equal_spacing", "ordered_along"],
  transverse_field: ["perpendicular", "parallel"],
  polarizer: ["angle_between", "perpendicular"],
};

const FAMILY_GUIDANCE: Record<SceneVisualFamily, string> = {
  ray_path: "Derive every reflected or refracted direction with reflect_at/refract_at or the surface-contact chain; never guess ray endpoints. Prove incidence, angle, convergence, or parallelism named by the question.",
  axis_view: "Use one shared axis, reuse point IDs for named positions on it, prove their order, and attach each dimension to its actual endpoints. Compress display scale without changing authoritative ratios.",
  interface: "Construct one explicit interface and one shared contact point. Derive the normal and outgoing ray from that surface, and prove the contact and governing reflection/refraction law.",
  instrument_chain: "Build one continuous optical chain on a shared axis. Objective and eyepiece lens elements are perpendicular to that axis. For an afocal normal-adjustment chain, reuse one point ID for the objective image and eyepiece focus, then use optical_train for the six rays. Prove parallel input/output bundles and intermediate convergence.",
  wavefront: "Use wavefront_family with a verified ray/path ID as direction. Prove each front is perpendicular to propagation and use derived reflected/refracted rays when a boundary is present.",
  aperture: "Use aperture for the physical opening; do not imitate slits with boxes or loose segments. Keep slit count and ordering faithful to the question.",
  screen_pattern: "Use screen_pattern for interference, diffraction, or resolution marks. Keep physical spacing in quantities and use normalized display spacing only for rendering.",
  transverse_field: "Use transverse_field for propagation plus field oscillation and prove its transverse relation. Do not substitute prose or a generic box for polarization state.",
  polarizer: "Use polarizer for every transmission axis, derive stated relative angles, and keep labels attached to their own optical element.",
};

const LAW_FAMILIES: ReadonlyArray<readonly [RegExp, readonly SceneVisualFamily[]]> = [
  [/mirror|thin.?lens|lens.?maker|magnification|lens.?power|lenses?.?in.?contact/i, ["axis_view", "ray_path"]],
  [/snell|spherical.?refraction|critical.?angle|fiber.?acceptance|prism/i, ["interface", "ray_path"]],
  [/microscope|telescope/i, ["instrument_chain", "axis_view", "ray_path"]],
  [/wavefront|huygens/i, ["wavefront", "ray_path", "interface"]],
  [/ydse|fringe.?width|phase.?difference/i, ["aperture", "ray_path", "screen_pattern"]],
  [/single.?slit|diffraction/i, ["aperture", "wavefront", "ray_path", "screen_pattern"]],
  [/resolution|resolving/i, ["aperture", "screen_pattern", "instrument_chain"]],
  [/brewster/i, ["ray_path", "interface", "polarizer"]],
  [/malus|polari[sz]/i, ["transverse_field", "polarizer"]],
];

const QUESTION_FAMILIES: ReadonlyArray<readonly [RegExp, readonly SceneVisualFamily[]]> = [
  [/(?:mirror|lens|magnification|optical power|focal point|principal axis)/i, ["axis_view", "ray_path"]],
  [/(?:refraction|refracted|critical angle|total internal reflection|optical fibre|optical fiber|prism|brewster)/i, ["interface", "ray_path"]],
  [/(?:microscope|telescope|objective|eyepiece)/i, ["instrument_chain", "axis_view"]],
  [/(?:wavefront|huygens|secondary wavelet|coheren(?:t|ce))/i, ["wavefront"]],
  [/(?:double.?slit|young.?s experiment|slit separation|single.?slit|aperture)/i, ["aperture"]],
  [/(?:interference|fringe|diffraction|central maximum|rayleigh|resolving|phase difference)/i, ["screen_pattern"]],
  [/(?:incident ray|reflected ray|refracted ray|ray path|normal|path difference|first minima|emergent ray)/i, ["ray_path"]],
  [/(?:unpolari[sz]ed|plane.?polari[sz]ed|electric field direction|malus)/i, ["transverse_field"]],
  [/(?:polari[sz]er|analy[sz]er|polaroid|brewster|malus|polari[sz]ation)/i, ["polarizer"]],
  [/(?:microscope|telescope|rayleigh|resolving power)/i, ["instrument_chain"]],
];

export function inferSceneCapabilities(
  question: string,
  lawIds: readonly string[] = [],
): SceneCapabilityRequirements {
  const families = new Set<SceneVisualFamily>();
  const lawText = lawIds.join(" ");
  for (const [pattern, matches] of LAW_FAMILIES) {
    if (pattern.test(lawText)) matches.forEach((family) => families.add(family));
  }
  for (const [pattern, matches] of QUESTION_FAMILIES) {
    if (pattern.test(question)) matches.forEach((family) => families.add(family));
  }

  // A wave-pattern calculation needs its physical aperture and propagation
  // path even when the question abbreviates the setup.
  if (families.has("screen_pattern") && /(?:interference|fringe|diffraction|ydse|young)/i.test(`${question} ${lawText}`)) {
    families.add("aperture");
    families.add("ray_path");
  }
  if (families.has("instrument_chain") && /(?:telescope|microscope)/i.test(`${question} ${lawText}`)) {
    families.add("axis_view");
  }

  const operators = new Set(BASE_OPERATORS);
  const predicates = new Set(["exists", "label_attached"]);
  const planningGuidance = new Set<string>();
  for (const family of families) {
    FAMILY_OPERATORS[family].forEach((operator) => operators.add(operator));
    FAMILY_PREDICATES[family].forEach((predicate) => predicates.add(predicate));
    planningGuidance.add(FAMILY_GUIDANCE[family]);
  }
  const explicitVisual = /\b(?:draw|diagram|illustrat(?:e|ion)|sketch|construct|plot|graph|locate|mark|show)\b/i.test(question);
  return {
    visualRequired: families.size > 0 || explicitVisual,
    families: [...families],
    constructionOperators: [...operators],
    proofPredicates: [...predicates],
    planningGuidance: [...planningGuidance],
  };
}
