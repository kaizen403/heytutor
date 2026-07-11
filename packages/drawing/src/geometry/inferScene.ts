import type { SceneKind, SceneSpec } from "./sceneSpec";
import { parseOpticsNumbers } from "../templates/opticsPrecision";

/**
 * Local heuristic SceneSpec when the planner LLM fails or for domain shortcuts.
 * Enough for optics/circuit/euclidean/axes plugins to compile without pixels.
 */
export function inferSceneFromQuestion(question: string): SceneSpec | null {
  const q = question.trim();
  if (q.length < 8) return null;

  const optics = inferOptics(q);
  if (optics) return optics;

  const circuit = inferCircuit(q);
  if (circuit) return circuit;

  const axes = inferAxesPlot(q);
  if (axes) return axes;

  const euclidean = inferEuclidean(q);
  if (euclidean) return euclidean;

  const fbd = inferFbd(q);
  if (fbd) return fbd;

  const incline = inferIncline(q);
  if (incline) return incline;

  return null;
}

function base(
  kind: SceneKind,
  diagramType: string,
  promptAddon: string,
  extras: Partial<SceneSpec> = {},
): SceneSpec {
  return {
    kind,
    diagramType,
    entities: extras.entities ?? [{ id: "frame", type: "group", role: "ground" }],
    constraints: extras.constraints ?? [],
    quantities: extras.quantities,
    givens: extras.givens ?? [],
    asks: extras.asks ?? [],
    introNarration: extras.introNarration ?? `here is the ${diagramType.replace(/_/g, " ")} on the board.`,
    promptAddon,
    allowAdditions: extras.allowAdditions,
  };
}

function inferOptics(q: string): SceneSpec | null {
  if (
    !/\b(?:lens|mirror|prism|focal|optics|refraction|TIR|critical\s+angle|object\s+distance|magnification)\b/i.test(
      q,
    )
  ) {
    return null;
  }

  const nums = parseOpticsNumbers(q);
  const quantities: Record<string, number> = {};
  if (nums.u != null) quantities.u_cm = nums.u;
  if (nums.v != null) quantities.v_cm = nums.v;
  if (nums.f != null) quantities.f_cm = nums.f;
  if (nums.R != null) quantities.R_cm = nums.R;

  const isCombo =
    /two\s+(?:thin\s+)?lenses|lens\s+combo|combination\s+of\s+(?:thin\s+)?lenses|equivalent\s+focal|in\s+contact\s+with\s+(?:a\s+)?(?:concave|convex)\s+lens|convex\s+lens[\s\S]{0,80}concave\s+lens|concave\s+lens[\s\S]{0,80}convex\s+lens/i.test(
      q,
    );
  const isMirror =
    !isCombo &&
    /\bmirror\b|concave\s+mirror|convex\s+mirror|radius\s+of\s+curvature/i.test(q);

  const diagramType = isCombo
    ? "optics_lens_combo"
    : isMirror
      ? "optics_mirror"
      : /\bprism\b/i.test(q)
        ? "optics_prism"
        : "optics_lens";

  return base("optics", diagramType, "optics diagram — do NOT redraw the skeleton.", {
    quantities,
    entities: [
      { id: "optic", type: "group", role: "optic" },
      { id: "axis", type: "line", role: "axis" },
      { id: "object", type: "arrow", role: "object" },
      { id: "F", type: "point", role: "focus" },
    ],
    allowAdditions: ["ray"],
    introNarration: "here is the ray optics setup with the measured marks.",
  });
}

function inferCircuit(q: string): SceneSpec | null {
  if (!/\b(?:resistor|circuit|ohm|Ω|battery|wheatstone|capacitor|series|parallel)\b/i.test(q)) {
    return null;
  }
  return base("circuit", "circuit", "circuit diagram — do NOT redraw the skeleton.", {
    entities: [
      { id: "battery", type: "rect", role: "component" },
      { id: "R1", type: "group", role: "component" },
    ],
    introNarration: "here is the circuit on the board.",
  });
}

function inferAxesPlot(q: string): SceneSpec | null {
  if (
    !/\b(?:graph|plot|axes|parabola|projectile|derivative|maxima|minima|mark\s+(?:the\s+)?point|y\s*=)\b/i.test(
      q,
    )
  ) {
    return null;
  }
  const kind: SceneKind = /\bprojectile\b/i.test(q) ? "projectile" : "axes_plot";
  return base(kind, kind, "axes plot — do NOT redraw the axes or curve.", {
    entities: [
      { id: "origin", type: "point", role: "center", attrs: { x: 0, y: 0 } },
      { id: "curve", type: "curve", role: "object" },
      { id: "P", type: "point", text: "P", attrs: { x: 2, y: 1.5 } },
    ],
    introNarration: "here are the axes and the curve on the board.",
  });
}

function inferEuclidean(q: string): SceneSpec | null {
  if (
    !/\b(?:triangle|circle|perpendicular|bisector|intersect|equilateral|isosceles|chord|radius|circum)\b/i.test(
      q,
    )
  ) {
    return null;
  }

  return base("euclidean", "euclidean", "geometry construction — do NOT redraw the figure.", {
    entities: [
      { id: "A", type: "point", role: "object" },
      { id: "B", type: "point", role: "object" },
      { id: "C", type: "point", role: "object" },
      { id: "AB", type: "segment", from: "A", to: "B" },
      { id: "BC", type: "segment", from: "B", to: "C" },
      { id: "CA", type: "segment", from: "C", to: "A" },
      { id: "labelA", type: "label", from: "A", text: "A" },
      { id: "labelB", type: "label", from: "B", text: "B" },
      { id: "labelC", type: "label", from: "C", text: "C" },
    ],
    constraints: [
      { type: "distance", entities: ["A", "B"], value: 220 },
      { type: "distance", entities: ["B", "C"], value: 200 },
      { type: "distance", entities: ["C", "A"], value: 180 },
    ],
    introNarration: "here is the geometric figure on the board.",
  });
}

function inferFbd(q: string): SceneSpec | null {
  if (
    !/\b(?:free[\s-]?body|fbd|force\s+diagram|draw\s+(?:the\s+)?forces)\b/i.test(q) &&
    !(/\b(?:friction|normal\s+force|tension|weight)\b/i.test(q) && /\b(?:block|mass|body)\b/i.test(q))
  ) {
    return null;
  }
  if (/\b(?:incline|inclined\s+plane|ramp)\b/i.test(q)) {
    return inferIncline(q);
  }
  return base("fbd", "fbd", "free-body diagram — do NOT redraw the object or force arrows.", {
    entities: [
      { id: "block", type: "rect", role: "object" },
      { id: "weight", type: "arrow", role: "force", text: "mg" },
      { id: "normal", type: "arrow", role: "force", text: "N" },
    ],
    introNarration: "here is the free-body diagram on the board.",
  });
}

function inferIncline(q: string): SceneSpec | null {
  if (!/\b(?:incline|inclined\s+plane|ramp|slope)\b/i.test(q)) return null;
  const angleMatch = q.match(/(\d+(?:\.\d+)?)\s*°|\b(\d+(?:\.\d+)?)\s*deg(?:ree)?s?\b/i);
  const angle = angleMatch ? Number(angleMatch[1] ?? angleMatch[2]) : 30;
  return base("incline", "incline_fbd", "incline diagram — do NOT redraw the triangle or block.", {
    quantities: { angle_deg: angle },
    entities: [
      { id: "ground", type: "segment", role: "ground" },
      { id: "block", type: "rect", role: "object" },
    ],
    introNarration: `here is a block on a ${angle} degree incline.`,
  });
}
