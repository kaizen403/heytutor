/** Source computation shared by chemistry routing and the physics family.
 * A damaged declaration is terminal; it is never an absent display default. */
import { SceneBuilder, compact, type Vec2 } from "../archetypes/document";
import { chemStem } from "../chemistry/sceneKit";
import {
  chemistryCanonicalValuesAgree, chemistryReferenceConstantValid,
  readChemistryQuantityDeclaration, type ChemistryDimension, type ChemistryReading, type ChemistryUnit,
} from "../chemistry/quantityReader";
import type { SceneDocument } from "../types";

const H = 6.62607015e-34;
const C = 299792458;
const EV = 1.602176634e-19;
const HBAR = 1.054571817e-34;
const ELECTRON_MASS = 9.109e-31;
const WORK = /work function(?:\s+of\s+(?:(?:a|the)\s+)?[a-z]+)?/;
const PHOTON = /photon energy|photons? of energy|energy of (?:the )?photons?/;
type Kind = "photoelectric" | "matter_wave" | "uncertainty";
interface Binding { role: string; reading: ChemistryReading }
interface Source { question: string; bindings: Binding[] }
export type RadiationModel = Source & (
  | { kind: "photoelectric"; workFunctionEV: number; photonEnergyEV: number; kineticEV: number | null }
  | { kind: "matter_wave"; momentumKgMS: number; wavelengthM: number; statedMomentum: boolean; statedSpeedMS: number | null; statedMassKg: number | null; nominalMomentumFromSpeed: number | null }
  | { kind: "uncertainty"; positionM: number; momentumKgMS: number; productJS: number; floorJS: number; holds: boolean }
);
export type RadiationSourceOutcome = { status: "not_applicable" }
  | { status: "declined"; kind: Kind; reason: string }
  | { status: "source"; model: RadiationModel };

/** A positively owned following argument is stronger than a previous noun.
 * Every selected cue retains its complete original span for the shared reader. */
function incidentCue(question: string, kind: "frequency" | "wavelength"): RegExp {
  const selected: string[] = [];
  for (const match of question.matchAll(new RegExp(`\\b${kind}\\b`, "gi"))) {
    let end = match.index + match[0].length;
    const following = /^\s+(?:of|for)\s+(?:the\s+)?((?:(?:incident|emitted|released)\s+)?(?:photons?|light|radiation|electrons?|photoelectrons?|matter waves?|sound))\b/i.exec(question.slice(end));
    if (following) {
      if (!/^(?:incident\s+)?(?:photons?|light|radiation)$/i.test(following[1]!)) continue;
      end += following[0].length;
    } else {
      const clause = question.slice(0, match.index).split(/[;!?]|\.(?!\d)|\b(?:but|however)\b/i).at(-1) ?? "";
      const prefix = clause.replace(/\batomic electron models?\b|^\s*(?:for|in)\s+(?:(?:a|an|the)\s+)?(?:atomic|bound)\s+electrons?\s*,/gi, value => " ".repeat(value.length));
      const owner = [...prefix.matchAll(/\b(?:photons?|light|radiation|electrons?|photoelectrons?|matter(?:\s+waves?)?|de\s+broglie|sound|background|unrelated|irrelevant)\b/gi)].at(-1);
      if (owner && (!/^(?:photons?|light|radiation)$/i.test(owner[0])
        || /\b(?:no|not|without|background|unrelated|irrelevant)(?:\s+(?:mention of|the|incident))*\s*$/i.test(prefix.slice(0, owner.index)))) continue;
    }
    const text = question.slice(match.index, end).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    selected.push(`(?<=^[\\s\\S]{${match.index}})${text}`);
  }
  return new RegExp(selected.join("|") || "(?!)", "i");
}

interface RequestArgument { start: number; end: number; positive: boolean }
/** One bounded request grammar for source applicability and source preference.
 * Each verb owns its argument; coordinated exclusion owns only its conjunct. */
