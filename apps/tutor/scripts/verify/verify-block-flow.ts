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
  BLOCK_FLOW_LINE_CHARS, BLOCK_FLOW_ZONE, blockFlowChain, blockFlowGroundingIssues, evaluateBlockFlowConstruction, planStatesChain,
  validateBlockFlowGrounding, verifyBlockFlowLayout, wrapBlockFlowLabel, type BlockFlowDefinition,
} from "../../../../packages/scene-engine/src/compile/blockFlowGeometry";
import { buildSceneDocumentPlannerPrompt } from "../../../../packages/tutor-core/src/planners/scenePlannerV2Prompt";
import { BLOCK_FLOW_SCENE_REQUEST } from "../../../../packages/tutor-core/src/planners/sceneCapabilities";
import { blockFlowEligibleTurn } from "../../features/tutor-session/lib/scene/diagramGeneration";
import { BLOCK_FLOW_REVIEW_DECLINED, RESTATED_PROCESS_CLAIM_ID, reviewBlockFlowScene, withRestatedProcess } from "../../features/tutor-session/lib/scene/blockFlowReview";
import { parseProcessReviewVerdict, PROCESS_REVIEW_VOTES, reviewProcessChains, writeProcessClaim } from "../../../../packages/tutor-core/src/planners/processReview";
import { blockFlowCitedProcesses } from "../../../../packages/scene-engine/src/compile/blockFlowGeometry";
import { resolveChatGenerationKind } from "../../lib/obs/chatTrace";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { PROCESS_REVIEW_MAX_CONCURRENT } from "../../../../packages/tutor-core/src/planners/processReview";
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
  claim("c1", "The card and the reader talk over short range radio at 13.56 MHz.", ["card", "reader"]),
  claim("c2", "Process: card is tapped → reader sends request → acquirer forwards it → card network routes it → issuing bank approves or declines.", ["reader", "acquirer", "card network", "issuing bank"]),
];
const payInputs = {
  nodes: [node("card", "Card is tapped"), node("reader", "Reader sends request"), node("acq", "Acquirer forwards it"), node("net", "Card network routes it"), node("bank", "Issuing bank approves or declines")],
  edges: [edge("card", "reader", ""), edge("reader", "acq", ""), edge("acq", "net", ""), edge("net", "bank", "")],
};
// Layout handles arrow labels even though grounding admits none: the verifier rows need some.
const layoutInputs = { ...payInputs, edges: [edge("card", "reader", ""), edge("reader", "acq", "sends"), edge("acq", "net", "forwards"), edge("net", "bank", "routes")] };
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
  pay = evaluateBlockFlowConstruction("block_flow", layoutInputs)[0]!.blockFlow;
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
  const line = label.arrows[1]!.labelLines[0]!;
  const target = label.boxes[2]!;
  line.ink = { x: target.x + 2, y: target.y + 2, width: 20, height: 10 };
  assert(verifyBlockFlowLayout(label).some((problem) => /touches box/.test(problem)), "an arrow label on a box");
  assert.equal(pay.arrows[0]!.labelLines.length, 0, "an unlabelled chain step draws no label");
  const dropped = structuredClone(pay);
  dropped.arrows[1]!.labelLines = [];
  assert(verifyBlockFlowLayout(dropped).some((problem) => /exactly its stated label/.test(problem)), "a stated label that went missing");
  const loose = structuredClone(pay);
  const [tail, head] = [loose.arrows[0]!.points.at(-2)!, loose.arrows[0]!.points.at(-1)!];
  const run = Math.hypot(head.x - tail.x, head.y - tail.y);
  loose.arrows[0]!.points[loose.arrows[0]!.points.length - 1] = { x: head.x - (head.x - tail.x) / run * 20, y: head.y - (head.y - tail.y) / run * 20 };
  assert(verifyBlockFlowLayout(loose).some((problem) => /does not join its boxes/.test(problem)), "an arrow that stops short");
  const out = structuredClone(pay);
  out.boxes[0] = { ...out.boxes[0]!, x: 380 };
  assert(verifyBlockFlowLayout(out).some((problem) => /leaves the diagram zone/.test(problem)), "a box left of x 410");
  const crossed = structuredClone(pay);
  const [first, second] = [crossed.arrows[1]!, crossed.arrows[2]!];
  const [a, b] = [first.points[0]!, first.points.at(-1)!];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const normal = { x: -(b.y - a.y) / length * 30, y: (b.x - a.x) / length * 30 };
  second.points = [second.points[0]!, { x: mid.x - normal.x, y: mid.y - normal.y }, { x: mid.x + normal.x, y: mid.y + normal.y }, second.points.at(-1)!];
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
  refuses({ ...payInputs, nodes: [...payInputs.nodes.slice(0, 4), node("bank", "Card is tapped")] }, /same label/, "two boxes one label");
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

