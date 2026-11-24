import { parseMathExpression } from "../math/expression";

/** Planar mechanics in an inertial +x-right, +y-up, +z-out frame. All inputs are SI. */
export interface MechanicsVector2 { readonly x: number; readonly y: number }
export interface MechanicsVector3 extends MechanicsVector2 { readonly z: number }
export interface MechanicsPlaneBasis { readonly tangent: MechanicsVector2; readonly normal: MechanicsVector2; readonly angleSI: number; readonly angleErrorSI: number; readonly directionErrorSI: MechanicsVector2; readonly exactQuarter?: number }
export interface MechanicsCircularContactSI { readonly radius: number; readonly regime?: "no_slip"; readonly surface: { readonly point: MechanicsVector2; readonly tangent: MechanicsVector2; readonly stationary?: boolean; readonly velocity?: MechanicsVector2; readonly velocityErrorBoundSI?: MechanicsVector2; readonly directionErrorBoundSI?: MechanicsVector2 } }
export function mechanicsAngleDirection(angle: number, angleScale: number, exactQuarter?: number): MechanicsVector2 {
  mechanicsFinite(angle, "angle"); if (Math.abs(angle) > 1e6) mechanicsInvalid("angle", "direction angle exceeds the certified argument range");
  if (exactQuarter !== undefined || angle === 0) { const index = ((((exactQuarter ?? 0) % 4) + 4) % 4); return [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }][index]!; }
  const radians = mechanicsProduct(angle, angleScale); const result = { x: mechanicsFinite(Math.cos(radians), "direction"), y: mechanicsFinite(Math.sin(radians), "direction") }; const argumentError = mechanicsErrorProduct(1 + Math.abs(radians), MECHANICS_RELATIVE_ERROR);
  if ([result.x, result.y].some(component => Math.abs(component) <= argumentError)) mechanicsInvalid("uncertainty", "source direction near a cardinal angle requires an exact cardinal definition"); return result;
}
export function mechanicsInclineBasis(angle: number, angleScale: number, quarter?: number): MechanicsPlaneBasis {
  const tangent = mechanicsAngleDirection(-angle, angleScale, quarter === undefined ? undefined : -quarter);
  const angleErrorSI = quarter === undefined && angle !== 0 ? mechanicsErrorProduct(1 + Math.abs(angle * angleScale), MECHANICS_RELATIVE_ERROR) : 0;
  return { tangent, normal: { x: -tangent.y, y: tangent.x }, angleSI: mechanicsProduct(angle, angleScale), angleErrorSI, directionErrorSI: angleErrorSI === 0 ? { x: 0, y: 0 } : { x: mechanicsErrorSum([angleErrorSI, mechanicsErrorProduct(Math.abs(tangent.x), MECHANICS_RELATIVE_ERROR)]), y: mechanicsErrorSum([angleErrorSI, mechanicsErrorProduct(Math.abs(tangent.y), MECHANICS_RELATIVE_ERROR)]) }, ...(quarter === undefined ? {} : { exactQuarter: quarter }) };
}
export function mechanicsToLab(vector: MechanicsVector2, basis?: MechanicsPlaneBasis): MechanicsVector2 { return basis ? { x: mechanicsSum([mechanicsProduct(vector.x, basis.tangent.x), mechanicsProduct(vector.y, basis.normal.x)]), y: mechanicsSum([mechanicsProduct(vector.x, basis.tangent.y), mechanicsProduct(vector.y, basis.normal.y)]) } : vector; }
export function mechanicsFromLab(vector: MechanicsVector2, basis?: MechanicsPlaneBasis): MechanicsVector2 { return basis ? { x: mechanicsDot(vector, basis.tangent), y: mechanicsDot(vector, basis.normal) } : vector; }
export function mechanicsGravityProjection(magnitude: number, basis?: MechanicsPlaneBasis): MechanicsVector2 { positive(magnitude, "gravityMagnitude", true); return mechanicsFromLab({ x: 0, y: -magnitude }, basis); }
export function mechanicsGravityProjectionError(magnitude: number, basis?: MechanicsPlaneBasis): MechanicsVector2 { return basis ? { x: mechanicsErrorProduct(magnitude, basis.directionErrorSI.y), y: mechanicsErrorProduct(magnitude, basis.directionErrorSI.x) } : { x: 0, y: 0 }; }
export function mechanicsCircularCenter(contact: MechanicsCircularContactSI): MechanicsVector2 {
  positive(contact.radius, "radius"); vector(contact.surface.point, "surface.point"); vector(contact.surface.tangent, "surface.tangent"); if (!mechanicsNear(mechanicsNorm(contact.surface.tangent), 1)) mechanicsInvalid("surface", "circular contact requires a unit surface tangent");
  return plus(contact.surface.point, scaled(turn(contact.surface.tangent), contact.radius));
}
export interface MechanicsTranslationSourceSI {
  readonly mass: number; readonly masses?: readonly number[]; readonly particles?: readonly { readonly id?: string; readonly mass: number; readonly velocity?: MechanicsVector2; readonly atRest?: boolean; readonly velocityErrorBoundSI?: MechanicsVector2 }[];
  readonly velocity?: MechanicsVector2; readonly initialVelocity?: MechanicsVector2; readonly initialAtRest?: boolean; readonly time?: number;
  readonly externalForce?: MechanicsVector2; readonly externalForces?: readonly MechanicsVector2[]; readonly gravity?: MechanicsVector2;
  readonly massErrorBoundSI?: number; readonly velocityErrorBoundSI?: MechanicsVector2; readonly initialVelocityErrorBoundSI?: MechanicsVector2; readonly externalForceErrorBoundSI?: MechanicsVector2; readonly externalForcesErrorBoundsSI?: readonly MechanicsVector2[]; readonly gravityErrorBoundSI?: MechanicsVector2;
  readonly hypotheses: { readonly closedSystem: boolean; readonly constantMass: boolean; readonly internalActionReaction: boolean; readonly isolated?: boolean; readonly zeroExternalImpulse?: boolean; readonly constantExternalForce?: boolean };
}
export interface MechanicsTranslationState {
  readonly massSI: number; readonly velocitySI: MechanicsVector2 | null; readonly momentumSI: MechanicsVector2 | null;
  readonly externalForceSI: MechanicsVector2 | null; readonly accelerationSI: MechanicsVector2 | null; readonly displacementSI: MechanicsVector2 | null; readonly translationEnergySI: number | null;
  readonly particlesSI: readonly { readonly id?: string; readonly massSI: number; readonly velocitySI: MechanicsVector2 | null; readonly errorBoundSI: MechanicsVector2 | null }[] | null;
  readonly errorBoundsSI: { readonly massSI: number; readonly velocitySI: MechanicsVector2 | null; readonly momentumSI: MechanicsVector2 | null; readonly externalForceSI: MechanicsVector2 | null; readonly accelerationSI: MechanicsVector2 | null; readonly displacementSI: MechanicsVector2 | null; readonly translationEnergySI: number | null };
}
export function deriveMechanicsTranslation(source: MechanicsTranslationSourceSI): MechanicsTranslationState {
  positive(source.mass, "mass"); const massError = source.massErrorBoundSI ?? 0; mechanicsErrorBound(massError);
  if (massError >= source.mass) mechanicsInvalid("uncertainty", "COM mass must remain strictly positive throughout its error interval");
  const h = source.hypotheses; if (h.closedSystem !== true || h.constantMass !== true || h.internalActionReaction !== true) mechanicsInvalid("hypotheses", "COM equations require a closed constant-mass classical system with cancelling internal forces");
  if (source.masses && (source.masses.length < 1 || source.masses.length > 32 || source.masses.some(mass => !(mass > 0)) || mechanicsSum(source.masses) !== source.mass)) mechanicsInvalid("masses", "system mass must be the explicit positive mass sum");
  if (source.particles && (source.particles.length < 1 || source.particles.length > 32 || source.particles.some(particle => !(particle.mass > 0)) || mechanicsSum(source.particles.map(particle => particle.mass)) !== source.mass)) mechanicsInvalid("particles", "particle collection must retain its source mass sum");
  const inputError = (error?: MechanicsVector2): MechanicsVector2 => { const checked = error ?? { x: 0, y: 0 }; mechanicsErrorBound(checked.x); mechanicsErrorBound(checked.y); return checked; };
  const givenVelocityError = inputError(source.velocityErrorBoundSI), initialVelocityError = inputError(source.initialVelocityErrorBoundSI), givenForceError = inputError(source.externalForceErrorBoundSI), gravityError = inputError(source.gravityErrorBoundSI);
  const componentForceErrors = source.externalForcesErrorBoundsSI?.map(inputError) ?? []; if (componentForceErrors.length && componentForceErrors.length !== source.externalForces?.length) mechanicsInvalid("uncertainty", "external-force errors must retain every source component");
  source.particles?.forEach(particle => inputError(particle.velocityErrorBoundSI));
  let force: MechanicsVector2 | null = null; const forceTerms: MechanicsVector2[] = [];
  if (source.externalForce) { vector(source.externalForce, "externalForce"); if (source.externalForces || source.gravity) mechanicsInvalid("externalForce", "a supplied net external force cannot be counted again with component forces/gravity"); force = source.externalForce; }
  else if (source.externalForces || source.gravity) { if (source.externalForces && source.externalForces.length > 32) mechanicsInvalid("externalForces", "external force sum is bounded"); forceTerms.push(...(source.externalForces ?? [])); if (source.gravity) forceTerms.push(mechanicsGravityForce(source.mass, { x: 0, y: 0 }, source.gravity).force); forceTerms.forEach(value => vector(value, "force")); force = { x: mechanicsSum(forceTerms.map(value => value.x)), y: mechanicsSum(forceTerms.map(value => value.y)) }; }
  if (h.isolated) { if (force && (force.x !== 0 || force.y !== 0)) mechanicsInvalid("hypotheses", "isolated COM model cannot retain a nonzero external force"); force = { x: 0, y: 0 }; }
  const forceComponentError = (key: "x" | "y"): number => h.isolated ? 0 : mechanicsErrorSum([source.externalForce ? givenForceError[key] : 0, ...componentForceErrors.map(error => error[key]), source.gravity ? mechanicsErrorSum([mechanicsErrorProduct(source.mass, gravityError[key]), mechanicsErrorProduct(massError, Math.abs(source.gravity[key]) + gravityError[key]), mechanicsProductRoundingError(source.mass, source.gravity[key])]) : 0, mechanicsSumRoundingError(forceTerms.map(value => value[key]))]);
  const forceError = force ? { x: forceComponentError("x"), y: forceComponentError("y") } : null;
  const acceleration = force ? { x: mechanicsQuotient(force.x, source.mass), y: mechanicsQuotient(force.y, source.mass) } : null;
  const dividedError = (value: number, denominator: number): number => value === 0 ? 0 : mechanicsErrorBound(Math.max(Number.MIN_VALUE, value / denominator));
  const physicalAccelerationError = acceleration && force && forceError ? { x: dividedError(mechanicsErrorSum([forceError.x, mechanicsErrorProduct(Math.abs(acceleration.x) + mechanicsQuotientRoundingError(force.x, source.mass), massError)]), source.mass - massError), y: dividedError(mechanicsErrorSum([forceError.y, mechanicsErrorProduct(Math.abs(acceleration.y) + mechanicsQuotientRoundingError(force.y, source.mass), massError)]), source.mass - massError) } : null;
  const accelerationError = acceleration && force && physicalAccelerationError ? { x: mechanicsErrorSum([physicalAccelerationError.x, mechanicsQuotientRoundingError(force.x, source.mass)]), y: mechanicsErrorSum([physicalAccelerationError.y, mechanicsQuotientRoundingError(force.y, source.mass)]) } : null;
  if (source.initialAtRest !== undefined && source.initialAtRest !== true || source.initialAtRest && source.initialVelocity !== undefined) mechanicsInvalid("initialAtRest", "use one original initial COM velocity or its source rest premise"); const initialVelocity = source.initialAtRest ? { x: 0, y: 0 } : source.initialVelocity;
  if (source.initialAtRest && (initialVelocityError.x !== 0 || initialVelocityError.y !== 0)) mechanicsInvalid("uncertainty", "source rest derives exact initial velocity zeros");
  if (source.time !== undefined && !initialVelocity) mechanicsInvalid("time", "COM time evolution requires its source initial velocity");
  if (source.time !== undefined) { positive(source.time, "time", true); if (source.time > 0 && (!acceleration || h.constantExternalForce !== true && h.isolated !== true)) mechanicsInvalid("time", "COM time evolution requires complete forcing and a source constant-force or isolation premise"); }
  let velocity = source.velocity ?? null, momentum: MechanicsVector2 | null = null, velocityError: MechanicsVector2 | null = velocity ? givenVelocityError : null;
  if (source.particles?.every(particle => particle.velocity !== undefined || particle.atRest === true)) {
    const particles = source.particles; particles.forEach(particle => vector(particle.velocity ?? { x: 0, y: 0 }, "velocity"));
    const weighted = (key: "x" | "y"): Exact => particles.reduce((sum, particle) => add(sum, multiply(exact(particle.mass), exact(particle.velocity?.[key] ?? 0))), exact(0));
    momentum = { x: numeric(weighted("x"), "momentum"), y: numeric(weighted("y"), "momentum") }; const inferred = { x: exactQuotient(weighted("x"), exact(source.mass), "velocity"), y: exactQuotient(weighted("y"), exact(source.mass), "velocity") };
    if (velocity && (!mechanicsNear(velocity.x, inferred.x) || !mechanicsNear(velocity.y, inferred.y))) mechanicsInvalid("velocity", "COM velocity must match the source particle momentum sum"); velocity = inferred;
    const weightedError = (key: "x" | "y"): number => mechanicsErrorSum([mechanicsErrorProduct(Math.abs(inferred[key]), massError / (source.mass - massError)), ...particles.map(particle => mechanicsErrorProduct(particle.mass / (source.mass - massError), particle.velocityErrorBoundSI?.[key] ?? 0)), exactQuotientError(weighted(key), exact(source.mass), inferred[key]), givenVelocityError[key]]);
    velocityError = { x: weightedError("x"), y: weightedError("y") };
  }
  let displacementSI: MechanicsVector2 | null = null, displacementError: MechanicsVector2 | null = null;
  if (initialVelocity) {
    vector(initialVelocity, "initialVelocity"); let evolved: MechanicsVector2 | undefined, evolvedError: MechanicsVector2 | undefined;
    if (source.time !== undefined) {
      const time = source.time, denominator = exact(source.mass);
      const velocityNumerator = (key: "x" | "y"): Exact => add(multiply(denominator, exact(initialVelocity[key])), multiply(exact(force?.[key] ?? 0), exact(time)));
      const displacementNumerator = (key: "x" | "y"): Exact => add(multiply(multiply(denominator, exact(initialVelocity[key])), exact(time)), multiply(multiply(exact(0.5), exact(force?.[key] ?? 0)), multiply(exact(time), exact(time))));
      evolved = { x: exactQuotient(velocityNumerator("x"), denominator, "velocity"), y: exactQuotient(velocityNumerator("y"), denominator, "velocity") };
      evolvedError = { x: mechanicsErrorSum([initialVelocityError.x, givenVelocityError.x, mechanicsErrorProduct(time, physicalAccelerationError?.x ?? 0), exactQuotientError(velocityNumerator("x"), denominator, evolved.x)]), y: mechanicsErrorSum([initialVelocityError.y, givenVelocityError.y, mechanicsErrorProduct(time, physicalAccelerationError?.y ?? 0), exactQuotientError(velocityNumerator("y"), denominator, evolved.y)]) };
      displacementSI = { x: exactQuotient(displacementNumerator("x"), denominator, "displacement"), y: exactQuotient(displacementNumerator("y"), denominator, "displacement") };
      const halfTimeSquared = mechanicsErrorProduct(0.5, mechanicsErrorProduct(time, time));
      displacementError = { x: mechanicsErrorSum([mechanicsErrorProduct(time, initialVelocityError.x), mechanicsErrorProduct(halfTimeSquared, physicalAccelerationError?.x ?? 0), exactQuotientError(displacementNumerator("x"), denominator, displacementSI.x)]), y: mechanicsErrorSum([mechanicsErrorProduct(time, initialVelocityError.y), mechanicsErrorProduct(halfTimeSquared, physicalAccelerationError?.y ?? 0), exactQuotientError(displacementNumerator("y"), denominator, displacementSI.y)]) };
    } else if (h.zeroExternalImpulse || h.isolated || force && force.x === 0 && force.y === 0) { evolved = initialVelocity; evolvedError = { x: mechanicsErrorSum([initialVelocityError.x, givenVelocityError.x]), y: mechanicsErrorSum([initialVelocityError.y, givenVelocityError.y]) }; }
    if (evolved) { if (velocity && (!mechanicsNear(velocity.x, evolved.x) || !mechanicsNear(velocity.y, evolved.y))) mechanicsInvalid("velocity", "COM source velocity contradicts its conserved or evolved state"); velocity = evolved; velocityError = evolvedError!; momentum = scaled(velocity, source.mass); }
  }
  if (velocity) vector(velocity, "velocity");
  const particlesSI = source.particles?.map(particle => { if (particle.atRest !== undefined && particle.atRest !== true || particle.atRest && particle.velocity) mechanicsInvalid("particles", "point member uses one source velocity or rest premise"); return { ...(particle.id ? { id: particle.id } : {}), massSI: particle.mass, velocitySI: particle.atRest ? { x: 0, y: 0 } : particle.velocity ?? null, errorBoundSI: particle.atRest ? { x: 0, y: 0 } : particle.velocity ? particle.velocityErrorBoundSI ?? { x: 0, y: 0 } : null }; }) ?? null;
  if (particlesSI && velocity) { const missing = particlesSI.filter(particle => particle.velocitySI === null); if (missing.length === 1) { const unknown = missing[0]!, known = particlesSI.filter(particle => particle.velocitySI !== null); const component = (key: "x" | "y"): number => exactQuotient(known.reduce((sum, particle) => add(sum, multiply(exact(-particle.massSI), exact(particle.velocitySI![key]))), multiply(exact(source.mass), exact(velocity![key]))), exact(unknown.massSI), "velocity"); unknown.velocitySI = { x: component("x"), y: component("y") }; unknown.errorBoundSI = { x: mechanicsErrorSum([mechanicsErrorProduct(source.mass / unknown.massSI, velocityError?.x ?? 0), mechanicsErrorProduct(massError / unknown.massSI, Math.abs(velocity.x) + (velocityError?.x ?? 0)), ...known.map(particle => mechanicsErrorProduct(particle.massSI / unknown.massSI, particle.errorBoundSI?.x ?? 0)), mechanicsErrorProduct(Math.abs(unknown.velocitySI.x), MECHANICS_RELATIVE_ERROR)]), y: mechanicsErrorSum([mechanicsErrorProduct(source.mass / unknown.massSI, velocityError?.y ?? 0), mechanicsErrorProduct(massError / unknown.massSI, Math.abs(velocity.y) + (velocityError?.y ?? 0)), ...known.map(particle => mechanicsErrorProduct(particle.massSI / unknown.massSI, particle.errorBoundSI?.y ?? 0)), mechanicsErrorProduct(Math.abs(unknown.velocitySI.y), MECHANICS_RELATIVE_ERROR)]) }; } }
  const energyExact = velocity ? multiply(multiply(exact(0.5), exact(source.mass)), add(multiply(exact(velocity.x), exact(velocity.x)), multiply(exact(velocity.y), exact(velocity.y)))) : null;
  const translationEnergySI = energyExact ? numeric(energyExact, "energy") : null;
  const translationError = velocity && velocityError && energyExact ? mechanicsErrorSum([mechanicsErrorProduct(source.mass, mechanicsErrorSum([mechanicsErrorProduct(Math.abs(velocity.x), velocityError.x), mechanicsErrorProduct(Math.abs(velocity.y), velocityError.y), mechanicsErrorProduct(0.5, mechanicsErrorSum([mechanicsErrorProduct(velocityError.x, velocityError.x), mechanicsErrorProduct(velocityError.y, velocityError.y)]))])), mechanicsErrorProduct(mechanicsErrorProduct(massError, 0.5), (Math.abs(velocity.x) + velocityError.x) ** 2 + (Math.abs(velocity.y) + velocityError.y) ** 2), dyadicRoundingError(energyExact)]) : null;
  const finalMomentum = momentum ?? (velocity ? scaled(velocity, source.mass) : null);
  const momentumError = finalMomentum && velocity && velocityError ? { x: mechanicsErrorSum([mechanicsErrorProduct(source.mass, velocityError.x), mechanicsErrorProduct(massError, Math.abs(velocity.x) + velocityError.x), mechanicsProductRoundingError(source.mass, velocity.x), Math.abs(mechanicsSum([finalMomentum.x, -mechanicsProduct(source.mass, velocity.x)]))]), y: mechanicsErrorSum([mechanicsErrorProduct(source.mass, velocityError.y), mechanicsErrorProduct(massError, Math.abs(velocity.y) + velocityError.y), mechanicsProductRoundingError(source.mass, velocity.y), Math.abs(mechanicsSum([finalMomentum.y, -mechanicsProduct(source.mass, velocity.y)]))]) } : null;
  return { massSI: source.mass, velocitySI: velocity, momentumSI: finalMomentum, externalForceSI: force, accelerationSI: acceleration, displacementSI, translationEnergySI, particlesSI, errorBoundsSI: { massSI: massError, velocitySI: velocityError, momentumSI: momentumError, externalForceSI: forceError, accelerationSI: accelerationError, displacementSI: displacementError, translationEnergySI: translationError } };
}
export type MechanicsTensor = readonly (readonly number[])[];
export const MECHANICS_RELATIVE_ERROR = 128 * Number.EPSILON;
const MAX_VALUE = 1e24;
export class MechanicsInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
export function mechanicsInvalid(key: string, message: string): never { throw new MechanicsInputError(key, message); }
export function mechanicsFinite(value: number, key: string): number {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_VALUE) mechanicsInvalid(key, `${key} must be finite and within the supported mechanics range`);
  return value === 0 ? 0 : value;
}
type Exact = { n: bigint; e: number };
const bits = new DataView(new ArrayBuffer(8));
function exact(value: number): Exact {
  mechanicsFinite(value, "number"); if (value === 0) return { n: 0n, e: 0 };
  bits.setFloat64(0, value); const raw = bits.getBigUint64(0); const exponent = Number((raw >> 52n) & 2047n);
  const magnitude = (raw & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  return { n: raw >> 63n ? -magnitude : magnitude, e: exponent ? exponent - 1075 : -1074 };
}
function add(a: Exact, b: Exact): Exact { const e = Math.min(a.e, b.e); return { n: (a.n << BigInt(a.e - e)) + (b.n << BigInt(b.e - e)), e }; }
function multiply(a: Exact, b: Exact): Exact { return { n: a.n * b.n, e: a.e + b.e }; }
function numeric(value: Exact, key: string): number {
  if (value.n === 0n) return 0;
  const magnitude = value.n < 0n ? -value.n : value.n;
  const shift = Math.max(0, magnitude.toString(2).length - 53, -1074 - value.e); let mantissa = magnitude >> BigInt(shift);
  if (shift > 0) { const remainder = magnitude - (mantissa << BigInt(shift)); const half = 1n << BigInt(shift - 1); if (remainder > half || remainder === half && mantissa % 2n === 1n) mantissa++; }
  const result = mechanicsFinite(Number(mantissa) * 2 ** (value.e + shift) * (value.n < 0n ? -1 : 1), key);
  if (result === 0) mechanicsInvalid("precision", "a nonzero physical result cannot underflow to certified zero");
  return result;
}
/** Exact dyadic accumulation distinguishes a real cancellation from a rounded zero. */
export function mechanicsSum(values: readonly number[], key = "sum"): number { return numeric(values.reduce((total, value) => add(total, exact(value)), exact(0)), key); }
export function mechanicsProduct(a: number, b: number, key = "product"): number { return numeric(multiply(exact(a), exact(b)), key); }
export function mechanicsQuotient(a: number, b: number, key = "quotient"): number {
  mechanicsFinite(a, key); mechanicsFinite(b, key); if (b === 0) mechanicsInvalid(key, "physical division requires a nonzero denominator");
  const result = mechanicsFinite(a / b, key); if (a !== 0 && result === 0) mechanicsInvalid("precision", "a nonzero physical quotient cannot underflow to zero"); return result;
}
/** Round one complete rational law once, retaining exact cancellations before division. */
function exactQuotient(numerator: Exact, denominator: Exact, key: string): number {
  if (denominator.n === 0n) mechanicsInvalid(key, "physical division requires a nonzero denominator"); if (numerator.n === 0n) return 0;
  const n = numerator.n < 0n ? -numerator.n : numerator.n, d = denominator.n < 0n ? -denominator.n : denominator.n, exponent = numerator.e - denominator.e;
  let binaryExponent = n.toString(2).length - d.toString(2).length;
  if (binaryExponent >= 0 ? n < d << BigInt(binaryExponent) : n << BigInt(-binaryExponent) < d) binaryExponent--;
  const quantum = Math.max(-1074, binaryExponent + exponent - 52), shift = exponent - quantum;
  const scaledN = shift >= 0 ? n << BigInt(shift) : n, scaledD = shift < 0 ? d << BigInt(-shift) : d;
  let mantissa = scaledN / scaledD; const remainder = scaledN % scaledD;
  if (2n * remainder > scaledD || 2n * remainder === scaledD && mantissa % 2n !== 0n) mantissa++;
  const result = mechanicsFinite(Number(mantissa) * 2 ** quantum * ((numerator.n < 0n) !== (denominator.n < 0n) ? -1 : 1), key);
  if (result === 0) mechanicsInvalid("precision", "a nonzero rational mechanics law cannot underflow to certified zero"); return result;
}
function exactQuotientError(numerator: Exact, denominator: Exact, rounded: number): number {
  const residual = add(numerator, multiply(exact(-rounded), denominator)); if (residual.n === 0n) return 0;
  try { return mechanicsErrorBound(Math.abs(exactQuotient(residual, denominator, "rounding"))); }
  catch (error) { if (error instanceof MechanicsInputError && error.key === "precision") return Number.MIN_VALUE; throw error; }
}
function dyadicRoundingError(value: Exact): number { if (value.n === 0n) return 0; const rounded = numeric(value, "rounding"), difference = add(value, exact(-rounded)); if (difference.n === 0n) return 0; const absolute = { ...difference, n: difference.n < 0n ? -difference.n : difference.n }; try { return mechanicsErrorBound(numeric(absolute, "rounding")); } catch { return Number.MIN_VALUE; } }
export function mechanicsProductRoundingError(a: number, b: number): number { return dyadicRoundingError(multiply(exact(a), exact(b))); }
export function mechanicsSumRoundingError(values: readonly number[]): number { return dyadicRoundingError(values.reduce((sum, value) => add(sum, exact(value)), exact(0))); }
export function mechanicsQuotientRoundingError(a: number, b: number): number { const result = mechanicsQuotient(a, b), residual = add(exact(a), multiply(exact(-result), exact(b))); if (residual.n === 0n) return 0; try { return mechanicsErrorBound(Math.abs(numeric(residual, "rounding") / b) || Number.MIN_VALUE); } catch { return Number.MIN_VALUE; } }
/** Encoding error of a source decimal's canonical numeric representation; never a measurement tolerance. */
export function mechanicsDecimalEncodingError(value: number): number {
  const binary = exact(value), match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value)); if (!match || value === 0) return 0; const exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0); let decimalN = BigInt(`${match[1]}${match[2]}${match[3] ?? ""}`), decimalD = 1n; if (exponent >= 0) decimalN *= 10n ** BigInt(exponent); else decimalD = 10n ** BigInt(-exponent); const binaryN = binary.e >= 0 ? binary.n << BigInt(binary.e) : binary.n, binaryD = binary.e < 0 ? 1n << BigInt(-binary.e) : 1n; let difference = binaryN * decimalD - decimalN * binaryD; if (difference === 0n) return 0; if (difference < 0n) difference = -difference; const denominator = binaryD * decimalD, nShift = Math.max(0, difference.toString(2).length - 53), dShift = Math.max(0, denominator.toString(2).length - 53); return mechanicsErrorBound(Math.max(Number.MIN_VALUE, Number(difference >> BigInt(nShift)) / Number(denominator >> BigInt(dShift)) * 2 ** (nShift - dShift)));
}
/** Round bounds upward; an unrepresentably small positive bound is never reported as zero. */
export function mechanicsErrorBound(value: number): number { if (!(value >= 0) || !Number.isFinite(value) || value > MAX_VALUE) mechanicsInvalid("uncertainty", "mechanics requires a finite nonnegative error bound"); if (value === 0) return 0; return Math.max(Number.MIN_VALUE, value * (1 + MECHANICS_RELATIVE_ERROR)); }
export function mechanicsErrorProduct(a: number, b: number): number { if (a === 0 || b === 0) return 0; return mechanicsErrorBound(Math.max(Number.MIN_VALUE, Math.abs(a) * Math.abs(b))); }
export function mechanicsErrorSum(values: readonly number[]): number { return mechanicsErrorBound(values.reduce((sum, value) => sum + value, 0)); }
export function mechanicsDot(a: MechanicsVector2, b: MechanicsVector2): number { return numeric(add(multiply(exact(a.x), exact(b.x)), multiply(exact(a.y), exact(b.y))), "dot"); }
export function mechanicsCross(a: MechanicsVector2, b: MechanicsVector2): number { return numeric(add(multiply(exact(a.x), exact(b.y)), multiply(exact(-a.y), exact(b.x))), "cross"); }
export function mechanicsNorm(v: MechanicsVector2): number { const result = mechanicsFinite(Math.hypot(v.x, v.y), "magnitude"); if (result === 0 && (v.x !== 0 || v.y !== 0)) mechanicsInvalid("precision", "nonzero physical vector lost its magnitude"); return result; }
export function mechanicsNear(actual: number, expected: number, scale = Math.max(Math.abs(actual), Math.abs(expected))): boolean { return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= MECHANICS_RELATIVE_ERROR * scale; }
export function mechanicsUnit3(v: MechanicsVector3, key: string): MechanicsVector3 {
  [v.x, v.y, v.z].forEach(value => mechanicsFinite(value, key)); const norm = Math.hypot(v.x, v.y, v.z); if (!(norm > 0) || !Number.isFinite(norm)) mechanicsInvalid(key, "an axis or body direction must be finite and nonzero");
  const result = { x: v.x / norm, y: v.y / norm, z: v.z / norm }; if (["x", "y", "z"].some(coordinate => v[coordinate as keyof MechanicsVector3] !== 0 && result[coordinate as keyof MechanicsVector3] === 0)) mechanicsInvalid("precision", "direction normalization lost a nonzero component"); return result;
}
const sub = (a: MechanicsVector2, b: MechanicsVector2): MechanicsVector2 => ({ x: mechanicsSum([a.x, -b.x]), y: mechanicsSum([a.y, -b.y]) });
const plus = (a: MechanicsVector2, b: MechanicsVector2): MechanicsVector2 => ({ x: mechanicsSum([a.x, b.x]), y: mechanicsSum([a.y, b.y]) });
const scaled = (v: MechanicsVector2, scalar: number): MechanicsVector2 => ({ x: mechanicsProduct(v.x, scalar), y: mechanicsProduct(v.y, scalar) });
const turn = (v: MechanicsVector2): MechanicsVector2 => ({ x: -v.y, y: v.x });
function positive(value: number, key: string, zero = false): number { mechanicsFinite(value, key); if (zero ? value < 0 : !(value > 0)) mechanicsInvalid(key, `${key} must be ${zero ? "nonnegative" : "positive"}`); return value; }
function vector(v: MechanicsVector2, key: string): void { mechanicsFinite(v.x, key); mechanicsFinite(v.y, key); }

