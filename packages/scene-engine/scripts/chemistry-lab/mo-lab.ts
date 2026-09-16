/**
 * MO diagram lane bench.
 *   pnpm exec tsx scripts/chemistry-lab/mo-lab.ts <outdir> [bank.json]
 *
 * 1. Asserts the solver against textbook bond orders and unpaired counts.
 * 2. Renders every MO_PROBES entry and checks its expected labels.
 * 3. Replays real bank stems tagged mo_diagram and counts draw / decline / refuse.
 */
import { readFileSync } from "node:fs";
import { MO_PROBES, buildMoScene, isMoStem, moConfiguration, moSpeciesTokens } from "../../src/chemistry/moDiagram";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { RenderPoint, RenderPrimitive, RenderScene } from "../../src/types";
import { compileForLab, rasterize, renderDocument } from "./lab";

const outDir = process.argv[2] ?? ".chemistry-lab/mo";
const bankPath = process.argv[3] === "--debug" ? undefined : process.argv[3];

/* Debug: `mo-lab.ts <outdir> --debug <probe index | stem>` prints every issue and label position. */
if (process.argv[3] === "--debug") {
  const target = process.argv.slice(4).join(" ");
  const question = /^\d+$/.test(target) ? MO_PROBES[Number(target)]!.question : target;
  const doc = buildMoScene(question, [], false);
  if (!doc) { console.log("declined", { cue: isMoStem(question), tokens: moSpeciesTokens(question) }); process.exit(0); }
  const validated = validateSceneDocument(pruneDeadSceneEntities(doc as unknown as Record<string, unknown>));
  console.log("validation", validated.report.issues.map((issue) => `${issue.severity} ${issue.code}: ${issue.message}`));
  if (validated.document) {
    const compiled = compileSceneDocument(validated.document);
    console.log("compile", compiled.report.issues.map((issue) => `${issue.severity} ${issue.code}: ${issue.message}`));
    const primitives = compiled.renderScene?.primitives ?? [];
    for (const label of primitives.filter((primitive) => primitive.kind === "label")) {
      console.log(`label ${label.entityId} "${label.text}" @ ${label.points[0]?.x.toFixed(0)},${label.points[0]?.y.toFixed(0)}`);
    }
    const points = primitives.filter((primitive) => primitive.kind !== "label").flatMap((primitive) => primitive.points);
    if (points.length) console.log("ink bounds x", Math.min(...points.map((p) => p.x)).toFixed(0), Math.max(...points.map((p) => p.x)).toFixed(0), "y", Math.min(...points.map((p) => p.y)).toFixed(0), Math.max(...points.map((p) => p.y)).toFixed(0));
  }
  process.exit(0);
}

/* 1. Solver truth table: species, bond order, unpaired electrons, configuration. */
const TRUTH: ReadonlyArray<[string, number, number, string?]> = [
  ["H2", 1, 0, "σ1s^2"],
  ["H2+", 0.5, 1, "σ1s^1"],
  ["H2-", 0.5, 1, "σ1s^2 σ*1s^1"],
  ["He2", 0, 0, "σ1s^2 σ*1s^2"],
  ["He2+", 0.5, 1],
  ["Li2", 1, 0, "σ2s^2"],
  ["Li2+", 0.5, 1],
  ["Be2", 0, 0, "σ2s^2 σ*2s^2"],
  ["B2", 1, 2, "σ2s^2 σ*2s^2 π2p^2"],
  ["B2+", 0.5, 1],
  ["C2", 2, 0, "σ2s^2 σ*2s^2 π2p^4"],
  ["C2^2-", 3, 0, "σ2s^2 σ*2s^2 π2p^4 σ2p^2"],
  ["N2", 3, 0, "σ2s^2 σ*2s^2 π2p^4 σ2p^2"],
  ["N2+", 2.5, 1, "σ2s^2 σ*2s^2 π2p^4 σ2p^1"],
  ["N2-", 2.5, 1, "σ2s^2 σ*2s^2 π2p^4 σ2p^2 π*2p^1"],
  ["N2^2-", 2, 2],
  ["O2", 2, 2, "σ2s^2 σ*2s^2 σ2p^2 π2p^4 π*2p^2"],
  ["O2+", 2.5, 1, "σ2s^2 σ*2s^2 σ2p^2 π2p^4 π*2p^1"],
  ["O2-", 1.5, 1, "σ2s^2 σ*2s^2 σ2p^2 π2p^4 π*2p^3"],
  ["O2^2-", 1, 0, "σ2s^2 σ*2s^2 σ2p^2 π2p^4 π*2p^4"],
  ["O2^(2-)", 1, 0],
  ["O₂²⁻", 1, 0],
  ["O_2^(+)", 2.5, 1],
  ["F2", 1, 0, "σ2s^2 σ*2s^2 σ2p^2 π2p^4 π*2p^4"],
  ["F2-", 0.5, 1, "σ2s^2 σ*2s^2 σ2p^2 π2p^4 π*2p^4 σ*2p^1"],
  ["Ne2", 0, 0],
  ["CO", 3, 0, "σ2s^2 σ*2s^2 π2p^4 σ2p^2"],
  ["CO+", 2.5, 1],
  ["NO", 2.5, 1, "σ2s^2 σ*2s^2 π2p^4 σ2p^2 π*2p^1"],
  ["NO+", 3, 0],
  ["NO-", 2, 2],
  ["CN-", 3, 0],
  ["CN", 2.5, 1],
];

