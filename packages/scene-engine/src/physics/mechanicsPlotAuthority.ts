import type { SceneConstruction, SceneDocument, SceneIssue } from "../types";
import type { MechanicsGeometry } from "../compile/mechanicsGeometry";
import { mechanicsUnitFactor } from "../compile/mechanicsGeometry";
import type { MechanicsProgramStep } from "../ir/mechanicsProgram";
import { parseMathExpression } from "../math/expression";

export interface MechanicsPlotBinding {
  outputId: string;
  axesId: string;
  modelOutputId: string;
  requestId: string;
  stepId: string;
  ownerId: string;
  axisId?: string;
  observable: "theta" | "inertia" | "torque";
  xUnit: string;
  yUnit: string;
}
export interface MechanicsPlotModel {
  requestId: string;
  step: MechanicsProgramStep;
  geometry: MechanicsGeometry;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(message: string): never { throw new Error(message); }
const ERROR = 128 * Number.EPSILON;
const same = (a: number, b: number): boolean => a === b || a !== 0 && b !== 0 && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= ERROR * Math.max(Math.abs(a), Math.abs(b));
function title(raw: unknown, unit: string, dimension: string): string {
  const match = typeof raw === "string" ? /^\s*(.*?)\s*[([]\s*([^()[\]]+)\s*[)\]]\s*$/.exec(raw) : null;
  if (!match || mechanicsUnitFactor(match[2]!, dimension) !== mechanicsUnitFactor(unit, dimension)) fail("mechanics plot units must agree with the actual labelled axes");
  return match[1]!.trim();
}

/** Engine-internal: models must already pass complete original-source replay. */
export function validateMechanicsPlotSourceBinding(document: SceneDocument, models: ReadonlyMap<string, MechanicsPlotModel>, number: (value: unknown) => number): SceneIssue[] {
  const curves = document.constructions.filter(construction => ["function_curve", "parametric_curve", "implicit_curve", "polar_curve"].includes(construction.operator));
  if (!curves.length) return [];
  const issue = (message: string, construction?: SceneConstruction): SceneIssue => ({ code: "mechanics_plot_source_mismatch", message, severity: "fatal", failureKind: "truth", constructionId: construction?.id, path: construction ? `constructions[${document.constructions.indexOf(construction)}]` : "source.mechanicsPlotBindings", entityIds: construction?.outputs });
  const bindings = document.source.mechanicsPlotBindings;
  if (!Array.isArray(bindings) || bindings.length > 256) return [issue("every mechanical function plot requires its complete source law and axes selector")];
  const byOutput = new Map(document.constructions.flatMap(construction => construction.outputs.map(output => [output, construction] as const)));
  const bound = new Set<string>(), coverage = new Map<string, Set<number>>(), impulses = new Map<string, number>();
  const issues: SceneIssue[] = [];
  for (const binding of bindings) {
    let construction: SceneConstruction | undefined;
    try {
      if (!record(binding) || Object.keys(binding).some(key => !["outputId", "axesId", "modelOutputId", "requestId", "stepId", "ownerId", "axisId", "observable", "xUnit", "yUnit"].includes(key)) || !["outputId", "axesId", "modelOutputId", "requestId", "stepId", "ownerId", "xUnit", "yUnit"].every(key => typeof binding[key] === "string" && String(binding[key]).length <= 128) || binding.axisId !== undefined && typeof binding.axisId !== "string" || !["theta", "inertia", "torque"].includes(String(binding.observable))) fail("plot records select source laws, never stamps or sampled-point proofs");
      construction = byOutput.get(String(binding.outputId));
      const axes = byOutput.get(String(binding.axesId)), selected = models.get(String(binding.modelOutputId));
      if (!construction || construction.operator !== "function_curve" || construction.outputs.length !== 1 || bound.has(String(binding.outputId)) || !axes || axes.operator !== "axes" || axes.outputs.length !== 1 || construction.inputs.axes !== binding.axesId || !selected || binding.requestId !== selected.requestId || binding.stepId !== selected.step.id || binding.ownerId !== selected.step.ownerId || binding.axisId !== undefined && binding.axisId !== selected.step.axisId) fail("plot must preserve its source model owner/reference and actual axes dependency");
      bound.add(String(binding.outputId));
      const geometry = selected.geometry;
      if (geometry.kind !== "point" || !geometry.mechanicsModel) fail("plot parent must retain its complete native source model");
      const model = geometry.mechanicsModel;
      const source = model.source as unknown as Record<string, unknown>;
      const xUnit = String(binding.xUnit), yUnit = String(binding.yUnit), observable = String(binding.observable);
      const dimension = observable === "theta" ? "angle" : observable === "inertia" ? "inertia" : "torque";
      const xScale = mechanicsUnitFactor(xUnit, "time"), yScale = mechanicsUnitFactor(yUnit, dimension);
      if (!/^(?:t|time)$/i.test(title(axes.inputs.xLabel, xUnit, "time"))) fail("mechanical law x axis must name time");
      const yName = title(axes.inputs.yLabel, yUnit, dimension);
      const names = observable === "theta" ? /^(?:theta(?:\(t\))?|θ(?:\(t\))?|angular\s+position)$/i : observable === "inertia" ? /^(?:I(?:\(t\))?|inertia)$/ : /^(?:tau(?:_z)?|τ(?:_z)?|torque)$/i;
      if (!names.test(yName)) fail("plot y-axis observable must be the selected source law");
      const xMin = number(construction.inputs.xMin), xMax = number(construction.inputs.xMax), axisMin = number(axes.inputs.xMin), axisMax = number(axes.inputs.xMax);
      if (!(xMin < xMax) || !(axisMin < axisMax) || !(number(axes.inputs.yMin) < number(axes.inputs.yMax)) || typeof construction.inputs.expression !== "string") fail("source plot requires explicit finite ordered domains and its actual function");
      const expression = parseMathExpression(construction.inputs.expression);
      expression.assertContinuousOn(xMin, xMax);
      if (observable !== "torque") {
        const law = observable === "theta" ? source.angularLaw : source.inertiaLaw;
        if (!record(law) || typeof law.expression !== "string" || law.timeScale !== xScale || (observable === "theta" ? law.angleScale : law.inertiaScale) !== yScale) fail("direct plot must retain the source function and time/value units; derivative or unproved conversion curves decline");
        if (parseMathExpression(law.expression).syntaxKey !== expression.syntaxKey || !same(xMin, axisMin) || !same(xMax, axisMax)) fail("a mechanical curve must preserve the complete source AST and plotted domain, not matching endpoints");
        if (observable === "inertia") {
          const initial = typeof law.initialAt === "number" ? law.initialAt / xScale : NaN, at = typeof law.at === "number" ? law.at / xScale : NaN;
          if (!same(xMin, Math.min(initial, at)) || !same(xMax, Math.max(initial, at))) fail("inertia-law plot must retain the complete verified source time interval");
        }
      } else {
        const syntax = JSON.parse(expression.syntaxKey);
        const variable = (value: unknown): boolean => record(value) && (value.kind === "variable" || Object.values(value).some(variable)) || Array.isArray(value) && value.some(variable);
        if (variable(syntax)) fail("a constant torque interval cannot be replaced by a same-endpoint varying function");
        const value = expression.evaluate(0) * yScale;
        let segments: Array<{ start: number; end: number; torque: number }>;
        if (model.kind === "angular_impulse" && Array.isArray(source.segments)) segments = source.segments as typeof segments;
        else if (model.kind === "axial_rotation" && source.mode === "constant_inertia" && typeof source.time === "number" && typeof source.torque === "number") segments = [{ start: 0, end: source.time, torque: source.torque }];
        else return fail("torque history requires explicit complete source intervals or verified constant torque duration");
        const index = segments.findIndex(segment => same(xMin * xScale, segment.start) && same(xMax * xScale, segment.end) && same(value, segment.torque));
        const key = String(binding.modelOutputId), seen = coverage.get(key) ?? new Set<number>();
        if (index < 0 || seen.has(index)) fail("torque rectangle must preserve its exact source interval, sign and full height");
        const min = Math.min(...segments.map(segment => segment.start)), max = Math.max(...segments.map(segment => segment.end));
        if (!same(axisMin * xScale, min) || !same(axisMax * xScale, max)) fail("torque-time axes must retain the complete declared interval set");
        seen.add(index); coverage.set(key, seen); impulses.set(key, segments.length);
      }
    } catch (error) { issues.push(issue(error instanceof Error ? error.message : "mechanical plot source replay failed", construction)); }
  }
  for (const curve of curves) if (!curve.outputs.every(output => bound.has(output))) issues.push(issue("generic mechanical curves require full source law/units/domain authority even when their origin helper is unrelated to the hidden model", curve));
  for (const [key, count] of impulses) if (coverage.get(key)?.size !== count) issues.push(issue("a drawn torque history must retain every declared source interval exactly once"));
  return issues;
}
