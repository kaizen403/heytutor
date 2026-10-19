/**
 * Boat and current speeds for a river crossing, bound by role words.
 *
 * Each speed literal takes its role from the words around it: "in still
 * water" / "relative to the water" after it, or the nearest boat cue
 * (boat, swimmer, rows, swims) or river cue (river, current, stream, flows)
 * before it in the same stretch of text. Mention order never decides a role.
 * Unless exactly one boat speed and one current speed are bound, in one unit,
 * the source is unbound and no river figure is drawn.
 */
import { STEM_NUMBER, parseStemNumber, prepareStem } from "../archetypes/slots";
import { motionPlanConflicts, motionQuantityAuthority, type MotionBindings, type MotionDimension, type MotionPlanConflict, type MotionQuantityAuthority, type MotionValues } from "./motionPlanAgreement";

export interface RiverCrossingSpeeds {
  readonly status: "bound";
  /** Boat speed relative to the water, in `unit`. */
  readonly vb: number;
  /** Current speed relative to the ground, in `unit`. */
  readonly vc: number;
  readonly unit: "m/s" | "km/h";
  /** River width in metres, when the stem states one. */
  readonly widthM: number | null;
}

/** "unstated": no speed in the question, so only a qualitative sketch with symbolic labels is possible. */
export type RiverCrossingBinding = RiverCrossingSpeeds | { readonly status: "unbound" | "unstated"; readonly reason: string };

const SPEED_UNIT = String.raw`(?:km\s*\/\s*h(?:r|our)?|kmph|km\s*h(?:\^?-1|⁻¹)|m\s*\/\s*s|m\s*s(?:\^?-1|⁻¹))`;
const UNIT_END = String.raw`(?![\w²³⁻]|\s*\^)`;
const SPEED = new RegExp(`(?:\\+\\s*)?${STEM_NUMBER}\\s*(${SPEED_UNIT})${UNIT_END}`, "gi");
// Also notice unsupported speed units/expressions so they cannot turn into
// a numberless sketch, or disappear beside two supported speed quantities.
const SPEED_MENTION = /(?<![a-z])(?:(?:km|m|cm|mm|ft|feet|miles?|met(?:er|re)s?)\s*(?:\/\s*[a-z]+|per\s+(?:second|hour)s?\b)|(?:kmph|mph)\b|(?:km|m)\s*[hs]\b)/gi;
const WIDTH = new RegExp(`(?:\\+\\s*)?${STEM_NUMBER}\\s*(km|m)\\s+wide\\b|\\bwidth\\s+(?:of\\s+)?(?:the\\s+river\\s+)?(?:is\\s+|=\\s*)?(?:\\+\\s*)?${STEM_NUMBER}\\s*(km|m)${UNIT_END}`, "gi");
const WIDTH_MENTION = /(?<![a-z])(?:km|m|cm|mm|ft|feet)(?:\s*\^[-+]?\d+)?\s+wide\b|\bwidth\s+(?:of\s+)?(?:the\s+river\s+)?(?:is\s+|=\s*)?(?=[^.!?]*\b(?:km|m)\b)/gi;
const BOAT_AFTER = /^\s*(?:in|relative\s+to|with\s+respect\s+to|w\.?r\.?t\.?)\s+(?:the\s+)?(?:still|stationary|calm)\s+water\b|^\s*relative\s+to\s+(?:the\s+)?water\b/i;
const BOAT_CUE = /\b(?:still\s+water|boat|boatman|swimmer|swims?|swimming|rows?|rowing|paddles?|steamer|launch|ferry|motorboat|man|woman|boy|girl|person)\b/gi;
const RIVER_CUE = /\b(?:river|current|stream|flows?|flowing|water\s+(?:moves|runs))\b/gi;

function lastIndex(pattern: RegExp, text: string): number {
  let last = -1;
  for (const match of text.matchAll(pattern)) last = match.index ?? last;
  return last;
}

/** A supported scalar cannot be only the last operand of an expression. */
function wholeScalar(text: string, start: number): boolean {
  const before = text.slice(0, start).trimEnd();
  if (text[start] === "+" && /[\w)\]}]/.test(text[start - 1] ?? "")) return false;
  if (/[\w)\]}]\+\s*$/.test(before)) return false;
  const prefix = before.replace(/\+\s*$/, "").trimEnd();
  const addedToVariable = (text[start] === "+" || /\+\s*$/.test(before)) && /(?:^|\s)[a-zα-ω]$/i.test(prefix);
  return !addedToVariable && !/[/^*×÷π√·+-]$|[\d½¼¾)\]}]$|[\w)]\s*\($/.test(prefix);
}

