/**
 * Atomic Structure (chemistry unit 2).
 *
 * Expected energies, wavelengths and occupancies below are written from
 * E = -13.6 Z^2/n^2, lambda = hc/E, lambda = h/p, and the aufbau exceptions.
 * They are not read back out of the Bohr authority.
 */
import { compileSceneDocument } from "../../src/compile/compiler";
import { electronConfiguration } from "../../src/chemistry/electronConfiguration";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";

const failures: string[] = [];
function check(cond: boolean, message: string): void {
  if (!cond) failures.push(message);
}

const H = 6.62607015e-34;
const C = 299792458;
const EV = 1.602176634e-19;
const HBAR = 1.054571817e-34;
const ELECTRON_MASS = 9.109e-31;

function labelsOf(question: string): string[] | null {
  const scene = synthesizeFamilyScene({ question });
  if (!scene) return null;
  check(scene.document.source.chemistryFamily === "chem_orbital", `${question} did not stay on chem_orbital`);
  check(scene.tier === "qualitative_verified", `${question} tier ${scene.tier}`);
  const compiled = compileSceneDocument(scene.document);
  check(compiled.ok && compiled.renderScene !== null, `${question} did not compile`);
  if (!compiled.renderScene) return null;
  const xs = compiled.renderScene.primitives.flatMap((primitive) => primitive.points.map((point) => point.x));
  const ys = compiled.renderScene.primitives.flatMap((primitive) => primitive.points.map((point) => point.y));
  check(xs.length > 0 && xs.every((x) => x >= 400 && x <= 1160) && ys.every((y) => y >= 0 && y <= 700), `${question} left the diagram zone`);
  return compiled.renderScene.primitives.filter((primitive) => primitive.text).map((primitive) => primitive.text!);
}

function has(labels: string[] | null, text: string, message: string): void {
  check(labels !== null && labels.some((label) => label.includes(text)), message);
}

function declined(question: string, message: string): void {
  check(synthesizeFamilyScene({ question }) === null, message);
}

const PHOTO_ABOVE = "In the photoelectric effect the work function of sodium is 2.3 eV. Light of frequency 1.5e15 Hz falls on the metal. Find the maximum kinetic energy.";
const photoEnergy = (H * 1.5e15) / EV;
const photoK = photoEnergy - 2.3;
const photoLabels = labelsOf(PHOTO_ABOVE);
check(photoLabels !== null && !photoLabels.some((label) => label.includes("no emission")), "above-threshold sodium stem must not say no emission");
check(photoLabels !== null && !photoLabels.some((label) => label.startsWith("K=-")), "kinetic energy must not be drawn negative");
has(photoLabels, `K=${photoK.toFixed(2)} eV`.slice(0, 16), `expected K near ${photoK.toFixed(2)} eV`);

const PHOTO_BELOW = "In the photoelectric effect the work function of a metal is 4.0 eV. Photons of energy 2.0 eV are incident. Are electrons emitted?";
const below = labelsOf(PHOTO_BELOW);
has(below, "no emission", "below threshold must say no emission");
check(below !== null && !below.some((label) => label.startsWith("K=")), "below threshold must not draw a kinetic energy");

const waveEv = (H * C) / (400e-9) / EV;
const waveLabels = labelsOf("In the photoelectric effect the work function is 2.0 eV and the light wavelength is 400 nm. Find the maximum kinetic energy.");
has(waveLabels, `E=${waveEv.toFixed(2)} eV`.slice(0, 16), "wavelength uses E = hc/lambda");
has(waveLabels, `K=${(waveEv - 2).toFixed(2)} eV`.slice(0, 16), "wavelength kinetic energy stays above threshold");

declined(
  "In the photoelectric effect, photons of energy 5.0 eV fall on a metal. Find the kinetic energy of the emitted electrons.",
  "a missing work function must not invent one",
);
{
  const explained = synthesizeFamilyScene({ question: "Explain the photoelectric effect and the stopping potential." });
  check(explained?.document.source.chemistryFamily !== "chem_orbital", "the explain-only photoelectric stem stays off the chemistry figure");
}

const BOHR = "Calculate the energy and Bohr radius of the n = 2 orbit of hydrogen. The drawing is the Bohr model, not an electron trajectory.";
const bohr = labelsOf(BOHR);
has(bohr, "E2=-3.40 eV", "n = 2 hydrogen energy");
has(bohr, "r2=0.212 nm", "n = 2 Bohr radius from 0.0529 nm");
has(bohr, "not a path", "Bohr figure must say it is not a trajectory");
has(bohr, "Bohr model", "Bohr figure must name the model");

const LINES = "How many spectral lines are emitted when a hydrogen electron falls from n = 4 to lower levels in the Bohr model?";
has(labelsOf(LINES), "6 lines", "n = 4 produces n(n-1)/2 = 6 lines");

const HE = "In the Bohr model an electron in He+ drops from n = 2 to n = 1. Find the photon energy. This is not an electron path.";
const hePhoton = 13.6 * 4 * (1 - 1 / 4);
const heNm = (H * C) / (hePhoton * EV) * 1e9;
const he = labelsOf(HE);
has(he, "Eph=40.8 eV", `He+ photon ${hePhoton}`);
has(he, `L=${heNm.toFixed(0)} nm`, "He+ wavelength from hc/E");
has(he, "not a path", "He+ transition is not a trajectory");

