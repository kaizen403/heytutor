import type { MotionCallerProgramme, MotionRole } from "./relativeMotionCallerAuthority";
import { evaluateMotionArithmetic, readMotionArithmetic, sameMotionFormula } from "./relativeMotionAlgebra";
import { motionSymbolKey, motionUnitFactor } from "./motionPlanAgreement";
import { motionRationalNumber } from "./relativeMotionSource";
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const number = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
const unit = "(?:km/h|km/hr|kmph|m/s|m|km|s)";
function variables(programme: MotionCallerProgramme): Map<string, number> {
  const result = new Map<string, number>();
  for (const [key, role] of programme.roles)
    result.set(key, role.si);
  return result;
}
function arithmetic(text: string, programme: MotionCallerProgramme): number {
  const normalized = text.replace(/([A-Za-z][A-Za-z0-9_]*)/g, name => motionSymbolKey(name));
  return evaluateMotionArithmetic(readMotionArithmetic(normalized), variables(programme));
}
function measured(text: string): {
  value: number;
  dimension: string;
} | null {
  const match = new RegExp(`^(${number})\\s*(${unit})$`, "i").exec(text.trim());
  const conversion = match && motionUnitFactor(match[2]);
  return match && conversion ? { value: Number(match[1]) * conversion.factor, dimension: conversion.dimension } : null;
}
function roleValue(text: string, role: MotionRole, programme: MotionCallerProgramme): boolean {
  const measurement = measured(text);
  if (measurement)
    return measurement.dimension === role.dimension && near(measurement.value, role.si);
  return near(arithmetic(text, programme), role.si);
}
function equation(text: string, programme: MotionCallerProgramme): boolean {
  const parts = text.trim().split(/\s*=\s*/);
  if (parts.length < 2)
    return false;
  const first = programme.roles.get(motionSymbolKey(parts[0]));
  let dimension = first?.dimension;
  let expected = first?.si;
  // Literal conversion chains use SI at the ends, and the canonical SI
  // arithmetic in the middle. The named role, when present, remains binding.
  for (const part of parts) {
    const measurement = measured(part);
    const role = programme.roles.get(motionSymbolKey(part));
    const trailing = new RegExp(`^(.+?)\\s+(${unit})$`, "i").exec(part);
    let value: number;
    if (measurement) {
      value = measurement.value;
      if (dimension && measurement.dimension !== dimension)
        return false;
      dimension = measurement.dimension as typeof dimension;
    }
    else if (role) {
      value = role.si;
      if (dimension && role.dimension !== dimension)
        return false;
      dimension = role.dimension;
    }
    else if (trailing) {
      const conversion = motionUnitFactor(trailing[2]);
      if (!conversion)
        return false;
      value = arithmetic(trailing[1]!, programme) * conversion.factor;
      if (dimension && conversion.dimension !== dimension)
        return false;
      dimension = conversion.dimension;
    }
    else
      value = arithmetic(part, programme);
    if (expected === undefined)
      expected = value;
    if (!near(value, expected))
      return false;
  }
  // A true arithmetic tautology about foreign values is still an unsupported
  // obligation. Every numeric leaf must belong to the owning source programme
  // or its exact SI conversion (1000/3600 only in that conversion).
  const numbers = [...text.matchAll(/(?<![A-Za-z_])(?:\d+(?:\.\d+)?|\.\d+)/g)].map(match => Number(match[0]));
  const allowed = [...programme.roles.values()].flatMap(role => [Math.abs(role.si), ...(role.dimension === "velocity" ? [Math.abs(role.si) * 3.6] : [])]);
  return numbers.every(value => allowed.some(v => near(value, v)) || [1000, 3600].includes(value) && /\*1000\/3600/.test(text.replace(/\s/g, "")));
}
/** Finite semantic clause grammar, owned by the motion source programme.
 * Unsupported prose is declined, including prose without numeric literals.
 * Supported clauses prove their actor, role, unit, arithmetic and truth. */
