/** Source-member authority, not an absolute-value or sign-tolerance exemption. */
import assert from "node:assert/strict";
import { pruneUnverifiedSceneAnnotations, validateSceneQuantityAgreement, type SceneDocument, type TurnPlanV3 } from "../../src/index";

const question = "An electric dipole has charges ±8.0 μC separated by 3 cm. Sketch its two members.";
function plan(source = question): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question: source, visualRequirement: "required",
    givens: [{ id: "magnitude", symbol: "|q|", value: 8, unit: "μC", provenance: "given" }],
    unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [] };
}
function doc(source = question): SceneDocument {
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "declared pair" },
    source: { question: source }, quantities: [],
    entities: [{ id: "positive", kind: "point", role: "positive member", label: "+8.0 μC" },
      { id: "negative", kind: "point", role: "negative member", label: "−8.0 μC" }],
    constructions: [{ id: "positive_point", operator: "point", inputs: { x: -1, y: 0 }, outputs: ["positive"] },
      { id: "negative_point", operator: "point", inputs: { x: 1, y: 0 }, outputs: ["negative"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["positive", "negative"],
    revealGroups: [{ id: "pair", entityIds: ["positive", "negative"], dependsOn: [], narrationCue: "pair" }], teachingTimeline: [] };
}
let checks = 0;
function check(condition: boolean, name: string) { checks++; assert(condition, name); }
const member = { id: "negative_member", value: -8, unit: "μC" };
check(validateSceneQuantityAgreement([member], plan(), ["−8.0 μC"]).length > 0,
  "without caller-source evidence, a magnitude never authorizes its negative");
check(validateSceneQuantityAgreement([member], plan(), ["−8.0 μC"], question).length === 0,
  "the trusted source explicitly entails both charge members");
check(pruneUnverifiedSceneAnnotations(doc(), plan()).entities[1]!.label === undefined,
  "legacy callers still prune an unsupported negative");
check(pruneUnverifiedSceneAnnotations(doc(), plan(), question).entities[1]!.label === "−8.0 μC",
  "source-bound negative survives the real prune path");
check(validateSceneQuantityAgreement([{ id: "negative_member", value: -8e-6, unit: "C" }], plan(), ["−0.000008 C"], question).length === 0,
  "a declared member can be displayed in an equivalent charge unit");
for (const source of [
  "Two charges +8.0 μC and -8.0 μC form a pair.",
  "A charge pair consists of +8.0 μC and −8.0 μC.",
]) check(validateSceneQuantityAgreement([member], plan(source), ["−8 μC"], source).length === 0,
  "two explicitly signed literal charge members are grounded");
const uncertain = "Two charges ±8 μC may be present.";
check(validateSceneQuantityAgreement([member], plan(uncertain), [], uncertain)
  .some(issue => issue.code === "scene_quantity_unverified"),
  "one possible charge pair cannot authorize its negative numeric member");
check(validateSceneQuantityAgreement([], plan(uncertain), ["−8 μC"], uncertain)
  .some(issue => issue.code === "displayed_quantity_unverified"),
  "one possible charge pair cannot authorize its negative displayed member");
check(pruneUnverifiedSceneAnnotations(doc(uncertain), plan(uncertain), uncertain).entities[1]!.label === undefined,
  "a modal source pair stays pruned on the actual label path");
for (const source of [
  "Two charges ±8 μC are possibly present.",
  "Two charges ±8 μC are potentially present.",
  "Two charges ±8 μC are maybe present.",
  "Two charges ±8 μC are perhaps present.",
  "Two charges ±8 μC are possible.",
  "Potential charges ±8 μC are considered.",
  "A potential charge pair ±8 μC is considered.",
]) check(validateSceneQuantityAgreement([member], plan(source), [], source)
  .some(issue => issue.code === "scene_quantity_unverified"),
  "a single uncertain modal/adjectival pair is not an affirmed charge source");
const potentialQuestion = "Two charges ±8 μC are present. Find their electric potential.";
check(validateSceneQuantityAgreement([member], plan(potentialQuestion), ["−8 μC"], potentialQuestion).length === 0,
  "an electric-potential task does not negate its affirmed charge premise");
for (const source of [
  "The charge magnitude is 8 μC.",
  "A charge is measured as ±8 μC.",
  "Two charges have uncertainty ±8 μC.",
  "These are not charges ±8 μC.",
  "Ignore the example charges ±8 μC.",
  "There are no charges ±8 μC.",
  "Charges ±8 μC are absent.",
  "The system would have charges ±8 μC if it were changed.",
  "Two charges ±8 μC and another pair ±4 μC are present.",
  "Two charges +8 μC and -7 μC are present.",
  "Two charges +8 μC and -0.008 mC are present.",
  "Two charges ±0 μC are present.",
]) check(validateSceneQuantityAgreement([member], plan(source), ["−8 μC"], source).length > 0,
  "missing, uncertainty, ambiguous, unequal, mixed-unit and zero pairs stay unsupported");
check(validateSceneQuantityAgreement([member], plan(), ["−8 μC"], "The charge magnitude is 8 μC.").length > 0,
  "a different caller question cannot borrow the plan's pair");
check(pruneUnverifiedSceneAnnotations(doc(question), plan("The charge magnitude is 8 μC."), "The charge magnitude is 8 μC.").entities[1]!.label === undefined,
  "document.source cannot spoof signed-member authority");
const conflict = plan(); conflict.givens[0]!.value = 7;
check(validateSceneQuantityAgreement([member], conflict, ["−8 μC"], question).length > 0,
  "a contradictory plan magnitude cannot supply source-member evidence");
const duplicate = plan(); duplicate.givens.push({ ...duplicate.givens[0]!, id: "another_magnitude" });
check(validateSceneQuantityAgreement([member], duplicate, ["−8 μC"], question).length > 0,
  "duplicate magnitude bindings are ambiguous");
for (const quantity of [
  { id: "negative_member", value: -9, unit: "μC" },
  { id: "negative_member", value: -8, unit: "μA" },
  { id: "magnitude", value: -8, unit: "μC" },
]) check(validateSceneQuantityAgreement([quantity], plan(), [], question).length > 0,
  "wrong value/unit or contradiction of an existing plan ID remains rejected");
console.log(`verify-signed-charge-source-members: ${checks} trusted-source, prune, ambiguity and contradiction checks pass`);
