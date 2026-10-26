/**
 * Set partition repair findings say exactly what to change. Shapes are the
 * ones Kimi K3 wrote for "venn diagram of A union B" in the recorded maths
 * round: sets as bare names, the construction id used as the partition
 * reference, label anchors declared as points, a missing outside anchor, and
 * undeclared outputs, which are refused with the declaration each one needs.
 */
import assert from "node:assert/strict";
import { validateSceneDocument } from "../../src/document/validation";
import { validateSetConstruction } from "../../src/compile/setGeometry";
import type { SceneDocument, SceneIssue } from "../../src/types";

type Doc = Record<string, any>;
const base = (): Doc => ({
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "venn diagram of A union B" },
  source: { question: "venn diagram of A union B" }, quantities: [],
  entities: [
    { id: "circleA", kind: "circle", role: "set" }, { id: "circleB", kind: "circle", role: "set" },
    { id: "anchorA", kind: "label", role: "label anchor" }, { id: "anchorB", kind: "label", role: "label anchor" },
    { id: "anchorAB", kind: "label", role: "label anchor" }, { id: "unionRegion", kind: "label", role: "union count anchor" },
  ],
  constructions: [
    { id: "cPartition", operator: "set_partition", inputs: { sets: [{ name: "A", count: 5 }, { name: "B", count: 5 }], intersections: [{ sets: ["A", "B"], count: 2 }], origin: [0, 0], displayScale: 1 }, outputs: ["circleA", "circleB", "anchorA", "anchorB", "anchorAB"] },
    { id: "cUnion", operator: "set_select", inputs: { partition: "circleA", expression: { union: [{ set: "A" }, { set: "B" }] } }, outputs: ["unionRegion"] },
  ],
  relations: [], assertions: [], annotations: [],
  requiredEntityIds: ["circleA", "circleB", "anchorA", "anchorB", "anchorAB", "unionRegion"],
  revealGroups: [{ id: "g1", entityIds: ["circleA", "circleB", "anchorA", "anchorB", "anchorAB", "unionRegion"], dependsOn: [], narrationCue: "sets" }],
  teachingTimeline: [],
});
const fatal = (doc: Doc) => validateSceneDocument(doc).report.issues.filter((issue) => issue.severity === "fatal");
const find = (doc: Doc, code: string) => {
  const issue = fatal(doc).find((entry) => entry.code === code);
  assert.ok(issue, `${code} expected; got ${JSON.stringify(fatal(doc).map((entry) => entry.code))}`);
  return issue!.message;
};
let checks = 0;

assert.deepEqual(fatal(base()), [], "the corrected document validates");
checks++;

let doc = base(); doc.constructions[0].inputs.sets = ["A", "B"];
assert.match(find(doc, "invalid_set_partition_sets"), /sets\[0\] is "A"; write \{name:"A",count:n\}/);
checks++;

doc = base(); doc.constructions[0].inputs.intersections = ["AB"];
assert.match(find(doc, "invalid_set_partition_intersections"), /intersections\[0\] is "AB"; write \{sets:\["A","B"\],count:n\}/);
checks++;

doc = base(); doc.constructions[1].inputs.partition = "cPartition";
assert.match(find(doc, "invalid_set_select_partition"), /cPartition is the id of construction cPartition, not an entity; name one of its output entity ids of kind "circle" or "label", such as circleA/);
checks++;

doc = base(); doc.entities[2].kind = "point";
assert.match(find(doc, "invalid_set_partition_outputs"), /output anchorA \(the label anchor for region A\\B\) is declared with kind "point"; it needs kind "label"/);
checks++;

doc = base(); doc.constructions[0].inputs.universeCount = 12;
assert.match(find(doc, "invalid_set_partition_outputs"), /requires exactly 6 distinct output ids; got 5: 2 circles, then 3 region label anchors in mask order, then 1 outside label anchor because universeCount is supplied/);
checks++;

// Three sets: a malformed pair entry keeps its pair, and an unreadable entry
// is shown the whole required list, never only the triple.
const threeSets = (intersections: unknown[]): Doc => {
  const next = base();
  next.constructions[0].inputs.sets = [{ name: "A", count: 9 }, { name: "B", count: 8 }, { name: "C", count: 7 }];
  next.constructions[0].inputs.intersections = intersections;
  return next;
};
const pairMessage = find(threeSets(["AB", "AC", "BC", "ABC"]), "invalid_set_partition_intersections");
assert.match(pairMessage, /intersections\[0\] is "AB"; write \{sets:\["A","B"\],count:n\}/, pairMessage);
assert.doesNotMatch(pairMessage, /\["A","B","C"\]/, "a pair entry is not told to name all three sets");
checks++;
const symbolMessage = find(threeSets([{ sets: ["A", "B"], count: 3 }, "A ∩ C", { sets: ["B", "C"], count: 2 }, { sets: ["A", "B", "C"], count: 1 }]), "invalid_set_partition_intersections");
assert.match(symbolMessage, /intersections\[1\] is "A ∩ C"; write \{sets:\["A","C"\],count:n\}/, symbolMessage);
checks++;
const unreadMessage = find(threeSets([5, 4, 3, 2]), "invalid_set_partition_intersections");
assert.match(unreadMessage, /these 4 entries, one each: \{sets:\["A","B"\],count:n\}, \{sets:\["A","C"\],count:n\}, \{sets:\["B","C"\],count:n\}, \{sets:\["A","B","C"\],count:n\}/, unreadMessage);
checks++;