export type MechanicsShape = "point" | "rod" | "ring" | "disc" | "cylinder" | "sphere" | "spherical_shell";
/** Principal moments come from rigidMassGeometry's existing density integral, never a second shape-formula registry. */
export interface MechanicsPrincipalMoments { readonly parallel: number; readonly perpendicular: number; readonly relativeTolerance: number; readonly method: "point" | "composite_simpson" }
export interface MechanicsMassComponentSI {
  readonly mass: number; readonly center: MechanicsVector2; readonly shape: MechanicsShape;
  readonly direction: MechanicsVector3; readonly length?: number; readonly radius?: number;
  readonly operation: "add" | "remove"; readonly principal: MechanicsPrincipalMoments; readonly directionErrorBoundSI?: MechanicsVector3; readonly endpoints?: readonly [MechanicsVector2, MechanicsVector2];
}
export interface MechanicsMassSourceSI { readonly components: readonly MechanicsMassComponentSI[]; readonly axis: { readonly point: MechanicsVector2; readonly direction: MechanicsVector3; readonly directionErrorBoundSI?: MechanicsVector3; readonly id?: string; readonly centralId?: string } }
export interface MechanicsAxialMassSourceSI { readonly components: readonly { readonly mass: number; readonly radius: number; readonly count?: number }[]; readonly axisId: string }
export interface MechanicsAxialMassState { readonly massSI: number; readonly inertiaSI: number; readonly gyrationRadiusSI: number; readonly errorBoundsSI: { readonly massSI: number; readonly inertiaSI: number; readonly gyrationRadiusSI: number } }
export interface MechanicsCentralAxialMassSourceSI { readonly component: { readonly shape: "ring" | "disc" | "cylinder" | "sphere" | "spherical_shell"; readonly mass: number; readonly radius: number; readonly inertiaIntegralSI: number; readonly relativeTolerance: number }; readonly axisId: string }
export interface MechanicsCentralAxialMassState extends MechanicsAxialMassState { readonly centralInertiaSI: number }
export function deriveMechanicsCentralAxialMass(source: MechanicsCentralAxialMassSourceSI): MechanicsCentralAxialMassState {
  if (!source.axisId?.trim() || source.axisId.length > 128 || !["ring", "disc", "cylinder", "sphere", "spherical_shell"].includes(source.component.shape)) mechanicsInvalid("axis", "central axial mass requires one uniform known-radius body on its central symmetry axis"); const body = source.component; positive(body.mass, "mass"); positive(body.radius, "radius"); positive(body.inertiaIntegralSI, "inertia"); if (!(body.relativeTolerance > 0) || body.relativeTolerance > 1e-6) mechanicsInvalid("inertia", "central inertia requires the existing bounded mass integral"); const error = mechanicsErrorProduct(body.inertiaIntegralSI, body.relativeTolerance), ratio = body.inertiaIntegralSI / body.mass, gyrationRadiusSI = Math.sqrt(ratio); return { massSI: body.mass, inertiaSI: body.inertiaIntegralSI, centralInertiaSI: body.inertiaIntegralSI, gyrationRadiusSI, errorBoundsSI: { massSI: 0, inertiaSI: error, gyrationRadiusSI: mechanicsErrorSum([error / (2 * Math.sqrt((body.inertiaIntegralSI - error) * body.mass)), mechanicsErrorProduct(gyrationRadiusSI, MECHANICS_RELATIVE_ERROR)]) } };
}
export function deriveMechanicsAxialMass(source: MechanicsAxialMassSourceSI): MechanicsAxialMassState {
  if (!source.axisId?.trim() || source.axisId.length > 128 || !Array.isArray(source.components) || source.components.length < 1 || source.components.length > 32) mechanicsInvalid("axis", "axial point-mass reduction requires one named axis and a bounded component list");
  source.components.forEach(component => { positive(component.mass, "mass"); positive(component.radius, "radius", true); if (component.count !== undefined && (!Number.isInteger(component.count) || component.count < 1 || component.count > 32)) mechanicsInvalid("count", "source multiplicity must be an integer from one to32"); });
  const mass = source.components.reduce((sum, component) => add(sum, multiply(exact(component.mass), exact(component.count ?? 1))), exact(0)), inertia = source.components.reduce((sum, component) => add(sum, multiply(multiply(exact(component.mass), exact(component.count ?? 1)), multiply(exact(component.radius), exact(component.radius)))), exact(0)); const massSI = numeric(mass, "mass"), inertiaSI = numeric(inertia, "inertia"), gyrationRadiusSI = inertiaSI === 0 ? 0 : Math.sqrt(mechanicsQuotient(inertiaSI, massSI));
  const massError = dyadicRoundingError(mass), inertiaError = dyadicRoundingError(inertia), gyrationError = gyrationRadiusSI === 0 ? 0 : mechanicsErrorSum([mechanicsErrorProduct(gyrationRadiusSI, MECHANICS_RELATIVE_ERROR), mechanicsErrorProduct(gyrationRadiusSI, inertiaError / Math.max(Number.MIN_VALUE, inertiaSI - inertiaError) + massError / (massSI - massError))]);
  return { massSI, inertiaSI, gyrationRadiusSI, errorBoundsSI: { massSI: massError, inertiaSI: inertiaError, gyrationRadiusSI: gyrationError } };
}
export interface MechanicsMassState {
  readonly massSI: number; readonly centerOfMassSI: MechanicsVector2; readonly centralTensorSI: MechanicsTensor;
  readonly inertiaSI: number; readonly centralInertiaSI: number; readonly gyrationRadiusSI: number;
  readonly inertiaAxesSI: MechanicsVector3; readonly planar: boolean; readonly relativeTolerance: number;
  readonly errorBoundsSI: { readonly massSI: number; readonly centerOfMassSI: MechanicsVector2; readonly inertiaSI: number; readonly centralInertiaSI: number; readonly gyrationRadiusSI: number; readonly inertiaAxesSI: MechanicsVector3 };
}
function centralTensor(component: MechanicsMassComponentSI): number[][] {
  const direction = [component.direction.x, component.direction.y, component.direction.z]; const p = component.principal;
  positive(p.parallel, "principal", true); positive(p.perpendicular, "principal", true);
  return direction.map((d, i) => direction.map((e, j) => mechanicsSum([i === j ? p.perpendicular : 0, mechanicsProduct(mechanicsSum([p.parallel, -p.perpendicular]), mechanicsProduct(d, e))])));
}
function shiftedTensor(component: MechanicsMassComponentSI, about: MechanicsVector2): number[][] {
  const base = centralTensor(component); const displacement = sub(component.center, about); const r = [displacement.x, displacement.y, 0]; const norm2 = mechanicsDot(displacement, displacement);
  return base.map((row, i) => row.map((value, j) => mechanicsSum([value, mechanicsProduct(component.mass, mechanicsSum([i === j ? norm2 : 0, -mechanicsProduct(r[i]!, r[j]!)]))])));
}
function massMoment(source: readonly MechanicsMassComponentSI[], about: MechanicsVector2, axis: MechanicsVector3, axisError?: MechanicsVector3): { value: number; error: number } {
  const squareSum = (values: readonly Exact[]): Exact => values.reduce((total, value) => add(total, multiply(value, value)), exact(0));
  let total = exact(0); const errors: number[] = [];
  for (const component of source) {
    const d = component.direction;
    const axisVariation = axisError ? Math.hypot(axisError.x, axisError.y, axisError.z) : 0, bodyVariation = component.directionErrorBoundSI ? Math.hypot(component.directionErrorBoundSI.x, component.directionErrorBoundSI.y, component.directionErrorBoundSI.z) : 0, orientationVariation = axisVariation + bodyVariation + axisVariation * bodyVariation;
    const armSize = mechanicsNorm(sub(component.center, about)); errors.push(mechanicsErrorSum([mechanicsErrorProduct(4 * Math.max(component.principal.parallel, component.principal.perpendicular), orientationVariation + orientationVariation ** 2), mechanicsErrorProduct(component.mass * armSize ** 2, 2 * axisVariation + axisVariation ** 2)]));
    const dot = add(add(multiply(exact(axis.x), exact(d.x)), multiply(exact(axis.y), exact(d.y))), multiply(exact(axis.z), exact(d.z)));
    const cross = [add(multiply(exact(axis.y), exact(d.z)), multiply(exact(-axis.z), exact(d.y))), add(multiply(exact(axis.z), exact(d.x)), multiply(exact(-axis.x), exact(d.z))), add(multiply(exact(axis.x), exact(d.y)), multiply(exact(-axis.y), exact(d.x)))];
    const rx = add(exact(component.center.x), exact(-about.x)); const ry = add(exact(component.center.y), exact(-about.y));
    const arm = [multiply(ry, exact(axis.z)), multiply(rx, exact(-axis.z)), add(multiply(rx, exact(axis.y)), multiply(ry, exact(-axis.x)))];
    const central = add(multiply(exact(component.principal.parallel), multiply(dot, dot)), multiply(exact(component.principal.perpendicular), squareSum(cross)));
    const value = add(central, multiply(exact(component.mass), squareSum(arm)));
    total = add(total, { n: component.operation === "remove" ? -value.n : value.n, e: value.e });
    const centralMagnitude = numeric(central, "centralInertia"); errors.push(mechanicsErrorProduct(centralMagnitude, component.principal.relativeTolerance));
  }
  const value = numeric(total, "inertia"); if (value < 0) mechanicsInvalid("inertia", "signed distribution has negative mass inertia");
  return { value, error: mechanicsErrorSum([...errors, mechanicsErrorProduct(Math.abs(value), MECHANICS_RELATIVE_ERROR)]) };
}
/** A signed moment is insufficient: every removal needs nonnegative density on actual parent support. */
function validateCutoutSupport(components: readonly MechanicsMassComponentSI[]): void {
  const parallel = (a: MechanicsVector3, b: MechanicsVector3): boolean => mechanicsSum([mechanicsProduct(a.y, b.z), -mechanicsProduct(a.z, b.y)]) === 0 && mechanicsSum([mechanicsProduct(a.z, b.x), -mechanicsProduct(a.x, b.z)]) === 0 && mechanicsSum([mechanicsProduct(a.x, b.y), -mechanicsProduct(a.y, b.x)]) === 0;
  const distances = (a: MechanicsMassComponentSI, b: MechanicsMassComponentSI): { norm: number; along: number; across: number } => {
    const displacement = sub(a.center, b.center); const along = mechanicsDot(displacement, b.direction);
    const across = Math.hypot(mechanicsProduct(displacement.y, b.direction.z), mechanicsProduct(displacement.x, b.direction.z), mechanicsCross(displacement, b.direction));
    return { norm: mechanicsNorm(displacement), along: Math.abs(along), across };
  };
  const within = (value: number, bound: number): boolean => value <= bound || mechanicsNear(value, bound);
  const sameSupport = (a: MechanicsMassComponentSI, b: MechanicsMassComponentSI): boolean => a.center.x === b.center.x && a.center.y === b.center.y && a.radius === b.radius && (a.shape === "spherical_shell" || parallel(a.direction, b.direction));
  const contains = (parent: MechanicsMassComponentSI, hole: MechanicsMassComponentSI): boolean => {
    if (parent.shape !== hole.shape) return false; const d = distances(hole, parent);
    if (hole.shape === "point") return d.norm === 0;
    if (hole.shape === "sphere") return within(mechanicsSum([d.norm, hole.radius!]), parent.radius!);
    if (hole.shape === "ring" || hole.shape === "spherical_shell") return sameSupport(parent, hole);
    if (!parallel(parent.direction, hole.direction)) return false;
    if (hole.shape === "rod") return d.across === 0 && within(mechanicsSum([d.along, hole.length! / 2]), parent.length! / 2);
    if (hole.shape === "disc") return d.along === 0 && within(mechanicsSum([d.norm, hole.radius!]), parent.radius!);
    return within(mechanicsSum([d.across, hole.radius!]), parent.radius!) && within(mechanicsSum([d.along, hole.length! / 2]), parent.length! / 2);
  };
  const density = (component: MechanicsMassComponentSI): number => {
    if (["point", "ring", "spherical_shell"].includes(component.shape)) return component.mass;
    let measure = component.shape === "rod" ? component.length! : mechanicsProduct(component.radius!, component.radius!);
    if (component.shape === "sphere") measure = mechanicsProduct(measure, component.radius!); if (component.shape === "cylinder") measure = mechanicsProduct(measure, component.length!);
    return mechanicsQuotient(component.mass, measure, "density");
  };
  const overlap = (a: MechanicsMassComponentSI, b: MechanicsMassComponentSI): boolean => {
    if (a.shape !== b.shape) return false; const d = distances(a, b);
    if (["point", "ring", "spherical_shell"].includes(a.shape)) return sameSupport(a, b);
    if (a.shape === "sphere") return d.norm < a.radius! + b.radius!;
    if (!parallel(a.direction, b.direction)) return true; // Conservative bound for unproved intersections.
    if (a.shape === "rod") return d.across === 0 && d.along < (a.length! + b.length!) / 2;
    if (a.shape === "disc") return d.along === 0 && d.norm < a.radius! + b.radius!;
    return d.across < a.radius! + b.radius! && d.along < (a.length! + b.length!) / 2;
  };
  const removals = components.filter(component => component.operation === "remove");
  for (const hole of removals) {
    // Every covering parent supplies its full density throughout this hole.
    // The overlap neighbourhood bounds all possible simultaneous removals.
    const available = mechanicsSum(components.filter(parent => parent.operation === "add" && contains(parent, hole)).map(density));
    const removed = mechanicsSum(removals.filter(other => overlap(hole, other)).map(density));
    if (!(available > 0) || !within(removed, available)) mechanicsInvalid("components", "cutout must have contained, compatible parent support with sufficient proven local mass density");
  }
}
export function deriveMechanicsMass(source: MechanicsMassSourceSI): MechanicsMassState {
  if (!Array.isArray(source.components) || source.components.length < 1 || source.components.length > 16) mechanicsInvalid("components", "mass distributions require one to sixteen explicit components");
  const components = source.components.map(component => {
    positive(component.mass, "mass"); vector(component.center, "center");
    if (!["add", "remove"].includes(component.operation)) mechanicsInvalid("operation", "mass components must explicitly add or remove positive mass");
    const direction = mechanicsUnit3(component.direction, "direction");
    if (component.length !== undefined) positive(component.length, "length"); if (component.radius !== undefined) positive(component.radius, "radius");
    return { ...component, direction };
  });
  validateCutoutSupport(components);
  const signed = (component: MechanicsMassComponentSI): number => component.operation === "remove" ? -component.mass : component.mass;
  const massSI = positive(mechanicsSum(components.map(signed), "mass"), "mass");
  const weighted = (coordinate: "x" | "y"): number => numeric(components.reduce((total, component) => add(total, multiply(exact(signed(component)), exact(component.center[coordinate]))), exact(0)), "centre");
  const centerOfMassSI = { x: mechanicsQuotient(weighted("x"), massSI), y: mechanicsQuotient(weighted("y"), massSI) };
  const combine = (about: MechanicsVector2): number[][] => {
    const tensors = components.map(component => shiftedTensor(component, about));
    return Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, j) => mechanicsSum(tensors.map((tensor, index) => (components[index]!.operation === "remove" ? -1 : 1) * tensor[i]![j]!))));
  };
  const centralTensorSI = combine(centerOfMassSI); const axisDirection = mechanicsUnit3(source.axis.direction, "axis.direction");
  const planar = components.every(component => component.shape === "point" || component.shape === "rod" && component.direction.z === 0 || ["ring", "disc"].includes(component.shape) && component.direction.x === 0 && component.direction.y === 0);
  // For removals, check all principal covariance minors; positive mass alone does not certify a physical distribution.
  if (components.some(component => component.operation === "remove")) {
    const covariance = centralTensorSI.map((row, i) => row.map((value, j) => i !== j ? -value : planar ? (i === 0 ? centralTensorSI[1]![1]! : i === 1 ? centralTensorSI[0]![0]! : 0) : mechanicsProduct(0.5, mechanicsSum(centralTensorSI.map((other, k) => (k === i ? -1 : 1) * other[k]!)))));
    const scale = Math.max(...covariance.flat().map(Math.abs)); const c = covariance.map(row => row.map(value => scale === 0 ? 0 : value / scale));
    if (c.some((row, i) => row[i]! < 0) || [0, 1, 2].some(i => [0, 1, 2].some(j => i < j && c[i]![i]! * c[j]![j]! - c[i]![j]! ** 2 < -MECHANICS_RELATIVE_ERROR))) mechanicsInvalid("components", "removed mass produces an indefinite central mass distribution");
    const determinant = c[0]![0]! * (c[1]![1]! * c[2]![2]! - c[1]![2]! ** 2) - c[0]![1]! * (c[0]![1]! * c[2]![2]! - c[1]![2]! * c[0]![2]!) + c[0]![2]! * (c[0]![1]! * c[1]![2]! - c[1]![1]! * c[0]![2]!);
    if (determinant < -MECHANICS_RELATIVE_ERROR) mechanicsInvalid("components", "removed mass produces an indefinite central mass distribution");
  }
  const inertia = massMoment(components, source.axis.point, axisDirection, source.axis.directionErrorBoundSI); const centralInertia = massMoment(components, centerOfMassSI, axisDirection, source.axis.directionErrorBoundSI);
  const ix = massMoment(components, source.axis.point, { x: 1, y: 0, z: 0 }), iy = massMoment(components, source.axis.point, { x: 0, y: 1, z: 0 }), iz = massMoment(components, source.axis.point, { x: 0, y: 0, z: 1 });
  const inertiaSI = inertia.value, centralInertiaSI = centralInertia.value;
  const relativeTolerance = Math.max(MECHANICS_RELATIVE_ERROR, ...components.map(component => component.principal.relativeTolerance));
  const gyrationRadiusSI = Math.sqrt(mechanicsQuotient(inertiaSI, massSI)); const gyrationError = mechanicsErrorSum([Math.max(gyrationRadiusSI - Math.sqrt(Math.max(0, inertiaSI - inertia.error) / massSI), Math.sqrt((inertiaSI + inertia.error) / massSI) - gyrationRadiusSI), mechanicsErrorProduct(gyrationRadiusSI, MECHANICS_RELATIVE_ERROR)]);
  return { massSI, centerOfMassSI, centralTensorSI, inertiaSI, centralInertiaSI, gyrationRadiusSI, inertiaAxesSI: { x: ix.value, y: iy.value, z: iz.value }, planar, relativeTolerance, errorBoundsSI: { massSI: mechanicsErrorProduct(massSI, MECHANICS_RELATIVE_ERROR), centerOfMassSI: { x: mechanicsErrorProduct(Math.abs(centerOfMassSI.x), MECHANICS_RELATIVE_ERROR), y: mechanicsErrorProduct(Math.abs(centerOfMassSI.y), MECHANICS_RELATIVE_ERROR) }, inertiaSI: inertia.error, centralInertiaSI: centralInertia.error, gyrationRadiusSI: gyrationError, inertiaAxesSI: { x: ix.error, y: iy.error, z: iz.error } } };
}

