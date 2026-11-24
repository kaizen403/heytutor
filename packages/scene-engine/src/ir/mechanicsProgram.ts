import { parseMathExpression } from "../math/expression";
import { mechanicsFunctionSourceUnitPattern, mechanicsFunctionSourceUnitTerminates, mechanicsSourceAxisReferenceSubject, type MechanicsSourceSubject } from "../physics/mechanicsFunctionSource";
import {
  MECHANICS_OPERATORS, evaluateMechanicsConstruction, mechanicsClaimValue,
  mechanicsUnitFactor, validateMechanicsNumericClaim,
  withMechanicsPositionAuthority,
  type MechanicsClaim, type MechanicsGeometry, type MechanicsEvaluationContext,
} from "../compile/mechanicsGeometry";
import { expressionToSafeSource, type ProblemIR, type ProblemFact, type SolveResultBinding, type SolveRequest } from "./problemIR";
import { mechanicsUnit3, type MechanicsVector3 } from "../physics/rigidBodyAuthority";
import { mechanicsSourceCases, validateMechanicsRequestedCase, mechanicsFunctionalEpochSI, type MechanicsSourceCase, type MechanicsSourceRead } from "./mechanicsRequestedState";
import { deriveMechanicsPositionAuthority } from "../physics/mechanicsPositionAuthority";
import { assertOriginalSourcePointBodyCoverage, sourcePointBodyCoordinateSymbol, sourcePointBodyMassOwnerMatches } from "./sourcePhysicalPointDeclarations";

/** Physical numbers are question expressions, never literal adapter inputs. */
export interface MechanicsProgramInput {
  id: string;
  expressionId: string;
  factId: string;
  ownerId: string;
  sourceExpression: string;
  unit: string;
  sourceUnit?: string;
  /** Exact source statement declaring units inherited by this measurement. */
  unitFactId?: string;
  component?: number;
  axisId?: string;
  /** Source time variable for a function law, rather than a sampled scalar. */
  variable?: string;
  variableUnit?: "s" | "ms";
  /** A quoted source time interval, not an invented endpoint or duration. */
  intervalComponent?: "start" | "end" | "duration";
}
export interface MechanicsProgramStep {
  id: string;
  operator: typeof MECHANICS_OPERATORS[number];
  ownerId: string;
  axisId: string;
  /** Explicit source owners for mass parts, forces, supports, contact and offsets. */
  sourceOwners?: Record<string, string>;
  evidenceFactIds: string[];
  inputs: Record<string, unknown>;
}
export interface MechanicsProgramOutput {
  stepId: string;
  symbol: string;
  unit: string;
  ownerId: string;
  axisId: string;
}
export interface MechanicsProgram {
  model: "mechanics";
  inputs: MechanicsProgramInput[];
  steps: MechanicsProgramStep[];
  output: MechanicsProgramOutput;
}
export interface MechanicsProgramSolution {
  approximate: number;
  errorBound: number;
  expressionIds: string[];
  factIds: string[];
  claim: MechanicsClaim;
  integration: boolean;
  snapshots: ReadonlyMap<string, MechanicsProgramStepSnapshot>;
}
export interface MechanicsProgramStepSnapshot {
  step: MechanicsProgramStep;
  physicalInputs: Readonly<Record<string, unknown>>;
  geometry: MechanicsGeometry;
}
export interface MechanicsScalarCertificate {
  approximate: number;
  errorBound: number;
  symbol: string;
  unit: string;
  ownerId: string;
  axisId: string;
}

const ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const RELATIVE_ERROR = 128 * Number.EPSILON;
const OWNER_SCOPE = /^(?:axis(?:\.point)?|surface(?:\.(?:point|velocity|acceleration|tangent))?|circularContact(?:\.(?:radius|surface(?:\.(?:point|tangent))?))?|offset|about|referencePoint|pointDefinition(?:\.(?:radius|angle|point))?|position|velocity|initialVelocity|frameVelocity|acceleration|gravityMagnitude|externalForce|externalForces\.\d+|time|initialState|couples\.\d+|masses\.\d+|particles\.\d+(?:\.velocity)?|angularLaw\.at|inertiaLaw\.(?:initialAt|at)|basis|components\.\d+(?:\.(?:center|endpoints|direction))?|rotors\.\d+|(?:derivation\.)?(?:forces\.\d+|internalPairs\.\d+\.\d+|supports\.\d+|bodies\.\d+)(?:\.(?:point|force|weight(?:\.(?:mass|gravityMagnitude))?|direction))?|derivation\.couples\.\d+|derivation\.gravityMagnitude|derivation\.constraint\.point)(?:\.(?:endpoints\.\d+|from|to))?$/;
function fail(message: string): never { throw new Error(`Mechanics source authority: ${message}`); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fields(value: unknown, allowed: readonly string[], name: string): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`${name} has unsupported fields`);
}
function id(value: unknown, name: string): asserts value is string { if (typeof value !== "string" || !ID.test(value)) fail(`${name} requires a bounded identifier`); }
function label(problem: ProblemIR, ownerId: string): string {
  const owner = problem.entities.find(entity => entity.id === ownerId);
  if (!owner || typeof owner.label !== "string" || !owner.label.trim() || owner.label.length > 128) fail(`owner ${ownerId} needs an explicit source label`);
  return owner.label;
}
function escape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function names(text: string, name: string): boolean { return new RegExp(`(?<![\\p{L}\\p{N}_])${escape(name)}(?![\\p{L}\\p{N}_])`, "u").test(text); }
function sourceClause(problem: ProblemIR, quote: string, start = problem.question.indexOf(quote)): string {
  const before = problem.question.slice(0, start);
  const boundary = [...before.matchAll(/[!?;]|\.(?=\s|$)/g)].at(-1)?.index ?? -1;
  const after = problem.question.slice(start + quote.length);
  const end = after.search(/[!?;]|\.(?=\s|$)/);
  return problem.question.slice(boundary + 1, start + quote.length + (end < 0 ? after.length : end));
}
function sourceFact(problem: ProblemIR, factId: string, requested = false, inertiaEndpoints = false): ProblemFact {
  const fact = problem.facts.find(candidate => candidate.id === factId);
  if (!fact || (requested ? fact.kind !== "requested" : !["given", "assumption"].includes(fact.kind))) fail(`fact ${factId} has the wrong source role`);
  const quote = fact.evidence?.quote;
  if (typeof quote !== "string" || !quote.trim() || quote.length > 2048 || !Number.isInteger(fact.evidence.start) || fact.evidence.start < 0 || fact.evidence.end !== fact.evidence.start + quote.length || problem.question.slice(fact.evidence.start, fact.evidence.end) !== quote) fail(`fact ${factId} must quote the original question exactly at its recorded source range`);
  if (!requested) {
    const clause = sourceClause(problem, quote, fact.evidence.start);
    if (/["“”]|\b(?:not|false|incorrect|hypothetical|if|unless|maybe|unknown|unspecified)\b/i.test(clause)) fail(`fact ${factId} is not a supported positive assertion`);
    if (/\b(?:variable|changing|varying|time[- ]dependent)\s+mass\b|\bmass\b[^.;!?]*\b(?:varies|changes)\b|\bnon[- ]?inertial\b/i.test(clause) || !inertiaEndpoints && /\b(?:variable|changing|varying|time[- ]dependent)\s+(?:inertia|moment\s+of\s+inertia)\b|\binertia\b[^.;!?]*\b(?:varies|changes)\b/i.test(clause)) fail(`fact ${factId} states an unsupported variable-mass/inertia/frame regime`);
  }
  return fact;
}

/** Only dimensions and source roles are interpreted here; physics stays in the adapters. */
function role(path: string): { dimension: string; source: RegExp } {
  const last = path.replace(/(?:\.\d+)+$/, "").split(".").at(-1);
  if (last === "magnitude") return role(path.slice(0, -".magnitude".length));
  if (path === "angularLaw.expression" || last === "angle" || last === "inclineAngle") return { dimension: "angle", source: /\b(?:theta|phi|beta|angle|incline|angular\s+position)\b|[θφβ]/i };
  if (path === "inertiaLaw.expression") return { dimension: "inertia", source: /\binertia\b|\bI\s*\(/i };
  if (["angularLaw.at", "inertiaLaw.at", "inertiaLaw.initialAt"].includes(path)) return { dimension: "time", source: /\b(?:time|at|t|initial|interval|for|during)\b/i };
  if (last === "gravityMagnitude") return { dimension: "acceleration", source: /\b(?:gravity|g)\b/i };
  if (last === "count") return { dimension: "dimensionless", source: /\b(?:count|number|particles?|masses)\b/i };
  if (last === "mass" || last === "masses") return { dimension: "mass", source: /\bmass(?:es)?\b|\b[Mm](?:_[A-Za-z0-9]+)?\s*=/ };
  if (last === "inertia" || last === "finalInertia") return { dimension: "inertia", source: /\b(?:inertia|moment)\b|\bI(?:_[A-Za-z0-9]+)?\s*=/i };
  if (last === "radius" || last === "rimRadius" || last === "length") return { dimension: "length", source: last !== "length" ? /\b(?:radius|radii|distances?)\b|\bR\s*=/i : /\blength\b|\bL\s*=/i };
  if (last === "angularVelocity") return { dimension: "angular_velocity", source: /\b(?:omega(?:_[xyz])?|spin|angular\s+(?:velocity|speed))\b|ω/i };
  if (last === "angularAcceleration") return { dimension: "angular_acceleration", source: /\b(?:alpha|angular\s+acceleration)\b|α/i };
  if (last === "initialAngularMomentum") return { dimension: "angular_momentum", source: /\b(?:angular\s+momentum|L(?:_[A-Za-z0-9]+)?)\b/ };
  if (["force", "externalForce", "externalForces"].includes(last ?? "")) return { dimension: "force", source: /\b(?:force|weight|load)\b|\bF(?:_[A-Za-z0-9]+)?\s*=/i };
  if (["torque", "externalTorque", "couples"].includes(last ?? "")) return { dimension: "torque", source: /\b(?:torque|couple|tau|motor|brake)\b|τ/i };
  if (last === "energy") return { dimension: "energy", source: /\b(?:energy|work)\b|\bK(?:_[A-Za-z0-9]+)?\s*=/i };
  if (last === "angularImpulse") return { dimension: "angular_impulse", source: /\b(?:angular\s+impulse|J_L)\b/i };
  if (["start", "end", "time"].includes(last ?? "")) return { dimension: "time", source: /\b(?:time|start|end|interval|from|during|for|after)\b|\bt\s*=/i };
  if (["velocity", "initialVelocity", "frameVelocity"].includes(last ?? "")) return { dimension: "velocity", source: /\b(?:velocity|speed|V(?:_C)?|U|v(?:_[A-Za-z0-9]+)?)\b/ };
  if (last === "acceleration" || last === "gravity") return { dimension: "acceleration", source: /\b(?:acceleration|gravity|g)\b/i };
  if (["direction", "tangent"].includes(last ?? "")) return { dimension: "dimensionless", source: /\b(?:direction|tangent|horizontal|vertical)\b|[+]?[xyz]-axis/i };
  if (last === "frictionCoefficient") return { dimension: "dimensionless", source: /\b(?:friction|coefficient|mu(?:_[sk])?)\b|μ/i };
  if (["center", "position", "point", "referencePoint", "offset", "about", "endpoints", "from", "to"].includes(last ?? "")) return { dimension: "length", source: /\b(?:centre|center|position|point|at|through|offset|origin|about|from|to)\b/i };
  return fail(`unsupported physical input path ${path}`);
}
function scalarRole(path: string): string {
  if (path === "angularLaw.expression") return "angle";
  if (path === "inertiaLaw.expression") return "inertia";
  if (["angularLaw.at", "inertiaLaw.at", "inertiaLaw.initialAt"].includes(path)) return "time";
  const last = path.replace(/(?:\.\d+)+$/, "").split(".").at(-1)!;
  if (last === "magnitude") return scalarRole(path.slice(0, -".magnitude".length));
  if (last === "masses") return "mass";
  if (["center", "position", "point", "referencePoint", "offset", "about", "endpoints", "from", "to"].includes(last)) return "position";
  if (["force", "externalForce", "externalForces"].includes(last)) return "force";
  if (["torque", "externalTorque", "couples"].includes(last)) return "torque";
  if (["start", "end", "time"].includes(last)) return "time";
  if (last === "gravity") return "acceleration";
  if (last === "tangent") return "direction";
  if (last === "finalInertia") return "inertia";
  if (last === "gravityMagnitude") return "acceleration";
  if (last === "inclineAngle") return "angle";
  if (last === "rimRadius") return "radius";
  if (["initialVelocity", "frameVelocity"].includes(last)) return "velocity";
  return last;
}
function nearestScalarRole(prefix: string, dimension: string): string | null {
  const group = (value: string): string => ["torque", "energy"].includes(value) ? "energy_or_torque" : ["angular_impulse", "angular_momentum"].includes(value) ? "angular_integral" : value;
  const kinds = ["mass", "inertia", "radius", "length", "angularVelocity", "angularAcceleration", "initialAngularMomentum", "angularImpulse", "angle", "force", "torque", "energy", "time", "velocity", "acceleration", "direction", "frictionCoefficient", "position"].filter(kind => group(role(kind).dimension) === group(dimension));
  const candidates = kinds.flatMap(kind => [...prefix.matchAll(new RegExp(role(kind).source.source, "g" + (role(kind).source.ignoreCase ? "i" : "")))].map(match => ({ kind, end: match.index! + match[0].length, length: match[0].length })));
  candidates.sort((a, b) => b.end - a.end || b.length - a.length);
  return candidates[0]?.kind ?? null;
}

function expectedOwner(step: MechanicsProgramStep, path: string): string {
  const scope = Object.keys(step.sourceOwners ?? {}).filter(prefix => path === prefix || path.startsWith(`${prefix}.`)).sort((a, b) => b.length - a.length)[0];
  if (scope) return step.sourceOwners![scope]!;
  return path.startsWith("axis.") || path.startsWith("referencePoint.") || path.startsWith("about.") ? step.axisId : step.ownerId;
}
/** Resolve already validated physical scope selectors; this is not a certificate. */
export function mechanicsSourceOwnerForPath(step: MechanicsProgramStep, path: string): string { return expectedOwner(step, path); }
function isVectorCoordinate(path: string): boolean {
  return /\.\d+$/.test(path) && ["center", "position", "point", "referencePoint", "offset", "about", "endpoints", "from", "to", "direction", "tangent", "velocity", "initialVelocity", "frameVelocity", "acceleration", "force", "externalForce", "externalForces", "gravity"].includes(path.replace(/(?:\.\d+)+$/, "").split(".").at(-1)!);
}
function assertedStationarySurface(text: string, owner: string): boolean {
  const modifiers = "(?:(?:a|the|horizontal|vertical|flat|rough|smooth|rigid|fixed|inclined)\\s+){0,6}";
  const surface = "(?:ground(?:\\s+surface)?|surface|plane|floor|track)";
  const named = `${escape(owner)}(?![\\p{L}\\p{N}_])`;
  const prenominal = new RegExp(`\\bstationary\\s+${modifiers}${surface}\\s+${named}`, "iu");
  if (prenominal.test(text) || /^(?:ground|surface|plane|floor|track)$/i.test(owner) && new RegExp(`\\bstationary\\s+${modifiers}${named}`, "iu").test(text)) return true;
  const subject = `(?:^|[;!?]|\\.(?=\\s|$)|\\band\\s+)\\s*${modifiers}(?:${surface}\\s+)?${named}\\s+(?:is|remains)\\s+`;
  return new RegExp(`${subject}(?:initially\\s+)?stationary\\b|${subject}${modifiers}${surface}\\s+and\\s+(?:is\\s+)?(?:initially\\s+)?stationary\\b`, "iu").test(text);
}
function assertedRest(text: string, owner: string, problem?: ProblemIR): boolean {
  const source = problem ? sourceClause(problem, text) : text;
  if (assertedStationarySurface(source, owner)) return true;
  const identities = [...source.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escape(owner)}(?![\\p{L}\\p{N}_])`, "gu"))];
  const predicate = "(?:(?:is|was|starts?|starting|released|initially|remains)\\s+){0,4}";
  const direct = new RegExp(`^\\s*${predicate}$`, "i");
  const continued = new RegExp(`^\\s*(?:has|have|with|having)\\s+([\\s\\S]+?)\\s+and\\s+${predicate}$`, "i");
  const property = /^(?:(?:a|the|initial|constant|central|COM)\s+)*(?:mass|inertia|moment\s+of\s+inertia|length|radius|position|centre|center|COM|M(?:_[A-Za-z0-9]+)?\b|I(?:_[A-Za-z0-9]+)?\b)/i;
  for (const rest of source.matchAll(/\b(?:at\s+rest|from\s+rest|stationary)\b/gi)) {
    for (const identity of identities) {
      const end = identity.index! + identity[0].length;
      if (end > rest.index! || rest.index! - end > 512) continue;
      const own = source.slice(end, rest.index!);
      // A relative clause introduces its own subject even when the observer,
      // probe or casing was never declared as an IR entity.
      if (/[;!?]|\.(?=\s|$)|\b(?:not|never|while|whereas|who|whose|whom|which|that|by)\b/i.test(own)) continue;
      if (direct.test(own) && (rest[0].toLowerCase() !== "stationary" || own.trim())) return true;
      const properties = continued.exec(own)?.[1];
      if (properties && property.test(properties) && !/\b(?:is|are|was|were|has|have|had|starts?|remains)\b/i.test(properties)) return true;
    }
    if (rest[0].toLowerCase() !== "stationary" || /\b(?:not|never)\s*$/i.test(source.slice(Math.max(0, rest.index! - 16), rest.index!))) continue;
    for (const identity of identities) {
      const start = rest.index! + rest[0].length;
      if (identity.index! < start || identity.index! - start > 256) continue;
      const prefix = source.slice(start, identity.index!);
      if (/^\s*(?:,|and\b|with\b|of\b)/i.test(prefix)) continue;
      if (/[;!?]|\.(?=\s|$)|\b(?:not|never|while|whereas|who|whose|whom|which|that|by|is|are|was|were|has|have)\b/i.test(prefix)) continue;
      // Only body modifiers and physical property prefixes may intervene.
      // A named or unnamed different actor leaves an unrecognized residue.
      const residue = prefix.replace(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g, "")
        .replace(/\b(?:uniform|homogeneous|thin|solid|rigid|point|putty|closed|mass|length|radius|inertia|COM|rod|rotor|body|particle|disc|disk|ring|sphere|cylinder|beam|bar|block|wheel|flywheel|spherical|shell|metres?|meters?|kilograms?|grams?)\b/gi, "")
        .replace(/\b(?:kg|g|cm|mm|m|ms|s|rad|N|J|a|the|of|and|with)\b/g, "").replace(/[\s,./+*^()=−-]/g, "");
      if (!residue) return true;
    }
  }
  return false;
}
function firstApplicationOwner(problem: ProblemIR, text: string): string | null {
  const found = problem.entities.flatMap(entity => typeof entity.label !== "string" ? [] : [...text.matchAll(new RegExp(`\\b(?:applied\\s+at|acts?\\s+at|at|through|on)\\s+(?:(?:a|the|point|particle|rod|right|left|upper|lower|end|centre|center|COM|fixed)\\s+){0,5}${escape(entity.label)}(?![\\p{L}\\p{N}_])`, "gu"))].map(match => ({ id: entity.id, at: match.index! })));
  found.sort((a, b) => a.at - b.at);
  return found[0]?.id ?? null;
}
function sourceAxisDirection(problem: ProblemIR, step: MechanicsProgramStep): MechanicsVector3 | null {
  const owner = label(problem, step.axisId);
  for (const fact of problem.facts.filter(fact => ["given", "assumption"].includes(fact.kind))) {
    const text = fact.evidence.quote;
    const anchor = new RegExp(`\\baxis\\s+${escape(owner)}\\b`, "i").exec(text);
    if (!anchor) continue;
    const own = text.slice(anchor.index).split(/[;.!?]/)[0]!;
    const tuple = /\bdirection\s*(?:is|=|:)?\s*\(([^()]*)\)\s*1\b/i.exec(own);
    if (tuple) {
      sourceFact(problem, fact.id);
      const values = tuple[1]!.split(","); if (values.length !== 3) fail("physical axis declaration must retain all three source components");
      return mechanicsUnit3({ x: parseMathExpression(values[0]!).evaluate(0), y: parseMathExpression(values[1]!).evaluate(0), z: parseMathExpression(values[2]!).evaluate(0) }, "source axis direction");
    }
  }
  return null;
}
function nativeDirection(problem: ProblemIR, step: MechanicsProgramStep, path: string, direction: string): void {
  const vectors: Record<string, MechanicsVector3> = { positive_x: { x: 1, y: 0, z: 0 }, negative_x: { x: -1, y: 0, z: 0 }, positive_y: { x: 0, y: 1, z: 0 }, negative_y: { x: 0, y: -1, z: 0 }, positive_z: { x: 0, y: 0, z: 1 }, negative_z: { x: 0, y: 0, z: -1 } };
  const wanted = vectors[direction]; if (!wanted) return;
  if (path === "axis.direction") {
    const declared = sourceAxisDirection(problem, step);
    if (declared) { if (declared.x !== wanted.x || declared.y !== wanted.y || declared.z !== wanted.z) fail("native axis direction contradicts its explicit source axis"); return; }
  }
  const owner = label(problem, expectedOwner(step, path));
  const facts = problem.facts.filter(fact => ["given", "assumption"].includes(fact.kind) && names(fact.evidence.quote, owner));
  const bodyPath = /^components\.\d+\.direction$|^bodyGeometry\.direction$/.test(path);
  for (const fact of facts) {
    const text = sourceFact(problem, fact.id).evidence.quote;
    const tuple = /\b(?:length\s+|normal\s+)?direction\s*(?:is|=|:)?\s*\(([^()]*)\)\s*1\b/i.exec(text);
    if (tuple && bodyPath) {
      const values = tuple[1]!.split(","); if (values.length !== 3) continue;
      const actual = mechanicsUnit3({ x: parseMathExpression(values[0]!).evaluate(0), y: parseMathExpression(values[1]!).evaluate(0), z: parseMathExpression(values[2]!).evaluate(0) }, "source body direction");
      if (actual.x === wanted.x && actual.y === wanted.y && actual.z === wanted.z) return;
      fail("native body direction contradicts its explicit source orientation");
    }
    const along = /\b(?:along|parallel to|direction)\s+([+-]?)([xyz])\b/i.exec(text);
    const axis = path === "axis.direction" ? /\b(?:central\s+|normal\s+)?([+-]?)([xyz])\s+axis\b/i.exec(text) : null;
    const stated = along ?? axis;
    if (stated) { const value = { x: 0, y: 0, z: 0 }; value[stated[2]!.toLowerCase() as "x" | "y" | "z"] = stated[1] === "-" ? -1 : 1; if (value.x === wanted.x && value.y === wanted.y && value.z === wanted.z) return; }
    if (bodyPath && wanted.z === 1 && /\bxy\s+plane\b/i.test(text)) return;
  }
  if (path === "axis.direction" && wanted.z === 1 && step.evidenceFactIds.some(factId => { const text = sourceFact(problem, factId, problem.facts.find(fact => fact.id === factId)?.kind === "requested").evidence.quote; return /\binertial\b/i.test(text) && /\+x\s+right/i.test(text) && /\+y\s+up/i.test(text) && /\+z\s+out/i.test(text); })) return;
  fail(`${path} native direction needs the same source body/axis orientation`);
}
function nativeVectorDirection(problem: ProblemIR, step: MechanicsProgramStep, path: string, direction: string, sourceInputs: ReadonlyMap<string, MechanicsProgramInput>): void {
  const parent = inputAt(step.inputs, path.replace(/\.direction$/, ""));
  const input = record(parent) && typeof parent.magnitude === "string" ? sourceInputs.get(parent.magnitude) : undefined;
  if (!input) fail("native vector direction requires its source-bound magnitude");
  const expression = problem.expressions.find(expression => expression.id === input.expressionId);
  if (expression?.root.kind === "number" && expression.root.value === 0) return;
  const source = sourceFact(problem, input.factId).evidence.quote.split(/\bUse\s+SI\s+units|\bUse\s+an?\s+inertial\b/i)[0]!;
  const xPositive = /\bright(?:ward)?\b|\bdownhill\b|\+x\b/i.test(source), xNegative = /\bleft(?:ward)?\b|\buphill\b|-x\b/i.test(source);
  const yPositive = /\bup(?:ward)?\b|\b(?:outward\s+normal)\b|\+y\b/i.test(source), yNegative = /\bdown(?:ward)?\b|\b(?:inward\s+normal)\b|-y\b/i.test(source);
  const wanted = direction === "right" ? "positive_x" : direction === "left" ? "negative_x" : direction === "up" ? "positive_y" : direction === "down" ? "negative_y" : direction;
  const known = wanted === "positive_x" ? xPositive && !xNegative : wanted === "negative_x" ? xNegative && !xPositive : wanted === "positive_y" ? yPositive && !yNegative : wanted === "negative_y" ? yNegative && !yPositive : false;
  if (!known) fail("native vector direction must be stated for its source magnitude and owner");
}
function positiveDensity(text: string, owner: string, shape: string): boolean {
  const word = shape.replaceAll("_", " "), escaped = escape(word);
  const ownNoun = owner.toLowerCase() === word || shape === "spherical_shell" && owner.toLowerCase() === "shell";
  const pattern = new RegExp(`\\b(?:uniform|homogeneous)\\s+(?:[A-Za-z0-9.+-]+\\s+){0,4}${escaped}\\b`, "gi");
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(0, match.index), after = text.slice(match.index! + match[0].length);
    if (/\b(?:non|not)\s*[- ]?\s*$/i.test(before) || /\bnon[- ](?:uniform|homogeneous)\b/i.test(match[0])) continue;
    if (ownNoun || new RegExp(`${escape(owner)}\\s+(?:is|was|has)\\s+(?:(?:a|an)\\s+)?$`, "i").test(before) || new RegExp(`^\\s+${escape(owner)}\\b`, "i").test(after)) return true;
  }
  return false;
}
function sourceScalarDeclarations(question: string, unit: "mass" | "force" | "torque"): number {
  const scale = unit === "mass" ? "(?:kg|g)" : unit === "force" ? "N" : "N\\s+(?:m|cm|mm)";
  const source = question.split(/\b(?:As\s+a\s+separate|For\s+a\s+separate|In\s+a\s+separate|In\s+a\s+second\s+state)\b/i)[0]!;
  const matches = [...source.matchAll(new RegExp(`(?:[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)|\\([^()]*,[^()]*\\))\\s+${scale}\\b`, "g"))];
  return matches.filter(match => !/^\s*(?:[*/^²³]|(?:m|cm|mm)(?:2|²|\^2)\b|\/)/.test(source.slice(match.index! + match[0].length)) && !(unit === "force" && /^\s+(?:m|cm|mm)\b/.test(source.slice(match.index! + match[0].length)))).length;
}
function inheritedUnit(problem: ProblemIR, input: MechanicsProgramInput, step: MechanicsProgramStep, dimension: string): boolean {
  if (input.unitFactId === undefined) return false;
  if (!step.evidenceFactIds.includes(input.unitFactId)) fail(`${input.id} inherited units must be step evidence`);
  const fact = sourceFact(problem, input.unitFactId);
  const sourceUnit = input.sourceUnit ?? input.unit;
  const factor = mechanicsUnitFactor(sourceUnit, dimension);
  const text = fact.evidence.quote;
  const si = /\b(?:use|in)\s+SI\s+units?\b/i.test(text) && factor === 1;
  const physical = dimension === "length" ? ["m", "metres?|meters?", 1] : dimension === "time" ? ["s", "seconds?", 1] : undefined;
  const named = physical && sourceUnit === physical[0] && new RegExp(`\\b(?:in|measured\\s+in)\\s+${physical[1]}\\b`, "i").test(text) && factor === physical[2];
  if (!si && !named) fail(`${input.id} inherited unit contradicts its exact source unit declaration`);
  return true;
}
function inputAt(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => Array.isArray(current) ? current[Number(key)] : record(current) ? current[key] : undefined, value);
}
function nativeGeometryEvidence(problem: ProblemIR, step: MechanicsProgramStep, path: string, value: Record<string, unknown>): void {
  const facts = step.evidenceFactIds.map(factId => sourceFact(problem, factId, problem.facts.find(fact => fact.id === factId)?.kind === "requested", String(step.operator) === "axial_rotation" && ["redistribution", "inertia_law"].includes(String(step.inputs.mode))));
  const assertions = facts.filter(fact => fact.kind !== "requested");
  if (value.kind === "midpoint") {
    const first = expectedOwner(step, `${path}.endpoints.0`), second = expectedOwner(step, `${path}.endpoints.1`);
    if (first === second) fail("midpoint endpoints require distinct source point owners");
    const forcePath = path.replace(/\.point$/, "");
    const parent = inputAt(step.inputs, forcePath);
    const bodyId = record(parent) && parent.weight !== undefined ? expectedOwner(step, `${forcePath}.weight.mass`) : /^components\.\d+\./.test(path) ? expectedOwner(step, `${path.split(".").slice(0, 2).join(".")}.mass`) : step.ownerId;
    const body = label(problem, bodyId);
    const relation = (a: string, b: string): RegExp => new RegExp(`\\b(?:from|between|supports?|contacts?)\\s+(?:pin\\s+)?${escape(label(problem, a))}\\s*=[^.;]*\\b(?:to|and|,)\\s+${escape(label(problem, b))}\\s*=`, "i");
    const endpoints = assertions.some(fact => names(fact.evidence.quote, body) && /\b(?:uniform|homogeneous|midpoint)\b/i.test(fact.evidence.quote) && (relation(first, second).test(fact.evidence.quote) || relation(second, first).test(fact.evidence.quote)));
    const stated = facts.some(fact => names(fact.evidence.quote, body) && names(fact.evidence.quote, label(problem, first)) && names(fact.evidence.quote, label(problem, second)) && /\bmidpoint\b/i.test(fact.evidence.quote));
    if (!endpoints && !stated) fail("midpoint must use the source body's actual endpoints or a stated midpoint construction");
  }
  if (value.kind === "toward") {
    const from = expectedOwner(step, `${path}.from`), to = expectedOwner(step, `${path}.to`);
    if (from === to) fail("a cable direction needs distinct source endpoint owners");
    const connection = new RegExp(`\\b(?:connects?|from|along|toward)\\s+${escape(label(problem, from))}\\b[^.;]*\\b(?:to|toward)\\s+(?:(?:a|the|fixed|anchor)\\s+){0,4}${escape(label(problem, to))}\\b|\\balong\\s+${escape(label(problem, from))}${escape(label(problem, to))}\\b`, "i");
    if (!assertions.some(fact => /\b(?:cable|pulls?|tension)\b/i.test(fact.evidence.quote) && connection.test(fact.evidence.quote))) fail("toward direction must preserve the source cable's attachment-to-anchor order");
    const group = path.replace(/\.direction$/, "");
    if (from !== expectedOwner(step, `${group}.point`)) fail("cable direction must begin at its source application point");
  }
}
function priorPropertyOwners(problem: ProblemIR, ownerId: string, axisId: string, prefix: string, propertyRole: string, bodyProperty: boolean): Array<{ id: string; at: number }> {
  const ownerLabel = label(problem, ownerId);
  const incidentalReference = (entityLabel: string, at: number): boolean => {
    if (!bodyProperty || entityLabel === ownerLabel) return false;
    const before = prefix.slice(0, at), tail = prefix.slice(at + entityLabel.length);
    if (/^\s+(?:has|have|is|of)\b/.test(tail)) return false;
    const preposition = /\b(?:on|at|through|about|around|along|over|relative\s+to)\s+(?:(?:a|an|the|stationary|horizontal|vertical|fixed|central|normal|axis|ground|surface|point|centre|center|COM)\s+){0,6}$/i.test(before);
    if (preposition) return true;
    const assignedRole: Record<string, string> = { g: "acceleration", F: "force", tau: "torque", omega: "angularVelocity", alpha: "angularAcceleration", mu_s: "frictionCoefficient", mu_k: "frictionCoefficient" };
    return /^\s*=/.test(tail) && assignedRole[entityLabel] !== undefined && assignedRole[entityLabel] !== propertyRole;
  };
  return problem.entities.flatMap(entity => entity.id !== ownerId && (entity.kind === "state" || entity.id === axisId) ? [] : typeof entity.label === "string" ? [...prefix.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escape(entity.label)}(?![\\p{L}\\p{N}_])`, "gu"))].filter(match => !incidentalReference(entity.label!, match.index!)).map(match => ({ id: entity.id, at: match.index! })) : []).sort((a, b) => b.at - a.at);
}
function propertyActors(problem: ProblemIR, axisId: string, prefix: string, uniqueOwner: boolean): MechanicsSourceSubject[] {
  const propertyWords = new Set(["mass", "inertia", "radius", "length", "velocity", "acceleration", "moment", "force", "torque", "time", "gravity", "position", "point", "center", "centre", "direction", "coefficient", "initial", "final"]);
  return [...prefix.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s+(?:has|have|is|of)\b/g)].flatMap(match => {
    if (propertyWords.has(match[1]!.toLowerCase())) return [];
    const before = prefix.slice(0, match.index);
    if (/(?:^|[^\p{L}\p{N}_])[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/u.test(before) && ["length", "mass", "time", "angle", "force", "energy", "torque"].some(dimension => { try { mechanicsUnitFactor(match[1]!, dimension); return true; } catch { return false; } })) return [];
    const referenceSubject = mechanicsSourceAxisReferenceSubject(prefix, { index: match.index!, name: match[1]! }, label(problem, axisId));
    if (referenceSubject === null) fail("a source axis reference must retain its actual declaration subject");
    const subject = referenceSubject ?? { name: match[1]!, index: match.index!, declarationIndex: match.index!, phraseStart: match.index!, end: match.index! + match[1]!.length };
    if (uniqueOwner && ["each", "both", "it", "they"].includes(subject.name.toLowerCase())) return [];
    return [subject];
  });
}
function inputValue(problem: ProblemIR, input: MechanicsProgramInput, step: MechanicsProgramStep, path: string, sourceInputs: ReadonlyMap<string, MechanicsProgramInput>): { value: number; unit: string } | string {
  const meaning = role(path);
  if (input.ownerId !== expectedOwner(step, path)) fail(`${path} is bound to a different source owner`);
  const axial = String(step.operator) === "axial_rotation";
  const fact = sourceFact(problem, input.factId, false, axial && ["redistribution", "inertia_law"].includes(String(step.inputs.mode)));
  if (fact.kind !== "given") fail(`physical scalar ${input.id} must be given in the question`);
  const ownerLabel = label(problem, input.ownerId);
  const expression = problem.expressions.find(candidate => candidate.id === input.expressionId);
  if (!expression || expression.valueType !== (input.variable === undefined ? "scalar" : "function") || !expression.evidenceFactIds.includes(input.factId)) fail(`${input.id} expression must cite its given fact and preserve its value type`);
  if (typeof input.sourceExpression !== "string" || !input.sourceExpression.trim() || input.sourceExpression.length > 512) fail(`${input.id} needs the copied source expression`);
  const sourceUnit = input.sourceUnit ?? input.unit;
  if (typeof input.unit !== "string" || typeof sourceUnit !== "string" || !sourceUnit.trim()) fail(`${input.id} requires explicit physical units`);
  const inherited = inheritedUnit(problem, input, step, meaning.dimension);
  const sourceUnitPattern = input.variable !== undefined && input.sourceUnit === undefined && meaning.dimension === "angle"
    ? mechanicsFunctionSourceUnitPattern(sourceUnit) ?? escape(sourceUnit) : escape(sourceUnit);
  const printedUnit = inherited ? "" : meaning.dimension === "dimensionless" && sourceUnit === "1" ? "(?:\\s+1)?" : meaning.dimension === "angle" ? `(?:\\s+|-)${sourceUnitPattern}` : `\\s+${sourceUnitPattern}`;
  const suffix = new RegExp(`(?<![\\p{L}\\p{N}_.+*/^\\-])${escape(input.sourceExpression)}${printedUnit}(?=$|[\\s,;)]|\\.(?=\\s|$))`, "gu");
  const suppliedMatches = [...fact.evidence.quote.matchAll(suffix)];
  const matches = suppliedMatches.filter(match => {
    const after = fact.evidence.quote.slice(match.index! + match[0].length);
    const functionUnitEnds = input.variable === undefined || meaning.dimension !== "angle" || mechanicsFunctionSourceUnitTerminates(
      problem.question.slice(fact.evidence.start + match.index! + match[0].length),
      { variable: input.variable, variableUnit: input.variableUnit, axisLabel: label(problem, step.axisId) },
    );
    return functionUnitEnds && !/^\s*(?:[/*^²³]|\d|(?:kg|g|cm|mm|m|ms|s|rad|N|J)(?:\b|²|\^)|per\b)/.test(after) && !(inherited && /^\s*(?:radians?|degrees?|metres?|meters?|seconds?)\b/.test(after));
  });
  if (matches.length !== 1 || input.variable !== undefined && meaning.dimension === "angle" && suppliedMatches.length !== 1) fail(`${input.id} source expression and unit must identify one supplied value`);
  const prefix = fact.evidence.quote.slice(0, matches[0]!.index!);
  const after = fact.evidence.quote.slice(matches[0]!.index! + matches[0]![0].length);
  const angularComponent = ["angular_velocity", "angular_acceleration"].includes(meaning.dimension) ? /(?:omega|ω|alpha|α)_([xyz])\s*=\s*$/i.exec(prefix) : null;
  if (angularComponent && ["rigid_body_motion", "rolling_contact"].includes(step.operator) && angularComponent[1] !== "z") fail(`${input.id} supplies a different angular component than the supported planar motion`);
  if (input.component === undefined && !input.sourceExpression.includes(",") && /\([^()]*,$/.test(prefix) || input.component === undefined && !input.sourceExpression.includes(",") && /\([^()]*$/.test(prefix) && /^\s*,/.test(after)) fail(`${input.id} cannot detach a scalar from a source tuple without a component binding`);
  const adjective = meaning.dimension === "mass" && /^\s*(?:(?:thin|solid|point|putty|closed|rigid)\s+){0,3}(?:particle|body|piece|rod|disc|disk|ring|sphere|cylinder|beam|block|load|mass)\b/i.test(after);
  const massOwner = meaning.dimension === "mass" && new RegExp(`\\b${escape(ownerLabel)}\\s+of\\s*$`, "i").test(prefix);
  const adjectiveOwner = adjective && (new RegExp(`^\\s*(?:(?:thin|solid|point|putty|closed|rigid)\\s+){0,3}(?:particle|body|piece|rod|disc|disk|ring|sphere|cylinder|beam|block|load|mass)\\s+${escape(ownerLabel)}\\b`, "i").test(after) || new RegExp(`^\\s*${escape(ownerLabel)}\\b`, "i").test(after));
  const namedPosition = scalarRole(path) === "position" && new RegExp(`${escape(ownerLabel)}\\s*=\\s*$`, "u").test(prefix);
  const pointRadius = path.startsWith("pointDefinition.") && scalarRole(path) === "radius" && /\b(?:to\s+the\s+(?:right|left)|above|below)\b/i.test(after);
  const quantityFirstTorque = scalarRole(path) === "torque" && /^\s+(?:(?:motor|brake|net|external|applied|constant|signed|positive|negative)\s+){0,4}(?:torque|couple)\b/i.test(after);
  if (quantityFirstTorque) {
    const about = /\babout\s+(?:(?:the|fixed|axis)\s+){0,3}([+−-]?)([A-Za-z][A-Za-z0-9_]*)\b/.exec(after.split(/[;!?]|\.(?=\s|$)/)[0]!);
    if (about && (about[1] === "-" || about[1] === "−" || about[2] !== label(problem, step.axisId))) fail(`${input.id} source torque names a different physical axis`);
  }
  const axialRadius = step.operator === "mass_moments" && step.inputs.mode === "axial" && scalarRole(path) === "radius" && new RegExp(`^\\s+from\\s+${escape(label(problem, step.axisId))}\\b`, "i").test(after);
  const countWord = scalarRole(path) === "count" && /^(?:one|two|three|four|five|six|seven|eight|nine|ten)$/i.test(input.sourceExpression) && /^\s+(?:(?:\d+(?:\.\d+)?)\s+(?:kg|g)\s+)?(?:point\s+)?(?:particles?|masses)\b/i.test(after) && names(fact.evidence.quote, ownerLabel);
  const physicalOwner = (entity: ProblemIR["entities"][number]): boolean => entity.id === input.ownerId || entity.kind !== "state";
  const fullOwners = problem.entities.filter(entity => physicalOwner(entity) && typeof entity.label === "string" && entity.id !== step.axisId && names(fact.evidence.quote, entity.label));
  const uniqueOwner = fullOwners.length === 1 && fullOwners[0]!.id === input.ownerId;
  const pointMassOwner = meaning.dimension === "mass" && /^\s*point\s+mass\b/i.test(after) && firstApplicationOwner(problem, after) === input.ownerId;
  const pointComponent = /^components\.\d+\.mass$/u.test(path) ? inputAt(step.inputs, path.replace(/\.mass$/u, "")) : undefined;
  const originalPointMass = meaning.dimension === "mass" && step.operator === "mass_moments" && record(pointComponent) && pointComponent.shape === "point"
    && sourcePointBodyMassOwnerMatches(problem.question, ownerLabel, input.sourceExpression, sourceUnit, fact.evidence);
  const applicationOwner = meaning.dimension === "force" && firstApplicationOwner(problem, after) === input.ownerId;
  const postOwner = new RegExp(`^\\s+(?:of|for)\\s+(?:(?:a|the)\\s+)?${escape(ownerLabel)}\\b`, "i").test(after) || uniqueOwner && ["time", "torque", "angular_impulse"].includes(meaning.dimension) && new RegExp(`^[^.;]*\\bon\\s+(?:(?:a|the)\\s+)?${escape(ownerLabel)}\\b`, "i").test(after);
  if ((!names(prefix, ownerLabel) && !adjectiveOwner && !pointMassOwner && !originalPointMass && !applicationOwner && !postOwner && !countWord) || !meaning.source.test(fact.evidence.quote) && !adjective && !massOwner && !originalPointMass && !namedPosition && !pointRadius && !axialRadius && !applicationOwner || nearestScalarRole(prefix, meaning.dimension) !== scalarRole(path) && !adjective && !massOwner && !originalPointMass && !namedPosition && !pointRadius && !axialRadius && !countWord && !applicationOwner && !quantityFirstTorque) fail(`${input.id} source quote does not name its physical owner and role at that value`);
  if (scalarRole(path) === "inertia" && step.operator === "rigid_body_motion" && !/\b(?:central|COM|centre|center)\b|\bI_C(?:M)?\b/i.test(fact.evidence.quote)) fail(`${input.id} must be an explicitly central COM inertia`);
  if (path.replace(/\.\d+$/, "").endsWith("offset") && !/\b(?:COM[- ]relative\s+offset|offset\s+(?:from|relative\s+to)\s+(?:the\s+)?(?:COM|centre|center))\b/i.test(fact.evidence.quote)) fail(`${input.id} must be a COM-relative offset, not an absolute point position`);
  if (scalarRole(path) === "initialAngularMomentum" && !/\b(?:initial|before|L_i|L_0)\b/i.test(prefix)) fail(`${input.id} must be the initial same-axis angular momentum`);
  if (axial && scalarRole(path) === "angularVelocity" && !/\b(?:initial|before|omega_0|omega_i)\b|ω[_₀]0?/i.test(prefix)) fail(`${input.id} must be an initial same-axis angular velocity`);
  if (axial && step.inputs.mode === "redistribution" && path === "inertia" && !/\b(?:initial|before|from|I_i|I_0)\b/i.test(prefix)) fail(`${input.id} must be the initial endpoint inertia`);
  if (axial && path === "finalInertia" && !/\b(?:final|after|to|I_f)\b/i.test(prefix)) fail(`${input.id} must be the final endpoint inertia`);
  // A body's intrinsic state keeps its subject across references to a surface,
  // application point or another supplied quantity. An explicit new subject
  // still wins, regardless of the untrusted entity kind in the formulation.
  const actors = propertyActors(problem, step.axisId, prefix, uniqueOwner);
  const bodyProperty = input.ownerId === step.ownerId && ["mass", "inertia", "radius", "length", "velocity", "angularVelocity", "angularAcceleration", "frictionCoefficient"].includes(scalarRole(path));
  const priorOwners = priorPropertyOwners(problem, input.ownerId, step.axisId, prefix, scalarRole(path), bodyProperty);
  const qualifiedVelocity = scalarRole(path) === "velocity" ? /(?:^|[^\p{L}\p{N}_])([Vv])_([A-Za-z][A-Za-z0-9]*)\s*=\s*$/u.exec(prefix) : null;
  const qualifiedOwner = qualifiedVelocity && problem.entities.find(entity => entity.label === qualifiedVelocity[2]);
  // V_C is the native COM-velocity symbol. Other named suffixes retain their
  // actual point/body owner, including lower-case material-point v_C.
  if (qualifiedOwner && qualifiedOwner.id !== input.ownerId && !(bodyProperty && qualifiedVelocity![1] === "V" && qualifiedVelocity![2] === "C")) fail(`${input.id} source quantity is qualified to a different physical owner`);
  const actor = actors.at(-1);
  const linkedAfter = adjectiveOwner || pointMassOwner || originalPointMass || applicationOwner || postOwner || countWord;
  const actorOwnerStart = actor ? actor.end - ownerLabel.length : -1;
  const actorNamesOwner = actor && (actor.name === ownerLabel || names(actor.name, ownerLabel) || actorOwnerStart >= actor.phraseStart && prefix.slice(actorOwnerStart, actor.end) === ownerLabel);
  if (!linkedAfter && actor && actor.declarationIndex >= (priorOwners[0]?.at ?? -1) && !actorNamesOwner) fail(`${input.id} source assertion assigns its value to a different subject`);
  if (!linkedAfter && priorOwners[0]?.id !== input.ownerId) fail(`${input.id} measurement belongs to another named owner`);
  const declaredFactor = mechanicsUnitFactor(input.unit, meaning.dimension);
  const sourceFactor = mechanicsUnitFactor(sourceUnit, meaning.dimension);
  if (input.axisId !== undefined && (input.axisId !== step.axisId || !names(fact.evidence.quote, label(problem, input.axisId)) && angularComponent?.[1] !== label(problem, input.axisId))) fail(`${input.id} uses a different reference axis`);
  if (step.operator === "angular_impulse" && ["torque", "angular_momentum"].includes(meaning.dimension) && input.axisId !== step.axisId) fail(`${input.id} needs a source-bound common angular impulse axis`);
  if (axial && ["inertia", "angular_velocity", "angular_momentum", "torque", "angular_impulse", "angle"].includes(meaning.dimension) && input.axisId !== step.axisId) fail(`${input.id} needs the declared physical axial reference`);
  if (input.variable !== undefined) {
    const law = path === "angularLaw.expression" ? step.inputs.angularLaw : path === "inertiaLaw.expression" ? step.inputs.inertiaLaw : undefined;
    const lawUnit = path === "angularLaw.expression" ? "angleUnit" : "inertiaUnit";
    if (!record(law) || !ID.test(input.variable) || ["pi", "e", "sin", "cos", "tan", "sqrt", "exp", "ln", "log"].includes(input.variable) || input.component !== undefined || input.intervalComponent !== undefined || sourceFactor !== declaredFactor || input.axisId !== step.axisId || input.unit !== law[lawUnit] || input.variableUnit !== law.timeUnit) fail(`${input.id} function must preserve its supported source law and axis/time/value units`);
    const variableUnit = input.variableUnit === "s" ? "(?:s|seconds?)" : "(?:ms|milliseconds?)";
    const declaration = new RegExp(`\\b${escape(input.variable)}\\s+(?:is\\s+)?(?:in|measured\\s+in)\\s+`, "i").test(fact.evidence.quote);
    const at = typeof law.at === "string" ? sourceInputs.get(law.at) : undefined;
    const timeEvidence = declaration || !at ? fact.evidence.quote : `${fact.evidence.quote}; ${sourceFact(problem, at.factId).evidence.quote}`;
    if (!new RegExp(`\\b${escape(input.variable)}(?:\\s+(?:is\\s+)?(?:in|measured\\s+in)\\s+${variableUnit}\\b|\\s*(?:=|<=|<)\\s*[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)\\s*${variableUnit}\\b)`, "i").test(timeEvidence)) fail(`${input.id} source law must declare the time variable unit`);
    const source = input.sourceExpression.replace(new RegExp(`\\b${escape(input.variable)}\\b`, "g"), "x");
    const parsed = parseMathExpression(source);
    const formulated = parseMathExpression(expressionToSafeSource(expression.root, input.variable));
    if (!("syntaxKey" in parsed) || !("syntaxKey" in formulated) || typeof parsed.syntaxKey !== "string" || parsed.syntaxKey !== formulated.syntaxKey) fail(`${input.id} source function and formulated AST must be structurally identical`);
    return parsed.source;
  }
  let source = input.sourceExpression;
  if (input.component === undefined && isVectorCoordinate(path)) fail(`${input.id} inline physical vector coordinate needs its explicit source tuple component`);
  if (input.intervalComponent !== undefined) {
    if (meaning.dimension !== "time" || input.component !== undefined || !["start", "end", "duration"].includes(input.intervalComponent) || !/\b(?:during|from|interval|for)\b/i.test(prefix)) fail(`${input.id} must identify a source-stated time interval`);
    const number = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)";
    const interval = new RegExp(`^\\s*${number}\\s*(?:-|–|to)\\s*${number}\\s*$`).exec(source)
      ?? new RegExp(`^\\s*${number}\\s*<=\\s*[A-Za-z][A-Za-z0-9_]*\\s*<=\\s*${number}\\s*$`).exec(source);
    if (!interval) fail(`${input.id} source interval syntax is unsupported`);
    const start = parseMathExpression(interval[1]!).evaluate(0), end = parseMathExpression(interval[2]!).evaluate(0);
    if (!(start < end)) fail(`${input.id} source interval must be increasing`);
    source = String(input.intervalComponent === "start" ? start : input.intervalComponent === "end" ? end : end - start);
  }
  if (input.component !== undefined) {
    if (!Number.isInteger(input.component) || input.component < 0 || input.component > 2 || !/^\([\s\S]*\)$/.test(source)) fail(`${input.id} requires an explicit source tuple component`);
    const field = path.split(".").at(-1)!;
    const expectedComponent = field === "start" ? 0 : field === "end" ? 1 : /^\d+$/.test(field) ? Number(field) : null;
    if (expectedComponent !== input.component) fail(`${input.id} source tuple component differs from the input observable's coordinate`);
    const components = source.slice(1, -1).split(",");
    if (components.length < 2 || components.length > 3 || input.component >= components.length) fail(`${input.id} source tuple component is out of bounds`);
    if (components.length === 3 && meaning.dimension !== "dimensionless" && input.component < 2 && parseMathExpression(components[2]!).evaluate(0) !== 0) fail(`${input.id} planar construction cannot omit a nonzero third source component`);
    source = components[input.component]!;
  } else if (source.includes(",")) fail(`${input.id} tuple needs a component selection`);
  const integerWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const supplied = (countWord ? integerWords[source.toLowerCase()]! : parseMathExpression(source).evaluate(0)) * sourceFactor;
  const value = parseMathExpression(expressionToSafeSource(expression.root)).evaluate(0);
  const actual = value * declaredFactor;
  if (!Number.isFinite(value) || !Number.isFinite(actual) || !Number.isFinite(supplied) || Math.abs(value) > 1e12 || actual !== supplied && (actual === 0 || supplied === 0 || Math.abs(actual - supplied) > RELATIVE_ERROR * Math.max(Math.abs(actual), Math.abs(supplied)))) fail(`${input.id} expression contradicts its source measurement/conversion`);
  return { value, unit: input.unit };
}

function mathematicalConstant(problem: ProblemIR, raw: Record<string, unknown>, step: MechanicsProgramStep, path: string, output?: MechanicsProgramOutput): number | { value: number; unit: string } {
  fields(raw, ["constant", "unit", "factId"], "mathematical constant");
  const constants: Record<string, number> = { zero: 0, one: 1, minus_one: -1, pi: Math.PI, e: Math.E };
  if (typeof raw.constant !== "string" || !Object.hasOwn(constants, raw.constant) || typeof raw.factId !== "string" || !step.evidenceFactIds.includes(raw.factId)) fail(`${path} needs an explicit mathematical constant and assumption fact`);
  const fact = sourceFact(problem, raw.factId);
  const dimension = role(path).dimension;
  const owner = label(problem, expectedOwner(step, path));
  const coordinate = Number(path.split(".").at(-1));
  let basis = false;
  if (dimension === "dimensionless" && names(fact.evidence.quote, owner) && Number.isInteger(coordinate)) {
    const tuples = [...fact.evidence.quote.matchAll(/\b(?:direction|tangent)\s*(?:is|=|:)?\s*\(([^()]*)\)\s*1\b/gi)];
    if (tuples.length === 1) {
      const components = tuples[0]![1]!.split(",");
      basis = coordinate < components.length && parseMathExpression(components[coordinate]!).evaluate(0) === constants[raw.constant];
    } else {
      const direction = /\b(?:direction|parallel to|along)\s+([+-]?)([xyz])\b/i.exec(fact.evidence.quote) ?? /([+-]?)([xyz])[- ]axis\b/i.exec(fact.evidence.quote);
      if (direction) basis = (coordinate === "xyz".indexOf(direction[2]!.toLowerCase()) ? direction[1] === "-" ? -1 : 1 : 0) === constants[raw.constant];
      else if (step.inputs.frame === "inertial_xy" && /(?:^|\.)supports\.\d+\.direction\.\d+$/.test(path) && /\bupward[- ]only\s+(?:supports?|contacts?)\b/i.test(fact.evidence.quote)) basis = (coordinate === 1 ? 1 : 0) === constants[raw.constant];
    }
  }
  if (!basis && dimension === "dimensionless" && /^axis\.direction\.\d+$/.test(path) && /\binertial\b/i.test(fact.evidence.quote) && /\+x\s+right/i.test(fact.evidence.quote) && /\+y\s+up/i.test(fact.evidence.quote) && /\+z\s+out/i.test(fact.evidence.quote)) {
    const declared = sourceAxisDirection(problem, step);
    if (declared && declared["xyz"[coordinate] as "x" | "y" | "z"] !== constants[raw.constant]) fail("a global frame basis cannot override an explicitly different physical axis");
    const axisFacts = step.evidenceFactIds.map(factId => sourceFact(problem, factId, problem.facts.find(source => source.id === factId)?.kind === "requested")).filter(source => source.kind !== "requested" && names(source.evidence.quote, owner));
    const named = /^[xyz]$/.test(owner) ? owner : axisFacts.flatMap(source => [...source.evidence.quote.matchAll(/\b(?:normal|central|direction)\s+([xyz])\b/gi)]).at(-1)?.[1]?.toLowerCase();
    // Planar source points use the stated +z normal for the moment reference;
    // a separately named x/y/z axis retains its own basis instead.
    if (axisFacts.length) basis = declared ? declared["xyz"[coordinate] as "x" | "y" | "z"] === constants[raw.constant] : (coordinate === "xyz".indexOf(named ?? "z") ? 1 : 0) === constants[raw.constant];
  }
  const statedCoordinates = [...sourceClause(problem, fact.evidence.quote, fact.evidence.start).matchAll(/\(([^()]*,[^()]*)\)\s*(?:m|cm|mm)\b/g)];
  const contradictsOrigin = statedCoordinates.some(match => match[1]!.split(",").some(value => parseMathExpression(value).evaluate(0) !== 0));
  const origin = raw.constant === "zero" && dimension === "length" && names(fact.evidence.quote, owner) && !contradictsOrigin && /\b(?:origin|centre|center)\b/i.test(fact.evidence.quote) && /\b(?:at|through|choose|take|use)\b/i.test(fact.evidence.quote);
  const signedFrame = /\binertial\b/i.test(fact.evidence.quote) && /\+x\s+right/i.test(fact.evidence.quote) && /\+y\s+up/i.test(fact.evidence.quote) && /\+z\s+out/i.test(fact.evidence.quote);
  const originalPosition = /\borigin\b/i.test(problem.question) || /\b[xyz](?:_[A-Za-z][A-Za-z0-9_]*)?\s*=\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:m|cm|mm)\b(?!\s*[/^²³])/i.test(problem.question) || [...problem.question.matchAll(/\([^()]*,[^()]*\)/g)].some(match => {
    const after = problem.question.slice(match.index! + match[0].length);
    if (/^\s*(?:N|kg|rad|1)\b|^\s*(?:m|cm|mm)\s*(?:\/|s\s*[-^⁻])/i.test(after)) return false;
    if (/^\s*(?:m|cm|mm|metres?|meters?)\b(?!\s*[/^²³])/i.test(after)) return true;
    const before = problem.question.slice(Math.max(0, match.index! - 128), match.index!);
    if (/\b(?:velocity|speed|acceleration|force|gravity|direction)\b[^.;()]*$/i.test(before)) return false;
    if (/\b(?:position|coordinates?|centre|center|COM|pivot|reference|point)\b[^.;()]*$/i.test(before)) return true;
    const assignment = /\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*$/.exec(before);
    return !!assignment && problem.entities.some(entity => entity.label === assignment[1] && ["point", "line", "body", "solid"].includes(entity.kind));
  });
  const surfacePath = path.startsWith("circularContact.surface.") ? "circularContact.surface" : "surface";
  const surfaceId = expectedOwner(step, surfacePath);
  const horizontalSurface = surfaceId !== step.ownerId && surfaceId !== step.axisId && step.evidenceFactIds.some(factId => {
    const source = sourceFact(problem, factId, problem.facts.find(candidate => candidate.id === factId)?.kind === "requested");
    return source.kind !== "requested" && names(source.evidence.quote, label(problem, surfaceId)) && /\bhorizontal\b/i.test(source.evidence.quote) && /\b(?:surface|ground|plane)\b/i.test(source.evidence.quote);
  });
  if (!basis && dimension === "dimensionless" && signedFrame && horizontalSurface && /^(?:surface|circularContact\.surface)\.tangent\.[01]$/.test(path)) basis = constants[raw.constant] === (coordinate === 0 ? 1 : 0);
  const invariantOutput = output !== undefined && !/^(?:[xyz]|r$|position|L(?:_|$)|tau(?:_|$))/.test(observableSymbol(output.symbol, step, problem));
  const frameMode = step.operator === "rigid_body_motion" && [undefined, "dynamics", "kinematic"].includes(step.inputs.mode as never) || step.operator === "rolling_contact";
  const framePoint = path.startsWith("position.") && step.operator === "rigid_body_motion" || /^(?:surface|circularContact\.surface)\.point\.[01]$/.test(path) && horizontalSurface || path.startsWith("referencePoint.") && step.operator === "rigid_body_motion" && /^[+-]?[xyz]$/.test(label(problem, step.axisId));
  const frameOrigin = raw.constant === "zero" && dimension === "length" && frameMode && invariantOutput && !originalPosition && signedFrame && framePoint;
  const centralGauge = raw.constant === "zero" && dimension === "length" && !contradictsOrigin && !/\([^()]*,[^()]*\)/.test(problem.question) && names(fact.evidence.quote, label(problem, step.ownerId)) && names(fact.evidence.quote, label(problem, step.axisId)) && /\b(?:central|COM|centre|center)\b/i.test(fact.evidence.quote) && (path.startsWith("axis.point.") || /^(?:components\.\d+\.center|position)\.\d+$/.test(path));
  const beginsAtZero = /(?:\(\s*0\s*,|\b0\s*[-–]\s*[-+\d]|\b0\s*<=\s*[A-Za-z]|\b(?:from|start(?:s|ing)?\s+at)\s+0\b)/i.test(fact.evidence.quote);
  const durationOnly = /\bfor\s+[-+\d.]/i.test(fact.evidence.quote) && !/\b(?:interval|during|from)\b/i.test(fact.evidence.quote);
  const clock = raw.constant === "zero" && names(fact.evidence.quote, owner) && (/(?:^|\.)(?:start|initialAt)$/.test(path) && (beginsAtZero || durationOnly) || path === "time" && /\b(?:initial(?:ly)?|this\s+instant)\b/i.test(fact.evidence.quote) && !/\bafter\s+[-+\d]/i.test(sourceClause(problem, fact.evidence.quote, fact.evidence.start)));
  const absentKind = dimension === "force" ? "(?:force|load)" : dimension === "angular_impulse" ? "angular\\s+impulse" : "(?:torque|couple)";
  const appliedCouple = step.operator === "rolling_contact" && path === "externalTorque" ? "|no\\s+applied\\s+couples?|no\\s+(?:(?:other|additional|horizontal|external|applied)\\s+){0,4}forces?\\s+(?:or|and)\\s+couples?" : "";
  const absences = [...fact.evidence.quote.matchAll(new RegExp(`\\b(?:no\\s+(?:(?:other|additional)\\s+)?(?:external\\s+)?${absentKind}s?|(?:external\\s+)?${absentKind}\\s+(?:is\\s+)?zero|zero\\s+(?:external\\s+)?${absentKind}${appliedCouple})\\b`, "gi"))];
  const absence = raw.constant === "zero" && ["force", "torque", "angular_impulse"].includes(dimension) && absences.some(match => {
    const prefix = fact.evidence.quote.slice(0, match.index);
    const ownerId = expectedOwner(step, path);
    const priorOwners = priorPropertyOwners(problem, ownerId, step.axisId, prefix, scalarRole(path), ownerId === step.ownerId);
    const ownerNames = new Set(priorOwners.map(value => value.id));
    const actor = propertyActors(problem, step.axisId, prefix, ownerNames.size === 1 && ownerNames.has(ownerId)).at(-1);
    return priorOwners[0]?.id === ownerId && (!actor || actor.index < priorOwners[0].at || actor.name === owner);
  });
  const rest = raw.constant === "zero" && ["velocity", "angular_velocity"].includes(dimension) && assertedRest(fact.evidence.quote, owner, problem);
  if (!basis && !origin && !frameOrigin && !centralGauge && !clock && !absence && !rest) fail(`${path} cannot turn a mathematical constant into an unstated physical measurement`);
  if (raw.unit === undefined) { if (!basis) fail(`${path} gauge requires a declared coordinate/time unit`); return constants[raw.constant]!; }
  if (typeof raw.unit !== "string") fail(`${path} constant unit must be explicit`);
  mechanicsUnitFactor(raw.unit, dimension);
  return { value: constants[raw.constant]!, unit: raw.unit };
}

function sourceLockingInventory(problem: ProblemIR, owner: string, rotorOwners: string[]): void {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16 };
  const count = `(?:\\d+|${Object.keys(words).join("|")})`;
  const bodies = "(?:(?:rigid|uniform|thin|solid|coaxial|coaxially|frictionless|stationary)\\s+){0,6}(?:rotors?|flywheels?|wheels?|discs?|disks?|rings?|bodies|components)\\b";
  const composition = new RegExp(`(?<![\\p{L}\\p{N}_])${escape(owner)}(?![\\p{L}\\p{N}_])\\s+(?:consists?\\s+of|comprises?|contains?|includes?|is\\s+(?:composed\\s+of|made\\s+up\\s+of|formed\\s+from))\\s+`, "giu");
  const prefix = new RegExp(`^\\s*(?:the\\s+)?(?:exactly\\s+)?(${count})?\\s*${bodies}\\s*:?\\s*`, "i");
  const counted = new RegExp(`\\b(${count})\\s+${bodies}\\s*:?\\s*`, "gi");
  const formsOwner = new RegExp(`\\b(?:form|forming|constitute|make\\s+up|lock\\s+(?:together\\s+)?as)\\s+(?:(?:a|the|combined|rigid|system|assembly)\\s+){0,5}${escape(owner)}(?![\\p{L}\\p{N}_])`, "iu");
  const atom = "[\\p{L}][\\p{L}\\p{N}_-]{0,127}";
  const list = new RegExp(`^\\s*(?:(?:named|labelled|labeled|denoted)\\s+)?\\(?\\s*(${atom}(?:\\s*(?:,\\s*(?:and\\s+)?|and\\s+|&\\s*)${atom})+)`, "u");
  for (const clause of problem.question.split(/[!?;]|\.(?=\s|$)/)) {
    if (!names(clause, owner)) continue;
    const declarations: Array<{ tail: string; count?: string }> = [];
    for (const relation of clause.matchAll(composition)) {
      const tail = clause.slice(relation.index! + relation[0].length);
      const head = prefix.exec(tail);
      declarations.push({ tail: head ? tail.slice(head[0].length) : tail, ...(head?.[1] ? { count: head[1] } : {}) });
    }
    if (!declarations.length) {
      const heads = [...clause.matchAll(counted)];
      if (!heads.length && formsOwner.test(clause)) {
        const head = new RegExp(`\\b${bodies}\\s*:?\\s*`, "gi").exec(clause);
        if (head) declarations.push({ tail: clause.slice(head.index + head[0].length) });
      }
      for (const head of heads) declarations.push({ tail: clause.slice(head.index! + head[0].length), count: head[1] });
    }
    for (const declaration of declarations) {
      const printed = list.exec(declaration.tail)?.[1];
      const members = printed ? printed.split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/).map(name => name.trim()) : null;
      const statedCount = declaration.count === undefined ? members?.length : words[declaration.count.toLowerCase()] ?? Number(declaration.count);
      if (statedCount === undefined || !Number.isInteger(statedCount) || statedCount < 2 || statedCount > 16 || statedCount !== rotorOwners.length) fail("locking model must retain the original source composition and rotor count");
      if (members && (new Set(members).size !== members.length || members.length !== statedCount || members.some(name => !rotorOwners.includes(name)))) fail("locking model omits or replaces a rotor explicitly named in the original source system");
    }
  }
}

function sourceModel(problem: ProblemIR, step: MechanicsProgramStep, sourceInputs: ReadonlyMap<string, MechanicsProgramInput>): void {
  const axial = String(step.operator) === "axial_rotation";
  const facts = step.evidenceFactIds.map(factId => sourceFact(problem, factId, problem.facts.find(fact => fact.id === factId)?.kind === "requested", axial && ["redistribution", "inertia_law"].includes(String(step.inputs.mode))));
  const assertions = facts.filter(fact => fact.kind !== "requested");
  const text = assertions.map(fact => fact.evidence.quote).join("; ");
  const descriptions = facts.map(fact => fact.evidence.quote).join("; ");
  const owner = label(problem, step.ownerId);
  label(problem, step.axisId);
  if (step.operator === "mass_moments") {
    if (!Array.isArray(step.inputs.components) || step.inputs.components.length < 1 || step.inputs.components.length > 16) fail("mass components are bounded to sixteen");
    const seen = new Set<string>();
    step.inputs.components.forEach((raw, i) => {
      if (!record(raw)) fail("mass component must be explicit");
      const ownerId = expectedOwner(step, `components.${i}.mass`); const name = label(problem, ownerId);
      if (seen.has(ownerId)) fail("a source mass component cannot be counted twice"); seen.add(ownerId);
      const own = assertions.filter(fact => names(fact.evidence.quote, name)).map(fact => fact.evidence.quote).join("; ");
      const shape = String(raw.shape).replaceAll("_", " ");
      const namedShape = ["rod", "ring", "disc", "cylinder", "sphere", "spherical shell"].find(shape => name.toLowerCase() === shape);
      if (namedShape && namedShape !== shape) fail("component shape contradicts its named source body");
      if (raw.shape === "point" ? !/\bpoint mass(?:es)?\b|\bparticles?\b/i.test(own) : !positiveDensity(own, name, String(raw.shape))) fail(`${name} shape/density assumption is not positively stated for that owner`);
      if (raw.operation === "remove" && !/\b(?:removed|cut out|hole|cavity)\b/i.test(own)) fail(`${name} removal is not a source assumption`);
    });
    const collective = /\b(?:combined|remaining|assembly|massless\s+(?:rigid\s+)?connector|massless\s+links|rigidly\s+attached)\b/i.test(problem.question);
    if (collective && step.inputs.components.length < sourceScalarDeclarations(problem.question, "mass")) fail("mass model omits a declared source component of the requested combined/remaining body");
    if (seen.size === 1 && !seen.has(step.ownerId) && !/\b(?:system|assembly|combined|masses)\b/i.test(owner)) fail("single body model cannot rename another source component as its owner");
    if (seen.size > 1 && !facts.some(fact => names(fact.evidence.quote, owner) && [...seen].every(value => names(fact.evidence.quote, label(problem, value))))) fail("composite system must retain every named source component");
  }
  if (step.operator === "rigid_body_motion") {
    if (![undefined, "dynamics", "kinematic", "translation", "particle", "wrench", "equilibrium"].includes(step.inputs.mode as never)) fail("body source mode is unsupported");
    const model = step.inputs.mode === "translation" ? /\b(?:system|particles?|bodies|body|block)\b/i : step.inputs.mode === "particle" ? /\b(?:particle|point mass)\b/i : /\b(?:rigid|rotor|flywheel|wheel|ring|disc|rod|sphere|cylinder|bar|beam|body)\b/i;
    if (!names(text, owner) || !model.test(text) || !/\binertial\b/i.test(text) || !/\b(?:anticlockwise|counterclockwise)\b/i.test(text) || !/\+z\s+out/i.test(text)) fail("body motion needs its source model and signed inertial frame");
    if (step.inputs.frame !== "incline_xy" && (!/\+x\s+right/i.test(text) || !/\+y\s+up/i.test(text))) fail("body motion must preserve the declared inertial xy basis");
    if (step.inputs.frame === "incline_xy" && (!/\bdownhill\b/i.test(text) || !/\b(?:outward|normal|perpendicular)\b/i.test(text))) fail("incline frame needs source downhill and outward-normal axes");
    if (step.inputs.mode === "translation") {
      const single = !Array.isArray(step.inputs.masses) && !Array.isArray(step.inputs.particles) && /\b(?:closed\s+\S*\s*body|block|body)\b/i.test(text);
      if (!single && (!/\b(?:closed|system|joined|connected|combined|rigidly\s+attached)\b/i.test(text) || !/\b(?:action[- ]reaction|internal[^.;]*equal[^.;]*opposite|third law)\b/i.test(text))) fail("COM dynamics require the closed source system and internal action-reaction assumption");
      if (record(step.inputs.hypotheses) && step.inputs.hypotheses.isolated === true && !/\b(?:isolated|no external force|zero external force)\b/i.test(text)) fail("isolated COM motion requires source zero external force");
      if (record(step.inputs.hypotheses) && step.inputs.hypotheses.zeroExternalImpulse === true && !/\b(?:no|zero)\s+external\s+(?:planar\s+)?impulse\b/i.test(text)) fail("conserved COM velocity requires source zero external impulse");
      if (record(step.inputs.hypotheses) && step.inputs.hypotheses.constantExternalForce === true && !/\bconstant\b[^.;]*\bforce\b/i.test(text)) fail("COM time advance needs a source constant external force");
    }
    if (step.inputs.mode === "equilibrium" && (!/\b(?:rests?|equilibrium|balance|reactions?)\b/i.test(descriptions) || !/\b(?:supports?|contacts?|pin|cable|fixed)\b/i.test(text))) fail("equilibrium requires source static supports and the rest/balance premise");
    if (step.inputs.fixedReference === true && !new RegExp(`\\b(?:fixed|stationary)\\s+(?:centre|center|(?:central\\s+normal\\s+)?axis)\\s+${escape(label(problem, step.axisId))}\\b|\\b${escape(owner)}[^.;]*\\b(?:fixed|stationary)\\s+(?:centre|center|axis)\\b`, "i").test(text)) fail("fixed-reference zero translation requires the source fixed centre/axis");
    const bodyGeometry = record(step.inputs.bodyGeometry) ? step.inputs.bodyGeometry : undefined;
    if (step.inputs.fixedReference === true && step.inputs.position === undefined && bodyGeometry?.center === undefined && bodyGeometry?.endpoints === undefined && (new RegExp(`\\b${escape(label(problem, step.axisId))}\\s*=\\s*\\([^()]*,[^()]*\\)`, "u").test(problem.question) || /\b(?:COM|centre|center)\s+(?:[A-Za-z][A-Za-z0-9_]*\s*)?=\s*\([^()]*,[^()]*\)/i.test(problem.question))) fail("known fixed-centre coordinates must be bound; an omitted-pose gauge cannot replace them");
    if (step.inputs.atRest === true || step.inputs.initialAtRest === true) {
      if (!assertions.some(fact => assertedRest(fact.evidence.quote, owner, problem))) fail("rest-derived zeros require the named source body at rest");
    }
    const circularSurface = record(step.inputs.circularContact) && record(step.inputs.circularContact.surface) ? step.inputs.circularContact.surface : undefined;
    if (circularSurface?.stationary !== undefined) {
      const surfaceId = step.sourceOwners?.["circularContact.surface"];
      if (circularSurface.stationary !== true || !surfaceId || surfaceId === step.ownerId || surfaceId === step.axisId) fail("native surface stationarity requires a distinct explicitly bound source surface");
      const surfaceName = label(problem, surfaceId);
      const noun = "(?:ground(?:\\s+surface)?|surface|plane|floor|track)";
      const modifiers = "(?:(?:a|the|horizontal|vertical|flat|rough|smooth|rigid|fixed|inclined)\\s+){0,6}";
      const designation = new RegExp(`\\b${noun}\\s+${escape(surfaceName)}(?![\\p{L}\\p{N}_])|(?<![\\p{L}\\p{N}_])${escape(surfaceName)}\\s+(?:is|denotes)\\s+(?:stationary\\s+and\\s+(?:is\\s+)?)?${modifiers}${noun}\\b`, "iu");
      const surfaceFacts = assertions.map(fact => sourceClause(problem, fact.evidence.quote, fact.evidence.start));
      const described = /^(?:ground|surface|plane|floor|track)$/i.test(surfaceName) ? surfaceFacts.some(text => names(text, surfaceName)) : surfaceFacts.some(text => designation.test(text));
      if (!described || !surfaceFacts.some(text => assertedStationarySurface(text, surfaceName))) fail("native surface stationarity must be the original ground/surface's own positive predicate");
    }
    if (Array.isArray(step.inputs.particles)) step.inputs.particles.forEach((particle, i) => {
      if (record(particle) && particle.atRest === true && !assertions.some(fact => assertedRest(fact.evidence.quote, label(problem, expectedOwner(step, `particles.${i}.mass`)), problem))) fail("a particle rest premise must retain its own source owner");
    });
    if (record(step.inputs.derivation) && step.inputs.derivation.kind === "sticking_collision" && (!/\b(?:sticks?|sticking|putty)\b/i.test(text) || !/\b(?:rigid|rod|body)\b/i.test(text))) fail("sticking impact requires the source rigid body and sticking law");
    if (record(step.inputs.derivation) && step.inputs.derivation.kind === "sticking_collision" && Array.isArray(step.inputs.derivation.bodies)) {
      step.inputs.derivation.bodies.forEach((body, i) => {
        if (record(body) && body.atRest === true && !assertions.some(fact => assertedRest(fact.evidence.quote, label(problem, expectedOwner(step, `derivation.bodies.${i}.mass`)), problem)))
          fail("pre-impact rest must be stated for that exact source participant; a fixed pivot or stationary axis does not determine its spin");
      });
    }
    const supportsPath = Array.isArray(step.inputs.supports) ? "supports" : record(step.inputs.derivation) && Array.isArray(step.inputs.derivation.supports) ? "derivation.supports" : undefined;
    if (supportsPath) (inputAt(step.inputs, supportsPath) as unknown[]).forEach((raw, i) => {
      if (!record(raw)) fail("source support must be a data object");
      const point = expectedOwner(step, `${supportsPath}.${i}.point`), name = label(problem, point);
      if (raw.id !== point && raw.id !== name) fail("support selector must retain its source point owner");
      const kind = raw.kind;
      const stated = kind === "pin" ? new RegExp(`\\bpin\\s+${escape(name)}\\b`, "i") : kind === "cable" ? new RegExp(`\\bcable\\s+(?:connects?|at|from)\\s+${escape(name)}\\b`, "i") : new RegExp(`\\b(?:supports?|contacts?)\\s+[^.;]*\\b${escape(name)}(?=\\s*=|\\s*,|\\s+and|$)`, "i");
      if (!assertions.some(fact => stated.test(fact.evidence.quote))) fail("support type must be stated for its particular source point");
    });
    for (const forcePath of ["forces", "derivation.forces"]) {
      const forceList = inputAt(step.inputs, forcePath);
      if (Array.isArray(forceList)) forceList.forEach((raw, i) => {
        if (!record(raw)) return;
        const sourceOwner = expectedOwner(step, `${forcePath}.${i}.${raw.weight === undefined ? "force" : "weight.mass"}`);
        if (raw.id !== undefined && raw.id !== sourceOwner && raw.id !== label(problem, sourceOwner)) fail("applied-force selector must retain its source load owner");
        if (raw.weight !== undefined) return;
        const leaves: string[] = [];
        const collect = (value: unknown): void => { if (Array.isArray(value)) value.forEach(collect); else if (record(value)) Object.values(value).forEach(collect); else if (typeof value === "string" && sourceInputs.has(value)) leaves.push(value); };
        collect(raw.force);
        const pointOwner = expectedOwner(step, `${forcePath}.${i}.point`);
        if (!leaves.length || !leaves.some(id => { const input = sourceInputs.get(id)!; const quote = sourceFact(problem, input.factId).evidence.quote; const index = quote.indexOf(input.sourceExpression); return index >= 0 && firstApplicationOwner(problem, quote.slice(index + input.sourceExpression.length)) === pointOwner; })) fail("applied force must retain its actual source application point");
      });
    }
    const loads = Array.isArray(step.inputs.forces) ? step.inputs.forces : record(step.inputs.derivation) && Array.isArray(step.inputs.derivation.forces) ? step.inputs.derivation.forces : undefined;
    if (loads && (step.inputs.mode === "equilibrium" || record(step.inputs.derivation) && step.inputs.derivation.kind === "equilibrium")) {
      const weights = loads.filter(load => record(load) && load.weight !== undefined).length;
      if (weights && weights < sourceScalarDeclarations(problem.question, "mass")) fail("equilibrium model omits a declared source gravity load");
    }
    if (loads && ["wrench", "equilibrium"].includes(String(step.inputs.mode)) && loads.filter(load => record(load) && load.force !== undefined).length < sourceScalarDeclarations(problem.question, "force")) fail("force model omits a declared source applied force");
  }
  if (step.operator === "rigid_body_state" && step.inputs.offset !== undefined) {
    const point = step.sourceOwners?.offset;
    if (!point || !facts.some(fact => names(fact.evidence.quote, owner) && names(fact.evidence.quote, label(problem, point)) && /\b(?:point|offset|on|belongs)\b/i.test(fact.evidence.quote))) fail("point state needs a source-bound point on the same body");
  }
  if (step.operator === "rolling_contact") {
    const surface = step.sourceOwners?.surface;
    if (!surface || !names(text, label(problem, surface)) || !names(text, owner) || !/\b(?:surface|ground|contact|plane)\b/i.test(text)) fail("rolling contact needs both its named body and source surface");
    if (step.inputs.regime === "no_slip" ? !/\b(?:without slipping|no[- ]slip|no slipping|rolls?\s+steadily|released\s+from\s+rest)\b/i.test(text) : !/\b(?:slides?|sliding|slipping|kinetic friction|mu_k)\b/i.test(text) || /\bwithout slipping\b/i.test(text)) fail("contact regime is not the source regime");
    if (step.inputs.time === undefined) fail("contact state needs an explicitly bound evaluation time");
    if (step.inputs.time === "transition" && !/\b(?:first\s+(?:no[- ]slip|zero[- ]slip)|slip\s+first\s+becomes\s+zero|transition)\b/i.test(descriptions)) fail("derived contact time must be the source first zero-slip event");
    if ((step.inputs.gravity !== undefined || step.inputs.gravityMagnitude !== undefined) && step.inputs.externalForce === undefined && !/\b(?:only\s+(?:noncontact|non-contact|external)\s+(?:load|force)|no\s+(?:other|additional|horizontal)\s+(?:horizontal\s+|external\s+|applied\s+)?(?:force|load)|no\s+applied\s+force\s+except\s+gravity)\b/i.test(text)) fail("omitted additional contact loads need an explicit source absence assumption");
  }
  if (step.operator === "angular_impulse" && (!names(text, label(problem, step.axisId)) || !/\b(?:axis|about)\b/i.test(text) || step.inputs.axisId !== step.axisId)) fail("angular impulse requires the same declared reference axis");
  if (axial) {
    const fixed = step.inputs.mode === "angle_law" ? /\b(?:about|axis)\b/i.test(text) : new RegExp(`\\b(?:fixed|stationary)\\s+(?:axis\\b|${escape(label(problem, step.axisId))}\\b)`, "i").test(text);
    if (!names(text, owner) || !names(text, label(problem, step.axisId)) || !fixed || !/\binertial\b/i.test(text) || !/\b(?:anticlockwise|counterclockwise)\b/i.test(text) || step.inputs.axisId !== step.axisId) fail("axial rotation needs its named owner, inertial axis and signed source convention");
    if (step.inputs.mode === "constant_inertia" && (!/\b(?:constant|fixed)\s+(?:(?:axial|central|normal)\s+)?(?:inertia|moment|I)\b/i.test(text) || !/\bconstant\s+(?:net\s+|axial\s+)?(?:torque|couple)\b/i.test(text))) fail("constant-I dynamics require source-stated constant inertia and torque");
    if (step.inputs.mode === "redistribution" && (!/\brigid\b/i.test(text) || !/\b(?:endpoint|configuration)s?\b/i.test(text))) fail("redistribution requires source-grounded rigid endpoint configurations");
    if (step.inputs.mode === "inertia_law" && (!/\binertia\b|\bI\s*\(/i.test(text) || !/\b(?:constant\s+(?:axial\s+)?torque|torque[^.;]*zero|zero[^.;]*torque|torque[- ]free)\b/i.test(text))) fail("inertia-law dynamics require the source function and constant/zero external torque over the interval");
    if (step.inputs.mode === "coaxial_locking") {
      if (!/\b(?:coaxial|coaxially)\b/i.test(text) || !/\block(?:ing)?\b/i.test(text) || !/\bno\s+external\s+angular\s+impulse\b/i.test(text) || !/\brigid\b/i.test(text) || !Array.isArray(step.inputs.rotors)) fail("coaxial locking requires its rigid source rotors, lock and zero external angular impulse");
      const owners = step.inputs.rotors.map((_rotor, i) => expectedOwner(step, `rotors.${i}.inertia`));
      if (new Set(owners).size !== owners.length || !facts.some(fact => names(fact.evidence.quote, owner) && owners.every(value => names(fact.evidence.quote, label(problem, value))))) fail("locking must retain every distinct source rotor in the same system");
      sourceLockingInventory(problem, owner, owners.map(value => label(problem, value)));
    }
    if (step.inputs.initialAtRest === true && !assertions.some(fact => assertedRest(fact.evidence.quote, owner, problem))) fail("initial axial rest must be a named source body premise, not a stationary axis");
  }
}

function observableSymbol(raw: string, step: MechanicsProgramStep, problem: ProblemIR): string {
  let value = (sourcePointBodyCoordinateSymbol(problem, step, raw) ?? raw).normalize("NFKC").replace(/\\(?:mathrm|text)\s*|[{}\s]/g, "");
  for (const ownerId of [step.ownerId, step.axisId, step.sourceOwners?.offset].filter((owner): owner is string => typeof owner === "string")) {
    const owner = label(problem, ownerId);
    value = value.replace(new RegExp(`_${escape(owner)}(?=$|[xy])`, "u"), "");
  }
  value = value.replace(/^(omega|alpha|tau|L|J_L)_z$/, "$1").replace(/^ω$/, "omega").replace(/^α$/, "alpha").replace(/^τ$/, "tau").replace(/^θ$/, "theta").replace(/^Δθ$/, "delta_theta");
  return value.replaceAll("_", "");
}
function namesMechanicsAxis(text: string, axis: string): boolean {
  return names(text, axis) || /^[xyz]$/.test(axis) && new RegExp(`(?<![\\p{L}\\p{N}_])(?:omega|ω|alpha|α|tau|τ|L|J_L)_\\{?${axis}(?=[,}\\s=()])`, "u").test(text);
}
export interface MechanicsRequestedObservableContext {
  geometry: MechanicsGeometry;
  claim: MechanicsClaim;
  requested: readonly ProblemFact[];
  sourceCase: MechanicsSourceCase | null;
  cache: ReadonlyMap<string, MechanicsGeometry>;
  sourceInputs?: ReadonlyMap<string, MechanicsProgramInput>;
  sourceReads?: readonly MechanicsSourceRead[];
  sourceStep?: MechanicsProgramStep;
}
/** Select a native symbol after source replay, requested time and source-case proof. */
export function mechanicsRequestedObservableSymbol(problem: ProblemIR, step: MechanicsProgramStep, raw: string, context: MechanicsRequestedObservableContext): string {
  const cases = mechanicsSourceCases(problem.question);
  const selected = context.sourceCase ?? (cases.length === 1 ? cases[0]! : fail("qualified observable needs the proved original experiment"));
  const canonicalCase = cases[selected.index];
  if (!canonicalCase || selected.start !== canonicalCase.start || selected.end !== canonicalCase.end || selected.text !== canonicalCase.text) fail("qualified observable source case differs from the original question");
  let value = raw.normalize("NFKC").replace(/\\(?:mathrm|text)\s*|[{}\s]/g, "");
  const epoch = /\(([^()]*)\)$/.exec(value);
  if (epoch) value = value.slice(0, epoch.index);
  if (/[()]/.test(value)) fail("observable has an unsupported time qualification");
  value = value.replace(/^ω/, "omega").replace(/^α/, "alpha").replace(/^τ/, "tau").replace(/^θ/, "theta");
  let phase: string | undefined;
  const phaseSuffix = /,([A-Za-z][A-Za-z0-9_]*|\d+)$/.exec(value);
  if (phaseSuffix && !/^[Va]_?C,[xy]$/.test(value)) { phase = phaseSuffix[1]!; value = value.slice(0, phaseSuffix.index); }
  const eventSymbol = /^t_?(\d+)$/.exec(value);
  if (eventSymbol) { phase = phase ?? eventSymbol[1]!; value = "t"; }
  if (phase) {
    if (/^\d+$/.test(phase)) { if (Number(phase) !== selected.index + 1) fail("observable phase differs from the proved source experiment"); }
    else if (selected.index === 0 || !names(selected.text, phase)) fail("observable phase is not a condition of the proved alternative experiment");
  }
  const axis = /^(?:omega|alpha|tau|L|J_L)_([A-Za-z][A-Za-z0-9]*)$/.exec(value);
  if (axis && value !== context.claim.symbol && !["initial", "final"].includes(axis[1]!)) {
    const namedAxis = label(problem, step.axisId);
    const declared = axis[1] === "z" && namedAxis !== "z" ? sourceAxisDirection(problem, step) : null;
    if (axis[1] !== namedAxis && !(axis[1] === "z" && declared?.x === 0 && declared.y === 0 && declared.z === 1)) fail("observable uses a different physical axis");
  }
  const reference = context.geometry.mechanicsValue ? context.cache.get(context.geometry.mechanicsValue.modelId) : context.geometry;
  const model = reference?.kind === "point" ? reference.mechanicsModel : undefined;
  const source = model?.source as unknown as Record<string, unknown> | undefined;
  const law = source && (record(source.angularLaw) ? source.angularLaw : record(source.inertiaLaw) ? source.inertiaLaw : undefined);
  const currentTime = source && typeof source.time === "number" ? source.time : law && typeof law.at === "number" ? law.at : model?.kind === "rolling_contact" && source?.time === "transition" ? model.state.transitionTimeSI : null;
  const initialTime = law && typeof law.initialAt === "number" ? law.initialAt : 0;
  const evaluatedTime = /(?:^|_)initial(?:_|$)/.test(context.claim.symbol) ? initialTime : currentTime;
  const kind = context.geometry.mechanicsValue?.kind ?? (model?.kind === "rolling_contact" && context.claim.symbol === "u" ? "contact_slip" : model?.kind === "rolling_contact" && context.claim.symbol === "t_roll" ? "transition_time" : undefined);
  const eventEpoch = epoch && /^t_?(\d+)$/.exec(epoch[1]!);
  if (eventSymbol || eventEpoch) {
    if (model?.kind !== "rolling_contact" || source?.regime !== "sliding" || model.state.transitionTimeSI === null) fail("event-qualified observable requires a verified finite sliding transition");
    if (eventEpoch && Number(eventEpoch[1]) !== selected.index + 1) fail("observable event belongs to a different source experiment");
    if (!eventSymbol && source.time !== "transition" && !["V_roll_x", "V_roll_y", "omega_roll", "K_roll"].includes(context.claim.symbol)) fail("an initial contact state cannot answer an event-qualified observable");
  } else if (epoch) {
    const time = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(milliseconds?|seconds?|ms|s)$/.exec(epoch[1]!);
    const zero = epoch[1] === "0" && context.requested.some(fact => /\binitial\b/i.test(fact.evidence.quote) && queryObservable(fact.evidence.quote, raw, context.claim, context.geometry, { cache: context.cache, step, problem }));
    let sourceEpoch: number | null = null;
    if (!zero && context.sourceInputs && context.sourceReads && context.sourceStep) {
      const angular = source && record(source.angularLaw) ? source.angularLaw : null;
      const angularLaw = angular && typeof angular.expression === "string" && typeof angular.at === "number" && typeof angular.timeScale === "number"
        ? { expression: angular.expression, at: angular.at, timeScale: angular.timeScale } : null;
      sourceEpoch = mechanicsFunctionalEpochSI(problem, epoch[1]!, { step: context.sourceStep, inputs: context.sourceInputs,
        sourceReads: context.sourceReads, requested: context.requested, sourceCase: selected, observable: context.claim.symbol, law: angularLaw });
    }
    if (!time && !zero && sourceEpoch === null) fail("observable time must be a supported source time or proved initial/event epoch");
    const expected = sourceEpoch ?? (time ? parseMathExpression(time[1]!).evaluate(0) * mechanicsUnitFactor(time[2]!, "time") : 0);
    if (evaluatedTime === null || !Number.isFinite(expected) || expected !== evaluatedTime && (sourceEpoch !== null || expected === 0 || evaluatedTime === 0 || Math.abs(expected - evaluatedTime) > RELATIVE_ERROR * Math.max(Math.abs(expected), Math.abs(evaluatedTime)))) fail("observable qualification differs from its independently evaluated source time");
  }
  const velocity = /^V_?C,?([xy])$/.exec(value), acceleration = /^a_?C,?([xy])$/.exec(value);
  if (velocity && (kind === "com_velocity" || /^V(?:x|y|_roll_[xy])$/.test(context.claim.symbol))) value = `V${velocity[1]}`;
  if (acceleration && (kind === "com_acceleration" || /^a[xy]$/.test(context.claim.symbol))) value = `a${acceleration[1]}`;
  if (/^v_?slip$/.test(value) && kind === "contact_slip") value = "u";
  if (value === "E" && (kind === "kinetic_energy" || context.claim.symbol === "K")) value = "K";
  if (value === "t" && (eventSymbol || eventEpoch) && kind === "transition_time") value = "t_roll";
  if (eventEpoch) {
    const eventClaims: Record<string, string> = { Vx: "V_roll_x", Vy: "V_roll_y", omega: "omega_roll", K: "K_roll" };
    const native = observableSymbol(value, step, problem);
    if (eventClaims[native] === context.claim.symbol) value = context.claim.symbol;
  }
  return observableSymbol(value, step, problem);
}
function queryObservable(text: string, symbol: string, claim: MechanicsClaim, geometry?: MechanicsGeometry, context?: { cache: ReadonlyMap<string, MechanicsGeometry>; step: MechanicsProgramStep; problem: ProblemIR }): boolean {
  const matches = [...text.matchAll(/\b(?:find|calculate|determine|compute|give|report|solve|derive)\b[^.;!?]*/gi)];
  const queries = matches.filter(query => {
    const before = text.slice(0, query.index);
    return !/\b(?:not|never)\s*$/i.test(before) && (before.match(/"/g)?.length ?? 0) % 2 === 0 && (before.match(/“/g)?.length ?? 0) === (before.match(/”/g)?.length ?? 0);
  });
  if (matches.length && !queries.length) return false;
  if (queries.length && !(queries.length === 1 && queries[0]![0] === text)) return queries.some(query => queryObservable(query[0], symbol, claim, geometry, context));
  const modelKind = geometry?.kind === "point" ? geometry.mechanicsModel?.kind : undefined;
  const kind = geometry?.mechanicsValue?.kind ?? (modelKind === "rolling_contact" && claim.symbol === "u" ? "contact_slip" : modelKind === "rolling_contact" && claim.symbol === "t_roll" ? "transition_time" : modelKind === "rolling_contact" && /^f(?:x|y)?$/.test(claim.symbol) ? "friction_force" : modelKind === "rolling_contact" && /^N(?:x|y)?$/.test(claim.symbol) ? "normal_force" : modelKind && /^(?:Fx|Fy|F)$/.test(claim.symbol) ? "net_force" : undefined);
  if (kind === "friction_force") return /\bfriction(?:al)?\b(?!\s+(?:capacity|coefficient|limit))|\bf(?:_?[xy])?\b/.test(text) && !/\b(?:net|resultant|applied|support)\s+force\b/i.test(text);
  if (kind === "friction_capacity") return /\b(?:capacity|friction\s+limit|maximum\s+(?:static\s+)?friction)\b/i.test(text);
  if (kind === "contact_slip") {
    if (/\b(?:(?:initial|signed|contact)\s+){1,3}slip\b|\bslip\s+(?:speed|velocity)\b/i.test(text) || names(text, symbol) && /\bslip\b/i.test(text)) return true;
    const reference = geometry?.mechanicsValue ? context?.cache.get(geometry.mechanicsValue.modelId) : geometry;
    const model = reference?.kind === "point" ? reference.mechanicsModel : undefined;
    const direction = /\bfriction\s+direction\b([^,;.!?]*)/i.exec(text);
    return !!direction && !/["“”]/.test(text) && !/\b(?:at|after|when|on)\b[^,;.!?]*\b(?:transition|rolling|no[- ]slip|t_?\d+)\b/i.test(direction[1]!)
      && model?.kind === "rolling_contact" && model.source.regime === "sliding" && model.source.time === 0
      && Math.abs(claim.scalarSI) > (claim.errorBoundSI ?? Math.abs(claim.scalarSI) * claim.relativeTolerance);
  }
  if (kind === "transition_time") return /\btransition\s+time\b|\bfirst\s+no[- ]slip\s+time\b|\btime\b[^.;]*\bfirst\b[^.;]*\b(?:roll|no[- ]slip)\b/i.test(text);
  if (kind === "net_force") return /\b(?:net|resultant)\s+force\b/i.test(text) || !/\b(?:applied|normal|friction|support|reaction)\b/i.test(text) && (names(text, symbol) || names(text, claim.symbol));
  if (kind === "applied_force") return /\b(?:applied|driving)\s+force\b/i.test(text) || !/\b(?:net|resultant|normal|friction|support|reaction)\b/i.test(text) && /\bforce\b/i.test(text) && (names(text, symbol) || names(text, claim.symbol));
  if (kind === "normal_force") return /\bnormal\s+(?:force|reaction)\b/i.test(text) || names(text, "N");
  if (kind === "support_reaction") return /\b(?:support\s+reaction|reaction|tension)\b/i.test(text) && !/\b(?:required|formal)\s+(?:support\s+)?reaction\b/i.test(text);
  if (names(text, symbol) || names(text, claim.symbol)) return true;
  const key = claim.symbol;
  if (["omega", "omega_initial", "omega_roll"].includes(key)) {
    if (/\b(?:omega|angular\s+(?:velocity|speed))\b|ω/i.test(text)) return true;
    const reference = geometry?.mechanicsValue ? context?.cache.get(geometry.mechanicsValue.modelId) : geometry;
    const model = reference?.kind === "point" ? reference.mechanicsModel : undefined;
    return /\btransition\s+velocities\b/i.test(text) && !/\b(?:linear|COM)\s+transition\s+velocities\b/i.test(text)
      && model?.kind === "rolling_contact" && model.source.regime === "sliding" && model.state.transitionTimeSI !== null
      && (model.source.time === "transition" || key === "omega_roll");
  }
  if (key === "alpha") {
    if (/\b(?:alpha|angular\s+acceleration)\b|α/i.test(text)) return true;
    const reference = geometry?.mechanicsValue ? context?.cache.get(geometry.mechanicsValue.modelId) : geometry;
    const model = reference?.kind === "point" ? reference.mechanicsModel : undefined;
    const source = model?.source as unknown as Record<string, unknown> | undefined;
    const evolution = model?.kind === "rolling_contact" && source?.mode !== "feasibility" && source?.time !== undefined
      || model?.kind === "axial_rotation" && ["constant_inertia", "angle_law", "inertia_law"].includes(String(source?.mode))
      || model?.kind === "rigid_body_kinematics" && source?.angularLaw !== undefined;
    if (!evolution || !context || !/\b(?:omega(?:_[A-Za-z0-9]+)?|angular\s+(?:velocity|speed))\b|ω/i.test(text)) return false;
    const axis = /\b(?:omega|ω)_([A-Za-z][A-Za-z0-9_]*)\b|\babout\s+(?:(?:the|fixed|axis)\s+){0,3}([+−-]?)([A-Za-z][A-Za-z0-9_]*)\b/.exec(text);
    if (axis) {
      const named = axis[1] ?? axis[3]!, expected = label(context.problem, context.step.axisId);
      const declared = named === "z" && expected !== "z" ? sourceAxisDirection(context.problem, context.step) : null;
      if (axis[2] === "-" || axis[2] === "−" || named !== expected && !(named === "z" && declared?.x === 0 && declared.y === 0 && declared.z === 1)) return false;
    }
    return true;
  }
  if (key === "tau") return /\btorque\b|τ/i.test(text);
  if (key === "theta") return /\b(?:theta|angular\s+position)\b|θ/i.test(text);
  if (key === "delta_theta") return /\b(?:angular\s+displacement|angle\s+(?:change|turned))\b/i.test(text);
  if (key === "J_L") return /\b(?:angular\s+impulse|net\s+impulse)\b/i.test(text);
  if (["L", "L_f", "L_initial"].includes(key)) return /\bangular\s+momentum\b/i.test(text);
  if (/^I(?:_|$)/.test(key)) return /\b(?:inertia|moment\s+of\s+inertia)\b/i.test(text);
  if (key === "k") return /\bradius\s+of\s+gyration\b/i.test(text);
  if (/^K(?:_|$)/.test(key)) return /\b(?:kinetic|translation|rotational|spin)\s+energy\b|\benergy\b/i.test(text);
  if (key === "t_roll") return /\b(?:transition\s+time|time[^.;]*rolling|rolling[^.;]*time)\b/i.test(text);
  if (key === "IC_finite") return /\bfinite\b[^.;]*\binstantaneous\b|\binstantaneous\b[^.;]*\bfinite\b/i.test(text);
  if (key === "IC_unique") return /\bunique\b[^.;]*\binstantaneous\b|\binstantaneous\b[^.;]*\bunique\b/i.test(text);
  if (/^(?:x|y)_(?:CM|C)$/.test(key)) return /\b(?:COM|centre|center)\b/i.test(text);
  if (/^(?:Px|Py|px|py|p_x|p_y)$/.test(key)) return /\bmomentum\b/i.test(text);
  if (/^(?:Vx|Vy|vx|vy|v_x|v_y|v_[A-Za-z0-9]+[xy])$/.test(key)) return /\b(?:velocity|velocities|speed|speeds)\b|\bV_C(?:[xy])?\b/i.test(text);
  if (/^(?:ax|ay|a_x|a_y|a_t|a_n|a_total)$/.test(key)) return /\baccelerations?\b|\ba(?:_C)?(?:[xy])?\b/i.test(text);
  if (/^(?:Fx|Fy|F_x|F_y|F)$/.test(key)) return /\bforce\b/i.test(text);
  if (/^(?:R_|T_|T$)/.test(key)) return /\b(?:reaction|tension)s?\b/i.test(text);
  if (key === "d_perp") return /\b(?:arm|lever)\b/i.test(text);
  if (key === "rim_speed") return /\brim\s+speed\b/i.test(text);
  if (key === "M") return /\bmass\b/i.test(text);
  return false;
}
function requestedTime(problem: ProblemIR, step: MechanicsProgramStep, geometry: MechanicsGeometry, claim: MechanicsClaim, requested: ProblemFact[], cache: ReadonlyMap<string, MechanicsGeometry>): void {
  const reference = geometry.mechanicsValue ? cache.get(geometry.mechanicsValue.modelId) : undefined;
  const model = geometry.kind === "point" && geometry.mechanicsModel ? geometry.mechanicsModel : reference?.kind === "point" ? reference.mechanicsModel : undefined;
  if (!model) return;
  const source = model.source as unknown as Record<string, unknown>;
  const law = record(source.angularLaw) ? source.angularLaw : record(source.inertiaLaw) ? source.inertiaLaw : undefined;
  const evaluatedTime = typeof source.time === "number" ? source.time : law && typeof law.at === "number" ? law.at : null;
  if (evaluatedTime === null) return;
  const initialTime = law && typeof law.initialAt === "number" ? law.initialAt : 0;
  const time = /(?:^|_)initial(?:_|$)/.test(claim.symbol) ? initialTime : evaluatedTime;
  const owner = label(problem, step.ownerId);
  const actor = "[\\p{L}][\\p{L}\\p{N}_]{0,127}";
  const actorBoundary = "[\\p{L}\\p{N}_]";
  const bodyKinds = "(?:rotors?|bodies|body|rods?|discs?|disks?|rings?|spheres?|cylinders?|wheels?|flywheels?|beams?|bars?|blocks?|particles?)";
  const bodySubject = new RegExp(`^(?:(?:a|the)\\s+)?(?:(?:rigid|uniform|thin|solid|closed|stationary)\\s+){0,6}${bodyKinds}\\b`, "i");
  const ownerAssertion = new RegExp(`^(?!what\\b|how\\b|which\\b)${actor}\\s+(?:has|have|is|are|starts?|remains)\\b`, "iu");
  const generic = new Set(["a", "the", "it", "its", "this", "that", "body", "rotor", "rod", "disc", "disk", "ring", "sphere", "cylinder", "wheel", "flywheel", "beam", "bar", "block", "particle", "mass", "inertia", "gyration", "system", "assembly"]);
  function unambiguousParagraph(at: number): boolean {
    const before = problem.question.slice(0, at), after = problem.question.slice(at);
    const boundary = [...before.matchAll(/\r?\n[ \t]*\r?\n/g)].at(-1);
    const end = after.search(/\r?\n[ \t]*\r?\n/);
    const paragraph = problem.question.slice(boundary ? boundary.index! + boundary[0].length : 0, end < 0 ? problem.question.length : at + end);
    const owners = new Set(problem.entities.filter(entity => entity.kind === "body" && typeof entity.label === "string" && names(paragraph, entity.label)).map(entity => entity.label!));
    // Original-source body/state declarations still count if an IR inventory
    // omits the other actor. Property names and generic pronouns are not bodies.
    const subjects = [...paragraph.matchAll(new RegExp(`(?<!${actorBoundary})(${actor})\\s+(?:has|have)\\s+(?:(?:a|the|initial|final|fixed|constant|central|COM|axial|normal)\\s+){0,6}(?:mass|inertia|angular\\s+(?:velocity|momentum)|omega(?:_[A-Za-z0-9]+)?|spin)\\b`, "giu"))].map(match => match[1]!);
    for (const match of paragraph.matchAll(new RegExp(`\\b${bodyKinds}\\s+(${actor}(?:\\s*(?:,\\s*(?:and\\s+)?|and\\s+)${actor})*)`, "giu"))) {
      subjects.push(...match[1]!.split(/\s*,\s*(?:and\s+)?|\s+and\s+/));
    }
    for (const subject of subjects) {
      if (["has", "have", "is", "are", "of", "on", "at", "about", "with", "from", "to", "and", "rolling", "rolls", "turns", "turn", "rotates", "rotate", "spins", "spin", "moves", "slides", "rests", "initially", "released", "starts", "remains", "stationary"].includes(subject)) continue;
      if (!generic.has(subject) || subject === owner) owners.add(subject);
    }
    return owners.size === 1 && owners.has(owner);
  }
  // A requested paragraph may also quote givens. Keep actual queries, including
  // bare questions, without turning a supplied initial state into a request.
  const regions = requested.flatMap(fact => {
    let offset = 0;
    return fact.evidence.quote.split(/[!?;]|\.(?=\s|$)/).filter(text => {
      const start = fact.evidence.quote.indexOf(text, offset); offset = start + text.length;
      if (!queryObservable(text, claim.symbol, claim, geometry, { cache, step, problem })) return false;
      const leading = text.replace(/^\s*about\s+[^,;]+,\s*/i, "").trim();
      const assertion = !/\b(?:what|how|which|where|when)\b/i.test(leading) && (ownerAssertion.test(leading)
        || /^(?:its|their|his|her|initially)\b[^;!?]*=/i.test(leading)
        || bodySubject.test(leading) && /[=]|\b(?:has|have|is|are|turns?|rotates?|rolls?|spins?|moves?|starts?)\b|\d\s+(?:kg|g|m|rad|N|J)\b/.test(leading));
      if (assertion) return false;
      if (names(text, owner)) return true;
      const selected = [...text.matchAll(new RegExp(`\\b(?:of|for)\\s+(?:(?:a|the|rigid|uniform|thin|solid)\\s+)*(${actor})(?!${actorBoundary})|(?<!${actorBoundary})(${actor})['’]s\\s+`, "gu"))].map(match => match[1] ?? match[2]!);
      if (selected.some(name => name !== owner && !generic.has(name)) || problem.entities.some(entity => entity.kind === "body" && entity.id !== step.ownerId && typeof entity.label === "string" && names(text, entity.label))) return false;
      return unambiguousParagraph(fact.evidence.start + start);
    });
  });
  if (!regions.length) fail("requested time-dependent observable needs an unambiguous original-source body query");
  for (const region of regions) {
    const explicit = [...region.matchAll(/\b(?:at\s+(?:(?:time|t)\s*(?:=\s*)?)?|after\s+(?:time\s+)?)([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(milliseconds?|seconds?|ms|s)\b/gi)];
    for (const value of explicit) {
      const expected = parseMathExpression(value[1]!).evaluate(0) * mechanicsUnitFactor(value[2]!, "time");
      if (expected !== time && (expected === 0 || time === 0 || Math.abs(expected - time) > RELATIVE_ERROR * Math.max(Math.abs(expected), Math.abs(time)))) fail("computed state is from a different source time than the requested observable");
    }
    if (!explicit.length && /\binitial(?:ly)?\b/i.test(region) && time !== initialTime) fail("computed state is not the requested initial source state");
    if (!explicit.length && /\bfinal\b/i.test(region) && model.kind === "axial_rotation" && source.mode === "constant_inertia") {
      const spans = step.evidenceFactIds.flatMap(factId => { const fact = problem.facts.find(fact => fact.id === factId); return fact && fact.kind !== "requested" ? [...fact.evidence.quote.matchAll(/\bfor\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(ms|s)\b/gi)] : []; });
      const durations = [...new Set(spans.map(value => Number(value[1]) * mechanicsUnitFactor(value[2]!, "time")))];
      if (durations.length === 1 && durations[0] !== time) fail("initial state cannot substitute for the requested final state after the source duration");
    }
  }
}

/** A provider's flag is insufficient: recompute the same bound output and proof. */
export function certifyMechanicsScalarResult(problem: ProblemIR, request: SolveRequest, result: unknown): MechanicsScalarCertificate | null {
  if (request.kind !== "mechanics" || !request.resultBinding || !record(result) || result.schemaVersion !== "solver-result/v1" || result.problemId !== problem.id || result.status !== "solved" || !Array.isArray(result.values) || !Array.isArray(result.proofs) || !Array.isArray(result.issues) || result.issues.length !== 0) return null;
  try {
    const expected = solveMechanicsProgram(problem, request.program, request.resultBinding);
    const values = result.values.filter(value => record(value) && value.requestId === request.id);
    const proofs = result.proofs.filter(value => record(value) && value.requestId === request.id);
    if (values.length !== 1 || proofs.length !== 1) return null;
    const value = values[0]!, proof = proofs[0]!;
    if (!record(value) || !record(proof) || value.valueType !== "scalar" || value.approximate !== expected.approximate || value.errorBound !== expected.errorBound || value.exact !== undefined || proof.method !== (expected.integration ? "source_bound_mechanics_quadrature" : "source_bound_mechanics") || proof.verified !== true || proof.residual !== 0 || proof.tolerance !== expected.errorBound || !Array.isArray(proof.expressionIds) || proof.expressionIds.length !== expected.expressionIds.length || expected.expressionIds.some(id => !(proof.expressionIds as unknown[]).includes(id))) return null;
    const output = request.program.output;
    return { approximate: expected.approximate, errorBound: expected.errorBound, symbol: request.resultBinding.symbol, unit: output.unit, ownerId: output.ownerId, axisId: output.axisId };
  } catch { return null; }
}

/** Validate and execute a bounded DAG through the existing six physical adapters. */
export function solveMechanicsProgram(problem: ProblemIR, raw: unknown, resultBinding?: SolveResultBinding): MechanicsProgramSolution {
  assertOriginalSourcePointBodyCoverage(problem.question);
  fields(raw, ["model", "inputs", "steps", "output"], "program");
  if (raw.model !== "mechanics" || !Array.isArray(raw.inputs) || raw.inputs.length > 256 || !Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > 32) fail("program requires a supported model and bounded input/step arrays");
  const inputs = new Map<string, MechanicsProgramInput>(); const steps = new Map<string, MechanicsProgramStep>();
  for (const input of raw.inputs) {
    fields(input, ["id", "expressionId", "factId", "ownerId", "sourceExpression", "unit", "sourceUnit", "unitFactId", "component", "axisId", "variable", "variableUnit", "intervalComponent"], "input"); id(input.id, "input id");
    if (inputs.has(input.id)) fail("duplicate input id");
    for (const field of ["expressionId", "factId", "ownerId"]) id(input[field], field);
    if (input.axisId !== undefined) id(input.axisId, "input axis");
    if (input.unitFactId !== undefined) id(input.unitFactId, "input inherited unit fact");
    inputs.set(input.id, input as unknown as MechanicsProgramInput);
  }
  for (const step of raw.steps) {
    fields(step, ["id", "operator", "ownerId", "axisId", "sourceOwners", "evidenceFactIds", "inputs"], "step"); id(step.id, "step id"); id(step.ownerId, "step owner"); id(step.axisId, "step axis");
    if (steps.has(step.id) || inputs.has(step.id) || !(MECHANICS_OPERATORS as readonly unknown[]).includes(step.operator) || !record(step.inputs) || !Array.isArray(step.evidenceFactIds) || step.evidenceFactIds.length < 1 || step.evidenceFactIds.length > 32 || step.evidenceFactIds.some(value => typeof value !== "string")) fail("steps require unique ids, physical inputs and source evidence");
    if (step.sourceOwners !== undefined && (!record(step.sourceOwners) || Object.keys(step.sourceOwners).length > 64 || Object.entries(step.sourceOwners).some(([scope, owner]) => !OWNER_SCOPE.test(scope) || typeof owner !== "string" || !ID.test(owner)))) fail("source owner scopes must identify physical input groups");
    label(problem, step.ownerId); label(problem, step.axisId);
    for (const owner of Object.values(step.sourceOwners ?? {})) label(problem, String(owner));
    steps.set(step.id, step as unknown as MechanicsProgramStep);
  }
  fields(raw.output, ["stepId", "symbol", "unit", "ownerId", "axisId"], "output");
  for (const field of ["stepId", "ownerId", "axisId"]) id(raw.output[field], `output ${field}`);
  if (typeof raw.output.symbol !== "string" || !raw.output.symbol.trim() || raw.output.symbol.length > 128 || typeof raw.output.unit !== "string" || !raw.output.unit.trim() || raw.output.unit.length > 128) fail("output needs a bounded observable and physical unit");
  const output = raw.output as unknown as MechanicsProgramOutput;
  const usedInputs = new Set<string>(), usedFacts = new Set<string>(), active = new Set<string>(), cache = new Map<string, MechanicsGeometry>();
  const sourceReads: MechanicsSourceRead[] = [];
  const snapshots = new Map<string, MechanicsProgramStepSnapshot>(); let visited = 0;
  const context: MechanicsEvaluationContext = { number(value) { if (typeof value !== "number" || !Number.isFinite(value)) fail("adapter number must already be source-resolved"); return value; }, point() { return fail("screen coordinates have no mechanics numeric authority"); }, geometry(value) { if (typeof value !== "string") fail("physical model references must name a program step"); return evaluate(value); } };
  function transform(value: unknown, step: MechanicsProgramStep, path: string, depth = 0, ancestors = new Set<object>()): unknown {
    if (++visited > 8192 || depth > 24) fail("program input tree exceeds structural bounds");
    if (typeof value === "number") fail(`${path} is an unbound model-authored scalar`);
    if (typeof value === "boolean" && (path.startsWith("hypotheses.") || ["atRest", "initialAtRest", "fixedReference"].includes(path) || /^particles\.\d+\.atRest$/.test(path) || /^derivation\.bodies\.\d+\.atRest$/.test(path) || path === "circularContact.surface.stationary")) return value;
    if (typeof value === "string") {
      if (value.length > 2048) fail("mechanics input text exceeds structural bounds");
      if (["direction", "tangent"].includes(path.split(".").at(-1)!)) {
        const parent = inputAt(step.inputs, path.split(".").slice(0, -1).join("."));
        if (record(parent) && parent.magnitude !== undefined) nativeVectorDirection(problem, step, path, value, inputs); else nativeDirection(problem, step, path, value);
        return value;
      }
      if (["kind", "mode", "frame", "axisId", "centralId", "id", "shape", "symbol", "operation", "landmark", "angleUnit", "timeUnit", "inertiaUnit", "gravityDirection"].includes(path.split(".").at(-1)!)) return value;
      const input = inputs.get(value);
      if (input) {
        usedInputs.add(value); usedFacts.add(input.factId);
        const resolved = inputValue(problem, input, step, path, inputs);
        const sourceRole = role(path);
        sourceReads.push({ factId: input.factId, path, ...(input.variable === undefined ? {} : { variable: input.variable }),
          ...(input.variableUnit === undefined ? {} : { variableUnit: input.variableUnit }),
          ...(input.intervalComponent === undefined ? {} : { intervalComponent: input.intervalComponent }), ownerLabel: label(problem, input.ownerId), modelOwnerLabel: label(problem, step.ownerId),
          role: scalarRole(path), dimension: sourceRole.dimension, roleSource: sourceRole.source, sourceExpression: input.sourceExpression,
          sourceUnit: input.sourceUnit ?? input.unit, unit: input.unit, ...(input.component === undefined ? {} : { component: input.component }), value: typeof resolved === "string" ? resolved : resolved.value });
        return resolved;
      }
      if (/^(?:angularLaw|inertiaLaw)\.expression$/.test(path)) fail(`${path} must name a declared source function input; raw model-written functions have no source authority`);
      if (/^[-+]?\d|^(?:pi|e)$/.test(value)) fail(`${path} literal must be an explicit source input or mathematical constant`);
      return value;
    }
    if (typeof value !== "object" || value === null) fail(`${path} has an unsupported input value`);
    if (ancestors.has(value)) fail("cyclic input object"); ancestors.add(value);
    try {
      if (Array.isArray(value)) { if (value.length > 64) fail("nested mechanics arrays exceed64"); return value.map((item, i) => transform(item, step, `${path}.${i}`, depth + 1, ancestors)); }
      if (!record(value)) fail("mechanics input must be a data object");
      if (value.constant !== undefined) {
        if (typeof value.factId === "string") usedFacts.add(value.factId);
        const resolved = mathematicalConstant(problem, value, step, path, output);
        const sourceRole = role(path);
        sourceReads.push({ factId: String(value.factId), path, ownerLabel: label(problem, expectedOwner(step, path)), modelOwnerLabel: label(problem, step.ownerId),
          role: scalarRole(path), dimension: sourceRole.dimension, roleSource: sourceRole.source, sourceExpression: String(value.constant),
          sourceUnit: String(value.unit ?? "1"), unit: String(value.unit ?? "1"), value: typeof resolved === "number" ? resolved : resolved.value });
        return resolved;
      }
      nativeGeometryEvidence(problem, step, path, value);
      if (value.reference !== undefined) {
        if (value.kind === "center_of_mass") {
          fields(value, ["kind", "reference"], "source COM point reference");
          const target = typeof value.reference === "string" ? steps.get(value.reference) : undefined;
          const forcePath = path.replace(/\.point$/, ""), parent = inputAt(step.inputs, forcePath);
          const body = record(parent) && parent.weight !== undefined ? expectedOwner(step, `${forcePath}.weight.mass`) : step.ownerId;
          if (!target || target.ownerId !== body || target.operator !== "mass_moments" && target.operator !== "rigid_body_motion") fail("source COM point must reference the same verified source body");
          return { kind: "center_of_mass", reference: value.reference };
        }
        fields(value, ["reference", "symbol"], "physical scalar reference");
        const target = typeof value.reference === "string" ? steps.get(value.reference) : undefined;
        if (!target || typeof value.symbol !== "string" || !value.symbol.trim() || value.symbol.length > 128 || target.ownerId !== expectedOwner(step, path) || target.axisId !== step.axisId) fail(`${path} scalar reference must preserve its source owner, axis and observable`);
        return { reference: value.reference, symbol: value.symbol };
      }
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, path === "units" ? item : transform(item, step, path ? `${path}.${key}` : key, depth + 1, ancestors)]));
    } finally { ancestors.delete(value); }
  }
  function evaluate(stepId: string): MechanicsGeometry {
    const existing = cache.get(stepId); if (existing) return existing;
    const step = steps.get(stepId); if (!step || active.has(stepId)) fail("program model references must be known and acyclic");
    active.add(stepId);
    try {
      sourceModel(problem, step, inputs); step.evidenceFactIds.forEach(value => usedFacts.add(value));
      for (const field of ["motion", "distribution", "angularImpulse"]) if (step.inputs[field] !== undefined && (field !== "angularImpulse" || typeof step.inputs[field] === "string" && steps.has(String(step.inputs[field])))) {
        const ref = steps.get(String(step.inputs[field]));
        if (!ref || ref.ownerId !== step.ownerId || ref.axisId !== step.axisId) fail("physical dependency changes its source owner or reference axis");
      }
      for (const field of ["mass", "inertia"]) if (typeof step.inputs[field] === "string" && steps.has(step.inputs[field] as string)) {
        const ref = steps.get(step.inputs[field] as string)!;
        if (ref.ownerId !== step.ownerId || field === "inertia" && (step.operator === "rigid_body_motion" ? ref.inputs.kind !== "central_inertia" : !["inertia", "central_inertia"].includes(String(ref.inputs.kind)) || ref.axisId !== step.axisId)) fail("mass/inertia dependency is not the same source body's required axis property");
      }
      if (step.inputs.sourcePositionAuthority !== undefined) fail("native position certificates come only from original-source replay");
      const physical = transform(step.inputs, step, "") as Record<string, unknown>;
      // Display placement is deterministic and contributes no physical value or uncertainty.
      if (step.operator === "mass_moments" || step.operator === "rigid_body_motion") physical.displayScale = 1;
      if (step.operator === "rigid_body_state" && ["point_velocity", "point_acceleration", "com_velocity", "com_acceleration", "com_displacement", "momentum", "support_reaction", "net_force", "friction_force", "normal_force"].includes(String(physical.kind))) physical.displayLength = 1;
      const result = evaluateMechanicsConstruction(step.operator, physical, context);
      if (result.length !== 1) fail("each mechanics step must produce one physical authority");
      const positionAuthority = deriveMechanicsPositionAuthority(problem, step, inputs, result[0]!, cache);
      if (positionAuthority) {
        if (positionAuthority.sourceMismatches.length) fail(positionAuthority.sourceMismatches.join("; "));
        physical.sourcePositionAuthority = positionAuthority;
        result[0] = withMechanicsPositionAuthority(result[0]!, positionAuthority);
      }
      cache.set(stepId, result[0]!); snapshots.set(stepId, { step, physicalInputs: physical, geometry: result[0]! }); return result[0]!;
    } finally { active.delete(stepId); }
  }
  const geometry = evaluate(output.stepId);
  const outputStep = steps.get(output.stepId)!;
  if (outputStep.ownerId !== output.ownerId || outputStep.axisId !== output.axisId) fail("output owner/reference axis differs from its computed observable");
  if (cache.size !== steps.size) fail("every mechanics step must contribute to its output dependency graph");
  for (const stepId of steps.keys()) evaluate(stepId);
  if (outputStep.operator === "mass_property") {
    const source = cache.get(String(outputStep.inputs.distribution));
    if (source?.kind !== "point" || source.mechanicsModel?.kind !== "mass_moments") fail("mass observable lost its source distribution");
    const { state, source: distribution } = source.mechanicsModel;
    const axisKind = String(outputStep.inputs.kind);
    const direction = axisKind === "inertia_x" ? "x" : axisKind === "inertia_y" ? "y" : ["inertia_z", "perpendicular_axis_sum"].includes(axisKind) ? "z" : null;
    if (direction && ["x", "y", "z"].some(component => Math.abs(distribution.axis.direction[component as "x" | "y" | "z"]) !== (component === direction ? 1 : 0))) fail("selected axis observable differs from the declared physical reference axis");
    if (axisKind === "central_inertia" && (distribution.axis.point.x !== state.centerOfMassSI.x || distribution.axis.point.y !== state.centerOfMassSI.y)) fail("central inertia answer requires the named reference axis through the actual COM");
  }
  if (usedInputs.size !== inputs.size) fail("every declared numeric input must participate in the mechanics program");
  // A coordinate spelling belongs to the original requested centre, not a
  // layout point or an unrelated whole model. Fresh replay above proves the
  // complete distribution before this selector reads its native component.
  const nativeSymbol = sourcePointBodyCoordinateSymbol(problem, outputStep, output.symbol) ?? output.symbol;
  const approximate = mechanicsClaimValue(geometry, nativeSymbol, output.unit);
  const claim = validateMechanicsNumericClaim(geometry, { symbol: nativeSymbol, value: approximate, unit: output.unit });
  if (resultBinding && (resultBinding.unit !== output.unit || typeof resultBinding.symbol !== "string")) fail("requested result binding changes the output units");
  const requested = (resultBinding?.evidenceFactIds ?? problem.facts.filter(fact => fact.kind === "requested").map(fact => fact.id)).map(factId => sourceFact(problem, factId, true));
  const timeStep = geometry.mechanicsValue ? steps.get(geometry.mechanicsValue.modelId) ?? outputStep : outputStep;
  requestedTime(problem, timeStep, geometry, claim, requested, cache);
  const requestedSymbol = resultBinding?.symbol ?? output.symbol;
  const sourceCase = validateMechanicsRequestedCase(problem, requested, usedFacts, text => queryObservable(text, requestedSymbol, claim, geometry, { cache, step: outputStep, problem }), sourceReads,
    (text, owner) => assertedRest(text, owner, problem));
  const observableContext = { geometry, claim, requested, sourceCase, cache, sourceInputs: inputs, sourceReads, sourceStep: timeStep };
  if (mechanicsRequestedObservableSymbol(problem, outputStep, output.symbol, observableContext) !== observableSymbol(claim.symbol, outputStep, problem)
    || resultBinding && mechanicsRequestedObservableSymbol(problem, outputStep, resultBinding.symbol, observableContext) !== observableSymbol(claim.symbol, outputStep, problem)) {
    fail("requested result binding changes the source observable, component, axis, epoch or experiment");
  }
  if (!requested.some(fact => names(fact.evidence.quote, label(problem, output.ownerId)) && namesMechanicsAxis(fact.evidence.quote, label(problem, output.axisId)) && queryObservable(fact.evidence.quote, requestedSymbol, claim, geometry, { cache, step: outputStep, problem }))) fail("requested fact must ground the computed owner, reference axis and observable");
  for (const fact of requested) {
    const queries = [...fact.evidence.quote.matchAll(/\b(?:find|calculate|determine|compute|give|report)\b([^.;!?]*)/gi)];
    for (const query of queries) {
      if (!queryObservable(query[0], requestedSymbol, claim, geometry, { cache, step: outputStep, problem })) continue;
      const unitStart = [...query[0].matchAll(/\bin\s+/gi)].at(-1);
      const unit = unitStart ? query[0].slice(unitStart.index! + unitStart[0].length).trim() : undefined;
      if (!unit) continue;
      if (/^(?:(?:the|a|an)\s+)?(?:(?:first|second|third|fourth|new|separate|same)\s+)?(?:comparison|case|state|scenario|experiment)\b/i.test(unit)) continue;
      if (/^the\s+plane$/iu.test(unit) && claim.dimension === "length" && sourcePointBodyCoordinateSymbol(problem, outputStep, requestedSymbol) !== null) {
        if (/\buse\s+SI\s+units\b/iu.test(problem.question) && mechanicsUnitFactor(output.unit, claim.dimension) !== 1)
          fail("source COM plane context must retain its explicitly requested SI output unit");
        continue;
      }
      const requestedFactor = /^SI\s+units$/i.test(unit) ? 1 : mechanicsUnitFactor(unit, claim.dimension);
      if (requestedFactor !== mechanicsUnitFactor(output.unit, claim.dimension)) fail("output unit differs from the units explicitly requested in the source");
    }
  }
  requested.forEach(fact => usedFacts.add(fact.id));
  const integration = [...cache.values()].some(value => value.kind === "point" && (value.mechanicsModel?.kind === "mass_moments" && value.mechanicsModel.state.relativeTolerance > RELATIVE_ERROR || value.mechanicsModel?.kind === "central_axial_mass_moments" && value.mechanicsModel.source.component.relativeTolerance > RELATIVE_ERROR));
  const errorBoundSI = claim.errorBoundSI ?? (integration ? fail("density-integral composition requires the kernel's propagated absolute error bound") : Math.abs(claim.scalarSI) * claim.relativeTolerance);
  const errorBound = errorBoundSI / mechanicsUnitFactor(output.unit, claim.dimension);
  if (!Number.isFinite(errorBound) || errorBound < 0) fail("computed physical uncertainty is not a finite valid bound");
  return { approximate, errorBound, expressionIds: [...new Set([...usedInputs].map(value => inputs.get(value)!.expressionId))], factIds: [...usedFacts], claim, integration, snapshots };
}

/** Source programs carry complete physical snapshots, not scalar-only stamps. */
export function replayMechanicsProgram(problem: ProblemIR, program: unknown, resultBinding?: SolveResultBinding): ReadonlyMap<string, MechanicsProgramStepSnapshot> {
  return solveMechanicsProgram(problem, program, resultBinding).snapshots;
}
