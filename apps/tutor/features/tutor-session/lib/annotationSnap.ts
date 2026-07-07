import { resolveAnnotationWithAnchors, type DrawCommand, type TemplateAnchor } from "@heytutor/drawing";
import { ANNOTATION_SNAP_DISTANCE } from "../constants";
import type { BoardTextRect } from "../types";
import {
  bboxNearRect,
  bboxParamsForRect,
  findNearestTextRect,
  lineNearRect,
  pointNearRect,
  underlineParamsForRect,
} from "./boardLayout";

const NARRATION_LABEL_RULES: Array<{ cues: string[]; labels: string[] }> = [
  { cues: ["mass", "the mass", "mass is", "this mass", "labeled m", "label m"], labels: ["m", "M"] },
  { cues: ["friction", "frictional", "mu times", "mu is", "force of friction"], labels: ["f", "F_f", "f_k", "f_s"] },
  { cues: ["normal force", "normal from", "normal pushes", "normal", "surface pushes"], labels: ["N", "F_N"] },
  { cues: ["weight", "gravity", "gravitational", "mass times g", "mg", "w equals"], labels: ["mg", "W", "F_g"] },
  { cues: ["applied push", "applied force", "push to the right", "push to the left", "applied"], labels: ["F", "F_app", "P"] },
  { cues: ["tension", "rope pulls", "string pulls", "cable pulls"], labels: ["T", "F_T"] },
  { cues: ["velocity", "the velocity", "speed"], labels: ["v", "V"] },
  { cues: ["acceleration", "the acceleration", "accelerates"], labels: ["a", "A"] },
  { cues: ["force", "the force", "net force"], labels: ["F", "F_net"] },
  { cues: ["angle", "theta", "the angle"], labels: ["θ", "theta"] },
  { cues: ["coefficient", "mu", "friction coefficient"], labels: ["μ", "mu"] },
  { cues: ["distance", "displacement", "the distance"], labels: ["d", "x", "s"] },
  { cues: ["height", "the height", "falls from"], labels: ["h", "H"] },
  { cues: ["time", "the time"], labels: ["t", "T"] },
  { cues: ["energy", "kinetic energy", "potential energy"], labels: ["E", "KE", "PE", "U"] },
  { cues: ["momentum", "the momentum"], labels: ["p", "P"] },
  { cues: ["charge", "the charge"], labels: ["q", "Q"] },
  { cues: ["current", "the current"], labels: ["I", "i"] },
  { cues: ["voltage", "potential difference", "the voltage"], labels: ["V", "ΔV"] },
  { cues: ["resistance", "the resistance"], labels: ["R"] },
  { cues: ["power", "the power"], labels: ["P"] },
  { cues: ["frequency", "the frequency"], labels: ["f", "ν"] },
  { cues: ["wavelength", "the wavelength"], labels: ["λ", "lambda"] },
  { cues: ["temperature", "the temperature"], labels: ["T"] },
  { cues: ["pressure", "the pressure"], labels: ["P", "p"] },
  { cues: ["volume", "the volume"], labels: ["V", "v"] },
  { cues: ["density", "the density"], labels: ["ρ", "rho"] },
  { cues: ["area", "the area"], labels: ["A"] },
];

function normalizeLabel(text: string): string {
  return text.trim().replace(/\s+/g, "").toLowerCase();
}

function findAnchorByNarration(narration: string, rects: BoardTextRect[]): BoardTextRect | null {
  const normalized = narration.toLowerCase();

  for (const rule of NARRATION_LABEL_RULES) {
    if (!rule.cues.some((cue) => normalized.includes(cue))) {
      continue;
    }
    for (const label of rule.labels) {
      const target = normalizeLabel(label);
      const match = rects.find((rect) => normalizeLabel(rect.text ?? "") === target);
      if (match) {
        return match;
      }
    }
  }

  for (const rect of rects) {
    const rectText = (rect.text ?? "").trim().toLowerCase();
    if (rectText.length === 0 || rectText.length > 30) {
      continue;
    }
    if (normalized.includes(rectText)) {
      return rect;
    }
  }

  return null;
}