export interface MechanicsMotionSourceSI {
  readonly mass: number; readonly inertia: number; readonly position: MechanicsVector2; readonly velocity: MechanicsVector2;
  readonly angularVelocity: number; readonly acceleration?: MechanicsVector2; readonly angularAcceleration?: number; readonly referencePoint: MechanicsVector2;
  readonly derivation?: MechanicsMotionDerivationSI;
  readonly inertiaErrorBoundSI?: number; readonly angularVelocityErrorBoundSI?: number; readonly velocityErrorBoundSI?: MechanicsVector2; readonly positionErrorBoundSI?: MechanicsVector2; readonly accelerationErrorBoundSI?: MechanicsVector2; readonly angularAccelerationErrorBoundSI?: number;
  readonly angularLaw?: MechanicsAngularLawSI; readonly circularContact?: MechanicsCircularContactSI; readonly atRest?: boolean;
  readonly bodyGeometry?: MechanicsBodyGeometrySI;
}
export interface MechanicsBodyGeometrySI { readonly shape: "circular" | "rod" | "ring" | "disc" | "cylinder" | "sphere" | "spherical_shell"; readonly radius?: number; readonly length?: number; readonly direction?: MechanicsVector3; readonly center?: MechanicsVector2; readonly endpoints?: readonly [MechanicsVector2, MechanicsVector2] }
export function mechanicsBodyCenter(body: MechanicsBodyGeometrySI, fallback: MechanicsVector2): MechanicsVector2 { if (body.endpoints) return scaled(plus(body.endpoints[0], body.endpoints[1]), 0.5); return body.center ?? fallback; }
function validateBodyGeometry(body?: MechanicsBodyGeometrySI): void { if (!body) return; if (!body.shape || !["circular", "rod", "ring", "disc", "cylinder", "sphere", "spherical_shell"].includes(body.shape)) mechanicsInvalid("bodyGeometry", "body geometry requires a declared source shape"); if (body.center) vector(body.center, "bodyGeometry.center"); if (body.shape === "rod") { if (body.radius !== undefined || body.endpoints && (body.length !== undefined || body.direction !== undefined) || !body.endpoints && (body.length === undefined || !body.direction)) mechanicsInvalid("bodyGeometry", "source rod uses only endpoints or centre/length/direction"); if (body.endpoints) { body.endpoints.forEach(endpoint => vector(endpoint, "endpoints")); if (mechanicsNorm(sub(body.endpoints[0], body.endpoints[1])) === 0) mechanicsInvalid("endpoints", "source rod endpoints must be distinct"); } else positive(body.length!, "length"); } else { positive(body.radius!, "radius"); if (body.endpoints || body.shape !== "cylinder" && body.length !== undefined) mechanicsInvalid("bodyGeometry", "source body dimensions must match its shape"); if (body.length !== undefined) positive(body.length, "length"); } if (body.direction) mechanicsUnit3(body.direction, "bodyGeometry.direction"); }
export interface MechanicsKinematicsState {
  readonly positionSI: MechanicsVector2; readonly velocitySI: MechanicsVector2; readonly angularVelocitySI: number;
  readonly accelerationSI: MechanicsVector2 | null; readonly angularAccelerationSI: number | null; readonly angleSI?: number; readonly angleQuarterTurns?: number;
  readonly errorBoundsSI: { readonly positionSI: MechanicsVector2; readonly velocitySI: MechanicsVector2; readonly angularVelocitySI: number; readonly accelerationSI: MechanicsVector2 | null; readonly angularAccelerationSI: number | null; readonly angleSI?: number };
}
export interface MechanicsAngularLawSI { readonly expression: string; readonly at: number; readonly timeScale: number; readonly angleScale: number }
export function deriveMechanicsAngularLaw(source: MechanicsAngularLawSI): { angleSI: number; angularVelocitySI: number; angularAccelerationSI: number; angleQuarterTurns?: number; errorBoundsSI: { angleSI: number; angularVelocitySI: number; angularAccelerationSI: number } } {
  positive(source.timeScale, "timeScale"); positive(source.angleScale, "angleScale"); mechanicsFinite(source.at, "time");
  const parsed = parseMathExpression(source.expression); const parameter = mechanicsQuotient(source.at, source.timeScale), jet = parsed.certifiedJetAt(parameter); const angleSI = mechanicsProduct(jet.value, source.angleScale), angularVelocitySI = mechanicsQuotient(mechanicsProduct(jet.derivative, source.angleScale), source.timeScale), angularAccelerationSI = mechanicsQuotient(mechanicsProduct(jet.secondDerivative, source.angleScale), mechanicsProduct(source.timeScale, source.timeScale));
  const quarter = source.angleScale === Math.PI / 180 && jet.errorBounds.value === 0 && Number.isInteger(jet.value / 90) ? jet.value / 90 : source.angleScale === 1 && "exactQuarterTurns" in jet && typeof jet.exactQuarterTurns === "number" && Number.isInteger(jet.exactQuarterTurns) ? jet.exactQuarterTurns : undefined;
  const bound = (value: number, error: number, scale: number): number => mechanicsErrorSum([mechanicsErrorProduct(error, scale), source.angleScale !== 1 || source.timeScale !== 1 ? mechanicsErrorProduct(Math.abs(value), MECHANICS_RELATIVE_ERROR) : 0]);
  return { angleSI, angularVelocitySI, angularAccelerationSI, ...(quarter === undefined ? {} : { angleQuarterTurns: quarter }), errorBoundsSI: { angleSI: bound(angleSI, jet.errorBounds.value, source.angleScale), angularVelocitySI: bound(angularVelocitySI, jet.errorBounds.derivative, source.angleScale / source.timeScale), angularAccelerationSI: bound(angularAccelerationSI, jet.errorBounds.secondDerivative, source.angleScale / source.timeScale ** 2) } };
}
export interface MechanicsKinematicsSourceSI { readonly position: MechanicsVector2; readonly velocity: MechanicsVector2; readonly angularVelocity: number; readonly acceleration?: MechanicsVector2; readonly angularAcceleration?: number; readonly angularLaw?: MechanicsAngularLawSI; readonly circularContact?: MechanicsCircularContactSI; readonly fixedReference?: boolean; readonly atRest?: boolean; readonly velocityErrorBoundSI?: MechanicsVector2; readonly accelerationErrorBoundSI?: MechanicsVector2; readonly bodyGeometry?: MechanicsBodyGeometrySI }
export function deriveMechanicsKinematics(source: MechanicsKinematicsSourceSI): MechanicsKinematicsState {
  vector(source.position, "position"); vector(source.velocity, "velocity"); mechanicsFinite(source.angularVelocity, "angularVelocity");
  validateBodyGeometry(source.bodyGeometry);
  if (source.acceleration) vector(source.acceleration, "acceleration"); if (source.angularAcceleration !== undefined) mechanicsFinite(source.angularAcceleration, "angularAcceleration");
  if (source.fixedReference !== undefined && source.fixedReference !== true || source.atRest !== undefined && source.atRest !== true || (source.fixedReference || source.atRest) && (source.velocity.x !== 0 || source.velocity.y !== 0) || source.atRest && source.angularVelocity !== 0 || source.fixedReference && (!source.acceleration || source.acceleration.x !== 0 || source.acceleration.y !== 0)) mechanicsInvalid("hypotheses", "fixed-reference/rest kinematics must retain its actual zero translational/angular state");
  const law = source.angularLaw ? deriveMechanicsAngularLaw(source.angularLaw) : undefined;
  if (law && (source.angularVelocity !== law.angularVelocitySI || source.angularAcceleration !== law.angularAccelerationSI)) mechanicsInvalid("angularLaw", "angular state must retain its original source-law derivatives");
  const accelerationSI = source.acceleration ?? null; const angularAccelerationSI = source.angularAcceleration ?? null;
  const state: MechanicsKinematicsState = { positionSI: { ...source.position }, velocitySI: { ...source.velocity }, angularVelocitySI: source.angularVelocity, accelerationSI, angularAccelerationSI, ...(law ? { angleSI: law.angleSI, ...(law.angleQuarterTurns === undefined ? {} : { angleQuarterTurns: law.angleQuarterTurns }) } : {}), errorBoundsSI: { positionSI: { x: 0, y: 0 }, velocitySI: source.velocityErrorBoundSI ?? { x: 0, y: 0 }, angularVelocitySI: law?.errorBoundsSI.angularVelocitySI ?? 0, accelerationSI: accelerationSI ? source.accelerationErrorBoundSI ?? { x: 0, y: 0 } : null, angularAccelerationSI: angularAccelerationSI === null ? null : law?.errorBoundsSI.angularAccelerationSI ?? 0, ...(law ? { angleSI: law.errorBoundsSI.angleSI } : {}) } };
  if (source.circularContact) mechanicsCircularKinematics(state, source.circularContact); return state;
}
export interface MechanicsMotionState extends MechanicsKinematicsState {
  readonly massSI: number; readonly inertiaSI: number; readonly positionSI: MechanicsVector2; readonly velocitySI: MechanicsVector2;
  readonly angularVelocitySI: number; readonly accelerationSI: MechanicsVector2 | null; readonly angularAccelerationSI: number | null;
  readonly referencePointSI: MechanicsVector2; readonly momentumSI: MechanicsVector2; readonly angularMomentumSI: number;
  readonly translationEnergySI: number; readonly rotationEnergySI: number; readonly kineticEnergySI: number;
  readonly wrenchSI?: MechanicsWrench; readonly supportReactionsSI?: readonly MechanicsReaction[]; readonly collisionSI?: MechanicsCollisionState; readonly equilibriumSI?: { readonly requiredReactionsSI: readonly MechanicsReaction[]; readonly admissible: boolean };
  readonly errorBoundsSI: { readonly inertiaSI: number; readonly positionSI: MechanicsVector2; readonly velocitySI: MechanicsVector2; readonly angularVelocitySI: number; readonly accelerationSI: MechanicsVector2 | null; readonly angularAccelerationSI: number | null; readonly angularMomentumSI: number; readonly translationEnergySI: number; readonly rotationEnergySI: number; readonly kineticEnergySI: number };
}
export function deriveMechanicsMotion(source: MechanicsMotionSourceSI): MechanicsMotionState {
  const massSI = positive(source.mass, "mass"); const inertiaSI = positive(source.inertia, "inertia", true);
  validateBodyGeometry(source.bodyGeometry);
  [source.position, source.velocity, source.referencePoint].forEach(value => vector(value, "motion")); mechanicsFinite(source.angularVelocity, "angularVelocity");
  if (source.atRest !== undefined && source.atRest !== true || source.atRest && (source.velocity.x !== 0 || source.velocity.y !== 0 || source.angularVelocity !== 0)) mechanicsInvalid("atRest", "source instantaneous rest cannot retain nonzero velocity or spin");
  if (inertiaSI === 0 && (source.angularVelocity !== 0 || source.angularAcceleration !== undefined && source.angularAcceleration !== 0)) mechanicsInvalid("inertia", "nonzero spin or angular acceleration requires a positive COM moment");
  if (source.acceleration !== undefined) vector(source.acceleration, "acceleration"); if (source.angularAcceleration !== undefined) mechanicsFinite(source.angularAcceleration, "angularAcceleration");
  const angularLaw = source.angularLaw ? deriveMechanicsAngularLaw(source.angularLaw) : undefined; if (angularLaw && (source.angularVelocity !== angularLaw.angularVelocitySI || source.angularAcceleration !== angularLaw.angularAccelerationSI)) mechanicsInvalid("angularLaw", "motion rates must retain their source-law derivatives");
  const inertiaError = mechanicsErrorBound(source.inertiaErrorBoundSI ?? 0); if (inertiaError > 0 && inertiaError >= inertiaSI) mechanicsInvalid("uncertainty", "COM inertia interval must remain strictly positive");
  const omegaError = mechanicsErrorSum([source.angularVelocityErrorBoundSI ?? 0, angularLaw?.errorBoundsSI.angularVelocitySI ?? 0]); const velocityError = source.velocityErrorBoundSI ?? { x: 0, y: 0 }; const positionError = source.positionErrorBoundSI ?? { x: 0, y: 0 };
  [velocityError.x, velocityError.y, positionError.x, positionError.y].forEach(mechanicsErrorBound); let alphaError: number | null = source.angularAcceleration === undefined ? null : mechanicsErrorSum([source.angularAccelerationErrorBoundSI ?? 0, angularLaw?.errorBoundsSI.angularAccelerationSI ?? 0, mechanicsErrorProduct(Math.abs(source.angularAcceleration), MECHANICS_RELATIVE_ERROR)]);
  let accelerationSI = source.acceleration ? { ...source.acceleration } : null; let angularAccelerationSI = source.angularAcceleration ?? null;
  let wrenchSI: MechanicsWrench | undefined; let supportReactionsSI: readonly MechanicsReaction[] | undefined; let collisionSI: MechanicsCollisionState | undefined; let equilibriumSI: MechanicsMotionState["equilibriumSI"];
  const derivation = source.derivation;
  if (derivation?.kind === "forces") {
    validateMechanicsInternalPairs(derivation.internalPairs ?? []); const gravity = derivation.gravity ? [{ ...mechanicsGravityForce(massSI, source.position, derivation.gravity), forceErrorBoundSI: scaled(derivation.gravityErrorBoundSI ?? { x: 0, y: 0 }, massSI) }] : []; wrenchSI = mechanicsWrench([...derivation.forces, ...gravity], derivation.couples ?? [], source.position);
    const acceleration = scaled(wrenchSI.forceSI, mechanicsQuotient(1, massSI)); const alpha = inertiaSI === 0 && wrenchSI.torqueSI === 0 ? 0 : mechanicsQuotient(wrenchSI.torqueSI, inertiaSI, "inertia");
    alphaError = mechanicsErrorSum([inertiaSI === 0 ? 0 : (wrenchSI.errorBoundsSI?.torqueSI ?? 0) / (inertiaSI - inertiaError), inertiaError === 0 ? 0 : mechanicsErrorProduct(Math.abs(alpha), inertiaError / (inertiaSI - inertiaError)), mechanicsErrorProduct(Math.abs(alpha), MECHANICS_RELATIVE_ERROR)]);
    if (accelerationSI && (!mechanicsNear(accelerationSI.x, acceleration.x) || !mechanicsNear(accelerationSI.y, acceleration.y)) || angularAccelerationSI !== null && (angularAccelerationSI === 0 && alpha !== 0 || Math.abs(angularAccelerationSI - alpha) > alphaError)) mechanicsInvalid("derivation", "supplied acceleration contradicts the force/torque sum");
    accelerationSI = acceleration; angularAccelerationSI = alpha;
  } else if (derivation?.kind === "equilibrium") {
    if (source.velocity.x !== 0 || source.velocity.y !== 0 || source.angularVelocity !== 0) mechanicsInvalid("equilibrium", "static equilibrium requires rest in the declared inertial frame");
    if (accelerationSI && (accelerationSI.x !== 0 || accelerationSI.y !== 0) || angularAccelerationSI !== null && angularAccelerationSI !== 0) mechanicsInvalid("equilibrium", "static equilibrium cannot retain nonzero acceleration");
    const gravity = derivation.gravity ? [{ ...mechanicsGravityForce(massSI, source.position, derivation.gravity), forceErrorBoundSI: scaled(derivation.gravityErrorBoundSI ?? { x: 0, y: 0 }, massSI) }] : [];
    const requiredReactionsSI = solveMechanicsEquilibrium([...derivation.forces, ...gravity], derivation.couples ?? [], derivation.supports, source.referencePoint, derivation.mode ?? "dynamics");
    equilibriumSI = { requiredReactionsSI, admissible: requiredReactionsSI.every(reaction => reaction.kind === "pin" || mechanicsDot(reaction.componentsSI, derivation.supports.find(support => support.id === reaction.id)!.direction!) >= 0) };
    if (derivation.mode === "feasibility") { if (source.acceleration !== undefined || source.angularAcceleration !== undefined) mechanicsInvalid("equilibrium", "feasibility cannot assert actual equilibrium acceleration"); accelerationSI = null; angularAccelerationSI = null; alphaError = null; }
    else { supportReactionsSI = requiredReactionsSI; wrenchSI = { forceSI: { x: 0, y: 0 }, torqueSI: 0, referencePointSI: { ...source.position } }; accelerationSI = { x: 0, y: 0 }; angularAccelerationSI = 0; alphaError = 0; }
  } else if (derivation?.kind === "sticking_collision") {
    collisionSI = deriveMechanicsStickingCollision(derivation.bodies, derivation.constraint, source.referencePoint);
    const final = collisionSI.motion;
    if (!mechanicsNear(massSI, final.massSI) || !mechanicsNear(inertiaSI, final.inertiaSI) || !mechanicsNear(source.position.x, final.positionSI.x) || !mechanicsNear(source.position.y, final.positionSI.y) || !mechanicsNear(source.velocity.x, final.velocitySI.x) || !mechanicsNear(source.velocity.y, final.velocitySI.y) || !mechanicsNear(source.angularVelocity, final.angularVelocitySI)) mechanicsInvalid("collision", "rigid-body state contradicts the independently solved sticking collision");
    if (accelerationSI !== null || angularAccelerationSI !== null) mechanicsInvalid("collision", "an impact law determines the post-impact velocity, not subsequent accelerations");
  } else if (derivation !== undefined) mechanicsInvalid("derivation", "unsupported mechanical motion derivation");
  const rx = add(exact(source.position.x), exact(-source.referencePoint.x)), ry = add(exact(source.position.y), exact(-source.referencePoint.y));
  const momentumSI = scaled(source.velocity, massSI); const orbital = multiply(exact(massSI), add(multiply(rx, exact(source.velocity.y)), multiply(ry, exact(-source.velocity.x))));
  const angularMomentumSI = numeric(add(orbital, multiply(exact(inertiaSI), exact(source.angularVelocity))), "angularMomentum");
  const translational = multiply(multiply(exact(massSI), exact(0.5)), add(multiply(exact(source.velocity.x), exact(source.velocity.x)), multiply(exact(source.velocity.y), exact(source.velocity.y))));
  const rotational = multiply(multiply(exact(inertiaSI), exact(0.5)), multiply(exact(source.angularVelocity), exact(source.angularVelocity)));
  const translationEnergySI = numeric(translational, "energy"), rotationEnergySI = numeric(rotational, "energy"), kineticEnergySI = numeric(add(translational, rotational), "energy");
  const rotationError = mechanicsErrorSum([mechanicsErrorProduct(0.5 * source.angularVelocity ** 2, inertiaError), mechanicsErrorProduct(inertiaSI + inertiaError, Math.abs(source.angularVelocity) * omegaError + 0.5 * omegaError ** 2), mechanicsErrorProduct(rotationEnergySI, MECHANICS_RELATIVE_ERROR)]);
  const translationError = mechanicsErrorSum([mechanicsErrorProduct(massSI, Math.abs(source.velocity.x) * velocityError.x + Math.abs(source.velocity.y) * velocityError.y + 0.5 * (velocityError.x ** 2 + velocityError.y ** 2)), mechanicsErrorProduct(translationEnergySI, MECHANICS_RELATIVE_ERROR)]);
  const arm = sub(source.position, source.referencePoint); const angularError = mechanicsErrorSum([mechanicsErrorProduct(Math.abs(source.angularVelocity), inertiaError), mechanicsErrorProduct(inertiaSI + inertiaError, omegaError), mechanicsErrorProduct(massSI, positionError.x * (Math.abs(source.velocity.y) + velocityError.y) + positionError.y * (Math.abs(source.velocity.x) + velocityError.x) + Math.abs(arm.x) * velocityError.y + Math.abs(arm.y) * velocityError.x), mechanicsErrorProduct(Math.abs(angularMomentumSI), MECHANICS_RELATIVE_ERROR)]);
  const state: MechanicsMotionState = { massSI, inertiaSI, positionSI: { ...source.position }, velocitySI: { ...source.velocity }, angularVelocitySI: source.angularVelocity, accelerationSI, angularAccelerationSI, ...(angularLaw ? { angleSI: angularLaw.angleSI, ...(angularLaw.angleQuarterTurns === undefined ? {} : { angleQuarterTurns: angularLaw.angleQuarterTurns }) } : {}), referencePointSI: { ...source.referencePoint }, momentumSI, angularMomentumSI, translationEnergySI, rotationEnergySI, kineticEnergySI, errorBoundsSI: { inertiaSI: mechanicsErrorSum([inertiaError, mechanicsErrorProduct(inertiaSI, MECHANICS_RELATIVE_ERROR)]), positionSI: positionError, velocitySI: velocityError, angularVelocitySI: omegaError, accelerationSI: accelerationSI ? { x: mechanicsErrorSum([source.accelerationErrorBoundSI?.x ?? 0, (wrenchSI?.errorBoundsSI?.forceSI.x ?? 0) / massSI, mechanicsErrorProduct(Math.abs(accelerationSI.x), MECHANICS_RELATIVE_ERROR)]), y: mechanicsErrorSum([source.accelerationErrorBoundSI?.y ?? 0, (wrenchSI?.errorBoundsSI?.forceSI.y ?? 0) / massSI, mechanicsErrorProduct(Math.abs(accelerationSI.y), MECHANICS_RELATIVE_ERROR)]) } : null, angularAccelerationSI: alphaError, angularMomentumSI: angularError, translationEnergySI: translationError, rotationEnergySI: rotationError, kineticEnergySI: mechanicsErrorSum([rotationError, translationError, mechanicsErrorProduct(kineticEnergySI, MECHANICS_RELATIVE_ERROR)]) }, ...(wrenchSI ? { wrenchSI } : {}), ...(supportReactionsSI ? { supportReactionsSI } : {}), ...(collisionSI ? { collisionSI } : {}), ...(equilibriumSI ? { equilibriumSI } : {}) };
  if (source.circularContact) mechanicsCircularKinematics(state, source.circularContact); return state;
}
export function mechanicsPointState(state: MechanicsKinematicsState, offset: MechanicsVector2): { position: MechanicsVector2; velocity: MechanicsVector2; acceleration: MechanicsVector2 | null; errorBoundsSI: { position: MechanicsVector2; velocity: MechanicsVector2; acceleration: MechanicsVector2 | null } } {
  vector(offset, "offset"); const omega = exact(state.angularVelocitySI);
  const velocity = { x: numeric(add(exact(state.velocitySI.x), multiply(omega, exact(-offset.y))), "pointVelocity"), y: numeric(add(exact(state.velocitySI.y), multiply(omega, exact(offset.x))), "pointVelocity") };
  const acceleration = state.accelerationSI !== null && state.angularAccelerationSI !== null ? { x: numeric(add(add(exact(state.accelerationSI.x), multiply(exact(state.angularAccelerationSI), exact(-offset.y))), multiply(multiply(omega, omega), exact(-offset.x))), "pointAcceleration"), y: numeric(add(add(exact(state.accelerationSI.y), multiply(exact(state.angularAccelerationSI), exact(offset.x))), multiply(multiply(omega, omega), exact(-offset.y))), "pointAcceleration") } : null;
  const position = plus(state.positionSI, offset), errors = state.errorBoundsSI; const centrifugalError = mechanicsErrorSum([mechanicsErrorProduct(2 * Math.abs(state.angularVelocitySI), errors.angularVelocitySI), mechanicsErrorProduct(errors.angularVelocitySI, errors.angularVelocitySI)]);
  const velocityError = { x: mechanicsErrorSum([errors.velocitySI.x, mechanicsErrorProduct(Math.abs(offset.y), errors.angularVelocitySI), mechanicsErrorProduct(Math.abs(velocity.x), MECHANICS_RELATIVE_ERROR)]), y: mechanicsErrorSum([errors.velocitySI.y, mechanicsErrorProduct(Math.abs(offset.x), errors.angularVelocitySI), mechanicsErrorProduct(Math.abs(velocity.y), MECHANICS_RELATIVE_ERROR)]) };
  const accelerationError = acceleration && errors.accelerationSI && errors.angularAccelerationSI !== null ? { x: mechanicsErrorSum([errors.accelerationSI.x, mechanicsErrorProduct(Math.abs(offset.y), errors.angularAccelerationSI), mechanicsErrorProduct(Math.abs(offset.x), centrifugalError), mechanicsErrorProduct(Math.abs(acceleration.x), MECHANICS_RELATIVE_ERROR)]), y: mechanicsErrorSum([errors.accelerationSI.y, mechanicsErrorProduct(Math.abs(offset.x), errors.angularAccelerationSI), mechanicsErrorProduct(Math.abs(offset.y), centrifugalError), mechanicsErrorProduct(Math.abs(acceleration.y), MECHANICS_RELATIVE_ERROR)]) } : null;
  return { position, velocity, acceleration, errorBoundsSI: { position: { x: mechanicsErrorSum([errors.positionSI.x, mechanicsErrorProduct(Math.abs(position.x), MECHANICS_RELATIVE_ERROR)]), y: mechanicsErrorSum([errors.positionSI.y, mechanicsErrorProduct(Math.abs(position.y), MECHANICS_RELATIVE_ERROR)]) }, velocity: velocityError, acceleration: accelerationError } };
}
export function mechanicsInstantaneousCenter(state: MechanicsKinematicsState): MechanicsVector2 {
  if (state.errorBoundsSI.angularVelocitySI > 0 && Math.abs(state.angularVelocitySI) <= state.errorBoundsSI.angularVelocitySI) mechanicsInvalid("uncertainty", "instantaneous-centre construction requires a certified nonzero angular rate");
  if (state.angularVelocitySI === 0) mechanicsInvalid("instantaneous_center", state.velocitySI.x === 0 && state.velocitySI.y === 0 ? "a body at rest has no unique instantaneous centre" : "pure translation has no finite instantaneous centre");
  return plus(state.positionSI, { x: mechanicsQuotient(-state.velocitySI.y, state.angularVelocitySI), y: mechanicsQuotient(state.velocitySI.x, state.angularVelocitySI) });
}
export function mechanicsPointContribution(state: MechanicsKinematicsState, offset: MechanicsVector2, kind: string): ReturnType<typeof mechanicsPointState> {
  if (!["point_tangential_velocity", "point_translation_velocity", "point_tangential_acceleration", "point_normal_acceleration", "point_translation_acceleration"].includes(kind)) return mechanicsPointState(state, offset);
  const translation = kind.includes("translation"), velocity = kind.endsWith("velocity"), normal = kind === "point_normal_acceleration";
  const selected: MechanicsKinematicsState = { ...state, velocitySI: translation ? state.velocitySI : { x: 0, y: 0 }, accelerationSI: translation ? state.accelerationSI : { x: 0, y: 0 }, angularVelocitySI: translation || !velocity && !normal ? 0 : state.angularVelocitySI, angularAccelerationSI: translation || normal ? 0 : state.angularAccelerationSI, errorBoundsSI: { ...state.errorBoundsSI, velocitySI: translation ? state.errorBoundsSI.velocitySI : { x: 0, y: 0 }, accelerationSI: translation ? state.errorBoundsSI.accelerationSI : { x: 0, y: 0 }, angularVelocitySI: translation || !velocity && !normal ? 0 : state.errorBoundsSI.angularVelocitySI, angularAccelerationSI: translation || normal ? 0 : state.errorBoundsSI.angularAccelerationSI } };
  return mechanicsPointState(selected, offset);
}
export function mechanicsCircularKinematics(state: MechanicsKinematicsState, contact: MechanicsCircularContactSI): { velocitySI: MechanicsVector2; errorBoundSI: MechanicsVector2 } | null {
  mechanicsCircularCenter(contact); const normal = turn(contact.surface.tangent), distance = mechanicsDot(sub(state.positionSI, contact.surface.point), normal); if (!mechanicsNear(distance, contact.radius)) mechanicsInvalid("contact", "source circular centre must remain one radius from its stated plane");
  if (contact.regime === undefined) return null; if (contact.regime !== "no_slip" || contact.surface.stationary !== undefined && contact.surface.stationary !== true || contact.surface.stationary && contact.surface.velocity !== undefined || !contact.surface.stationary && contact.surface.velocity === undefined) mechanicsInvalid("contact", "source no-slip kinematics requires one stationary-surface premise or its actual source velocity");
  const surface = contact.surface.stationary ? { x: 0, y: 0 } : contact.surface.velocity!, offset = scaled(normal, -contact.radius), actual = mechanicsPointState(state, offset).velocity; vector(surface, "surface.velocity");
  const radiusError = mechanicsDecimalEncodingError(contact.radius), omegaError = mechanicsErrorSum([state.errorBoundsSI.angularVelocitySI, mechanicsDecimalEncodingError(state.angularVelocitySI)]), directionError = contact.surface.directionErrorBoundSI ?? { x: 0, y: 0 };
  for (const key of ["x", "y"] as const) { const arm = key === "x" ? offset.y : offset.x, normalComponent = key === "x" ? normal.y : normal.x, normalError = key === "x" ? directionError.x : directionError.y, armError = mechanicsErrorSum([mechanicsErrorProduct(Math.abs(normalComponent), radiusError), mechanicsErrorProduct(contact.radius + radiusError, normalError)]), error = mechanicsErrorSum([state.errorBoundsSI.velocitySI[key], mechanicsDecimalEncodingError(state.velocitySI[key]), mechanicsErrorProduct(Math.abs(arm), omegaError), mechanicsErrorProduct(Math.abs(state.angularVelocitySI) + omegaError, armError), contact.surface.velocityErrorBoundSI?.[key] ?? 0, mechanicsDecimalEncodingError(surface[key])]); if (Math.abs(mechanicsSum([actual[key], -surface[key]])) > error) mechanicsInvalid("regime", "source no-slip premise contradicts independently computed contact velocity beyond input encoding error"); }
  return { velocitySI: surface, errorBoundSI: contact.surface.stationary ? { x: 0, y: 0 } : contact.surface.velocityErrorBoundSI ?? { x: 0, y: 0 } };
}
export function mechanicsInstantaneousCenterStatus(state: MechanicsKinematicsState): { finite: boolean; unique: boolean } { if (state.errorBoundsSI.angularVelocitySI > 0 && Math.abs(state.angularVelocitySI) <= state.errorBoundsSI.angularVelocitySI || state.angularVelocitySI === 0 && ["x", "y"].some(coordinate => { const key = coordinate as "x" | "y"; return state.errorBoundsSI.velocitySI[key] > 0 && Math.abs(state.velocitySI[key]) <= state.errorBoundsSI.velocitySI[key]; })) mechanicsInvalid("uncertainty", "zero/rest/finite-IC status is unresolved within the source uncertainty"); return { finite: state.angularVelocitySI !== 0 || state.velocitySI.x === 0 && state.velocitySI.y === 0, unique: state.angularVelocitySI !== 0 }; }

