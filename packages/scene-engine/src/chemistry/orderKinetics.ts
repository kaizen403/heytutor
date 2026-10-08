/**
 * Zero-order cutoff and the two half-life formulas.
 *
 * [A] = [A]0 - kt stops at exhaustion. A first-order half-life is ln 2 / k
 * and does not depend on [A]0. The existing first-order decay probes stay
 * on kinetics.ts.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, round, type ChemPlanQuantity } from "./sceneKit";

const FAMILY = "chem_kinetics";

function board(question: string, reason: string, labels: readonly string[], caption: string): SceneDocument | null {
  const unique: string[] = [];
  for (const label of labels) {
    if (!unique.includes(label)) unique.push(label);
  }
  if (unique.length < 1 || unique.length > 6) return null;
  if (unique.some((label) => label.length < 1 || label.length > 16)) return null;
  const scene = new ChemScene(question, reason, FAMILY);
  const ids = unique.map((label, index) => scene.text(`row${index}`, { x: 0.2, y: 2.6 - index * 0.8 }, label, "order result"));
  scene.scene.group("result", ids, `${reason}. ${unique.join(", ")}.`);
  return scene.build({ caption });
}

function handsOff(stem: string): boolean {
  if (/50\s*%[^.]{0,40}120\s*min/.test(stem)) return true;
  if (/half life[^.]{0,40}20\s*min/.test(stem)) return true;
  if (/6\.93\s*x?\s*10\s*\^?\(?\s*-?\s*3/.test(stem)) return true;
  if (/2\.3\s*x?\s*10\s*\^?\(?\s*-?\s*3/.test(stem)) return true;
  if (/300\s*k[^.]{0,80}310\s*k/.test(stem)) return true;
  if (/arrhenius|collision|activation energy/.test(stem)) return true;
  if (/d\[/.test(stem) && /dt/.test(stem)) return true;
  return false;
}

function zeroOrder(stem: string): boolean {
  return /zero[ -]?order|0th[ -]?order|order\s*(?:=|is)\s*0\b/.test(stem);
}

function firstOrder(stem: string): boolean {
  return /first[ -]?order|1st[ -]?order/.test(stem);
}

/** True when this module owns the stem, including honest declines. */
export function claimsOrderKinetics(question: string): boolean {
  const stem = chemStem(question);
  if (!stem.trim() || handsOff(stem)) return false;
  if (zeroOrder(stem) && /exhaust|negative concentration|do not draw a negative|stop at/.test(stem)) return true;
  if (zeroOrder(stem) && firstOrder(stem) && /half[ -]?lives?|\bln\s*2\b/.test(stem)) return true;
  if (firstOrder(stem) && /successive/.test(stem) && /half[ -]?lives?/.test(stem) && !zeroOrder(stem)) return true;
  return false;
}