export function resolveSnappedAnnotationParams(
  kind: DrawCommand["type"],
  params: number[],
  rects: BoardTextRect[],
  narration?: string,
  templateAnchors: TemplateAnchor[] = [],
): { params: number[]; snapped: boolean; rect: BoardTextRect | null } {
  if (templateAnchors.length > 0 && narration) {
    const templateSnap = resolveAnnotationWithAnchors(
      kind,
      params,
      templateAnchors,
      rects,
      narration,
    );
    if (templateSnap.snapped) {
      return templateSnap;
    }
  }

  const pad = 8;

  if (kind === "UNDERLINE" && params.length >= 4) {
    const [x1, y1, x2, y2] = params;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const match = findNearestTextRect(
      (rect) => lineNearRect(x1, y1, x2, y2, rect),
      rects,
      { x: midX, y: midY },
    );
    if (match) {
      return { params: underlineParamsForRect(match, pad), snapped: true, rect: match };
    }
  }

  if ((kind === "CIRCLE_AROUND" || kind === "HIGHLIGHT") && params.length >= 4) {
    const [x, y, w, h] = params;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const match = findNearestTextRect(
      (rect) => bboxNearRect(x, y, w, h, rect),
      rects,
      { x: cx, y: cy },
    );
    if (match) {
      return { params: bboxParamsForRect(match, pad), snapped: true, rect: match };
    }
    const nearby = findNearestTextRect(
      (rect) => pointNearRect(cx, cy, rect, ANNOTATION_SNAP_DISTANCE * 2),
      rects,
      { x: cx, y: cy },
    );
    if (nearby) {
      return { params: bboxParamsForRect(nearby, pad), snapped: true, rect: nearby };
    }
  }

  if (kind === "ARROW" && params.length >= 4) {
    const [x1, y1, x2, y2] = params;
    const match = findNearestTextRect(
      (rect) => pointNearRect(x2, y2, rect) || lineNearRect(x1, y1, x2, y2, rect),
      rects,
      { x: x2, y: y2 },
    );
    if (match) {
      const cx = match.x + match.width / 2;
      const cy = match.y + match.height / 2;
      const startFar = Math.hypot(x1 - cx, y1 - cy) > ANNOTATION_SNAP_DISTANCE * 2;
      return {
        params: startFar ? [x1, y1, cx, cy] : [x1, y1, x2, y2],
        snapped: true,
        rect: match,
      };
    }
  }

  if (kind === "SCRIBBLE" && params.length >= 4) {
    const [x1, y1, x2, y2] = params;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const match = findNearestTextRect(
      (rect) => lineNearRect(x1, y1, x2, y2, rect),
      rects,
      { x: midX, y: midY },
    );
    if (match) {
      return {
        params: [
          match.x,
          match.y + match.height * 0.35,
          match.x + match.width,
          match.y + match.height * 0.65,
        ],
        snapped: true,
        rect: match,
      };
    }
  }

  if (narration) {
    const match = findAnchorByNarration(narration, rects);
    if (match) {
      if (kind === "UNDERLINE") {
        return { params: underlineParamsForRect(match, pad), snapped: true, rect: match };
      }
      if (kind === "CIRCLE_AROUND" || kind === "HIGHLIGHT") {
        return { params: bboxParamsForRect(match, pad), snapped: true, rect: match };
      }
      if (kind === "ARROW" && params.length >= 4) {
        const [x1, y1] = params;
        const cx = match.x + match.width / 2;
        const cy = match.y + match.height / 2;
        return { params: [x1, y1, cx, cy], snapped: true, rect: match };
      }
      if (kind === "SCRIBBLE") {
        return {
          params: [
            match.x,
            match.y + match.height * 0.35,
            match.x + match.width,
            match.y + match.height * 0.65,
          ],
          snapped: true,
          rect: match,
        };
      }
    }
  }

  return { params, snapped: false, rect: null };
}