export interface MechanicsAppliedForce { readonly id?: string; readonly point: MechanicsVector2; readonly force: MechanicsVector2; readonly forceErrorBoundSI?: MechanicsVector2; readonly weight?: { readonly mass: number; readonly gravity: MechanicsVector2 } }
export interface MechanicsWrench { readonly forceSI: MechanicsVector2; readonly torqueSI: number; readonly referencePointSI: MechanicsVector2; readonly errorBoundsSI?: { readonly forceSI: MechanicsVector2; readonly torqueSI: number } }
export interface MechanicsSupport { readonly id: string; readonly point: MechanicsVector2; readonly kind: "pin" | "contact" | "cable"; readonly direction?: MechanicsVector2 }
export interface MechanicsReaction { readonly id: string; readonly pointSI: MechanicsVector2; readonly componentsSI: MechanicsVector2; readonly magnitudeSI: number; readonly kind: MechanicsSupport["kind"]; readonly errorBoundsSI?: MechanicsVector2; readonly signedMagnitudeSI?: number; readonly signedErrorBoundSI?: number }
export type MechanicsMotionDerivationSI =
  | { readonly kind: "forces"; readonly forces: readonly MechanicsAppliedForce[]; readonly couples?: readonly number[]; readonly gravity?: MechanicsVector2; readonly gravityErrorBoundSI?: MechanicsVector2; readonly internalPairs?: readonly (readonly [MechanicsAppliedForce, MechanicsAppliedForce])[] }
  | { readonly kind: "equilibrium"; readonly mode?: "dynamics" | "feasibility"; readonly forces: readonly MechanicsAppliedForce[]; readonly couples?: readonly number[]; readonly gravity?: MechanicsVector2; readonly gravityErrorBoundSI?: MechanicsVector2; readonly supports: readonly MechanicsSupport[] }
  | { readonly kind: "sticking_collision"; readonly bodies: readonly MechanicsMotionSourceSI[]; readonly constraint: MechanicsCollisionConstraint };
