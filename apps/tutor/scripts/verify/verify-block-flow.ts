/**
 * Block and flow diagrams for "other" lessons (lane 9). Production 22 to 24 Oct
 * taught contactless payment, 8051 interrupts, container services and
 * distributed ledgers as text only: no family or archetype admits the
 * planner for them. The earlier concept schematic picked boxes from the
 * question's words and drew wrong pictures, so this capability is planner
 * proven: every box and arrow must be grounded in the plan's own claims, the
 * engine owns the layout, and anything it cannot prove refuses the figure.
 * Behind NEXT_PUBLIC_OTHER_SUBJECT_BLOCK_FLOW, off by default. Claims below
 * are written for this gate.
 */
import assert from "node:assert/strict";
import {
  FIGURE_SOURCES, PLANNER_VISIBLE_SCENE_CONSTRUCTION_OPERATORS, SUPPORTED_SCENE_CONSTRUCTION_OPERATORS,
  compileSceneDocument, validateSceneDocument, type TurnPlanV3,
} from "@heytutor/scene-engine";
import {
  BLOCK_FLOW_LINE_CHARS, BLOCK_FLOW_ZONE, blockFlowGroundingIssues, evaluateBlockFlowConstruction, planDescribesLinkedComponents,
  validateBlockFlowGrounding, verifyBlockFlowLayout, wrapBlockFlowLabel, type BlockFlowDefinition,
} from "../../../../packages/scene-engine/src/compile/blockFlowGeometry";
import { buildSceneDocumentPlannerPrompt } from "../../../../packages/tutor-core/src/planners/scenePlannerV2Prompt";
import { BLOCK_FLOW_SCENE_REQUEST } from "../../../../packages/tutor-core/src/planners/sceneCapabilities";
import { blockFlowEligibleTurn } from "../../features/tutor-session/lib/scene/diagramGeneration";
import { diagramStrategyAllowsFigureSource, liveDiagramStrategyDecision } from "../../features/tutor-session/lib/scene/diagramStrategy";
import { deriveSceneGate, selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

let rows = 0;
function row(name: string, body: () => void): void {
  try { body(); rows++; }
  catch (error) { console.error(`verify-block-flow: FAIL ${name}`); throw error; }
}
const refuses = (inputs: Record<string, unknown>, pattern: RegExp, name: string) => {
  assert.throws(() => evaluateBlockFlowConstruction("block_flow", inputs), pattern, name);
};

type Claim = TurnPlanV3["qualitativeClaims"][number];
const claim = (id: string, text: string, hints?: string[]): Claim => ({ id, claim: text, expected: "", ...(hints ? { relatedEntityHints: hints } : {}) });
const plan = (claims: Claim[], visualRequirement: TurnPlanV3["visualRequirement"] = "required"): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question: "How does a tap to pay purchase reach the bank?", givens: [], unknowns: [], derived: [],
  qualitativeClaims: claims, lawIds: [], assumptions: [], visualRequirement,
});
const node = (id: string, label: string, claimIds = ["c2"]) => ({ id, label, claimIds });
const edge = (from: string, to: string, label: string, claimId = "c2") => ({ from, to, label, claimId });

const payClaims = [
  claim("c1", "The card and the reader exchange data over short range radio.", ["card", "reader"]),
  claim("c2", "Path: reader sends request → acquirer forwards it → card network routes it → issuing bank approves or declines.", ["reader", "acquirer", "card network", "issuing bank"]),
];
const payInputs = {
  nodes: [node("card", "Card", ["c1"]), node("reader", "Reader"), node("acq", "Acquirer"), node("net", "Card network"), node("bank", "Issuing bank")],
  edges: [edge("card", "reader", "exchange data", "c1"), edge("reader", "acq", "sends request"), edge("acq", "net", "forwards"), edge("net", "bank", "routes")],
};
const payPlan = plan(payClaims);
const document = (inputs: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "the claims name the path a payment takes" },
  source: { question: payPlan.question, authority: "AUTHORITATIVE TURN PLAN V3" }, quantities: [],
  entities: [{ id: "flow", kind: "block_flow", role: "diagram" }],
  constructions: [{ id: "k_flow", operator: "block_flow", inputs, outputs: ["flow"] }],
  relations: [], assertions: [], annotations: [], requiredEntityIds: ["flow"],
  revealGroups: [{ id: "g_flow", entityIds: ["flow"] }], teachingTimeline: [{ id: "t1", action: "reveal", targetId: "g_flow" }],
  ...extra,
});