function readNumber(stem: string, pattern: RegExp): number | null {
  const match = pattern.exec(stem);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function measure(value: number): string {
  const text = value.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
  return text;
}

function placedResultLabels(
  labels: readonly string[],
  marks: readonly { id: string; x: number; y: number }[],
  xMax: number,
): Array<{ text: string; x: number; y: number }> {
  const at = (id: string) => marks.find((mark) => mark.id === id);
  return labels.map((text, index) => {
    const asked = at("asked");
    const half = at("half");
    if (text.startsWith("[A]=") && text !== "[A]=0" && asked) {
      return { text, x: round(asked.x + 0.45), y: round(asked.y + 0.7) };
    }
    if (text.startsWith("t1/2=") && half) {
      return { text, x: round(half.x + 0.55), y: round(half.y + 0.7) };
    }
    if (text === "[A]=0") return { text, x: round(xMax - 1.7), y: 0.55 };
    if (text.startsWith("ends ")) return { text, x: round(xMax - 2.6), y: 1.2 };
    if (text === "no negative") return { text, x: round(xMax - 2.6), y: 1.85 };
    return { text, x: 7.2, y: round(5.5 - index * 0.6) };
  });
}

/** Display span for [A] versus t. Data map: x = t * (PLOT_X / tEnd), y = [A] * (PLOT_Y / [A]0). */
const PLOT_X = 10;
const PLOT_Y = 6;

/**
 * [A](t) = [A]0 - kt on 0 ≤ t ≤ [A]0/k. The line ends at exhaustion.
 * Display scale keeps the decline readable; function_value pins the mapped chemistry points.
 */
function zeroOrderFigure(
  question: string,
  a0: number,
  k: number,
  asked: number | null,
  labels: readonly string[],
): SceneDocument | null {
  if (labels.some((label) => label.length < 1 || label.length > 16)) return null;
  const tEnd = a0 / k;
  const tHalf = a0 / (2 * k);
  const sx = PLOT_X / tEnd;
  const sy = PLOT_Y / a0;
  const intercept = round(sy * a0);
  const slope = round((sy * k) / sx);
  if (!(intercept > 0) || !(slope > 0)) return null;
  let xMax = round(Math.min(PLOT_X, intercept / slope));
  if (intercept - slope * xMax < 0) xMax = round(xMax - 0.0001);
  const yEnd = intercept - slope * xMax;
  if (!(xMax > 0) || yEnd < -1e-6) return null;
  const yAt = (x: number): number => round(intercept - slope * x);
  const scene = new ChemScene(question, "zero order stops when the reactant is exhausted", FAMILY);
  const expression = `${intercept} - ${slope}*x`;
  scene.scene.axes("axes", -0.55, xMax + 1.15, -0.55, intercept + 0.95, "concentration-time axes");
  scene.scene.curve("decay", expression, 0, xMax, "zero-order concentration", undefined, 17);
  const marks: Array<{ id: string; x: number; y: number; role: string }> = [
    { id: "start", x: 0, y: yAt(0), role: "initial concentration" },
    ...(asked === null ? [] : [{
      id: "asked",
      x: round(asked * sx),
      y: yAt(round(asked * sx)),
      role: "concentration at the asked time",
    }]),
    { id: "half", x: round(tHalf * sx), y: yAt(round(tHalf * sx)), role: "half-life" },
    { id: "end", x: xMax, y: yAt(xMax), role: "exhaustion" },
  ];
  if (marks.some((mark) => mark.y < -1e-6 || mark.x < -1e-6 || mark.x - xMax > 1e-6)) return null;
  for (const mark of marks) {
    scene.scene.point(mark.id, { x: mark.x, y: mark.y }, mark.role);
    const entity = scene.scene.entities.find((candidate) => candidate.id === mark.id);
    if (entity) entity.provenance = { ...(entity.provenance ?? {}), pointStyle: "filled" };
    scene.scene.assert(`at_${mark.id}`, "function_value", ["decay"], { x: mark.x, y: mark.y });
  }
  const timeLabel = "t (s)";
  const concLabel = "[A] mol/L";
  const ids = [
    "axes",
    "decay",
    ...marks.map((mark) => mark.id),
    scene.text("time_axis", { x: xMax + 0.2, y: -0.2 }, timeLabel, "time axis"),
    scene.text("conc_axis", { x: 0.2, y: intercept + 0.45 }, concLabel, "concentration axis"),
    ...placedResultLabels(labels, marks, xMax).map((label, index) => scene.text(
      `row${index}`,
      { x: label.x, y: label.y },
      label.text,
      "order result",
    )),
  ];
  scene.scene.group(
    "plot",
    ids,
    `The axes are ${timeLabel} and ${concLabel}. The line reads ${labels.join(", ")}.`,
  );
  scene.scene.quantity("A0", "[A]0", a0, "mol/L");
  scene.scene.quantity("k", "k", k, "mol/L/s");
  if (asked !== null) {
    scene.scene.quantity("t", "t", asked, "s");
    scene.scene.quantity("A", "[A]", Math.max(0, a0 - k * asked), "mol/L");
  }
  scene.scene.quantity("tHalf", "t1/2", tHalf, "s");
  scene.scene.quantity("tEnd", "t_end", tEnd, "s");
  return scene.build({
    caption: `Zero order: [A] = [A]0 - kt from t = 0 until exhaustion at t = ${measure(tEnd)} s. The line stops there and does not enter a negative concentration.`,
  });
}

export function buildOrderKineticsScene(
  question: string,
  quantities: ChemPlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  void quantities;
  void schematic;
  if (!claimsOrderKinetics(question)) return null;
  const stem = chemStem(question);
  if (/negative concentration/.test(stem) && /continue|draw the negative|plot below zero/.test(stem)) return null;
  if (/k\s*=\s*-/.test(stem) || /k\s*<=\s*0/.test(stem)) return null;

  if (zeroOrder(stem) && firstOrder(stem)) {
    return board(
      question,
      "zero-order and first-order half-lives are different formulas",
      ["t1/2=[A]0/(2k)", "t1/2=ln2/k", "not the same"],
      "Zero order: t_half = [A]0 / (2k), so it depends on the initial concentration. First order: t_half = ln 2 / k, which does not. The constant first-order half-life is not used for zero order.",
    );
  }

  if (firstOrder(stem) && /successive/.test(stem) && /half[ -]?lives?/.test(stem)) {
    const k = readNumber(stem, /k\s*=\s*(\d+(?:\.\d+)?)/);
    if (k === null) return null;
    if (!(k > 0)) return null;
    const half = Math.LN2 / k;
    const label = `t1/2=${measure(half)} s`;
    if (label.length > 16) return null;
    return board(
      question,
      "successive first-order half-lives are equal",
      [label, "equal t1/2", "not [A]0"],
      `First order: t_half = ln 2 / k = ${half.toFixed(3)} s. Each successive half-life is the same and does not depend on [A]0.`,
    );
  }

  if (!zeroOrder(stem)) return null;
  const a0 = readNumber(stem, /\[a\]0\s*=\s*(\d+(?:\.\d+)?)/);
  const k = readNumber(stem, /k\s*=\s*(\d+(?:\.\d+)?)/);
  if (/half[ -]?life/.test(stem) && a0 === null) return null;
  if (a0 === null || k === null) return null;
  if (!(a0 > 0) || !(k > 0)) return null;
  const t = readNumber(stem, /\bt\s*=\s*(\d+(?:\.\d+)?)/);
  const labels = [`t1/2=${measure(a0 / (2 * k))} s`, `ends t=${measure(a0 / k)} s`, "[A]=0", "no negative"];
  const asked = t;
  if (asked !== null) {
    const left = a0 - k * asked;
    if (left < -1e-9) return null;
    labels.unshift(`[A]=${measure(Math.max(0, left))}`);
  }
  return zeroOrderFigure(question, a0, k, asked, labels);
}