export interface MechanicsWrenchSourceSI { readonly mode: "wrench" | "equilibrium"; readonly referencePoint: MechanicsVector2; readonly axisId?: string; readonly forces: readonly MechanicsAppliedForce[]; readonly couples: readonly number[]; readonly supports?: readonly MechanicsSupport[]; readonly equilibriumMode?: "dynamics" | "feasibility"; readonly hypotheses?: { readonly atRest: boolean; readonly fixedSupports: boolean }; readonly bodyGeometry?: MechanicsBodyGeometrySI }
export interface MechanicsWrenchState { readonly externalWrenchSI: MechanicsWrench; readonly wrenchSI: MechanicsWrench | null; readonly requiredReactionsSI: readonly MechanicsReaction[] | null; readonly supportReactionsSI: readonly MechanicsReaction[] | null; readonly admissible: boolean | null }
export function deriveMechanicsWrenchModel(source: MechanicsWrenchSourceSI): MechanicsWrenchState {
  validateBodyGeometry(source.bodyGeometry);
  const externalWrenchSI = mechanicsWrench(source.forces, source.couples, source.referencePoint);
  if (source.mode === "wrench") { if (source.supports || source.hypotheses || source.equilibriumMode) mechanicsInvalid("mode", "wrench model does not infer static supports"); return { externalWrenchSI, wrenchSI: externalWrenchSI, requiredReactionsSI: null, supportReactionsSI: null, admissible: null }; }
  if (source.mode !== "equilibrium" || source.hypotheses?.atRest !== true || source.hypotheses.fixedSupports !== true || !source.supports) mechanicsInvalid("hypotheses", "equilibrium requires source rest and fixed-support premises");
  const mode = source.equilibriumMode ?? "dynamics", requiredReactionsSI = solveMechanicsEquilibrium(source.forces, source.couples, source.supports, source.referencePoint, mode);
  const admissible = requiredReactionsSI.some(reaction => reaction.kind !== "pin" && reaction.signedMagnitudeSI! < -reaction.signedErrorBoundSI!) ? false : requiredReactionsSI.some(reaction => reaction.kind !== "pin" && reaction.signedErrorBoundSI! > 0 && Math.abs(reaction.signedMagnitudeSI!) <= reaction.signedErrorBoundSI!) ? null : true;
  if (mode === "dynamics" && admissible !== true) mechanicsInvalid("supports", "actual equilibrium needs certified nonnegative unilateral reactions");
  return { externalWrenchSI, requiredReactionsSI, admissible, supportReactionsSI: mode === "feasibility" ? null : requiredReactionsSI, wrenchSI: mode === "feasibility" ? null : { forceSI: { x: 0, y: 0 }, torqueSI: 0, referencePointSI: source.referencePoint, errorBoundsSI: { forceSI: { x: 0, y: 0 }, torqueSI: 0 } } };
}
export function mechanicsWrench(forces: readonly MechanicsAppliedForce[], couples: readonly number[], about: MechanicsVector2): MechanicsWrench {
  if (!Array.isArray(forces) || forces.length > 32 || !Array.isArray(couples) || couples.length > 32) mechanicsInvalid("forces", "mechanical force/couple lists are bounded to32"); vector(about, "referencePoint");
  forces.forEach(force => { vector(force.point, "force.point"); vector(force.force, "force"); if (force.weight) { const computed = mechanicsGravityForce(force.weight.mass, force.point, force.weight.gravity).force; if (force.force.x !== computed.x || force.force.y !== computed.y) mechanicsInvalid("weight", "load force must retain the supplied mass/gravity authority"); } }); couples.forEach(value => mechanicsFinite(value, "couple"));
  const forceSI = { x: mechanicsSum(forces.map(force => force.force.x)), y: mechanicsSum(forces.map(force => force.force.y)) }, torqueSI = mechanicsSum([...forces.map(force => mechanicsCross(sub(force.point, about), force.force)), ...couples]);
  const errors = { forceSI: { x: mechanicsErrorSum([...forces.map(force => force.forceErrorBoundSI?.x ?? 0), mechanicsErrorProduct(Math.abs(forceSI.x), MECHANICS_RELATIVE_ERROR)]), y: mechanicsErrorSum([...forces.map(force => force.forceErrorBoundSI?.y ?? 0), mechanicsErrorProduct(Math.abs(forceSI.y), MECHANICS_RELATIVE_ERROR)]) }, torqueSI: mechanicsErrorSum([...forces.map(force => { const arm = sub(force.point, about); return mechanicsErrorSum([mechanicsErrorProduct(Math.abs(arm.x), force.forceErrorBoundSI?.y ?? 0), mechanicsErrorProduct(Math.abs(arm.y), force.forceErrorBoundSI?.x ?? 0)]); }), mechanicsErrorProduct(Math.abs(torqueSI), MECHANICS_RELATIVE_ERROR)]) };
  return { forceSI, torqueSI, referencePointSI: { ...about }, errorBoundsSI: errors };
}
export function mechanicsGravityForce(massSI: number, centerSI: MechanicsVector2, gravitySI: MechanicsVector2): MechanicsAppliedForce { positive(massSI, "weight.mass"); vector(centerSI, "weight.point"); vector(gravitySI, "gravity"); return { point: { ...centerSI }, force: scaled(gravitySI, massSI) }; }
export function mechanicsTorqueAbout(wrench: MechanicsWrench, point: MechanicsVector2): number { vector(point, "referencePoint"); return mechanicsSum([wrench.torqueSI, mechanicsCross(sub(wrench.referencePointSI, point), wrench.forceSI)]); }
export function validateMechanicsInternalPairs(pairs: readonly (readonly [MechanicsAppliedForce, MechanicsAppliedForce])[]): void {
  if (!Array.isArray(pairs) || pairs.length > 16) mechanicsInvalid("internalPairs", "internal-force pairs are bounded to16");
  pairs.forEach(pair => {
    if (!Array.isArray(pair) || pair.length !== 2) mechanicsInvalid("internalPairs", "internal forces require explicit opposite pairs"); const [a, b] = pair;
    const wrench = mechanicsWrench([a!, b!], [], { x: 0, y: 0 });
    if (wrench.forceSI.x !== 0 || wrench.forceSI.y !== 0 || wrench.torqueSI !== 0) mechanicsInvalid("internalPairs", "internal pairs must cancel force and torque; an internal couple cannot be discarded");
  });
}
export function solveMechanicsEquilibrium(forces: readonly MechanicsAppliedForce[], couples: readonly number[], supports: readonly MechanicsSupport[], about: MechanicsVector2, mode: "dynamics" | "feasibility" = "dynamics"): MechanicsReaction[] {
  if (!["dynamics", "feasibility"].includes(mode)) mechanicsInvalid("mode", "equilibrium mode must declare actual dynamics or formal feasibility");
  if (!Array.isArray(supports) || supports.length < 1 || supports.length > 3 || new Set(supports.map(support => support.id)).size !== supports.length) mechanicsInvalid("supports", "equilibrium requires one to three uniquely named supports");
  const columns: { support: MechanicsSupport; direction: MechanicsVector2 }[] = [];
  supports.forEach(support => {
    if (!support.id || !["pin", "contact", "cable"].includes(support.kind)) mechanicsInvalid("supports", "supports require a known mechanical type and id"); vector(support.point, "support.point");
    if (support.kind === "pin") { if (support.direction !== undefined) mechanicsInvalid("supports", "pin reactions have two independent signed components"); columns.push({ support, direction: { x: 1, y: 0 } }, { support, direction: { x: 0, y: 1 } }); }
    else { if (!support.direction) mechanicsInvalid("supports", "cables and nonadhesive contacts require an oriented force direction"); vector(support.direction, "support.direction"); const norm = mechanicsNorm(support.direction); if (!mechanicsNear(norm, 1)) mechanicsInvalid("supports", "support force direction must be a unit vector"); columns.push({ support, direction: support.direction }); }
  });
  if (columns.length < 1 || columns.length > 3) mechanicsInvalid("supports", "this planar equilibrium solver supports one to three independent reaction unknowns");
  const n = columns.length, wrench = mechanicsWrench(forces, couples, about); const rhs = [-wrench.forceSI.x, -wrench.forceSI.y, -wrench.torqueSI], rhsErrors = [wrench.errorBoundsSI?.forceSI.x ?? 0, wrench.errorBoundsSI?.forceSI.y ?? 0, wrench.errorBoundsSI?.torqueSI ?? 0];
  const matrix = [columns.map(column => column.direction.x), columns.map(column => column.direction.y), columns.map(column => mechanicsCross(sub(column.support.point, about), column.direction))].map((row, index) => {
    const scale = Math.max(...row.map(Math.abs)) || 1; return [...row.map(value => value / scale), mechanicsQuotient(rhs[index]!, scale), ...[0, 1, 2].map(other => other === index ? 1 / scale : 0)];
  });
  for (let column = 0; column < n; column++) {
    let pivot = column; for (let row = column + 1; row < 3; row++) if (Math.abs(matrix[row]![column]!) > Math.abs(matrix[pivot]![column]!)) pivot = row;
    if (Math.abs(matrix[pivot]![column]!) <= 1e-12) mechanicsInvalid("supports", "support system is singular or too ill-conditioned to certify");
    [matrix[column], matrix[pivot]] = [matrix[pivot]!, matrix[column]!]; const divisor = matrix[column]![column]!; matrix[column] = matrix[column]!.map(value => mechanicsQuotient(value, divisor));
    for (let row = 0; row < 3; row++) if (row !== column) { const factor = matrix[row]![column]!; matrix[row] = matrix[row]!.map((value, index) => mechanicsSum([value, -mechanicsProduct(factor, matrix[column]![index]!)])); }
  }
  const solved = matrix.slice(0, n).map(row => row[n]!), solvedErrors = matrix.slice(0, n).map(row => mechanicsErrorSum(rhsErrors.map((error, index) => mechanicsErrorProduct(error, Math.abs(row[n + 1 + index]!)))));
  if (mode === "dynamics" && columns.some((column, index) => column.support.kind !== "pin" && solved[index]! < 0)) mechanicsInvalid("supports", "a nonadhesive contact cannot pull and a cable cannot push");
  const reactions = supports.map(support => { const indices = columns.flatMap((column, index) => column.support === support ? [index] : []); const values = indices.map(index => scaled(columns[index]!.direction, solved[index]!)); const componentsSI = { x: mechanicsSum(values.map(value => value.x)), y: mechanicsSum(values.map(value => value.y)) }, errorBoundsSI = { x: mechanicsErrorSum(indices.map(index => mechanicsErrorProduct(Math.abs(columns[index]!.direction.x), solvedErrors[index]!))), y: mechanicsErrorSum(indices.map(index => mechanicsErrorProduct(Math.abs(columns[index]!.direction.y), solvedErrors[index]!))) }; return { id: support.id, pointSI: { ...support.point }, componentsSI, magnitudeSI: mechanicsNorm(componentsSI), kind: support.kind, errorBoundsSI, ...(support.kind === "pin" ? {} : { signedMagnitudeSI: solved[indices[0]!]!, signedErrorBoundSI: solvedErrors[indices[0]!]! }) }; });
  const residual = mechanicsWrench([...forces, ...reactions.map(reaction => ({ point: reaction.pointSI, force: reaction.componentsSI }))], couples, about);
  const forceScale = mechanicsSum([...forces.map(force => mechanicsNorm(force.force)), ...reactions.map(reaction => reaction.magnitudeSI)]); const torqueScale = mechanicsSum([...forces.map(force => Math.abs(mechanicsCross(sub(force.point, about), force.force))), ...reactions.map(reaction => Math.abs(mechanicsCross(sub(reaction.pointSI, about), reaction.componentsSI))), ...couples.map(Math.abs)]);
  if (!mechanicsNear(residual.forceSI.x, 0, forceScale) || !mechanicsNear(residual.forceSI.y, 0, forceScale) || !mechanicsNear(residual.torqueSI, 0, torqueScale)) mechanicsInvalid("equilibrium", "solved reactions do not certify both force and torque balance"); return reactions;
}
export type MechanicsCollisionConstraint = { readonly kind: "free" } | { readonly kind: "pivoted"; readonly point: MechanicsVector2 };
export interface MechanicsCollisionState { readonly motion: MechanicsMotionState; readonly constraint: MechanicsCollisionConstraint; readonly initialEnergySI: number; readonly dissipatedEnergySI: number; readonly conservedAngularMomentumSI: number; readonly conservedAboutSI: MechanicsVector2; readonly pivotImpulseSI: MechanicsVector2 | null; readonly errorBoundsSI: { readonly dissipatedEnergySI: number; readonly initialEnergySI: number; readonly conservedAngularMomentumSI: number; readonly pivotImpulseSI: MechanicsVector2 | null } }
export function deriveMechanicsStickingCollision(bodies: readonly MechanicsMotionSourceSI[], constraint: MechanicsCollisionConstraint, referencePoint: MechanicsVector2): MechanicsCollisionState {
  if (!Array.isArray(bodies) || bodies.length < 2 || bodies.length > 16 || bodies.some(body => body.derivation !== undefined)) mechanicsInvalid("collision", "sticking collision requires two to sixteen explicit pre-impact bodies");
  const states = bodies.map(body => deriveMechanicsMotion(body)); const mass = mechanicsSum(states.map(state => state.massSI));
  const position = { x: mechanicsQuotient(mechanicsSum(states.map(state => mechanicsProduct(state.massSI, state.positionSI.x))), mass), y: mechanicsQuotient(mechanicsSum(states.map(state => mechanicsProduct(state.massSI, state.positionSI.y))), mass) };
  const inertia = mechanicsSum(states.map(state => mechanicsSum([state.inertiaSI, mechanicsProduct(state.massSI, mechanicsDot(sub(state.positionSI, position), sub(state.positionSI, position)))]))); positive(inertia, "collision.inertia");
  const about = constraint.kind === "free" ? position : constraint.kind === "pivoted" ? constraint.point : mechanicsInvalid("constraint", "sticking collision requires free motion or an explicit fixed pivot"); vector(about, "collision.referencePoint");
  const momentum = { x: mechanicsSum(states.map(state => state.momentumSI.x)), y: mechanicsSum(states.map(state => state.momentumSI.y)) };
  const angularMomentum = mechanicsSum(states.map(state => mechanicsSum([mechanicsCross(sub(state.positionSI, about), state.momentumSI), mechanicsProduct(state.inertiaSI, state.angularVelocitySI)])));
  const axisInertia = constraint.kind === "free" ? inertia : mechanicsSum([inertia, mechanicsProduct(mass, mechanicsDot(sub(position, about), sub(position, about)))]);
  const angularVelocity = mechanicsQuotient(angularMomentum, axisInertia); const velocity = constraint.kind === "free" ? scaled(momentum, mechanicsQuotient(1, mass)) : scaled(turn(sub(position, about)), angularVelocity);
  const inertiaError = mechanicsErrorSum(states.map(state => state.errorBoundsSI.inertiaSI)); if (inertiaError >= axisInertia) mechanicsInvalid("uncertainty", "sticking impact requires a certified positive inertia about its conservation axis");
  const angularError = mechanicsErrorSum(states.map(state => { const arm = sub(state.positionSI, about), error = state.errorBoundsSI; return mechanicsErrorSum([mechanicsErrorProduct(Math.abs(state.angularVelocitySI), error.inertiaSI), mechanicsErrorProduct(state.inertiaSI + error.inertiaSI, error.angularVelocitySI), mechanicsErrorProduct(state.massSI, Math.abs(arm.x) * error.velocitySI.y + Math.abs(arm.y) * error.velocitySI.x + error.positionSI.x * (Math.abs(state.velocitySI.y) + error.velocitySI.y) + error.positionSI.y * (Math.abs(state.velocitySI.x) + error.velocitySI.x))]); }));
  const omegaError = mechanicsErrorSum([(angularError + Math.abs(angularVelocity) * inertiaError) / (axisInertia - inertiaError), mechanicsErrorProduct(Math.abs(angularVelocity), MECHANICS_RELATIVE_ERROR)]);
  const velocityError = constraint.kind === "free" ? { x: mechanicsErrorSum(states.map(state => mechanicsErrorProduct(state.massSI / mass, state.errorBoundsSI.velocitySI.x))), y: mechanicsErrorSum(states.map(state => mechanicsErrorProduct(state.massSI / mass, state.errorBoundsSI.velocitySI.y))) } : { x: mechanicsErrorProduct(Math.abs(position.y - about.y), omegaError), y: mechanicsErrorProduct(Math.abs(position.x - about.x), omegaError) };
  const motion = deriveMechanicsMotion({ mass, inertia, inertiaErrorBoundSI: inertiaError, position, velocity, velocityErrorBoundSI: velocityError, angularVelocity, angularVelocityErrorBoundSI: omegaError, referencePoint }); const initialEnergySI = mechanicsSum(states.map(state => state.kineticEnergySI));
  const dissipatedEnergySI = mechanicsSum(states.map(state => { const attachedVelocity = plus(velocity, scaled(turn(sub(state.positionSI, position)), angularVelocity)); const difference = sub(state.velocitySI, attachedVelocity); const spin = mechanicsSum([state.angularVelocitySI, -angularVelocity]); return mechanicsSum([mechanicsProduct(0.5 * state.massSI, mechanicsDot(difference, difference)), mechanicsProduct(0.5 * state.inertiaSI, mechanicsProduct(spin, spin))]); }));
  const initialEnergyError = mechanicsErrorSum(states.map(state => state.errorBoundsSI.kineticEnergySI)); const dissipatedError = mechanicsErrorSum([initialEnergyError, motion.errorBoundsSI.kineticEnergySI, mechanicsErrorProduct(dissipatedEnergySI, MECHANICS_RELATIVE_ERROR)]);
  if (Math.abs(mechanicsSum([initialEnergySI, -motion.kineticEnergySI, -dissipatedEnergySI])) > dissipatedError) mechanicsInvalid("collision", "sticking loss must agree with both the positive residual energy and kinetic-energy balance");
  const pivotImpulseSI = constraint.kind === "pivoted" ? sub(motion.momentumSI, momentum) : null; const pivotImpulseError = pivotImpulseSI ? { x: mechanicsErrorSum([mechanicsErrorProduct(mass, velocityError.x), ...states.map(state => mechanicsErrorProduct(state.massSI, state.errorBoundsSI.velocitySI.x)), mechanicsErrorProduct(Math.abs(pivotImpulseSI.x), MECHANICS_RELATIVE_ERROR)]), y: mechanicsErrorSum([mechanicsErrorProduct(mass, velocityError.y), ...states.map(state => mechanicsErrorProduct(state.massSI, state.errorBoundsSI.velocitySI.y)), mechanicsErrorProduct(Math.abs(pivotImpulseSI.y), MECHANICS_RELATIVE_ERROR)]) } : null;
  return { motion, constraint, initialEnergySI, dissipatedEnergySI, conservedAngularMomentumSI: angularMomentum, conservedAboutSI: { ...about }, pivotImpulseSI, errorBoundsSI: { initialEnergySI: initialEnergyError, dissipatedEnergySI: dissipatedError, conservedAngularMomentumSI: angularError, pivotImpulseSI: pivotImpulseError } };
}