// ------------------------------------------------------------------ engine

let pay: BlockFlowDefinition;
row("a grounded chain lays out inside the zone with nothing touching", () => {
  pay = evaluateBlockFlowConstruction("block_flow", payInputs)[0]!.blockFlow;
  assert.deepEqual(verifyBlockFlowLayout(pay), []);
  assert.equal(pay.boxes.length, 5);
  assert.equal(pay.arrows.length, 4);
  for (const line of [...pay.boxLines, ...pay.arrows.flatMap((arrow) => arrow.labelLines)]) {
    assert(line.text.length <= BLOCK_FLOW_LINE_CHARS, `line "${line.text}" fits the renderer`);
  }
  for (const box of pay.boxes) {
    assert(box.x >= BLOCK_FLOW_ZONE.x && box.x + box.width <= BLOCK_FLOW_ZONE.x + BLOCK_FLOW_ZONE.width, `box ${box.id} in zone`);
  }
});

row("the verifier catches every overlap it is there for", () => {
  const moved = structuredClone(pay);
  moved.boxes[1] = { ...moved.boxes[1]!, x: moved.boxes[0]!.x, y: moved.boxes[0]!.y };
  assert(verifyBlockFlowLayout(moved).some((problem) => /too close/.test(problem)), "two boxes on top of each other");
  const label = structuredClone(pay);
  const line = label.arrows[0]!.labelLines[0]!;
  const target = label.boxes[2]!;
  line.ink = { x: target.x + 2, y: target.y + 2, width: 20, height: 10 };
  assert(verifyBlockFlowLayout(label).some((problem) => /touches box/.test(problem)), "an arrow label on a box");
  const loose = structuredClone(pay);
  loose.arrows[0]!.points[1] = { x: loose.arrows[0]!.points[1]!.x, y: loose.arrows[0]!.points[1]!.y + 30 };
  assert(verifyBlockFlowLayout(loose).some((problem) => /does not join its boxes/.test(problem)), "an arrow that stops short");
  const out = structuredClone(pay);
  out.boxes[0] = { ...out.boxes[0]!, x: 380 };
  assert(verifyBlockFlowLayout(out).some((problem) => /leaves the diagram zone/.test(problem)), "a box left of x 410");
  const crossed = structuredClone(pay);
  const [first, second] = [crossed.arrows[1]!, crossed.arrows[2]!];
  const midY = (first.points[0]!.y + second.points.at(-1)!.y) / 2;
  first.points.splice(1, 0, { x: first.points[0]!.x - 60, y: midY }, { x: first.points[0]!.x + 60, y: midY });
  second.points.splice(1, 0, { x: second.points[0]!.x + 60, y: midY - 30 }, { x: second.points[0]!.x - 60, y: midY + 30 });
  assert(verifyBlockFlowLayout(crossed).some((problem) => /cross$/.test(problem)), "two arrows crossing");
  const spill = structuredClone(pay);
  spill.boxLines[0]!.ink = { ...spill.boxLines[0]!.ink, width: 400 };
  assert(verifyBlockFlowLayout(spill).some((problem) => /not inside its box/.test(problem)), "box text spilling out");
});

row("structure: orphans, self loops, duplicates, sizes and unknown ends refuse", () => {
  refuses({ ...payInputs, nodes: [...payInputs.nodes, node("lost", "Ledger")] }, /not connected/, "orphan box");
  refuses({ ...payInputs, edges: [...payInputs.edges, edge("acq", "acq", "loops")] }, /self loop/, "self loop");
  refuses({ ...payInputs, edges: [...payInputs.edges, edge("acq", "net", "again")] }, /same boxes/, "duplicate arrow");
  refuses({ ...payInputs, edges: [...payInputs.edges, edge("acq", "ghost", "goes")] }, /not declared/, "unknown end");
  refuses({ ...payInputs, edges: [{ ...payInputs.edges[0]!, label: "  " }, ...payInputs.edges.slice(1)] }, /must not be empty/, "unlabelled arrow");
  refuses({ nodes: payInputs.nodes.slice(0, 2), edges: payInputs.edges.slice(0, 1) }, /3 to 8 nodes/, "too few boxes");
  refuses({ ...payInputs, nodes: Array.from({ length: 9 }, (_, index) => node(`n${index}`, `Part ${index}`)) }, /3 to 8 nodes/, "too many boxes");
  refuses({ ...payInputs, nodes: [...payInputs.nodes.slice(0, 4), node("bank", "Card")] }, /same label/, "two boxes one label");
  refuses({ ...payInputs, extra: 1 }, /unsupported inputs/, "unknown input");
  refuses({ ...payInputs, nodes: [{ ...payInputs.nodes[0]!, x: 400 }, ...payInputs.nodes.slice(1)] }, /unsupported fields/, "a planner coordinate");
});

