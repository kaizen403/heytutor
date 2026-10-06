/**
 * Hydrogenic 1s and 2s curves. ψ, |ψ|² and 4πr²|ψ|² are separate plots.
 * r is in units of a0. The 2s radial node is at r = 2 a0.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, type ChemPlanQuantity } from "./sceneKit";

const FAMILY = "chem_orbital" as const;

/** 1/sqrt(π). */
const PSI_1S = "0.564189583*exp(-x)";
/** 1/π exp(-2r). */
const DENS_1S = "0.318309886*exp(-2*x)";
/** 4 r² exp(-2r). */
const RAD_1S = "4*x^2*exp(-2*x)";
/** 1/sqrt(32π) (2-r) exp(-r/2). The +2.5 lifts this band above the 1s curves. */
const PSI_2S = "0.09973557*(2-x)*exp(-x/2)+2.5";
/** |ψ_2s|² times 10, in the upper band. The factor is display gain; the function stays nonnegative. */
const DENS_2S = "0.09947184*(2-x)^2*exp(-x)+2.5";
/** 4πr²|ψ_2s|² in the upper band. The added 2.5 is the band zero, not part of the function. */
const RAD_2S = "0.125*x^2*(2-x)^2*exp(-x)+2.5";

export function isHydrogenicRadialStem(question: string): boolean {
  const stem = chemStem(question);
  const asksPlot = /psi|ψ|wave ?function|probability density|radial probability/.test(stem);
  const namesOrbital = /1s|2s/.test(stem);
  return asksPlot && namesOrbital;
}

export function buildHydrogenicRadialScene(
  question: string,
  _quantities: ChemPlanQuantity[],
  _schematic: boolean,
): SceneDocument | null {
  if (!isHydrogenicRadialStem(question)) return null;
  const stem = chemStem(question);
  if (/draw the (?:path|trajectory|orbit) of the electron/.test(stem)) return null;
  const want1s = /1s/.test(stem);
  const want2s = /2s/.test(stem);
  if (!want1s && !want2s) return null;

  const c = new ChemScene(question, "hydrogenic psi, density and radial probability", FAMILY);
  const ids: string[] = [];
  if (want1s) {
    ids.push(c.scene.axes("ax1", 0, 5, -0.2, 1.05, "1s radial axis", "r"));
    ids.push(c.scene.curve("psi1", PSI_1S, 0.05, 5, "1s wavefunction", undefined, 65));
    ids.push(c.scene.curve("dens1", DENS_1S, 0.05, 5, "1s probability density", undefined, 65));
    ids.push(c.scene.curve("rad1", RAD_1S, 0.05, 5, "1s radial probability", undefined, 65));
    ids.push(c.text("psi1_l", { x: 6.4, y: 0.85 }, "psi 1s", "wavefunction label"));
    ids.push(c.text("dens1_l", { x: 6.4, y: 0.4 }, "|psi|^2 1s", "density label"));
    ids.push(c.text("rad1_l", { x: 6.4, y: -0.05 }, "radial 1s", "radial probability label"));
  }
  if (want2s) {
    ids.push(c.scene.axes("ax2", 0, 5, 2.2, 3.6, "2s radial axis", "r"));
    ids.push(c.scene.curve("psi2", PSI_2S, 0.05, 5, "2s wavefunction", undefined, 81));
    ids.push(c.scene.curve("dens2", DENS_2S, 0.05, 5, "2s probability density", undefined, 81));
    ids.push(c.scene.curve("rad2", RAD_2S, 0.05, 5, "2s radial probability", undefined, 81));
    ids.push(c.link("zero2", { x: 0, y: 2.5 }, { x: 5, y: 2.5 }, "2s display zero", true));
    ids.push(c.link("node2", { x: 2, y: 2.35 }, { x: 2, y: 3.35 }, "2s radial node", true));
    ids.push(c.text("psi2_l", { x: 6.4, y: 3.35 }, "psi 2s", "wavefunction label"));
    ids.push(c.text("dens2_l", { x: 6.4, y: 2.9 }, "|psi|^2 2s", "density label"));
    ids.push(c.text("rad2_l", { x: 6.4, y: 2.45 }, "radial 2s", "radial probability label"));
    ids.push(c.text("node_l", { x: 2, y: 3.9 }, "node r=2a0", "radial node"));
    ids.push(c.text("sign_l", { x: 6.4, y: 2.05 }, "sign change", "wavefunction sign change"));
    ids.push(c.text("shift_l", { x: 6.4, y: 4.15 }, "lifted +2.5", "display shift, not a function value"));
    ids.push(c.text("gain_l", { x: 6.4, y: 1.55 }, "dens drawn x10", "display gain, not the density value"));
  }
  ids.push(c.text("p0_l", { x: 2.5, y: -0.7 }, "P(0)=0", "radial probability at the origin"));
  ids.push(c.text("path_l", { x: 2.5, y: -1.2 }, "not a path", "not a classical path"));
  ids.push(c.text("norm_l", { x: 2.5, y: -1.7 }, "radial norm 1", "radial normalization"));
  c.scene.group("radial", ids, "psi, probability density and radial probability");
  return c.build({
    caption: "psi may change sign. |psi|^2 is nonnegative. The radial probability 4*pi*r^2*|psi|^2 is zero at r = 0 and is the quantity normalised to 1. The 2s curves are drawn 2.5 units above their own zero line so they do not cover the 1s curves; that shift is not part of the function. The 2s density curve is multiplied by 10 so its shape stays visible. The 2s radial node is r = 2 a0. None of these curves is an electron trajectory.",
  });
}
