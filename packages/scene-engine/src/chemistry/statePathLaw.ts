/** A symbolic state-function example, distinct from supplied reaction data. */
import type { SceneDocument } from "../types";
import { ChemScene } from "./sceneKit";
import type { ChemistrySpan } from "./quantityReader";

interface StatePathRequest {
  readonly question: string;
  readonly requestSpans: readonly ChemistrySpan[];
}

/** Positive vocabulary for a law illustration. Unowned supplied material,
 * numerical steps and unavailable figures cannot become an abstract example. */
function readStatePathRequest(question: string): StatePathRequest | null {
  const tokens = /\b(?:hess(?:['’]s)?\s+law|explain|illustrate|draw|sketch|show|represent|compare|symbolic|formal|enthalpy|cycle|diagram|direct|indirect|paths?|states?|using|with|between|the|same|an?|and)\b/gi;
  const spans: ChemistrySpan[] = [];
  let cursor = 0;
  let law = false;
  let request = false;
  for (const match of question.matchAll(tokens)) {
    if (!/^[\s:,.!?;–—-]*$/.test(question.slice(cursor, match.index))) return null;
    const text = match[0].toLowerCase();
    law ||= /^hess/.test(text);
    request ||= /^(?:explain|illustrate|draw|sketch|show|represent|compare)$/.test(text);
    spans.push({ start: match.index, end: match.index + match[0].length });
    cursor = match.index + match[0].length;
  }
  return law && request && /^[\s:,.!?;–—-]*$/.test(question.slice(cursor))
    ? { question, requestSpans: spans } : null;
}

/** Incidence, not a guessed energy height, proves that the indirect route
 * has exactly the same initial/final state as the direct route. */
function pathIncidence(edges: readonly (readonly [string, string])[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const [from, to] of edges) {
    result.set(from, (result.get(from) ?? 0) - 1);
    result.set(to, (result.get(to) ?? 0) + 1);
  }
  return result;
}

export function buildSymbolicStatePathLaw(question: string): SceneDocument | null {
  const source = readStatePathRequest(question);
  if (!source) return null;
  const direct = pathIncidence([["A", "B"]]);
  const via = pathIncidence([["A", "C"], ["C", "B"]]);
  if (["A", "B", "C"].some(state => (direct.get(state) ?? 0) !== (via.get(state) ?? 0))) return null;

  const c = new ChemScene(question, "symbolic state-function path identity", "chem_thermo");
  const s = c.scene;
  s.point("state_a", { x: -3, y: 0 }, "initial symbolic state", "A");
  s.point("state_b", { x: 3, y: 0 }, "final symbolic state", "B");
  s.point("state_c", { x: 0, y: -2.5 }, "intermediate symbolic state", "C");
  s.vector("direct_ab", "state_a", { end: "state_b" }, "direct state path", "ΔH_AB");
  s.vector("step_ac", "state_a", { end: "state_c" }, "first indirect state path", "ΔH_AC");
  s.vector("step_cb", "state_c", { end: "state_b" }, "second indirect state path", "ΔH_CB");
  const qualifier = c.text("symbolic_example", { x: 0, y: 1.2 }, "Symbolic example", "symbolic example qualifier");
  const lhs = c.text("path_sum_lhs", { x: -1.7, y: -3.5 }, "ΔH_AB =", "path enthalpy identity left side");
  const rhs = c.text("path_sum_rhs", { x: 1.5, y: -3.5 }, "ΔH_AC + ΔH_CB", "path enthalpy identity right side");
  const ids = ["state_a", "state_b", "state_c", "direct_ab", "step_ac", "step_cb", qualifier, lhs, rhs];
  for (const entity of s.entities.filter(entity => ids.includes(entity.id))) entity.semantic = { ...entity.semantic, labelRequired: true };
  s.labelled(...ids);
  s.group("state_paths", ids, "Symbolic example: states A, B and C; direct ΔH_AB equals ΔH_AC plus ΔH_CB. The layout does not order state energies.");
  const document = c.build({ caption: "Hess's law: enthalpy is a state function. The two routes have the same initial and final states. Reversing the direct arrow makes the directed closed-cycle sum zero. These are formal states, not specified substances or absolute energy levels." });
  document.source = { ...document.source, nonMetric: true, statePathLaw: { mode: "symbolic_example", requestSpans: source.requestSpans, direct: ["A", "B"], via: ["A", "C", "B"] } };
  return document;
}
