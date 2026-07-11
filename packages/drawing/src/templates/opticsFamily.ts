import type { DiagramTemplate } from "./types";
import { withDiagramMarkingGuidance } from "./annotationGuidance";
import { LENS_O_X, MIRROR_POLE_X, OPTICS_MIRROR_CURVE } from "../geometrySnap";

/** All Ray Optics template ids (most-specific matching lives in registry order). */
export const OPTICS_TEMPLATE_IDS = [
  "optics_prism",
  "optics_tir",
  "optics_instrument",
  "optics_lens_combo",
  "optics_lens",
  "optics_mirror",
  "optics_refraction_plane",
] as const;

export type OpticsTemplateId = (typeof OPTICS_TEMPLATE_IDS)[number];

export function isOpticsTemplateId(id: string): boolean {
  return (OPTICS_TEMPLATE_IDS as readonly string[]).includes(id);
}

const SIGN_CONVENTION = `cartesian sign convention (state once, then use consistently): light travels left→right; distances measured from the pole/optical centre; direction of incident light is positive for lenses, opposite the incident light is positive for mirrors. never invent a second convention mid-lesson.`;

const ANTI_SLOP = `forbidden: "let me draw", "template", "already on the board", "runtime", filler openers. teach the physical meaning. order: complete the diagram → explain existing marks with [CIRCLE_AROUND]/[UNDERLINE] → solve on the left (say it as you write it).`;

export const OPTICS_PRISM_TEMPLATE: DiagramTemplate = {
  id: "optics_prism",
  name: "ray optics — prism",
  test:
    /\bprism\b|angle of\s*(?:the\s*)?prism|\b(?:angle of\s+)?deviation\b|\bδ_?m?\b|\bdelta_?m\b|refracting\s+angle/i,
  commands: [
    // Prism triangle (apex up): A(700,180), B(560,420), C(840,420)
    { type: "DRAW_LINE", params: [700, 180, 560, 420] },
    { type: "DRAW_LINE", params: [560, 420, 840, 420] },
    { type: "DRAW_LINE", params: [840, 420, 700, 180] },
    // Incident ray stub toward left face
    { type: "DRAW_LINE", params: [460, 300, 620, 310] },
    // Emergent ray stub from right face
    { type: "DRAW_LINE", params: [780, 310, 920, 280] },
  ],
  introPhases: [
    {
      narration: "this is the triangular prism — the refracting faces meet at the apex.",
      commandIndices: [0, 1, 2],
    },
    {
      narration: "a ray enters the left face and leaves through the right face.",
      commandIndices: [3, 4],
    },
  ],
  anchors: [
    { id: "A", labels: ["A", "apex", "prism angle"], x: 682, y: 160, width: 36, height: 28 },
    { id: "i", labels: ["i", "angle of incidence"], x: 500, y: 250, width: 40, height: 28 },
    { id: "r", labels: ["r", "r1", "r2"], x: 640, y: 280, width: 40, height: 28 },
    { id: "e", labels: ["e", "angle of emergence"], x: 820, y: 250, width: 40, height: 28 },
    { id: "delta", labels: ["δ", "delta", "deviation"], x: 760, y: 200, width: 48, height: 28 },
    { id: "mu", labels: ["μ", "mu", "n", "refractive index"], x: 680, y: 300, width: 48, height: 28 },
  ],
  allowLlmDrawInDiagramZone: false,
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "optics_prism": a triangular prism with incident and emergent ray stubs is already on the board. do not mention this note.
${ANTI_SLOP}
${SIGN_CONVENTION}
do NOT redraw the prism triangle or the ray stubs.
phase 1 — explain the geometry: apex angle A, incidence i, refraction inside, emergence e, deviation δ.
phase 2 — formulas on the left only: A = r1 + r2, δ = i + e − A, μ = sin((A+δ_m)/2) / sin(A/2). for minimum deviation state δ_m once.
phase 3 — solve with y rows 145,205,265,325,385,445,505,565,625 only.`),
};

export const OPTICS_TIR_TEMPLATE: DiagramTemplate = {
  id: "optics_tir",
  name: "ray optics — total internal reflection",
  test:
    /\btotal\s+internal\s+reflection\b|\bTIR\b|critical\s+angle|optical\s+fib(?:re|er)|light\s+pipe/i,
  commands: [
    // Horizontal interface
    { type: "DRAW_LINE", params: [460, 300, 900, 300] },
    // Normal through incidence point
    { type: "DRAW_LINE", params: [680, 180, 680, 420] },
    // Incident ray from denser medium (below)
    { type: "DRAW_LINE", params: [560, 400, 680, 300] },
    // Reflected ray (TIR)
    { type: "DRAW_LINE", params: [680, 300, 800, 400] },
  ],
  introPhases: [
    {
      narration: "the boundary between the denser and rarer medium is this horizontal interface.",
      commandIndices: [0],
    },
    {
      narration: "the normal is perpendicular to the interface at the point of incidence.",
      commandIndices: [1],
    },
    {
      narration: "when the angle of incidence exceeds the critical angle, the ray reflects totally inside.",
      commandIndices: [2, 3],
    },
  ],
  anchors: [
    { id: "N", labels: ["N", "normal"], x: 662, y: 160, width: 36, height: 28 },
    { id: "i", labels: ["i", "angle of incidence"], x: 580, y: 340, width: 40, height: 28 },
    { id: "ic", labels: ["i_c", "ic", "critical angle"], x: 700, y: 340, width: 48, height: 28 },
    { id: "mu", labels: ["μ", "mu", "n", "refractive index"], x: 520, y: 250, width: 48, height: 28 },
  ],
  allowLlmDrawInDiagramZone: false,
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "optics_tir": interface, normal, and TIR ray path are already drawn. do not mention this note.
${ANTI_SLOP}
${SIGN_CONVENTION}
do NOT redraw the interface, normal, or the reflected path.
phase 1 — explain denser→rarer, critical angle i_c = sin⁻¹(1/μ), and why i > i_c gives TIR.
phase 2 — applications (optical fibre) only if asked. formulas on the left: sin i_c = 1/μ (rarer n≈1).
phase 3 — solve with y rows 145,205,265,325,385,445,505,565,625 only.`),
};