row("grounding: a box is a whole step and an arrow is one step of a clean chain the plan writes", () => {
  assert.deepEqual(validateBlockFlowGrounding(payInputs, payPlan), []);
  const problems = (inputs: Partial<typeof payInputs>, onPlan = payPlan) => validateBlockFlowGrounding({ ...payInputs, ...inputs }, onPlan).join(";");
  const withNode = (replacement: ReturnType<typeof node>) => problems({ nodes: payInputs.nodes.map((item) => item.id === replacement.id ? replacement : item) });
  const withEdge = (replacement: ReturnType<typeof edge>, at = 3) => problems({ edges: payInputs.edges.map((item, index) => index === at ? replacement : item) });
  // Boxes: invented, partial, out of another sentence, a changed number, an arrow inside.
  assert.match(withNode(node("bank", "Central bank approves")), /not a whole step/, "an invented box");
  assert.match(withNode(node("bank", "Issuing bank")), /not a whole step/, "part of a step");
  assert.match(withNode(node("bank", "Card → Bank")), /not a whole step/, "a box that asserts a flow");
  assert.match(withNode(node("card", "13.56 MHz", ["c1"])), /not a whole step/, "a phrase of prose");
  assert.match(withNode(node("card", "Card is tapped", ["c9"])), /claim the plan does not have/, "an unknown claim");
  assert.equal(withNode(node("card", "CARD  is tapped")), "", "case and spacing are not words");
  // Arrows: reversed, skipped, labelled, from prose, from a disagreeing or repeated chain.
  assert.match(withEdge(edge("bank", "net", "")), /not one step/, "a reversed chain arrow");
  assert.match(withEdge(edge("reader", "net", "")), /not one step/, "a skipped step");
  assert.match(withEdge(edge("net", "bank", "routes")), /carries words/, "a labelled arrow");
  assert.match(withEdge(edge("net", "bank", "", "c1")), /does not state a chain/, "an arrow from prose");
  const disagree = plan([{ ...payClaims[1]!, expected: "Process: card is tapped → acquirer forwards it → reader sends request" }]);
  assert.match(problems({}, disagree), /two different chains/, "claim and expected chains disagree");
  const repeated = plan([claim("c2", "Process: card is tapped → reader sends request → card is tapped → issuing bank approves or declines")]);
  assert.match(validateBlockFlowGrounding({ nodes: [node("card", "Card is tapped"), node("reader", "Reader sends request"), node("bank", "Issuing bank approves or declines")],
    edges: [edge("card", "reader", ""), edge("reader", "card", "")] }, repeated).join(";"), /not one step/, "a step the chain writes twice");
});

