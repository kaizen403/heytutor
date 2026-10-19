/** Private symbolic graph lowering. These are visibly chosen law examples,
 * never reconstructed source topology or numerical current solutions. */
import { SceneBuilder } from "../archetypes/document";
import type { SceneDocument } from "../types";
import { readCircuitLawExample } from "./apparatusSource";

interface Branch { id: string; from: string; to: string; kind: "battery" | "resistor"; symbol: string; current: string }
interface SymbolicGraph { terminals: [string, string]; branches: Branch[] }

function lawGraph(junctionRequired: boolean): SymbolicGraph {
  const terminals: [string, string] = ["terminal_a", "terminal_b"];
  const count = junctionRequired ? 3 : 2;
  return { terminals, branches: Array.from({ length: count }, (_, index) => ({
    id: `branch_${index}`, from: terminals[0], to: terminals[1],
    kind: index === 0 ? "battery" : "resistor", symbol: index === 0 ? "E" : `R${String.fromCharCode(96 + index)}`,
    current: index === 0 ? "Is" : `I${String.fromCharCode(96 + index)}`,
  })) };
}

/** The graph invariant is checked before geometry is lowered. The ordinary
 * compiler separately proves terminal connectivity and the actual closed path. */
function completeExampleGraph(graph: SymbolicGraph, junctionRequired: boolean): boolean {
  const ids = new Set(graph.branches.map(branch => branch.id));
  return graph.terminals[0] !== graph.terminals[1] && ids.size === graph.branches.length
    && graph.branches.length >= (junctionRequired ? 3 : 2)
    && graph.branches.filter(branch => branch.kind === "battery").length === 1
    && graph.branches.every(branch => branch.from === graph.terminals[0] && branch.to === graph.terminals[1]);
}

export function buildCircuitLawExample(question: string): SceneDocument | null {
  const read = readCircuitLawExample(question);
  if (read.status !== "example") return null;
  const source = read.source, junctionRequired = source.lawSet.includes("current");
  const graph = lawGraph(junctionRequired);
  if (!completeExampleGraph(graph, junctionRequired)) return null;
  const scene = new SceneBuilder(question, "Symbolic circuit law example", "circuit_law_example");
  const halfHeight = 3, spacing = 4;
  scene.point(graph.terminals[0], { x: 0, y: halfHeight }, "example circuit junction terminal", junctionRequired ? "Junction A" : "A");
  scene.point(graph.terminals[1], { x: 0, y: -halfHeight }, "example circuit junction terminal", "B");
  // These are explicit reference names in this chosen example, not spare
  // generated helper labels. Preserve them through ordinary normalization.
  for (const id of graph.terminals) scene.entities.find(entity => entity.id === id)!.semantic = { labelRequired: true };
  const branchPaths: string[][] = [], arrows: string[] = [], polarityIds: string[] = [];
  for (const [index, branch] of graph.branches.entries()) {
    const x = (index - (graph.branches.length - 1) / 2) * spacing;
    const top = x === 0 ? branch.from : scene.helper(`${branch.id}_top`, { x, y: halfHeight }, "branch corner");
    const bottom = x === 0 ? branch.to : scene.helper(`${branch.id}_bottom`, { x, y: -halfHeight }, "branch corner");
    const upper = scene.helper(`${branch.id}_upper`, { x, y: 1.25 }, "component terminal");
    const lower = scene.helper(`${branch.id}_lower`, { x, y: -1.25 }, "component terminal");
    const path: string[] = [];
    const addWire = (id: string, from: string, to: string): void => { path.push(scene.connect(id, from, to)); };
    if (x !== 0) addWire(`${branch.id}_top_wire`, branch.from, top);
    addWire(`${branch.id}_upper_wire`, x === 0 ? branch.from : top, upper);
    path.push(scene.symbol(branch.id, branch.kind, upper, lower, "symbolic example component", branch.symbol));
    addWire(`${branch.id}_lower_wire`, lower, x === 0 ? branch.to : bottom);
    if (x !== 0) addWire(`${branch.id}_bottom_wire`, bottom, branch.to);
    // Battery long/positive plate is at START. These signs and arrows are
    // reference choices in the labelled example, not supplied circuit facts.
    polarityIds.push(scene.labelAt(`${branch.id}_positive`, { x: x - 0.7, y: 0.9 }, "reference positive terminal", "+"));
    polarityIds.push(scene.labelAt(`${branch.id}_negative`, { x: x - 0.7, y: -0.9 }, "reference negative terminal", "−"));
    const upwards = branch.kind === "battery";
    const at = scene.helper(`${branch.id}_arrow_at`, { x: x + 0.7, y: upwards ? -0.65 : 0.65 }, "reference current anchor");
    arrows.push(scene.vector(`${branch.id}_current`, at, { direction: { x: 0, y: upwards ? 1 : -1 }, length: 1.3 }, "arbitrary reference current direction", branch.current));
    branchPaths.push(path);
    scene.assert(`${branch.id}_connected`, "connected", path);
  }
  scene.assert("example_closed_loop", "path", [...branchPaths[0]!, ...branchPaths[1]!.slice().reverse()]);
  if (branchPaths.length > 2) scene.assert("example_other_loop", "path", [...branchPaths[0]!, ...branchPaths[2]!.slice().reverse()]);
  const heading = scene.labelAt("example_qualification", { x: 0, y: 4.2 }, "chosen symbolic example qualification", "Symbolic example");
  const reference = scene.labelAt("reference_qualification", { x: 0, y: -4.2 }, "arbitrary reference direction qualification", "Reference arrows");
  // The qualifiers also belong to real drawn identities, keeping them nameable
  // during ordinary adapter walkthroughs; no early-label or trust flag is used.
  scene.entities.find(entity => entity.id === branchPaths[0]![0])!.label = "Symbolic example";
  scene.entities.find(entity => entity.id === branchPaths[0]!.at(-1))!.label = "Reference arrows";
  const loop = scene.labelAt("loop_identity", { x: -spacing / 2, y: 0 }, "example closed path identity", "Loop A-B-A");
  const laws: string[] = [];
  if (source.lawSet.includes("current")) laws.push(scene.labelAt("current_law", { x: -2, y: 5.3 }, "current conservation identity", "ΣI = 0"));
  if (source.lawSet.includes("voltage")) laws.push(scene.labelAt("voltage_law", { x: 2, y: 5.3 }, "closed path voltage conservation identity", "ΣΔV = 0"));
  scene.labelled(...graph.terminals, ...polarityIds);
  scene.group("law_example", [...graph.terminals, ...branchPaths.flat(), ...arrows, heading, reference, loop, ...laws,
    ...polarityIds],
  `Symbolic example. Reference arrows. Reference positive terminal and reference negative terminal signs are choices in this symbolic example. ${junctionRequired ? "Junction A" : "A"} and B are terminals. Loop A-B-A is a closed path. ${graph.branches.map(branch => branch.symbol).join(", ")} are unknown component symbols. ${graph.branches.map(branch => branch.current).join(", ")} are chosen reference directions, not solved currents. ${source.lawSet.includes("current") ? "ΣI = 0." : ""} ${source.lawSet.includes("voltage") ? "ΣΔV = 0." : ""}`);
  const document = scene.build();
  document.source = { question, synthesizedFamily: true, sourceModel: "circuit_law_example", nonMetric: true,
    lawSet: source.lawSet, requestSpans: source.requestSpans };
  return document;
}