function requestArguments(question: string): RequestArgument[] {
  const verbs = [...question.matchAll(/\b(?:draw|sketch|show|represent|plot|find|calculate|determine|evaluate|compute|explain)\b/gi)];
  const arguments_: RequestArgument[] = [];
  for (const [index, verb] of verbs.entries()) {
    const start = verb.index + verb[0].length;
    const tail = question.slice(start, verbs[index + 1]?.index ?? question.length);
    const boundary = /[;!?]|\.(?!\d)/.exec(tail);
    const end = start + (boundary?.index ?? tail.length);
    const prefix = question.slice(0, verb.index).split(/[;!?]|\.(?!\d)/).at(-1) ?? "";
    const positive = !/\b(?:not|never|without)\s*$/i.test(prefix);
    const argument = question.slice(start, end);
    let from = 0;
    for (const join of [...argument.matchAll(/\b(?:and|but|or|however)\b/gi), { index: argument.length, 0: "" }]) {
      const to = join.index!;
      if (to > from) arguments_.push({ start: start + from, end: start + to,
        positive: positive && !/^\s*(?:not|no|never|without)\b/i.test(argument.slice(from, to)) });
      from = to + join[0]!.length;
    }
  }
  return arguments_;
}

/** A complete numeric state gets selection priority only for a requested
 * photoelectric result/view, never a negated/background argument. */
export function requestedPhotoelectricResult(question: string): boolean {
  return requestArguments(question).some(argument => argument.positive
    && /\b(?:photoelectric|photo-electric)\s+(?:effect|energy|diagram|levels?|balance|emission)|\b(?:maximum\s+)?photoelectrons?\s+(?:kinetic\s+)?energy|\b(?:energy|kinetic energy)\s+of\s+(?:the\s+)?(?:emitted\s+)?photoelectrons?\b|\bstopping potential\b/i
      .test(question.slice(argument.start, argument.end)));
}

/** Apparatus material data do not claim an irradiated photoelectric target.
 * The exemption belongs to that positive noun-phrase role, not another topic. */
function backgroundWorkFunctionOnly(question: string): boolean {
  const declarations = [...question.matchAll(/\bwork function\b/gi)];
  if (!declarations.length || declarations.some(declaration => !/\b(?:source\s+)?(?:lamp|laser)(?:\s+cathode)?\s+(?:has|with|of)\s+(?:a\s+)?$/i
    .test(question.slice(0, declaration.index)))) return false;
  const arguments_ = requestArguments(question);
  for (const mention of question.matchAll(/\bphotoelectric|\bphotoelectrons?|\bstopping potential/gi)) {
    const owner = arguments_.find(argument => mention.index >= argument.start && mention.index < argument.end);
    if (owner) { if (owner.positive) return false; continue; }
    const prefix = question.slice(0, mention.index).split(/[;!?]|\.(?!\d)|\b(?:and|but|or|however)\b/i).at(-1) ?? "";
    if (!/\b(?:not|no|never|without)\s+(?:(?:a|an|the)\s+)?$/i.test(prefix)) return false;
  }
  const activeTarget = /\b(?:photons?|light|radiation)\b[^.;!?]*\b(?:incident on|falls? on|illuminates?)\b[^.;!?]*\b(?:metal|surface|cathode|lamp)\b/i.test(question);
  const passiveTarget = /\b(?:metal|surface|cathode|lamp)\b[^.;!?]*\b(?:is|are|was|were|being)\s+(?:illuminated|irradiated)\b/i.test(question);
  return !activeTarget && !passiveTarget;
}

