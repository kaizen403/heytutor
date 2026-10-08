/**
 * Zero-order cutoff and half-life formulas. Expectations are computed here.
 */
import { compileSceneDocument } from "../../src/compile/compiler";
import { buildOrderKineticsScene, claimsOrderKinetics } from "../../src/chemistry/orderKinetics";

const failures: string[] = [];
function check(cond: boolean, message: string): void {
  if (!cond) failures.push(message);
}

const a0 = 0.5;
const k = 0.1;
const t = 2;
check(a0 - k * t === 0.3, "zero-order concentration at 2 s");
check(a0 / (2 * k) === 2.5, "zero-order half-life");
check(a0 / k === 5, "exhaustion time");
check(Math.abs(Math.LN2 / 0.2 - 3.4657) < 1e-3, "first-order half-life");

function labelsOf(question: string): string[] | null {
  check(claimsOrderKinetics(question), `not claimed: ${question.slice(0, 60)}`);
  const document = buildOrderKineticsScene(question, [], false);
  if (!document) {
    check(false, `drew nothing: ${question.slice(0, 60)}`);
    return null;
  }
  const compiled = compileSceneDocument(document);
  check(compiled.ok, `compile failed: ${question.slice(0, 48)}`);
  if (!compiled.ok || !compiled.renderScene) return null;
  return compiled.renderScene.primitives.flatMap((primitive) =>
    primitive.kind === "label" && primitive.text ? [primitive.text] : [],
  );
}

function has(labels: string[] | null, text: string): void {
  check(labels?.includes(text) === true, `missing ${text}; got ${labels?.join(", ")}`);
}

const zero = "A zero-order reaction has [A]0 = 0.50 mol/L and k = 0.10 mol/L/s. Find [A] at t = 2.0 s and the half-life. Stop at exhaustion. Do not draw a negative concentration.";
const zeroDocument = buildOrderKineticsScene(zero, [], false);
check(zeroDocument !== null, "zero-order figure exists");
const zeroLabels = labelsOf(zero);
has(zeroLabels, "[A]=0.3");
has(zeroLabels, "t1/2=2.5 s");
has(zeroLabels, "ends t=5.0 s");
has(zeroLabels, "[A]=0");
has(zeroLabels, "no negative");
has(zeroLabels, "t (s)");
has(zeroLabels, "[A] mol/L");

