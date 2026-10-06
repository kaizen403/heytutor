import { solveDcNetwork } from "../ir/circuitNetwork";
import { validateProblemIR } from "../ir/problemIR";
import { SCENE_DOCUMENT_VERSION, type SceneDocument, type SceneEntity } from "../types";

export type GroundedOhmScene = { handled: false } | { handled: true; document: SceneDocument | null };

export function groundedOhmScene(question: string, raw: unknown): GroundedOhmScene {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as Record<string, unknown>).solveRequests)) return { handled: false };
  const requests = (raw as Record<string, unknown>).solveRequests as unknown[];
  if (!requests.some((request) => typeof request === "object" && request !== null && (request as Record<string, unknown>).kind === "dc_network")) return { handled: false };
  try {
    const validated = validateProblemIR(raw, question);
    if (!validated.valid || !validated.problem) return { handled: true, document: null };
    const problem = validated.problem;
    const dcRequests = problem.solveRequests.filter((request) => request.kind === "dc_network");
    const network = dcRequests[0].network;
    if (problem.solveRequests.length !== dcRequests.length || dcRequests.some((request) => JSON.stringify(request.network) !== JSON.stringify(network))) return { handled: true, document: null };
    const loads = network.branches.filter((branch) => ["resistor", "wire", "open"].includes(branch.kind));
    const sources = network.branches.filter((branch) => ["voltage_source", "current_source"].includes(branch.kind));
    if (network.nodes.length !== 2 || loads.length !== 1 || sources.length > 1 || network.branches.length !== loads.length + sources.length) return { handled: true, document: null };
    const owners = new Set([...network.nodes, ...network.branches.map((branch) => branch.id)]);
    if (problem.entities.length !== owners.size || problem.entities.some((entity) => !owners.has(entity.id) || (entity.label ?? entity.id).length > 16)) return { handled: true, document: null };
    const solution = solveDcNetwork(problem, network);
    const name = (id: string) => problem.entities.find((entity) => entity.id === id)!.label ?? id;
    const entities: SceneEntity[] = problem.entities.map((entity) => ({ id: entity.id, kind: entity.kind,
      role: network.nodes.includes(entity.id) ? "source-declared terminal" : "source-declared DC component", label: name(entity.id),
      provenance: { problemEntityId: entity.id, evidenceFactIds: entity.evidenceFactIds } }));
    const constructions: SceneDocument["constructions"] = network.nodes.map((id, i) => ({ id: `place_${id}`, operator: "point", inputs: { x: i * 4, y: 0, coordinateSpace: "world" }, outputs: [id] }));
    const annotations: SceneDocument["annotations"] = [];
    const quantities = problem.expressions.flatMap((expression) => expression.root.kind === "number"
      ? [{ id: expression.id, value: expression.root.value, evidenceFactIds: expression.evidenceFactIds }] : []);
    const used = new Set(entities.map((entity) => entity.id));
    const label = (owner: string, text: string, evidenceFactIds: string[]) => {
      if (text.length > 16) throw new Error("Source-bound DC label exceeds the existing compact-label contract");
      let id = `value_${owner}_${entities.length}`;
      while (used.has(id)) id = `v_${id}`;
      used.add(id);
      entities.push({ id, kind: "label", role: "source-bound DC value, not a geometric measurement", label: text,
        provenance: { problemEntityId: owner, evidenceFactIds, exactNetwork: true } });
      constructions.push({ id: `place_${id}`, operator: "label", inputs: { target: owner, text }, outputs: [id] });
    };
    for (const branch of network.branches) {
      const drop = solution.voltages[branch.from].approximate - solution.voltages[branch.to].approximate;
      const nonReferenceValue = solution.voltages[branch.from === solution.referenceNode ? branch.to : branch.from].exact;
      const exactDrop = branch.from === solution.referenceNode && nonReferenceValue !== "0"
        ? nonReferenceValue.startsWith("-") ? nonReferenceValue.slice(1) : `-${nonReferenceValue}` : nonReferenceValue;
      const reverseBattery = branch.kind === "voltage_source" && drop < 0;
      constructions.push({ id: `draw_${branch.id}`, operator: "symbol", inputs: {
        symbol: branch.kind === "voltage_source" ? "battery" : branch.kind === "current_source" ? "dc_current_source" : branch.kind,
        start: reverseBattery ? branch.to : branch.from, end: reverseBattery ? branch.from : branch.to,
      }, outputs: [branch.id] });
      const branchFacts = [branch.lawFactId, ...(branch.quantityFactId ? [branch.quantityFactId] : [])];
      label(branch.id, `I(${name(branch.from)}→${name(branch.to)})=${solution.currents[branch.id].exact} A`, branchFacts);
      const sourceDrop = `V(${name(branch.from)})-V(${name(branch.to)})=${exactDrop} V`;
      label(branch.id, sourceDrop, branchFacts);
      if (branch.kind === "resistor") label(branch.id, problem.facts.find((fact) => fact.id === branch.lawFactId)!.evidence.quote, branchFacts);
      if (["resistor", "wire"].includes(branch.kind)) {
        annotations.push({ id: `reference_${branch.id}`, kind: "sense", targetIds: [branch.id] });
      }
    }
    const terminalIds = [...network.nodes];
    const branchIds = network.branches.map((branch) => branch.id);
    const valueIds = entities.filter((entity) => entity.kind === "label").map((entity) => entity.id);
    const revealGroups = [
      { id: "dc_terminals", entityIds: terminalIds, dependsOn: [], narrationCue: "Identify the two source-declared terminals." },
      { id: "dc_components", entityIds: branchIds, dependsOn: ["dc_terminals"], narrationCue: "Show only the declared DC element and supplied source." },
      { id: "dc_values", entityIds: valueIds, dependsOn: ["dc_components"], narrationCue: "Read signed current references and voltage differences; geometry is not to scale." },
    ];
    return { handled: true, document: {
      schemaVersion: SCENE_DOCUMENT_VERSION,
      visualDecision: { mode: "scene", reason: "Source-bound two-terminal DC schematic; physical quantities do not derive from display scale." },
      source: { question: problem.question, groundedSchematic: "two-terminal-dc/v1", problemId: problem.id, network, solution },
      quantities, entities, constructions, relations: [], annotations,
      assertions: [{ id: "declared_owners", predicate: "exists", entities: [...owners], expected: true, severity: "fatal" }],
      requiredEntityIds: entities.map((entity) => entity.id), revealGroups,
      teachingTimeline: revealGroups.map((group, index) => ({ id: `reveal_${group.id}`, action: "reveal", targetId: group.id,
        dependsOn: index === 0 ? [] : [`reveal_${revealGroups[index - 1].id}`], narrationIntent: group.narrationCue })),
    } };
  } catch {
    return { handled: true, document: null };
  }
}
