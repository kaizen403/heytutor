import type { TurnPlanV3 } from "../contracts/contractsV3";
import type { SceneDocument, SceneIssue } from "../types";
import { readSourcePlanarGeometry, sameSourcePlanarPoint, type SourcePlanarCircle as Circle, type SourcePlanarPath as Path, type SourcePlanarPoint as Point } from "../document/sourcePlanarGeometry";
import { readSourcePlanarViews } from "../document/sourcePlanarViews";
import { readSourceDrawingRequests, sourceUnquotedText } from "../document/sourceRequestScope";
import { evaluateAtomicConstruction } from "../compile/atomicGeometry";
import { validationNumber } from "../compile/sourceScalars";
import { energyText, mentionsPrincipalState, principalState, readEnergyAxis, readEnergyLevelSource, seriesNames, type EnergyAxis, type PrincipalState } from "./energyLevelSource";
import { affirmativeEnergyFact, currentEnergyClauses, energyDirectionWords } from "./energySourceScope";
import { buildAtomicRadiationScene } from "../chemistry/atomicRadiation";
import { sourceDocumentMatchesRebuiltSource } from "./independentSourceScene";
import { findChemistryQuantities } from "../chemistry/quantityReader";
import { observableMathText } from "../document/sourceObservableUnits";

interface Caption { owner: string | null; text: string }
interface Level { id: string; path: Path; state: PrincipalState; native: boolean }
interface Transition { id: string; from: PrincipalState; to: PrincipalState; series: number[] }
interface Orbit { id: string; circle: Circle; state: PrincipalState; native: boolean }
const fatal = (code: string, message: string, entityIds: string[] = []): SceneIssue => ({ code, message, entityIds, severity: "fatal", failureKind: "truth" });
const sameQuestion = (left: string, right: string) => energyText(left) === energyText(right);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
/** Follow the same scalar/reference chain as validationNumber while retaining
 * every unit annotation it deliberately ignores for layout arithmetic. A
 * schematic radius may consume only dimensionless values at every layer. */
function unitlessRadiusOperand(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): boolean {
  if (depth > 32 || seen.has(value)) return false;
  const next = new Set([...seen, value]);
  const unitless = (unit: unknown) => unit === undefined || typeof unit === "string" && ["", "1"].includes(unit);
  if (record(value) && "value" in value) return unitless(value.unit) && unitlessRadiusOperand(value.value, document, next, depth + 1);
  if (typeof value === "string") {
    const quantity = document.quantities.find(item => item.id === value);
    if (quantity) return unitless(quantity.unit) && unitlessRadiusOperand(quantity.value, document, next, depth + 1);
  }
  try { return Number.isFinite(validationNumber(value, document)); } catch { return false; }
}
// The error budget is relative to the local mark, never its world origin.
// Translating a diagram cannot turn a visible gap or slope into incidence.
const near = (a: number, b: number, span: number) => a === b || Number.isFinite(span) && Math.abs(a - b) <= 64 * Number.EPSILON * Math.abs(span);
const pathSpan = (path: Path) => Math.max(...(["x", "y"] as const).map(coordinate => {
  const values = path.points.map(point => point[coordinate]);
  return Math.max(...values) - Math.min(...values);
}));
const sameState = (a: PrincipalState, b: PrincipalState) => a.min === b.min && a.max === b.max;
const contained = (a: PrincipalState, b: PrincipalState) => a.min >= b.min && a.max <= b.max;
const exact = (state: PrincipalState, n: number) => state.min === n && state.max === n;
const levelRole = (role: string) => /\b(?:energy[ -]level|principal[ -]state|ground state)\b/.test(energyText(role));
const transitionRole = (role: string) => /\b(?:transition|emission|absorption)\b/.test(energyText(role));
function energyAxisCaption(text: string): boolean {
  return /^(?:energy|energyaxis|energye|eenergy|e|e\/ev|e\/j|energy\/ev|energy\/j)$/.test(energyText(text).replace(/[()\s]/g, "")) ||
    /^energy\b/.test(energyText(text)) && /\b(?:axis|increas\w*|decreas\w*)\b/.test(energyText(text));
}
function levelPath(path: Path | null, axis: EnergyAxis): path is Path {
  const tangent = axis.coordinate === "y" ? "x" : "y";
  return Boolean(path && path.points.length >= 2 && path.points.every(p => p.frame === path.points[0]!.frame && near(p[axis.coordinate], path.points[0]![axis.coordinate], pathSpan(path))) &&
    !near(path.points[0]![tangent], path.points.at(-1)![tangent], pathSpan(path)));
}
function onLevel(point: Point, path: Path, axis: EnergyAxis, sourceOwnedSideCaption = false): boolean {
  if (!levelPath(path, axis) || point.frame !== path.points[0]!.frame || !near(point[axis.coordinate], path.points[0]![axis.coordinate], pathSpan(path))) return false;
  if (sourceOwnedSideCaption) return true;
  const tangent = axis.coordinate === "y" ? "x" : "y", values = path.points.map(p => p[tangent]);
  return (point[tangent] > Math.min(...values) || near(point[tangent], Math.min(...values), pathSpan(path))) &&
    (point[tangent] < Math.max(...values) || near(point[tangent], Math.max(...values), pathSpan(path)));
}