if (zeroDocument) {
  const curve = zeroDocument.constructions.find((construction) => construction.operator === "function_curve");
  const axes = zeroDocument.constructions.find((construction) => construction.operator === "axes");
  check(curve !== undefined, "zero-order curve is a function_curve");
  check(axes !== undefined, "zero-order axes exist");
  const inputs = curve?.inputs ?? {};
  const expression = typeof inputs.expression === "string" ? inputs.expression : "";
  const parsed = /^([0-9.]+) - ([0-9.]+)\*x$/.exec(expression);
  check(parsed !== null, `zero-order expression is [A]0 - kt in display coordinates, got ${expression}`);
  const xMin = typeof inputs.xMin === "number" ? inputs.xMin : Number.NaN;
  const xMax = typeof inputs.xMax === "number" ? inputs.xMax : Number.NaN;
  check(xMin === 0, `curve domain starts at t = 0, got xMin ${xMin}`);
  const intercept = parsed ? Number(parsed[1]) : Number.NaN;
  const slope = parsed ? Number(parsed[2]) : Number.NaN;
  const sx = xMax / (a0 / k);
  const sy = intercept / a0;
  check(Math.abs(xMax - 10) < 1e-6, `display width stays on the exhaustion domain, got ${xMax}`);
  check(Math.abs(sy * k / sx - slope) < 1e-6, "display slope is k mapped onto the axes");
  const expectPoint = (dataT: number, conc: number, id: string): void => {
    const x = Number((dataT * sx).toFixed(4));
    const y = Number((intercept - slope * x).toFixed(4));
    check(Math.abs(y / sy - conc) < 1e-6, `${id} display height is not [${conc}]`);
    check(Math.abs(x / sx - dataT) < 1e-6, `${id} display position is not t=${dataT}`);
    const assertion = zeroDocument.assertions.find((candidate) => candidate.id === `at_${id}`);
    const expected = assertion?.expected;
    const pinned = expected !== null && typeof expected === "object" && !Array.isArray(expected)
      ? expected as { x?: unknown; y?: unknown }
      : {};
    check(assertion?.predicate === "function_value", `${id} is pinned with function_value`);
    check(pinned.x === x && pinned.y === y, `${id} pin is (${x}, ${y}), got ${JSON.stringify(expected)}`);
    check(y >= -1e-6, `${id} concentration is negative in display space`);
  };
  expectPoint(0, a0, "start");
  expectPoint(t, a0 - k * t, "asked");
  expectPoint(a0 / (2 * k), a0 / 2, "half");
  expectPoint(a0 / k, 0, "end");
  const compiled = compileSceneDocument(zeroDocument);
  check(compiled.ok && compiled.renderScene !== null, "zero-order figure compiles");
  const axisPrimitive = compiled.renderScene?.primitives.find((primitive) => primitive.kind === "axes");
  check(axisPrimitive !== undefined, "compiled axes primitive exists");
  const line = compiled.renderScene?.primitives.find((primitive) => primitive.entityId === "decay" && primitive.kind === "polyline");
  check(line !== undefined && line.points.length >= 2, "compiled curve is a polyline");
  if (line && axisPrimitive && axisPrimitive.points.length >= 4) {
    const first = line.points[0];
    const last = line.points[line.points.length - 1];
    const axisY = axisPrimitive.points[0]?.y;
    const axisX = axisPrimitive.points[2]?.x;
    const axisTop = axisPrimitive.points[3]?.y;
    const axisRight = axisPrimitive.points[1]?.x;
    check(first !== undefined && axisX !== undefined && Math.abs(first.x - axisX) < 1.5, "curve starts on the concentration axis");
    check(
      first !== undefined && axisY !== undefined && axisTop !== undefined && first.y < axisY - (axisY - axisTop) * 0.5,
      "curve starts at [A]0, above the halfway mark",
    );
    check(last !== undefined && axisY !== undefined && Math.abs(last.y - axisY) < 1.5, "curve ends on the time axis at exhaustion");
    check(last !== undefined && axisX !== undefined && axisRight !== undefined && last.x > axisX && last.x < axisRight, "exhaustion is inside the positive time axis");
    check(line.points.every((point, index) => index === 0 || point.x + 1e-6 >= line.points[index - 1]!.x), "time increases along the curve");
    check(
      axisY !== undefined && line.points.every((point) => point.y <= axisY + 1),
      "curve does not cross below the time axis into a negative concentration",
    );
    const labelAt = (text: string) => compiled.renderScene?.primitives.find((primitive) => primitive.kind === "label" && primitive.text === text);
    const zeroLabel = labelAt("[A]=0");
    const askedLabel = labelAt(`[A]=${(a0 - k * t).toFixed(2).replace(/0$/, "").replace(/\.$/, "")}`);
    const zeroPoint = zeroLabel && "points" in zeroLabel ? zeroLabel.points[0] : undefined;
    const askedPoint = askedLabel && "points" in askedLabel ? askedLabel.points[0] : undefined;
    check(zeroPoint !== undefined && axisY !== undefined && Math.abs(zeroPoint.y - axisY) < Math.abs((askedPoint?.y ?? axisY) - axisY), "[A]=0 sits nearer exhaustion than the asked concentration");
  }
}

function operatorsOf(question: string): string[] {
  const document = buildOrderKineticsScene(question, [], false);
  return document?.constructions.map((construction) => construction.operator) ?? [];
}

const compare = "Compare the half-lives. For a zero-order reaction t_half = [A]0/(2k). For a first-order reaction t_half = ln2/k. Do not use the first-order half-life for zero order.";
const compareLabels = labelsOf(compare);
has(compareLabels, "t1/2=[A]0/(2k)");
has(compareLabels, "t1/2=ln2/k");
has(compareLabels, "not the same");
check(!operatorsOf(compare).includes("function_curve"), "half-life comparison stays label-only");

const successive = "A first-order reaction has k = 0.20 /s. Show that successive half-lives are equal and do not depend on [A]0.";
const successiveLabels = labelsOf(successive);
has(successiveLabels, "t1/2=3.47 s");
has(successiveLabels, "equal t1/2");
has(successiveLabels, "not [A]0");
check(!operatorsOf(successive).includes("function_curve"), "successive half-lives stay label-only");

const negative = "For this zero-order reaction continue the plot to a negative concentration. [A]0 = 0.50 mol/L and k = 0.10 mol/L/s.";
check(claimsOrderKinetics(negative), "negative continuation is claimed");
check(buildOrderKineticsScene(negative, [], false) === null, "negative continuation declines");

const missing = "Find the half-life of a zero-order reaction with k = 0.10 mol/L/s. Stop at exhaustion.";
check(claimsOrderKinetics(missing), "missing [A]0 is claimed");
check(buildOrderKineticsScene(missing, [], false) === null, "missing [A]0 declines");

const existing = "The half life of a first order reaction is 20 min. What fraction of the reactant remains after 60 min?";
check(!claimsOrderKinetics(existing), "existing first-order probe stays on kinetics.ts");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("verify-c08a-orders: ok");
