import { attemptArchetypeScene, detectArchetype } from "../archetypes";
import type { ProblemIR } from "./problemIR";

const RESISTANCE = /(\d+(?:\.\d+)?)\s*(kΩ|MΩ|k\s*ohms?|M\s*ohms?|Ω|ohms?)(?![A-Za-z0-9])/gi;
const VOLTAGE = /(\d+(?:\.\d+)?)\s*(V|volts?)(?![A-Za-z0-9])/gi;

/**
 * Give a source-proved component the engine's compact display name without
 * dropping or weakening its visual obligation. Identity is the exact source
 * occurrence enclosed by its fact evidence, never merely an equal value.
 */
export function groundStatedCircuitProblem(problem: ProblemIR): ProblemIR {
  if (detectArchetype(problem.question, { turnPlan: null })?.id !== "resistor_network") return problem;
  const scene = attemptArchetypeScene({ question: problem.question }).scene;
  if (!scene || scene.archetype !== "resistor_network") return problem;
  const occurrences = [
    ...[...problem.question.matchAll(RESISTANCE)].map((match, index) => ({ match, sceneId: `R${index + 1}`, kind: "resistor" })),
    ...[...problem.question.matchAll(VOLTAGE)].map(match => ({ match, sceneId: "battery", kind: "source" })),
  ];
  const facts = new Map(problem.facts.map(fact => [fact.id, fact]));
  const candidates = problem.entities.flatMap(entity => {
    if (entity.kind !== "component" || !entity.label) return [];
    const bindings = occurrences.filter(occurrence => {
      const labelPattern = occurrence.kind === "resistor" ? RESISTANCE : VOLTAGE;
      const labelValues = [...entity.label!.matchAll(labelPattern)];
      // Preserve any more specific source name rather than silently replacing
      // it. Only an ordinary value-and-component description is compacted.
      const componentWord = occurrence.kind === "resistor" ? "resistor" : "(?:source|battery|cell)";
      if (!new RegExp(`^\\s*${componentWord}\\s*$`, "i").test(entity.label!.replace(labelPattern, "")) || labelValues.length !== 1) return false;
      const scalar = (match: RegExpMatchArray) => {
        const prefix = match[2]![0];
        const multiplier = occurrence.kind === "source" ? 1 : prefix === "M" ? 1e6 : prefix === "m" ? 1e-3 : /k/i.test(prefix!) ? 1e3 : 1;
        return Number(match[1]) * multiplier;
      };
      if (scalar(labelValues[0]!) !== scalar(occurrence.match)) return false;
      return entity.evidenceFactIds.some(id => {
        const fact = facts.get(id);
        const evidence = fact?.evidence;
        return fact?.kind === "given" && evidence?.source === "question"
          && problem.question.slice(evidence.start, evidence.end) === evidence.quote
          && evidence.start <= occurrence.match.index! && evidence.end >= occurrence.match.index! + occurrence.match[0].length;
      });
    });
    if (bindings.length !== 1) return [];
    const binding = bindings[0]!;
    const target = scene.document.entities.find(row => row.id === binding.sceneId);
    return target?.label ? [{ entityId: entity.id, sceneId: binding.sceneId, label: target.label }] : [];
  });
  const unique = candidates.filter(candidate => candidates.filter(other => other.sceneId === candidate.sceneId).length === 1);
  if (unique.length === 0) return problem;
  const labels = new Map(unique.map(candidate => [candidate.entityId, candidate.label]));
  return { ...problem, entities: problem.entities.map(entity => labels.has(entity.id) ? { ...entity, label: labels.get(entity.id)! } : entity) };
}