row("two arrows that must cross refuse the figure instead of drawing it", () => {
  const nodes = [node("a", "Store"), node("b", "Engine one"), node("c", "Engine two"), node("d", "Pool one"), node("e", "Pool two")];
  const edges = [edge("a", "b", "x"), edge("a", "c", "x"), edge("b", "d", "x"), edge("b", "e", "x"), edge("c", "d", "x"), edge("c", "e", "x")];
  refuses({ nodes, edges }, /crossing|clear place|does not fit/, "complete bipartite rank pair");
});

row("labels wrap at 16 characters, break after a slash, and refuse an unbreakable word", () => {
  assert.deepEqual(wrapBlockFlowLabel("approves/declines", 2), ["approves/", "declines"]);
  assert.deepEqual(wrapBlockFlowLabel("Interrupt service routine", 3), ["Interrupt", "service routine"]);
  assert.equal(wrapBlockFlowLabel("Telecommunications", 3), null);
  refuses({ ...payInputs, nodes: [...payInputs.nodes.slice(0, 4), node("bank", "Internationalisation")] }, /cannot wrap/, "a 20 letter word");
});

row("grounding: every box and arrow is in the plan's claims, in the claim's order", () => {
  assert.deepEqual(validateBlockFlowGrounding(payInputs, payPlan), []);
  const problems = (inputs: Partial<typeof payInputs>) => validateBlockFlowGrounding({ ...payInputs, ...inputs }, payPlan);
  assert.match(problems({ nodes: [...payInputs.nodes.slice(0, 4), node("bank", "Central bank")] }).join(";"), /not named in its cited claims/, "an invented box");
  assert.match(problems({ nodes: [node("card", "Card", ["c9"]), ...payInputs.nodes.slice(1)] }).join(";"), /claim the plan does not have/, "an unknown claim");
  assert.match(problems({ edges: [edge("card", "acq", "exchange data", "c1"), ...payInputs.edges.slice(1)] }).join(";"), /does not state both/, "an arrow its claim does not join");
  assert.match(problems({ edges: [edge("card", "reader", "encrypts", "c1"), ...payInputs.edges.slice(1)] }).join(";"), /not stated/, "an invented arrow label");
  assert.match(problems({ edges: [edge("card", "reader", "then", "c1"), ...payInputs.edges.slice(1)] }).join(";"), /not stated/, "a filler word label");
  assert.match(problems({ edges: [...payInputs.edges.slice(0, 3), edge("bank", "net", "routes")] }).join(";"), /against the order/, "a reversed chain arrow");
  assert.match(problems({ nodes: [node("card", "the", ["c1"]), ...payInputs.nodes.slice(1)] }).join(";"), /no content word/, "a box with no content word");
  // A hint list names parts, not how they relate: no arrow may rest on it.
  const listed = plan([...payClaims, claim("c3", "The parts of the system.", ["card", "issuing bank"])]);
  assert.deepEqual(validateBlockFlowGrounding({ ...payInputs, nodes: [node("card", "Card", ["c3"]), ...payInputs.nodes.slice(1)] }, listed), [], "a box may rest on a hint");
  assert.match(validateBlockFlowGrounding({ ...payInputs, edges: [...payInputs.edges, edge("card", "bank", "parts", "c3")] }, listed).join(";"), /in its words/, "an arrow resting on a hint list");
});

row("the plan's own structure, not its words, decides an optional diagram", () => {
  assert.equal(planDescribesLinkedComponents(payPlan), true, "four components joined over two claims");
  assert.equal(planDescribesLinkedComponents(plan([claim("c1", "The topic could mean several things.", ["cloud", "framework", "services"])])), false, "one claim listing three names");
  assert.equal(planDescribesLinkedComponents(plan([claim("c1", "Reader sends request to acquirer to bank.")])), false, "no named components");
  assert.equal(planDescribesLinkedComponents(plan([claim("c1", "x", ["a", "b"]), claim("c2", "y", ["c", "d"])])), false, "two unconnected pairs");
});

