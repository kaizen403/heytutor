/** Lower already parsed scientific source certificates into native operators.
 * No chapter, question identity, model-authored geometry or numerical defaults
 * choose this path. The ordinary source/compiler/admission guards still run.
 */
import { readOriginalCoulombModel, validateSourceCoulombObligation } from "../physics/sourceCoulombObligation";
import { validateAtomicSourceBinding } from "../physics/atomicSceneAuthority";
import { deriveRutherfordScattering } from "../physics/nuclearAuthority";
import { readEnergyLevelSource, HYDROGEN_SERIES } from "../physics/energyLevelSource";
import { readSourceObservableUnitObligations, sourceObservableUnitMeasurements } from "../document/sourceObservableUnitObligation";
import { readSourceInstantaneousActivity } from "../physics/sourceInstantaneousActivity";
import { validateTurnPlanV3, type TurnPlanV3 } from "../contracts/contractsV3";
import { SCENE_DOCUMENT_VERSION, type SceneConstruction, type SceneDocument, type SceneEntity } from "../types";

function document(question: string, family: string, quantities: SceneDocument["quantities"],
  entities: SceneEntity[], constructions: SceneConstruction[]): SceneDocument {
  const requiredEntityIds = entities.filter(entity => entity.role !== "display helper").map(entity => entity.id);
  return { schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "Native operators lowered from the complete original source certificate" },
    source: { question, family, sourceModel: "source-certified-scientific/v1", representationTier: "qualitative_verified", nonMetric: true,
      slotSources: { sourceCertificate: "stem", ...Object.fromEntries(quantities.map(quantity => [quantity.id, "stem"])) } },
    quantities, entities, constructions, relations: [], annotations: [], requiredEntityIds,
    assertions: [{ id: "native_parts_exist", predicate: "exists", entities: requiredEntityIds, expected: true, severity: "fatal" }],
    revealGroups: [{ id: "setup", entityIds: requiredEntityIds, dependsOn: [], narrationCue: "Read the source-proved scientific relation" }],
    teachingTimeline: [{ id: "reveal_setup", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Read the source-proved scientific relation" }] };
}
const point = (id: string, x: number, y: number): SceneConstruction => ({ id: `make_${id}`, operator: "point",
  inputs: { x, y, coordinateSpace: "world" }, outputs: [id] });

type CoulombSource = NonNullable<ReturnType<typeof readOriginalCoulombModel>>;
type CoulombField = keyof CoulombSource["inputs"];
type PlanScalar = TurnPlanV3["givens"][number];

/** An original fragment must identify one physical source slot. Equal values
 * or convenient symbols never identify the projectile, target or energy. */
function coulombSourceField(question: string, source: CoulombSource, text: string | undefined): CoulombField | null {
  if (!text) return null;
  const occurrences: number[] = [];
  for (let start = question.indexOf(text); start >= 0; start = question.indexOf(text, start + 1)) occurrences.push(start);
  if (occurrences.length !== 1) return null;
  const start = occurrences[0]!, end = start + text.length;
  const fields = (Object.keys(source.inputs) as CoulombField[]).filter(field => {
    const evidence = source.inputs[field].evidence;
    return start <= evidence.start && end >= evidence.end;
  });
  return fields.length === 1 ? fields[0]! : null;
}

function coulombResultField(symbol: string): "closestApproach" | "thetaDegrees" | null {
  const key = symbol.normalize("NFC").trim();
  // Scripts, hats, powers and mathematical case carry meaning. Only these
  // whole result names identify the native output; ids remain opaque.
  if (/^(?:rmin|rMin|r_min|r_\{min\})$/u.test(key) ||
      /^(?:closest ?approach|distance ?of ?closest ?approach|closest ?distance)$/iu.test(key)) return "closestApproach";
  return /^(?:θ|\\theta|theta|thetaDegrees|theta degrees|deflectionAngle|deflection angle)$/u.test(key) ? "thetaDegrees" : null;
}

/** Retain a complete accepted inventory through a unique source-slot join.
 * Unknown or extra physics quantities make this bounded projection decline;
 * no unused planner scalar can silently accompany a different native state. */
function planBoundCoulombDocument(question: string, source: CoulombSource, rawPlan: unknown): SceneDocument | null {
  const checked = validateTurnPlanV3(rawPlan, question);
  if (!checked.valid || !checked.plan || !rawPlan || typeof rawPlan !== "object" ||
      !("question" in rawPlan) || rawPlan.question !== question) return null;
  const plan = checked.plan;
  const fields = new Map<CoulombField, PlanScalar>();
  const consumed = new Set<string>();
  const bind = (row: PlanScalar, field: CoulombField): boolean => {
    const expected = source.inputs[field], charge = field === "projectileCharge" || field === "targetCharge";
    const unit = row.unit ?? "1";
    if (fields.has(field) || [...fields.values()].some(value => value.id === row.id) || row.value !== expected.value ||
        !(charge ? unit === "e" || unit === "1" : unit === expected.unit)) return false;
    fields.set(field, row); consumed.add(row.id); return true;
  };
  for (const row of plan.givens) {
    const field = coulombSourceField(question, source, row.sourceText);
    if (!field || row.provenance !== "given" || !bind(row, field)) return null;
  }
  for (const row of plan.derived) {
    const field = coulombSourceField(question, source, row.sourceText);
    if (field === "impactParameter" && source.inputs[field].evidence.inference) {
      if (row.provenance !== "derived" || !bind(row, field)) return null;
    }
  }
  for (const field of Object.keys(source.inputs) as CoulombField[]) {
    if (!fields.has(field) && !(field === "impactParameter" && source.inputs[field].evidence.inference === "head_on_implies_zero_impact")) return null;
  }
  const resultRows = new Map<"closestApproach" | "thetaDegrees", { id: string; symbol: string; unit: string }>();
  for (const row of [...plan.unknowns, ...plan.derived.filter(quantity => !consumed.has(quantity.id))]) {
    const field = coulombResultField(row.symbol), idField = coulombResultField(row.id);
    if (!field || idField && idField !== field || consumed.has(row.id)) return null;
    const unit = field === "closestApproach" ? "fm" : "deg";
    if (row.unit !== unit || "value" in row && (!("provenance" in row) || row.provenance !== "derived")) return null;
    const prior = resultRows.get(field);
    if (prior && (prior.id !== row.id || prior.unit !== unit)) return null;
    resultRows.set(field, { id: row.id, symbol: row.symbol, unit });
  }
  if (!resultRows.has("closestApproach") || new Set([...fields.values(), ...resultRows.values()].map(row => row.id)).size !== fields.size + resultRows.size) return null;
  const quantities: SceneDocument["quantities"] = [...fields.entries()].map(([field, row]) => ({
    id: row.id, symbol: row.symbol, value: source.inputs[field].value, unit: row.unit ?? "1",
    provenance: source.inputs[field].evidence.inference ? "derived" : "given", sourceText: source.inputs[field].evidence.text,
    nativeOwnerId: "encounter" }));
  // Result bindings name accepted outputs. The native operator recomputes
  // their labels; duplicating an unknown scalar in the candidate inventory
  // would assert a value that the plan has not yet supplied.
  const result = document(question, "point_field", quantities, [{ id: "encounter", kind: "polyline", role: "projectile trajectory" }],
    [{ id: "source_encounter", operator: "rutherford_scattering", inputs: { model: "fixed_target_coulomb",
      ...Object.fromEntries([...fields].map(([field, row]) => [field, row.id])),
      resultBindings: Object.fromEntries([...resultRows].map(([field, row]) => [field, row.id])) }, outputs: ["encounter"] }]);
  return [...validateSourceCoulombObligation(result, plan, question), ...validateAtomicSourceBinding(result, plan)]
    .some(issue => issue.severity === "fatal") ? null : result;
}

function coulombDocument(question: string, acceptedPlan?: unknown): SceneDocument | null {
  const source = readOriginalCoulombModel(question);
  if (!source) return null;
  if (acceptedPlan != null) return planBoundCoulombDocument(question, source, acceptedPlan);
  const quantities: SceneDocument["quantities"] = Object.entries(source.inputs).map(([id, premise]) => ({
    id, symbol: id === "energy" ? "K" : id === "kEnergyLength" ? "ke²" : id === "impactParameter" ? "b" : id === "projectileCharge" ? "qα/e" : "qN/e",
    value: premise.value, unit: premise.unit, provenance: premise.evidence.inference ? "derived" : "given", sourceText: premise.evidence.text,
    nativeOwnerId: "encounter" }));
  const theorem = deriveRutherfordScattering(source.inputs.projectileCharge.value, source.inputs.targetCharge.value,
    source.inputs.kEnergyLength.value, source.inputs.energy.value, source.inputs.impactParameter.value);
  quantities.push({ id: "closestApproach", symbol: "rmin", value: theorem.closestApproach, unit: "fm", provenance: "derived", nativeOwnerId: "encounter" });
  return document(question, "point_field", quantities, [{ id: "encounter", kind: "polyline", role: "alpha particle nucleus encounter" }],
    [{ id: "source_encounter", operator: "rutherford_scattering", inputs: {
      model: "fixed_target_coulomb", ...Object.fromEntries(Object.keys(source.inputs).map(id => [id, id])),
      resultBindings: { closestApproach: "closestApproach" } }, outputs: ["encounter"] }]);
}

/** A unit comparison is a pair of owned text cells, not a fictitious time
 * curve or a population-at-zero assumption. The value proof is recomputed by
 * the existing obligation validator and every physical input remains bound.
 */
function observableDocument(question: string): SceneDocument | null {
  const obligations = readSourceObservableUnitObligations(question), measurements = sourceObservableUnitMeasurements(question);
  if (obligations.length !== 1 || measurements.length !== 2 || !obligations[0]!.supported) return null;
  const obligation = obligations[0]!;
  const rows: SceneDocument["quantities"] = [];
  if (obligation.owner === "activity") {
    const source = readSourceInstantaneousActivity(question, obligation, "activity");
    if (source.status !== "certified") return null;
    const certificate = source.certificate;
    rows.push({ id: "lambda", symbol: "λ", value: certificate.inputs.lambda.value, unit: `${certificate.inputs.lambda.timeUnit}^-1`,
      provenance: "given", sourceText: question.slice(certificate.inputs.lambda.start, certificate.inputs.lambda.end), nativeOwnerId: "activity" },
    { id: "population", symbol: "N", value: certificate.inputs.population.value, unit: "nuclei", provenance: "given",
      sourceText: question.slice(certificate.inputs.population.start, certificate.inputs.population.end), nativeOwnerId: "activity" });
  }
  const entities: SceneEntity[] = [], constructions: SceneConstruction[] = [];
  for (const [index, measurement] of measurements.entries()) {
    const id = index === 0 ? "primary_value" : "equivalent_rate", symbol = obligation.owner === "activity" ? index === 0 ? "A" : "R" : obligation.owner;
    rows.push({ id: `value_${index}`, symbol, value: measurement.value, unit: measurement.unit,
      provenance: obligation.owner === "activity" ? "derived" : "given", nativeOwnerId: id });
    entities.push({ id: `${id}_left`, kind: "point", role: "display helper" },
      { id: `${id}_right`, kind: "point", role: "display helper" },
      { id, kind: "segment", role: "equivalent-unit display row", label: `${symbol}=${measurement.value} ${measurement.unit}` });
    constructions.push(point(`${id}_left`, -1.2, -index * 2), point(`${id}_right`, 1.2, -index * 2),
      { id: `make_${id}`, operator: "segment", inputs: { start: `${id}_left`, end: `${id}_right` }, outputs: [id] });
  }
  // A connector is only a display relation between equivalent unit cells.
  // It is not a decay curve, interval, trajectory or additional physical fact.
  entities.push({ id: "display_left", kind: "point", role: "display helper" },
    { id: "display_right", kind: "point", role: "display helper" },
    { id: "display_bottom_left", kind: "point", role: "display helper" },
    { id: "display_bottom_right", kind: "point", role: "display helper" },
    { id: obligation.owner, kind: "segment", role: obligation.owner, label: obligation.owner },
    { id: "display_side", kind: "segment", role: "equivalent-unit display boundary" },
    { id: "display_bottom", kind: "segment", role: "equivalent-unit display boundary" });
  constructions.push(point("display_left", -2, 1.5), point("display_right", 2, 1.5),
    point("display_bottom_left", -2, -3.5), point("display_bottom_right", 2, -3.5),
    { id: "make_display_side", operator: "segment", inputs: { start: "display_left", end: "display_bottom_left" }, outputs: ["display_side"] },
    { id: "make_display_bottom", operator: "segment", inputs: { start: "display_bottom_left", end: "display_bottom_right" }, outputs: ["display_bottom"] },
    { id: "make_quantity_owner", operator: "segment", inputs: { start: "display_left", end: "display_right" }, outputs: [obligation.owner] });
  return document(question, "energy_level", rows, entities, constructions);
}

/** Requested principal states form an ordinal graph. Named series fix their
 * lower endpoint; the transition direction and ordering are checked afresh by
 * validateSourceEnergyLevelTruth. No energy, wavelength or metric gap is added.
 */
function levelDocument(question: string): SceneDocument | null {
  const source = readEnergyLevelSource(question);
  if (!source.requested || !source.supported || !source.hydrogenic || source.unprovedStates || !source.axis) return null;
  const transitions = source.events.length ? source.events.map(event => ({ from: event.from, to: event.to })) :
    source.transitions ? (source.series.length ? source.series : source.levels.filter(n => n <= HYDROGEN_SERIES.length)).map(to => ({ from: Math.max(to + 1, ...source.levels), to })) : [];
  if (!source.levels.length && !transitions.length || source.excludedSeries.some(n => transitions.some(t => Math.min(t.from, t.to) === n))) return null;
  const states = [...new Set([...source.levels, ...transitions.flatMap(event => [event.from, event.to])])].sort((a, b) => a - b);
  if (states.length > 8 || transitions.length > 8 || source.eventFacts.some(fact => !fact.affirmative || fact.direction === "absorption") && !source.events.length) return null;
  const entities: SceneEntity[] = [], constructions: SceneConstruction[] = [], quantities: SceneDocument["quantities"] = [];
  const axis = source.axis;
  const position = (tangent: number, rank: number) => axis.coordinate === "y" ? { x: tangent, y: rank * axis.sign * 2 } : { x: rank * axis.sign * 2, y: tangent };
  for (const [rank, n] of states.entries()) {
    const id = `level_${n}`, a = position(-2, rank), b = position(2, rank);
    entities.push({ id: `${id}_a`, kind: "point", role: "display helper" }, { id: `${id}_b`, kind: "point", role: "display helper" },
      { id, kind: "segment", role: "energy level", label: `n=${n}` });
    constructions.push(point(`${id}_a`, a.x, a.y), point(`${id}_b`, b.x, b.y),
      { id: `make_${id}`, operator: "segment", inputs: { start: `${id}_a`, end: `${id}_b` }, outputs: [id] });
    if (source.levels.includes(n)) {
      const match = [...question.matchAll(/\bn\s*=\s*(\d+)/g)].find(value => Number(value[1]) === n);
      if (match) quantities.push({ id: `principal_${n}`, symbol: "n", value: n, unit: "1", provenance: "given", sourceText: match[0], nativeOwnerId: id });
    }
  }
  transitions.forEach((transition, index) => {
    const id = `transition_${index}`, from = position(-1 + index * 0.5, states.indexOf(transition.from)), to = position(-1 + index * 0.5, states.indexOf(transition.to));
    const lower = Math.min(transition.from, transition.to), name = HYDROGEN_SERIES[lower - 1];
    entities.push({ id: `${id}_from`, kind: "point", role: "display helper" }, { id: `${id}_to`, kind: "point", role: "display helper" },
      { id, kind: "vector", role: "photon transition", ...(name && !source.excludedNames.includes(lower) ? { label: `${name[0]!.toUpperCase()}${name.slice(1)}` } : {}) });
    constructions.push(point(`${id}_from`, from.x, from.y), point(`${id}_to`, to.x, to.y),
      { id: `make_${id}`, operator: "vector", inputs: { start: `${id}_from`, end: `${id}_to` }, outputs: [id] });
  });
  const result = document(question, "energy_level", quantities, entities, constructions);
  result.annotations.push({ id: "ordinal", kind: "caption", targetIds: [], text: "Ordinal levels; not to scale" });
  return result;
}

export function buildSourceCertifiedScientificScene(question: string, acceptedPlan?: unknown): { document: SceneDocument; family: string } | null {
  const result = coulombDocument(question, acceptedPlan) ?? observableDocument(question) ?? levelDocument(question);
  return result ? { document: result, family: String(result.source.family) } : null;
}