row("only a clean chain counts: no buried chains, clause breaks or code arrows", () => {
  const chain = (text: string) => blockFlowChain(text)?.steps ?? null;
  assert.deepEqual(chain("Flow: tap → terminal reads card → bank approves."), ["tap", "terminal reads card", "bank approves"]);
  assert.deepEqual(chain("10110110 -> 1011 0110 -> B6"), ["10110110", "1011 0110", "b6"]);
  assert.deepEqual(chain("Signal at 13.56 MHz → card wakes → chip answers"), ["signal at 13.56 mhz", "card wakes", "chip answers"]);
  assert.equal(chain("Mouth (amylase) → oesophagus → stomach"), null, "parentheses");
  assert.equal(chain("Nostrils → trachea → alveoli. Breathing uses the diaphragm."), null, "a later sentence");
  assert.equal(chain("ventricle → artery → lungs, never ventricle → aorta"), null, "a negated clause");
  assert.equal(chain("Read head->next->data to walk the list"), null, "code arrows");
  assert.equal(chain("Process: bill passes → president signs or vetoes → congress may override"), null, "a choice followed by more steps");
  assert.deepEqual(chain("Process: card is tapped → reader sends request → bank approves or declines"), ["card is tapped", "reader sends request", "bank approves or declines"], "a choice may end the chain");
  assert.deepEqual(chain("Process: order placed → orchestra plays → doors close"), ["order placed", "orchestra plays", "doors close"], "or inside a word is not a choice");
  assert.equal(chain("The flow is tap then pay."), null, "prose");
  assert.equal(chain("Bad heading; more: a → b → c"), null, "a heading with a clause break");
});

row("the plan's own notation, not the question's words, decides admission", () => {
  assert.equal(planStatesChain(payPlan), true, "a clean chain of five steps");
  assert.equal(planStatesChain(plan([claim("c1", "Process: card → reader.")])), false, "two steps");
  assert.equal(planStatesChain(plan([claim("c1", "Process: mouth (amylase) → oesophagus → stomach → intestine")])), false, "a step with a clause break");
  assert.equal(planStatesChain(plan([claim("c1", "Components: internal records → intelligence → research → analysis")])), false, "arrows on a list of parts");
  assert.equal(planStatesChain(plan([claim("c1", "card is tapped → reader sends request → bank approves")])), false, "a chain with no Process heading");
  const listed = plan([claim("c1", "Components: card is tapped → reader sends request → acquirer forwards it")]);
  assert.match(validateBlockFlowGrounding({ nodes: payInputs.nodes.slice(0, 3).map((item) => ({ ...item, claimIds: ["c1"] })),
    edges: [edge("card", "reader", "", "c1"), edge("reader", "acq", "", "c1")] }, listed).join(";"), /does not state a chain/, "a figure from a list heading");
  assert.equal(planStatesChain(plan([claim("c1", "Reader sends request to acquirer to bank.", ["reader", "acquirer", "bank"])])), false, "prose with named parts");
  assert.equal(planStatesChain(plan([claim("c1", "Process: a → b → a")])), false, "a step written twice");
  // A route the plan rejects is never a process, and a condition in the heading is never dropped.
  const rejected = { ...claim("c1", "Process: right ventricle → aorta → body"), expected: false };
  assert.equal(planStatesChain(plan([rejected])), false, "a claim marked false");
  assert.match(validateBlockFlowGrounding({ nodes: [node("a", "right ventricle", ["c1"]), node("b", "aorta", ["c1"]), node("c", "body", ["c1"])],
    edges: [edge("a", "b", "", "c1"), edge("b", "c", "", "c1")] }, plan([rejected])).join(";"), /not a whole step|does not state a chain/, "a false claim grounds nothing");
  assert.equal(planStatesChain(plan([claim("c1", "On timeout: request sent → retry scheduled → request resent")])), false, "a conditional heading is not a process");
  assert.equal(planStatesChain(plan([claim("c1", "x", ["a", "b", "c"]), claim("c2", "y", ["a", "b", "c"])])), false, "shared hints");
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
  const optionalFlat = plan([claim("c1", "The service connects the cloud, the framework and the services.", ["cloud", "framework", "services"]), claim("c2", "The framework sits on the cloud.", ["cloud", "framework", "services"])], "optional");
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
  const invented = document({ ...payInputs, nodes: [...payInputs.nodes.slice(0, 4), node("bank", "Central bank approves")] });
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
  const titled = validateProductionSceneCandidate({ candidate: document(payInputs, { entities: [{ id: "flow", kind: "block_flow", role: "diagram", label: "Payment stages" }] }),
    question: payPlan.question, turnPlan: payPlan, blockFlowEligible: true });
  assert.equal(titled.valid, true);
  assert(!titled.value!.renderScene.primitives.some((primitive) => primitive.text === "Payment stages"), "an ungrounded title is never drawn");
  const narrated = document(payInputs, { annotations: [{ id: "a1", kind: "narration", targetIds: ["flow"], text: "Sent to the bank" }] });
  assert.equal(validateProductionSceneCandidate({ candidate: narrated, question: payPlan.question, turnPlan: payPlan, blockFlowEligible: true }).valid, true, "narration notes are dropped, not drawn");
  assert.match(blockFlowGroundingIssues(validateSceneDocument(narrated).document!, payPlan).map((issue) => issue.message).join(";"), /remove annotation a1/, "the refusal names what to remove");
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

// ------------------------------------------------------------------ review

/** A fake proxy: each call pops the next scripted answer ("PROCESS", "NOT", or "fail"). */
function scriptedProxy(answers: string[]) {
  const calls: Headers[] = [];
  const bodies: string[] = [];
  const fetchImpl = (async (_url: unknown, init: RequestInit) => {
    calls.push(new Headers(init.headers));
    bodies.push(String(init.body));
    const answer = answers.shift() ?? "fail";
    if (answer === "fail") return new Response("upstream", { status: 502 });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ verdict: answer }) } }] });
  }) as typeof fetch;
  return { fetchImpl, calls, bodies };
}
const reviewOptions = (fetchImpl: typeof fetch) => ({ proxyUrl: "http://lab/api/chat", timeoutMs: 1_000, fetchImpl });