// ---------------------------------------------------------------- admission

row("the subject test reads the accepted plan's subject and the flag only", () => {
  const base = { enabled: true, plannedSubject: "other", codeLesson: false, dsa: false };
  assert.equal(blockFlowEligibleTurn(base), true);
  assert.equal(blockFlowEligibleTurn({ ...base, enabled: false }), false, "flag off");
  assert.equal(blockFlowEligibleTurn({ ...base, plannedSubject: "physics" }), false, "physics");
  assert.equal(blockFlowEligibleTurn({ ...base, plannedSubject: undefined }), false, "no classified subject");
  assert.equal(blockFlowEligibleTurn({ ...base, dsa: true }), false, "DSA lesson");
  assert.equal(blockFlowEligibleTurn({ ...base, codeLesson: true }), false, "code lesson");
});

row("flag off: the gate is main's gate for every stem", () => {
  const stems: Array<[string, TurnPlanV3]> = [
    [payPlan.question, payPlan],
    ["A converging lens of focal length 10 cm forms an image of an object 15 cm away. Find the image distance.", plan([], "required")],
    ["Explain how a hash links the blocks of a ledger.", plan([claim("c1", "Each block stores the hash of the previous block.", ["block", "hash"])], "optional")],
  ];
  for (const [question, turnPlan] of stems) {
    const before = deriveSceneGate({ question, turnPlan: { ...turnPlan, question }, problemIR: null });
    const off = deriveSceneGate({ question, turnPlan: { ...turnPlan, question }, problemIR: null, blockFlowEligible: false });
    assert.deepEqual(off, before, `flag off is identical for ${question}`);
    assert.equal(before.blockFlowAdmitted, false);
    assert(!(before.request.constructionOperators ?? []).includes("block_flow"), "block_flow never leaks into a request");
  }
});

row("eligible: admitted only where the planner is never asked today", () => {
  const admitted = deriveSceneGate({ question: payPlan.question, turnPlan: payPlan, problemIR: null, blockFlowEligible: true });
  assert.equal(admitted.blockFlowAdmitted, true);
  assert.equal(admitted.shouldAttemptLlmScene, true);
  assert.deepEqual(admitted.request.constructionOperators, ["block_flow"]);
  assert.deepEqual(admitted.request.planningGuidance, [...BLOCK_FLOW_SCENE_REQUEST.planningGuidance]);
  const optionalFlat = plan([claim("c1", "The topic could mean several things.", ["cloud", "framework", "services"])], "optional");
  assert.equal(deriveSceneGate({ question: "cloud architecture", turnPlan: { ...optionalFlat, question: "cloud architecture" }, problemIR: null, blockFlowEligible: true }).blockFlowAdmitted, false, "optional without structure");
  assert.equal(deriveSceneGate({ question: "cloud architecture", turnPlan: { ...optionalFlat, question: "cloud architecture", visualRequirement: "required" }, problemIR: null, blockFlowEligible: true }).blockFlowAdmitted, false, "required without structure");
  assert.equal(deriveSceneGate({ question: payPlan.question, turnPlan: { ...payPlan, visualRequirement: "optional" }, problemIR: null, blockFlowEligible: true }).blockFlowAdmitted, true, "optional with structure");
  assert.equal(deriveSceneGate({ question: payPlan.question, turnPlan: { ...payPlan, visualRequirement: "none" }, problemIR: null, blockFlowEligible: true }).blockFlowAdmitted, false, "no visual");
  const lens = "A converging lens of focal length 10 cm forms an image of an object 15 cm away. Find the image distance.";
  const lensPlan = { ...plan([], "required"), question: lens };
  const lensGate = deriveSceneGate({ question: lens, turnPlan: lensPlan, problemIR: null, blockFlowEligible: true });
  assert.equal(lensGate.blockFlowAdmitted, false, "a turn that asks the planner today keeps its request");
  assert.deepEqual(lensGate, deriveSceneGate({ question: lens, turnPlan: lensPlan, problemIR: null }), "identical to main");
});