export const OPTICS_INSTRUMENT_TEMPLATE: DiagramTemplate = {
  id: "optics_instrument",
  name: "ray optics — optical instruments",
  test:
    /\b(?:compound\s+)?microscope\b|\b(?:astronomical\s+)?telescope\b|eyepiece|objective\s+lens|tube\s+length/i,
  commands: [
    // Principal axis
    { type: "DRAW_LINE", params: [440, 300, 920, 300] },
    // Objective (thin lens mark) near left
    { type: "DRAW_LINE", params: [520, 220, 520, 380] },
    { type: "DRAW_LINE", params: [510, 230, 530, 230] },
    { type: "DRAW_LINE", params: [510, 370, 530, 370] },
    // Eyepiece near right
    { type: "DRAW_LINE", params: [820, 240, 820, 360] },
    { type: "DRAW_LINE", params: [810, 250, 830, 250] },
    { type: "DRAW_LINE", params: [810, 350, 830, 350] },
  ],
  introPhases: [
    {
      narration: "the principal axis runs through both lenses of the instrument.",
      commandIndices: [0],
    },
    {
      narration: "the objective is the lens facing the object — it forms the first image.",
      commandIndices: [1, 2, 3],
    },
    {
      narration: "the eyepiece is the lens near the eye — it magnifies that intermediate image.",
      commandIndices: [4, 5, 6],
    },
  ],
  anchors: [
    { id: "O", labels: ["O", "objective", "fo"], x: 500, y: 190, width: 44, height: 28 },
    { id: "E", labels: ["E", "eyepiece", "fe"], x: 800, y: 190, width: 44, height: 28 },
    { id: "L", labels: ["L", "tube length"], x: 640, y: 320, width: 48, height: 28 },
    { id: "Fo", labels: ["Fo", "f_o", "fo"], x: 560, y: 280, width: 40, height: 28 },
    { id: "Fe", labels: ["Fe", "f_e", "fe"], x: 760, y: 280, width: 40, height: 28 },
    { id: "D", labels: ["D", "near point"], x: 860, y: 320, width: 40, height: 28 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "optics_instrument": axis, objective, and eyepiece are already drawn. do not mention this note.
${ANTI_SLOP}
${SIGN_CONVENTION}
do NOT redraw the axis or the two lens marks. you MAY draw principal rays for the intermediate image.
phase 1 — identify compound microscope vs astronomical telescope from the question. mark fo, fe, tube length L, near point D when given.
phase 2 — formulas: microscope m ≈ −(L/fo)(D/fe); telescope m ≈ −fo/fe. never mix the two.
phase 3 — solve on the left with y rows 145,205,265,325,385,445,505,565,625 only.`),
};

export const OPTICS_LENS_COMBO_TEMPLATE: DiagramTemplate = {
  id: "optics_lens_combo",
  name: "ray optics — lens combination",
  test:
    /lenses?\s+in\s+contact|combination\s+of\s+(?:thin\s+)?lenses|equivalent\s+focal|two\s+(?:thin\s+)?lenses|f1.*f2|f_1.*f_2/i,
  commands: [
    { type: "DRAW_LINE", params: [440, 300, 920, 300] },
    // Lens 1 (double-convex mark)
    { type: "DRAW_LINE", params: [620, 210, 620, 390, 600, 300, 2] },
    { type: "DRAW_LINE", params: [620, 210, 620, 390, 640, 300, 2] },
    // Lens 2 slightly to the right
    { type: "DRAW_LINE", params: [680, 210, 680, 390, 660, 300, 2] },
    { type: "DRAW_LINE", params: [680, 210, 680, 390, 700, 300, 2] },
  ],
  introPhases: [
    {
      narration: "the principal axis is the common reference through both thin lenses.",
      commandIndices: [0],
    },
    {
      narration: "two thin lenses sit in contact on the axis — each has its own focal length.",
      commandIndices: [1, 2, 3, 4],
    },
  ],
  anchors: [
    { id: "O", labels: ["O", "optical center", "centre"], x: 640, y: 280, width: 40, height: 28 },
    { id: "f1", labels: ["f1", "f_1"], x: 560, y: 250, width: 40, height: 28 },
    { id: "f2", labels: ["f2", "f_2"], x: 720, y: 250, width: 40, height: 28 },
    { id: "feq", labels: ["F", "f", "feq", "equivalent"], x: 640, y: 220, width: 48, height: 28 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "optics_lens_combo": axis and two thin lenses in contact are already drawn. do not mention this note.
${ANTI_SLOP}
${SIGN_CONVENTION}
do NOT redraw the axis or either lens outline. you MAY draw principal rays through the equivalent system.
phase 1 — mark f1, f2 and the equivalent focus. phase 2 — 1/F = 1/f1 + 1/f2 (contact, same medium). power P = P1 + P2.
phase 3 — solve on the left with y rows 145,205,265,325,385,445,505,565,625 only.`),
};

export const OPTICS_LENS_TEMPLATE: DiagramTemplate = {
  id: "optics_lens",
  name: "ray optics — thin lens",
  test:
    /\blens\b|lens\s+maker|power\s+of\s+(?:a\s+)?lens|convex\s+lens|concave\s+lens|focal\s+length\s+of\s+(?:the\s+)?lens|\bdioptre\b|\bdiopter\b/i,
  commands: [
    { type: "DRAW_LINE", params: [440, 300, 920, 300] },
    // Double-convex thin lens at optical centre x=LENS_O_X (650)
    { type: "DRAW_LINE", params: [LENS_O_X, 200, LENS_O_X, 400, 620, 300, 2] },
    { type: "DRAW_LINE", params: [LENS_O_X, 200, LENS_O_X, 400, 680, 300, 2] },
  ],
  introPhases: [
    {
      narration: "the principal axis is the horizontal line through the optical centre of the lens.",
      commandIndices: [0],
    },
    {
      narration: "this thin lens sits on the axis — light refracts as it passes through.",
      commandIndices: [1, 2],
    },
  ],
  anchors: [
    // Label-band anchors (above the axis) so CIRCLE_AROUND hits the letter, not the tick.
    // Ray snap still projects C/F/O onto y=300 in geometrySnap.
    { id: "O", labels: ["O", "optical center", "optical centre", "center"], x: 632, y: 240, width: 36, height: 32 },
    { id: "F", labels: ["F", "focal", "focus", "f"], x: 552, y: 240, width: 36, height: 32 },
    { id: "F2", labels: ["F'", "F prime", "2F"], x: 712, y: 240, width: 36, height: 32 },
    { id: "object", labels: ["object", "AB", "A", "B"], x: 480, y: 200, width: 44, height: 88 },
    { id: "image", labels: ["image", "A'B'", "A prime", "B prime"], x: 760, y: 200, width: 44, height: 88 },
    { id: "u", labels: ["u", "object distance"], x: 520, y: 380, width: 88, height: 32 },
    { id: "v", labels: ["v", "image distance"], x: 700, y: 412, width: 88, height: 32 },
    { id: "f", labels: ["f", "focal length"], x: 580, y: 396, width: 72, height: 28 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "optics_lens": principal axis and thin lens are already drawn. the runtime intro marks F, F', O CLEARLY OFF the axis and u/f/v as dotted bars BELOW the axis with exact endpoints. do not mention this note.
${ANTI_SLOP}
${SIGN_CONVENTION}
CRITICAL — keep the diagram clean:
- do NOT emit [LABEL] or [WRITE] for O, F, F', object, image, u, v, or f on the diagram — already on the board, clear of the axis.
- do NOT emit [DIMENSION:...] for u, f, or v — already drawn with correct spans.
- only [CIRCLE_AROUND]/[UNDERLINE] existing label text (above the axis), then solve on the left.
phase 1 — you MAY draw principal rays only (parallel through F', through O undeviated, through F emerging parallel). EVERY ray bend / refraction junction must be ON the thin-lens plane at x=${LENS_O_X} (the vertical spine), never floating left or right of it in empty space.
phase 2 — lens formula 1/v − 1/u = 1/f, m = v/u, P = 1/f (metres, dioptre). lens maker only if asked.
phase 3 — solve on the left with y rows 145,205,265,325,385,445,505,565,625 only. signed values only in left-column [WRITE]. for object inside f, expect a virtual erect image on the object side.`),
};

export const OPTICS_MIRROR_TEMPLATE: DiagramTemplate = {
  id: "optics_mirror",
  name: "ray optics — spherical mirror",
  test:
    /\bmirror\b|concave\s+mirror|convex\s+mirror|spherical\s+mirror|pole\s+of\s+(?:the\s+)?mirror|centre\s+of\s+curvature|center\s+of\s+curvature/i,
  commands: [
    { type: "DRAW_LINE", params: [460, 300, 900, 300] },
    // Arc meets the axis at the pole (MIRROR_POLE_X); control solved so B(0.5)=pole.
    {
      type: "DRAW_LINE",
      params: [...OPTICS_MIRROR_CURVE, 2],
    },
  ],
  introPhases: [
    {
      narration:
        "the principal axis is the horizontal reference line through the pole of the mirror.",
      commandIndices: [0],
    },
    {
      narration:
        "the spherical mirror surface curves here — rays reflect from this arc.",
      commandIndices: [1],
    },
  ],
  anchors: [
    // Label-band anchors above the axis (ray snap projects C/F/O onto y=300).
    { id: "C", labels: ["C", "center of curvature", "2F", "2f"], x: 472, y: 240, width: 36, height: 32 },
    { id: "F", labels: ["F", "focal", "focus"], x: 532, y: 240, width: 36, height: 32 },
    { id: "O", labels: ["O", "pole", "optical center", "center"], x: 592, y: 240, width: 36, height: 32 },
    { id: "F2", labels: ["F'", "F prime", "right focal"], x: 700, y: 240, width: 36, height: 32 },
    { id: "object", labels: ["object", "AB", "A", "B"], x: 508, y: 200, width: 44, height: 88 },
    { id: "image", labels: ["image", "A'B'", "A prime", "B prime"], x: 700, y: 200, width: 44, height: 88 },
    { id: "u", labels: ["u", "object distance"], x: 528, y: 380, width: 88, height: 32 },
    { id: "v", labels: ["v", "image distance"], x: 700, y: 412, width: 88, height: 32 },
    { id: "f", labels: ["f", "focal length"], x: 620, y: 396, width: 72, height: 28 },
    { id: "ho", labels: ["h", "h_o", "object height"], x: 458, y: 218, width: 36, height: 62 },
    { id: "hi", labels: ["h'", "h_i", "image height"], x: 738, y: 218, width: 36, height: 62 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "optics_mirror": the right side has the principal axis and spherical mirror arc as geometry only. the runtime intro already ticks and labels C, F, O and the object/image CLEARLY OFF the axis, and marks u/f/v as thin dotted bars BELOW the axis with exact endpoints at the object/F/image and the pole. do not mention this note to the student.
${ANTI_SLOP}
${SIGN_CONVENTION}
CRITICAL — keep the diagram clean:
- do NOT emit any [LABEL] or [WRITE] for C, F, O, object, image, u, v, or f on the diagram — they are already on the board, clear of the axis.
- do NOT emit any [DIMENSION:...] for u, f, or v — the distance bars are already drawn with correct spans. re-emitting them stacks ink and makes a mess.
- for a convex mirror, C and F are BEHIND the mirror (right of the pole); the object is in front (left). never place C/F in front of a convex mirror.
- only annotate existing marks with [CIRCLE_AROUND] or [UNDERLINE] on the LABEL TEXT (above the axis), then solve on the left.
phase 1 — if rays are needed, draw each principal ray in its own [STEP]. reflection junctions must land ON the mirror arc near the pole (x≈${MIRROR_POLE_X} on the axis), never floating left of the surface in empty space. do NOT redraw the axis, arc, ticks, or distance bars.
phase 2 — explain existing labels with [CIRCLE_AROUND] on the label text only.
phase 3 — mirror formula 1/v + 1/u = 1/f on the left with y rows 145,205,265,325,385,445,505,565,625 only. write signed values (-f, -v) only in left-column [WRITE], never as new diagram marks. for a convex mirror, the image is always virtual, erect, and diminished.`),
};

export const OPTICS_REFRACTION_PLANE_TEMPLATE: DiagramTemplate = {
  id: "optics_refraction_plane",
  name: "ray optics — plane refraction / slab",
  test:
    /glass\s+slab|plane\s+(?:glass\s+)?(?:surface|refraction)|refraction\s+at\s+(?:a\s+)?plane|shift\s+(?:due\s+to|through)\s+(?:a\s+)?slab|lateral\s+shift/i,
  commands: [
    // Slab top and bottom
    { type: "DRAW_LINE", params: [520, 220, 820, 220] },
    { type: "DRAW_LINE", params: [520, 380, 820, 380] },
    // Slab sides
    { type: "DRAW_LINE", params: [520, 220, 520, 380] },
    { type: "DRAW_LINE", params: [820, 220, 820, 380] },
    // Incident ray
    { type: "DRAW_LINE", params: [460, 180, 560, 240] },
    // Emergent ray (laterally shifted)
    { type: "DRAW_LINE", params: [780, 360, 900, 420] },
  ],
  introPhases: [
    {
      narration: "this rectangular glass slab has two parallel faces.",
      commandIndices: [0, 1, 2, 3],
    },
    {
      narration: "a ray enters the top face and leaves the bottom face, shifted sideways.",
      commandIndices: [4, 5],
    },
  ],
  anchors: [
    { id: "i", labels: ["i", "angle of incidence"], x: 480, y: 160, width: 40, height: 28 },
    { id: "r", labels: ["r", "angle of refraction"], x: 580, y: 260, width: 40, height: 28 },
    { id: "t", labels: ["t", "thickness"], x: 840, y: 280, width: 40, height: 28 },
    { id: "mu", labels: ["μ", "mu", "n", "refractive index"], x: 640, y: 280, width: 48, height: 28 },
    { id: "shift", labels: ["shift", "lateral shift", "d"], x: 860, y: 380, width: 56, height: 28 },
  ],
  allowLlmDrawInDiagramZone: false,
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "optics_refraction_plane": glass slab and ray stubs are already drawn. do not mention this note.
${ANTI_SLOP}
${SIGN_CONVENTION}
do NOT redraw the slab or the incident/emergent stubs. explain Snell's law at each face and lateral shift d = t (1 − 1/μ) sin i / cos r when relevant.
phase 2 — formulas on the left: n1 sin i = n2 sin r. phase 3 — solve with y rows 145,205,265,325,385,445,505,565,625 only.`),
};

/** Registry order: most specific first. */
export const OPTICS_FAMILY_TEMPLATES: DiagramTemplate[] = [
  OPTICS_PRISM_TEMPLATE,
  OPTICS_TIR_TEMPLATE,
  OPTICS_INSTRUMENT_TEMPLATE,
  OPTICS_LENS_COMBO_TEMPLATE,
  OPTICS_LENS_TEMPLATE,
  OPTICS_MIRROR_TEMPLATE,
  OPTICS_REFRACTION_PLANE_TEMPLATE,
];