export interface MechanicsRollingSourceSI {
  readonly motion: MechanicsMotionSourceSI; readonly radius: number;
  readonly surface: { readonly point: MechanicsVector2; readonly tangent: MechanicsVector2; readonly velocity: MechanicsVector2; readonly acceleration?: MechanicsVector2; readonly velocityErrorBoundSI?: MechanicsVector2; readonly accelerationErrorBoundSI?: MechanicsVector2 };
  readonly regime: "no_slip" | "sliding"; readonly mode?: "dynamics" | "feasibility"; readonly frictionCoefficient: number; readonly externalForce: MechanicsVector2; readonly gravity?: MechanicsVector2; readonly externalTorque: number; readonly time: number | "transition";
  readonly externalForceErrorBoundSI?: MechanicsVector2; readonly gravityErrorBoundSI?: MechanicsVector2;
}
export interface MechanicsRollingState {
  readonly motion: MechanicsMotionState; readonly contactPointSI: MechanicsVector2; readonly contactVelocitySI: MechanicsVector2; readonly slipSI: number;
  readonly normalSI: MechanicsVector2; readonly tangentSI: MechanicsVector2; readonly normalForceSI: number; readonly frictionCapacitySI: number; readonly frictionSI: number | null;
  readonly normalVectorSI: MechanicsVector2; readonly frictionVectorSI: MechanicsVector2 | null; readonly regime: "no_slip" | "sliding" | "transition" | "feasibility";
  readonly requiredFrictionSI: number; readonly minimumStaticCoefficientSI: number | null; readonly admissible: boolean | null;
  readonly errorBoundsSI: { readonly requiredFrictionSI: number; readonly minimumStaticCoefficientSI: number; readonly frictionSI: number; readonly normalForceSI?: number; readonly frictionCapacitySI?: number; readonly transitionTimeSI: number; readonly slipSI: number; readonly contactVelocitySI?: MechanicsVector2; readonly dissipatedEnergySI?: number };
  readonly transitionTimeSI: number | null; readonly transitionMotion: MechanicsMotionState | null; readonly dissipatedEnergySI: number;
}
export function deriveMechanicsRolling(source: MechanicsRollingSourceSI): MechanicsRollingState {
  const initial = deriveMechanicsMotion(source.motion); positive(source.radius, "radius"); positive(initial.inertiaSI, "inertia"); positive(source.frictionCoefficient, "frictionCoefficient", true); if (source.time !== "transition") positive(source.time, "time", true);
  if (!["no_slip", "sliding"].includes(source.regime)) mechanicsInvalid("regime", "contact requires an explicit no-slip or sliding regime");
  vector(source.externalForce, "externalForce"); mechanicsFinite(source.externalTorque, "externalTorque"); vector(source.surface.point, "surface.point"); vector(source.surface.velocity, "surface.velocity"); vector(source.surface.tangent, "surface.tangent");
  const externalForce = source.gravity ? plus(source.externalForce, mechanicsGravityForce(initial.massSI, initial.positionSI, source.gravity).force) : source.externalForce;
  const externalForceError = { x: mechanicsErrorSum([source.externalForceErrorBoundSI?.x ?? 0, mechanicsErrorProduct(initial.massSI, source.gravityErrorBoundSI?.x ?? 0)]), y: mechanicsErrorSum([source.externalForceErrorBoundSI?.y ?? 0, mechanicsErrorProduct(initial.massSI, source.gravityErrorBoundSI?.y ?? 0)]) };
  const tangentNorm = mechanicsNorm(source.surface.tangent); if (!mechanicsNear(tangentNorm, 1)) mechanicsInvalid("surface", "surface tangent must be a unit vector in the inertial frame");
  const tangent = scaled(source.surface.tangent, 1 / tangentNorm); const normal = turn(tangent); const surfaceAcceleration = source.surface.acceleration ?? { x: 0, y: 0 }; vector(surfaceAcceleration, "surface.acceleration");
  const distance = mechanicsDot(sub(initial.positionSI, source.surface.point), normal);
  if (!mechanicsNear(distance, source.radius)) mechanicsInvalid("contact", "body COM must lie one source radius above its declared surface");
  if (!mechanicsNear(mechanicsDot(sub(initial.velocitySI, source.surface.velocity), normal), 0, mechanicsNorm(initial.velocitySI) + mechanicsNorm(source.surface.velocity))) mechanicsInvalid("contact", "maintained rigid contact requires zero relative normal velocity");
  const offset = scaled(normal, -source.radius); const initialContact = mechanicsPointState(initial, offset).velocity;
  const initialSlip = mechanicsDot(sub(initialContact, source.surface.velocity), tangent);
  const initialSlipError = mechanicsErrorSum([mechanicsErrorProduct(Math.abs(tangent.x), initial.errorBoundsSI.velocitySI.x + (source.surface.velocityErrorBoundSI?.x ?? 0)), mechanicsErrorProduct(Math.abs(tangent.y), initial.errorBoundsSI.velocitySI.y + (source.surface.velocityErrorBoundSI?.y ?? 0)), mechanicsErrorProduct(source.radius, initial.errorBoundsSI.angularVelocitySI), mechanicsErrorProduct(Math.abs(initialSlip), MECHANICS_RELATIVE_ERROR)]);
  const forceT = mechanicsDot(externalForce, tangent); const forceN = mechanicsDot(externalForce, normal);
  const surfaceAT = mechanicsDot(surfaceAcceleration, tangent); const surfaceAN = mechanicsDot(surfaceAcceleration, normal);
  const projectionRounding = (value: MechanicsVector2, direction: MechanicsVector2): number => mechanicsErrorSum([
    mechanicsProductRoundingError(value.x, direction.x), mechanicsProductRoundingError(value.y, direction.y),
    mechanicsSumRoundingError([mechanicsProduct(value.x, direction.x), mechanicsProduct(value.y, direction.y)]),
  ]);
  const forceTError = mechanicsErrorSum([mechanicsErrorProduct(Math.abs(tangent.x), externalForceError.x), mechanicsErrorProduct(Math.abs(tangent.y), externalForceError.y), projectionRounding(externalForce, tangent)]), forceNError = mechanicsErrorSum([mechanicsErrorProduct(Math.abs(normal.x), externalForceError.x), mechanicsErrorProduct(Math.abs(normal.y), externalForceError.y), projectionRounding(externalForce, normal)]);
  const surfaceATError = mechanicsErrorSum([mechanicsErrorProduct(Math.abs(tangent.x), source.surface.accelerationErrorBoundSI?.x ?? 0), mechanicsErrorProduct(Math.abs(tangent.y), source.surface.accelerationErrorBoundSI?.y ?? 0), projectionRounding(surfaceAcceleration, tangent)]), surfaceANError = mechanicsErrorSum([mechanicsErrorProduct(Math.abs(normal.x), source.surface.accelerationErrorBoundSI?.x ?? 0), mechanicsErrorProduct(Math.abs(normal.y), source.surface.accelerationErrorBoundSI?.y ?? 0), projectionRounding(surfaceAcceleration, normal)]);
  const normalForce = mechanicsSum([mechanicsProduct(initial.massSI, surfaceAN), -forceN]); if (normalForce < 0) mechanicsInvalid("contact", "nonadhesive rolling contact cannot supply tensile normal force");
  const normalError = mechanicsErrorSum([mechanicsErrorProduct(initial.massSI, surfaceANError), forceNError,
    mechanicsProductRoundingError(initial.massSI, surfaceAN), mechanicsSumRoundingError([mechanicsProduct(initial.massSI, surfaceAN), -forceN])]); if (normalError > 0 && normalForce <= normalError) mechanicsInvalid("uncertainty", "contact normal force sign is unresolved within the source projection uncertainty");
  const inverseMass = mechanicsQuotient(1, initial.massSI); const inverseInertia = mechanicsQuotient(1, initial.inertiaSI);
  const denominator = mechanicsSum([inverseMass, mechanicsProduct(mechanicsProduct(source.radius, source.radius), inverseInertia)]);
  const requiredFriction = mechanicsQuotient(mechanicsSum([surfaceAT, -mechanicsProduct(forceT, inverseMass), -mechanicsProduct(mechanicsProduct(source.radius, source.externalTorque), inverseInertia)]), denominator);
  const capacity = mechanicsProduct(source.frictionCoefficient, normalForce);
  const inertiaError = source.motion.inertiaErrorBoundSI ?? 0;
  const frictionAt = (inertia: number): number => mechanicsQuotient(mechanicsSum([mechanicsProduct(inertia, mechanicsSum([surfaceAT, -forceT * inverseMass])), -source.radius * source.externalTorque]), mechanicsSum([inertia * inverseMass, source.radius ** 2]));
  const frictionError = mechanicsErrorSum([inertiaError === 0 ? 0 : Math.max(Math.abs(frictionAt(initial.inertiaSI - inertiaError) - requiredFriction), Math.abs(frictionAt(initial.inertiaSI + inertiaError) - requiredFriction)), (initial.inertiaSI + inertiaError) * (surfaceATError + forceTError * inverseMass) / ((initial.inertiaSI - inertiaError) * inverseMass + source.radius ** 2), mechanicsErrorProduct(Math.abs(requiredFriction), MECHANICS_RELATIVE_ERROR)]);
  const minimumStaticCoefficientSI = normalForce === 0 ? requiredFriction === 0 ? 0 : null : Math.abs(requiredFriction) / normalForce;
  const coefficientError = normalForce === 0 ? 0 : mechanicsErrorSum([(frictionError + (minimumStaticCoefficientSI ?? 0) * normalError) / (normalForce - normalError), mechanicsErrorProduct(minimumStaticCoefficientSI ?? 0, MECHANICS_RELATIVE_ERROR)]);
  let initiallyNoSlip = false; try { mechanicsCircularKinematics(initial, { radius: source.radius, regime: "no_slip", surface: { point: source.surface.point, tangent, velocity: source.surface.velocity, ...(source.surface.velocityErrorBoundSI ? { velocityErrorBoundSI: source.surface.velocityErrorBoundSI } : {}) } }); initiallyNoSlip = true; } catch (error) { if (!(error instanceof MechanicsInputError) || error.key !== "regime") throw error; }
  const capacityError = mechanicsErrorProduct(source.frictionCoefficient, normalError), inheritedSlipError = mechanicsErrorSum([initial.errorBoundsSI.velocitySI.x, initial.errorBoundsSI.velocitySI.y, source.radius * initial.errorBoundsSI.angularVelocitySI, source.surface.velocityErrorBoundSI?.x ?? 0, source.surface.velocityErrorBoundSI?.y ?? 0]);
  const admissible = !initiallyNoSlip ? false : inheritedSlipError > 0 ? null : inertiaError === 0 && forceTError === 0 && normalError === 0 && surfaceATError === 0 ? Math.abs(requiredFriction) <= capacity || mechanicsNear(Math.abs(requiredFriction), capacity) : Math.abs(requiredFriction) + frictionError <= Math.max(0, capacity - capacityError) ? true : Math.max(0, Math.abs(requiredFriction) - frictionError) > capacity + capacityError ? false : null;
  if (source.mode === "feasibility") {
    if (source.regime !== "no_slip" || source.time !== 0 || source.motion.acceleration !== undefined || source.motion.angularAcceleration !== undefined || source.motion.derivation !== undefined) mechanicsInvalid("mode", "no-slip feasibility uses a source velocity state and makes no actual acceleration/force claim");
    return { motion: initial, contactPointSI: plus(initial.positionSI, offset), contactVelocitySI: initialContact, slipSI: initialSlip, normalSI: normal, tangentSI: tangent, normalForceSI: normalForce, frictionCapacitySI: capacity, frictionSI: null, normalVectorSI: scaled(normal, normalForce), frictionVectorSI: null, regime: "feasibility", requiredFrictionSI: requiredFriction, minimumStaticCoefficientSI, admissible, errorBoundsSI: { requiredFrictionSI: frictionError, minimumStaticCoefficientSI: coefficientError, frictionSI: 0, normalForceSI: normalError, frictionCapacitySI: mechanicsErrorSum([mechanicsErrorProduct(source.frictionCoefficient, normalError), mechanicsProductRoundingError(source.frictionCoefficient, normalForce)]), transitionTimeSI: 0, slipSI: initialSlipError }, transitionTimeSI: null, transitionMotion: null, dissipatedEnergySI: 0 };
  }
  if (source.mode !== undefined && source.mode !== "dynamics") mechanicsInvalid("mode", "unsupported contact mode");
  let friction: number; let transitionTimeSI: number | null = null;
  if (source.regime === "no_slip") {
    if (!initiallyNoSlip) mechanicsInvalid("regime", "no-slip state contradicts signed body/surface contact velocity");
    if (admissible !== true) mechanicsInvalid("frictionCoefficient", "required static friction is not proved within the stated contact capacity"); friction = requiredFriction;
  } else {
    if (Math.abs(initialSlip) <= initialSlipError) mechanicsInvalid("regime", "kinetic friction requires certified nonzero signed contact slip"); friction = -Math.sign(initialSlip) * capacity;
  }
  const acceleration = plus(scaled(plus(externalForce, plus(scaled(normal, normalForce), scaled(tangent, friction))), inverseMass), { x: 0, y: 0 });
  const angularAcceleration = mechanicsProduct(mechanicsSum([source.externalTorque, mechanicsProduct(source.radius, friction)]), inverseInertia);
  const appliedFrictionError = source.regime === "no_slip" ? frictionError : capacityError;
  const accelerationError = { x: mechanicsErrorSum([externalForceError.x * inverseMass, mechanicsErrorProduct(Math.abs(normal.x) * inverseMass, normalError), mechanicsErrorProduct(Math.abs(tangent.x) * inverseMass, appliedFrictionError)]), y: mechanicsErrorSum([externalForceError.y * inverseMass, mechanicsErrorProduct(Math.abs(normal.y) * inverseMass, normalError), mechanicsErrorProduct(Math.abs(tangent.y) * inverseMass, appliedFrictionError)]) };
  const alphaError = mechanicsErrorSum([mechanicsErrorProduct(source.radius, appliedFrictionError) / (initial.inertiaSI - inertiaError), mechanicsErrorProduct(Math.abs(angularAcceleration), inertiaError / (initial.inertiaSI - inertiaError)), mechanicsErrorProduct(Math.abs(angularAcceleration), MECHANICS_RELATIVE_ERROR)]);
  if (initial.accelerationSI && (!mechanicsNear(initial.accelerationSI.x, acceleration.x) || !mechanicsNear(initial.accelerationSI.y, acceleration.y)) || initial.angularAccelerationSI !== null && !mechanicsNear(initial.angularAccelerationSI, angularAcceleration)) mechanicsInvalid("motion", "source acceleration contradicts the derived contact forces and torque");
  const slipDerivative = mechanicsSum([mechanicsDot(acceleration, tangent), mechanicsProduct(source.radius, angularAcceleration), -surfaceAT]);
  const slipDerivativeError = mechanicsErrorSum([mechanicsErrorProduct(Math.abs(tangent.x), accelerationError.x), mechanicsErrorProduct(Math.abs(tangent.y), accelerationError.y), mechanicsErrorProduct(source.radius, alphaError), surfaceATError, mechanicsErrorProduct(Math.abs(slipDerivative), MECHANICS_RELATIVE_ERROR)]);
  if (source.regime === "sliding" && Math.sign(initialSlip) * slipDerivative < 0 && Math.abs(slipDerivative) > slipDerivativeError) transitionTimeSI = mechanicsQuotient(-initialSlip, slipDerivative);
  const transitionError = transitionTimeSI === null ? 0 : mechanicsErrorSum([(initialSlipError + transitionTimeSI * slipDerivativeError) / (Math.abs(slipDerivative) - slipDerivativeError), mechanicsErrorProduct(transitionTimeSI, MECHANICS_RELATIVE_ERROR)]);
  const terminalEvent = source.time === "transition"; if (terminalEvent && transitionTimeSI === null) mechanicsInvalid("time", "this sliding state has no certified finite zero-slip event"); const time = terminalEvent ? transitionTimeSI! : source.time as number;
  if (!terminalEvent && transitionTimeSI !== null && time > transitionTimeSI - transitionError && (inertiaError > 0 || initial.errorBoundsSI.angularVelocitySI > 0 || initial.errorBoundsSI.velocitySI.x > 0 || initial.errorBoundsSI.velocitySI.y > 0 || forceTError > 0 || normalError > 0 || surfaceATError > 0 || (source.surface.velocityErrorBoundSI?.x ?? 0) > 0 || (source.surface.velocityErrorBoundSI?.y ?? 0) > 0)) mechanicsInvalid("time", "fixed-time state intersects an uncertain contact transition; select the verified transition event");
  if (transitionTimeSI !== null && time > transitionTimeSI && !mechanicsNear(time, transitionTimeSI)) mechanicsInvalid("time", "sliding solution ends at first zero slip; a later state requires a new static-contact regime");
  const terminal = source.regime === "sliding" && transitionTimeSI !== null && (terminalEvent || mechanicsNear(time, transitionTimeSI));
  const advance = (time: number, terminalState: boolean, timeError = 0): MechanicsMotionState => {
    const position = plus(initial.positionSI, plus(scaled(initial.velocitySI, time), scaled(acceleration, mechanicsProduct(0.5, mechanicsProduct(time, time)))));
    const velocity = plus(initial.velocitySI, scaled(acceleration, time)); const angularVelocity = mechanicsSum([initial.angularVelocitySI, mechanicsProduct(angularAcceleration, time)]);
    const knownTerminalAcceleration = terminalState && requiredFriction === 0 && frictionError === 0;
    const velocityError = { x: mechanicsErrorSum([initial.errorBoundsSI.velocitySI.x, mechanicsErrorProduct(time, accelerationError.x), mechanicsErrorProduct(Math.abs(acceleration.x) + accelerationError.x, timeError)]), y: mechanicsErrorSum([initial.errorBoundsSI.velocitySI.y, mechanicsErrorProduct(time, accelerationError.y), mechanicsErrorProduct(Math.abs(acceleration.y) + accelerationError.y, timeError)]) };
    const positionError = { x: mechanicsErrorSum([initial.errorBoundsSI.positionSI.x, mechanicsErrorProduct(time, initial.errorBoundsSI.velocitySI.x), mechanicsErrorProduct(0.5 * time ** 2, accelerationError.x), mechanicsErrorProduct(Math.abs(initial.velocitySI.x) + initial.errorBoundsSI.velocitySI.x + time * (Math.abs(acceleration.x) + accelerationError.x), timeError), mechanicsErrorProduct(0.5 * (Math.abs(acceleration.x) + accelerationError.x), timeError ** 2)]), y: mechanicsErrorSum([initial.errorBoundsSI.positionSI.y, mechanicsErrorProduct(time, initial.errorBoundsSI.velocitySI.y), mechanicsErrorProduct(0.5 * time ** 2, accelerationError.y), mechanicsErrorProduct(Math.abs(initial.velocitySI.y) + initial.errorBoundsSI.velocitySI.y + time * (Math.abs(acceleration.y) + accelerationError.y), timeError), mechanicsErrorProduct(0.5 * (Math.abs(acceleration.y) + accelerationError.y), timeError ** 2)]) };
    const omegaError = mechanicsErrorSum([initial.errorBoundsSI.angularVelocitySI, mechanicsErrorProduct(time, alphaError), mechanicsErrorProduct(Math.abs(angularAcceleration) + alphaError, timeError)]);
    const result = deriveMechanicsMotion({ mass: initial.massSI, inertia: initial.inertiaSI, inertiaErrorBoundSI: inertiaError, position, positionErrorBoundSI: positionError, velocity, velocityErrorBoundSI: velocityError, angularVelocity, angularVelocityErrorBoundSI: omegaError, referencePoint: initial.referencePointSI, ...(!terminalState ? { acceleration, angularAcceleration, accelerationErrorBoundSI: accelerationError, angularAccelerationErrorBoundSI: alphaError } : knownTerminalAcceleration ? { acceleration: scaled(plus(externalForce, scaled(normal, normalForce)), inverseMass), angularAcceleration: mechanicsProduct(source.externalTorque, inverseInertia), accelerationErrorBoundSI: source.surface.accelerationErrorBoundSI ?? { x: 0, y: 0 } } : {}) });
    const currentFriction = knownTerminalAcceleration ? 0 : friction;
    if (terminalState && !knownTerminalAcceleration) return result;
    const forceSI = plus(externalForce, plus(scaled(normal, normalForce), scaled(tangent, currentFriction)));
    const contactTorqueSI = mechanicsProduct(source.radius, currentFriction), torqueSI = mechanicsSum([source.externalTorque, contactTorqueSI]);
    const currentFrictionError = knownTerminalAcceleration ? 0 : source.regime === "no_slip" ? frictionError : mechanicsErrorSum([capacityError, mechanicsErrorProduct(Math.abs(currentFriction), MECHANICS_RELATIVE_ERROR)]);
    return { ...result, wrenchSI: { forceSI, torqueSI, referencePointSI: position, errorBoundsSI: {
      forceSI: {
        x: mechanicsErrorSum([mechanicsErrorProduct(initial.massSI, result.errorBoundsSI.accelerationSI!.x), mechanicsErrorProduct(Math.abs(forceSI.x), MECHANICS_RELATIVE_ERROR)]),
        y: mechanicsErrorSum([mechanicsErrorProduct(initial.massSI, result.errorBoundsSI.accelerationSI!.y), mechanicsErrorProduct(Math.abs(forceSI.y), MECHANICS_RELATIVE_ERROR)]),
      },
      torqueSI: mechanicsErrorSum([mechanicsErrorProduct(source.radius, currentFrictionError), mechanicsProductRoundingError(source.radius, currentFriction), mechanicsSumRoundingError([source.externalTorque, contactTorqueSI])]),
    } } };
  };
  const motion = advance(time, terminal, terminalEvent ? transitionError : 0); const contactPointSI = plus(motion.positionSI, offset);
  const surfaceVelocity = plus(source.surface.velocity, scaled(surfaceAcceleration, time)); const contactVelocitySI = terminal || source.regime === "no_slip" ? surfaceVelocity : mechanicsPointState(motion, offset).velocity; const slipSI = terminal || source.regime === "no_slip" ? 0 : mechanicsDot(sub(contactVelocitySI, surfaceVelocity), tangent);
  if (!terminal && source.regime === "sliding" && Math.sign(slipSI) !== Math.sign(initialSlip)) mechanicsInvalid("precision", "sliding sign changed before its certified transition");
  const transitionMotion = transitionTimeSI === null ? null : advance(transitionTimeSI, true, transitionError);
  const slipDistance = source.regime === "sliding" ? terminal ? mechanicsProduct(0.5 * Math.abs(initialSlip), time) : mechanicsSum([mechanicsProduct(Math.abs(initialSlip), time), mechanicsProduct(mechanicsProduct(0.5 * Math.sign(initialSlip), slipDerivative), mechanicsProduct(time, time))]) : 0;
  const dissipatedEnergySI = mechanicsProduct(Math.abs(friction), slipDistance); if (dissipatedEnergySI < 0) mechanicsInvalid("precision", "contact dissipation cannot be negative");
  const actualFriction = terminal ? requiredFriction === 0 && frictionError === 0 ? 0 : null : friction;
  return { motion, contactPointSI, contactVelocitySI, slipSI, normalSI: normal, tangentSI: tangent, normalForceSI: normalForce, frictionCapacitySI: capacity, frictionSI: actualFriction, normalVectorSI: scaled(normal, normalForce), frictionVectorSI: actualFriction === null ? null : scaled(tangent, actualFriction), regime: terminal ? "transition" : source.regime, requiredFrictionSI: requiredFriction, minimumStaticCoefficientSI, admissible, errorBoundsSI: { requiredFrictionSI: frictionError, minimumStaticCoefficientSI: coefficientError, frictionSI: actualFriction === 0 ? 0 : source.regime === "no_slip" ? frictionError : mechanicsErrorSum([capacityError, mechanicsErrorProduct(Math.abs(friction), MECHANICS_RELATIVE_ERROR)]), normalForceSI: normalError, frictionCapacitySI: mechanicsErrorSum([capacityError, mechanicsProductRoundingError(source.frictionCoefficient, normalForce)]), contactVelocitySI: { x: mechanicsErrorSum([source.surface.velocityErrorBoundSI?.x ?? 0, mechanicsErrorProduct(time, source.surface.accelerationErrorBoundSI?.x ?? 0), mechanicsErrorProduct(Math.abs(surfaceAcceleration.x), terminalEvent ? transitionError : 0)]), y: mechanicsErrorSum([source.surface.velocityErrorBoundSI?.y ?? 0, mechanicsErrorProduct(time, source.surface.accelerationErrorBoundSI?.y ?? 0), mechanicsErrorProduct(Math.abs(surfaceAcceleration.y), terminalEvent ? transitionError : 0)]) }, transitionTimeSI: transitionError, slipSI: terminal || source.regime === "no_slip" ? 0 : mechanicsErrorSum([initialSlipError, mechanicsErrorProduct(time, slipDerivativeError), mechanicsErrorProduct(Math.abs(slipSI), MECHANICS_RELATIVE_ERROR)]), dissipatedEnergySI: source.regime === "no_slip" ? 0 : mechanicsErrorSum([mechanicsErrorProduct(Math.abs(friction), time * initialSlipError + 0.5 * time ** 2 * slipDerivativeError + (Math.abs(initialSlip) + time * Math.abs(slipDerivative)) * (terminalEvent ? transitionError : 0)), mechanicsErrorProduct(dissipatedEnergySI, MECHANICS_RELATIVE_ERROR)]) }, transitionTimeSI, transitionMotion, dissipatedEnergySI };
}
export interface MechanicsImpulseSourceSI { readonly segments: readonly { readonly start: number; readonly end: number; readonly torque: number; readonly torqueErrorBoundSI?: number }[]; readonly axisId: string; readonly initialAngularMomentum?: number; readonly initialAngularMomentumErrorBoundSI?: number; readonly kind: "impulse" | "final_angular_momentum" }
export interface MechanicsImpulseState { readonly axisId: string; readonly impulseSI: number; readonly finalAngularMomentumSI: number | null; readonly valueSI: number; readonly errorBoundsSI: { readonly impulseSI: number; readonly finalAngularMomentumSI: number | null; readonly valueSI: number } }
export function deriveMechanicsImpulse(source: MechanicsImpulseSourceSI): MechanicsImpulseState {
  if (typeof source.axisId !== "string" || !source.axisId.trim() || source.axisId.length > 128) mechanicsInvalid("axisId", "angular impulse requires one explicit common reference axis id");
  if (!Array.isArray(source.segments) || source.segments.length < 1 || source.segments.length > 64) mechanicsInvalid("segments", "angular impulse requires one to64 finite ordered torque-time segments");
  source.segments.forEach((segment, index) => { mechanicsFinite(segment.start, "start"); mechanicsFinite(segment.end, "end"); mechanicsFinite(segment.torque, "torque"); if (!(segment.start < segment.end) || index > 0 && segment.start < source.segments[index - 1]!.end) mechanicsInvalid("segments", "torque-time intervals must be increasing and nonoverlapping"); });
  if (source.initialAngularMomentum !== undefined) mechanicsFinite(source.initialAngularMomentum, "initialAngularMomentum");
  if (!["impulse", "final_angular_momentum"].includes(source.kind) || source.kind === "final_angular_momentum" && source.initialAngularMomentum === undefined) mechanicsInvalid("kind", "final angular momentum requires an initial value about the same declared axis");
  const exactImpulse = source.segments.reduce((sum, segment) => add(sum, multiply(exact(segment.torque), add(exact(segment.end), exact(-segment.start)))), exact(0)); const impulseSI = numeric(exactImpulse, "impulse");
  const exactFinal = source.initialAngularMomentum === undefined ? null : add(exact(source.initialAngularMomentum), exactImpulse), finalAngularMomentumSI = exactFinal === null ? null : numeric(exactFinal, "angularMomentum");
  const inputError = mechanicsErrorSum(source.segments.map(segment => mechanicsErrorProduct(segment.torqueErrorBoundSI ?? 0, segment.end - segment.start))), impulseError = mechanicsErrorSum([inputError, dyadicRoundingError(exactImpulse)]);
  const finalError = exactFinal === null ? null : mechanicsErrorSum([source.initialAngularMomentumErrorBoundSI ?? 0, inputError, dyadicRoundingError(exactFinal)]);
  return { axisId: source.axisId, impulseSI, finalAngularMomentumSI, valueSI: source.kind === "impulse" ? impulseSI : finalAngularMomentumSI!, errorBoundsSI: { impulseSI: impulseError, finalAngularMomentumSI: finalError, valueSI: source.kind === "impulse" ? impulseError : finalError! } };
}