row("validation: refused unless admitted, grounded, and alone", () => {
  const candidate = document(payInputs);
  const ok = validateProductionSceneCandidate({ candidate, question: payPlan.question, turnPlan: payPlan, blockFlowEligible: true });
  assert.equal(ok.valid, true, JSON.stringify(ok.errors));
  const kinds = new Set(ok.value!.renderScene.primitives.map((primitive) => primitive.kind));
  assert.deepEqual([...kinds].sort(), ["label", "rectangle", "vector"]);
  const notAdmitted = validateProductionSceneCandidate({ candidate, question: payPlan.question, turnPlan: payPlan });
  assert.equal(notAdmitted.valid, false);
  assert(notAdmitted.errors.some((issue) => issue.code === "block_flow_not_admitted"));
  const invented = document({ ...payInputs, nodes: [...payInputs.nodes.slice(0, 4), node("bank", "Central bank")] });
  const ungrounded = validateProductionSceneCandidate({ candidate: invented, question: payPlan.question, turnPlan: payPlan, blockFlowEligible: true });
  assert.equal(ungrounded.valid, false);
  assert(ungrounded.errors.some((issue) => issue.code === "block_flow_ungrounded"));
  const crowded = document(payInputs, {
    entities: [{ id: "flow", kind: "block_flow", role: "diagram" }, { id: "p", kind: "point", role: "marker", label: "P" }],
    constructions: [{ id: "k_flow", operator: "block_flow", inputs: payInputs, outputs: ["flow"] }, { id: "k_p", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["p"] }],
    requiredEntityIds: ["flow", "p"], revealGroups: [{ id: "g_flow", entityIds: ["flow", "p"] }],
  });
  const notAlone = validateProductionSceneCandidate({ candidate: crowded, question: payPlan.question, turnPlan: payPlan, blockFlowEligible: true });
  assert.equal(notAlone.valid, false);
  assert(notAlone.errors.some((issue) => /nothing else/.test(issue.message)));
  const bare = validateSceneDocument(candidate);
  assert.equal(compileSceneDocument(bare.document!).ok, true, "the engine compiles it on its own");
  assert.deepEqual(blockFlowGroundingIssues(bare.document!, payPlan), []);
});

row("prompt: the universal catalog never offers block_flow, the scoped request does", () => {
  assert(SUPPORTED_SCENE_CONSTRUCTION_OPERATORS.includes("block_flow" as never), "executable");
  assert(!PLANNER_VISIBLE_SCENE_CONSTRUCTION_OPERATORS.includes("block_flow" as never), "not in the universal catalog");
  const universal = buildSceneDocumentPlannerPrompt("Explain a lens.", {});
  const everything = buildSceneDocumentPlannerPrompt("Explain a lens.", { constructionOperators: SUPPORTED_SCENE_CONSTRUCTION_OPERATORS });
  assert(!universal.includes("block_flow") && !everything.includes("block_flow"), "no block_flow text in a full catalog prompt");
  const scoped = buildSceneDocumentPlannerPrompt(payPlan.question, {
    constructionOperators: BLOCK_FLOW_SCENE_REQUEST.constructionOperators, proofPredicates: BLOCK_FLOW_SCENE_REQUEST.proofPredicates,
    planningGuidance: BLOCK_FLOW_SCENE_REQUEST.planningGuidance,
  });
  assert(scoped.includes("- block_flow: {nodes:"), "the scoped request carries the contract");
});

row("selection: an admitted grounded diagram is the turn's planner figure on the other lane", () => {
  const decision = liveDiagramStrategyDecision({
    assignedStrategy: "current", subject: "other", strictSubjects: ["maths", "physics"], chemistryLane: false, codeLesson: false, dsa: false, doubt: false,
  });
  const policy = { preferPlanner: false, allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(decision, source)) };
  const input = {
    question: payPlan.question, turnPlan: payPlan, problemIR: null, exactFigureSource: "planner" as const,
    solverAuthorityBlocked: false, requiredRetryEnabled: true, completionEnabled: false, solverAuthority: null, policy,
  };
  const drawn = selectProductionScene({ ...input, blockFlowEligible: true, candidate: document(payInputs) });
  assert.equal(drawn.representation?.figureSource, "planner", drawn.reason);
  assert.equal(drawn.saveFailure, null);
  const off = selectProductionScene({ ...input, candidate: document(payInputs) });
  assert.equal(off.representation, null, "flag off draws nothing");
});

console.log(`verify-block-flow: ok (${rows} rows)`);
