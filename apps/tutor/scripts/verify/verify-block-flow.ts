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
    assert.equal((await reviewProcessChains("q", steps, reviewOptions(scriptedProxy(["PROCESS", "NOT", "PROCESS"]).fetchImpl))).verdict, "not", "one NOT");
    assert.equal((await reviewProcessChains("q", steps, reviewOptions(scriptedProxy(["PROCESS", "fail", "PROCESS"]).fetchImpl))).verdict, "unavailable", "one failed vote");
    assert.equal((await reviewProcessChains("q", [], reviewOptions(scriptedProxy([]).fetchImpl))).verdict, "not", "no process");
    // The judge reads the steps exactly as the plan wrote them.
    const validated = validateProductionSceneCandidate({ candidate: document(payInputs), question: payPlan.question, turnPlan: payPlan, blockFlowEligible: true });
    assert.deepEqual(blockFlowCitedProcesses(validated.value!.document, payPlan),
      [["card is tapped", "reader sends request", "acquirer forwards it", "card network routes it", "issuing bank approves or declines"]]);
    const result = { validation: validated };
    const kept = await reviewBlockFlowScene(result, { question: payPlan.question, turnPlan: payPlan, options: reviewOptions(scriptedProxy(Array(3).fill("PROCESS")).fetchImpl) });
    assert.equal(kept.result?.validation.valid, true);
    const refused = await reviewBlockFlowScene(result, { question: payPlan.question, turnPlan: payPlan, options: reviewOptions(scriptedProxy(["NOT", "NOT", "NOT"]).fetchImpl) });
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
  const name = "restated process: asked only where a figure could follow, kept only when clean";
  try {
    /** A writer proxy answering one scripted {"process": ...}. */
    const writer = (process: unknown) => {
      const calls: Headers[] = [];
      const fetchImpl = (async (_url: unknown, init: RequestInit) => {
        calls.push(new Headers(init.headers));
        return Response.json({ choices: [{ message: { content: JSON.stringify({ process }) } }] });
      }) as typeof fetch;
      return { fetchImpl, calls };
    };
    const prose = plan([claim("c1", "When a card is tapped the reader sends a request that the acquirer forwards to the bank.")], "optional");
    const clean = "Process: card is tapped → reader sends request → acquirer forwards it → bank approves";
    const ask = (turnPlan: TurnPlanV3, process: unknown, eligible = true, question = "How does tap to pay work?") => {
      const proxy = writer(process);
      return withRestatedProcess({ question, turnPlan, eligible, options: reviewOptions(proxy.fetchImpl) }).then((out) => ({ out, calls: proxy.calls }));
    };
    const kept = await ask(prose, clean);
    assert.equal(kept.calls.length, 1);
    assert.equal(kept.calls[0]!.get("x-process-review"), "write");
    assert.equal(kept.out.restated, clean);
    assert.equal(kept.out.turnPlan.qualitativeClaims.at(-1)?.id, RESTATED_PROCESS_CLAIM_ID);
    assert.equal(planStatesChain(kept.out.turnPlan), true, "the restated process admits the figure");
    for (const [label, turnPlan, eligible, question] of [
      ["flag off", prose, false, "How does tap to pay work?"],
      ["no visual", { ...prose, visualRequirement: "none" as const }, true, "How does tap to pay work?"],
      ["already a process", payPlan, true, "How does tap to pay work?"],
      ["the planner is asked today", { ...prose, question: "A converging lens of focal length 10 cm forms an image of an object 15 cm away." }, true, "A converging lens of focal length 10 cm forms an image of an object 15 cm away."],
    ] as const) {
      const none = await ask(turnPlan, clean, eligible, question);
      assert.equal(none.calls.length, 0, `${label}: no call`);
      assert.equal(none.out.turnPlan, turnPlan, `${label}: plan untouched`);
    }
    for (const [label, answer] of [
      ["no process", null], ["brackets", "Process: mouth (amylase) → stomach → intestine"], ["two steps", "Process: tap → pay"],
      ["another heading", "Components: records → intelligence → research"], ["a long step", `Process: ${"a".repeat(61)} → b → c`],
      ["not text", 7],
    ] as const) {
      const dropped = await ask(prose, answer);
      assert.equal(dropped.out.restated, null, `${label} is dropped`);
      assert.equal(dropped.out.turnPlan, prose, `${label}: plan untouched`);
    }
    assert.equal(await writeProcessClaim("q", prose, reviewOptions((async () => new Response("no", { status: 500 })) as typeof fetch)), null, "a failed call");
    rows++;
  } catch (error) { console.error(`verify-block-flow: FAIL ${name}`); throw error; }
}).then(() => console.log(`verify-block-flow: ok (${rows} rows)`), (error) => {
  console.error(error);
  process.exitCode = 1;
});