export interface MechanicsAxialSourceSI {
  readonly mode: "constant_inertia" | "redistribution" | "coaxial_locking" | "angle_law" | "inertia_law"; readonly axisId: string;
  readonly hypotheses: Readonly<Record<string, boolean>>;
  readonly inertia?: number; readonly angularVelocity?: number; readonly initialAngularMomentum?: number; readonly initialAtRest?: boolean; readonly rimRadius?: number; readonly torque?: number; readonly time?: number; readonly finalInertia?: number; readonly angularImpulse?: number;
  readonly inertiaErrorBoundSI?: number; readonly finalInertiaErrorBoundSI?: number; readonly angularImpulseErrorBoundSI?: number; readonly angularVelocityErrorBoundSI?: number; readonly initialAngularMomentumErrorBoundSI?: number; readonly torqueErrorBoundSI?: number;
  readonly rotors?: readonly { readonly inertia: number; readonly angularVelocity: number; readonly axisId: string; readonly inertiaErrorBoundSI?: number; readonly angularVelocityErrorBoundSI?: number }[];
  readonly angularLaw?: MechanicsAngularLawSI;
  readonly inertiaLaw?: { readonly expression: string; readonly initialAt: number; readonly at: number; readonly timeScale: number; readonly inertiaScale: number };
}
export interface MechanicsAxialState {
  readonly inertiaSI: number | null; readonly initialInertiaSI: number | null; readonly angularVelocitySI: number; readonly initialAngularVelocitySI: number | null;
  readonly angularAccelerationSI: number | null; readonly angleSI: number | null; readonly angleChangeSI: number | null;
  readonly angularMomentumSI: number | null; readonly initialAngularMomentumSI: number | null; readonly rotationEnergySI: number | null; readonly initialEnergySI: number | null;
  readonly impulseSI: number | null; readonly dissipatedEnergySI: number | null; readonly errorBoundsSI: Readonly<Record<string, number>>;
  readonly rimState?: { readonly speedSI: number; readonly tangentialAccelerationSI: number | null; readonly normalAccelerationSI: number; readonly totalAccelerationSI: number | null; readonly errorBoundsSI: Readonly<Record<string, number>> };
}
function axialRim(state: MechanicsAxialState, radius?: number): MechanicsAxialState { if (radius === undefined) return state; positive(radius, "rimRadius"); const w = state.angularVelocitySI, a = state.angularAccelerationSI, ew = state.errorBoundsSI.angularVelocitySI ?? 0, ea = state.errorBoundsSI.angularAccelerationSI ?? 0; const speedSI = mechanicsProduct(radius, Math.abs(w)), tangentialAccelerationSI = a === null ? null : mechanicsProduct(radius, a), normalAccelerationSI = mechanicsProduct(radius, mechanicsProduct(w, w)), totalAccelerationSI = tangentialAccelerationSI === null ? null : mechanicsNorm({ x: tangentialAccelerationSI, y: normalAccelerationSI }); const speedError = mechanicsErrorSum([mechanicsErrorProduct(radius, ew), mechanicsProductRoundingError(radius, Math.abs(w))]), normalError = mechanicsErrorSum([mechanicsErrorProduct(radius, 2 * Math.abs(w) * ew + ew ** 2), mechanicsErrorProduct(normalAccelerationSI, MECHANICS_RELATIVE_ERROR)]), tangentError = mechanicsErrorSum([mechanicsErrorProduct(radius, ea), tangentialAccelerationSI === null ? 0 : mechanicsProductRoundingError(radius, a!)]); return { ...state, rimState: { speedSI, tangentialAccelerationSI, normalAccelerationSI, totalAccelerationSI, errorBoundsSI: { speedSI: speedError, tangentialAccelerationSI: tangentError, normalAccelerationSI: normalError, totalAccelerationSI: mechanicsErrorSum([mechanicsNorm({ x: tangentError, y: normalError }), mechanicsErrorProduct(totalAccelerationSI ?? 0, MECHANICS_RELATIVE_ERROR)]) } } }; }
export function deriveMechanicsAxial(source: MechanicsAxialSourceSI): MechanicsAxialState {
  if (!source.axisId?.trim() || source.axisId.length > 128 || source.hypotheses.fixedAxis !== true) mechanicsInvalid("axisId", "axial state requires one explicitly fixed inertial axis");
  const empty: MechanicsAxialState = { inertiaSI: null, initialInertiaSI: null, angularVelocitySI: 0, initialAngularVelocitySI: null, angularAccelerationSI: null, angleSI: null, angleChangeSI: null, angularMomentumSI: null, initialAngularMomentumSI: null, rotationEnergySI: null, initialEnergySI: null, impulseSI: null, dissipatedEnergySI: null, errorBoundsSI: {} };
  if (source.mode === "angle_law") { if (!source.angularLaw) mechanicsInvalid("angularLaw", "angle-law mode requires the original source function and time"); const law = deriveMechanicsAngularLaw(source.angularLaw); return axialRim({ ...empty, ...law, errorBoundsSI: law.errorBoundsSI }, source.rimRadius); }
  const energy = (inertia: number, omega: number): number => numeric(multiply(multiply(exact(inertia), exact(0.5)), multiply(exact(omega), exact(omega))), "energy");
  let inertia: number, initialInertia: number, omega: number, initialOmega: number, momentum: number, initialMomentum: number, initialEnergy: number, impulse: number;
  let alpha: number | null = null, angleChange: number | null = null, loss: number | null = null; let inertiaError = 0, omegaError = 0, initialEnergyError = 0, momentumError = 0, lossError = 0, initialInertiaError = source.inertiaErrorBoundSI ?? 0, initialMomentumError = 0, impulseError = 0, alphaError = 0, initialOmegaError = source.angularVelocityErrorBoundSI ?? 0;
  const energyError = (i: number, ei: number, w: number, ew: number): number => mechanicsErrorSum([mechanicsErrorProduct(0.5 * w ** 2, ei), mechanicsErrorProduct(i + ei, Math.abs(w) * ew + 0.5 * ew ** 2)]);
  const initialState = (i: number, error: number): { omega: number; momentum: number } => { if ([source.angularVelocity !== undefined, source.initialAngularMomentum !== undefined, source.initialAtRest === true].filter(Boolean).length !== 1 || source.initialAtRest !== undefined && source.initialAtRest !== true) mechanicsInvalid("initialState", "axial initial state requires exactly one source omega, angular momentum or initial-rest premise"); if (error >= i) mechanicsInvalid("uncertainty", "initial axial inertia must remain positive"); if (source.initialAtRest) { initialOmegaError = initialMomentumError = 0; return { omega: 0, momentum: 0 }; } if (source.initialAngularMomentum !== undefined) { const momentum = mechanicsFinite(source.initialAngularMomentum, "initialAngularMomentum"), omega = mechanicsQuotient(momentum, i); initialMomentumError = source.initialAngularMomentumErrorBoundSI ?? 0; initialOmegaError = mechanicsErrorSum([(initialMomentumError + Math.abs(omega) * error) / (i - error), mechanicsQuotientRoundingError(momentum, i)]); return { omega, momentum }; } const omega = mechanicsFinite(source.angularVelocity!, "angularVelocity"), momentum = mechanicsProduct(i, omega); initialMomentumError = mechanicsErrorSum([mechanicsErrorProduct(Math.abs(omega), error), mechanicsErrorProduct(i + error, initialOmegaError), mechanicsProductRoundingError(i, omega)]); return { omega, momentum }; };
  if (source.mode === "coaxial_locking") {
    if (source.hypotheses.coaxial !== true || source.hypotheses.rigidEndpoints !== true || source.hypotheses.zeroExternalAngularImpulse !== true || source.angularImpulse !== 0 || !Array.isArray(source.rotors) || source.rotors.length < 2 || source.rotors.length > 16) mechanicsInvalid("rotors", "locking requires two to sixteen rigid coaxial rotors and explicit zero external impulse");
    source.rotors.forEach(rotor => { positive(rotor.inertia, "inertia"); mechanicsFinite(rotor.angularVelocity, "angularVelocity"); if (rotor.axisId !== source.axisId) mechanicsInvalid("axisId", "locked rotors must share the identical physical axis"); });
    inertia = initialInertia = mechanicsSum(source.rotors.map(rotor => rotor.inertia)); initialMomentum = momentum = numeric(source.rotors.reduce((sum, rotor) => add(sum, multiply(exact(rotor.inertia), exact(rotor.angularVelocity))), exact(0)), "angularMomentum");
    const common = source.rotors.every(rotor => rotor.angularVelocity === source.rotors![0]!.angularVelocity); omega = common ? source.rotors[0]!.angularVelocity : mechanicsQuotient(momentum, inertia); initialOmega = omega; impulse = 0;
    inertiaError = mechanicsErrorSum(source.rotors.map(rotor => rotor.inertiaErrorBoundSI ?? 0)); if (inertiaError >= inertia) mechanicsInvalid("uncertainty", "locking inertia interval must remain positive");
    initialInertiaError = inertiaError;
    omegaError = common && source.rotors.every(rotor => !(rotor.angularVelocityErrorBoundSI ?? 0)) ? 0 : mechanicsErrorSum([mechanicsErrorSum(source.rotors.map(rotor => mechanicsErrorSum([mechanicsErrorProduct(rotor.inertiaErrorBoundSI ?? 0, Math.abs(rotor.angularVelocity - omega)), mechanicsErrorProduct(rotor.inertia + (rotor.inertiaErrorBoundSI ?? 0), rotor.angularVelocityErrorBoundSI ?? 0)]))) / (inertia - inertiaError), mechanicsErrorProduct(Math.abs(omega), MECHANICS_RELATIVE_ERROR)]);
    initialEnergy = mechanicsSum(source.rotors.map(rotor => energy(rotor.inertia, rotor.angularVelocity)));
    initialEnergyError = mechanicsErrorSum(source.rotors.map(rotor => energyError(rotor.inertia, rotor.inertiaErrorBoundSI ?? 0, rotor.angularVelocity, rotor.angularVelocityErrorBoundSI ?? 0)));
    initialMomentumError = momentumError = mechanicsErrorSum(source.rotors.map(rotor => mechanicsErrorSum([mechanicsErrorProduct(Math.abs(rotor.angularVelocity), rotor.inertiaErrorBoundSI ?? 0), mechanicsErrorProduct(rotor.inertia + (rotor.inertiaErrorBoundSI ?? 0), rotor.angularVelocityErrorBoundSI ?? 0)])));
    loss = common ? 0 : mechanicsSum(source.rotors.map(rotor => energy(rotor.inertia, mechanicsSum([rotor.angularVelocity, -omega]))));
    lossError = mechanicsErrorSum(source.rotors.map(rotor => energyError(rotor.inertia, rotor.inertiaErrorBoundSI ?? 0, rotor.angularVelocity - omega, mechanicsErrorSum([omegaError, rotor.angularVelocityErrorBoundSI ?? 0]))));
  } else if (source.mode === "inertia_law") {
    const law = source.inertiaLaw; if (!law || source.hypotheses.axialAngularMomentum !== true) mechanicsInvalid("inertiaLaw", "variable inertia requires its original source law and axial angular-momentum hypothesis"); positive(law.timeScale, "timeScale"); positive(law.inertiaScale, "inertiaScale");
    const first = law.initialAt / law.timeScale, at = law.at / law.timeScale; if (first > at) mechanicsInvalid("time", "inertia-law state must follow its initial time");
    const parsed = parseMathExpression(law.expression); const interval = parsed.intervalBoundsOn(first, at); if (!(interval.low > 0)) mechanicsInvalid("inertiaLaw", "inertia must remain strictly positive throughout the source interval");
    const initialJet = parsed.certifiedJetAt(first), jet = parsed.certifiedJetAt(at); initialInertia = mechanicsProduct(initialJet.value, law.inertiaScale); inertia = mechanicsProduct(jet.value, law.inertiaScale); initialInertiaError = mechanicsErrorSum([mechanicsErrorProduct(initialJet.errorBounds.value, law.inertiaScale), law.inertiaScale === 1 ? mechanicsProductRoundingError(initialJet.value, law.inertiaScale) : mechanicsErrorProduct(initialInertia, MECHANICS_RELATIVE_ERROR)]); inertiaError = mechanicsErrorSum([mechanicsErrorProduct(jet.errorBounds.value, law.inertiaScale), law.inertiaScale === 1 ? mechanicsProductRoundingError(jet.value, law.inertiaScale) : mechanicsErrorProduct(inertia, MECHANICS_RELATIVE_ERROR)]); if (inertiaError >= inertia || initialInertiaError >= initialInertia) mechanicsInvalid("uncertainty", "source inertia law must remain certifiably positive at both phases");
    const torque = mechanicsFinite(source.torque!, "torque"), start = initialState(initialInertia, initialInertiaError); initialOmega = start.omega; initialMomentum = start.momentum; impulse = mechanicsProduct(torque, mechanicsSum([law.at, -law.initialAt])); momentum = mechanicsSum([initialMomentum, impulse]); omega = mechanicsQuotient(momentum, inertia);
    const duration = mechanicsSum([law.at, -law.initialAt]); impulseError = mechanicsErrorSum([mechanicsErrorProduct(Math.abs(duration), source.torqueErrorBoundSI ?? 0), mechanicsProductRoundingError(torque, duration)]); momentumError = mechanicsErrorSum([initialMomentumError, impulseError, mechanicsSumRoundingError([initialMomentum, impulse])]); omegaError = mechanicsErrorSum([(momentumError + Math.abs(omega) * inertiaError) / (inertia - inertiaError), mechanicsQuotientRoundingError(momentum, inertia)]);
    const derivative = mechanicsQuotient(mechanicsProduct(jet.derivative, law.inertiaScale), law.timeScale), derivativeError = mechanicsErrorSum([mechanicsErrorProduct(jet.errorBounds.derivative, law.inertiaScale / law.timeScale), law.inertiaScale !== 1 || law.timeScale !== 1 ? mechanicsErrorProduct(Math.abs(derivative), MECHANICS_RELATIVE_ERROR) : 0]); alpha = mechanicsQuotient(mechanicsSum([torque, -mechanicsProduct(omega, derivative)]), inertia); alphaError = mechanicsErrorSum([((source.torqueErrorBoundSI ?? 0) + Math.abs(omega) * derivativeError + (Math.abs(derivative) + derivativeError) * omegaError + Math.abs(alpha) * inertiaError) / (inertia - inertiaError), mechanicsQuotientRoundingError(mechanicsSum([torque, -mechanicsProduct(omega, derivative)]), inertia)]); initialEnergy = energy(initialInertia, initialOmega); initialEnergyError = energyError(initialInertia, initialInertiaError, initialOmega, initialOmegaError);
  } else {
    initialInertia = positive(source.inertia!, "inertia"); const start = initialState(initialInertia, initialInertiaError); initialOmega = start.omega; initialMomentum = start.momentum; initialEnergy = energy(initialInertia, initialOmega);
    if (source.mode === "constant_inertia") {
      if (source.hypotheses.constantInertia !== true) mechanicsInvalid("hypotheses", "constant-inertia equations require their explicit model hypothesis"); positive(source.time!, "time", true); const torque = mechanicsFinite(source.torque!, "torque"); inertia = initialInertia; impulse = mechanicsProduct(torque, source.time!); momentum = source.initialAngularMomentum !== undefined || source.initialAtRest ? mechanicsSum([initialMomentum, impulse]) : numeric(add(multiply(exact(initialInertia), exact(initialOmega)), multiply(exact(torque), exact(source.time!))), "angularMomentum"); omega = mechanicsQuotient(momentum, inertia); alpha = mechanicsQuotient(torque, inertia);
      const initialL = source.initialAngularMomentum !== undefined || source.initialAtRest ? exact(initialMomentum) : multiply(exact(initialInertia), exact(initialOmega)); const angleNumerator = add(multiply(initialL, exact(source.time!)), multiply(multiply(exact(torque), exact(0.5)), multiply(exact(source.time!), exact(source.time!)))); angleChange = mechanicsQuotient(numeric(angleNumerator, "angle"), inertia);
      inertiaError = source.inertiaErrorBoundSI ?? 0; if (inertiaError >= inertia) mechanicsInvalid("uncertainty", "rotation inertia interval must remain strictly positive"); impulseError = mechanicsErrorSum([mechanicsErrorProduct(Math.abs(source.time!), source.torqueErrorBoundSI ?? 0), mechanicsProductRoundingError(torque, source.time!)]); omegaError = mechanicsErrorSum([initialOmegaError, impulseError / (inertia - inertiaError), mechanicsErrorProduct(Math.abs(impulse / inertia), inertiaError / (inertia - inertiaError)), mechanicsQuotientRoundingError(momentum, inertia)]); alphaError = mechanicsErrorSum([(source.torqueErrorBoundSI ?? 0) / (inertia - inertiaError), mechanicsErrorProduct(Math.abs(alpha), inertiaError / (inertia - inertiaError))]);
    } else if (source.mode === "redistribution") {
      if (source.hypotheses.rigidEndpoints !== true) mechanicsInvalid("hypotheses", "redistribution requires rigid initial/final axial states"); inertia = positive(source.finalInertia!, "finalInertia"); impulse = mechanicsFinite(source.angularImpulse!, "angularImpulse"); momentum = mechanicsSum([initialMomentum, impulse]); omega = mechanicsQuotient(momentum, inertia); inertiaError = source.finalInertiaErrorBoundSI ?? 0;
      if (inertiaError >= inertia) mechanicsInvalid("uncertainty", "final inertia interval must remain strictly positive"); impulseError = source.angularImpulseErrorBoundSI ?? 0; momentumError = mechanicsErrorSum([mechanicsErrorProduct(Math.abs(initialOmega), initialInertiaError), mechanicsErrorProduct(initialInertia + initialInertiaError, initialOmegaError), impulseError]); omegaError = mechanicsErrorSum([momentumError / (inertia - inertiaError), mechanicsErrorProduct(Math.abs(omega), inertiaError / (inertia - inertiaError)), mechanicsErrorProduct(Math.abs(omega), MECHANICS_RELATIVE_ERROR)]);
    } else return mechanicsInvalid("mode", "unsupported axial physical model");
    if (initialInertiaError >= initialInertia) mechanicsInvalid("uncertainty", "initial inertia interval must remain strictly positive"); momentumError = mechanicsErrorSum([initialMomentumError, impulseError, mechanicsSumRoundingError([initialMomentum, impulse])]); omegaError = mechanicsErrorSum([(momentumError + Math.abs(omega) * inertiaError) / (inertia - inertiaError), mechanicsQuotientRoundingError(momentum, inertia)]); initialEnergyError = energyError(initialInertia, initialInertiaError, initialOmega, initialOmegaError);
  }
  const rotationEnergySI = energy(inertia, omega); const rotationError = mechanicsErrorSum([mechanicsErrorProduct(0.5 * omega ** 2, inertiaError), mechanicsErrorProduct(inertia + inertiaError, Math.abs(omega) * omegaError + 0.5 * omegaError ** 2), mechanicsErrorProduct(rotationEnergySI, MECHANICS_RELATIVE_ERROR)]);
  const errors = { inertiaSI: mechanicsErrorSum([inertiaError, mechanicsErrorProduct(inertia, MECHANICS_RELATIVE_ERROR)]), initialInertiaSI: mechanicsErrorSum([initialInertiaError, mechanicsErrorProduct(initialInertia, MECHANICS_RELATIVE_ERROR)]), angularVelocitySI: omegaError, initialAngularVelocitySI: initialOmegaError, angularAccelerationSI: alpha === null ? 0 : mechanicsErrorSum([alphaError, mechanicsErrorProduct(Math.abs(alpha), MECHANICS_RELATIVE_ERROR)]), angleChangeSI: angleChange === null ? 0 : mechanicsErrorSum([source.mode === "constant_inertia" ? mechanicsErrorSum([mechanicsErrorProduct(initialOmegaError, source.time!), mechanicsErrorProduct(0.5 * source.time! ** 2, alphaError)]) : 0, mechanicsErrorProduct(Math.abs(angleChange), MECHANICS_RELATIVE_ERROR)]), angularMomentumSI: momentumError, initialAngularMomentumSI: initialMomentumError, rotationEnergySI: rotationError, initialEnergySI: mechanicsErrorSum([initialEnergyError, mechanicsErrorProduct(initialEnergy, MECHANICS_RELATIVE_ERROR)]), impulseSI: impulseError, dissipatedEnergySI: mechanicsErrorSum([lossError, mechanicsErrorProduct(Math.abs(loss ?? 0), MECHANICS_RELATIVE_ERROR)]) };
  return axialRim({ inertiaSI: inertia, initialInertiaSI: initialInertia, angularVelocitySI: omega, initialAngularVelocitySI: source.mode === "coaxial_locking" ? null : initialOmega, angularAccelerationSI: alpha, angleSI: null, angleChangeSI: angleChange, angularMomentumSI: momentum, initialAngularMomentumSI: initialMomentum, rotationEnergySI, initialEnergySI: initialEnergy, impulseSI: impulse, dissipatedEnergySI: loss, errorBoundsSI: errors }, source.rimRadius);
}