// A construction id given where a point is needed: its circle outputs are not
// offered, since a circle cannot be a placement origin.
doc = base(); doc.constructions[1].inputs.at = "cPartition";
const originMessage = fatal(doc).map((issue) => issue.message).find((message) => message.includes("cPartition is the id of construction"));
assert.ok(originMessage, `origin finding expected; got ${JSON.stringify(fatal(doc).map((issue) => issue.code))}`);
assert.doesNotMatch(originMessage!, /such as (circleA|anchorA)/, originMessage);
assert.match(originMessage!, /none of its outputs has kind "point"; name an ordinary point entity, or give inline coordinates \[x, y\]/, originMessage);
checks++;

// A referenced construction whose outputs is one string, not an array, still
// gets repair advice rather than a crash message. Document normalization
// wraps such outputs, so call the set validator on the raw shape.
{
  const raw = base(); raw.constructions[1].inputs.partition = "cPartition"; raw.constructions[0].outputs = "circleA";
  const issues: SceneIssue[] = [];
  validateSetConstruction(raw.constructions[1], 1, raw as SceneDocument, new Map(), issues);
  const message = issues.map((issue) => issue.message).find((entry) => entry.includes("cPartition is the id of construction"));
  assert.ok(message && !/is not a function/.test(message), `string outputs get advice: ${JSON.stringify(issues.map((issue) => issue.message))}`);
  assert.match(message!, /outputs must be an array of output entity ids/);
  checks++;
}

// An unrequired or ungrouped declared entity is told where to add its id.
doc = base(); doc.requiredEntityIds = doc.requiredEntityIds.filter((id: string) => id !== "anchorA");
doc.revealGroups[0].entityIds = doc.revealGroups[0].entityIds.filter((id: string) => id !== "anchorA");
assert.match(find(doc, "unrequired_entity"), /Entity anchorA is not declared in requiredEntityIds; add anchorA to requiredEntityIds/);
assert.match(find(doc, "ungrouped_entity"), /add anchorA to the entityIds of one reveal group/);
checks++;

// Undeclared set partition outputs are refused, as on main: the engine never
// guesses which id is which circle or region. The finding names the
// declaration each output needs for its slot. Both shapes below drew a wrong
// label when kinds were inferred by position.
const undeclared = (outputs: string[], annotations: Doc[]): Doc => {
  const next = base();
  next.entities = []; next.constructions = [{ ...next.constructions[0], inputs: { ...next.constructions[0].inputs, intersections: [{ sets: ["A", "B"], count: 2 }], sets: [{ name: "A", count: 5 }, { name: "B", count: 6 }] }, outputs }];
  next.annotations = annotations; next.requiredEntityIds = [...outputs];
  next.revealGroups = [{ id: "g1", entityIds: [...outputs], dependsOn: [], narrationCue: "sets" }];
  return next;
};
const refusedUndeclared = (next: Doc, label: string) => {
  const result = validateSceneDocument(next);
  assert.equal(result.report.valid, false, `${label}: an undeclared set partition output is refused`);
  return find(next, "invalid_set_partition_outputs");
};
// Region label on the wrong region: "both" sits in the B only slot.
const regionMessage = refusedUndeclared(undeclared(["circleA", "circleB", "onlyA", "both", "onlyB"], [{ id: "a1", kind: "label", targetIds: ["both"], text: "A∩B" }]), "region probe");
assert.match(regionMessage, /not declared in entities/, regionMessage);
assert.match(regionMessage, /\{id:"circleA",kind:"circle"\} \(the circle for set A\)/, regionMessage);
assert.match(regionMessage, /\{id:"both",kind:"label"\} \(the label anchor for region B\\A\)/, regionMessage);
assert.doesNotMatch(regionMessage, /"segment"/, regionMessage);
checks++;
// Set label on the wrong circle: circleB is listed in set A's slot.
const circleMessage = refusedUndeclared(undeclared(["circleB", "circleA", "onlyA", "onlyB", "both"], [{ id: "a1", kind: "label", targetIds: ["circleB"], text: "B" }, { id: "a2", kind: "label", targetIds: ["circleA"], text: "A" }]), "circle probe");
assert.match(circleMessage, /\{id:"circleB",kind:"circle"\} \(the circle for set A\)/, circleMessage);
assert.match(circleMessage, /\{id:"both",kind:"label"\} \(the label anchor for region A∩B\)/, circleMessage);
checks++;
// Undeclared anchors alongside declared circles: only the anchors are listed.
doc = base(); doc.entities = doc.entities.filter((entity: Doc) => !entity.id.startsWith("anchor"));
const anchorMessage = find(doc, "invalid_set_partition_outputs");
assert.match(anchorMessage, /\{id:"anchorA",kind:"label"\} \(the label anchor for region A\\B\)/, anchorMessage);
assert.doesNotMatch(anchorMessage, /id:"circleA"/, anchorMessage);
checks++;

console.log(`verify-set-partition-repair-messages: ${checks} checks passed`);