declined(
  "In the Bohr model the emission from n = 1 to n = 3 in hydrogen emits a photon.",
  "reversed emission must not be drawn",
);
declined(
  "Calculate the Bohr radius of the n = 2 orbit of a helium atom.",
  "a two-electron helium atom is not a Bohr hydrogenic model",
);
{
  const shared = synthesizeFamilyScene({
    question: "A hydrogen atom emits a photon during the transition from n=3 to n=2. Draw the energy level diagram.",
    families: ["energy_level"],
  });
  check(shared !== null && shared.document.source.chemistryFamily !== "chem_orbital", "the shared hydrogen transition keeps the existing ladder");
  check(shared?.document.entities.some((entity) => entity.label === "n=3") === true, "shared ladder still names n=3");
}

const speed = 2.0e6;
const lambdaNm = (H / (ELECTRON_MASS * speed)) * 1e9;
const wave = labelsOf("Find the de Broglie wavelength of an electron moving at 2.0e6 m/s.");
has(wave, `L=${lambdaNm.toFixed(3)} nm`, "electron wavelength h/p");
has(wave, "lambda = h/p", "de Broglie relation");
declined("Find the de Broglie wavelength of an electron with momentum 0 kg m/s.", "zero momentum has no finite wavelength");
declined(
  "Heisenberg's uncertainty principle says an electron has both its position and its momentum known exactly.",
  "exact position and momentum together are not drawn",
);

const dx = 1e-10;
const dp = 1e-24;
const uncertain = labelsOf("The Heisenberg uncertainty in position is 1e-10 m and the uncertainty in momentum is 1e-24 kg m/s.");
has(uncertain, dx * dp >= HBAR / 2 ? "above hbar/2" : "below hbar/2", "uncertainty comparison against hbar/2");

const RADIAL = "Plot psi, |psi|^2 and the radial probability 4*pi*r^2*|psi|^2 versus r for the hydrogen 1s and 2s wavefunctions.";
const radial = labelsOf(RADIAL);
has(radial, "psi 1s", "1s wavefunction");
has(radial, "|psi|^2 1s", "1s density");
has(radial, "radial 1s", "1s radial probability");
has(radial, "psi 2s", "2s wavefunction");
has(radial, "node r=2a0", "2s radial node");
has(radial, "P(0)=0", "radial probability vanishes at the origin");
has(radial, "not a path", "wavefunction plot is not a trajectory");
has(radial, "sign change", "2s wavefunction changes sign");
has(radial, "lifted +2.5", "2s vertical offset is written on the figure");
has(radial, "dens drawn x10", "2s density display gain is written on the figure");
declined(
  "Draw the path of the electron in the 1s orbital and plot psi along that path.",
  "a classical electron path is not a wavefunction plot",
);

const SHAPE = "How many radial and angular nodes does a 3p orbital have? Sketch its shape and mark the phase, which is not a charge.";
const shape = labelsOf(SHAPE);
has(shape, "3p", "3p orbital");
has(shape, "phase not charge", "orbital phase is not charge");
has(shape, "radial nodes: 1", "3p has n-l-1 = 1 radial node");

declined(
  "Which set is allowed: n = 2, l = 2, m_l = 0, m_s = +1/2? Draw the orbital.",
  "l = n is impossible",
);
declined(
  "Draw the subshell for n = 2, l = 1, m_l = 2 and m_s = +1/2.",
  "m_l outside -l..l is impossible",
);
declined(
  "Two electrons in one 2p orbital have the same spin. Draw the box.",
  "identical spins in one orbital are rejected",
);

const HAND: Record<string, { condensed: string; unpaired: number }> = {
  Cr: { condensed: "[Ar] 3d5 4s1", unpaired: 6 },
  Cu: { condensed: "[Ar] 3d10 4s1", unpaired: 1 },
  "Fe2+": { condensed: "[Ar] 3d6", unpaired: 4 },
  "Fe3+": { condensed: "[Ar] 3d5", unpaired: 5 },
};
for (const [symbol, charge, key] of [["Cr", 0, "Cr"], ["Cu", 0, "Cu"], ["Fe", 2, "Fe2+"], ["Fe", 3, "Fe3+"]] as const) {
  const configuration = electronConfiguration(symbol, charge);
  const expected = HAND[key]!;
  check(configuration?.condensed === expected.condensed, `${key} configuration ${configuration?.condensed}`);
  check(configuration?.unpairedElectrons === expected.unpaired, `${key} unpaired ${configuration?.unpairedElectrons}`);
  check((configuration?.electrons ?? -1) === ({ Cr: 24, Cu: 29, "Fe2+": 24, "Fe3+": 23 }[key]!), `${key} electron count`);
}

const boxes = labelsOf("Draw the orbital diagram of Fe^(3+) and calculate its spin only magnetic moment.");
has(boxes, "Fe^(3+)", "Fe3+ box diagram");
has(boxes, "3d^5", "Fe3+ is 3d5 after 4s is removed");
has(boxes, "5 unpaired", "Fe3+ has five unpaired electrons");

const chromium = labelsOf("Write the electronic configuration of chromium (Z = 24) and state the number of unpaired electrons in it.");
has(chromium, "3d^5 4s^1", "chromium exception");
has(chromium, "6 unpaired", "chromium has six unpaired electrons");

const copper = labelsOf("The electronic configuration of Cu is [Ar] 3d10 4s1. Draw its box diagram.");
has(copper, "3d^10 4s^1", "copper exception");
check(copper !== null && !copper.some((label) => label.includes("3d^9")), "copper must not be drawn as 3d9 4s2");

const ladder = labelsOf("How many orbitals are there in the shell with n = 3, and what is the maximum number of electrons it can hold?");
has(ladder, "3s", "n = 3 includes 3s");
has(ladder, "3p", "n = 3 includes 3p");
has(ladder, "3d", "n = 3 includes 3d");
has(ladder, "9 orbitals", "n^2 = 9");
has(ladder, "18 electrons", "2n^2 = 18");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("C-02 atomic structure: all checks passed");

void (null as SceneDocument | null);
