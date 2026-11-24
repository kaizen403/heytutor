/** Same-scale spellings already supported by mechanics angle units. */
export function mechanicsFunctionSourceUnitPattern(unit: string): string | null {
  if (unit === "rad") return "(?:rad|radians?)";
  if (unit === "deg") return "(?:deg|degrees?)";
  return null;
}

export interface MechanicsSourceSubject {
  name: string;
  index: number;
  declarationIndex: number;
  phraseStart: number;
  end: number;
}

const SUBJECT_WORD = /[\p{L}][\p{L}\p{N}_'′]*/gu;
const SUBJECT_MODIFIERS = new Set(["rigid", "uniform", "thin", "solid", "closed", "stationary", "homogeneous", "fixed", "moving", "rotating", "rolling"]);
const SUBJECT_KINDS = new Set(["rotor", "body", "rod", "disc", "disk", "ring", "sphere", "cylinder", "beam", "bar", "block", "wheel", "flywheel", "particle", "mass", "point", "clock", "surface", "plane", "frame", "system", "assembly"]);
const SUBJECT_PROPERTIES = new Set(["mass", "inertia", "radius", "length", "velocity", "acceleration", "moment", "force", "torque", "time", "gravity", "position", "center", "centre", "direction", "coefficient", "initial", "final", "angular"]);
const SUBJECT_STOPS = new Set(["has", "have", "is", "are", "of", "with", "having", "at", "on", "near", "alongside", "inside", "outside", "relative", "in", "for", "and", "while", "whereas", "by", "to", "from", "about", "around", "measured", "named"]);

function sourceNominalSubject(prefix: string, end: number): Omit<MechanicsSourceSubject, "declarationIndex"> | null {
  const head = prefix.slice(0, end);
  const boundaries = [...head.matchAll(/[;!?\n]|\.(?=\s|$)|\b(?:while|whereas|but|who|whose|whom|which|that)\b/giu)];
  let start = boundaries.at(-1) ? boundaries.at(-1)!.index! + boundaries.at(-1)![0].length : 0;
  for (const conjunction of head.matchAll(/\band\s+/giu)) {
    if (conjunction.index! < start) continue;
    const after = conjunction.index! + conjunction[0].length;
    const word = /^\s*([\p{L}][\p{L}\p{N}_'′]*)/u.exec(head.slice(after))?.[1]?.toLowerCase();
    if (word && !SUBJECT_PROPERTIES.has(word) && !["has", "have", "is", "are", "with", "having", "of"].includes(word)) start = after;
  }
  const context = /^\s*(?:in|for|as)\s+(?:(?:a|an|the)\s+)?(?:(?:separate|different|independent|new|second|third|fourth|next)\s+)?(?:comparison|case|state|scenario|experiment)\b[^,;!?\n]*,\s*/iu.exec(head.slice(start));
  if (context) start += context[0].length;
  const words = [...head.slice(start).matchAll(SUBJECT_WORD)].map(word => ({ name: word[0], index: start + word.index!, end: start + word.index! + word[0].length }));
  if (!words.length) return null;
  let current = 0;
  if (words[0]!.name.toLowerCase() === "for" && words.length > 1) current++;
  const phraseStart = words[current]!.index;
  if (["a", "an", "the"].includes(words[current]!.name.toLowerCase()) && words[current + 1] && !SUBJECT_STOPS.has(words[current + 1]!.name.toLowerCase())) current++;
  while (words[current + 1] && SUBJECT_MODIFIERS.has(words[current]!.name.toLowerCase())) current++;
  if (SUBJECT_KINDS.has(words[current]!.name.toLowerCase())) {
    while (words[current + 1] && SUBJECT_KINDS.has(words[current + 1]!.name.toLowerCase()) && /^\s+$/u.test(head.slice(words[current]!.end, words[current + 1]!.index))) current++;
    const following = words[current + 1];
    if (following && /^\s+$/u.test(head.slice(words[current]!.end, following.index)) && !SUBJECT_STOPS.has(following.name.toLowerCase()) && !SUBJECT_PROPERTIES.has(following.name.toLowerCase())) current++;
  }
  return { ...words[current]!, phraseStart };
}

/** Resolve the actual declaration subject before a proved about/around axis
 * phrase. Discarding only its terminal token can hide an unlisted other body;
 * the source subject and its original position must survive the reference.
 * Fact roles, numerical values, units and epochs remain the caller's proof.
 */
export function mechanicsSourceAxisReferenceSubject(
  prefix: string,
  actor: { index: number; name: string },
  axisLabel: string,
): MechanicsSourceSubject | null | undefined {
  if (!Number.isInteger(actor.index) || actor.index < 0 || !actor.name || !axisLabel) return undefined;
  const end = actor.index + actor.name.length, start = end - axisLabel.length;
  if (end > prefix.length || start < 0 || actor.index < start || prefix.slice(actor.index, end) !== actor.name || prefix.slice(start, end) !== axisLabel) return undefined;
  const reference = /\b(?:about|around)\s+(?:the\s+)?(?:fixed\s+)?(?:axis\s+)?$/iu.exec(prefix.slice(0, start));
  if (!reference) return undefined;
  const subject = sourceNominalSubject(prefix, reference.index);
  return subject ? { ...subject, declarationIndex: actor.index } : null;
}

const CLOCK_NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const CLOCK_UNIT = "(?:milliseconds?|seconds?|ms|s)(?![\\p{L}\\p{N}_])";
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const endsClause = (tail: string): boolean => /^\s*(?:$|[;!?]|\.(?=\s|$))/u.test(tail);

function clockClause(tail: string, variable: string): boolean {
  const clock = new RegExp(`^(?:at\\s+|time\\s+)?${escape(variable)}\\s*=\\s*${CLOCK_NUMBER}\\s*${CLOCK_UNIT}`, "iu").exec(tail.trimStart());
  if (!clock) return false;
  const after = tail.trimStart().slice(clock[0].length);
  return endsClause(after) || /^\s+(?:find|calculate|determine|compute|give|report)\b/iu.test(after);
}

/** An angle-only prefix is insufficient. Its original-source unit must end
 * at a clause boundary or an explicit source variable/axis declaration.
 * Unknown adjacent tokens cannot become prose through a missing unit alias.
 */
export function mechanicsFunctionSourceUnitTerminates(
  after: string,
  context: { variable: string; variableUnit?: "s" | "ms"; axisLabel: string },
): boolean {
  if (endsClause(after)) return true;
  if (typeof context.variable !== "string" || typeof context.axisLabel !== "string") return false;
  let tail = after.trimStart();
  if (tail.startsWith(")") && endsClause(tail.slice(1))) return true;
  // A new line alone does not terminate a wrapped physical unit. A complete
  // explicit clock/request clause supplies the missing syntactic boundary.
  if (/^[ \t]*[\r\n]/u.test(after) && clockClause(tail, context.variable)) return true;
  let separated = false;
  if (tail.startsWith(",")) { separated = true; tail = tail.slice(1).trimStart(); }
  const parenthesized = tail.startsWith("(");
  if (parenthesized) tail = tail.slice(1).trimStart();
  const axis = new RegExp(`^about\\s+(?:(?:a|the)\\s+)?(?:fixed\\s+)?(?:axis\\s+)?${escape(context.axisLabel)}(?![\\p{L}\\p{N}_])`, "iu").exec(tail);
  if (axis) {
    tail = tail.slice(axis[0].length).trimStart();
    if (!parenthesized && endsClause(tail) || parenthesized && tail.startsWith(")") && endsClause(tail.slice(1))) return true;
    if (tail.startsWith(",")) { separated = true; tail = tail.slice(1).trimStart(); }
  }
  const intro = /^(?:where|with)\s+/iu.exec(tail);
  if (intro) tail = tail.slice(intro[0].length);
  else if (!separated && !parenthesized) return false;
  const unit = context.variableUnit === "s" ? "(?:seconds?|s)" : context.variableUnit === "ms" ? "(?:milliseconds?|ms)" : null;
  if (!unit) return false;
  const declaration = new RegExp(`^${escape(context.variable)}\\s+(?:is\\s+)?(?:in|measured\\s+in)\\s+${unit}(?![\\p{L}\\p{N}_])`, "iu").exec(tail);
  if (!declaration) return false;
  tail = tail.slice(declaration[0].length).trimStart();
  if (parenthesized) {
    if (!tail.startsWith(")")) return false;
    tail = tail.slice(1).trimStart();
  }
  if (endsClause(tail)) return true;
  const next = /^and\s+/iu.exec(tail);
  if (!next) return false;
  tail = tail.slice(next[0].length);
  return clockClause(tail, context.variable) || /^is\s+(?:located\s+at|at)\s*\(/iu.test(tail);
}
