/** A mathematical fraction curve, using the existing source/time reader and
 * solver. A claimed unsupported decay source is terminal before catalog
 * defaults; it is never silently described as radioactive nuclei. */
import { SceneBuilder } from "../archetypes/document";
import { explicitFunctions } from "../archetypes/slots";
import { kineticsFromStem, solveKinetics } from "../chemistry/kinetics";
import { chemicalKineticsContext } from "../chemistry/semanticCues";
import { chemStem } from "../chemistry/sceneKit";
import { chemistryCanonicalValuesAgree, readChemistryQuantityDeclaration } from "../chemistry/quantityReader";
import type { SceneDocument } from "../types";

interface FractionDecay {
  question: string; halfLife: number; rate: number; timeUnit: string;
  requested: { time: number; remaining: number };
}
type DecayOutcome = { status: "not_applicable"; explicitFunctionContext?: string[] } | { status: "declined" }
  | { status: "source"; model: FractionDecay };

function negativeArgument(question: string, start: number): boolean {
  const prefix = question.slice(0, start).split(/[;!?]|\.(?!\d)|\b(?:and|but|or|however)\b/i).at(-1) ?? "";
  return /\b(?:no|not|never|without|excluding|unrelated|irrelevant|background)(?:\s+(?:use|follow|obey|apply|assume|a|an|the|assumed))*\s*$/i.test(prefix);
}

/** An asserted law and one supported requested view are independent of the
 * material name. Neither a negated law nor another requested figure is owned. */
function normalizedFirstOrderRequested(question: string): boolean {
  const laws = [...question.matchAll(/\bfirst[ -]?order\b/gi)];
  // Every occurrence must assert this law. A later exclusion cannot be
  // discarded merely because an earlier sentence contained its positive name.
  if (!laws.length || laws.some(law => negativeArgument(question, law.index)
    || /^\s*(?:(?:process|law|model|decay|decomposition|kinetics|differential equation)\s+)?(?:(?:is|was|does|do|did|will|would|should|can|could|must)\s+(?:not|never)\b|cannot\b)/i.test(question.slice(law.index + law[0].length)))) return false;
  const views = [...question.matchAll(/\b(?:draw|plot|graph|show|sketch|represent)\s+(?:(?:only|the|a|normalized)\s+)*(?:(?:graph|curve|plot)\s+of\s+)?(?:the\s+)?(?:normalized\s+)?fraction remaining\b/gi)]
    .filter(view => !negativeArgument(question, view.index));
  if (!views.length) return false;
  const otherInk = /\b(?:molecular\s+structures?|structures?|bonds?|mechanisms?|stereoisomers?|orbitals?|apparatus|circuits?|mass|concentrations?)\b/gi;
  const requests = [...question.matchAll(/\b(?:draw|plot|graph|show|sketch|represent|mark)\b/gi)];
  for (const [index, request] of requests.entries()) {
    if (negativeArgument(question, request.index)) continue;
    const owned = views.some(view => request.index >= view.index && request.index < view.index + view[0].length);
    const timeMark = /^mark$/i.test(request[0]) && /^\s+(?:t|time)\s*=/i.test(question.slice(request.index + request[0].length));
    if (!owned && !timeMark) return false;
    const argument = question.slice(request.index + request[0].length, requests[index + 1]?.index)
      .split(/[;!?]|\.(?!\d)/, 1)[0]!;
    // One verb may request several views. Only the normalized fraction and
    // separately recognized time marks are owned; another coordinated object
    // cannot silently disappear from an otherwise valid mathematical plot.
    if (/\band\s+\S/i.test(argument)) return false;
    for (const other of argument.matchAll(otherInk)) {
      if (!negativeArgument(argument, other.index)) return false;
    }
  }
  return true;
}

