/**
 * Two-center orbital representations from explicit atomic hybridization.
 * The input is a pair of named atoms/orbitals, never a guessed molecule.
 * Angular outlines show lobe asymmetry and orientation schematically, not a radial
 * probability contour or a quantitative overlap integral.
 */
import type { SceneDocument } from "../types";
import { elementBySymbol, ELEMENTS } from "./elements";
import { normalizeChemistryText, complexTokens } from "./formula";
import { ChemScene, type Vec2 } from "./sceneKit";

export interface HybridCenter {
  symbol: string;
  pCount: 1 | 2 | 3;
}

/** Read only explicitly paired hybridization and atom names, without inferring
 * hybridization from a formula, answer option or molecular name. */
export function readHybridCenters(question: string): [HybridCenter, HybridCenter] | null {
  const text = normalizeChemistryText(question).replace(/[²³]/g, digit => digit === "²" ? "^2" : "^3");
  if (complexTokens(question).length || /\b(?:complex|coordination|options?|which of|antibonding)\b/i.test(text)) return null;
  // This small source reader does not interpret negation or rotated orbital
  // systems. Decline those rather than turn a denied bond into an illustration.
  if (/\b(?:no|not|never|without|cannot|nonbonding|nonparallel|antiparallel)\b|n't\b|\bnon[- ]*(?:sp|hybridi)|\bsame atom\b|\b(?:perpendicular|orthogonal)\b/i.test(text)) return null;
  if (!/\bbond(?:s|ing)?\b/i.test(text)) return null;
  // Capture mathematical orbital notation and its directly associated atom.
  // Extra orbital mentions are ambiguous rather than a license to pick two.
  const mentions = [
    ...text.matchAll(/\bsp(?:\s*\^?\s*([23]))?(?![\w^])\s*[- ]?hybridi[sz]ed\s+([A-Za-z]+)(?:\s+atom)?\b/g),
    ...[...text.matchAll(/\b([A-Z][a-z]?)\s*\(\s*sp(?:\s*\^?\s*([23]))?\s*\)/g)]
      .map(match => Object.assign([match[0], match[2], match[1]], { index: match.index })),
  ].sort((a, b) => a.index! - b.index!);
  if (mentions.length !== 2 || [...text.matchAll(/\bsp(?:\^?[23])?\b/g)].length !== 2) return null;
  const centers = mentions.map(match => {
    const token = match[2]!;
    const element = elementBySymbol(token) ?? ELEMENTS.find(candidate => candidate.name.toLowerCase() === token.toLowerCase());
    // This representation does not model d/f mixing or heavy-element bonding.
    if (!element || element.period !== 2 || element.block !== "p") return null;
    return { symbol: element.symbol, pCount: Number(match[1] ?? 1) as 1 | 2 | 3 };
  });
  // sp3 leaves no unhybridized p orbital. A sigma schematic cannot answer
  // an explicit request for pi/side-on overlap involving that center.
  if (centers.some(center => center?.pCount === 3) &&
      /\bpi\b|π|\bside[ -]+on\b/i.test(text)) return null;
  return centers[0] && centers[1] ? [centers[0], centers[1]] : null;
}

/** A polar angular section, with the zero crossings split into simple lobes.
 * Spherical-harmonic angular factors are 1 and sqrt(3) cos(theta). The common
 * radial factor is deliberately not asserted by this qualitative picture. */
function angularLobes(pCount: number | null): Vec2[][] {
  const s = pCount === null ? 0 : 1 / Math.sqrt(1 + pCount);
  const p = pCount === null ? Math.sqrt(3) : Math.sqrt(3 * pCount / (1 + pCount));
  const node = Math.acos(-s / p);
  return [[-node, node], [node, 2 * Math.PI - node]].map(([from, to]) =>
    Array.from({ length: 33 }, (_, index) => {
      const theta = from! + (to! - from!) * index / 32;
      const r = Math.abs(s + p * Math.cos(theta)) / (s + p);
      return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
    }));
}

function drawOrbital(c: ChemScene, prefix: string, center: Vec2, pCount: number | null, angle: number, length: number): string[] {
  return angularLobes(pCount).map((points, index) => {
    const vertices = points.slice(0, -1).map((point, k) => c.scene.helper(`${prefix}_${index}_${k}`, {
      x: center.x + length * (point.x * Math.cos(angle) - point.y * Math.sin(angle)),
      y: center.y + length * (point.x * Math.sin(angle) + point.y * Math.cos(angle)),
    }, "orbital angular outline helper"));
    return c.scene.polygon(`${prefix}_lobe_${index}`, vertices, index === 0 ? "positive phase orbital lobe" : "negative phase orbital lobe");
  });
}

export function buildHybridOverlapScene(question: string): SceneDocument | null {
  const centers = readHybridCenters(question);
  if (!centers) return null;
  const c = new ChemScene(question, "source-stated hybrid orbitals on two bonded atoms", "chem_orbital");
  const canPi = centers.every(center => center.pCount < 3);
  const ids: string[] = [];
  const xs = [-0.8, 0.8];
  centers.forEach((center, index) => {
    const x = xs[index]!;
    ids.push(...drawOrbital(c, `hybrid_${index}`, { x, y: 1.6 }, center.pCount, index === 0 ? 0 : Math.PI, 1.05));
    ids.push(c.scene.point(`sigma_nucleus_${index}`, { x, y: 1.6 }, "atomic nucleus"));
    ids.push(c.text(`hybrid_name_${index}`, { x: index === 0 ? -1.4 : 1.4, y: 2.55 },
      `${center.symbol} sp${center.pCount === 1 ? "" : `^${center.pCount}`}`, "species label"));
    if (canPi) {
      ids.push(...drawOrbital(c, `p_${index}`, { x: x * 0.5, y: -0.9 }, null, Math.PI / 2, 0.95));
      ids.push(c.scene.point(`pi_nucleus_${index}`, { x: x * 0.5, y: -0.9 }, "atomic nucleus"));
    }
  });
  ids.push(c.link("sigma_axis", { x: -1.7, y: 1.6 }, { x: 1.7, y: 1.6 }, "internuclear axis", true));
  ids.push(c.text("sigma_title", { x: 0, y: 0.65 }, "sigma: end-on", "overlap orientation"));
  if (canPi) {
    ids.push(c.link("pi_axis", { x: -1.7, y: -0.9 }, { x: 1.7, y: -0.9 }, "internuclear axis", true));
    ids.push(c.text("pi_title", { x: 0, y: -2.15 }, "possible pi", "conditional overlap orientation"));
    ids.push(c.text("pi_condition", { x: 0, y: -2.6 }, "parallel p only", "overlap condition"));
  }
  ids.push(c.text("scope", { x: 0, y: canPi ? -3.15 : -0.1 }, "not to scale", "representation scope"));
  c.scene.group("hybrid_overlap", ids, "two-center orbital overlap representation");
  return c.build({ caption: "Schematic angular outlines of the stated orbitals. End-on hybrid overlap supports sigma bonding. Parallel unhybridized p orbitals can support pi overlap; actual bond order, molecular geometry and orbital radial sizes are not specified by this representation." });
}