export function riverCrossingSpeeds(question: string): RiverCrossingBinding {
  const text = prepareStem(question);
  const speeds = [...text.matchAll(SPEED)];
  const mentions = [...text.matchAll(SPEED_MENTION)].filter((match) => !/\b(?:in|units?\s+of)\s*$/i.test(text.slice(0, match.index)));
  if (speeds.length === 0 && mentions.length === 0) return { status: "unstated", reason: "the question states no speeds" };
  if (mentions.length !== speeds.length || speeds.some((match) => !wholeScalar(text, match.index ?? 0))) {
    return { status: "unbound", reason: "a speed quantity or unit is not supported whole" };
  }
  if (speeds.length !== 2) return { status: "unbound", reason: `expected two speeds, found ${speeds.length}` };
  const values = speeds.map((match) => parseStemNumber(match[1]!));
  if (values.some((value) => value === null || !Number.isFinite(value))) return { status: "unbound", reason: "a speed quantity is unreadable" };
  const units = speeds.map((match) => (/km/i.test(match[2]!) ? "km/h" : "m/s"));
  if (units[0] !== units[1]) return { status: "unbound", reason: "boat and current speeds use different units" };
  const roles: Array<"boat" | "river" | null> = speeds.map((match, index) => {
    const end = (match.index ?? 0) + match[0].length;
    if (BOAT_AFTER.test(text.slice(end, end + 40))) return "boat";
    const previousEnd = index === 0 ? 0 : (speeds[index - 1]!.index ?? 0) + speeds[index - 1]![0].length;
    const before = text.slice(previousEnd, match.index ?? 0);
    const boat = lastIndex(BOAT_CUE, before); const river = lastIndex(RIVER_CUE, before);
    if (boat < 0 && river < 0) return null;
    return boat > river ? "boat" : "river";
  });
  if (roles.filter((role) => role === "boat").length !== 1 || roles.filter((role) => role === "river").length !== 1) {
    return { status: "unbound", reason: "boat and current speeds are not each named by their own role words" };
  }
  const value = (role: "boat" | "river") => values[roles.indexOf(role)]!;
  const vb = value("boat"); const vc = value("river");
  if (vb <= 0 || vc < 0) return { status: "unbound", reason: "boat speed must be positive and current speed nonnegative" };
  const widths = [...text.matchAll(WIDTH)];
  const unreadWidth = [...text.matchAll(WIDTH_MENTION)].some((mention) => !widths.some((width) => mention.index! < width.index! + width[0].length && mention.index! + mention[0].length > width.index!));
  if (widths.length > 1 || unreadWidth) return { status: "unbound", reason: "the stated river width is not supported whole or unique" };
  const width = widths[0];
  const rawWidth = width?.[1] ?? width?.[3];
  const parsedWidth = rawWidth === undefined ? null : parseStemNumber(rawWidth);
  if (width && (parsedWidth === null || parsedWidth <= 0 || !wholeScalar(text, width.index! + width[0].indexOf(rawWidth!)))) {
    return { status: "unbound", reason: "the stated river width is not a positive supported scalar" };
  }
  const widthM = parsedWidth === null ? null : parsedWidth * (/km/i.test(width![2] ?? width![4]!) ? 1000 : 1);
  if (widthM !== null && !Number.isFinite(widthM)) return { status: "unbound", reason: "the river width exceeds the supported numeric range" };
  return { status: "bound", vb, vc, unit: units[0] as "km/h" | "m/s", widthM };
}

/** Shortest path: head upstream so the boat lands directly opposite. */
export function riverShortestPathAsked(question: string): boolean {
  return /\b(?:shortest (?:path|route|distance)|straight across|directly (?:opposite|across)|exactly opposite|(?:point|bank) directly opposite|zero drift|without drift|no drift)\b/i.test(question);
}

/** Shortest time: head along the bank normal and drift downstream. */
export function riverShortestTimeAsked(question: string): boolean {
  return /\b(?:(?:shortest|minimum|least|minimal) time|as (?:quickly|soon) as possible|quickest)\b/i.test(question);
}

/**
 * Speeds, heading angles and (with a stated width) times and drift the
 * figure implies, SI. When the question asks only for the shortest path or
 * only for the shortest time, the other crossing's numbers are not allowed:
 * the shortest-time crossing time is the stale answer to a shortest-path
 * question, not a supporting value.
 */