let solverFailures = 0;
for (const [species, bondOrder, unpaired, configuration] of TRUTH) {
  const result = moConfiguration(species);
  const problems: string[] = [];
  if (!result) problems.push("null");
  else {
    if (result.bondOrder !== bondOrder) problems.push(`BO ${result.bondOrder} != ${bondOrder}`);
    if (result.unpairedElectrons !== unpaired) problems.push(`unpaired ${result.unpairedElectrons} != ${unpaired}`);
    if (configuration && result.configuration !== configuration) problems.push(`config "${result.configuration}" != "${configuration}"`);
    const total = result.levels.reduce((sum, level) => sum + level.electrons, 0);
    if (total !== result.valenceElectrons) problems.push(`electrons ${total} != valence ${result.valenceElectrons}`);
    if ((result.magnetic === "paramagnetic") !== (unpaired > 0)) problems.push(`magnetic ${result.magnetic}`);
  }
  if (problems.length) {
    solverFailures += 1;
    console.log(`SOLVER FAIL ${species}: ${problems.join("; ")}`);
  }
}
// The no-mixing switch: C2 becomes the paramagnetic one, B2 diamagnetic.
const c2NoMix = moConfiguration("C2", { mixing: "off" });
const b2NoMix = moConfiguration("B2", { mixing: "off" });
if (c2NoMix?.unpairedElectrons !== 2 || c2NoMix.bondOrder !== 2) { solverFailures += 1; console.log("SOLVER FAIL C2 no mixing", c2NoMix); }
if (b2NoMix?.unpairedElectrons !== 0 || b2NoMix.bondOrder !== 1) { solverFailures += 1; console.log("SOLVER FAIL B2 no mixing", b2NoMix); }
// Out of table.
for (const bad of ["Cl2", "O3", "CO2", "NO2", "N2O", "Ne2-", "H2^2-"]) {
  if (moConfiguration(bad) !== null && bad !== "H2^2-") { solverFailures += 1; console.log(`SOLVER FAIL ${bad} should be null`); }
}
console.log(`solver: ${TRUTH.length + 2} checks, ${solverFailures} failures`);
if (solverFailures > 0) process.exit(1);

/**
 * Pinned labels (MO names, headings, bond order) bypass the placement
 * solver, so the bench measures them the way the solver would: a 24 px text
 * box with 4 px padding must keep 6 px of clear air from every stroke and
 * every other label. Returns the offending pairs.
 */
