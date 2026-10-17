/** Labels are atomic display text; numeric authority retains main's verdicts. */
import assert from "node:assert/strict";
import { compileSceneDocument, pruneUnverifiedSceneAnnotations, validateSceneQuantityAgreement,
  type SceneDocument, type TurnPlanV3 } from "../../../../packages/scene-engine/src/index";
import { textToStrokePaths } from "@heytutor/drawing";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { inferSceneCapabilities } from "@heytutor/tutor-core";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";
import { runWhiteboardVerifier } from "../../../../packages/whiteboard/scripts/runWhiteboardVerifier";

// These are literal authority results captured on main aeb3eb11 before this
// display-only change. A radical that main does not verify is NOT newly accepted.
const PLANS: TurnPlanV3[] = [
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"range","symbol":"R","value":34.64101615137754,"unit":"m","provenance":"given"},{"id":"wind","symbol":"v","value":141.4213562373095,"unit":"km/h","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":34.64101615137754,"unit":"m","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":34.64101615137754,"unit":"A","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":17.32050807568877,"unit":"m","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":-34.64101615137754,"unit":"m","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":273.2050807568877,"unit":"km/h","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":-273.2050807568877,"unit":"km/h","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":1.9318516525781366,"unit":"m","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":-1.7320508075688772,"unit":"m","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":1.7320508075688772,"unit":"m","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":34.64101615137754,"unit":"eV","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":0.5,"unit":"m","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":14.142135623730951,"unit":"m","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":2.83,"unit":"m/s","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":14.142135623730951,"unit":"N","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":8.660254037844386,"unit":"cm","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":21.213203435596427,"unit":"km/h","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":2.4028114141347543,"unit":"m/s","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":19.8,"unit":"m/s","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":10,"unit":"m/s","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":10,"unit":"m/s²","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":30,"unit":"degree","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":20,"unit":"m","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":73.20508075688772,"unit":"km/h","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":34.64,"unit":"m","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":15,"unit":"km/h","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"g","symbol":"g","value":9.8,"unit":"m/s²","provenance":"given"},{"id":"h","symbol":"h","value":20,"unit":"m","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"l","symbol":"l","value":0.99,"unit":"m","provenance":"given"},{"id":"g","symbol":"g","value":9.8,"unit":"m/s²","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":1.9869176531592203,"unit":"s","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[{"id":"given","symbol":"Q","value":2.614393006078474,"unit":"s","provenance":"given"}],"unknowns":[],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[],"unknowns":[{"id":"v","symbol":"v","unit":"m/s"},{"id":"c","symbol":"c","unit":"m/s"}],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[],"unknowns":[{"id":"m","symbol":"m"},{"id":"c","symbol":"c"},{"id":"d","symbol":"d"}],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[],"unknowns":[{"id":"a","symbol":"a"},{"id":"h","symbol":"h"},{"id":"Area","symbol":"Area"},{"id":"s","symbol":"s"}],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},
  {"schemaVersion":"turn-plan/v3","question":"Label the source formula and measurements.","givens":[],"unknowns":[{"id":"F","symbol":"F"},{"id":"m","symbol":"m"},{"id":"g","symbol":"g"},{"id":"θ","symbol":"θ"}],"derived":[],"qualitativeClaims":[],"lawIds":[],"assumptions":[],"visualRequirement":"required"},

];
type Fixture = [label: string, planIndex: number, wholeSymbol: string | null, unverified: string[]];
const FIXTURES: Fixture[] = [
  ["T = 2π√(l/g)",0,"T",[]],
  ["T = 2π√(L/g)",0,"T",[]],
  ["T = 2π√(m/k)",0,"T",[]],
  ["ω = √(k/m)",0,"ω",[]],
  ["f = (1/2π)√(k/m)",0,"f",[]],
  ["v = √(T/m)",0,"v",[]],
  ["ω = 1/√(L C)",0,"ω",[]],
  ["√(k/m)",0,null,[]],
  ["√(g/l)",0,null,[]],
  ["√c",0,null,[]],
  ["Λm = Λ°m − A√c",0,"Λm",[]],
  ["h = (√3/2)a",0,"h",[]],
  ["Area = (√3/4)a²",0,"Area",[]],
  ["(√3/4)a²",0,null,[]],
  ["γ = 1/√(1 − v²/c²)",0,"γ",[]],
  ["√(1 - v^2/c^2)",0,null,[]],
  ["d = |c|/√(1 + m²)",0,"d",[]],
  ["√(1 + m²)",0,null,[]],
  ["√(1 − k²)",0,null,[]],
  ["√(4 + h²)",0,null,[]],
  ["√(9 + t²)",0,null,[]],
  ["√(2 + h)",0,null,[]],
  ["√(m² + 1)",0,null,[]],
  ["h = (√3/2)s",0,"h",[]],
  ["A = (√3/4)s²",0,"A",[]],
  ["d = (√2)L",0,"d",[]],
  ["a = (1/√2)g",0,"a",[]],
  ["h = (√3/2) a",0,"h",[]],
  ["h = (√3/2) s",0,"h",[]],
  ["√(2gh)",0,null,["2 gh"]],
  ["v = √(2gh)",0,"v",["2 gh"]],
  ["v = √(u² + 2as)",0,"v",[]],
  ["√3 a/2",0,null,[]],
  ["√(GM/r)",0,null,[]],
  ["v_e = √(2GM/R)",0,"v_e",[]],
  ["v = √(5gR)",0,"v",[]],
  ["v_min = √(gr)",0,"v_min",[]],
  ["λ = h/√(2mE)",0,"λ",[]],
  ["v = √(3kT/m)",0,"v",["3 kT/m"]],
  ["Z = √(R² + (X_L − X_C)²)",0,"Z",[]],
  ["c = 1/√(μ₀ε₀)",0,"c",[]],
  ["I_rms = I₀/√2",0,"I_rms",[]],
  ["d = a√2",0,"d",[]],
  ["a√3/2",0,null,[]],
  ["2√(ab)",0,null,[]],
  ["k√m",0,null,[]],
  ["(√2)a",0,null,[]],
  ["(√3/2)l",0,null,[]],
  ["√(2g/l)",0,null,["2 g/l"]],
  ["√(k/(2m))",0,null,["2 m"]],
  ["2√(g/l)",0,null,[]],
  ["E = √(E₁² + E₂²)",0,"E",[]],
  ["b = a√(1 − e²)",0,"b",[]],
  ["√(25 − x²)",0,null,[]],
  ["l = √(r² + h²)",0,"l",[]],
  ["√(a²+b²)",0,null,[]],
  ["5√2",0,null,[]],
  ["E = mc²",0,"E",[]],
  ["½ m",0,null,[]],
  ["√(2+ m)",0,null,[]],
  ["20√ m",0,null,[]],
  ["√(2 m)",0,null,["2 m"]],
  ["20√3 m",1,null,["3 m"]],
  ["100√2 km/h",1,null,["2 km/h"]],
  ["(20√3 m)",1,null,["3 m"]],
  ["(100√2 km/h)",1,null,["2 km/h"]],
  ["((20√3 m))",1,null,["3 m"]],
  ["((100√2 km/h))",1,null,["2 km/h"]],
  ["R = 20√3 m",1,"R",["3 m"]],
  ["20√3 m (≈ 34.6 m)",1,null,["3 m"]],
  ["दूरी 20√3 m",1,null,["3 m"]],
  ["20√2 m",1,null,["2 m"]],
  ["20√2m",1,null,["2 m"]],
  ["(20√2)m",1,null,[]],
  ["(20√2)A",1,null,[]],
  ["100√3 km/h",1,null,["3 km/h"]],
  ["3 m",1,null,["3 m"]],
  ["2 km/h",1,null,["2 km/h"]],
  ["99 m",1,null,["99 m"]],
  ["20√3 m; 99 m",1,null,["3 m","99 m"]],
  ["√(k/m); 99 m",1,null,["99 m"]],
  ["√(2g/l); 99 m",1,null,["2 g/l","99 m"]],
  ["v = 99√2 km/h",1,"v",["2 km/h"]],
  ["(20√2 m)",1,null,["2 m"]],
  ["((20√2 m))",1,null,["2 m"]],
  ["(100√3 km/h)",1,null,["3 km/h"]],
  ["((100√3 km/h))",1,null,["3 km/h"]],
  ["-(20√3 m)",1,null,["3 m"]],
  ["−(20√3 m)",1,null,["3 m"]],
  ["- ( 20√3 m )",1,null,["3 m"]],
  ["− ( 20√3 m )",1,null,["3 m"]],
  ["20√3m",2,null,["3 m"]],
  ["(20√3)m",2,null,[]],
  ["(20√3)A",3,null,[]],
  ["20√3/2 m",4,null,["2 m"]],
  ["(20√3)/2 m",4,null,["2 m"]],
  ["((20√3)/2 m)",4,null,["2 m"]],
  ["(((20√3)/2) m)",4,null,[]],
  ["-(20√3 m)",5,null,["3 m"]],
  ["−(20√3 m)",5,null,["3 m"]],
  ["- ( 20√3 m )",5,null,["3 m"]],
  ["− ( 20√3 m )",5,null,["3 m"]],
  ["100+100√3 km/h",6,null,["3 km/h"]],
  ["-(100+100√3) km/h",7,null,[]],
  ["-(100+100√3 km/h)",7,null,["3 km/h"]],
  ["−(100+100√3 km/h)",7,null,["3 km/h"]],
  ["√(2+√3) m",8,null,[]],
  ["-√3 m",9,null,["3 m"]],
  ["−√3 m",9,null,["3 m"]],
  ["+√3 m",10,null,["3 m"]],
  ["2e1√3 m",2,null,["3 m"]],
  ["20√3 eV",11,null,["3 eV"]],
  ["√.25 m",12,null,["0.25 m"]],
  ["√2e2 m",13,null,["200 m"]],
  ["2√2 m/s",14,null,["2 m/s"]],
  ["v = 2√2 m/s",14,"v",["2 m/s"]],
  ["10√2 N",15,null,["2 N"]],
  ["5√3 cm",16,null,["3 cm"]],
  ["(15√2) km/h",17,null,[]],
  ["√(10/√3) m/s",18,null,[]],
  ["v = √(2gh) = 19.8 m/s",19,"v",["2 gh"]],
  ["v₀ = 10 m/s",20,"v₀",[]],
  ["10 m/s²",21,null,[]],
  ["θ = 30°",22,"θ",[]],
  ["ऊँचाई h = 20 m",23,null,[]],
  ["-√3 m",10,null,["3 m"]],
  ["−√3 m",10,null,["3 m"]],
  ["1+√3 m",10,null,["3 m"]],
  ["√(2+√3) m",10,null,[]],
  ["√(2+) m",10,null,[]],
  ["20√ m",10,null,[]],
  ["√(-2) m",10,null,[]],
  ["2√3/4 m",10,null,["4 m"]],
  ["√(2 m)",10,null,[]],
  ["√(2+ m)",10,null,[]],
  ["-(100+100√3 km/h)",24,null,["3 km/h"]],
  ["R = 20√3 m",25,"R",["3 m"]],
  ["(15√2) km/h",26,null,[]],
  ["2√2 m/s",0,null,["2 m/s"]],
  ["√(2 × 9.8 × 99) m/s",19,null,[]],
  ["v = √(2 × 9.8 m/s² × 99 m)",27,"v",["99 m"]],
  ["v = √(2 × 9.8 m/s² × 20 m)",27,"v",[]],
  ["√(2g × 99 m)",27,null,["2 g","99 m"]],
  ["√(2 × 99 m × g)",27,null,["99 m"]],
  ["T = 2π√(5 m / 9.8 m/s²)",28,"T",["5 m"]],
  ["T = 2π√(0.99 m / 9.8 m/s²)",28,"T",[]],
  ["T = 2π√(0.1) s",29,"T",[]],
  ["T = 2π√(0.98/9.8) s",29,"T",[]],
  ["T = 2π√(l/g) = 2π√(0.1) s",29,"T",[]],
  ["period = 2π√(√3/10) s",30,"period",[]],
  ["γ = 1/√(1 − v²/c²)",31,"γ",[]],
  ["d = |c|/√(1 + m²)",32,"d",[]],
  ["h = (√3/2)a",33,"h",[]],
  ["Area = (√3/4)a²",33,"Area",[]],
  ["(√3/4)a²",33,null,[]],
  ["h = (√3/2)s",33,"h",[]],
  ["F = 2√3mg sinθ",34,"F",["3 mg"]],
  ["  R  =  34.6 m  ",1,"R",[]],
  ["R = 99 m",1,"R",["99 m"]],
];