/** The exact original source is the only input; callers cannot supply scalars. */
export function readRadiationSource(question: string): RadiationSourceOutcome {
  const stem = chemStem(question);
  const kind: Kind | null = /photoelectric|photoelectron|work function/.test(stem) ? "photoelectric"
    : /de broglie/.test(stem) ? "matter_wave"
      : /heisenberg|uncertainty principle|uncertainty in position|uncertainty in momentum/.test(stem) ? "uncertainty" : null;
  if (!kind || kind === "photoelectric" && backgroundWorkFunctionOnly(question)) return { status: "not_applicable" };
  const bindings: Binding[] = [];
  let invalid = false;
  const value = (after: RegExp, dimension: ChemistryDimension, unit: ChemistryUnit, role: string,
    allowAgreeingRepeats = false): number | null => {
    const result = readChemistryQuantityDeclaration({ question, after, dimension, targetUnit: unit, owner: role, allowAgreeingRepeats });
    if (result.state === "invalid") { invalid = true; return null; }
    if (result.state === "absent") return null;
    bindings.push({ role, reading: result.reading });
    return result.reading.value;
  };
  const decline = (reason: string): RadiationSourceOutcome => ({ status: "declined", kind, reason });
  const work = kind === "photoelectric" ? value(WORK, "energy", "eV", "work function") : null;
  const stated = kind === "photoelectric" ? value(PHOTON, "energy", "eV", "photon energy") : null;
  const frequency = kind === "photoelectric" ? value(incidentCue(question, "frequency"), "frequency", "Hz", "incident photon frequency") : null;
  const wavelength = kind === "photoelectric" ? value(incidentCue(question, "wavelength"), "length", "m", "incident photon wavelength") : null;
  const hCue = /\bh\s*=|Planck(?:'s)? constant\s*(?:is|=)/i;
  const cCue = /\bc\s*=|speed of light\s*(?:is|=)/i;
  const hcCue = /\bhc\s*(?:=|is\b)/i;
  const hGiven = value(hCue, "action", "J s", "Planck constant");
  const cGiven = value(cCue, "speed", "m/s", "speed of light");
  const hcGiven = value(hcCue, "energy_length", "J m", "photon wavelength constant");
  if (invalid) return decline("supplied radiation quantity is unreadable or conflicting");
  let h = hGiven ?? H, c = cGiven ?? C;
  if (!(h > 0 && c > 0) || hcGiven !== null && !(hcGiven > 0)) return decline("nonpositive radiation constant");
  // A supplied product and one factor determine the other factor. They cannot
  // coexist with an independent reference default that violates that product.
  if (hcGiven !== null) {
    if (hGiven !== null && cGiven !== null) {
      if (!chemistryCanonicalValuesAgree(h * c, hcGiven)) return decline("source constants disagree");
    } else if (hGiven !== null) c = hcGiven / h;
    else h = hcGiven / c;
  }
  if (![h, c].every(n => Number.isFinite(n) && n > 0)) return decline("nonfinite radiation constants");
  // Only genuinely absent scalar declarations retain the qualitative path.
  // All explicit constant declarations have already been inventoried above.
  if (kind === "photoelectric" && [work, stated, frequency, wavelength].every(n => n === null)) return { status: "not_applicable" };
  if (kind === "photoelectric") {
    if (work === null || !(work > 0)) return decline("source work function is required");
    const energies = [stated, frequency === null ? null : h * frequency / EV,
      wavelength === null ? null : (hcGiven ?? h * c) / wavelength / EV].filter((n): n is number => n !== null);
    if (energies.length === 0 || energies.some(n => !Number.isFinite(n) || !(n > 0))
      || frequency !== null && !(frequency > 0) || wavelength !== null && !(wavelength > 0)) return decline("source incident photon is required");
    if (energies.some(n => !chemistryCanonicalValuesAgree(n, energies[0]!))) return decline("independent photon measurements disagree");
    const energy = energies[0]!;
    return { status: "source", model: { question, bindings, kind, workFunctionEV: work, photonEnergyEV: energy,
      kineticEV: energy + 1e-9 >= work ? Math.max(0, energy - work) : null } };
  }
  // The old fixed-reference matter-wave/uncertainty contract is preserved;
  // no formerly unsupported rounded-constant species is silently admitted.
  if (!chemistryReferenceConstantValid(question, hCue, "action", "J s", H)
    || !chemistryReferenceConstantValid(question, cCue, "speed", "m/s", C)
    || !chemistryReferenceConstantValid(question, hcCue, "energy_length", "J m", H * C)) return decline("unsupported fixed-reference constant");
  const momentum = value(/\bmomentum\b/, "momentum", "kg m/s", "particle momentum", true);
  if (kind === "matter_wave") {
    const speed = value(/speed|velocity|moving at/, "speed", "m/s", "particle speed", true);
    const mass = value(/\bmass\b/, "mass", "kg", "particle mass");
    if (invalid || momentum !== null && !(momentum > 0) || speed !== null && !(speed > 0) || mass !== null && !(mass > 0)) return decline("invalid matter-wave source");
    const p = momentum ?? (speed !== null ? speed * (mass ?? (/\belectron\b/.test(stem) ? ELECTRON_MASS : NaN)) : NaN);
    const lambda = h / p;
    if (!(p > 0) || !Number.isFinite(lambda) || !(lambda > 0)) return decline("complete matter-wave state is required");
    return { status: "source", model: { question, bindings, kind, momentumKgMS: p, wavelengthM: lambda,
      statedMomentum: momentum !== null, statedSpeedMS: speed, statedMassKg: mass,
      nominalMomentumFromSpeed: speed !== null && (mass !== null || /\belectron\b/.test(stem))
        ? speed * (mass ?? ELECTRON_MASS) : null } };
  }
  const position = value(/position/, "length", "m", "position uncertainty");
  if (invalid || position === null || momentum === null || !(position > 0 && momentum > 0)
    || /both .{0,40}exactly|known exactly|simultaneous(?:ly)? exact|exact position and .{0,20}momentum|position and .{0,30}momentum known exactly/.test(stem)) return decline("complete uncertainty intervals are required");
  const product = position * momentum, floor = HBAR / 2;
  if (!Number.isFinite(product) || !(product > 0)) return decline("nonfinite uncertainty product");
  return { status: "source", model: { question, bindings, kind, positionM: position, momentumKgMS: momentum,
    productJS: product, floorJS: floor, holds: product + 1e-45 >= floor } };
}

function label(scene: SceneBuilder, id: string, at: Vec2, text: string, role: string, preserveText = false): string {
  const anchor = scene.helper(`${id}_p`, at, `${role} anchor helper`);
  const visible = preserveText ? text : compact(text);
  scene.entities.push({ id, kind: "label", role, label: visible, provenance: { pinLabel: true } });
  scene.constructions.push({ id: `make_${id}`, operator: "label", inputs: { target: anchor, text: visible }, outputs: [id] });
  return id;
}

/** Shared deterministic constructions; the issuer owns its actual provenance. */
export function populateParticleRadiation(scene: SceneBuilder, model: Exclude<RadiationModel, { kind: "photoelectric" }>): string {
  const ids: string[] = [];
  if (model.kind === "matter_wave") {
    const conditioned = model.statedMomentum && model.statedSpeedMS !== null;
    const tail = scene.helper("wave_t", { x: -1.6, y: 0 }, "arrow tail helper");
    const head = scene.helper("wave_h", { x: 1.6, y: 0 }, "arrow head helper");
    ids.push(scene.vector("wave", tail, { end: head }, "matter wave", conditioned ? "using stated p" : undefined));
    ids.push(label(scene, "rel_l", { x: 0, y: 0.7 }, "lambda = h/p", "de Broglie relation"));
    ids.push(label(scene, "lam_l", { x: 0, y: -0.7 }, `L=${(model.wavelengthM * 1e9).toFixed(3)} nm`, "wavelength"));
    ids.push(label(scene, "unit_l", { x: 0, y: -1.25 }, "h in J s", "planck unit"));
    let cue = "de Broglie wavelength";
    if (conditioned) {
      const number = (value: number): string => value.toExponential(2).replace("e+", "e");
      const pText = `p=${number(model.momentumKgMS)}`, vText = `v=${number(model.statedSpeedMS!)} m/s`;
      const note = model.nominalMomentumFromSpeed !== null && !chemistryCanonicalValuesAgree(model.nominalMomentumFromSpeed, model.momentumKgMS)
        ? model.statedMassKg === null ? "nominal p!=m_e*v" : "nominal p!=m*v" : "p and v stated";
      ids.push(label(scene, "given_p", { x: -1.6, y: 1.5 }, pText, "stated momentum", true));
      ids.push(label(scene, "given_v", { x: 1.6, y: 1.5 }, vText, "stated speed", true));
      ids.push(label(scene, "momentum_basis", { x: 0, y: -2 }, note, "conditional momentum basis", true));
      ids.push(label(scene, "momentum_unit", { x: -1.6, y: 2.1 }, "p in kg m/s", "momentum unit", true));
      let massText = "";
      if (model.statedMassKg !== null) {
        massText = `m=${number(model.statedMassKg)} kg`;
        ids.push(label(scene, "given_m", { x: 0, y: 2.1 }, massText, "stated mass", true));
      }
      cue = `${note}. ${pText}. ${vText}. ${massText}. using stated p. de Broglie wavelength.`;
    }
    scene.group("matter", ids, cue);
    return `lambda = h/p = ${model.wavelengthM.toExponential(3)} m for the stated momentum. ${conditioned ? "The stated speed is shown separately; the wavelength uses supplied p, without an exact p=m*v agreement claim. " : ""}Zero momentum is not given a finite wavelength.`;
  }
  ids.push(label(scene, "dx_l", { x: -1.2, y: 0.4 }, "delta x", "position interval"));
  ids.push(label(scene, "dp_l", { x: 1.2, y: 0.4 }, "delta p", "momentum interval"));
  ids.push(label(scene, "rel_l", { x: 0, y: -0.3 }, "dx*dp >= hbar/2", "uncertainty relation"));
  ids.push(label(scene, "verdict_l", { x: 0, y: -1.0 }, model.holds ? "above hbar/2" : "below hbar/2", "uncertainty comparison"));
  scene.group("uncertainty", ids, "position and momentum intervals");
  return model.holds
    ? `The stated product ${model.productJS.toExponential(2)} J s meets hbar/2 = ${model.floorJS.toExponential(2)} J s. The intervals are not exact values.`
    : "The stated product is below hbar/2, so those two intervals cannot both be right.";
}

/** A source-neutral family issuer, not a relabelled chemistry document. */
export function buildParticleRadiationScene(question: string): SceneDocument | null {
  const source = readRadiationSource(question);
  if (source.status !== "source" || source.model.question !== question || source.model.kind === "photoelectric") return null;
  const model = source.model;
  const reason = model.kind === "matter_wave" ? "de Broglie wavelength from a stated momentum" : "Heisenberg uncertainty product against hbar/2";
  const scene = new SceneBuilder(question, reason, "energy_level");
  const caption = populateParticleRadiation(scene, model);
  const document = scene.build();
  document.source = { question, synthesizedFamily: true, sourceModel: "particle_radiation", radiationKind: model.kind,
    sourceReadings: model.bindings };
  document.quantities.push(
    { id: "p", symbol: "p", value: model.momentumKgMS, unit: "kg m/s" },
    ...(model.kind === "matter_wave"
      ? [{ id: "lambda", symbol: "lambda", value: model.wavelengthM, unit: "m" }]
      : [{ id: "dx", symbol: "delta x", value: model.positionM, unit: "m" },
        { id: "product", symbol: "delta x delta p", value: model.productJS, unit: "J s" },
        { id: "floor", symbol: "hbar/2", value: model.floorJS, unit: "J s" }]),
  );
  if (model.kind === "matter_wave" && model.statedSpeedMS !== null) {
    document.quantities.push({ id: "v", symbol: "v", value: model.statedSpeedMS, unit: "m/s" });
    if (model.statedMassKg !== null) document.quantities.push({ id: "m", symbol: "m", value: model.statedMassKg, unit: "kg" });
  }
  document.annotations.push({ id: "figure_caption", kind: "callout", targetIds: [], text: caption });
  return document;
}