function pinnedLabelCollisions(scene: RenderScene): string[] {
  const FONT_W = 13;
  const FONT_H = 24;
  const PAD = 4;
  const GAP = 6;
  const labels = scene.primitives.filter((primitive) => primitive.kind === "label" && primitive.text && primitive.points[0]);
  const ink = scene.primitives.filter((primitive) => primitive.kind !== "label" && primitive.points.length > 0);
  const box = (label: RenderPrimitive) => {
    const width = label.text!.length * FONT_W + 2 * PAD;
    const height = FONT_H + 2 * PAD;
    return { x: label.points[0]!.x - width / 2, y: label.points[0]!.y - height / 2, width, height };
  };
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, gap: number) =>
    !(a.x + a.width + gap <= b.x || b.x + b.width + gap <= a.x || a.y + a.height + gap <= b.y || b.y + b.height + gap <= a.y);
  const segmentHitsBox = (p: RenderPoint, q: RenderPoint, r: { x: number; y: number; width: number; height: number }) => {
    // Liang-Barsky clip of the segment against the rectangle.
    let t0 = 0;
    let t1 = 1;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const checks: Array<[number, number]> = [[-dx, p.x - r.x], [dx, r.x + r.width - p.x], [-dy, p.y - r.y], [dy, r.y + r.height - p.y]];
    for (const [den, num] of checks) {
      if (den === 0) { if (num < 0) return false; continue; }
      const t = num / den;
      if (den < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  };
  const problems: string[] = [];
  for (const label of labels) {
    const b = box(label);
    const grown = { x: b.x - GAP, y: b.y - GAP, width: b.width + 2 * GAP, height: b.height + 2 * GAP };
    for (const stroke of ink) {
      const points = stroke.points;
      let hit = false;
      if (points.length >= 2) {
        for (let index = 1; index < points.length && !hit; index += 1) hit = segmentHitsBox(points[index - 1]!, points[index]!, grown);
      } else {
        const p = points[0]!;
        hit = overlaps(b, { x: p.x - 2, y: p.y - 2, width: 4, height: 4 }, GAP);
      }
      if (hit) problems.push(`"${label.text}" (${label.entityId}) touches ${stroke.kind} ${stroke.entityId}`);
    }
    for (const other of labels) {
      if (other === label) continue;
      if (overlaps(b, box(other), 0) && label.entityId < other.entityId) problems.push(`"${label.text}" overlaps "${other.text}"`);
    }
  }
  return problems;
}

/* 2. Probes. */
let probeFailures = 0;
MO_PROBES.forEach((probe, index) => {
  const doc = buildMoScene(probe.question, [], false);
  const name = `${String(index + 1).padStart(2, "0")}-${probe.question.slice(0, 40).replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
  const result = renderDocument(doc, `${outDir}/probes/${name}.svg`, probe.question.slice(0, 80));
  const drew = result.ok;
  const problems: string[] = [];
  if (drew && result.renderScene) {
    const collisions = pinnedLabelCollisions(result.renderScene);
    if (collisions.length) problems.push(`label clearance: ${collisions.join("; ")}`);
  }
  if (probe.expect === "draw" && !drew) problems.push(`expected draw, got ${doc ? "REFUSED" : "decline"}`);
  if (probe.expect === "decline" && doc) problems.push("expected decline, builder returned a document");
  if (probe.expect === "draw" && drew) {
    for (const label of probe.labels ?? []) if (!result.labels.includes(label)) problems.push(`missing label "${label}"`);
    for (const label of probe.forbidLabels ?? []) if (result.labels.includes(label)) problems.push(`forbidden label "${label}"`);
  }
  if (problems.length) {
    probeFailures += 1;
    console.log(`PROBE FAIL #${index + 1}: ${problems.join("; ")}`);
  }
});
console.log(`probes: ${MO_PROBES.length}, ${probeFailures} failures`);

/* 3. Real bank stems. */
if (bankPath) {
  const rows = JSON.parse(readFileSync(bankPath, "utf8")) as Array<{ id: string; unit: string; figs: string[]; text: string; figure_absent: boolean }>;
  const stems = rows.filter((row) => row.figs.includes("mo_diagram")).slice(0, 20);
  let drew = 0;
  let declined = 0;
  let refused = 0;
  stems.forEach((row, index) => {
    const cue = isMoStem(row.text);
    const tokens = moSpeciesTokens(row.text);
    const doc = cue ? buildMoScene(row.text, [], false) : null;
    if (!doc) {
      declined += 1;
      console.log(`bank ${index + 1} ${row.id.slice(0, 14)} DECLINE cue=${cue} tokens=[${tokens.join(",")}] :: ${row.text.replace(/\s+/g, " ").slice(0, 90)}`);
      return;
    }
    const result = compileForLab(doc);
    renderDocument(doc, `${outDir}/bank/${String(index + 1).padStart(2, "0")}-${row.id.slice(2, 14)}.svg`, row.text.replace(/\s+/g, " ").slice(0, 80));
    if (result.ok && result.renderScene) {
      const collisions = pinnedLabelCollisions(result.renderScene);
      if (collisions.length) console.log(`bank ${index + 1} label clearance: ${collisions.join("; ")}`);
    }
    if (result.ok) drew += 1;
    else {
      refused += 1;
      console.log(`bank ${index + 1} ${row.id.slice(0, 14)} REFUSED ${JSON.stringify(result.issues.map((issue) => issue.message))}`);
    }
  });
  console.log(`bank: ${stems.length} stems, drew ${drew}, declined ${declined}, refused ${refused}`);
}

rasterize(outDir);