function scene(label: string, plan: TurnPlanV3, annotation = true): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "Source label" },
    source: { question: plan.question, nonMetric: true, representationTier: "qualitative_verified" },
    quantities: [], entities: [
      { id: "a", kind: "point", role: "start" }, { id: "b", kind: "point", role: "end" },
      { id: "length", kind: "dimension", role: "length", label },
    ],
    constructions: [
      { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
      { id: "make_b", operator: "point", inputs: { x: 4, y: 0 }, outputs: ["b"] },
      { id: "make_length", operator: "dimension", inputs: { start: "a", end: "b" }, outputs: ["length"] },
    ],
    relations: [], assertions: [],
    annotations: annotation ? [{ id: "label_note", kind: "brace", targetIds: ["length"], text: label }] : [],
    requiredEntityIds: ["a", "b", "length"],
    revealGroups: [{ id: "setup", entityIds: ["a", "b", "length"], dependsOn: [], narrationCue: "show the source length" }],
    teachingTimeline: [],
  };
}

function retainedLabel(document: SceneDocument): string | undefined {
  return document.entities.find(entity => entity.id === "length")?.label;
}

async function verifyKohlrausch(): Promise<void> {
  const question = "Draw the variation of molar conductivity with √c for a strong electrolyte and a weak electrolyte and explain Kohlrausch law.";
  const plan: TurnPlanV3 = { ...PLANS[0]!, question, visualRequirement: "required" };
  const selected = selectProductionScene({
    question, turnPlan: plan, problemIR: null,
    sceneCapabilities: inferSceneCapabilities(question, { turnPlan: plan }),
  });
  assert.equal(selected.visualStatus, "validated", selected.reason);
  const representation = selected.representation;
  assert(representation, "the required no-quantity Kohlrausch case must draw");
  const saved = await canonicalizeTurnSceneMetadata({
    question, sceneDocument: representation.sceneDocument, visualStatus: "validated",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3", representationTier: representation.tier,
      nonMetric: representation.nonMetric, diagramResultStatus: "ready", turnPlan: plan,
    },
    segments: [],
  });
  assert(saved.ok, saved.ok ? "" : saved.error);
  assert.equal(saved.value.visualStatus, "validated");
  const document = saved.value.sceneDocument;
  assert(document, "the real save boundary must retain the figure");
  assert.equal(document.source.chemistryFamily, "chem_electrochem");
  assert(document.entities.some(entity => entity.label === "√c"), "the saved axis label must stay whole");
  assert(document.annotations.some(annotation => annotation.text?.includes("Λm = Λ°m − A√c")),
    "the saved formula caption must stay whole");
}