export function riverCrossingValues(speeds: RiverCrossingSpeeds, question = ""): MotionValues {
  const path = riverShortestPathAsked(question); const quick = riverShortestTimeAsked(question);
  const both = path === quick;
  const k = speeds.unit === "km/h" ? 1000 / 3600 : 1;
  const vb = speeds.vb * k; const vc = speeds.vc * k;
  const deg = 180 / Math.PI;
  const velocity = [vb, vc, vb + vc, Math.abs(vb - vc)];
  const angle: number[] = [];
  const time: number[] = [];
  const w = speeds.widthM;
  const length: number[] = w === null ? [] : [w];
  if (both || quick) {
    const drift = Math.atan2(vc, vb) * deg;
    velocity.push(Math.hypot(vb, vc));
    angle.push(drift, 90 - drift, 90 + drift);
    if (w !== null) { time.push(w / vb); length.push((vc * w) / vb, Math.hypot(w, (vc * w) / vb)); }
  }
  if ((both || path) && vb > vc) {
    const heading = Math.asin(vc / vb) * deg;
    velocity.push(Math.sqrt(vb * vb - vc * vc));
    angle.push(heading, 90 - heading, 90 + heading);
    if (w !== null) time.push(w / Math.sqrt(vb * vb - vc * vc));
  }
  return { velocity, angle, ...(w === null ? {} : { time, length }) };
}

const BOAT_SYMBOLS = new Set(["vb", "vboat", "boatspeed", "vbw", "vbinstillwater", "vswimmer"]);
const RIVER_SYMBOLS = new Set(["vc", "vriver", "vcurrent", "riverspeed", "vstream", "vw", "vwater"]);

/**
 * Plan values outside the figure's values, plus a plan that names the boat
 * or current speed by its symbol but gives the other role's value (a swap).
 */
export function riverCrossingPlanConflicts(speeds: RiverCrossingSpeeds, turnPlan: unknown, question: string): MotionPlanConflict[] {
  return motionPlanConflicts(turnPlan, riverCrossingValues(speeds, question), question, riverCrossingBindings(speeds, question));
}

/**
 * River crossing authority: corrects the boat and current speeds (bound by
 * symbol) and the crossing time when the question asks for exactly one
 * crossing and states the width. Angles and drift have several conventions
 * (bank, normal, current), so a conflicting angle or length is withdrawn,
 * never rewritten.
 */
function riverCrossingBindings(speeds: RiverCrossingSpeeds, question: string): MotionBindings {
  const k = speeds.unit === "km/h" ? 1000 / 3600 : 1;
  const vb = speeds.vb * k; const vc = speeds.vc * k;
  const bound = new Map<string, { dimension: MotionDimension; si: number }>();
  for (const name of BOAT_SYMBOLS) bound.set(name, { dimension: "velocity", si: vb });
  for (const name of RIVER_SYMBOLS) bound.set(name, { dimension: "velocity", si: vc });
  if (/\b(?:downstream|upstream)\b/i.test(question) && vb > vc) {
    for (const name of ["vdown", "vdownstream"]) bound.set(name, { dimension: "velocity", si: vb + vc });
    for (const name of ["vup", "vupstream"]) bound.set(name, { dimension: "velocity", si: vb - vc });
  }
  const path = riverShortestPathAsked(question); const quick = riverShortestTimeAsked(question);
  if (speeds.widthM !== null && path !== quick && (quick || vb > vc)) {
    const time = quick ? speeds.widthM / vb : speeds.widthM / Math.sqrt(vb * vb - vc * vc);
    for (const name of ["t", "tcross", "tcrossing", "tmin", "tminimum"]) bound.set(name, { dimension: "time", si: time });
  }
  return bound;
}

export function applyRiverCrossingAuthority(question: string, turnPlan: unknown): MotionQuantityAuthority | null {
  if (!/\b(?:boat|still water)\b/i.test(question) || !/\b(?:river|current|stream|downstream|upstream|still water)\b/i.test(question) || /\b(?:rain|umbrella)\b/i.test(question)) return null;
  const speeds = riverCrossingSpeeds(question);
  if (speeds.status !== "bound") return null;
  return motionQuantityAuthority(question, turnPlan, riverCrossingPlanConflicts(speeds, turnPlan, question), riverCrossingBindings(speeds, question));
}