export function readNeutralDecaySource(question: string): DecayOutcome {
  const stem = chemStem(question);
  if (/first[ -]?order/.test(stem) && !/half[ -]?life|\bdecay\b|fraction remaining/.test(stem)) {
    const expressions = explicitFunctions(question);
    return { status: "not_applicable", ...(expressions.length ? { explicitFunctionContext: expressions } : {}) };
  }
  if (!/half[ -]?life|first[ -]?order|exponential decay/.test(stem)
    || !/half[ -]?life|\bdecay\b|fraction remaining/.test(stem)
    || chemicalKineticsContext(stem, question)
    || /\b(?:radioactiv\w*|isotopes?|nucl(?:eus|ei|ide)|nuclear|disintegrat\w*)\b/.test(stem)) return { status: "not_applicable" };
  // This issuer owns a first-order mathematical fraction law, not an arbitrary
  // differential equation, a mass account, or a multi-part physical process.
  const assignments = new Set([...question.matchAll(/\b(?:at\s+t|mark\s+(?:t|time)|half[ -]?life|k)\s*=/gi)]
    .map(match => match.index + match[0].length - 1));
  if (!normalizedFirstOrderRequested(question)
    || [...question.matchAll(/=/g)].some(match => !assignments.has(match.index))
    || /\b(?:dy|df)\s*\/\s*dt\b/.test(question)) return { status: "declined" };
  const requested = readChemistryQuantityDeclaration({ question, after: /\bafter\b|\bat\s+t\s*=|\bmark\s+(?:t|time)\s*=/,
    dimension: "time", targetUnit: "s", owner: "requested fraction time" });
  if (requested.state !== "valid") return { status: "declined" };
  const spec = kineticsFromStem(question);
  if (!spec || spec.order !== 1 || spec.ordersNamed.some(order => order !== 1)
    || spec.k === null && spec.tHalf === null || spec.arrhenius || spec.equilibriumK !== null || spec.linear
    || spec.a0 !== null || spec.completion || spec.timesAsked.length !== 1
    || spec.fractionsAsked.length || spec.remainingAsked.length || spec.concentrationsAsked.length) return { status: "declined" };
  const solution = solveKinetics(spec);
  const mark = solution.remainingAtTimes[0];
  if (!solution.k || !solution.tHalf || !mark || ![solution.k, solution.tHalf, mark.time, mark.remaining].every(Number.isFinite)
    || !(solution.k > 0 && solution.tHalf > 0 && mark.time > 0 && mark.remaining > 0 && mark.remaining <= 1)
    || !chemistryCanonicalValuesAgree(solution.k * solution.tHalf, Math.LN2)) return { status: "declined" };
  return { status: "source", model: { question, rate: solution.k, halfLife: solution.tHalf, timeUnit: spec.timeUnit,
    requested: mark } };
}

export function buildNeutralDecayScene(question: string): SceneDocument | null {
  const read = readNeutralDecaySource(question);
  if (read.status !== "source") return null;
  const model = read.model;
  const scene = new SceneBuilder(question, "Source-derived first-order fraction remaining", "analytic_curve");
  // Time and fraction use independent explicit display scales; the geometry
  // is nonmetric. All physical times and fractions remain labels/quantities.
  const end = Math.max(3 * model.halfLife, model.requested.time) * 1.08;
  const sx = 8 / end, sy = 4.5;
  const ids = [scene.axes("fraction_axes", 0, 8.3, 0, 4.8, "time and normalized fraction axes"),
    scene.curve("fraction_curve", `${sy}*exp(-${(model.rate / sx).toPrecision(16)}*x)`, 0, 8,
      "first-order fraction remaining", "f(t)/f(0)", 129)];
  const text = (id: string, x: number, y: number, value: string, role: string): void => {
    const target = scene.helper(`${id}_anchor`, { x, y }, "plot text anchor helper");
    scene.entities.push({ id, kind: "label", role, label: value, provenance: { pinLabel: true } });
    scene.constructions.push({ id: `make_${id}`, operator: "label", inputs: { target, text: value }, outputs: [id] });
    ids.push(id);
  };
  text("time_axis", 7.5, -0.75, `time (${model.timeUnit})`, "source time unit");
  text("fraction_axis", 1, 5.3, "f(t)/f(0)", "normalized fraction");
  text("law_source", 5.5, 5.3, "First-order law", "stated mathematical law");
  const marks = [{ time: 0, remaining: 1 }, { time: model.halfLife, remaining: 0.5 },
    { time: 2 * model.halfLife, remaining: 0.25 }, model.requested]
    .filter((mark, index, all) => all.findIndex(other => Math.abs(other.time - mark.time) < 1e-9) === index);
  const cues = ["f(t)/f(0)", `time (${model.timeUnit})`];
  for (const [index, mark] of marks.entries()) {
    const x = mark.time * sx, y = mark.remaining * sy;
    const label = `${Number(mark.time.toPrecision(8))} ${model.timeUnit}: ${Number(mark.remaining.toPrecision(8))}`;
    ids.push(scene.point(`fraction_${index}`, { x, y }, "solved fraction at source time", label));
    scene.assert(`fraction_value_${index}`, "function_value", ["fraction_curve"], { x, y });
    cues.push(label);
  }
  scene.group("fraction_decay", ids, cues.join(". "));
  const document = scene.build();
  document.source = { question, synthesizedFamily: true, sourceModel: "mathematical_fraction_decay",
    displayScale: { time: sx, fraction: sy }, nonMetric: true };
  document.quantities.push({ id: "half_life", symbol: "t_half", value: model.halfLife, unit: model.timeUnit },
    { id: "rate", symbol: "k", value: model.rate, unit: `1/${model.timeUnit}` },
    { id: "requested_time", symbol: "t", value: model.requested.time, unit: model.timeUnit },
    { id: "requested_fraction", symbol: "f(t)/f(0)", value: model.requested.remaining, unit: "" });
  return document;
}