async function verifyRendering(): Promise<void> {
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const pump = setInterval(() => { clock.advance(100); clock.pump(); }, 1);
  const expectCompleteInk = async (text: string, x: number, y: number, fontSize: number, duration: number) => {
    await board.clearBoard(0);
    await board.writeText(text, x, y, duration, undefined, fontSize);
    const nodes = board.getDrawLayer()!.getChildren().filter(node => node.getAttrs().htInk);
    const glyphs = await textToStrokePaths(text, x, y, fontSize);
    assert.equal(nodes.filter(node => node.getClassName() === "Text").length, 0, `${text}: every glyph is handwritten`);
    assert.equal(nodes.length, glyphs.reduce((sum, glyph) => sum + glyph.strokes.length, 0),
      `${text}: the actual Whiteboard retains every published glyph stroke`);
  };
  try {
    for (const text of [
      "√(1 + m²)", "T = 2π√(0.1) s", "h = (√3/2)s", "R = 20√3 m", "20√3 m",
      "v₀ = 10 m/s", "v = √(2 × 9.8 m/s² × 99 m)", "√(2g/l)",
    ]) {
      const fixture = FIXTURES.find(([label]) => label === text);
      assert(fixture, `missing rendering fixture: ${text}`);
      const plan = PLANS[fixture[1]]!;
      // These are formula labels on an ordinary wide segment, rather than
      // physical dimension labels competing with dimension arrows for space.
      const original = scene(text, plan, false);
      original.entities[2] = { id: "length", kind: "segment", role: "labelled source segment", label: text };
      original.constructions[1] = { id: "make_b", operator: "point", inputs: { x: 10, y: 0 }, outputs: ["b"] };
      original.constructions[2] = { id: "make_length", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["length"] };
      const pruned = pruneUnverifiedSceneAnnotations(original, plan);
      const label = retainedLabel(pruned);
      const compiled = compileSceneDocument(pruned);
      assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
      const presentation = buildVerifiedDiagramPresentation(pruned, compiled.renderScene);
      const published = presentation.diagram.commands.filter(command => command.type === "LABEL");
      assert.deepEqual(published.map(command => command.text), label ? [label] : [],
        `${text}: compile and presentation cannot recreate a removed label or publish a fragment`);
      for (const command of published) {
        const [x, y, fontSize] = command.params;
        for (const duration of [0, 1200])
          await expectCompleteInk(command.text!, x!, y!, fontSize!, duration);
      }
    }
    // The original reported surds already render whole as ordinary notebook
    // writing. Keep that real consumer proof separate from authority admission.
    for (const text of ["20√3 m", "100√2 km/h", "γ = 1/√(1 − v²/c²)", "v = √(2 × 9.8 m/s² × 20 m)"])
      for (const duration of [0, 1200]) await expectCompleteInk(text, 90, 142, 32, duration);
  } finally {
    clearInterval(pump);
    unmountTestWhiteboard(board);
  }
}