/** Read text actually attached to an owner. IDs and roles do not supply n.
 * Floating captions, multiple targets and unsupported label anchors cannot
 * become physical ownership evidence. Labels themselves remain visible claims. */
function captions(document: SceneDocument): Caption[] {
  const producers = new Map(document.constructions.flatMap(c => c.outputs.map(id => [id, c] as const)));
  const entities = new Map(document.entities.map(e => [e.id, e]));
  const owner = (ref: unknown, seen = new Set<string>()): string | null => {
    if (typeof ref !== "string" || seen.has(ref) || seen.size > 32 || !entities.has(ref)) return null;
    if (entities.get(ref)!.kind !== "label") return ref;
    const p = producers.get(ref);
    return p?.operator === "label" ? owner(p.inputs.target ?? p.inputs.at ?? p.inputs.point, new Set([...seen, ref])) : null;
  };
  const result: Caption[] = document.entities.flatMap(e => typeof e.label === "string" ? [{ owner: owner(e.id), text: e.label }] : []);
  for (const c of document.constructions) if (c.operator === "label" && typeof c.inputs.text === "string")
    result.push({ owner: owner(c.inputs.target ?? c.inputs.at ?? c.inputs.point), text: c.inputs.text });
  for (const a of document.annotations) if (["label", "callout"].includes(a.kind) && typeof a.text === "string")
    result.push({ owner: a.targetIds.length === 1 ? owner(a.targetIds[0]) : null, text: a.text });
  return result;
}

/** Original-source, refusal-only proof of displayed principal energy levels
 * and named series. It produces no diagram, assumes no energy spacing, and
 * consumes no model-authored relation, qualitative claim or stored proof hint.
 * Unsupported physical statements are refused rather than label-demoted. */