export function proveMotionProse(raw: string, programme: MotionCallerProgramme, question?: string): boolean {
  try {
    const text = raw.trim().replace(/[−–]/g, "-").replace(/[×]/g, "*").replace(/[÷]/g, "/").replace(/\s+/g, " ").replace(/\.$/, "");
    if (question && text === question.trim().replace(/\.$/, ""))
      return true;
    if (!text)
      return false;
    const roles = programme.roles;
    let match: RegExpExecArray | null;
    if ((match = new RegExp(`^(?:(?:train|body|point|car|observer) )?([A-Z]) (?:moves at|speed is|has speed|travels at|velocity is) (${number}\\s*${unit})(?: in the ground frame)?$`, "i").exec(text))) {
      const role = roles.get(`v${match[1]!.toLowerCase()}`);
      return Boolean(role && roleValue(match[2]!, role, programme));
    }
    if ((match = new RegExp(`^(?:(?:train|body|point|car|observer) )?([A-Z]): (${number}\\s*${unit}) in (?:the )?ground frame$`, "i").exec(text))) {
      const role = roles.get(`v${match[1]!.toLowerCase()}`);
      return Boolean(role && roleValue(match[2]!, role, programme));
    }
    if ((match = new RegExp(`^([A-Z]) is initially (${number})\\s*(m|km) behind ([A-Z])$`, "i").exec(text))) {
      const first = roles.get(`x${match[1]!.toLowerCase()}`), second = roles.get(`x${match[4]!.toLowerCase()}`), conversion = motionUnitFactor(match[3]);
      return Boolean(first && second && conversion && near(second.si - first.si, Number(match[2]) * conversion.factor));
    }
    if ((match = /^([A-Z]) is faster than ([A-Z]), so the gap closes at the relative speed (.+)$/i.exec(text))) {
      const a = roles.get(`v${match[1]!.toLowerCase()}`), b = roles.get(`v${match[2]!.toLowerCase()}`);
      return Boolean(a && b && a.si > b.si && b.si >= 0 && programme.source.encounter.kind === "future" && near(arithmetic(match[3]!, programme), a.si - b.si));
    }
    if ((match = /^(.+) > 0, so ([A-Z]) eventually catches ([A-Z])$/i.exec(text))) {
      return programme.source.encounter.kind === "future" && match[2] === programme.source.subject.name && match[3] === programme.source.reference.name && equation(match[1]!, programme) && roles.get("vrel")!.si > 0;
    }
    if (/^Catch-up time is the initial gap divided by relative speed$/i.test(text))
      return programme.source.encounter.kind === "future" && roles.has("t");
    if ((match = /^Distance travelled by ([A-Z]) during the catch-up time$/i.exec(text)))
      return programme.source.encounter.kind === "future" && Boolean(roles.get(`d${match[1]!.toLowerCase()}`));
    if ((match = /^Consistency check using ([A-Z])'s motion: ([A-Z]) travels (.+), and (.+), matching the initial (.+) gap$/i.exec(text))) {
      const role = roles.get(`d${match[1]!.toLowerCase()}`), gap = roles.get("gap");
      const travel = match[3]!.replace(/\s+m$/i, "");
      return Boolean(role && gap && match[1] === match[2] && near(arithmetic(travel.split("=")[0]!, programme), role.si) && equation(match[3]!, programme) && equation(match[4]!, programme) && roleValue(match[5]!, gap, programme));
    }
    // Qualitative assumptions assert only the admitted model, frame and order.
    if (/^(?:Both trains move at constant speeds|Motion is at constant velocity on one straight line|Motion is along the same straight line in the same direction|A verified illustration is required by the question's spatial or explicit visual request)$/i.test(text)) {
      return !/same direction/i.test(text) || motionRationalNumber(programme.source.subject.v) * motionRationalNumber(programme.source.reference.v) > 0;
    }
    if ((match = new RegExp(`^The (${number})\\s*(m|km) gap is measured along the direction of motion$`, "i").exec(text)))
      return roleValue(`${match[1]} ${match[2]}`, roles.get("gap")!, programme);
    // Request statements must name a role the source actually requests. This
    // also admits the independent broad setup/query facts, without trusting IDs.
    if ((match = /^Find (?:the )?time for ([A-Z]) to catch ([A-Z])$/i.exec(text)))
      return programme.source.requests.encounter && match[1] === programme.source.subject.name && match[2] === programme.source.reference.name;
    if ((match = /^Find (?:the )?distance travelled by ([A-Z])$/i.exec(text)))
      return programme.source.requests.travelActors?.includes(match[1]!) ?? false;
    if ((match = /^Find encounter time and distance travelled by ([A-Z])$/i.exec(text)))
      return programme.source.requests.encounter && (programme.source.requests.travelActors?.includes(match[1]!) ?? false);
    if (text.includes("="))
      return equation(text, programme);
    return false;
  }
  catch {
    return false;
  }
}
/** A quantity's prose must describe that quantity, even when a different body's
 * independently true statement uses a number occurring elsewhere in the source. */
export function proveMotionQuantityText(text: string, role: MotionRole, programme: MotionCallerProgramme): boolean {
  if (!proveMotionProse(text, programme))
    return false;
  const first = text.split("=")[0]!.trim();
  const named = programme.roles.get(motionSymbolKey(first));
  if (named)
    return sameMotionFormula(named.formula, role.formula) && named.dimension === role.dimension;
  const actor = /^(?:(?:train|body|point|car|observer) )?([A-Z]) (?:moves at|speed is|has speed|travels at|velocity is)/i.exec(text);
  if (actor) {
    const velocity = programme.roles.get(`v${actor[1]!.toLowerCase()}`);
    return Boolean(velocity && sameMotionFormula(velocity.formula, role.formula));
  }
  if (/initially .+ behind/i.test(text))
    return sameMotionFormula(programme.roles.get("gap")!.formula, role.formula);
  const literal = measured(first);
  return Boolean(literal && literal.dimension === role.dimension && near(literal.value, role.si));
}