void (async () => {
  const name = "review: only a unanimous PROCESS keeps a block diagram, and nothing else is asked";
  try {
    assert.equal(parseProcessReviewVerdict('{"verdict":"PROCESS"}'), "PROCESS");
    assert.equal(parseProcessReviewVerdict("PROCESS"), null, "a bare word is no answer");
    const steps = [["card is tapped", "reader sends request", "bank approves"]];
    const all = scriptedProxy(Array(PROCESS_REVIEW_VOTES).fill("PROCESS"));
    assert.equal((await reviewProcessChains("q", steps, reviewOptions(all.fetchImpl))).verdict, "process");
    assert.equal(all.calls.length, PROCESS_REVIEW_VOTES);
    assert(all.calls.every((headers) => headers.get("x-planner") === "1" && headers.get("x-process-review") === "1"), "review headers");
    assert.equal(resolveChatGenerationKind(all.calls[0]!), "process-review");
    // Three different questions, each seeing the plan's claims, never one question asked three times.
    const systems = all.bodies.map((body) => JSON.parse(body).messages[0].content as string);
    assert.equal(new Set(systems).size, PROCESS_REVIEW_VOTES, "each vote asks a different question");
    const withClaims = scriptedProxy(Array(PROCESS_REVIEW_VOTES).fill("PROCESS"));
    await reviewProcessChains("q", steps, reviewOptions(withClaims.fetchImpl), payPlan);
    assert(withClaims.bodies.every((body) => (JSON.parse(body).messages[1].content as string).includes("issuing bank approves or declines")), "votes see the plan's claims");
    assert.equal((await reviewProcessChains("q", steps, reviewOptions(scriptedProxy(["PROCESS", "NOT", "PROCESS", "PROCESS"]).fetchImpl))).verdict, "not", "one NOT");
    assert.equal((await reviewProcessChains("q", steps, reviewOptions(scriptedProxy(["PROCESS", "fail", "PROCESS", "PROCESS"]).fetchImpl))).verdict, "unavailable", "one failed vote");
    assert.equal((await reviewProcessChains("q", [], reviewOptions(scriptedProxy([]).fetchImpl))).verdict, "not", "no process");
    // The judge reads the steps exactly as the plan wrote them.
    const validated = validateProductionSceneCandidate({ candidate: document(payInputs), question: payPlan.question, turnPlan: payPlan, blockFlowEligible: true });
    assert.deepEqual(blockFlowCitedProcesses(validated.value!.document, payPlan),
      [["card is tapped", "reader sends request", "acquirer forwards it", "card network routes it", "issuing bank approves or declines"]]);
    const result = { validation: validated };
    const kept = await reviewBlockFlowScene(result, { question: payPlan.question, turnPlan: payPlan, options: reviewOptions(scriptedProxy(Array(PROCESS_REVIEW_VOTES).fill("PROCESS")).fetchImpl) });
    assert.equal(kept.result?.validation.valid, true);
    const refused = await reviewBlockFlowScene(result, { question: payPlan.question, turnPlan: payPlan, options: reviewOptions(scriptedProxy(Array(PROCESS_REVIEW_VOTES).fill("NOT")).fetchImpl) });
    assert.equal(refused.result?.validation.valid, false);
    assert.equal(refused.result?.validation.errors[0]?.code, BLOCK_FLOW_REVIEW_DECLINED);
    const silent = scriptedProxy([]);
    const lens = { validation: { valid: true, errors: [], value: { document: { ...validated.value!.document, constructions: [] } } } };
    assert.equal((await reviewBlockFlowScene(lens, { question: "q", turnPlan: payPlan, options: reviewOptions(silent.fetchImpl) })).review, null);
    assert.equal(silent.calls.length, 0, "a figure without a block diagram costs no review");
    assert.deepEqual(await reviewBlockFlowScene(null, { question: "q", turnPlan: payPlan, options: reviewOptions(silent.fetchImpl) }), { result: null, review: null });
    rows++;
  } catch (error) { console.error(`verify-block-flow: FAIL ${name}`); throw error; }
})().then(async () => {
  const name = "restated process: asked only where a figure could follow, every step cites its claim and passes its own check";
  try {
    /** A proxy that answers the writer with scripted steps and each step check with the next scripted verdict. */
    const fake = (steps: unknown, checks: string[] = []) => {
      const calls: Array<{ kind: string | null; body: string }> = [];
      let inFlight = 0, peak = 0;
      const fetchImpl = (async (_url: unknown, init: RequestInit) => {
        const kind = new Headers(init.headers).get("x-process-review");
        calls.push({ kind, body: String(init.body) });
        inFlight++; peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight--;
        if (kind === "write") return Response.json({ choices: [{ message: { content: JSON.stringify({ steps }) } }] });
        const verdict = checks.shift() ?? "fail";
        if (verdict === "fail") return new Response("upstream", { status: 502 });
        return Response.json({ choices: [{ message: { content: JSON.stringify({ verdict }) } }] });
      }) as typeof fetch;
      return { fetchImpl, calls, peak: () => peak };
    };
    const prose = plan([
      claim("c1", "When a card is tapped the reader sends a request to the acquirer."),
      claim("c2", "The acquirer forwards the request to the bank, which approves it."),
    ], "optional");
    const cited = [
      { step: "card is tapped", claim: "c1" }, { step: "reader sends request", claim: "c1" },
      { step: "acquirer forwards it", claim: "c2" }, { step: "bank approves", claim: "c2" },
    ];
    const clean = "Process: card is tapped → reader sends request → acquirer forwards it → bank approves";
    const ask = (turnPlan: TurnPlanV3, steps: unknown, checks: string[] = [], eligible = true, question = "How does tap to pay work?") => {
      const proxy = fake(steps, checks);
      return withRestatedProcess({ question, turnPlan, eligible, options: reviewOptions(proxy.fetchImpl) })
        .then((out) => ({ out, calls: proxy.calls, peak: proxy.peak() }));
    };
    const kept = await ask(prose, cited, ["PASS", "PASS", "PASS", "PASS"]);
    assert.deepEqual(kept.calls.map((call) => call.kind), ["write", "step", "step", "step", "step"], "one writer call, then one check per step");
    assert(kept.calls[0]!.body.includes("c1: When a card is tapped"), "the writer sees each claim with its id");
    const thirdCheck = JSON.parse(kept.calls[3]!.body).messages[1].content as string;
    assert(thirdCheck.includes("Cited claim (c2): The acquirer forwards") && thirdCheck.includes("Step: acquirer forwards it") &&
      thirdCheck.includes("Step before: reader sends request") && thirdCheck.includes("Step after: bank approves"), "a step is checked against its own claim");
    assert(kept.peak <= PROCESS_REVIEW_MAX_CONCURRENT, `step checks stay within the in-flight limit (${kept.peak})`);
    assert.equal(kept.out.restated, clean);
    assert.deepEqual(kept.out.steps?.map((item) => item.claimId), ["c1", "c1", "c2", "c2"]);
    assert.equal(kept.out.turnPlan.qualitativeClaims.at(-1)?.id, RESTATED_PROCESS_CLAIM_ID);
    assert.equal(planStatesChain(kept.out.turnPlan), true, "the restated process admits the figure");
    for (const [label, turnPlan, eligible, question] of [
      ["flag off", prose, false, "How does tap to pay work?"],
      ["no visual", { ...prose, visualRequirement: "none" as const }, true, "How does tap to pay work?"],
      ["already a process", payPlan, true, "How does tap to pay work?"],
      ["the planner is asked today", { ...prose, question: "A converging lens of focal length 10 cm forms an image of an object 15 cm away." }, true, "A converging lens of focal length 10 cm forms an image of an object 15 cm away."],
    ] as const) {
      const none = await ask(turnPlan, cited, ["PASS", "PASS", "PASS", "PASS"], eligible, question);
      assert.equal(none.calls.length, 0, `${label}: no call`);
      assert.equal(none.out.turnPlan, turnPlan, `${label}: plan untouched`);
    }
    // Writer answers that are never kept, and never checked.
    const withFalse = plan([...prose.qualitativeClaims, { ...claim("c3", "The terminal prints a receipt first."), expected: false }], "optional");
    for (const [label, turnPlan, steps] of [
      ["no process", prose, null],
      ["two steps", prose, cited.slice(0, 2)],
      ["a step without a claim", prose, [{ step: "card is tapped" }, ...cited.slice(1)]],
      ["an unknown claim", prose, [{ step: "card is tapped", claim: "c9" }, ...cited.slice(1)]],
      ["a claim the plan rejects", withFalse, [{ step: "terminal prints receipt", claim: "c3" }, ...cited.slice(1)]],
      ["a restated claim cited", prose, [{ step: "card is tapped", claim: RESTATED_PROCESS_CLAIM_ID }, ...cited.slice(1)]],
      ["brackets", prose, [{ step: "card (or phone) is tapped", claim: "c1" }, ...cited.slice(1)]],
      ["a long step", prose, [{ step: "a".repeat(61), claim: "c1" }, ...cited.slice(1)]],
      ["the old one-line answer", prose, "Process: card is tapped → reader sends request → bank approves"],
    ] as const) {
      const dropped = await ask(turnPlan, steps, ["PASS", "PASS", "PASS", "PASS"]);
      assert.equal(dropped.out.restated, null, `${label} is dropped`);
      assert.equal(dropped.out.turnPlan, turnPlan, `${label}: plan untouched`);
      assert(dropped.calls.every((call) => call.kind === "write"), `${label}: no step is checked`);
    }
    // One step that fails its own check, or one check with no answer, keeps the plan untouched.
    for (const [label, checks, verdict] of [
      ["one FAIL", ["PASS", "FAIL", "PASS", "PASS"], "fail"], ["one unanswered check", ["PASS", "PASS", "fail", "PASS"], "unavailable"],
    ] as const) {
      const failed = await ask(prose, cited, [...checks]);
      assert.equal(failed.out.restated, null, `${label}: dropped`);
      assert.equal(failed.out.turnPlan, prose, `${label}: plan untouched`);
      assert.equal(failed.out.stepChecks?.verdict, verdict, label);
    }
    assert.equal(await writeProcessClaim("q", prose, reviewOptions((async () => new Response("no", { status: 500 })) as typeof fetch)), null, "a failed call");
    // A route the plan rejects never reaches the writer, never comes back true, and reviewers see it marked.
    const rejectedPlan = plan([
      { ...claim("c1", "Process: right ventricle → aorta → body"), expected: false },
      claim("c2", "Blood leaves the right ventricle for the lungs, then returns to the left atrium."),
    ], "optional");
    const echo = fake([{ step: "right ventricle", claim: "c2" }, { step: "aorta", claim: "c2" }, { step: "body", claim: "c2" }], ["PASS", "PASS", "PASS"]);
    const out = await withRestatedProcess({ question: "Where does blood go from the right ventricle?", turnPlan: rejectedPlan, eligible: true, options: reviewOptions(echo.fetchImpl) });
    assert.equal(echo.calls[0]?.kind, "write", "the writer is asked");
    assert(!echo.calls[0]!.body.includes("aorta"), "the writer never sees the rejected route");
    assert.equal(out.restated, null, "a restated rejected route is dropped");
    assert.equal(out.turnPlan, rejectedPlan, "the plan stays untouched");
    const reviewBodies = scriptedProxy(Array(PROCESS_REVIEW_VOTES).fill("PROCESS"));
    await reviewProcessChains("q", [["right ventricle", "lungs", "left atrium"]], reviewOptions(reviewBodies.fetchImpl), rejectedPlan);
    assert(reviewBodies.bodies.every((body) => body.includes("REJECTED by the plan (false): Process: right ventricle → aorta → body")), "reviewers see the rejection");
    // The step-check kind is a process review on the trace.
    assert.equal(resolveChatGenerationKind(new Headers({ "x-planner": "1", "x-process-review": "step" })), "process-review");
    rows++;
  } catch (error) { console.error(`verify-block-flow: FAIL ${name}`); throw error; }
}).then(async () => {
  const name = "review calls stay within the account's in-flight limit; repeated box words all reach the board";
  try {
    let inFlight = 0, peak = 0;
    const fetchImpl = (async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ verdict: "PROCESS" }) } }] });
    }) as typeof fetch;
    const two = [["card is tapped", "reader sends request", "bank approves"], ["bank approves", "receipt printed", "customer leaves"]];
    const review = await reviewProcessChains("q", two, reviewOptions(fetchImpl), payPlan);
    assert.equal(review.verdict, "process");
    assert.equal(review.votes.length, 2 * PROCESS_REVIEW_VOTES);
    assert(peak <= PROCESS_REVIEW_MAX_CONCURRENT, `peak in flight ${peak}`);
    const repeated = { nodes: [node("a", "Card is tapped"), node("b", "Reader sends request"), node("c", "Bank sends request")],
      edges: [edge("a", "b", ""), edge("b", "c", "")] };
    const validated = validateSceneDocument(document(repeated));
    const compiled = compileSceneDocument(validated.document!);
    assert.equal(compiled.ok, true);
    const presentation = buildVerifiedDiagramPresentation(validated.document!, compiled.renderScene!);
    const labelTexts = (value: unknown, out: string[] = []): string[] => {
      if (Array.isArray(value)) value.forEach((item) => labelTexts(item, out));
      else if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        if (record.type === "LABEL" && typeof record.text === "string") out.push(`${record.text}@${JSON.stringify(record.params)}`);
        Object.values(record).forEach((item) => labelTexts(item, out));
      }
      return out;
    };
    const written = new Set(labelTexts((presentation as unknown as { diagram: unknown }).diagram).filter((text) => text.startsWith("request@"))).size;
    assert.equal(written, 2, "both boxes write their word \"request\", each in its own place");
    rows++;
  } catch (error) { console.error(`verify-block-flow: FAIL ${name}`); throw error; }
}).then(() => console.log(`verify-block-flow: ok (${rows} rows)`), (error) => {
  console.error(error);
  process.exitCode = 1;
});
