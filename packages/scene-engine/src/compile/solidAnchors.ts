import type { RenderPoint } from "../types";

export type SolidProjectionKind = "cylinder" | "cone" | "frustum" | "sphere" | "hemisphere";
export interface SolidProjection {
  kind: SolidProjectionKind;
  center: RenderPoint;
  radius: number;
  height: number;
  topRadius: number;
  innerRadius?: number;
  axis: "vertical" | "horizontal";
}

/** A point on the same projected circular section used by the solid contour. */
export function solidAnchorPoint(solid: SolidProjection, at: number, radialFraction: number, angleDeg: number): RenderPoint {
  if (!Number.isFinite(at) || at < 0 || at > 1) throw new Error("solid_anchor at must be between 0 and 1");
  if (!Number.isFinite(radialFraction) || radialFraction < 0 || radialFraction > 1) throw new Error("solid_anchor radialFraction must be between 0 and 1");
  if (!Number.isFinite(angleDeg)) throw new Error("solid_anchor angleDeg must be finite");
  const section = solidSectionDimensions(solid, at);
  const theta = angleDeg * Math.PI / 180;
  return projectSolidPoint(solid, section.axial + section.radius * radialFraction * 0.24 * Math.sin(theta), section.radius * radialFraction * Math.cos(theta));
}

export function solidSectionDimensions(solid: SolidProjection, at: number): { axial: number; radius: number } {
  if (solid.kind === "cylinder") return { axial: solid.height * at, radius: solid.radius };
  if (solid.kind === "cone") return { axial: solid.height * at, radius: solid.radius * (1 - at) };
  if (solid.kind === "frustum") return { axial: solid.height * at, radius: solid.radius + (solid.topRadius - solid.radius) * at };
  const axial = solid.kind === "sphere" ? -solid.radius + 2 * solid.radius * at : solid.radius * at;
  return { axial, radius: Math.sqrt(Math.max(0, solid.radius ** 2 - axial ** 2)) };
}

export function projectSolidPoint(solid: SolidProjection, axial: number, radial: number): RenderPoint {
  return solid.axis === "vertical"
    ? { x: solid.center.x + radial, y: solid.center.y + axial }
    : { x: solid.center.x + axial, y: solid.center.y + radial };
}
