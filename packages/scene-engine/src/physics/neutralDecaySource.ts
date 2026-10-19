/** A mathematical fraction curve, using the existing source/time reader and
 * solver. A claimed unsupported decay source is terminal before catalog
 * defaults; it is never silently described as radioactive nuclei. */
import { SceneBuilder } from "../archetypes/document";
import { kineticsFromStem, solveKinetics } from "../chemistry/kinetics";
import { chemicalKineticsContext } from "../chemistry/semanticCues";
import { chemStem } from "../chemistry/sceneKit";
import { chemistryCanonicalValuesAgree, readChemistryQuantityDeclaration } from "../chemistry/quantityReader";
import type { SceneDocument } from "../types";

interface FractionDecay {
  question: string; halfLife: number; rate: number; timeUnit: string;
  requested: { time: number; remaining: number };
}
type DecayOutcome = { status: "not_applicable" } | { status: "declined" }
  | { status: "source"; model: FractionDecay };

export function readNeutralDecaySource(question: string): DecayOutcome {
  const stem = chemStem(question);
  if (!/half[ -]?life|first[ -]?order differential equation|exponential decay/.test(stem)
    || chemicalKineticsContext(stem, question)
    || /\b(?:radioactiv\w*|isotopes?|nucl(?:eus|ei|ide)|nuclear|disintegrat\w*)\b/.test(stem)) return { status: "not_applicable" };
  // This issuer owns a first-order mathematical fraction law, not an arbitrary
  // differential equation, a mass account, or a multi-part physical process.
  if (!/\bfirst[ -]?order differential equation\b/.test(stem)
    || !/\b(?:plot|graph|show|draw)\b[^.;!?]*\bfraction remaining\b/.test(stem)
    || /[=]|\b(?:dy|df)\s*\/\s*dt\b/.test(question)) return { status: "declined" };
  const requested = readChemistryQuantityDeclaration({ question, after: /\bafter\b|\bat\s+t\s*=/,
    dimension: "time", targetUnit: "s", owner: "requested fraction time" });
  if (requested.state !== "valid") return { status: "declined" };
  const spec = kineticsFromStem(question);
  if (!spec || spec.order !== 1 || spec.arrhenius || spec.equilibriumK !== null || spec.linear
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