export function validateSourceEnergyLevelTruth(document: SceneDocument, plan?: TurnPlanV3 | null, originalIR?: unknown): SceneIssue[] {
  if (document.visualDecision.mode !== "scene") return [];
  const documentQuestion = typeof document.source.question === "string" ? document.source.question : "";
  const originalQuestion = record(originalIR) && originalIR.schemaVersion === "problem-ir/v1" && typeof originalIR.question === "string" ? originalIR.question : plan?.question ?? documentQuestion;
  const source = readEnergyLevelSource(originalQuestion);
  const allCaptions = captions(document), stateCaptions = allCaptions.filter(c => mentionsPrincipalState(c.text));
  const namedCaptions = allCaptions.filter(c => seriesNames(c.text).length && (source.physical || /\bseries\b/.test(energyText(c.text))));
  const related = [source, readEnergyLevelSource(documentQuestion), ...(plan ? [readEnergyLevelSource(plan.question)] : [])];
  const required = related.some(s => s.physical && s.requested && s.hydrogenic);
  const atomicStateContext = source.physical || source.levels.length > 0 || currentEnergyClauses(originalQuestion).some(clause =>
    /\b(?:bohr|atoms?|atomic|orbits?|principal[ -]state|principal quantum)\b/.test(energyText(clause)));
  const hasLegacyShells = stateCaptions.length > 0 && document.entities.some(entity => entity.kind === "segment" && entity.role === "bohr shell");
  if (!required && !namedCaptions.length && !(atomicStateContext && source.hydrogenic && stateCaptions.length) &&
      !hasLegacyShells && !document.constructions.some(c => c.operator === "bohr_transition")) return [];
  if (!sameQuestion(originalQuestion, documentQuestion) || plan && !sameQuestion(originalQuestion, plan.question))
    return [fatal("energy_level_source_mismatch", "The energy-level figure must retain its original question; a restated question, plan or embedded proof cannot replace its physical premise.")];
  if (!source.supported) return [fatal("energy_level_model_unproved", "Displayed principal-n energy order or hydrogenic spectral series needs an applicable original one-electron atomic source; a model tag cannot certify an excluded, ambiguous or multi-electron system.")];
  if (source.unprovedStates) return [fatal("energy_level_source_state_unproved", "The original principal-state declarations must be supported positive integers; unresolved or malformed source states cannot be replaced by a candidate's values.")];
  if (!source.axis) return [fatal("energy_level_axis_unproved", "The energy increase direction must have one supported original-source page convention; ambiguous, conflicting or unsupported frame declarations cannot certify energy order.")];
  // A finite principal-state diagram does not establish a continuum
  // boundary. The current atomic operators lower bound states and their
  // transitions only, so an asserted limit cannot be verified by adding text.
  const requiresContinuum = source.requested && readSourceDrawingRequests(originalQuestion).some(request => {
    if (request.scope !== "current") return false;
    const text = energyText(sourceUnquotedText(request.text)).split(
      /\b(?:and|then|also)\s+(?:(?:then|also)\s+)?(?:calculate|find|compute|derive|determine|estimate|explain|describe|discuss)\b/,
    )[0]!;
    return [...text.matchAll(/\b(?:ioni[sz]ation (?:energy )?limits?|continuum (?:limit|threshold|edge))\b/g)]
      .some(match => affirmativeEnergyFact(text, match.index!));
  });
  if (requiresContinuum)
    return [fatal("energy_level_continuum_unproved", "The current source requires an ionization or continuum limit on the diagram; finite bound-state levels alone cannot prove it.")];
  // The exact source program owns its adjacent principal-state captions.
  // Geometry, axis conventions and requested events still need proof below.
  const rebuiltLegacy = hasLegacyShells ? buildAtomicRadiationScene(originalQuestion, [], false) : null;
  const ownsLegacySideCaptions = sourceDocumentMatchesRebuiltSource(document, originalQuestion, rebuiltLegacy);
  const axis = source.axis, { point, path, circle, producers } = readSourcePlanarGeometry(document);
  const issues: SceneIssue[] = [], levels: Level[] = [], transitions: Transition[] = [];
  const entities = new Map(document.entities.map(e => [e.id, e]));
  const nativeIds = new Set<string>();
  const nativeKinds = new Map<string, { kind: string }>();
  const orbits: Orbit[] = [];
  const currentClauses = currentEnergyClauses(originalQuestion);
  const clauses = currentClauses.map(energyText);
  const foreground = clauses.join("; ");
  if (ownsLegacySideCaptions && rebuiltLegacy) {
    // This producer supplies conventional energy and radius constants for
    // its named species. An additional declared charge or measurement needs
    // an operator that consumes and proves that input from the question.
    const explicitCharge = [...foreground.matchAll(/\b(?:z\s*(?:=|:|is)\s*|(?:nuclear charge|atomic number)\s*(?:(?:z|is|of)\s*)?(?:=|:)?\s*)[+-]?\d/g)]
      .some(match => affirmativeEnergyFact(foreground, match.index!));
    const measuredInputs = currentClauses.some(raw => {
      const question = observableMathText(raw);
      return (["energy", "length"] as const).some(dimension => {
        const values = findChemistryQuantities({ question, dimension });
        return !values.ok || values.reading.some(reading => affirmativeEnergyFact(question.toLowerCase(), reading.source.span.start));
      });
    });
    if (explicitCharge || measuredInputs)
      issues.push(fatal("energy_level_legacy_source_quantity_unproved", "A legacy Bohr figure uses standard species constants; a supplied charge, energy or length needs a source-bound producer."));
    const excluded = readSourceDrawingRequests(originalQuestion).filter(request => request.scope === "negated")
      .map(request => energyText(sourceUnquotedText(request.text)));
    for (const clause of clauses) for (const exclusion of clause.matchAll(/\b(?:without|omit|hide|exclude)\s+([^;.!?]+)/g))
      excluded.push(exclusion[1]!);
    // Normalization can turn label entities into annotations. The exact
    // rebuilt program retains their roles for comparison to source omissions.
    const roles = rebuiltLegacy.entities.filter(entity => entity.kind === "label").map(entity => entity.role ?? "");
    const excludesResult = excluded.some(text =>
      /\b(?:numerical|numeric|computed)\s+(?:labels?|values?|answers?)\b|\ball\s+labels\b/.test(text) ||
      roles.some(role => role.endsWith("energy") && /\benerg(?:y|ies)\b/.test(text) ||
        role === "transition wavelength" && /\bwavelengths?\b/.test(text) ||
        role === "bohr radius" && /\bradi(?:us|i)\b/.test(text) ||
        role === "spectral line count" && /\b(?:line count|number of (?:spectral )?lines)\b/.test(text)));
    if (excludesResult)
      issues.push(fatal("energy_level_caption_source_excluded", "The original question excludes an energy, wavelength, radius or count caption in the rebuilt source figure."));
  }
  const orbitScope = [...foreground.matchAll(/\bbohr\b|\b(?:atomic|electron)\s+(?:circular\s+)?orbits?\b/g)]
    .some(match => affirmativeEnergyFact(foreground, match.index!));
  // Ordinal schematic circles cannot certify a numerical radius, radius
  // ratio or scale assertion. Native orbit quantities keep their independent
  // atomic proof; displayRadius is explicitly schematic in that producer.
  const explicitSizing = currentEnergyClauses(originalQuestion).map(energyText).some(body => {
    if (!/\b(?:orbits?|radius|radii|diameter|circumference|orbit sizes?)\b/.test(body)) return false;
    // A stated physical size is still an obligation when the value precedes
    // 'radius', or when scale is expressed as one length per another.
    const measures = /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\s*(?:fm|pm|nm|[μµu]m|mm|cm|dm|m|km|(?:femto|pico|nano|micro|milli|centi|kilo)?met(?:er|re)s?)\b|\b(?:scale|scaled)\b/g;
    return [...body.matchAll(measures)].some(match => affirmativeEnergyFact(body, match.index!));
  });
  const metricRadius = explicitSizing || [...foreground.matchAll(/\b(?:radius|radii|diameter|circumference)\b[^;.!?]{0,80}(?:=|\b\d|\b(?:exact|scaled|metric|measured|numerical|ratio|proportional)\b)|\b(?:exact|metric|scaled|measured|numerical)\b[^;.!?]{0,30}\b(?:radius|radii|diameter|circumference)\b|\br(?:_?(?:\d+|n))?\s*(?:=|\/|∝|\()|\b(?:to scale|scaled orbits?)\b/g)]
    .some(match => affirmativeEnergyFact(foreground, match.index!));
  const schematicOrbits = document.source.nonMetric === true && ["qualitative_verified", "question_representation"].includes(String(document.source.representationTier)) && !metricRadius;
  for (const c of document.constructions.filter(c => c.operator === "bohr_orbit")) {
    try {
      const center = c.inputs.origin === undefined ? { x: 0, y: 0, frame: "world:" } : point(c.inputs.origin);
      if (!center || !/^(?:world|layout):$/.test(center.frame)) throw new Error("unproved orbit frame");
      const values = evaluateAtomicConstruction(c.operator, c.inputs, {
        number: value => validationNumber(value, document), geometry: () => undefined,
        point: value => { const p = point(value); if (!p) throw new Error("unproved native origin"); return p; },
      }, document);
      if (c.outputs.length !== 4 || values.length !== 4 || values[0]?.kind !== "circle" || values[1]?.kind !== "point" || values[2]?.kind !== "path" || values[3]?.kind !== "path") throw new Error("native orbit ownership");
      const n = validationNumber(c.inputs.n, document), value = values[0];
      orbits.push({ id: c.outputs[0]!, circle: { center: { ...value.center, frame: center.frame }, radius: value.radius }, state: { min: n, max: n }, native: true });
      c.outputs.forEach((id, i) => { nativeIds.add(id); nativeKinds.set(id, { kind: values[i]!.kind }); });
    } catch { issues.push(fatal("energy_orbit_native_unproved", "Native orbit geometry must be independently evaluated in a supported source frame, retaining all physical source operands.", c.outputs)); }
  }
  // Recompute native paths and principal states from their source operands,
  // never from a candidate's atomicObservable, result tag or semantic role.
  for (const c of document.constructions.filter(c => c.operator === "bohr_transition")) {
    try {
      const values = evaluateAtomicConstruction(c.operator, c.inputs, {
        number: value => validationNumber(value, document), geometry: () => undefined,
        point: value => { const p = point(value); if (!p) throw new Error("unproved native origin"); return p; },
      }, document);
      const ns = [validationNumber(c.inputs.nFrom, document), validationNumber(c.inputs.nTo, document)];
      if (c.outputs.length !== 3) throw new Error("native transition ownership");
      for (let i = 0; i < 2; i++) {
        const value = values[i];
        if (value?.kind !== "path") throw new Error("native level path");
        const p: Path = { points: value.points.map(p => ({ ...p, frame: c.inputs.origin === undefined ? "world:" : point(c.inputs.origin)?.frame ?? "unproved" })), extent: "finite" };
        if (!levelPath(p, axis)) throw new Error("native level axis");
        levels.push({ id: c.outputs[i]!, path: p, state: { min: ns[i]!, max: ns[i]! }, native: true });
      }
      transitions.push({ id: c.outputs[2]!, from: { min: ns[0]!, max: ns[0]! }, to: { min: ns[1]!, max: ns[1]! }, series: [] });
      for (const id of c.outputs) { nativeIds.add(id); nativeKinds.set(id, { kind: "path" }); }
    } catch { issues.push(fatal("energy_level_native_unproved", "Native level ownership and orientation must follow the independently recomputed transition in a supported frame.", c.outputs)); }
  }
  const views = readSourcePlanarViews(document, nativeKinds);
  if (!views) issues.push(fatal("energy_level_frame_unproved", "The compiler view of every physical level must follow supported source geometry and transform ownership."));
  const sameOwnerView = (a: string, b: string) => views?.owner(a) !== undefined && views.owner(a) === views.owner(b);
  const claimedOwners = new Map<string, PrincipalState[]>();
  const pathIds = document.entities.filter(e => !nativeIds.has(e.id) && ["segment", "line", "polyline"].includes(e.kind)).map(e => e.id);
  for (const caption of stateCaptions) {
    const state = principalState(caption.text);
    const nativeOrbit = orbits.find(orbit => orbit.native && orbit.id === caption.owner);
    const circular = nativeOrbit?.circle ?? (caption.owner ? circle(caption.owner) : null);
    if (circular && caption.owner) {
      if (!nativeOrbit && !orbitScope || !state || state.min !== state.max || nativeOrbit && !sameState(state, nativeOrbit.state) ||
        !nativeOrbit && levelRole(entities.get(caption.owner)?.role ?? "") || /\benergy\b/.test(energyText(caption.text)))
        issues.push(fatal("energy_orbit_state_unproved", "A circular principal-state caption needs actual orbit geometry, an original atomic-orbit/Bohr premise and one consistent exact n; it cannot claim ownership of an energy-level mark.", [caption.owner]));
      else if (!nativeOrbit) {
        const producer = producers.get(caption.owner), radiusRef = producer?.inputs.radius ?? producer?.inputs.r;
        if (!schematicOrbits || !unitlessRadiusOperand(radiusRef, document)) issues.push(fatal("energy_orbit_metric_unproved", "An ordinary orbit has only ordinal schematic radius authority; exact metric radius or scale claims need an independent physical producer.", [caption.owner]));
        const prior = orbits.find(orbit => orbit.id === caption.owner);
        if (prior && !sameState(prior.state, state)) issues.push(fatal("energy_orbit_state_unproved", "One circular orbit cannot own contradictory principal states.", [caption.owner]));
        else if (!prior) orbits.push({ id: caption.owner, circle: circular, state, native: false });
      }
      continue;
    }
    const native = levels.find(level => level.native && level.id === caption.owner);
    if (native && state && contained(native.state, state)) continue;
    const at = caption.owner ? point(caption.owner) : null;
    const owners = caption.owner && pathIds.includes(caption.owner) ? [caption.owner] : at ? pathIds.filter(id => {
      const p = path(id);
      const sideCaption = ownsLegacySideCaptions && entities.get(id)?.role === "bohr shell";
      return p && sameOwnerView(caption.owner!, id) && onLevel(at, p, axis, sideCaption);
    }) : [];
    if (!state || owners.length !== 1) {
      issues.push(fatal("energy_level_state_owner_unproved", "Each visible n claim must name a supported principal state and attach to its unique actual level; a wrong native n, floating caption or role cannot supply it.", caption.owner ? [caption.owner] : []));
    } else claimedOwners.set(owners[0]!, [...(claimedOwners.get(owners[0]!) ?? []), state]);
  }
  for (const id of pathIds.filter(id => claimedOwners.has(id) || levelRole(entities.get(id)?.role ?? ""))) {
    const claims = claimedOwners.get(id) ?? [], p = path(id);
    const state = claims.length ? { min: Math.max(...claims.map(c => c.min)), max: Math.min(...claims.map(c => c.max)) } : null;
    if (!state || state.min > state.max || !levelPath(p, axis)) issues.push(fatal("energy_level_state_owner_unproved", "An energy-level mark needs one consistent visible principal state and a supported constant-energy path in the energy frame.", [id]));
    else levels.push({ id, path: p, state, native: false });
  }
  if (required && !levels.length) issues.push(fatal("energy_level_missing", "The requested energy levels have no supported displayed principal-state owners."));
  for (const n of source.levels) if ((required || ownsLegacySideCaptions) && !levels.some(level => exact(level.state, n)))
    issues.push(fatal("energy_level_source_state_missing", `The original source principal state n=${n} must retain its own displayed level; another integer or an unspecified collection cannot replace it.`));

  for (const orbit of orbits) if (!orbit.native && !orbitScope || source.levels.length > 0 && !source.levels.some(n => exact(orbit.state, n)))
    issues.push(fatal("energy_orbit_source_unproved", "A displayed orbit state must retain the original current atomic-orbit scope and declared principal states; a role or model tag cannot supply them.", [orbit.id]));
  // A visible nucleus claim belongs to this bounded one-atom diagram too.
  // Its name does not prove its position: use its actual point/circle and view.
  const nuclei = new Set(allCaptions.filter(c => {
    const text = energyText(c.text), claim = /\b(?:nucleus|nuclei)\b/.exec(text);
    return c.owner && claim && affirmativeEnergyFact(text, claim.index);
  }).map(c => c.owner!));
  for (const id of nuclei) for (const orbit of orbits) {
    const nuclearCircle = circle(id), center = nuclearCircle?.center ?? point(id);
    const producer = producers.get(id), radius = producer?.inputs.radius ?? producer?.inputs.r;
    const schematicNuclearRadius = !nuclearCircle || unitlessRadiusOperand(radius, document);
    if (!schematicNuclearRadius || !sameOwnerView(id, orbit.id) || !sameSourcePlanarPoint(center, orbit.circle.center) || nuclearCircle && nuclearCircle.radius >= orbit.circle.radius)
      issues.push(fatal("energy_orbit_centre_unproved", "The displayed nucleus needs a proved dimensionless schematic radius, the orbit's centre/frame/compiler view, and containment inside the orbit.", [id, orbit.id]));
  }
  // This bounded proof covers one atom's concentric principal orbits. A
  // separate packed panel cannot borrow a centre, radius order or n owner.
  for (let i = 0; i < orbits.length; i++) for (const b of orbits.slice(i + 1)) {
    const a = orbits[i]!;
    if (!sameOwnerView(a.id, b.id) || !sameSourcePlanarPoint(a.circle.center, b.circle.center))
      issues.push(fatal("energy_orbit_view_unproved", "Compared principal orbits need one proved centre, source frame and actual compiler view.", [a.id, b.id]));
    else {
      const order = a.state.min < b.state.min ? 1 : a.state.min > b.state.min ? -1 : 0;
      const difference = b.circle.radius - a.circle.radius;
      if (order ? difference * order <= 0 || near(difference, 0, Math.max(a.circle.radius, b.circle.radius)) : !near(difference, 0, Math.max(a.circle.radius, b.circle.radius)))
        issues.push(fatal("energy_orbit_order_false", "For one hydrogenic atom, the greater principal state has the greater orbit radius; a schematic may omit metric scale but cannot reverse that order.", [a.id, b.id]));
    }
  }

  const sameView = (a: Level, b: Level) => sameOwnerView(a.id, b.id) && a.path.points[0]!.frame === b.path.points[0]!.frame;
  for (let i = 0; i < levels.length; i++) for (const b of levels.slice(i + 1)) {
    const a = levels[i]!;
    if (!views || views.owner(a.id) !== views.owner(b.id)) continue;
    if (!sameView(a, b)) {
      issues.push(fatal("energy_level_frame_unproved", "A shared compiler view cannot mix unproved source coordinate frames.", [a.id, b.id]));
      continue;
    }
    const difference = axis.sign * (b.path.points[0]![axis.coordinate] - a.path.points[0]![axis.coordinate]);
    const order = a.state.max < b.state.min ? 1 : b.state.max < a.state.min ? -1 : 0;
    const span = Math.max(pathSpan(a.path), pathSpan(b.path));
    if (order ? difference * order <= 0 || near(difference, 0, span) : !sameState(a.state, b.state) || !near(difference, 0, span))
      issues.push(fatal("energy_level_order_false", "In the supported one-electron model E(n)=-C/n² with C>0: greater n has greater energy in the original source's declared direction. Layout coordinates and nonmetric tiers cannot reverse it.", [a.id, b.id]));
  }
  // The compiler may reroute logical circuit loops, and may shorten explicit
  // nonmetric direction glyphs. Neither can supply an atomic level/endpoint
  // proof from unchanged source coordinates. These representations need a
  // supported physical producer instead of borrowing a layout convention.
  for (const level of levels.filter(level => !level.native)) if (document.constructions.some(c =>
    ["symbol", "connect"].includes(c.operator) && c.outputs.some(id => views?.members(level.id).includes(id))))
    issues.push(fatal("energy_level_layout_unproved", "An independently rerouted logical layout cannot certify actual atomic energy-level positions.", [level.id]));

  const energyAxisIds = new Set<string>();
  for (const e of document.entities) {
    const c = producers.get(e.id), texts = allCaptions.filter(caption => caption.owner === e.id).map(caption => energyText(caption.text));
    const axisClaim = texts.some(energyAxisCaption) && (e.kind === "vector" || /\baxis\b/.test(energyText(e.role ?? "")));
    if (axisClaim) {
      for (const text of texts.filter(text => /\b(?:increas\w*|decreas\w*)\b/.test(text))) {
        const declared = readEnergyAxis(text);
        if (!declared || declared.coordinate !== axis.coordinate || declared.sign !== axis.sign)
          issues.push(fatal("energy_axis_caption_false", "A displayed axis convention must agree with the original-source energy direction.", [e.id]));
      }
      energyAxisIds.add(e.id);
      const p = path(e.id), a = p?.points[0], b = p?.points.at(-1), tangent = axis.coordinate === "y" ? "x" : "y";
      if (!a || !b || !p || c?.operator !== "vector" || axis.sign * (b[axis.coordinate] - a[axis.coordinate]) <= 0 || !near(a[tangent], b[tangent], pathSpan(p)))
        issues.push(fatal("energy_axis_direction_false", "A displayed energy-axis arrow must increase in the original source's proved page direction.", [e.id]));
    }
    if (c?.operator === "axes") {
      for (const coordinate of ["x", "y"] as const) if (energyAxisCaption(String(c.inputs[`${coordinate}Label`] ?? "")) && (axis.coordinate !== coordinate || axis.sign !== 1))
        issues.push(fatal("energy_axis_direction_false", "Native increasing-coordinate axes cannot claim an incompatible source energy direction.", [e.id]));
    }
  }
  const namedByOwner = new Map<string, number[]>();
  for (const caption of namedCaptions) {
    const names = seriesNames(caption.text), text = energyText(caption.text);
    if (!caption.owner || names.length !== 1 || /\b(?:not|no|non|or|maybe|possibly|unknown)\b|\?/.test(text)) {
      issues.push(fatal("energy_series_name_unproved", "A displayed spectral-series name needs a single affirmative name attached to its actual directed transition.", caption.owner ? [caption.owner] : []));
    } else namedByOwner.set(caption.owner, [...(namedByOwner.get(caption.owner) ?? []), ...names]);
  }
  // A label's visible claims are already resolved to its actual target above;
  // its descriptive role cannot construct a second transition arrow.
  for (const e of document.entities.filter(e => e.kind !== "label" && !nativeIds.has(e.id) && !energyAxisIds.has(e.id) && (e.kind === "vector" || transitionRole(e.role ?? "") || namedByOwner.has(e.id)))) {
    const p = path(e.id), c = producers.get(e.id);
    // The complete legacy program has point helpers for its side captions.
    // They carry the caption role, and the actual event remains a vector.
    if (ownsLegacySideCaptions && c?.operator === "point" && !namedByOwner.has(e.id)) continue;
    const from = p ? levels.filter(level => !level.native && sameOwnerView(e.id, level.id) && onLevel(p.points[0]!, level.path, axis)) : [];
    const to = p ? levels.filter(level => !level.native && sameOwnerView(e.id, level.id) && onLevel(p.points.at(-1)!, level.path, axis)) : [];
    if (!transitionRole(e.role ?? "") && !namedByOwner.has(e.id) && (!from.length || !to.length)) continue;
    if (!p || p.extent !== "finite" || c?.operator !== "vector" || from.length !== 1 || to.length !== 1 || from[0] === to[0] || !sameView(from[0]!, to[0]!))
      issues.push(fatal("energy_transition_owner_unproved", "An atomic transition needs actual directed endpoints on two uniquely owned, distinct energy levels in one supported coordinate view.", [e.id]));
    else if (document.source.nonMetric === true && Array.isArray(c.inputs.direction) && typeof c.inputs.length === "number")
      issues.push(fatal("energy_transition_glyph_unproved", "A fitted nonmetric direction glyph cannot certify a transition's terminal level incidence.", [e.id]));
    else transitions.push({ id: e.id, from: from[0]!.state, to: to[0]!.state, series: [] });
  }
  for (const [id] of namedByOwner) if (!transitions.some(t => t.id === id))
    issues.push(fatal("energy_series_transition_missing", "A spectral-series caption must belong to a proved directed level transition.", [id]));
  for (const t of transitions) {
    const names = [...new Set(namedByOwner.get(t.id) ?? [])];
    const emission = t.from.min > t.to.max, absorption = t.to.min > t.from.max;
    if (!emission && !absorption) issues.push(fatal("energy_transition_state_unproved", "Transition states must have disjoint, ordered principal-n ownership.", [t.id]));
    const lower = emission ? t.to : t.from;
    const matches = (fact: typeof source.eventFacts[number]) =>
      (fact.series === undefined || exact(lower, fact.series)) &&
      (fact.from === undefined || exact(t.from, fact.from)) && (fact.to === undefined || exact(t.to, fact.to));
    const facts = source.eventFacts.filter(matches);
    const directionOf = (fact: typeof source.eventFacts[number]) => fact.direction ??
      (fact.from !== undefined && fact.to !== undefined ? fact.from > fact.to ? "emission" : "absorption" : undefined);
    const positiveDirections = facts.filter(fact => fact.affirmative).flatMap(fact => directionOf(fact) ? [directionOf(fact)!] : []);
    const actual = emission ? "emission" : "absorption";
    const exclusive = source.eventFacts.filter(fact => fact.affirmative && fact.exclusive);
    if (exclusive.length && !exclusive.some(fact => matches(fact) && (directionOf(fact) === undefined || directionOf(fact) === actual)))
      issues.push(fatal("energy_transition_source_excluded", "An exclusive source event request applies to the full rendered transition set; satisfying one arrow cannot authorize an additional event.", [t.id]));
    // A family name fixes the lower state, not an unspoken event direction:
    // the same lines can occur in emission or absorption. Source directions
    // and captions still constrain the actual independently owned arrow.
    if (positiveDirections.length && !positiveDirections.includes(actual) || facts.some(fact => !fact.affirmative && directionOf(fact) === actual))
      issues.push(fatal("energy_transition_direction_false", "The actual arrow must retain its original scoped event direction and polarity on the independently owned states.", [t.id]));
    const displayedDirections = allCaptions.filter(c => c.owner === t.id)
      .flatMap(c => energyDirectionWords(energyText(c.text)).map(word => word.direction));
    if (displayedDirections.some(direction => direction === "emission" ? !emission : !absorption))
      issues.push(fatal("energy_transition_caption_false", "A displayed emission/absorption caption must agree with the actual directed principal states.", [t.id]));
    if (source.excludedSeries.some(n => exact(lower, n)))
      issues.push(fatal("energy_series_excluded", "The actual lower principal state belongs to a source-excluded series, independently of its caption.", [t.id]));
    if (names.length > 1 || names.some(n => !exact(lower, n) || source.excludedSeries.includes(n) || source.excludedNames.includes(n)))
      issues.push(fatal("energy_series_endpoint_false", "The named spectral series must retain its defining exact lower principal state; a series name, plan assertion or hint cannot relabel another endpoint.", [t.id]));
    t.series = lower.min === lower.max ? [lower.min] : [];
  }
  if (source.transitions && !transitions.length) issues.push(fatal("energy_transition_missing", "The original source requests spectral transitions; levels alone cannot replace their actual directed owners."));
  for (const n of source.series) if (!transitions.some(t => t.series.includes(n))) issues.push(fatal("energy_series_source_missing", `The original source series with lower state n=${n} needs a proved directed transition to that state.`));
  for (const n of source.namedSeries) if (!transitions.some(t => t.series.includes(n) && namedByOwner.get(t.id)?.includes(n)))
    issues.push(fatal("energy_series_name_missing", `The source requests the visible series name ${["Lyman", "Balmer", "Paschen", "Brackett", "Pfund", "Humphreys"][n - 1]} on its proved transition owner.`));
  // An unscoped direction in a legacy line-count calculation describes the
  // count's process. It does not request an illustrative transition arrow.
  const directionRequired = (fact: typeof source.eventFacts[number]) =>
    !ownsLegacySideCaptions || source.transitions || fact.from !== undefined || fact.to !== undefined || fact.series !== undefined;
  for (const fact of source.eventFacts.filter(fact => fact.affirmative && fact.direction && directionRequired(fact))) if (!transitions.some(t =>
    (fact.series === undefined || t.series.includes(fact.series)) && (fact.from === undefined || exact(t.from, fact.from)) &&
    (fact.to === undefined || exact(t.to, fact.to)) && (fact.direction === "emission" ? t.from.min > t.to.max : t.to.min > t.from.max)))
    issues.push(fatal("energy_transition_source_missing", "Every affirmatively requested event direction needs its own correctly owned actual transition."));
  for (const event of source.events) if (!transitions.some(t => exact(t.from, event.from) && exact(t.to, event.to)))
    issues.push(fatal("energy_transition_source_missing", "The original source's ordered initial and final states must retain their actual directed transition."));
  return issues;
}
