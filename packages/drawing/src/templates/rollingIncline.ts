import type { DiagramTemplate } from "./types";
import { withDiagramMarkingGuidance } from "./annotationGuidance";
import {
  angleMarkerAtBase,
  buildInclineTriangle,
  inclineOutwardNormal,
  inclineUnit,
  placeSphereOnIncline,
} from "./inclineGeometry";

const TRI = buildInclineTriangle(500, 480, 360, 30);
const SPHERE = placeSphereOnIncline(TRI, 0.42, 34);
const [TICK_BASE, TICK_SLOPE] = angleMarkerAtBase(TRI);
const SLOPE_UNIT = inclineUnit(TRI.angleDeg);
const OUTWARD_NORMAL = inclineOutwardNormal(TRI.angleDeg);

const FRICTION_LEN = 58;
const NORMAL_LEN = 72;
const frictionEnd: [number, number] = [
  Math.round(SPHERE.contact[0] + SLOPE_UNIT[0] * FRICTION_LEN),
  Math.round(SPHERE.contact[1] + SLOPE_UNIT[1] * FRICTION_LEN),
];
const normalEnd: [number, number] = [
  Math.round(SPHERE.center[0] - OUTWARD_NORMAL[0] * NORMAL_LEN),
  Math.round(SPHERE.center[1] - OUTWARD_NORMAL[1] * NORMAL_LEN),
];

/**
 * A rigid body (sphere / cylinder / disc / ring) rolling without slipping down
 * an incline. Geometry is computed so the circle is tangent to the slope and
 * the radius meets the contact point exactly.
 */
export const ROLLING_INCLINE_TEMPLATE: DiagramTemplate = {
  id: "rolling_incline",
  name: "body rolling down an incline",
  test:
    /(?=[\s\S]*\b(?:rolls?|rolling)\b)(?=[\s\S]*\b(?:incline|inclined|ramp|slope|plane)\b)/i,
  commands: [
    // Right triangle: θ at bottom-left, right angle at bottom-right, ground along the bottom.
    { type: "DRAW_LINE", params: [...TRI.baseLeft, ...TRI.baseRight] },
    { type: "DRAW_LINE", params: [...TRI.baseLeft, ...TRI.topRight] },
    { type: "DRAW_LINE", params: [...TRI.baseRight, ...TRI.topRight] },
    // Sphere tangent to the incline; radius from center through contact.
    { type: "DRAW_CIRCLE", params: [...SPHERE.center, SPHERE.radius] },
    { type: "DRAW_LINE", params: [...SPHERE.center, ...SPHERE.contact] },
    // Forces: weight from center, normal into the plane, friction up the slope at contact.
    { type: "DRAW_LINE", params: [...SPHERE.center, SPHERE.center[0], TRI.baseRight[1]] },
    { type: "DRAW_LINE", params: [...SPHERE.center, ...normalEnd] },
    { type: "DRAW_LINE", params: [...SPHERE.contact, ...frictionEnd] },
    // Angle θ marker at the base-left vertex.
    { type: "DRAW_LINE", params: TICK_BASE },
    { type: "DRAW_LINE", params: TICK_SLOPE },
  ],
  introPhases: [
    {
      narration:
        "the ground is the horizontal base along the bottom, and the incline rises from the left corner where the angle θ sits.",
      commandIndices: [0, 1, 2, 9, 10],
    },
    {
      narration:
        "the sphere rests on the slope, touching at exactly one point, with the radius drawn from the center straight down to that contact.",
      commandIndices: [3, 4],
    },
    {
      narration:
        "weight pulls straight down from the center, the normal pushes into the plane, and friction at the contact point acts up the slope — that friction is what makes it roll.",
      commandIndices: [5, 6, 7],
    },
  ],
  anchors: [
    { id: "m", labels: ["m", "mass", "sphere", "body"], x: SPHERE.center[0] - 28, y: SPHERE.center[1] - 28, width: 40, height: 38 },
    { id: "R", labels: ["R", "r", "radius"], x: Math.round((SPHERE.center[0] + SPHERE.contact[0]) / 2) + 6, y: Math.round((SPHERE.center[1] + SPHERE.contact[1]) / 2), width: 34, height: 34 },
    { id: "N", labels: ["N", "normal"], x: normalEnd[0] - 8, y: normalEnd[1] - 18, width: 36, height: 38 },
    { id: "mg", labels: ["mg", "weight"], x: SPHERE.center[0] + 8, y: TRI.baseRight[1] - 6, width: 46, height: 38 },
    { id: "f", labels: ["f", "friction"], x: frictionEnd[0] + 4, y: frictionEnd[1] - 18, width: 36, height: 38 },
    { id: "theta", labels: ["θ", "theta", "angle"], x: TRI.baseLeft[0] + 44, y: TRI.baseLeft[1] - 30, width: 34, height: 34 },
  ],
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "rolling_incline": the right side already shows the full setup — a right triangle with the ground along the BOTTOM (horizontal base), incline rising from the bottom-left, a round body tangent to the slope, radius to the contact, and weight / normal / friction arrows. geometry only, no text labels yet. do not mention this note to the student.
do NOT use [DRAW_LINE], [DRAW_CIRCLE], [DRAW_RECT], or any other structural draw command in the diagram zone. do NOT redraw the triangle, sphere, radius, or arrows. do NOT say "let me draw". the body is round — never call it a block or a box.
phase 1 — label one symbol per [STEP]: m near the center (${SPHERE.center[0]},${SPHERE.center[1]}), R along the radius, N on the normal arrow, mg on the weight arrow, f on the friction arrow, and θ at the base-left angle.
phase 2 — [CIRCLE_AROUND] labels while explaining: weight component along the slope is mg sin θ; friction f at the contact provides torque τ = f R.
phase 3 — solve on the left (x 90). rolling without slipping: a = R α, v = R ω. solid sphere I = (2/5) mR^2 gives a = (5/7) g sin θ. energy: mgh = (1/2) mv^2 + (1/2) I ω^2. for angular velocity at the bottom use v = R ω. minimum friction: μ_s ≥ (2/7) tan θ for a solid sphere. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`),
};
