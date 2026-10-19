/**
 * Atomic-structure figures for radiation, the Bohr model, matter waves and
 * the uncertainty principle. Numeric results come from declared constants
 * and the read-only Bohr authorities. A missing work function, a nonpositive
 * momentum, an impossible level or a reversed emission draws nothing.
 */
import { chemistryReferenceConstantValid, chemistryPlanBindingsValid, chemistryQuantityCuesValid, readChemistryQuantity, readChemistryQuantityDeclaration } from "./quantityReader";
import { atomicElectronContext } from "./semanticCues";
import type { SceneDocument } from "../types";
import { deriveBohrOrbit } from "../physics/bohrOrbitAuthority";
import { deriveBohrTransition } from "../physics/bohrTransitionAuthority";
import { ChemScene, chemStem, numberAfter, type ChemPlanQuantity } from "./sceneKit";

const ORBITAL_FAMILY = "chem_orbital" as const;

/** Textbook hydrogen ground binding used as the authority's hydrogen_reference. */
const HYDROGEN_BINDING_EV = 13.6;
/** Bohr radius, passed to the orbit authority in nanometres. */
const BOHR_RADIUS_NM = 0.0529;
/** Declared nonrelativistic Bohr ground speed for hydrogen, metres per second. */
const HYDROGEN_GROUND_SPEED_M_PER_S = 2.187e6;
const PLANCK_J_S = 6.62607015e-34;
const LIGHT_M_PER_S = 299792458;
const JOULE_PER_EV = 1.602176634e-19;
const HBAR_J_S = 1.054571817e-34;
const ELECTRON_MASS_KG = 9.109e-31;

/** Sentences the shared energy-level ladder already owns. */
const SHARED_LEVEL_SENTENCE = /draw the energy level diagram|emits a photon during the transition|absorbs a photon during the transition/;

function fit(text: string): string {
  return text;
}

const WORK_FUNCTION_CUE = /work function(?:\s+of\s+(?:(?:a|the)\s+)?[a-z]+)?/;
const PHOTON_ENERGY_CUE = /photon energy|photons? of energy|energy of (?:the )?photons?/;
function workFunctionEv(question: string): number | null {
  const value = numberAfter(question, WORK_FUNCTION_CUE, "energy", "eV");
  return value !== null && value > 0 ? value : null;
}
/** Select original incident-light cue spans. Scalar/unit parsing, duplicate
 * refusal and numeric agreement remain the shared reader's authority. Bare
 * measurements retain the unambiguous photoelectric convention; explicit
 * electron, matter or unrelated owners cannot supply photon authority. */
function photonMeasurementCue(question: string, kind: "frequency" | "wavelength"): RegExp {
  const selected: string[] = [];
  for (const match of question.matchAll(new RegExp(`\\b${kind}\\b`, "gi"))) {
    let end = match.index + match[0].length;
    const clause = question.slice(0, match.index).split(/[;!?]|\.(?!\d)|\b(?:but|however)\b/i).at(-1) ?? "";
    // A closed introductory atomic context does not own a later light
    // measurement. Actual electron predicates and comma-linked quantities do.
    const prefix = clause.replace(/\batomic electron models?\b|^\s*(?:for|in)\s+(?:(?:a|an|the)\s+)?(?:atomic|bound)\s+electrons?\s*,/gi, value => " ".repeat(value.length));
    const owner = [...prefix.matchAll(/\b(?:photons?|light|radiation|electrons?|photoelectrons?|matter(?:\s+waves?)?|de\s+broglie|sound|background|unrelated|irrelevant)\b/gi)].at(-1);
    if (owner && (!/^(?:photons?|light|radiation)$/i.test(owner[0])
      || /\b(?:no|not|without|background|unrelated|irrelevant)(?:\s+(?:mention of|the|incident))*\s*$/i.test(prefix.slice(0, owner.index)))) continue;
    const followingOwner = /^\s+(?:of|for)\s+(?:the\s+)?((?:(?:incident|emitted|released)\s+)?(?:photons?|light|radiation|electrons?|photoelectrons?|matter waves?|sound))\b/i.exec(question.slice(end));
    if (followingOwner) {
      if (!/^(?:incident\s+)?(?:photons?|light|radiation)$/i.test(followingOwner[1]!)) continue;
      end += followingOwner[0].length;
    }
    // Exact raw indices carry source identity into every shared read.
    const cueText = question.slice(match.index, end).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    selected.push(`(?<=^[\\s\\S]{${match.index}})${cueText}`);
  }
  return new RegExp(selected.join("|") || "(?!)", "i");
}
function photonEnergyEv(question: string): number | null {
  const frequencyCue = photonMeasurementCue(question, "frequency");
  const wavelengthCue = photonMeasurementCue(question, "wavelength");
  const stated = readChemistryQuantity({ question, after: PHOTON_ENERGY_CUE, dimension: "energy", targetUnit: "eV" });
  const frequency = readChemistryQuantity({ question, after: frequencyCue, dimension: "frequency", targetUnit: "Hz" });
  const wavelength = readChemistryQuantity({ question, after: wavelengthCue, dimension: "length", targetUnit: "m" });
  // A failed explicit measurement cannot disappear behind another representation.
  for (const read of [stated, frequency, wavelength]) {
    if (read.ok ? !(read.reading.value > 0) : read.code !== "missing") return null;
  }
  const fromFrequency = frequency.ok ? PLANCK_J_S * frequency.reading.value / JOULE_PER_EV : null;
  const fromWavelength = wavelength.ok ? PLANCK_J_S * LIGHT_M_PER_S / wavelength.reading.value / JOULE_PER_EV : null;
  for (const energy of [fromFrequency, fromWavelength]) {
    if (energy !== null && (!Number.isFinite(energy) || !(energy > 0))) return null;
  }
  // The shared reader's canonical conversion and agreement policy certify the
  // independently supplied values; no local tolerance or scalar grammar.
  if (stated.ok) {
    for (const energy of [fromFrequency, fromWavelength]) {
      if (energy !== null && !chemistryReferenceConstantValid(question, PHOTON_ENERGY_CUE, "energy", "eV", energy)) return null;
    }
  }
  if (frequency.ok && wavelength.ok
    && !chemistryReferenceConstantValid(question, frequencyCue, "frequency", "Hz", LIGHT_M_PER_S / wavelength.reading.value)) return null;
  return stated.ok ? stated.reading.value : fromFrequency ?? fromWavelength;
}