async function main(): Promise<void> {
  const failures: string[] = [];
  for (const [label, planIndex, symbol, unverified] of FIXTURES) {
    const plan = PLANS[planIndex]!;
    const issues = validateSceneQuantityAgreement([], plan, [label]);
    assert.deepEqual(issues, unverified.map(value => ({
      code: "displayed_quantity_unverified", path: "displayedTexts[0]",
      message: `displayed value ${value} is not supported by TurnPlanV3`,
    })), `${label}: numeric authority must keep main's literal verdict`);
    const original = scene(label, plan);
    const pruned = pruneUnverifiedSceneAnnotations(original, plan);
    const retained = retainedLabel(pruned);
    const note = pruned.annotations.find(annotation => annotation.id === "label_note")?.text;
    if (unverified.length === 0) {
      if (retained !== label) failures.push(`${label}: accepted label was changed to ${JSON.stringify(retained)}`);
      if (note !== label) failures.push(`${label}: accepted annotation was changed`);
    } else {
      if (retained !== undefined && (symbol === null || retained !== symbol))
        failures.push(`${label}: unsupported label became fragment ${JSON.stringify(retained)} instead of ${symbol ?? "no label"}`);
      if (note !== undefined) failures.push(`${label}: unsupported annotation was retained`);
    }
    assert.deepEqual(pruned.constructions, original.constructions, `${label}: display policy cannot edit construction geometry`);
    assert.deepEqual(pruned.quantities, original.quantities, `${label}: display policy cannot edit quantities`);
  }
  assert.deepEqual(failures, [], "accepted labels stay byte-whole; unsupported labels become a complete symbol or disappear");
  await verifyKohlrausch();
  await verifyRendering();
  console.log(`atomic scene labels: ${FIXTURES.length} fixed main authority verdicts; entity/annotation atomicity, actual Kohlrausch live/save, compiler/presentation and immediate/animated Whiteboard controls`);
}

runWhiteboardVerifier(main);