function isPhotoelectricStem(question: string): boolean {
  const stem = chemStem(question);
  if (!/(?:photoelectric|photoelectron|work function)/.test(stem)) return false;
  // Routing recognizes the supplied role, including a damaged value; the
  // builder must decline it rather than losing the role to another family.
  const roles = [
    readChemistryQuantity({ question, after: WORK_FUNCTION_CUE, dimension: "energy", targetUnit: "eV" }),
    readChemistryQuantity({ question, after: PHOTON_ENERGY_CUE, dimension: "energy", targetUnit: "eV" }),
  ];
  return roles.some(read => read.ok || read.code !== "missing") || photonEnergyEv(question) !== null;
}

function hydrogenicZ(stem: string): number | null {
  if (/\b(?:helium atom|neutral helium|li atom|lithium atom)\b/.test(stem)) return null;
  if (/li\s*\^?\(?\s*2\s*\+|li2\+/.test(stem)) return 3;
  if (/he\s*\^?\(?\s*\+|he\+/.test(stem)) return 2;
  if (/\bhydrogen\b/.test(stem)) return 1;
  return null;
}

function quantumLevels(stem: string): number[] {
  return [...stem.matchAll(/\bn\s*=\s*(\d+)\b/g)].map((match) => Number(match[1]));
}

function isBohrModelStem(stem: string): boolean {
  if (SHARED_LEVEL_SENTENCE.test(stem)) return false;
  if (!/(?:bohr (?:model|orbit|radius)|spectral lines|number of lines)/.test(stem)) return false;
  return hydrogenicZ(stem) !== null;
}

function isDebroglieStem(stem: string): boolean {
  return /de broglie/.test(stem) && /(?:m\/s|momentum|kg\s*m\/s|wavelength)/.test(stem);
}

function isUncertaintyStem(stem: string): boolean {
  return /(?:heisenberg|uncertainty principle|uncertainty in position|uncertainty in momentum)/.test(stem);
}

export function isAtomicRadiationStem(question: string): boolean {
  const stem = chemStem(question);
  if (SHARED_LEVEL_SENTENCE.test(stem)) return false;
  return isBohrModelStem(stem) || (atomicElectronContext(question)
    && (isPhotoelectricStem(question) || isDebroglieStem(stem) || isUncertaintyStem(stem)));
}

function evText(symbol: string, value: number): string {
  const digits = Math.abs(value) >= 10 ? 1 : 2;
  return fit(`${symbol}=${value.toFixed(digits)} eV`);
}

function buildPhotoelectric(question: string): SceneDocument | null {
  const phi = workFunctionEv(question);
  const energy = photonEnergyEv(question);
  if (phi === null || energy === null) return null;
  const above = energy + 1e-9 >= phi;
  const kinetic = above ? energy - phi : null;
  if (kinetic !== null && kinetic < -1e-9) return null;
  const c = new ChemScene(question, "photoelectric threshold from a stated work function", ORBITAL_FAMILY);
  const ids: string[] = [];
  ids.push(c.level("phi_level", { x: 0, y: 0 }, 2.4, "work function mark"));
  ids.push(c.level("photon_level", { x: 0, y: above ? 1.4 : 0.7 }, 2.4, "photon energy mark"));
  ids.push(c.text("phi_l", { x: 1.55, y: 0 }, evText("phi", phi).slice(0, 16), "work function value"));
  ids.push(c.text("e_l", { x: 1.55, y: above ? 1.4 : 0.7 }, evText("E", energy).slice(0, 16), "photon energy value"));
  ids.push(c.text("units_l", { x: 0, y: 2.15 }, "E = h*nu", "photon energy relation"));
  if (kinetic === null) {
    ids.push(c.text("none_l", { x: 0, y: -0.7 }, "no emission", "below threshold"));
  } else {
    ids.push(c.arrow("k_arrow", { x: -1.5, y: 0 }, { x: -1.5, y: 1.4 }, "kinetic energy above threshold"));
    ids.push(c.text("k_l", { x: -1.5, y: -0.55 }, evText("K", kinetic).slice(0, 16), "maximum kinetic energy"));
  }
  c.scene.group("photoelectric", ids, "work function and photon energy");
  const caption = kinetic === null
    ? `Below threshold: E = ${energy.toFixed(2)} eV is less than phi = ${phi.toFixed(2)} eV, so no electron is emitted and K is not drawn.`
    : `Kmax = h*nu - phi = ${kinetic.toFixed(2)} eV. Units are electronvolts. c = lambda*nu relates wavelength to frequency.`;
  return c.build({ caption });
}

function momentumKgMPerS(question: string): number | null {
  const stated = readChemistryQuantityDeclaration({question,after:/\bmomentum\b/,owner:"particle momentum",dimension:"momentum",targetUnit:"kg m/s",allowAgreeingRepeats:true});
  if (stated.state === "invalid") return null;
  if (stated.state === "valid") return stated.reading.value;
  const speedRead = readChemistryQuantityDeclaration({question,after:/speed|velocity|moving at/,owner:"particle speed",dimension:"speed",targetUnit:"m/s",allowAgreeingRepeats:true});
  if (speedRead.state === "invalid") return null;
  const speed = speedRead.state === "valid" ? speedRead.reading.value : null;
  if (speed === null || !(speed > 0)) return speed;
  if (/\belectron\b/i.test(question)) return ELECTRON_MASS_KG * speed;
  const mass = numberAfter(question, /mass/, "mass", "kg");
  return mass !== null && mass > 0 ? mass * speed : null;
}

function buildDebroglie(question: string, _stem: string): SceneDocument | null {
  const momentum = momentumKgMPerS(question);
  if (momentum === null || !(momentum > 0)) return null;
  const lambdaM = PLANCK_J_S / momentum;
  if (!Number.isFinite(lambdaM) || !(lambdaM > 0)) return null;
  const lambdaNm = lambdaM * 1e9;
  const c = new ChemScene(question, "de Broglie wavelength from a stated momentum", ORBITAL_FAMILY);
  const ids: string[] = [];
  ids.push(c.arrow("wave", { x: -1.6, y: 0 }, { x: 1.6, y: 0 }, "matter wave"));
  ids.push(c.text("rel_l", { x: 0, y: 0.7 }, "lambda = h/p", "de Broglie relation"));
  ids.push(c.text("lam_l", { x: 0, y: -0.7 }, fit(`L=${lambdaNm.toFixed(3)} nm`), "wavelength"));
  ids.push(c.text("unit_l", { x: 0, y: -1.25 }, "h in J s", "planck unit"));
  c.scene.group("matter", ids, "de Broglie wavelength");
  return c.build({ caption: `lambda = h/p = ${lambdaM.toExponential(3)} m for the stated momentum. Zero momentum is not given a finite wavelength.` });
}

function buildUncertainty(question: string, stem: string): SceneDocument | null {
  if (/both .{0,40}exactly|known exactly|simultaneous(?:ly)? exact|exact position and .{0,20}momentum|position and .{0,30}momentum known exactly/.test(stem)) {
    return null;
  }
  const dx = numberAfter(question, /position/, "length", "m");
  const dp = numberAfter(question, /momentum/, "momentum", "kg m/s");
  if (dx === null || dp === null || !(dx > 0) || !(dp > 0)) return null;
  const product = dx * dp;
  const floor = HBAR_J_S / 2;
  const holds = product + 1e-45 >= floor;
  const c = new ChemScene(question, "Heisenberg uncertainty product against hbar/2", ORBITAL_FAMILY);
  const ids: string[] = [];
  ids.push(c.text("dx_l", { x: -1.2, y: 0.4 }, "delta x", "position interval"));
  ids.push(c.text("dp_l", { x: 1.2, y: 0.4 }, "delta p", "momentum interval"));
  ids.push(c.text("rel_l", { x: 0, y: -0.3 }, "dx*dp >= hbar/2", "uncertainty relation"));
  ids.push(c.text("verdict_l", { x: 0, y: -1.0 }, holds ? "above hbar/2" : "below hbar/2", "uncertainty comparison"));
  c.scene.group("uncertainty", ids, "position and momentum intervals");
  return c.build({
    caption: holds
      ? `The stated product ${product.toExponential(2)} J s meets hbar/2 = ${floor.toExponential(2)} J s. The intervals are not exact values.`
      : `The stated product is below hbar/2, so those two intervals cannot both be right.`,
  });
}

function bohrLevels(stem: string): { nFrom: number; nTo: number } | null {
  const fromTo = /from\s+n\s*=\s*(\d+)\s+to\s+n\s*=\s*(\d+)/.exec(stem);
  if (!fromTo) return null;
  const nFrom = Number(fromTo[1]);
  const nTo = Number(fromTo[2]);
  if (nFrom === nTo || nFrom < 1 || nTo < 1 || nFrom > 8 || nTo > 8) return null;
  const emission = /emits|emission|emitted|drops|falls|jumps down/.test(stem);
  const absorption = /absorbs|absorption|absorbed|jumps up/.test(stem);
  if (emission && nFrom < nTo) return null;
  if (absorption && nFrom > nTo) return null;
  return { nFrom, nTo };
}

function buildBohr(question: string, stem: string): SceneDocument | null {
  const Z = hydrogenicZ(stem);
  if (Z === null) return null;
  const lineAsk = /spectral lines|number of lines/.test(stem);
  const levels = quantumLevels(stem).filter((n) => n >= 1 && n <= 8);
  if (levels.some((n) => n < 1) || /\bn\s*=\s*0\b/.test(stem)) return null;
  const transition = bohrLevels(stem);
  const orbitN = levels.length === 1 ? levels[0]! : transition ? null : null;
  if (!lineAsk && !transition && orbitN === null) return null;

  let photonEv: number | null = null;
  let direction: "emission" | "absorption" | null = null;
  if (transition) {
    let authority;
    try {
      authority = deriveBohrTransition({
        model: "bohr_hydrogenic",
        electronCount: 1,
        Z,
        nFrom: transition.nFrom,
        nTo: transition.nTo,
        bindingEnergy: HYDROGEN_BINDING_EV,
        bindingEnergyConvention: "hydrogen_reference",
        energyUnit: "eV",
      });
    } catch {
      return null;
    }
    const expected = HYDROGEN_BINDING_EV * Z * Z * Math.abs(1 / transition.nFrom ** 2 - 1 / transition.nTo ** 2);
    if (Math.abs(authority.photonEnergy - expected) > 1e-6) return null;
    photonEv = authority.photonEnergy;
    direction = authority.direction;
  }

  const radiusN = orbitN ?? (/\bradius\b/.test(stem) ? levels[0] ?? null : null);
  let radiusNm: number | null = null;
  if (radiusN !== null && radiusN !== undefined) {
    let orbit;
    try {
      orbit = deriveBohrOrbit({
        model: "bohr_hydrogenic",
        electronCount: 1,
        Z,
        n: radiusN,
        groundRadius: BOHR_RADIUS_NM,
        radiusUnit: "nm",
        radiusConvention: "hydrogen_reference",
        groundSpeed: HYDROGEN_GROUND_SPEED_M_PER_S,
        speedUnit: "m/s",
        speedConvention: "hydrogen_reference",
      });
    } catch {
      return null;
    }
    const expected = BOHR_RADIUS_NM * radiusN ** 2 / Z;
    if (Math.abs(orbit.radius - expected) > 1e-9) return null;
    radiusNm = orbit.radius;
  }

  const shown = lineAsk
    ? Array.from({ length: Math.max(...levels) }, (_, index) => index + 1)
    : transition
      ? [transition.nFrom, transition.nTo].sort((a, b) => a - b)
      : [orbitN!];
  if (shown.length > 6) return null;

  const c = new ChemScene(question, "Bohr model levels for a one-electron species", ORBITAL_FAMILY);
  const ids: string[] = [];
  const yOf = (n: number): number => (n - 1) * 0.85;
  for (const n of shown) {
    const energy = -HYDROGEN_BINDING_EV * Z * Z / n ** 2;
    ids.push(c.level(`n${n}`, { x: 0, y: yOf(n) }, 2.2, "bohr shell"));
    ids.push(c.text(`n${n}_l`, { x: -1.7, y: yOf(n) }, fit(`n=${n}`), "principal level"));
    ids.push(c.text(`e${n}_l`, { x: 1.7, y: yOf(n) }, evText(`E${n}`, energy), "level energy"));
  }
  if (transition && direction) {
    const fromY = yOf(transition.nFrom);
    const toY = yOf(transition.nTo);
    ids.push(c.arrow("photon", { x: 0.2, y: fromY }, { x: 0.2, y: toY }, direction === "emission" ? "emitted photon" : "absorbed photon"));
    if (photonEv !== null) {
      const nm = (PLANCK_J_S * LIGHT_M_PER_S) / (photonEv * JOULE_PER_EV) * 1e9;
      ids.push(c.text("ph_l", { x: 2.8, y: yOf(transition.nFrom) }, evText("Eph", photonEv), "photon energy"));
      ids.push(c.text("wl_l", { x: 2.8, y: yOf(transition.nTo) }, fit(`L=${nm.toFixed(0)} nm`), "transition wavelength"));
    }
  }
  if (radiusNm !== null && radiusN) {
    ids.push(c.text("r_l", { x: 2.8, y: yOf(radiusN) - 0.4 }, fit(`r${radiusN}=${radiusNm.toFixed(3)} nm`), "bohr radius"));
  }
  if (lineAsk) {
    const upper = Math.max(...levels);
    const lines = (upper * (upper - 1)) / 2;
    ids.push(c.text("lines_l", { x: 2.8, y: yOf(upper) }, fit(`${lines} lines`), "spectral line count"));
  }
  const top = Math.max(...shown.map((n) => yOf(n)));
  ids.push(c.text("model_l", { x: 0, y: top + 0.6 }, "Bohr model", "model name"));
  ids.push(c.text("path_l", { x: 0, y: top + 1.05 }, "not a path", "not an electron trajectory"));
  c.scene.group("bohr", ids, "Bohr model, not an electron trajectory");
  return c.build({
    caption: "Bohr model depiction. Vertical gaps are ordinal. Level energies use E = -13.6 Z^2/n^2 eV and radii use a0 n^2/Z. This is not a quantum electron trajectory.",
  });
}

export function buildAtomicRadiationScene(
  question: string,
  quantities: ChemPlanQuantity[],
  _schematic: boolean,
): SceneDocument | null {
  if (!isAtomicRadiationStem(question) || !chemistryPlanBindingsValid(question, quantities)) return null;
  const stem = chemStem(question);
  if (!chemistryQuantityCuesValid(question, [
    {after: WORK_FUNCTION_CUE, dimensions: ["energy"],owner:"work function"},
    {after: PHOTON_ENERGY_CUE, dimensions: ["energy"],owner:"photon energy"},
    {after: isPhotoelectricStem(question) ? photonMeasurementCue(question, "frequency") : /frequency/, dimensions: ["frequency"],owner:"photon frequency"},
    {after: isPhotoelectricStem(question) ? photonMeasurementCue(question, "wavelength") : /(?:de\s+broglie\s+)?wavelength/, dimensions: ["length"],owner:"wavelength"},
    {after: /\bmomentum\b/, dimensions: ["momentum"],owner:"momentum"},
    {after: /speed|velocity|moving at/, dimensions: ["speed"],owner:"speed"},
    {after: /\bmass\b/, dimensions: ["mass"],owner:"particle mass"},
  ])) return null;
  const hcCue = /\bhc\s*(?:=|is\b)/i;
  if (!chemistryReferenceConstantValid(question, hcCue, "energy_length", "J m", PLANCK_J_S * LIGHT_M_PER_S)) return null;
  if (!chemistryReferenceConstantValid(question, /\bh\s*=|Planck(?:'s)? constant\s*(?:is|=)/i, "action", "J s", PLANCK_J_S)
    || !chemistryReferenceConstantValid(question, /\bc\s*=|speed of light\s*(?:is|=)/i, "speed", "m/s", LIGHT_M_PER_S)) return null;
  if (isPhotoelectricStem(question)) return buildPhotoelectric(question);
  if (isDebroglieStem(stem)) return buildDebroglie(question, stem);
  if (isUncertaintyStem(stem)) return buildUncertainty(question, stem);
  if (isBohrModelStem(stem)) return buildBohr(question, stem);
  return null;
}
